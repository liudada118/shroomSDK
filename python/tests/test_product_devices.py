"""Product connections, callbacks, bounded reconnection and licence enforcement on fake ports."""

import errno
import importlib.util
import threading
import time
import unittest
from unittest.mock import patch

from shroom_sdk import (DEFAULT_DELIMITER, GloveFrame, PadFrame, PortInfo, Shroom, ShroomError, ShroomLicenseError,
                        clear_license, connect, connect_glove, connect_hand_pad, connect_product,
                        create_product_mock_device)
from shroom_sdk import _serial_path
from shroom_sdk.device import SerialDevice
from shroom_sdk.product_device import ManagedSerialDevice, reconnect_policy
from license_fixture import LicensedTestCase, activate_online_fixture
from product_fixture import TAIL, full_packet, segmented_pair
from test_reliability import MemoryPort, serial_device

RAMP = bytes(range(256))
PAD = bytes(range(256)) * 4 + TAIL


def wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class ScriptPort(MemoryPort):
    """Delivers queued chunks, then idles or fails like an unplugged adapter."""

    def __init__(self, chunks=(), fail=None):
        super().__init__(chunks)
        self.fail = fail

    @property
    def in_waiting(self):
        if not self.chunks and self.fail:
            raise self.fail
        return super().in_waiting

    def read(self, count):
        if not self.chunks:
            if self.fail:
                raise self.fail
            time.sleep(0.001)  # A real port blocks for its timeout instead of spinning.
        return super().read(count)


class FakeSerial:
    """Stands in for the pySerial module: hands out scripted ports in order."""

    def __init__(self, *ports):
        self.ports = list(ports)
        self.calls = []

    def serial_for_url(self, path, **options):
        self.calls.append((path, options))
        if not self.ports:
            raise OSError(errno.ENOENT, "could not open port: no such file")
        port = self.ports.pop(0)
        if isinstance(port, Exception):
            raise port
        return port


def product(serial, *args, **options):
    with patch("shroom_sdk.product_device._serial_module", return_value=serial):
        return connect_product(*args, **options)


def reset_reservations(test):
    """Paths are process-wide; a test that leaves a port stuck must not affect the next one."""
    _serial_path._reservations.clear()
    test.addCleanup(_serial_path._reservations.clear)


