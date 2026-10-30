"""Serial diagnostics and failures exercised entirely with in-memory ports."""

import errno
from contextlib import redirect_stderr
from collections.abc import Sequence
from io import StringIO
import json
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from shroom_sdk import DEFAULT_DELIMITER, Framer, PortInfo, Shroom, ShroomError, decode_frame, get_layout
from shroom_sdk.__main__ import main
from license_fixture import LicensedTestCase


class MemoryPort:
    def __init__(self, chunks=()):
        self.chunks = list(chunks)
        self.is_open = True
        self.timeout = None
        self.read_error = self.write_error = self.close_error = None
        self.close_calls = 0

    @property
    def in_waiting(self):
        return len(self.chunks[0]) if self.chunks else 0

    def read(self, count):
        if self.read_error:
            raise self.read_error
        if not self.chunks:
            return b""
        chunk = self.chunks.pop(0)
        result = chunk[:count]
        if chunk[count:]:
            self.chunks.insert(0, chunk[count:])
        return result

    def write(self, data):
        if self.write_error:
            raise self.write_error
        return len(data)

    def close(self):
        self.close_calls += 1
        if self.close_error:
            raise self.close_error
        self.is_open = False


def serial_device(port=None, **options):
    port = port if port is not None else MemoryPort()
    module = SimpleNamespace(serial_for_url=Mock(return_value=port))
    with patch("shroom_sdk.device._serial_module", return_value=module):
        return Shroom.connect("memory-port", **options)


