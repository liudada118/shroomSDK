"""BackendSdkClient against a local HTTP backend and a scripted WebSocket peer."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Event, Thread
import time
import unittest

from shroom_sdk import BackendError, BackendSdkClient
from shroom_sdk.backend_client import DEFAULT_HTTP_BASE_URL, DEFAULT_ROUTES, DEFAULT_WS_URL, normalize_http_result
from test_stream import FakeStreamServer, free_port, wait_until


class Backend:
    """Records every request and answers with whatever the test queued for that path."""

    def __init__(self):
        outer = self
        self.calls, self.responses, self.delay = [], {}, 0

        class Handler(BaseHTTPRequestHandler):
            def answer(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                outer.calls.append({"method": self.command, "path": self.path, "headers": dict(self.headers),
                                    "body": json.loads(body) if body else None})
                time.sleep(outer.delay)
                status, payload = outer.responses.get(self.path.split("?")[0], (200, {"code": 0, "data": ["ok"]}))
                data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass  # The client under test already gave up (timeout case).

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class BackendHttpTests(unittest.TestCase):
    def setUp(self):
        self.backend = Backend()
        self.addCleanup(self.backend.close)
        self.client = BackendSdkClient(http_base_url=self.backend.url, headers={"Authorization": "Bearer token"})

    def test_methods_keep_the_backend_payloads_and_raw_metadata(self):
        client, calls = self.client, self.backend.calls
        self.assertEqual(client.list_serial_ports(), ["ok"])
        client.get_serial_status("left hand")
        client.get_serial_status()
        client.get_current_sensor()
        client.set_sensor_type("hand0205")
        client.open_serial(path="COM3")
        client.open_serial(role="back", port="COM4", path="ignored")
        client.close_serial()
        client.start_collection({"name": "manual", "frequencyHz": 12})
        client.stop_collection()
        self.assertEqual(client.get_channels(), {"code": 0, "data": ["ok"]})
        client.get_ws_status()
        client.list_display_systems()
        client.get_display_system("hand/one")
        self.assertEqual([call["path"] for call in calls], [
            "/api/serial/ports", "/api/serial/status?role=left+hand", "/api/serial/status", "/api/sensor/current",
            "/api/sensor/type", "/api/serial/open", "/api/serial/open", "/api/serial/close", "/api/collection/start",
            "/api/collection/stop", "/api/channels", "/api/ws/status", "/api/display-systems",
            "/api/display-systems/hand%2Fone"])
        self.assertEqual([(call["method"], call["body"]) for call in calls[4:10]], [
            ("POST", {"type": "hand0205"}), ("POST", {"role": "sit", "port": "COM3"}),
            ("POST", {"role": "back", "port": "COM4"}), ("POST", {"role": "sit"}),
            ("POST", {"name": "manual", "frequencyHz": 12}), ("POST", {})])
        self.assertEqual((calls[0]["headers"]["Authorization"], calls[0]["headers"].get("Content-Type"),
                          calls[4]["headers"]["Content-Type"]), ("Bearer token", None, "application/json"))
        with self.assertRaisesRegex(ValueError, "requires a port"):
            client.open_serial()

    def test_requests_accept_paths_queries_headers_and_raw_results(self):
        client, calls = self.client, self.backend.calls
        self.backend.responses["/custom"] = (200, {"plain": True})
        self.assertEqual(client.request("/custom", query={"a": 1, "skip": None, "名称": "左 手"},
                                        headers={"X-Trace": "7", "Authorization": "Bearer other"}), {"plain": True})
        self.assertEqual(calls[-1]["path"], "/custom?a=1&%E5%90%8D%E7%A7%B0=%E5%B7%A6+%E6%89%8B")
        self.assertEqual((calls[-1]["headers"]["X-Trace"], calls[-1]["headers"]["Authorization"]), ("7", "Bearer other"))
        self.assertEqual(client.request("serialPorts", raw=True), {"code": 0, "data": ["ok"]})
        client.request("/custom", method="POST", body=None)  # An explicit null body is still sent.
        self.assertEqual((calls[-1]["method"], calls[-1]["headers"]["Content-Length"]), ("POST", "4"))
        self.assertEqual(client.route("displaySystemById", {"id": "a b/c"}), "/api/display-systems/a%20b%2Fc")
        for arguments in (("unknownRoute",), ("displaySystemById",)):
            with self.assertRaises(BackendError):
                client.route(*arguments)

    def test_contract_is_cached_refreshed_and_never_overrides_explicit_routes(self):
        contract = {"contractVersion": "1", "http": {"routes": {"serialStatus": "/new/status", "serialPorts": "/new/ports"}},
                    "websocket": {"messageTypes": {"SUBSCRIBE": "sub", "UNSUBSCRIBE": "unsub"}}}
        client = BackendSdkClient(http_base_url=self.backend.url, routes={"serialPorts": "/custom/ports"})
        self.backend.responses["/api/sdk/contract"] = (200, {"code": 0, "data": contract})
        self.assertEqual((client.get_contract(), client.get_contract(), len(self.backend.calls)), (contract, contract, 1))
        self.backend.responses["/api/sdk/contract"] = (200, contract)  # A backend may also answer without the envelope.
        self.assertEqual((client.get_contract(refresh=True), len(self.backend.calls)), (contract, 2))
        self.assertEqual((client.routes["serialStatus"], client.routes["serialPorts"], client.routes["channels"]),
                         ("/new/status", "/custom/ports", "/api/channels"))
        self.backend.responses["/api/sdk/contract"] = (200, {"code": 0, "data": ["not", "an", "object"]})
        with self.assertRaisesRegex(BackendError, "Invalid backend contract"):
            client.get_contract(refresh=True)
        preset = BackendSdkClient(contract=contract)
        self.assertEqual((preset.get_contract(), preset.routes["serialStatus"]), (contract, "/new/status"))
        self.assertEqual((DEFAULT_ROUTES["serialOpen"], DEFAULT_HTTP_BASE_URL, DEFAULT_WS_URL),
                         ("/api/serial/open", "http://127.0.0.1:19245", "ws://127.0.0.1:19999"))

    def test_failures_are_explicit(self):
        client, responses = self.client, self.backend.responses
        responses["/api/serial/ports"] = (200, {"code": 7, "message": "sensor busy"})
        with self.assertRaisesRegex(BackendError, "sensor busy"):
            client.list_serial_ports()
        with self.assertRaisesRegex(BackendError, "sensor busy"):
            client.request("serialPorts", raw=True)  # raw keeps the envelope but still reports business errors.
        responses["/api/serial/ports"] = (200, {"code": 3})
        with self.assertRaisesRegex(BackendError, "Backend error 3"):
            client.list_serial_ports()
        responses["/api/serial/ports"] = (503, {"error": "starting"})
        with self.assertRaises(BackendError) as caught:
            client.list_serial_ports()
        self.assertEqual((str(caught.exception), caught.exception.status), ("starting", 503))
        responses["/api/serial/ports"] = (502, b"<html>bad gateway</html>")
        with self.assertRaisesRegex(BackendError, "HTTP 502: backend returned non-JSON data"):
            client.list_serial_ports()
        responses["/api/serial/ports"] = (200, b"{broken")
        with self.assertRaisesRegex(BackendError, "invalid JSON"):
            client.list_serial_ports()
        responses["/api/serial/ports"] = (200, b"")
        self.assertIsNone(client.list_serial_ports())
        self.assertEqual((normalize_http_result({"code": 0, "data": 0}), normalize_http_result([1]), normalize_http_result(None)),
                         (0, [1], None))

    def test_timeouts_and_unreachable_backends(self):
        self.backend.delay = 0.5
        with self.assertRaisesRegex(BackendError, "timed out"):
            self.client.request("serialPorts", timeout=0.05)
        self.backend.delay = 0
        self.assertEqual(self.client.list_serial_ports(), ["ok"])
        unreachable = BackendSdkClient(http_base_url=f"http://127.0.0.1:{free_port()}", timeout=0.5)
        with self.assertRaises(BackendError):
            unreachable.list_serial_ports()

    def test_configuration_and_routes_are_validated_before_networking(self):
        for options in ({"http_base_url": "ftp://x"}, {"http_base_url": "http://user:pw@x"}, {"http_base_url": "http://x?a=1"},
                        {"http_base_url": "http://x#f"}, {"ws_url": "http://x"}, {"ws_url": "ws://x:99999"},
                        {"timeout": 0}, {"timeout": -1}, {"timeout": "10"}, {"timeout": float("inf")}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                BackendSdkClient(**options)
        self.assertEqual(BackendSdkClient(http_base_url="https://backend.example/base/").http_base_url, "https://backend.example/base")
        client = BackendSdkClient(http_base_url=self.backend.url, routes={"serialPorts": "https://evil.example/x",
                                                                        "serialStatus": "//evil.example/x"})
        for route in ("serialPorts", "serialStatus", "/a\\b"):
            with self.subTest(route=route), self.assertRaisesRegex(ValueError, "root-relative"):
                client.request(route)
        with self.assertRaises(ValueError):
            client.request("/x", timeout=0)
        self.assertEqual(self.backend.calls, [])


class BackendRealtimeTests(unittest.TestCase):
    def setUp(self):
        self.messages = []
        self.closers = []
        self.addCleanup(lambda: [close() for close in reversed(self.closers)])

    def peer(self, script):
        server = FakeStreamServer(script)
        self.closers.append(server.close)
        return server

    def client(self, url, **options):
        client = BackendSdkClient(ws_url=url, **options)
        self.closers.append(client.disconnect_realtime)
        events = []
        for name in ("open", "close", "error", "message", "frame", "raw"):
            client.on(name, lambda *args, name=name: events.append((name, *args)))
        return client, events

    def test_subscriptions_use_contract_names_and_queue_until_open(self):
        received, gate = [], Event()

        def script(peer):
            gate.wait(5)
            for _ in range(4):
                received.append(peer.receive())
            peer.hold()
        contract = {"websocket": {"messageTypes": {"SUBSCRIBE": "sub", "UNSUBSCRIBE": "unsub"}}}
        client, events = self.client(self.peer(script).url, contract=contract)
        with self.assertRaisesRegex(BackendError, "not connected"):
            client.subscribe("pressure")
        client.connect_realtime(["pressure", "pressure"])
        client.connect_realtime("imu")  # Joins the connection that is still opening.
        self.assertTrue(wait_until(lambda: client.realtime_state == "open"))
        self.assertTrue(wait_until(lambda: ("open",) in events))
        client.connect_realtime(["status"])  # Reuses the open connection.
        client.subscribe("extra")
        client.unsubscribe(["pressure", "imu"])
        gate.set()
        self.assertTrue(wait_until(lambda: len(received) == 4))
        self.assertEqual(received, [{"type": "sub", "channels": ["pressure", "imu"]}, {"type": "sub", "channels": ["status"]},
                                    {"type": "sub", "channels": ["extra"]}, {"type": "unsub", "channels": ["pressure", "imu"]}])
        for channels in ("", [""], [1], None, {"a": 1}):
            with self.subTest(channels=channels), self.assertRaises(ValueError):
                client.subscribe(channels)
        with self.assertRaises(ValueError):
            client.connect_realtime(timeout=0)

    def test_frames_batches_metadata_and_raw_text_are_passed_through_unchanged(self):
        def script(peer):
            peer.send({"frames": [{"channelId": "a", "value": [1, 2]}, {"channelId": "b", "value": 0}]})
            peer.send({"channelId": "c", "value": 0})
            peer.send({"portId": "COM3", "data": "raw-from-backend"})
            peer.send({"type": "status", "ok": True})
            peer.send("plain text")
            peer.send("[1, 2]")
            peer.hold()
        client, events = self.client(self.peer(script).url)
        client.connect_realtime()
        self.assertTrue(wait_until(lambda: sum(1 for event in events if event[0] in ("message", "raw")) == 6))
        self.assertEqual([event[1] for event in events if event[0] == "frame"],
                         [{"channelId": "a", "value": [1, 2]}, {"channelId": "b", "value": 0}, {"channelId": "c", "value": 0},
                          {"portId": "COM3", "data": "raw-from-backend"}])
        self.assertEqual([event[1] for event in events if event[0] == "raw"], ["plain text"])
        self.assertEqual([event[1] for event in events if event[0] == "message"][3:], [{"type": "status", "ok": True}, [1, 2]])
        self.assertEqual(events[0], ("open",))

    def test_disconnect_and_remote_close_are_reported_once(self):
        def script(peer):
            peer.send({"type": "hello"})
            peer.hold()
        client, events = self.client(self.peer(script).url)
        client.connect_realtime()
        self.assertTrue(wait_until(lambda: any(event[0] == "message" for event in events)))
        client.disconnect_realtime()
        client.disconnect_realtime()
        self.assertEqual((client.realtime_state, [event for event in events if event[0] == "close"]),
                         ("closed", [("close", {"code": 1000, "reason": "client disconnect", "was_clean": False})]))
        with self.assertRaisesRegex(BackendError, "not connected"):
            client.send_realtime({"type": "ping"})
        remote, remote_events = self.client(self.peer(lambda peer: peer.send({"type": "bye"})).url)
        remote.connect_realtime()
        self.assertTrue(wait_until(lambda: any(event[0] == "close" for event in remote_events)))
        self.assertEqual((remote.realtime_state, [event[0] for event in remote_events]), ("closed", ["open", "message", "close"]))
        remote.connect_realtime()  # A closed client can connect again.
        self.assertTrue(wait_until(lambda: [event[0] for event in remote_events].count("open") == 2))

    def test_failed_connections_report_an_error_and_allow_a_retry(self):
        client, events = self.client(f"ws://127.0.0.1:{free_port()}", timeout=0.5)
        client.connect_realtime(["pressure"])
        self.assertTrue(wait_until(lambda: [event[0] for event in events] == ["error", "close"], timeout=5))
        self.assertIsInstance(events[0][1], BackendError)
        self.assertEqual((client.realtime_state, events[1][1]["code"]), ("closed", 1006))
        client.connect_realtime()
        self.assertTrue(wait_until(lambda: [event[0] for event in events].count("error") == 2, timeout=5))

    def test_listeners_can_be_added_once_removed_and_cannot_break_the_receiver(self):
        client = BackendSdkClient()
        seen = []
        handler = lambda *args: seen.append(args)
        self.assertIs(client.on("frame", handler).once("frame", handler), client)
        client.emit("frame", 1)
        client.emit("frame", 2)
        self.assertEqual(seen, [(1,), (1,), (2,)])
        client.off("frame", handler)
        client.once("frame", handler).off("frame", handler)  # once() wrappers are removed by the original handler.
        client.emit("frame", 3)
        client.on("frame", handler).on("raw", handler).remove_all_listeners("frame").emit("frame", 4)
        client.remove_all_listeners().emit("raw", 5)
        self.assertEqual(len(seen), 3)
        for bad in (None, "handler"):
            with self.assertRaises(TypeError):
                client.on("frame", bad)
        with self.assertRaises(TypeError):
            client.once("frame", None)

        def script(peer):
            peer.send({"channelId": "a", "value": 1})
            peer.send({"channelId": "b", "value": 2})
            peer.hold()
        live, events = self.client(self.peer(script).url)
        live.on("frame", lambda frame: 1 / 0)
        live.connect_realtime()
        self.assertTrue(wait_until(lambda: [event[0] for event in events].count("error") == 2))
        self.assertEqual([event[1]["channelId"] for event in events if event[0] == "frame"], ["a", "b"])
        self.assertIsInstance([event for event in events if event[0] == "error"][0][1], ZeroDivisionError)