class ProductConnectionTests(LicensedTestCase):
    def setUp(self):
        super().setUp()
        reset_reservations(self)

    def test_configuration_is_rejected_before_any_hardware_access(self):
        cases = ((("unknown", "COM1"), {}), (("handGloveFullPacket", "COM1"), {}), (("glove", "COM1"), {"side": "both"}),
                 (("pad", "COM1"), {"side": "left"}), (("glove", "COM1"), {"side": "left", "baud_rate": 115200}),
                 (("insole", "COM1"), {"side": "left", "protocol": "10bit"}), (("glove", ""), {"side": "left"}),
                 (("glove", "COM1"), {"side": "left", "on_data": "print"}),
                 (("glove", "COM1"), {"side": "left", "reconnect": "yes"}),
                 (("glove", "COM1"), {"side": "left", "reconnect": {"interval": 0}}),
                 (("glove", "COM1"), {"side": "left", "reconnect": {"max_attempts": 0}}),
                 (("glove", "COM1"), {"side": "left", "reconnect": {"retries": 3}}),
                 (("glove", "COM1"), {"side": "left", "rows": 13}))
        for arguments, options in cases:
            with self.subTest(arguments=arguments, options=options), patch(
                    "shroom_sdk.product_device._serial_module") as loader:
                with self.assertRaises(ValueError) as caught:
                    connect_product(*arguments, **options)
                self.assertEqual(caught.exception.code, "INVALID_CONFIG")
                loader.assert_not_called()

    def test_port_selection_never_guesses_between_several_ports(self):
        ports = [PortInfo(name, None, None, None, None, None) for name in ("COM3", "COM4")]
        with patch("shroom_sdk.product_device._serial_module"), patch("shroom_sdk.product_device.list_ports", return_value=[]):
            with self.assertRaises(ShroomError) as caught:
                connect_hand_pad()
            self.assertEqual((caught.exception.code, caught.exception.stage), ("PORT_NOT_FOUND", "query"))
        with patch("shroom_sdk.product_device._serial_module"), patch("shroom_sdk.product_device.list_ports", return_value=ports):
            with self.assertRaises(ShroomError) as caught:
                connect_hand_pad()
            self.assertEqual((caught.exception.code, caught.exception.details["ports"]), ("PORT_AMBIGUOUS", ["COM3", "COM4"]))
        serial = FakeSerial(ScriptPort())
        with patch("shroom_sdk.product_device.list_ports", return_value=ports[:1]):
            with product(serial, "pad") as device:
                self.assertEqual(device.info["path"], "COM3")

    def test_product_fixes_the_protocol_and_delivers_parsed_frames(self):
        serial = FakeSerial(ScriptPort([segmented_pair(RAMP, 4), segmented_pair(RAMP, 4)]))
        with patch("shroom_sdk.product_device._serial_module", return_value=serial):
            device = connect_glove("COM7", side="left")
        with device:
            self.assertIsInstance(device, ManagedSerialDevice)
            self.assertEqual(serial.calls[0][0], "COM7")
            self.assertEqual(serial.calls[0][1]["baudrate"], 921600)
            self.assertEqual({key: device.info[key] for key in ("source", "path", "baud_rate", "product", "side", "protocol", "rows", "cols")},
                             {"source": "python-serial", "path": "COM7", "baud_rate": 921600, "product": "handGloveSegmented",
                              "side": "left", "protocol": "segmented", "rows": 13, "cols": 15})
            first, second = device.read_frame(1), device.read_frame(1)
            self.assertIsInstance(first, GloveFrame)
            self.assertEqual((first.pressure, second.packet_type), (RAMP, 4))
            self.assertIsNone(device.read_frame(0.01))
            diagnostics = device.get_diagnostics()
            self.assertEqual((diagnostics["status"], diagnostics["frame_count"], diagnostics["bytes_received"],
                              diagnostics["frame_length"], diagnostics["dropped_count"], diagnostics["reconnect_attempt"],
                              diagnostics["reconnect_max_attempts"]), ("streaming", 2, 568, 276, 0, 0, 3))
        self.assertEqual((device.state, device.get_diagnostics()["status"]), ("closed", "closed"))

    def test_other_products_use_their_own_serial_settings(self):
        cases = ((("handGloveFullPacket", "COM1"), {"side": "right"}, 921600, full_packet(RAMP, 9)),
                 (("hand", "COM1"), {}, 1000000, PAD), (("body", "COM1"), {}, 1000000, PAD),
                 (("insole", "COM1"), {"side": "left", "baud_rate": 460800, "protocol": "8bit"}, 460800, b""))
        for arguments, options, baud_rate, data in cases:
            with self.subTest(arguments[0]):
                serial = FakeSerial(ScriptPort([data] if data else []))
                with product(serial, *arguments, **options) as device:
                    self.assertEqual(serial.calls[0][1]["baudrate"], baud_rate)
                    if data:
                        self.assertEqual(device.read_frame(1).product, device.info["product"])
        self.assertEqual(device.info["bit_depth"], 8)

    def test_callbacks_receive_the_first_frame_and_isolate_application_errors(self):
        frames, errors, states = [], [], []
        port = ScriptPort([PAD])
        serial = FakeSerial(port)
        # Data is already waiting when the callback is registered: the first frame must not be lost.
        device = product(serial, "pad", "COM1", on_data=frames.append, on_error=errors.append,
                         on_state_change=states.append)
        self.assertTrue(wait_until(lambda: len(frames) == 1))
        self.assertIsInstance(frames[0], PadFrame)
        extra = []
        device.on_data(lambda frame: 1 / 0)
        unsubscribe = device.on_frame(extra.append)
        port.chunks.extend([PAD, PAD])
        self.assertTrue(wait_until(lambda: len(frames) == 3 and len(errors) == 2))
        # One failing subscriber neither stops the others nor ends the connection.
        self.assertEqual(([error.code for error in errors], len(extra), device.state), (["CALLBACK_FAILED"] * 2, 2, "open"))
        unsubscribe()
        device.close()
        device.close()
        self.assertEqual(([state["state"] for state in states], device.state), (["open", "closed"], "closed"))
        self.assertFalse(any(thread.name == "shroom-device-reader" for thread in threading.enumerate()))
        self.assertEqual(serial.calls[0][0], "COM1")
        with self.assertRaises(TypeError):
            device.on_data("print")

    def test_unexpected_disconnect_reopens_the_same_path_and_keeps_subscriptions(self):
        unplugged = OSError("ClearCommError failed (PermissionError(13, 'Access is denied.', None, 5))")
        first, second = ScriptPort([PAD], fail=unplugged), ScriptPort([PAD[:500], PAD[500:] + PAD])
        serial = FakeSerial(first, second)
        frames, errors, states = [], [], []
        device = product(serial, "pad", "COM9", on_data=frames.append, on_error=errors.append,
                         on_state_change=states.append, reconnect={"interval": 0.02, "max_attempts": 2})
        self.assertTrue(wait_until(lambda: len(frames) == 3), (len(frames), errors, states))
        self.assertEqual([call[0] for call in serial.calls], ["COM9", "COM9"])
        self.assertEqual([(state["state"], state["attempt"]) for state in states],
                         [("open", 0), ("reconnecting", 0), ("reconnecting", 1), ("open", 1), ("open", 0)])
        self.assertEqual(([error.code for error in errors], first.is_open), (["DISCONNECTED"], False))
        diagnostics = device.get_diagnostics()
        self.assertEqual((device.state, diagnostics["frame_count"], diagnostics["status"], diagnostics["reconnect_attempt"]),
                         ("open", 3, "streaming", 0))
        device.close()
        self.assertFalse(second.is_open)

    def test_reconnecting_is_visible_and_a_half_frame_never_crosses_connections(self):
        first = ScriptPort([segmented_pair(RAMP)[:134]], fail=OSError(errno.ENODEV, "gone"))
        second = ScriptPort([segmented_pair(RAMP)[134:]])
        serial = FakeSerial(first, second)
        # Without an error subscriber the intermediate failure is logged instead of being silent.
        with self.assertLogs("shroom_sdk", level="ERROR") as logs, product(
                serial, "glove", "COM1", side="left", reconnect={"interval": 0.05}) as device:
            self.assertIsNone(device.read_frame(0.02))
            self.assertEqual((device.state, device.get_diagnostics()["status"]), ("reconnecting", "reconnecting"))
            self.assertIsNone(device.read_frame(0.3))  # The tail alone must not pair with the old head.
            diagnostics = device.get_diagnostics()
            self.assertEqual((device.state, diagnostics["status"], diagnostics["frame_count"]), ("open", "waiting-frame", 0))
            self.assertEqual(diagnostics["dropped_count"], 1)  # Only the orphan tail; the reset head is not replayed.
        self.assertIn("DISCONNECTED", logs.output[0])

    def test_retries_stop_after_the_limit_and_report_the_final_error_once(self):
        gone = OSError(errno.ENODEV, "gone")
        serial = FakeSerial(ScriptPort(fail=gone), OSError(errno.ENOENT, "no such file"), OSError(errno.ENOENT, "no such file"))
        errors, states = [], []
        device = product(serial, "pad", "COM1", on_error=errors.append, on_state_change=states.append,
                         reconnect={"interval": 0.01, "max_attempts": 2})
        with self.assertRaises(OSError) as caught:
            for _ in range(200):
                device.read_frame(0.05)
        self.assertEqual((caught.exception.code, len(serial.calls), device.state, device.closed),
                         ("PORT_NOT_FOUND", 3, "error", True))
        self.assertEqual([error.code for error in errors], ["DISCONNECTED", "PORT_NOT_FOUND", "PORT_NOT_FOUND"])
        self.assertEqual(states[-1], {"state": "error", "path": "COM1", "attempt": 2, "max_attempts": 2})
        with self.assertRaises(OSError) as again:
            device.read_frame(0.05)
        self.assertIs(again.exception, caught.exception)
        self.assertEqual(device.get_diagnostics()["last_error"]["code"], "PORT_NOT_FOUND")
        device.close()

    def test_disabled_reconnect_and_unrecoverable_errors_end_the_connection(self):
        serial = FakeSerial(ScriptPort(fail=OSError(errno.ENODEV, "gone")))
        with self.assertRaises(OSError) as caught:
            with product(serial, "pad", "COM1", reconnect=False) as device:
                device.read_frame(1)
        self.assertEqual((caught.exception.code, len(serial.calls), device.state), ("DISCONNECTED", 1, "error"))
        denied = FakeSerial(ScriptPort(fail=OSError(errno.ENODEV, "gone")), PermissionError(errno.EACCES, "denied"))
        device = product(denied, "pad", "COM1", reconnect={"interval": 0.01})
        with self.assertLogs("shroom_sdk", level="ERROR"), self.assertRaises(OSError) as caught:
            for _ in range(100):
                device.read_frame(0.05)
        self.assertEqual((caught.exception.code, len(denied.calls)), ("PERMISSION_DENIED", 2))

    def test_first_connection_failure_is_raised_without_background_retries(self):
        serial = FakeSerial(OSError(errno.ENOENT, "no such file"), ScriptPort())
        with self.assertRaises(OSError) as caught:
            product(serial, "pad", "COM1", reconnect={"interval": 0.01})
        self.assertEqual((caught.exception.code, caught.exception.stage), ("PORT_NOT_FOUND", "connect"))
        time.sleep(0.05)
        self.assertEqual(len(serial.calls), 1)

    def test_close_cancels_a_pending_reconnect(self):
        serial = FakeSerial(ScriptPort(fail=OSError(errno.ENODEV, "gone")), ScriptPort())
        states = []
        device = product(serial, "pad", "COM1", on_data=lambda frame: None, on_error=lambda error: None,
                         on_state_change=states.append, reconnect={"interval": 30})
        self.assertTrue(wait_until(lambda: device.state == "reconnecting"))
        started = time.monotonic()
        device.close()
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual((device.state, len(serial.calls), states[-1]["state"]), ("closed", 1, "closed"))
        with self.assertRaises(RuntimeError):
            device.read_frame(0.01)

    def test_close_failure_is_reported_and_writes_are_never_retried(self):
        port = ScriptPort()
        port.close_error = OSError("driver refused to close")
        device = product(FakeSerial(port), "pad", "COM1")
        self.assertEqual(device.write(b"\x01\x02"), 2)
        with self.assertRaises(ValueError):
            device.write("text")
        port.write_error = OSError("device unplugged")
        with self.assertRaises(OSError) as caught:
            device.write(b"\x01")
        self.assertEqual(caught.exception.code, "DISCONNECTED")
        with self.assertRaises(OSError) as closing:
            device.close()
        self.assertEqual((closing.exception.code, device.state, port.close_calls), ("CLOSE_FAILED", "error", 1))
        # The driver still holds the port, so its path stays reserved and nothing else may open it.
        with self.assertRaises(OSError) as busy:
            product(FakeSerial(ScriptPort()), "pad", "COM1")
        self.assertEqual(busy.exception.code, "PORT_BUSY")
        with self.assertRaises(OSError):
            device.close()  # Calling close again retries the release.
        self.assertEqual(port.close_calls, 2)
        port.close_error = None
        device.close()
        self.assertEqual((port.close_calls, port.is_open), (3, False))
        device.close()
        self.assertEqual(port.close_calls, 3)  # Idempotent once the port is released.
        with product(FakeSerial(ScriptPort()), "pad", "COM1") as again:
            self.assertEqual(again.state, "open")

    def test_generic_serial_reconnect_is_opt_in(self):
        wire = DEFAULT_DELIMITER + (bytes(range(16)) + DEFAULT_DELIMITER) * 2
        with serial_device() as plain:
            self.assertIs(type(plain), SerialDevice)
        serial = FakeSerial(ScriptPort([wire], fail=OSError(errno.ENODEV, "gone")), ScriptPort([wire]))
        states = []
        with patch("shroom_sdk.product_device._serial_module", return_value=serial):
            device = connect("COM2", reconnect={"interval": 0.01}, on_state_change=states.append, rows=4, cols=4)
        with self.assertLogs("shroom_sdk", level="ERROR"), device:
            self.assertIsInstance(device, ManagedSerialDevice)
            self.assertEqual(serial.calls[0][1]["baudrate"], 1_000_000)
            frames, deadline = [], time.monotonic() + 5
            while len(frames) < 4 and time.monotonic() < deadline:
                frame = device.read_frame(0.2)  # None while the port is being reopened.
                if frame is not None:
                    frames.append(frame)
            self.assertEqual([(frame.rows, frame.raw) for frame in frames], [(4, bytes(range(16)))] * 4)
            self.assertEqual(len(serial.calls), 2)
        self.assertEqual((reconnect_policy(None).enabled, reconnect_policy(None, True).enabled,
                          reconnect_policy(True).max_attempts, reconnect_policy({"interval": 1}).interval),
                         (False, True, 3, 1.0))
        with self.assertRaises(ValueError), patch("shroom_sdk.product_device._serial_module") as loader:
            connect("COM2", reconnect=True, full_scale=0)
        loader.assert_not_called()

    def test_plain_serial_devices_also_support_callbacks(self):
        wire = DEFAULT_DELIMITER + (bytes(range(16)) + DEFAULT_DELIMITER) * 3
        port = ScriptPort([wire])
        frames, errors = [], []
        device = serial_device(port)
        device.on_error(errors.append)
        device.on_frame(frames.append)
        self.assertTrue(wait_until(lambda: len(frames) == 3))
        port.fail = OSError(errno.ENODEV, "gone")
        self.assertTrue(wait_until(lambda: device.closed))
        self.assertTrue(wait_until(lambda: len(errors) == 1))
        self.assertEqual((errors[0].code, device.state, port.is_open), ("DISCONNECTED", "error", False))