class ConfigurationTests(LicensedTestCase):
    def test_invalid_configuration_never_loads_or_opens_serial(self):
        cases = [
            {"baud_rate": value} for value in (True, 0, 1.5, "9600", None)
        ] + [
            {"delimiter": value} for value in (None, 1, "|", b"", bytes(65), [True], [256], [-1])
        ] + [
            {"min_length": 0}, {"max_length": 7}, {"max_length": 1_048_577},
            {"lock_length": 1}, {"lock_length": None}, {"rows": 2}, {"cols": 2},
            {"rows": True, "cols": 2}, {"rows": 1025, "cols": 1024},
            {"points": -1}, {"points": True}, {"points": 1_048_577},
            {"full_scale": "255"}, {"full_scale": None}, {"full_scale": True},
            {"full_scale": 10 ** 1000}, {"threshold": -1}, {"threshold": float("nan")},
            {"layout": False}, {"layout": 1}, {"layout": "typo"},
            {"layout": [0, 0, 1, 2]}, {"layout": [0, 1, 2, 3], "points": 3},
            {"layout": "mat32", "points": 100}, {"unsupported": 1},
        ]
        with patch("shroom_sdk.device._serial_module") as loader:
            for options in cases:
                with self.subTest(options=options), self.assertRaises(ShroomError) as caught:
                    Shroom.connect("memory-port", **options)
                self.assertIsInstance(caught.exception, ValueError)
                self.assertEqual((caught.exception.code, caught.exception.stage), ("INVALID_CONFIG", "configure"))
            for path in ("", "  ", 1, False):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    Shroom.connect(path)
            loader.assert_not_called()

    def test_timeout_validation_precedes_read(self):
        port = MemoryPort()
        device = serial_device(port)
        for timeout in (True, 0, -1, "1", float("inf"), float("nan")):
            with self.subTest(timeout=timeout), self.assertRaises(ShroomError) as caught:
                device.read_frame(timeout)
            self.assertEqual((caught.exception.code, caught.exception.stage), ("INVALID_CONFIG", "configure"))
        self.assertEqual(device.bytes_received, 0)
        self.assertEqual(device.state, "open")
        device.close()

    def test_supported_delimiter_and_layout_are_frozen(self):
        delimiter = bytearray(b"|")
        layout = [3, 2, 1, 0]
        device = serial_device(MemoryPort([b"|abcd|"]), delimiter=delimiter,
                               min_length=1, layout=layout)
        delimiter[0] = 0
        layout[:] = [0] * 4
        frame = device.read_frame()
        self.assertEqual(list(frame.values), list(decode_frame(b"abcd", layout=[3, 2, 1, 0]).values))
        device.close()

    def test_cli_validates_timeout_before_connect(self):
        output = StringIO()
        with patch("shroom_sdk.__main__.Shroom.connect") as connect, redirect_stderr(output):
            self.assertEqual(main(["memory-port", "--timeout", "0", "--frames", "1"]), 1)
        connect.assert_not_called()
        self.assertIn("INVALID_CONFIG/configure", output.getvalue())

    def test_mock_fps_timer_boundaries(self):
        minimum = 1000 / 2_147_483_647
        for fps in (5e-324, 1e-300, minimum / 2, 1000.1, 1e300):
            with self.subTest(fps=fps), self.assertRaises(ShroomError) as caught:
                Shroom.mock(fps=fps)
            self.assertEqual((caught.exception.code, caught.exception.stage), ("INVALID_CONFIG", "configure"))
        for fps in (minimum, 1000):
            with self.subTest(fps=fps), Shroom.mock(rows=1, cols=1, fps=fps) as device:
                self.assertIsNotNone(device.read_frame())

    def test_released_memoryview_configuration_is_structured_before_open(self):
        view = memoryview(b"|")
        view.release()
        calls = (lambda: Framer(delimiter=view), lambda: get_layout(view, 1, 1),
                 lambda: Shroom.connect("memory-port", delimiter=view),
                 lambda: Shroom.connect("memory-port", layout=view),
                 lambda: Shroom.connect("memory-port", rows=1, cols=1, layout=view))
        with patch("shroom_sdk.device._serial_module") as loader:
            for call in calls:
                with self.subTest(call=call), self.assertRaises(ShroomError) as caught:
                    call()
                self.assertEqual((caught.exception.code, caught.exception.stage), ("INVALID_CONFIG", "configure"))
                self.assertIsInstance(caught.exception, ValueError)
                self.assertIsInstance(caught.exception.__cause__, ValueError)
            loader.assert_not_called()

    def test_layout_size_is_rejected_before_iteration(self):
        class OversizedLayout(Sequence):
            def __len__(self):
                return 1_048_577

            def __getitem__(self, index):
                raise AssertionError("An invalid layout must not be copied")

        layout = OversizedLayout()
        with self.assertRaises(ShroomError) as caught:
            get_layout(layout, 1, 1)
        self.assertEqual(caught.exception.code, "INVALID_CONFIG")
        with patch("shroom_sdk.device._serial_module") as loader:
            for options in ({"layout": layout}, {"rows": 1, "cols": 1, "layout": layout}):
                with self.subTest(options=options), self.assertRaises(ShroomError):
                    Shroom.connect("memory-port", **options)
            loader.assert_not_called()

    def test_framer_accepts_strided_memoryview_and_wraps_released_views(self):
        framer = Framer(delimiter=memoryview(b"|x")[::2], min_length=1)
        self.assertEqual(framer.push(memoryview(b"|xaY|")[::2]), [b"a"])
        view = memoryview(b"|")
        view.release()
        for call in (lambda: framer.push(view), lambda: decode_frame(view)):
            with self.subTest(call=call), self.assertRaises(ShroomError) as caught:
                call()
            self.assertEqual((caught.exception.code, caught.exception.stage), ("PARSE_FAILED", "parse"))
            self.assertIsInstance(caught.exception.__cause__, ValueError)


