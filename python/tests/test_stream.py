"""Stream server and client: handshake, relay, labelled recordings, downloads, limits and licences."""

from contextlib import closing
import http.client
import json
from pathlib import Path
import socket
import socketserver
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
import unittest

from shroom_sdk import (PadFrame, ShroomError, ShroomLicenseError, StreamClient, activate_license, clear_license,
                        connect_stream, create_product_mock_device, encode_stream_frame, serve_device)
from shroom_sdk._ws import (OP_BINARY, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, ClientConnection, ConnectionClosed,
                            MessageReader, WebSocketProtocolError, accept_key, encode_frame, parse_close,
                            read_exactly)
from shroom_sdk.recording import RecordingStore
from license_fixture import LicensedTestCase, activate_online_fixture
from product_fixture import PushSource, product_frames

OTHER_ID = "11111111-2222-4333-8444-555555555555"
READY = {"type": "ready", "schema": "shroom.frame.v1", "info": {"product": "hand", "baudRate": 1000000}, "recording": None}


def wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


def free_port() -> int:
    with closing(socket.socket()) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def http_request(server, path, *, method="GET", origin=None, host=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.port, timeout=5)
    try:
        connection.putrequest(method, path, skip_host=True)
        connection.putheader("Host", host or f"127.0.0.1:{server.port}")
        if origin:
            connection.putheader("Origin", origin)
        connection.endheaders()
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


class RawSocket:
    """A hand-rolled WebSocket peer for requests a well-behaved client would never send."""

    def __init__(self, server, *, origin=None, host=None, path="/", version="13"):
        self.socket = socket.create_connection(("127.0.0.1", server.port), timeout=5)
        lines = [f"GET {path} HTTP/1.1", f"Host: {host or f'127.0.0.1:{server.port}'}", "Upgrade: websocket",
                 "Connection: Upgrade", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", f"Sec-WebSocket-Version: {version}"]
        if origin:
            lines.append(f"Origin: {origin}")
        self.socket.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
        self.stream = self.socket.makefile("rb")
        self.status = int(self.stream.readline().split()[1])
        self.headers = {}
        while True:
            line = self.stream.readline().decode("latin-1").strip()
            if not line:
                break
            name, _, value = line.partition(":")
            self.headers[name.lower()] = value.strip()
        self.reader = MessageReader(read_exactly(self.stream), max_size=1 << 24, expect_mask=False)

    def send(self, opcode, payload=b"", mask=True):
        self.socket.sendall(encode_frame(opcode, payload, mask=mask))

    def send_json(self, message):
        self.send(OP_TEXT, json.dumps(message).encode("utf-8"))

    def next(self):
        return self.reader.next()

    def next_json(self):
        opcode, payload = self.next()
        assert opcode == OP_TEXT, opcode
        return json.loads(payload)

    def close(self):
        self.socket.close()


class FakeStreamServer:
    """Completes the WebSocket handshake, then lets the test script the server side."""

    def __init__(self, script):
        outer = self
        self.released = Event()

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                headers = {}
                self.rfile.readline()
                while True:
                    line = self.rfile.readline().decode("latin-1").strip()
                    if not line:
                        break
                    name, _, value = line.partition(":")
                    headers[name.lower()] = value.strip()
                self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                                  f"Sec-WebSocket-Accept: {accept_key(headers['sec-websocket-key'])}\r\n\r\n").encode())
                self.wfile.flush()
                try:
                    script(FakePeer(self.rfile, self.wfile, outer.released))
                except (OSError, ConnectionError, WebSocketProtocolError):
                    pass

        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.url = f"ws://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.released.set()
        self.server.shutdown()
        self.server.server_close()


class FakePeer:
    def __init__(self, rfile, wfile, released):
        self.wfile, self.released = wfile, released
        self.reader = MessageReader(read_exactly(rfile), max_size=1 << 20, expect_mask=True)

    def send(self, message):
        text = message if isinstance(message, str) else json.dumps(message)
        self.wfile.write(encode_frame(OP_TEXT, text.encode("utf-8")))
        self.wfile.flush()

    def receive(self):
        while True:
            opcode, payload = self.reader.next()
            if opcode == OP_CLOSE:
                raise ConnectionError("client closed")
            if opcode == OP_TEXT:
                return json.loads(payload)

    def hold(self, timeout=10):
        """Keep the connection open until the test finishes."""
        self.released.wait(timeout)