class ProductLicenseTests(unittest.TestCase):
    def setUp(self):
        clear_license()
        self.addCleanup(clear_license)
        reset_reservations(self)

    def test_real_connections_need_an_active_licence_with_serial(self):
        with patch("shroom_sdk.product_device._serial_module") as loader:
            with self.assertRaises(ShroomLicenseError) as caught:
                connect_glove("COM1", side="left")
            self.assertEqual((caught.exception.code, caught.exception.stage), ("LICENSE_REQUIRED", "license"))
            activate_online_fixture(sdkFeatures=["stream", "recording"])
            for connector in (lambda: connect_glove("COM1", side="left"), lambda: connect("COM1", reconnect=True)):
                with self.assertRaises(ShroomLicenseError) as caught:
                    connector()
                self.assertEqual(caught.exception.code, "LICENSE_FEATURE_DENIED")
            loader.assert_not_called()

    def test_legacy_scoped_keys_cover_every_product(self):
        activate_online_fixture(sensorTypes=["hand"], isAllTypes=False, sdkFeatures=["serial"])
        for arguments, options in ((("glove",), {"side": "left"}), (("hand",), {}), (("body",), {}),
                                   (("insole",), {"side": "right"})):
            with product(FakeSerial(ScriptPort()), *arguments, "COM1", **options) as device:
                self.assertEqual(device.state, "open")

    def test_losing_the_licence_closes_an_idle_connection_and_stops_delivery(self):
        activate_online_fixture()
        port = ScriptPort([PAD])
        frames, errors = [], []
        device = product(FakeSerial(port), "pad", "COM1", on_data=frames.append, on_error=errors.append)
        self.assertTrue(wait_until(lambda: len(frames) == 1))
        clear_license()
        self.assertTrue(wait_until(lambda: not port.is_open))
        port.chunks.append(PAD)
        self.assertEqual((device.state, device.closed, [error.code for error in errors]), ("error", True, ["LICENSE_REQUIRED"]))
        with self.assertRaises(PermissionError):
            device.read_frame(0.05)
        time.sleep(0.05)
        self.assertEqual(len(frames), 1)
        self.assertEqual(device.get_diagnostics()["last_error"]["stage"], "license")

    def test_licence_lost_while_opening_releases_the_new_port(self):
        activate_online_fixture()
        port = ScriptPort()

        class Revoking(FakeSerial):
            def serial_for_url(self, path, **options):
                clear_license()
                return super().serial_for_url(path, **options)
        with self.assertRaises(ShroomLicenseError):
            product(Revoking(port), "pad", "COM1")
        self.assertFalse(port.is_open)