class ErrorTests(LicensedTestCase):
    def test_connect_classification_and_cause(self):
        cases = [
            (FileNotFoundError(errno.ENOENT, "missing"), "PORT_NOT_FOUND"),
            (PermissionError(errno.EACCES, "denied"), "PERMISSION_DENIED"),
            (OSError(errno.EBUSY, "busy"), "PORT_BUSY"),
            (OSError("Port is already open"), "PORT_BUSY"),
            (RuntimeError("backend failed"), "CONNECTION_FAILED"),
        ]
        for original, code in cases:
            module = SimpleNamespace(serial_for_url=Mock(side_effect=original))
            with self.subTest(code=code), patch("shroom_sdk.device._serial_module", return_value=module):
                with self.assertRaises(ShroomError) as caught:
                    Shroom.connect("memory-port")
                error = caught.exception
                self.assertIsInstance(error, OSError)
                self.assertEqual((error.code, error.stage), (code, "connect"))
                self.assertIs(error.cause, original)
                self.assertIs(error.__cause__, original)
                self.assertEqual(error.details["path"], "memory-port")
                self.assertTrue(error.suggestion)
                json.dumps(error.to_dict())

    def test_enumeration_failures_and_sorted_metadata(self):
        module = ModuleType("serial.tools.list_ports")
        original = PermissionError(errno.EACCES, "cannot enumerate")
        module.comports = Mock(side_effect=original)
        with patch("shroom_sdk.device._serial_module"), patch.dict(
                "sys.modules", {"serial.tools.list_ports": module}):
            with self.assertRaises(ShroomError) as caught:
                Shroom.list_ports()
            self.assertEqual((caught.exception.code, caught.exception.stage), ("PERMISSION_DENIED", "query"))
            self.assertIs(caught.exception.__cause__, original)
            module.comports.side_effect = None
            module.comports.return_value = [SimpleNamespace(
                device=name, description="sensor", manufacturer="Shroom", serial_number="123",
                vid=1, pid=2) for name in ("COM2", "COM1")]
            ports = Shroom.list_ports()
            self.assertEqual([port.path for port in ports], ["COM1", "COM2"])
            self.assertEqual(ports[0].manufacturer, "Shroom")

    def test_missing_dependency_is_structured_and_importerror_compatible(self):
        with patch.dict("sys.modules", {"serial": None}):
            for call, stage in ((lambda: Shroom.connect("memory-port"), "connect"), (Shroom.list_ports, "query")):
                with self.subTest(stage=stage), self.assertRaises(ShroomError) as caught:
                    call()
                self.assertIsInstance(caught.exception, ImportError)
                self.assertEqual((caught.exception.code, caught.exception.stage), ("DEPENDENCY_MISSING", stage))
                self.assertIsInstance(caught.exception.__cause__, ImportError)

    def test_auto_selection_errors_are_query_failures(self):
        for names, code in (([], "PORT_NOT_FOUND"), (["COM1", "COM2"], "PORT_AMBIGUOUS")):
            ports = [PortInfo(name, None, None, None, None, None) for name in names]
            with self.subTest(code=code), patch("shroom_sdk.device._serial_module"), patch(
                    "shroom_sdk.device.list_ports", return_value=ports):
                with self.assertRaises(ShroomError) as caught:
                    Shroom.connect()
                self.assertIsInstance(caught.exception, OSError)
                self.assertEqual((caught.exception.code, caught.exception.stage), (code, "query"))
                if names:
                    self.assertIsInstance(caught.exception, ValueError)

    def test_read_write_and_disconnection_failures(self):
        for operation, original, code in (
                ("read", OSError("read backend failed"), "READ_FAILED"),
                ("read", OSError(errno.ENODEV, "gone"), "DISCONNECTED"),
                ("write", OSError("write backend failed"), "WRITE_FAILED"),
                ("write", OSError("device unplugged"), "DISCONNECTED")):
            port = MemoryPort()
            setattr(port, operation + "_error", original)
            device = serial_device(port)
            with self.subTest(operation=operation, code=code), self.assertRaises(ShroomError) as caught:
                device.read_frame() if operation == "read" else device.write(b"command")
            error = caught.exception
            self.assertEqual((error.code, error.stage), (code, operation))
            self.assertIs(error.__cause__, original)
            diagnostics = device.get_diagnostics()
            self.assertEqual((device.state, diagnostics["status"]), ("error", "error"))
            self.assertEqual(diagnostics["last_error"]["code"], code)
            device.close()
            self.assertTrue(device.closed)
            self.assertEqual(device.state, "error")
            self.assertEqual(device.get_diagnostics()["last_error"]["code"], code)
            with self.assertRaises(ShroomError):
                device.read_frame()
            self.assertEqual(device.get_diagnostics()["last_error"]["code"], code)

    def test_external_close_and_invalid_write(self):
        port = MemoryPort()
        device = serial_device(port)
        with self.assertRaises(ShroomError) as caught:
            device.write("command")
        self.assertEqual(caught.exception.code, "INVALID_CONFIG")
        port.is_open = False
        with self.assertRaises(ShroomError) as caught:
            device.read_frame()
        self.assertEqual(caught.exception.code, "DISCONNECTED")
        device.close()

    def test_close_failure_is_not_hidden_and_is_idempotent(self):
        port = MemoryPort()
        original = OSError("cannot close")
        port.close_error = original
        device = serial_device(port)
        with self.assertRaises(ShroomError) as caught:
            device.close()
        self.assertEqual((caught.exception.code, caught.exception.stage), ("CLOSE_FAILED", "close"))
        self.assertIs(caught.exception.__cause__, original)
        self.assertTrue(device.closed)
        self.assertEqual(device.state, "error")
        device.close()
        self.assertEqual(port.close_calls, 1)

    def test_context_preserves_business_error_and_reports_close_error(self):
        port = MemoryPort()
        port.close_error = OSError("close failure")
        device = serial_device(port)
        original = LookupError("business failure")
        with self.assertRaises(LookupError) as caught:
            with device:
                raise original
        self.assertIs(caught.exception, original)
        self.assertEqual(device.get_diagnostics()["last_error"]["code"], "CLOSE_FAILED")
        port = MemoryPort()
        port.close_error = OSError("close failure")
        with self.assertRaises(ShroomError) as caught:
            with serial_device(port):
                pass
        self.assertEqual(caught.exception.code, "CLOSE_FAILED")


