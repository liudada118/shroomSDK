"""Regression tests for defects found in review: request smuggling, close handshakes, races and leaks."""

from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
from tempfile import TemporaryDirectory
import threading
from threading import Event, Thread
import time
import unittest
from unittest.mock import patch

from shroom_sdk import (BackendError, BackendSdkClient, Center, DEFAULT_DELIMITER, PadFrame, ShroomError,
                        clear_license, encode_stream_frame, save_recording)
from shroom_sdk._ws import (MAX_FRAGMENTS, OP_CLOSE, OP_TEXT, MessageReader, WebSocketProtocolError, encode_frame,
                            parse_close, parse_json, read_exactly)
from shroom_sdk.recording import RecordingStore, _Database, _reader_uri, recording_jsonl
from license_fixture import LicensedTestCase
from product_fixture import PushSource, product_frames
from test_product_devices import FakeSerial, ScriptPort, product, reset_reservations
from test_reliability import serial_device
from test_stream import OTHER_ID, RawSocket, StreamCase, http_request, wait_until

PAD = bytes(range(256)) * 4 + bytes.fromhex("AA550399")


def exchange(port: int, data: bytes) -> bytes:
    """Send raw bytes and return everything the server answers until it closes the connection."""
    received = b""
    with closing(socket.create_connection(("127.0.0.1", port), timeout=5)) as connection:
        connection.sendall(data)
        while True:
            chunk = connection.recv(65536)
            if not chunk:
                return received
            received += chunk