class StreamCase(unittest.TestCase):
    def setUp(self):
        super().setUp()
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name) / "recordings"
        self.closers = []
        self.addCleanup(self.close_all)

    def close_all(self):
        for close in reversed(self.closers):
            try:
                close()
            except ShroomError:
                pass

    def serve(self, source=None, **options):
        source = source if source is not None else PushSource({"source": "custom", "product": "hand", "baud_rate": 1000000})
        server = serve_device(source, port=0, **{"recordings_dir": self.directory, **options})
        self.closers.append(server.close)
        return server, source

    def connect(self, url, **options):
        stream = connect_stream(url, **options)
        self.closers.append(stream.close)
        return stream

    def fake(self, script):
        server = FakeStreamServer(script)
        self.closers.append(server.close)
        return server

    def assert_code(self, code, callable_, *args, **kwargs):
        with self.assertRaises(ShroomError) as caught:
            callable_(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception


class StreamServerTests(StreamCase, LicensedTestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = product_frames("hand", {}, 3)

    def test_configuration_is_validated_before_any_side_effect(self):
        source = PushSource()
        for options in ({"port": -1}, {"port": 70000}, {"port": True}, {"port": "19999"}, {"host": ""},
                        {"host": "0.0.0.0"}, {"host": "192.168.1.5", "allowed_origins": []},
                        {"allowed_origins": ["*"]}, {"allowed_origins": ["null"]}, {"allowed_origins": "http://a.example"},
                        {"allowed_origins": ["http://a.example/path"]}, {"allowed_origins": ["ftp://a.example"]},
                        {"max_buffered_bytes": 10}, {"max_queue_frames": 0}, {"max_queue_frames": 100001},
                        {"recordings_dir": ""}):
            with self.subTest(options=options):
                error = self.assert_code("INVALID_CONFIG", serve_device, source, **{"recordings_dir": self.directory, **options})
                self.assertIsInstance(error, ValueError)
        self.assert_code("INVALID_CONFIG", serve_device, object(), recordings_dir=self.directory)
        self.assertEqual((source.handlers, self.directory.exists()), ([], False))

    def test_ready_handshake_relay_and_health(self):
        server, source = self.serve()
        self.assertEqual((server.host, server.url, server.http_url),
                         ("127.0.0.1", f"ws://127.0.0.1:{server.port}", f"http://127.0.0.1:{server.port}"))
        received, errors = [], []
        stream = self.connect(server.url, on_data=received.append, on_error=errors.append)
        self.assertIsInstance(stream, StreamClient)
        self.assertEqual((stream.state, stream.url, stream.recording), ("open", server.url, None))
        self.assertEqual(stream.info, {"source": "custom", "product": "hand", "baud_rate": 1000000})
        for frame in self.frames:
            source.push(frame)
        self.assertTrue(wait_until(lambda: len(received) == 3))
        self.assertTrue(all(isinstance(frame, PadFrame) for frame in received))
        self.assertEqual((received, errors), (self.frames, []))
        status, headers, body = http_request(server, "/health")
        self.assertEqual((status, headers["Content-Type"], headers["X-Content-Type-Options"], headers["Cache-Control"]),
                         (200, "application/json; charset=utf-8", "nosniff", "no-store"))
        self.assertEqual(json.loads(body), {"ok": True, "schema": "shroom.frame.v1", "recording": None,
                                            "info": {"source": "custom", "product": "hand", "baudRate": 1000000}})
        with self.connect(f"ws://127.0.0.1:{server.port}/ws") as second:  # /ws is accepted as well.
            self.assertEqual(second.state, "open")
        self.assertEqual(second.state, "closed")

    def test_labelled_recordings_and_exact_downloads(self):
        server, source = self.serve()
        stream = self.connect(server.url)
        states = []
        stream.on_recording(lambda recording: states.append(recording and recording["status"]))
        counts = {}
        for count in (2, 5):
            started = stream.start_recording("  same label  ")
            self.assertEqual((started["label"], started["status"], started["product"], started["source"]),
                             ("same label", "recording", "hand", "custom"))
            self.assert_code("RECORDING_ACTIVE", stream.start_recording, "again")
            self.assert_code("RECORDING_ACTIVE", stream.download_recording, started["id"], self.directory / "early.csv")
            for index in range(count):
                source.push(self.frames[index % 3])
            stopped = stream.stop_recording()
            self.assertEqual((stopped["id"], stopped["status"], stopped["frame_count"]), (started["id"], "stopped", count))
            counts[started["id"]] = count
        self.assertEqual({meta["id"]: meta["frame_count"] for meta in stream.list_recordings()}, counts)
        self.assertEqual({meta["id"] for meta in server.list_recordings()}, set(counts))
        self.assertEqual(stream.get_recording_status()["frame_count"], 5)
        self.assertIn("stopped", states)
        for identifier, count in counts.items():
            target = stream.download_recording(identifier, self.directory / f"{identifier}.jsonl", format="jsonl")
            rows = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(([row["index"] for row in rows], {row["sessionId"] for row in rows}, rows[0]["label"]),
                             (list(range(count)), {identifier}, "same label"))
            self.assertEqual(rows[0]["frame"], encode_stream_frame(self.frames[0]))
            status, headers, body = http_request(server, f"/recordings/{identifier}.csv", origin="http://localhost:5178")
            self.assertEqual((status, headers["Content-Type"], headers["Content-Disposition"],
                              headers["Access-Control-Allow-Origin"], headers["Access-Control-Expose-Headers"]),
                             (200, "text/csv; charset=utf-8", f'attachment; filename="shroom-{identifier}.csv"',
                              "http://localhost:5178", "Content-Disposition"))
            self.assertEqual(len(body.decode("utf-8-sig").splitlines()), count + 1)
            self.assertEqual(server.get_recording_url(identifier), f"{server.http_url}/recordings/{identifier}.csv")
            self.assertEqual(stream.get_recording_url(identifier, format="jsonl"), f"{server.http_url}/recordings/{identifier}.jsonl")
        missing = self.directory / "missing.csv"
        self.assert_code("RECORDING_NOT_FOUND", stream.download_recording, OTHER_ID, missing)
        self.assertEqual(list(self.directory.glob("missing*")), [])  # No partial file is left behind.
        self.assert_code("INVALID_CONFIG", stream.download_recording, "same label", missing)
        # Stopping again reports the same finished recording instead of inventing a new one.
        self.assertEqual(stream.stop_recording()["id"], list(counts)[-1])

    def test_http_only_serves_health_and_known_recordings(self):
        server, source = self.serve()
        active = server.start_recording("active")
        for path, expected in (("/recordings/" + OTHER_ID + ".csv", 404), (f"/recordings/{active['id']}.csv", 409),
                               ("/recordings/..%2F..%2Fsecret.csv", 404), (f"/recordings/{active['id']}/../x.csv", 404),
                               (f"/recordings/{active['id']}.sqlite", 404), ("/recordings.sqlite", 404), ("/", 404),
                               ("/recordings/", 404)):
            with self.subTest(path=path):
                status, headers, body = http_request(server, path)
                self.assertEqual(status, expected)
                self.assertNotIn(str(self.directory).encode(), body)
        self.assertEqual(json.loads(http_request(server, f"/recordings/{active['id']}.csv")[2])["error"]["code"], "RECORDING_ACTIVE")
        status, headers, _ = http_request(server, "/health", method="POST")
        self.assertEqual((status, headers["Allow"]), (405, "GET, OPTIONS"))
        self.assertEqual(http_request(server, "/health", method="HEAD")[0], 405)
        status, headers, body = http_request(server, "/health", method="OPTIONS", origin="http://127.0.0.1:3000")
        self.assertEqual((status, headers["Access-Control-Allow-Methods"], headers["Access-Control-Allow-Origin"], body),
                         (204, "GET, OPTIONS", "http://127.0.0.1:3000", b""))
        self.assertEqual(json.loads(http_request(server, "/health")[2])["recording"]["status"], "recording")

    def test_origin_and_host_restrictions(self):
        server, _ = self.serve()
        for origin, host, allowed in ((None, None, True), ("http://localhost:5178", None, True),
                                      ("https://127.0.0.1", None, True), ("http://[::1]:8080", None, True),
                                      ("http://evil.example", None, False), ("null", None, False),
                                      ("file://", None, False), ("http://localhost.evil.example", None, False),
                                      (None, "evil.example", False), (None, "localhost:1", True)):
            with self.subTest(origin=origin, host=host):
                status, _, body = http_request(server, "/health", origin=origin, host=host)
                self.assertEqual(status, 200 if allowed else 403)
                if not allowed:
                    self.assertEqual(json.loads(body)["error"]["code"], "ORIGIN_DENIED")
                peer = RawSocket(server, origin=origin, host=host)
                self.assertEqual(peer.status, 101 if allowed else 403)
                peer.close()
        for options, status in (({"path": "/other"}, 403), ({"version": "8"}, 426)):
            peer = RawSocket(server, **options)
            self.assertEqual(peer.status, status)
            peer.close()
        listed, _ = self.serve(PushSource(), allowed_origins=["https://app.example"],
                               recordings_dir=self.directory.parent / "second")
        self.assertEqual(http_request(listed, "/health", origin="https://app.example")[0], 200)
        # An explicit list replaces the loopback default instead of extending it.
        self.assertEqual(http_request(listed, "/health", origin="http://localhost:5178")[0], 403)

    def test_control_messages_are_validated_and_answered_by_request_id(self):
        server, _ = self.serve()
        peer = RawSocket(server)
        self.addCleanup(peer.close)
        self.assertEqual(peer.next_json()["type"], "ready")
        peer.send(OP_TEXT, b"not json")
        self.assertEqual((lambda r: (r["type"], r["requestId"], r["ok"]))(peer.next_json()), ("response", None, False))
        for message, code in (({"type": "recording.status"}, "INVALID_REQUEST"), ([1, 2], "INVALID_REQUEST"),
                              ({"type": "recording.status", "requestId": "x" * 129}, "INVALID_REQUEST"),
                              ({"type": "recording.status", "requestId": True}, "INVALID_REQUEST")):
            peer.send_json(message)
            response = peer.next_json()
            self.assertEqual((response["requestId"], response["ok"], response["error"]["code"]), (None, False, code))
        peer.send(OP_BINARY, b"{}")
        self.assertEqual(peer.next_json()["error"]["code"], "INVALID_REQUEST")
        for message, code in (({"type": "device.reset", "requestId": 7}, "INVALID_REQUEST"),
                              ({"type": ["recording.stop"], "requestId": 8}, "INVALID_REQUEST"),
                              ({"type": "recording.stop", "requestId": "a"}, "RECORDING_NOT_ACTIVE"),
                              ({"type": "recording.start", "requestId": "b"}, "INVALID_CONFIG"),
                              ({"type": "recording.start", "requestId": "c", "label": "x\ny"}, "INVALID_CONFIG")):
            peer.send_json(message)
            response = peer.next_json()
            self.assertEqual((response["requestId"], response["ok"], response["error"]["code"]),
                             (message["requestId"], False, code))
            self.assertEqual(set(response["error"]), {"code", "message"})
        peer.send_json({"type": "recording.status", "requestId": 1.5})
        self.assertEqual(peer.next_json(), {"type": "response", "requestId": 1.5, "ok": True, "result": None})
        peer.send(OP_PING, b"probe")
        self.assertEqual(peer.next(), (OP_PONG, b"probe"))
        peer.send_json({"type": "recording.list", "requestId": "list"})
        self.assertEqual(peer.next_json()["result"], [])

    def test_protocol_violations_and_oversized_messages_close_the_connection(self):
        server, _ = self.serve()
        for send, code in ((lambda peer: peer.send(OP_TEXT, b" " * 70000), 1009),
                           (lambda peer: peer.send(OP_TEXT, b"{}", mask=False), 1002),
                           (lambda peer: peer.send(OP_TEXT, b"\xff\xfe"), 1007),
                           (lambda peer: peer.send(OP_CLOSE, b"\x03\xe8"), 1000)):
            peer = RawSocket(server)
            self.assertEqual(peer.next_json()["type"], "ready")
            send(peer)
            opcode, payload = peer.next()
            self.assertEqual((opcode, parse_close(payload)[0]), (OP_CLOSE, code))
            peer.close()
        self.assertEqual(http_request(server, "/health")[0], 200)  # The service itself keeps running.

    def test_slow_viewers_are_dropped_without_blocking_the_source(self):
        server, source = self.serve(max_buffered_bytes=1024)
        connection = ClientConnection(server.url)
        self.addCleanup(connection.close)
        self.assertEqual(json.loads(connection.receive()[1])["type"], "ready")
        started = time.monotonic()
        source.push(self.frames[0])  # One frame is far larger than this viewer's budget.
        self.assertLess(time.monotonic() - started, 1)
        with self.assertRaises(ConnectionClosed) as caught:
            connection.receive()
        self.assertEqual(caught.exception.code, 1013)
        self.assertEqual(http_request(server, "/health")[0], 200)

    def test_recording_outlives_viewers_and_close_flushes_without_closing_the_device(self):
        server, source = self.serve()
        stream = self.connect(server.url)
        started = stream.start_recording("unattended")
        stream.close()
        stream.close()
        for index in range(7):
            source.push(self.frames[index % 3])
        self.assertEqual(server.get_recording_status()["status"], "recording")
        server.close()
        server.close()
        self.assertEqual((source.closed, source.handlers), (False, []))
        self.assert_code("SERVER_CLOSED", server.start_recording, "late")
        self.assert_code("SERVER_CLOSED", server.stop_recording)
        with closing(RecordingStore(self.directory)) as store:
            saved, = store.list()
            self.assertEqual((saved["id"], saved["status"], saved["frame_count"]), (started["id"], "stopped", 7))

    def test_source_failures_end_the_recording_as_an_error(self):
        server, source = self.serve()
        errors, states = [], []
        stream = self.connect(server.url, on_error=errors.append)
        stream.on_recording(lambda recording: states.append(recording and recording["status"]))
        server.start_recording("callback failure is not a device failure")
        source.fail(ShroomError("handler failed", code="CALLBACK_FAILED", stage="callback", suggestion=""))
        source.push(self.frames[0])
        self.assertEqual(server.stop_recording()["status"], "stopped")
        started = server.start_recording("unplugged")
        source.push(self.frames[0])
        source.fail(ShroomError("device gone", code="DISCONNECTED", stage="read", suggestion=""))
        self.assertTrue(wait_until(lambda: (server.get_recording_status() or {}).get("status") == "error"))
        failed = server.stop_recording()
        self.assertEqual((failed["id"], failed["status"], failed["error"], failed["frame_count"]),
                         (started["id"], "error", {"code": "DISCONNECTED", "message": "device gone"}, 1))
        self.assertTrue(wait_until(lambda: [error.code for error in errors] == ["CALLBACK_FAILED", "DISCONNECTED"]))
        self.assertTrue(wait_until(lambda: "error" in states))
        self.assertEqual(http_request(server, f"/recordings/{started['id']}.jsonl")[0], 200)  # Partial data stays available.
        source.state = "reconnecting"
        self.assert_code("DISCONNECTED", server.start_recording, "while reconnecting")
        source.state = "open"
        self.assertEqual(server.start_recording("recovered")["status"], "recording")

    def test_unencodable_frames_are_reported_and_do_not_reach_viewers(self):
        server, source = self.serve()
        received, errors = [], []
        self.connect(server.url, on_data=received.append, on_error=errors.append)
        source.push({"rows": 1, "cols": 1})
        source.push(self.frames[0])
        self.assertTrue(wait_until(lambda: len(received) == 1 and len(errors) == 1))
        self.assertEqual((errors[0].code, received[0]), ("PARSE_FAILED", self.frames[0]))

    def test_busy_ports_fail_cleanly(self):
        server, _ = self.serve()
        other = self.directory.parent / "other"
        error = self.assert_code("SERVER_START_FAILED", serve_device, PushSource(), port=server.port, recordings_dir=other)
        self.assertEqual(error.stage, "serve")
        with closing(RecordingStore(other)) as store:  # The failed start released its directory lock.
            self.assertEqual(store.list(), [])
        self.assert_code("RECORDING_WRITE_FAILED", serve_device, PushSource(), port=0, recordings_dir=self.directory)

    def test_context_manager_and_default_port(self):
        with serve_device(PushSource(), port=0, recordings_dir=self.directory) as server:
            self.assertEqual(http_request(server, "/health")[0], 200)
            port = server.port
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=0.5).close()


class StreamLicenseTests(StreamCase):
    def setUp(self):
        super().setUp()
        clear_license()
        self.addCleanup(clear_license)
        self.frame = product_frames("hand", {}, 1)[0]

    def test_only_sdk_mock_devices_are_served_without_a_licence(self):
        for source in (PushSource({"source": "custom"}), PushSource({"source": "mock", "product": "hand"})):
            error = self.assert_code("LICENSE_REQUIRED", serve_device, source, port=0, recordings_dir=self.directory)
            self.assertIsInstance(error, PermissionError)
        self.assertFalse(self.directory.exists())
        device = create_product_mock_device("pad")
        self.closers.append(device.close)
        server, _ = self.serve(device)
        received = []
        stream = self.connect(server.url, on_data=received.append)
        self.assertEqual(stream.info["source"], "mock")
        stream.start_recording("mock recording")
        self.assertTrue(wait_until(lambda: len(received) >= 2))
        self.assertGreaterEqual(stream.stop_recording()["frame_count"], 1)

    def test_stream_and_recording_are_separate_features(self):
        activate_online_fixture(sdkFeatures=["serial"])
        self.assert_code("LICENSE_FEATURE_DENIED", serve_device, PushSource(), port=0, recordings_dir=self.directory)
        activate_online_fixture(sdkFeatures=["stream", "recording"])  # A custom source also needs serial access.
        self.assert_code("LICENSE_FEATURE_DENIED", serve_device, PushSource(), port=0, recordings_dir=self.directory)
        activate_online_fixture(sdkFeatures=["serial", "stream"])
        server, source = self.serve()
        received = []
        stream = self.connect(server.url, on_data=received.append)
        source.push(self.frame)
        self.assertTrue(wait_until(lambda: len(received) == 1))
        self.assert_code("LICENSE_FEATURE_DENIED", server.start_recording, "denied")
        self.assert_code("LICENSE_FEATURE_DENIED", stream.start_recording, "denied")
        self.assertIsNone(server.get_recording_status())

    def test_losing_the_licence_stops_new_data_but_keeps_recorded_data(self):
        activate_online_fixture()
        server, source = self.serve()
        received, errors = [], []
        stream = self.connect(server.url, on_data=received.append, on_error=errors.append)
        finished = server.start_recording("before")
        source.push(self.frame)
        server.stop_recording()
        active = server.start_recording("during")
        source.push(self.frame)
        self.assertTrue(wait_until(lambda: len(received) == 2))
        clear_license()
        self.assertTrue(wait_until(lambda: [error.code for error in errors] == ["LICENSE_REQUIRED"]))
        self.assertEqual(source.handlers, [])  # The service stopped listening to the device.
        self.assertTrue(wait_until(lambda: server.get_recording_status()["status"] == "error"))
        interrupted = server.stop_recording()
        self.assertEqual((interrupted["id"], interrupted["error"]["code"], interrupted["frame_count"]),
                         (active["id"], "LICENSE_REQUIRED", 1))
        for identifier in (finished["id"], active["id"]):
            self.assertEqual(http_request(server, f"/recordings/{identifier}.csv")[0], 200)
        self.assertEqual(len(stream.list_recordings()), 2)
        activate_online_fixture()
        with self.assertRaises(ShroomLicenseError):  # A new service is required after re-activation.
            server.start_recording("after")
        self.assertEqual(len(received), 2)


class StreamClientTests(StreamCase):
    def test_options_are_validated_before_connecting(self):
        port = free_port()
        for arguments, options in (((f"http://127.0.0.1:{port}",), {}), ((f"ws://user:pass@127.0.0.1:{port}",), {}),
                                   ((f"ws://127.0.0.1:{port}/#fragment",), {}), (("ws://127.0.0.1:99999",), {}),
                                   (("",), {}), ((), {"port": 0}), ((), {"port": "19999"}), ((), {"host": "ws://x"}),
                                   ((), {"host": "a b"}), ((f"ws://127.0.0.1:{port}",), {"timeout": 0}),
                                   ((f"ws://127.0.0.1:{port}",), {"timeout": 301}),
                                   ((f"ws://127.0.0.1:{port}",), {"on_data": "print"}),
                                   ((f"ws://127.0.0.1:{port}",), {"on_error": 5})):
            with self.subTest(arguments=arguments, options=options):
                self.assert_code("INVALID_CONFIG", connect_stream, *arguments, **options)
        error = self.assert_code("CONNECTION_FAILED", connect_stream, f"ws://127.0.0.1:{port}", timeout=0.5)
        self.assertEqual(error.stage, "stream")

    def test_handshake_failures_reject_the_connection(self):
        for script, code in ((lambda peer: peer.hold(), "CONNECTION_FAILED"),
                             (lambda peer: None, "DISCONNECTED"),
                             (lambda peer: peer.send({**READY, "schema": "shroom.frame.v2"}), "PARSE_FAILED"),
                             (lambda peer: peer.send({**READY, "info": None}), "PARSE_FAILED"),
                             (lambda peer: peer.send("[]"), "PARSE_FAILED"),
                             (lambda peer: peer.send({"type": "frame", "schema": "shroom.frame.v1", "frame": {}}), "PARSE_FAILED")):
            with self.subTest(code=code):
                errors = []
                server = self.fake(script)
                self.assert_code(code, connect_stream, server.url, timeout=0.3, on_error=errors.append)
                self.assertEqual(errors, [])  # A failed connect is raised, not also reported to the callback.

    def test_first_frame_arrives_and_bad_messages_do_not_end_the_stream(self):
        frame = product_frames("hand", {}, 1)[0]
        encoded = encode_stream_frame(frame)
        damaged = {**encoded, "pressure": encoded["pressure"][:-1]}

        def script(peer):
            peer.send(READY)
            peer.send({"type": "frame", "schema": "shroom.frame.v1", "frame": encoded})  # Immediately after ready.
            peer.send("not json")
            peer.send({"type": "frame", "schema": "shroom.frame.v0", "frame": encoded})
            peer.send({"type": "frame", "schema": "shroom.frame.v1", "frame": damaged})
            peer.send({"type": "error", "error": {"code": "DISCONNECTED", "message": "device unplugged"}})
            peer.send({"type": "unknown"})
            peer.send({"type": "frame", "schema": "shroom.frame.v1", "frame": encoded})
            peer.hold()
        received, errors, later = [], [], []

        def failing(data):
            raise RuntimeError("application bug")
        stream = self.connect(self.fake(script).url, on_data=received.append, on_error=errors.append)
        stream.on_data(failing)
        stream.on_frame(later.append)
        self.assertTrue(wait_until(lambda: len(received) == 2))
        self.assertEqual((received, stream.state, stream.info), ([frame, frame], "open", {"product": "hand", "baud_rate": 1000000}))
        codes = [error.code for error in errors]
        self.assertEqual([code for code in codes if code != "CALLBACK_FAILED"], ["PARSE_FAILED", "PARSE_FAILED", "PARSE_FAILED", "DISCONNECTED"])
        self.assertEqual({(error.code, error.stage) for error in errors},
                         {("PARSE_FAILED", "stream"), ("PARSE_FAILED", "parse"), ("DISCONNECTED", "stream"),
                          ("CALLBACK_FAILED", "callback")})
        self.assertEqual(len(later), codes.count("CALLBACK_FAILED"))  # The failing subscriber never blocked the next one.

    def test_requests_are_correlated_and_server_errors_keep_their_codes(self):
        recording = {"id": OTHER_ID, "label": "x", "startedAt": 1, "endedAt": None, "frameCount": 0, "status": "recording"}

        def script(peer):
            peer.send(READY)
            first = peer.receive()
            peer.send({"type": "response", "requestId": "someone-else", "ok": True, "result": None})
            peer.send({"type": "response", "requestId": first["requestId"], "ok": True, "result": {**recording, "label": first["label"]}})
            second = peer.receive()
            peer.send({"type": "response", "requestId": second["requestId"], "ok": False,
                       "error": {"code": "RECORDING_NOT_ACTIVE", "message": "当前没有录制任务。"}})
            third = peer.receive()
            peer.send({"type": "response", "requestId": third["requestId"], "ok": False, "error": "broken"})
            fourth = peer.receive()
            peer.send({"type": "recording", "recording": {**recording, "frameCount": 9}})
            peer.send({"type": "response", "requestId": fourth["requestId"], "ok": True, "result": [recording, "junk"]})
            peer.hold()
        stream = self.connect(self.fake(script).url)
        states = []
        stream.on_recording(states.append)
        started = stream.start_recording("  trimmed  ")
        self.assertEqual((started["label"], started["frame_count"], stream.recording["status"]), ("trimmed", 0, "recording"))
        error = self.assert_code("RECORDING_NOT_ACTIVE", stream.stop_recording)
        self.assertEqual(str(error), "当前没有录制任务。")
        self.assert_code("REQUEST_FAILED", stream.get_recording_status)
        self.assertEqual([meta["id"] for meta in stream.list_recordings()], [OTHER_ID])
        self.assertEqual((stream.recording["frame_count"], stream.state), (9, "open"))  # A list does not replace the status.
        for label in ("", "   ", None, "x" * 201):
            self.assert_code("INVALID_CONFIG", stream.start_recording, label)
        self.assertEqual([state["frame_count"] for state in states], [0, 9])
        with self.assertRaises(TypeError):
            stream.on_recording("print")

    def test_timeouts_do_not_pretend_the_server_did_nothing(self):
        def script(peer):
            peer.send(READY)
            ignored = peer.receive()
            status = peer.receive()
            peer.send({"type": "response", "requestId": ignored["requestId"], "ok": True, "result": {"id": OTHER_ID}})
            peer.send({"type": "response", "requestId": status["requestId"], "ok": True, "result": None})
            peer.hold()
        stream = self.connect(self.fake(script).url, timeout=0.2)
        self.assert_code("REQUEST_TIMEOUT", stream.start_recording, "slow")
        self.assertIsNone(stream.get_recording_status())  # The late answer to the first request is ignored.
        self.assertIsNone(stream.recording)

    def test_close_and_disconnect_settle_every_pending_request(self):
        release = Event()

        def script(peer):
            peer.send(READY)
            peer.receive()
            release.wait(5)
        errors, outcome = [], []
        stream = self.connect(self.fake(script).url, on_error=errors.append)

        def blocked():
            try:
                stream.stop_recording()
            except ShroomError as error:
                outcome.append(error.code)
        thread = Thread(target=blocked)
        thread.start()
        time.sleep(0.05)
        stream.close()
        thread.join(2)
        self.assertEqual((outcome, stream.state, errors), (["DISCONNECTED"], "closed", []))
        self.assert_code("DISCONNECTED", stream.stop_recording)
        release.set()

        def dropping(peer):
            peer.send(READY)
            peer.receive()
        dropped = self.connect(self.fake(dropping).url, on_error=errors.append)
        self.assert_code("DISCONNECTED", dropped.stop_recording)  # The server went away mid-request.
        self.assertTrue(wait_until(lambda: dropped.state == "closed" and len(errors) == 1))
        self.assertEqual(errors[0].code, "DISCONNECTED")

    def test_control_requests_are_refused_inside_callbacks(self):
        frame = encode_stream_frame(product_frames("hand", {}, 1)[0])

        def script(peer):
            peer.send(READY)
            peer.send({"type": "frame", "schema": "shroom.frame.v1", "frame": frame})
            peer.hold()
        outcome = []

        def on_data(data):
            try:
                stream_holder[0].stop_recording()
            except ShroomError as error:
                outcome.append(error.code)
        stream_holder = [None]
        ready = Event()

        def guarded(data):
            ready.wait(2)
            on_data(data)
        stream_holder[0] = self.connect(self.fake(script).url, on_data=guarded)
        ready.set()
        self.assertTrue(wait_until(lambda: outcome == ["INVALID_REQUEST"]))