class DiagnosticsTests(LicensedTestCase):
    def test_timeout_partial_invalid_and_streaming_diagnostics(self):
        port = MemoryPort()
        device = serial_device(port, delimiter=b"|", min_length=2, max_length=4)
        self.assertEqual(device.get_diagnostics()["status"], "waiting-data")
        self.assertIsNone(device.read_frame(timeout=0.001))
        self.assertEqual(device.get_diagnostics()["last_error"], None)
        port.chunks.append(b"noise|a|")
        self.assertIsNone(device.read_frame(timeout=0.001))
        diagnostics = device.get_diagnostics()
        self.assertEqual(diagnostics["status"], "waiting-frame")
        self.assertEqual(diagnostics["bytes_received"], 8)
        self.assertEqual(diagnostics["dropped_count"], 1)
        self.assertIn("异常帧", diagnostics["hint"])
        port.chunks.append(b"ab|cd|ef|")
        self.assertEqual(device.read_frame(timeout=None).raw, b"ab")
        self.assertEqual(device.frame_count, 3)
        self.assertEqual(device.frame_length, 2)
        self.assertEqual(device.bytes_received, 17)
        self.assertEqual(device.get_diagnostics()["status"], "streaming")
        self.assertEqual(device.read_frame().raw, b"cd")
        self.assertEqual(device.read_frame().raw, b"ef")
        self.assertEqual(device.frame_count, 3)
        with self.assertRaises(AttributeError):
            device.state = "closed"
        device.close()
        self.assertEqual(device.get_diagnostics()["status"], "closed")
        for call in (device.read_frame, lambda: device.write(b"x")):
            with self.assertRaises(ShroomError) as caught:
                call()
            self.assertIsInstance(caught.exception, RuntimeError)
            self.assertIsInstance(caught.exception, OSError)
            self.assertEqual(caught.exception.code, "DISCONNECTED")
        self.assertEqual(device.state, "closed")

    def test_parser_error_is_structured_counted_and_can_recover(self):
        wire = DEFAULT_DELIMITER + bytes(8) + DEFAULT_DELIMITER
        port = MemoryPort([wire])
        device = serial_device(port, layout="mat32")
        with self.assertRaises(ShroomError) as caught:
            device.read_frame()
        self.assertEqual((caught.exception.code, caught.exception.stage), ("PARSE_FAILED", "parse"))
        self.assertIsInstance(caught.exception.__cause__, ValueError)
        self.assertEqual(device.dropped_count, 1)
        port.chunks.append(bytes(1024) + DEFAULT_DELIMITER)
        self.assertEqual(device.read_frame().rows, 32)
        self.assertEqual(device.state, "open")
        self.assertEqual(device.get_diagnostics()["last_error"]["code"], "PARSE_FAILED")
        device.close()

    def test_mock_uses_same_schema_and_counts_generated_bytes(self):
        with Shroom.mock(rows=2, cols=3, fps=1) as device:
            before = device.get_diagnostics()
            self.assertEqual(before["status"], "waiting-data")
            self.assertEqual(before["frame_length"], 0)
            device.read_frame()
            diagnostics = device.get_diagnostics()
            self.assertEqual(set(before), set(diagnostics))
            self.assertEqual(diagnostics["source"], "mock")
            self.assertEqual((diagnostics["bytes_received"], diagnostics["frame_count"], diagnostics["frame_length"]), (6, 1, 6))
            self.assertEqual(diagnostics["status"], "streaming")
            diagnostics["state"] = "mutated snapshot"
            self.assertEqual(device.state, "open")
            self.assertIsNone(device.read_frame(timeout=0.001))
            self.assertEqual(device.frame_count, 1)
        self.assertEqual(device.get_diagnostics()["status"], "closed")