class ProductMockTests(unittest.TestCase):
    def test_mock_products_run_real_parsers_without_a_licence(self):
        clear_license()
        for arguments, options, kind in ((("glove",), {"side": "left"}, GloveFrame),
                                         (("handGloveFullPacket",), {"side": "right"}, GloveFrame),
                                         (("pad",), {}, PadFrame)):
            with self.subTest(arguments[0]), create_product_mock_device(*arguments, **options) as device:
                frames = [device.read_frame(2) for _ in range(3)]
                self.assertTrue(all(isinstance(frame, kind) for frame in frames))
                self.assertEqual((device.info["source"], device.frame_count, device.dropped_count), ("mock", 3, 0))
                self.assertEqual(device.get_diagnostics()["status"], "streaming")
                if kind is GloveFrame:
                    self.assertEqual(frames[0].imu.raw, bytes(16))  # No invented orientation data.
                    expected = [None] * 3 if frames[0].protocol == "segmented" else [0, 1, 2]
                    self.assertEqual([frame.sequence for frame in frames], expected)

    def test_only_documented_mock_products_and_options_are_accepted(self):
        for arguments, options in ((("body",), {}), (("insole",), {"side": "left"}), (("glove",), {}),
                                   (("pad",), {"side": "left"}), (("pad",), {"fps": 60})):
            with self.subTest(arguments=arguments, options=options), self.assertRaises(ValueError):
                create_product_mock_device(*arguments, **options)

    def test_mock_callbacks_and_frozen_data_entry_points(self):
        frames = []
        device = Shroom.mock_product("pad")
        device.on_data(frames.append)
        self.assertTrue(wait_until(lambda: len(frames) >= 2))
        device.close()
        count = len(frames)
        time.sleep(0.08)
        self.assertEqual((len(frames), device.state), (count, "closed"))
        for name in ("read_frame", "on_data", "on_frame", "_hub"):
            with self.assertRaises(AttributeError):
                setattr(device, name, lambda *args: None)


@unittest.skipUnless(importlib.util.find_spec("serial"), "Install the [serial] extra for loopback tests")
class ProductLoopbackTests(LicensedTestCase):
    def test_product_frames_through_a_real_pyserial_port(self):
        frames = []
        device = connect_product("pad", "loop://", on_data=frames.append)
        try:
            device.write(PAD[:300])
            device.write(PAD[300:] + PAD)
            self.assertTrue(wait_until(lambda: len(frames) == 2))
            self.assertEqual((frames[0].pressure, device.frame_length, device.bytes_received), (PAD[:-4], 1024, 2056))
        finally:
            device.close()
        self.assertFalse(device._port is not None and device._port.is_open)

    def test_named_layout_on_a_generic_port(self):
        with Shroom.connect("loop://", layout="car10", max_length=1024) as device:
            device.write(DEFAULT_DELIMITER + bytes(range(256)) * 4 + DEFAULT_DELIMITER)
            frame = device.read_frame(timeout=1)
            self.assertEqual((frame.rows, frame.cols, len(frame.raw)), (10, 10, 1024))
