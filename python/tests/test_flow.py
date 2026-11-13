"""The five quick functions: read, serve, start, stop and download, with their ownership rules."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
import unittest
from unittest.mock import patch

from shroom_sdk import (ManagedSerialDevice, ProductServer, ShroomError, StreamClient, connect_stream,
                        create_product_mock_device, create_ws, download_recording, read_product, serve_device,
                        start_recording, stop_recording)
from license_fixture import LicensedTestCase
from product_fixture import TAIL
from test_product_devices import FakeSerial, ScriptPort
from test_stream import OTHER_ID, READY, FakeStreamServer, wait_until


class FlowCase(unittest.TestCase):
    def setUp(self):
        super().setUp()
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name)
        self.closers = []
        self.addCleanup(self.close_all)

    def close_all(self):
        for close in reversed(self.closers):
            try:
                close()
            except ShroomError:
                pass

    def assert_code(self, code, callable_, *args, **kwargs):
        with self.assertRaises(ShroomError) as caught:
            callable_(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def serve_mock(self, product="glove", **options):
        device = create_product_mock_device(product, **options)
        server = create_ws(device, port=0, recordings_dir=self.directory / "recordings")
        self.closers.append(server.close)
        return device, server


class QuickFlowTests(FlowCase):
    def test_five_steps_record_stop_and_download_exactly_one_session(self):
        device, server = self.serve_mock(side="left")
        self.assertIsInstance(server, ProductServer)
        received, errors = [], []
        stream = read_product(url=server.url, on_data=received.append, on_error=errors.append)
        self.closers.append(stream.close)
        self.assertIsInstance(stream, StreamClient)
        self.assert_code("RECORDING_NOT_ACTIVE", download_recording, stream)
        started = start_recording(stream, label="握力测试")
        self.assertEqual((started["label"], started["product"], started["side"], started["source"]),
                         ("握力测试", "handGloveSegmented", "left", "mock"))
        self.assert_code("RECORDING_NOT_ACTIVE", download_recording, stream)  # Not until it has been stopped.
        self.assertTrue(wait_until(lambda: len(received) >= 5))
        stopped = stop_recording(stream)
        self.assertEqual((stopped["id"], stopped["status"]), (started["id"], "stopped"))
        self.assertGreaterEqual(stopped["frame_count"], 4)
        self.assertEqual(download_recording(stream), f"{server.http_url}/recordings/{started['id']}.csv")
        self.assertEqual(download_recording(stream, format="jsonl"), f"{server.http_url}/recordings/{started['id']}.jsonl")
        target = download_recording(stream, self.directory / "capture.jsonl", format="jsonl")
        rows = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
        self.assertEqual((len(rows), {row["sessionId"] for row in rows}, rows[0]["frame"]["side"]),
                         (stopped["frame_count"], {started["id"]}, "left"))
        csv_file = download_recording(stream, self.directory / "capture.csv")
        self.assertEqual(len(csv_file.read_text(encoding="utf-8-sig").splitlines()), stopped["frame_count"] + 1)
        self.assert_code("INVALID_CONFIG", download_recording, stream, format="xlsx")
        self.assertEqual((received[0].product, received[0].side, errors, stream.state), ("handGloveSegmented", "left", [], "open"))
        # The server object controls the same recorder; its own completed session is what it downloads.
        self.assert_code("RECORDING_NOT_ACTIVE", download_recording, server)
        second = start_recording(server)
        self.assertEqual(second["label"], "本次采集")
        self.assert_code("RECORDING_ACTIVE", start_recording, stream, label="overlapping")
        self.assertEqual(download_recording(stream), f"{server.http_url}/recordings/{started['id']}.csv")  # Kept after a failed start.
        self.assertEqual(stop_recording(server)["id"], second["id"])
        self.assertEqual(download_recording(server), f"{server.http_url}/recordings/{second['id']}.csv")
        self.assertTrue(download_recording(server, self.directory / "server.csv").exists())
        third = start_recording(stream, label="third")
        self.assert_code("RECORDING_NOT_ACTIVE", download_recording, stream)  # A new start clears the old ID.
        self.assertEqual(stop_recording(stream)["id"], third["id"])

    def test_closing_the_viewer_keeps_the_recording_and_closing_the_server_releases_the_device(self):
        device, server = self.serve_mock("pad")
        stream = read_product(url=server.url)
        started = start_recording(stream, label="unattended")
        stream.close()
        self.assert_code("DISCONNECTED", stop_recording, stream)
        self.assertEqual((server.get_recording_status()["status"], device.state), ("recording", "open"))
        time.sleep(0.15)
        self.assertEqual(stop_recording(server)["id"], started["id"])
        self.assertEqual([meta["id"] for meta in server.list_recordings()], [started["id"]])
        with server:
            self.assertEqual(server.get_recording_url(started["id"]), download_recording(server))
        self.assertEqual(device.state, "closed")
        server.close()
        for call in (lambda: start_recording(server), lambda: stop_recording(server), lambda: download_recording(server)):
            self.assert_code("SERVER_CLOSED", call)

    def test_only_connections_made_by_the_quick_functions_are_accepted(self):
        device = create_product_mock_device("pad")
        self.closers.append(device.close)
        service = serve_device(device, port=0, recordings_dir=self.directory / "recordings")
        self.closers.append(service.close)
        stream = connect_stream(service.url)
        self.closers.append(stream.close)
        for target in (service, stream, device, None, object(), {}, "ws://127.0.0.1:19999"):
            for call in (start_recording, stop_recording, download_recording):
                with self.subTest(target=type(target).__name__, call=call.__name__):
                    self.assert_code("INVALID_CONFIG", call, target)
        self.assertIsNone(service.get_recording_status())

    def test_read_product_rejects_ambiguous_arguments(self):
        for arguments, options in ((("glove",), {"url": "ws://127.0.0.1:1"}), ((None, "COM3"), {"url": "ws://127.0.0.1:1"}),
                                   ((), {"url": "ws://127.0.0.1:1", "side": "left"}),
                                   ((), {"url": "ws://127.0.0.1:1", "reconnect": False}),
                                   (("glove", "COM3"), {"side": "left", "port": 19999}),
                                   (("glove", "COM3"), {"side": "left", "timeout": 3})):
            with self.subTest(arguments=arguments, options=options), patch(
                    "shroom_sdk.product_device._serial_module") as loader:
                self.assert_code("INVALID_CONFIG", read_product, *arguments, **options)
                loader.assert_not_called()
        self.assert_code("INVALID_CONFIG", read_product)
        self.assert_code("CONNECTION_FAILED", read_product, url="ws://127.0.0.1:1", timeout=0.3)

    def test_failed_startup_releases_the_device(self):
        device = create_product_mock_device("pad")
        self.assert_code("INVALID_CONFIG", create_ws, device, port=-1)
        self.assertEqual(device.state, "closed")
        for target in (None, object(), "COM3"):
            self.assert_code("INVALID_CONFIG", create_ws, target)
        busy_device, server = self.serve_mock("pad")
        other = create_product_mock_device("pad")
        self.assert_code("SERVER_START_FAILED", create_ws, other, port=server.port, recordings_dir=self.directory / "other")
        self.assertEqual((other.state, busy_device.state), ("closed", "open"))

    def test_operations_on_one_connection_never_overlap(self):
        release = Event()

        def script(peer):
            peer.send(READY)
            request = peer.receive()
            release.wait(5)
            peer.send({"type": "response", "requestId": request["requestId"], "ok": True,
                       "result": {"id": OTHER_ID, "label": "x", "startedAt": 1, "endedAt": 2, "frameCount": 0, "status": "stopped"}})
            broken = peer.receive()
            peer.send({"type": "response", "requestId": broken["requestId"], "ok": True, "result": {"id": "not-a-uuid"}})
            peer.hold()
        fake = FakeStreamServer(script)
        self.closers.append(fake.close)
        stream = read_product(url=fake.url)
        self.closers.append(stream.close)
        outcome = []
        worker = Thread(target=lambda: outcome.append(stop_recording(stream)["id"]))
        worker.start()
        time.sleep(0.05)
        for call in (lambda: start_recording(stream), lambda: stop_recording(stream), lambda: download_recording(stream)):
            self.assert_code("INVALID_REQUEST", call)
        release.set()
        worker.join(3)
        self.assertEqual(outcome, [OTHER_ID])
        self.assertTrue(download_recording(stream).endswith(f"/recordings/{OTHER_ID}.csv"))
        # A stop that returns no usable ID is an error, and the previous ID is kept.
        self.assert_code("INVALID_REQUEST", stop_recording, stream)
        self.assertTrue(download_recording(stream).endswith(f"/recordings/{OTHER_ID}.csv"))


class QuickFlowSerialTests(FlowCase, LicensedTestCase):
    def test_serial_mode_connects_the_registered_product_and_owns_its_resources(self):
        pad = bytes(range(256)) * 4 + TAIL
        port = ScriptPort([pad, pad])
        serial = FakeSerial(port)
        frames = []
        with patch("shroom_sdk.product_device._serial_module", return_value=serial):
            device = read_product("pad", "COM5", on_data=frames.append, reconnect=False)
        self.assertIsInstance(device, ManagedSerialDevice)
        self.assertEqual((serial.calls[0][0], serial.calls[0][1]["baudrate"], device.info["product"]), ("COM5", 1000000, "hand"))
        self.assertTrue(wait_until(lambda: len(frames) == 2))
        server = create_ws(device, port=0, recordings_dir=self.directory / "recordings")
        received = []
        with read_product(url=server.url, on_data=received.append) as stream:
            self.assertEqual((stream.info["product"], stream.info["source"], stream.info["path"]), ("hand", "python-serial", "COM5"))
            start_recording(stream, label="serial")
            port.chunks.extend([pad, pad, pad])
            self.assertTrue(wait_until(lambda: len(received) == 3))
            self.assertEqual(stop_recording(stream)["frame_count"], 3)
        server.close()
        self.assertEqual((device.state, port.is_open), ("closed", False))