class ServerHardeningTests(StreamCase, LicensedTestCase):
    def test_request_bodies_are_never_parsed_as_requests(self):
        server, _ = self.serve()
        host = f"Host: 127.0.0.1:{server.port}\r\n"
        upgrade = ("GET / HTTP/1.1\r\n" + host + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                   "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
        # What a page on another origin can make a browser send: a refused request whose body is a second request.
        smuggled = upgrade + encode_frame(OP_TEXT, json.dumps(
            {"type": "recording.start", "requestId": "x", "label": "smuggled"}).encode(), mask=True)
        for method, origin in (("POST", "https://evil.example"), ("POST", None), ("PUT", "http://localhost:3000"),
                               ("GET", None), ("OPTIONS", "http://localhost:3000")):
            with self.subTest(method=method, origin=origin):
                outer = (f"{method} /anything HTTP/1.1\r\n" + host + (f"Origin: {origin}\r\n" if origin else "")
                         + f"Connection: keep-alive\r\nContent-Length: {len(smuggled)}\r\n\r\n").encode()
                answer = exchange(server.port, outer + smuggled)
                self.assertEqual(answer.count(b"HTTP/1."), 1)  # Exactly one response, then the connection ends.
                self.assertNotIn(b"101 Switching Protocols", answer)
                self.assertIn(b"Connection: close", answer)
        self.assertIsNone(server.get_recording_status())
        pipelined = ("GET /health HTTP/1.1\r\n" + host + "\r\n").encode() * 2
        self.assertEqual(exchange(server.port, pipelined).count(b"HTTP/1."), 1)
        self.assertEqual(http_request(server, "/health")[0], 200)

    def test_an_empty_origin_list_allows_no_browser_origin(self):
        server, _ = self.serve(allowed_origins=[])
        self.assertEqual(http_request(server, "/health", origin="http://localhost:5173")[0], 403)
        self.assertEqual(http_request(server, "/health")[0], 200)  # Native clients send no Origin.
        peer = RawSocket(server, origin="http://127.0.0.1:3000")
        self.assertEqual(peer.status, 403)
        peer.close()

    def test_request_ids_that_cannot_be_echoed_are_rejected_before_any_action(self):
        server, _ = self.serve()
        peer = RawSocket(server)
        self.addCleanup(peer.close)
        peer.next_json()
        for text, code in (('{"type":"recording.start","requestId":NaN,"label":"x"}', "SERVER_ERROR"),
                           ('{"type":"recording.start","requestId":-Infinity,"label":"x"}', "SERVER_ERROR"),
                           ('{"type":"recording.start","requestId":1e999,"label":"x"}', "INVALID_REQUEST"),
                           ('{"type":"recording.start","requestId":' + "9" * 200 + ',"label":"x"}', "INVALID_REQUEST")):
            peer.send(OP_TEXT, text.encode())
            response = peer.next_json()
            self.assertEqual((response["requestId"], response["ok"], response["error"]["code"]), (None, False, code))
        self.assertIsNone(server.get_recording_status())
        peer.send_json({"type": "recording.status", "requestId": 10 ** 40})  # Large but finite ids are echoed.
        self.assertEqual(peer.next_json(), {"type": "response", "requestId": 10 ** 40, "ok": True, "result": None})
        with self.assertRaises(ValueError):
            parse_json('{"a": Infinity}')

    def test_oversized_messages_always_receive_their_close_code(self):
        server, _ = self.serve()
        for size in (70_000, 1_000_000, 4_000_000):
            with self.subTest(size=size):
                peer = RawSocket(server)
                peer.next_json()
                peer.send(OP_TEXT, b" " * size)  # The server stops reading at the header; the rest is still in flight.
                opcode, payload = peer.next()
                self.assertEqual((opcode, parse_close(payload)[0]), (OP_CLOSE, 1009))
                peer.close()
        self.assertEqual(http_request(server, "/health")[0], 200)

    def test_device_info_that_json_cannot_carry_does_not_break_handshakes_or_leak_threads(self):
        source = PushSource({"source": "custom", "product": "hand", "gain": float("nan"), "limit": float("inf")})
        server, _ = self.serve(source)
        expected = {"source": "custom", "product": "hand", "gain": None, "limit": None}
        for _ in range(3):
            peer = RawSocket(server)
            self.assertEqual(peer.next_json()["info"], expected)
            peer.close()
        self.assertEqual(json.loads(http_request(server, "/health")[2])["info"], expected)
        server.close()
        self.assertTrue(wait_until(lambda: not any(thread.name == "shroom-ws-writer" for thread in threading.enumerate())))

    def test_an_interrupted_close_still_shuts_down_and_lets_later_calls_return(self):
        server, _ = self.serve()
        recorder_close = server._recorder.close
        with patch.object(server._recorder, "close", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                server.close()
        finished = Event()
        Thread(target=lambda: (server.close(), finished.set()), daemon=True).start()
        self.assertTrue(finished.wait(3))
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", server.port), timeout=0.5).close()
        recorder_close()

    def test_connections_accepted_during_shutdown_are_closed(self):
        server, _ = self.serve()
        server.close()
        late, other = socket.socketpair()
        self.addCleanup(other.close)
        server._track(late)
        self.assertEqual(late.fileno(), -1)


class FramingTests(unittest.TestCase):
    def test_empty_fragments_cannot_accumulate_without_limit(self):
        never_final = b"\x01\x00" + b"\x00\x00" * (MAX_FRAGMENTS + 10)
        reader = MessageReader(read_exactly(io.BytesIO(never_final)), max_size=1024, expect_mask=False)
        with self.assertRaises(WebSocketProtocolError) as caught:
            reader.next()
        self.assertEqual((caught.exception.close_code, reader._parts), (1009, []))
        fragmented = b"\x01\x02ab" + b"\x00\x00" + b"\x89\x01p" + b"\x80\x02cd"  # A ping between fragments is allowed.
        ordinary = MessageReader(read_exactly(io.BytesIO(fragmented)), max_size=1024, expect_mask=False)
        self.assertEqual([ordinary.next(), ordinary.next()], [(0x9, b"p"), (OP_TEXT, b"abcd")])
        self.assertEqual((ordinary._fragments, ordinary._size), (0, 0))


class RecordingHardeningTests(unittest.TestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name).resolve()
        self.frames = [encode_stream_frame(frame) for frame in product_frames("hand", {}, 2)]

    def test_legacy_metadata_without_a_start_time_does_not_break_listing(self):
        (self.directory / f"{OTHER_ID}.meta.json").write_text(json.dumps({"id": OTHER_ID, "status": "stopped"}), encoding="utf-8")
        (self.directory / f"{OTHER_ID}.jsonl").write_text("", encoding="utf-8")
        with closing(RecordingStore(self.directory)) as store:
            store.start("new")
            store.stop()
            self.assertEqual([meta.get("label") for meta in store.list()], ["new", None])

    def test_read_only_uris_never_put_a_network_host_in_the_authority(self):
        self.assertEqual(_reader_uri(r"C:\data\rec 1\recordings.sqlite", windows=True),
                         "file:///C:/data/rec%201/recordings.sqlite?mode=ro")
        self.assertEqual(_reader_uri(r"\\server\share\rec#1\recordings.sqlite", windows=True),
                         "file:////server/share/rec%231/recordings.sqlite?mode=ro")
        self.assertEqual(_reader_uri("/var/lib/录制/a?b%c.sqlite", windows=False),
                         "file:///var/lib/%E5%BD%95%E5%88%B6/a%3Fb%25c.sqlite?mode=ro")

    def test_exports_work_from_directories_with_reserved_characters(self):
        directory = self.directory / "rec #1 %20 录制"
        with closing(RecordingStore(directory)) as store:
            started = store.start("x")
            for frame in self.frames:
                store.append(frame)
            store.stop()
            self.assertEqual(len(list(recording_jsonl(store.download(started["id"])))), 2)

    @unittest.skipUnless(os.name == "nt", "UNC paths are specific to Windows")
    def test_exports_work_from_a_network_path(self):
        share = Path(rf"\\localhost\{self.directory.drive[0]}$" + str(self.directory)[2:])
        if not share.exists():
            self.skipTest("the administrative share is not accessible to this user")
        with closing(RecordingStore(share / "recordings")) as store:
            started = store.start("network")
            for frame in self.frames:
                store.append(frame)
            store.stop()
            self.assertEqual(len(list(recording_jsonl(store.download(started["id"])))), 2)

    def test_a_failed_commit_is_rolled_back_so_later_transactions_can_start(self):
        class Failing:
            in_transaction = True

            def __init__(self):
                self.statements = []

            def execute(self, statement):
                self.statements.append(statement)
                if statement == "COMMIT":
                    raise sqlite3.OperationalError("disk I/O error")
        database = Failing()
        with self.assertRaises(sqlite3.OperationalError):
            with _Database._Transaction(database):
                pass
        self.assertEqual(database.statements, ["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"])


class TruncatedResponseTests(unittest.TestCase):
    def serve(self, respond):
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                respond(self)
                self.close_connection = True

            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}"

    def test_a_download_cut_short_is_an_sdk_error_and_leaves_no_file(self):
        def respond(handler):
            handler.send_response(200)
            handler.send_header("Transfer-Encoding", "chunked")
            handler.end_headers()
            handler.wfile.write(b"5\r\nhello\r\n")  # No terminating chunk: the export failed half-way.
        with TemporaryDirectory() as folder:
            target = Path(folder) / "capture.csv"
            with self.assertRaises(ShroomError) as caught:
                save_recording(self.serve(respond) + f"/recordings/{OTHER_ID}.csv", target)
            self.assertEqual((caught.exception.code, caught.exception.stage, list(Path(folder).iterdir())),
                             ("REQUEST_FAILED", "stream", []))

    def test_a_backend_response_cut_short_is_a_backend_error(self):
        def respond(handler):
            handler.send_response(200)
            handler.send_header("Content-Length", "100")
            handler.end_headers()
            handler.wfile.write(b'{"co')
        with self.assertRaises(BackendError):
            BackendSdkClient(http_base_url=self.serve(respond), timeout=3).list_serial_ports()


class BackendRealtimeHardeningTests(unittest.TestCase):
    def test_bad_protocols_and_unexpected_connect_failures_never_leave_the_client_connecting(self):
        client = BackendSdkClient()
        for protocols in (123, "", [], ["ok", 5]):
            with self.subTest(protocols=protocols), self.assertRaises(ValueError):
                client.connect_realtime(protocols=protocols)
        self.assertEqual(client.realtime_state, "closed")

        def factory(url, **options):
            raise TypeError("unexpected failure inside the connection factory")
        failing = BackendSdkClient(connection_factory=factory)
        events = []
        failing.on("error", lambda error: events.append("error")).on("close", lambda event: events.append("close"))
        failing.connect_realtime(["pressure"])
        self.assertTrue(wait_until(lambda: events == ["error", "close"]))
        self.assertEqual(failing.realtime_state, "closed")
        failing.connect_realtime()  # A new attempt is possible afterwards.
        self.assertTrue(wait_until(lambda: events == ["error", "close"] * 2))


class DeviceHardeningTests(LicensedTestCase):
    def setUp(self):
        super().setUp()
        reset_reservations(self)

    def test_licence_loss_closes_a_subscribed_serial_device_without_stalling(self):
        payload = bytes(range(16))
        port = ScriptPort([DEFAULT_DELIMITER + (payload + DEFAULT_DELIMITER) * 2])
        frames, errors = [], []
        device = serial_device(port)
        device.on_error(errors.append)
        device.on_frame(frames.append)
        self.assertTrue(wait_until(lambda: len(frames) == 2))
        started = time.monotonic()
        clear_license()  # Runs the device's close on this thread while its reader is active.
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.6)
        self.assertTrue(wait_until(lambda: not port.is_open and len(errors) == 1))
        self.assertEqual((errors[0].code, device.state, device.closed, port.close_calls), ("LICENSE_REQUIRED", "error", True, 1))
        device.close()
        self.assertEqual(port.close_calls, 1)

    def test_termination_on_another_thread_reports_the_error_exactly_once(self):
        port = ScriptPort([PAD])
        frames, errors, states = [], [], []

        def slow_state(status):
            states.append(status["state"])
            time.sleep(0.05)  # Gives the reader thread time to notice the termination first.
        device = product(FakeSerial(port), "pad", "COM1", on_data=frames.append, on_error=errors.append,
                         on_state_change=slow_state)
        self.assertTrue(wait_until(lambda: len(frames) == 1))
        with self.assertNoLogs("shroom_sdk", level="ERROR"):
            clear_license()
            self.assertTrue(wait_until(lambda: not port.is_open))
            time.sleep(0.2)
        self.assertEqual(([error.code for error in errors], states, device.state), (["LICENSE_REQUIRED"], ["open", "error"], "error"))

    def test_a_closed_connection_cannot_be_put_back_into_another_state(self):
        device = product(FakeSerial(ScriptPort()), "pad", "COM1")
        device.close()
        self.assertEqual((device._set_state("reconnecting"), device._set_state("open"), device.state), (False, False, "closed"))

    def test_closing_while_a_frame_is_being_decoded_ends_closed(self):
        from shroom_sdk import mock
        for _ in range(20):
            device = mock(rows=8, cols=8, fps=1000)
            device.on_frame(lambda frame: None)
            time.sleep(0.003)
            device.close()
            self.assertEqual(device.state, "closed")

    def test_hand_built_product_frames_with_integer_values_can_be_encoded(self):
        frame = PadFrame(raw=bytes(1024), values=[0] * 1024, rows=32, cols=32, min=0, max=0, avg=0, area=0,
                         center=Center(0.5, 0.5), timestamp=1, product="hand", pressure=bytes(1024),
                         pressure_matrix=bytes(1024))
        self.assertEqual(encode_stream_frame(frame)["values"], [0] * 1024)
