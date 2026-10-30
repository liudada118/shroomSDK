import importlib.util
from itertools import islice
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch

from shroom_sdk import DEFAULT_DELIMITER, Shroom
from shroom_sdk.device import PortInfo
from license_fixture import LicensedTestCase


class MockTests(unittest.TestCase):
    def test_seed_context_and_iteration(self):
        with Shroom.mock(rows=4, cols=4, seed=7, fps=1000) as first, Shroom.mock(rows=4, cols=4, seed=7) as second:
            frame = first.read_frame()
            self.assertEqual(frame.raw, second.read_frame().raw)
            self.assertEqual(len(list(islice(first, 3))), 3)
            self.assertTrue(all(0 <= v <= 1 for v in frame.values))
        self.assertTrue(first.closed)
        first.close()
        with self.assertRaises(RuntimeError):
            first.read_frame()

    def test_timeout_does_not_generate_an_early_frame(self):
        with Shroom.mock(fps=1) as device:
            self.assertIsNotNone(device.read_frame())
            self.assertIsNone(device.read_frame(timeout=0.01))

    def test_bad_options(self):
        for options in ({"fps": 0}, {"fps": float("nan")}, {"rows": 0}, {"layout": "invalid"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                Shroom.mock(**options)

    def test_core_mock_and_cli_work_without_site_packages(self):
        source = str(Path(__file__).resolve().parents[1] / "src")
        code = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "from shroom_sdk.__main__ import main; "
            "raise SystemExit(main(['--frames', '2', '--json', '--rows', '2', '--cols', '2']))"
        )
        result = subprocess.run([sys.executable, "-S", "-c", code, source], capture_output=True, text=True, check=True)
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["rows"], 2)


class SerialErrorTests(LicensedTestCase):
    def test_validation_before_open(self):
        with patch("shroom_sdk.device._serial_module") as loader:
            with self.assertRaises(ValueError):
                Shroom.connect("COM1", full_scale=0)
            loader.assert_not_called()

    def test_missing_dependency_message(self):
        with patch.dict(sys.modules, {"serial": None}):
            with self.assertRaisesRegex(ImportError, "pip install pyserial"):
                Shroom.connect("COM1")

    def test_no_port_and_ambiguous_port(self):
        with patch("shroom_sdk.device._serial_module"), patch("shroom_sdk.device.list_ports", return_value=[]):
            with self.assertRaisesRegex(OSError, "No serial ports"):
                Shroom.connect()
        ports = [PortInfo(name, None, None, None, None, None) for name in ("COM1", "COM2")]
        with patch("shroom_sdk.device._serial_module"), patch("shroom_sdk.device.list_ports", return_value=ports):
            with self.assertRaisesRegex(ValueError, "Multiple serial ports"):
                Shroom.connect()

    def test_read_error_propagates_and_context_closes_port(self):
        port = Mock()
        port.in_waiting = 1
        port.read.side_effect = OSError("device unplugged")
        serial = Mock()
        serial.serial_for_url.return_value = port
        with patch("shroom_sdk.device._serial_module", return_value=serial):
            with self.assertRaisesRegex(OSError, "unplugged"):
                with Shroom.connect("COM1") as device:
                    device.read_frame()
        port.close.assert_called_once()
        self.assertTrue(device.closed)


@unittest.skipUnless(importlib.util.find_spec("serial"), "Install the [serial] extra for loopback tests")
class SerialLoopbackTests(LicensedTestCase):
    def test_batched_frames_counters_and_close(self):
        payload = bytes(range(16))
        wire = DEFAULT_DELIMITER + (payload + DEFAULT_DELIMITER) * 3
        with Shroom.connect("loop://") as device:
            device.write(wire)
            frames = [device.read_frame(timeout=1) for _ in range(3)]
            self.assertEqual([f.raw for f in frames], [payload] * 3)
            self.assertEqual(device.bytes_received, len(wire))
            self.assertEqual(device.frame_count, 3)
            self.assertEqual(device.frame_length, 16)
            self.assertEqual(device.dropped_count, 0)
            start = time.monotonic()
            self.assertIsNone(device.read_frame(timeout=0.02))
            self.assertLess(time.monotonic() - start, 0.5)
        self.assertTrue(device.closed)
        self.assertFalse(device._port.is_open)
        device.close()
        with self.assertRaises(RuntimeError):
            device.write(b"x")

    def test_partial_data_survives_timeout(self):
        payload = bytes(range(16))
        with Shroom.connect("loop://") as device:
            device.write(DEFAULT_DELIMITER[:2])
            self.assertIsNone(device.read_frame(timeout=0.01))
            device.write(DEFAULT_DELIMITER[2:] + payload + DEFAULT_DELIMITER)
            self.assertEqual(device.read_frame(timeout=1).raw, payload)

    def test_mat32_with_inferred_shape(self):
        with Shroom.connect("loop://", layout="mat32") as device:
            payload = bytearray(1024)
            payload[15 * 32] = 255
            device.write(DEFAULT_DELIMITER + payload + DEFAULT_DELIMITER)
            frame = device.read_frame(timeout=1)
            self.assertEqual(frame.values[0], 1)
            self.assertEqual(frame.center.x, 0)

    def test_dropped_frames_and_nondefault_delimiter(self):
        with Shroom.connect("loop://", delimiter=b"|", min_length=2, max_length=4) as device:
            device.write(b"noise|x|abcd|ab|")
            self.assertEqual(device.read_frame().raw, b"abcd")
            self.assertEqual(device.read_frame().raw, b"ab")
            self.assertEqual(device.dropped_count, 1)
