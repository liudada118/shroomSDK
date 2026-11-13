"""Glove discovery: automatic side, port scanning, path reservations and automatic connection."""

import errno
import random
from threading import Event
import time
import unittest
from unittest.mock import patch

from shroom_sdk import (PortInfo, Shroom, ShroomError, ShroomLicenseError, clear_license, connect_glove,
                        connect_product, create_product_mock_device, create_product_parser, list_device_products,
                        read_product, scan_product_ports)
from shroom_sdk import _serial_path
from shroom_sdk.products import get_device_product_adapter
from license_fixture import LicensedTestCase
from product_fixture import HAS_NODE, random_bytes, run_node, segmented_first, segmented_pair, segmented_second, wire
from test_product_devices import ScriptPort, wait_until
from test_reliability import serial_device


def samples(packet_type: int, value: int = 17, pairs: int = 3) -> bytes:
    """Complete head+tail pairs from one hand; the pressure value marks which open delivered them."""
    return segmented_pair(bytes([value]) * 256, packet_type) * pairs


class PathSerial:
    """A fake pySerial module: every path has its own queue of ports, one per open."""

    def __init__(self, **ports):
        self.ports = {path: list(queue) if isinstance(queue, (list, tuple)) else [queue] for path, queue in ports.items()}
        self.opened = []

    def serial_for_url(self, path, **options):
        queue = self.ports.get(path)
        if not queue:
            raise OSError(errno.ENOENT, "could not open port: no such file")
        port = queue.pop(0)
        if isinstance(port, Exception):
            raise port
        self.opened.append((path, options.get("baudrate"), port))
        return port

    def paths(self):
        return [path for path, _, _ in self.opened]


class DiscoveryCase(LicensedTestCase):
    def setUp(self):
        super().setUp()
        _serial_path._reservations.clear()
        self.addCleanup(_serial_path._reservations.clear)
        self.devices = []
        self.addCleanup(self.close_devices)

    def close_devices(self):
        for device in self.devices:
            try:
                device.close()
            except ShroomError:
                pass

    def patched(self, serial, listed=None):
        """Route both the scanner and the real connection to the fake module and port list."""
        infos = [PortInfo(path, None, None, f"USB-{path}" if path == "LEFT" else None, None, None)
                 for path in (listed if listed is not None else serial.ports)]
        stack = [patch("shroom_sdk.serial_scan._serial_module", return_value=serial),
                 patch("shroom_sdk.product_device._serial_module", return_value=serial),
                 patch("shroom_sdk.serial_scan.list_ports", return_value=infos)]
        mocks = []
        for item in stack:
            mocks.append(item.start())
            self.addCleanup(item.stop)
        return mocks[2]  # The port-listing mock, so tests can assert whether enumeration happened.

    def scan(self, serial, **options):
        self.patched(serial)
        return scan_product_ports(**{"timeout": 0.05, **options})

    def connect(self, serial, *args, **options):
        self.patched(serial)
        device = connect_product(*args, **options)
        self.devices.append(device)
        return device

    def assert_code(self, code, callable_, *args, **kwargs):
        with self.assertRaises(ShroomError) as caught:
            callable_(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception


class AutomaticSideTests(unittest.TestCase):
    def test_packet_type_selects_the_side_only_in_automatic_mode(self):
        pressure = bytes(range(256))
        for packet_type, side in ((1, "left"), (2, "right")):
            stream = segmented_pair(pressure, packet_type, bytes(range(16)))
            parser = create_product_parser("glove", side="auto")
            frames = [frame for i in range(len(stream)) for frame in parser.push(stream[i:i + 1])]
            frame, = frames
            manual, = create_product_parser("glove", side=side).push(stream)
            self.assertEqual((frame.side, frame.packet_type, frame.protocol, frame.sequence), (side, packet_type, "segmented", None))
            self.assertEqual((frame.pressure, frame.fingers, frame.palm, frame.imu), (pressure, manual.fingers, manual.palm, manual.imu))
        # An explicit side keeps the packet type as an opaque pairing byte.
        manual, = create_product_parser("glove", side="left").push(segmented_pair(pressure, 2))
        self.assertEqual((manual.side, manual.packet_type), ("left", 2))

    def test_unknown_types_are_dropped_and_never_bridge_a_known_head(self):
        known = bytes(range(256))
        other = bytes(reversed(range(256)))
        for packet_type in (0, 3, 128, 255):
            parser = create_product_parser("glove", side="auto")
            self.assertEqual(parser.push(segmented_pair(other, packet_type)), [])
            self.assertEqual(parser.push(segmented_first(known, 1) + segmented_first(other, packet_type) + segmented_second(known, 1)), [])
            self.assertEqual(parser.push(segmented_first(other, packet_type) + segmented_second(known, 1)), [])
            self.assertEqual(parser.push(segmented_first(known, 1) + segmented_second(other, packet_type) + segmented_second(known, 1)), [])
            self.assertEqual(len(parser.push(segmented_pair(known, 1))), 1)  # Valid pairing resumes afterwards.
        mixed = create_product_parser("glove", side="auto")
        self.assertEqual(mixed.push(segmented_first(known, 1) + segmented_second(other, 2) + segmented_second(known, 1)), [])
        self.assertEqual([frame.side for frame in mixed.push(segmented_pair(known, 1) + segmented_pair(other, 2))], ["left", "right"])

    def test_discovery_is_declared_only_by_the_segmented_glove(self):
        adapter = get_device_product_adapter("glove")
        frame, = adapter.discovery.create_parser().push(samples(2, pairs=1))
        self.assertEqual(adapter.discovery.identify(frame), {"side": "right", "packet_type": 2})
        for product in ("handGloveFullPacket", "pad", "body", "insole"):
            self.assertIsNone(get_device_product_adapter(product).discovery)
        self.assertNotIn("discovery", list_device_products()[0])
        for options in ({"side": "auto"},):
            with self.assertRaises(ValueError):
                create_product_parser("handGloveFullPacket", **options)
            with self.assertRaises(ValueError):
                create_product_parser("insole", **options)
            with self.assertRaises(ValueError):
                create_product_mock_device("glove", **options)

    @unittest.skipUnless(HAS_NODE, "Cross-language parity tests require Node and the full repository's JS reference")
    def test_automatic_parser_matches_the_javascript_reference(self):
        rng = random.Random(9)
        cases, actual = [], []
        for _ in range(16):
            stream = b""
            for _ in range(rng.randrange(4, 12)):
                packet_type, pressure, roll = rng.choice((1, 2, 1, 2, 3, 0, 255)), random_bytes(rng, 256), rng.random()
                if roll < 0.6:
                    stream += segmented_pair(pressure, packet_type)
                elif roll < 0.75:
                    stream += segmented_first(pressure, packet_type) + segmented_second(pressure, rng.choice((1, 2, 9)))
                elif roll < 0.85:
                    stream += segmented_second(pressure, packet_type)
                else:
                    stream += segmented_first(pressure, packet_type)
            step = rng.choice((1, 7, 151, len(stream)))
            chunks = [stream[i:i + step] for i in range(0, len(stream), step)]
            cases.append({"kind": "product", "product": "handGloveSegmented", "options": {"side": "auto"},
                          "chunks": [list(chunk) for chunk in chunks]})
            parser = create_product_parser("handGloveSegmented", side="auto")
            steps = []
            for chunk in chunks:
                frames = [wire(frame) for frame in parser.push(chunk)]
                steps.append({"frames": frames, "droppedCount": float(parser.dropped_count), "frameLength": float(parser.frame_length)})
            actual.append(steps)
        reference = run_node("js_reference.mjs", cases)
        self.assertEqual(actual, reference)
        self.assertGreater(sum(len(step["frames"]) for steps in actual for step in steps), 30)
        self.assertGreater(sum(steps[-1]["droppedCount"] for steps in actual), 30)


class ScanTests(DiscoveryCase):
    def test_scan_identifies_hands_reports_every_port_and_releases_them(self):
        serial = PathSerial(NOISE=ScriptPort([bytes([55, 17, 9, 0xAA, 0x55, 0x03, 0x99])]),
                            BUSY=PermissionError(errno.EACCES, "Access is denied."),
                            LEFT=ScriptPort([samples(1)]), RIGHT=ScriptPort([samples(2)[:300], samples(2)[300:]]))
        result = self.scan(serial)
        self.assertEqual(result["devices"], [
            {"path": "LEFT", "product": "handGloveSegmented", "label": "触觉手套（分包）", "baud_rate": 921600,
             "side": "left", "packet_type": 1, "serial_number": "USB-LEFT"},
            {"path": "RIGHT", "product": "handGloveSegmented", "label": "触觉手套（分包）", "baud_rate": 921600,
             "side": "right", "packet_type": 2}])
        self.assertEqual([(port["path"], port["status"]) for port in result["ports"]],
                         [("NOISE", "unrecognized"), ("BUSY", "error"), ("LEFT", "matched"), ("RIGHT", "matched")])
        self.assertEqual((result["ports"][1]["error"]["code"], result["ports"][2]["device"]), ("PERMISSION_DENIED", result["devices"][0]))
        self.assertEqual([(path, baud) for path, baud, _ in serial.opened], [("NOISE", 921600), ("LEFT", 921600), ("RIGHT", 921600)])
        self.assertTrue(all(not port.is_open for _, _, port in serial.opened))
        self.assertEqual(_serial_path._reservations, {})  # Every probed path is free again.
        self.assertEqual(Shroom.scan_product_ports, scan_product_ports)

    def test_incomplete_unknown_too_few_or_mixed_streams_are_not_devices(self):
        serial = PathSerial(HALF=ScriptPort([samples(1)[:134]]), UNKNOWN=ScriptPort([samples(99)]),
                            INSUFFICIENT=ScriptPort([samples(1, pairs=2)]),
                            MIXED=ScriptPort([samples(1) + samples(2, pairs=1)]), SILENT=ScriptPort())
        result = self.scan(serial)
        self.assertEqual((result["devices"], [port["status"] for port in result["ports"]]), ([], ["unrecognized"] * 5))

    def test_side_filter_and_explicit_paths(self):
        serial = PathSerial(LEFT=ScriptPort([samples(1)]), RIGHT=ScriptPort([samples(2)]), UNTOUCHED=ScriptPort())
        listing = self.patched(serial)
        result = scan_product_ports(side="right", paths=["LEFT", "RIGHT", " RIGHT "], timeout=0.05)
        self.assertEqual(([device["path"] for device in result["devices"]], serial.paths()), (["RIGHT"], ["LEFT", "RIGHT"]))
        self.assertEqual([port["status"] for port in result["ports"]], ["matched", "matched"])  # Filtered, still reported.
        listing.assert_not_called()

    def test_configuration_and_licence_are_checked_before_touching_hardware(self):
        serial = PathSerial(LEFT=ScriptPort([samples(1)]))
        listing = self.patched(serial)
        for arguments, options in ((("pad",), {}), (("handGloveFullPacket",), {}), (("unknown",), {}), ((), {"side": "auto"}),
                                   ((), {"paths": []}), ((), {"paths": "COM3"}), ((), {"paths": [""]}),
                                   ((), {"timeout": 0.049}), ((), {"timeout": 10.5}), ((), {"timeout": True}),
                                   ((), {"cancel": object()})):
            with self.subTest(arguments=arguments, options=options):
                error = self.assert_code("INVALID_CONFIG", scan_product_ports, *arguments, **options)
                self.assertIsInstance(error, ValueError)
        clear_license()
        with self.assertRaises(ShroomLicenseError):
            scan_product_ports()
        self.assertEqual(serial.opened, [])
        listing.assert_not_called()

    def test_cancelling_closes_the_active_port_and_skips_the_rest(self):
        cancel = Event()

        class Cancelling(ScriptPort):
            def read(self, count):
                cancel.set()
                return super().read(count)
        first = Cancelling([samples(1)])
        serial = PathSerial(FIRST=first, SECOND=ScriptPort([samples(2)]))
        self.patched(serial)
        self.assert_code("USER_CANCELLED", scan_product_ports, timeout=5, cancel=cancel)
        self.assertEqual((serial.paths(), first.is_open, _serial_path._reservations), (["FIRST"], False, {}))
        self.assert_code("USER_CANCELLED", scan_product_ports, cancel=cancel)  # Already cancelled: nothing is opened.
        self.assertEqual(len(serial.opened), 1)

    def test_a_port_that_cannot_be_released_stops_the_scan_and_stays_reserved(self):
        stuck = ScriptPort([samples(1)])
        stuck.close_error = OSError("driver refused to close")
        serial = PathSerial(STUCK=stuck, NEXT=ScriptPort([samples(2)]))
        error = self.assert_code("CLOSE_FAILED", self.scan, serial)
        self.assertEqual((error.stage, serial.paths(), stuck.is_open), ("close", ["STUCK"], True))
        retry = scan_product_ports(paths=["STUCK"], timeout=0.05)  # Never reopened while the driver holds it.
        self.assertEqual((retry["ports"][0]["status"], retry["ports"][0]["error"]["code"], len(serial.opened)), ("error", "PORT_BUSY", 1))

    def test_licence_loss_during_a_probe_closes_it_and_stops(self):
        class Revoking(ScriptPort):
            def read(self, count):
                clear_license()
                return super().read(count)
        first = Revoking([samples(1)])
        serial = PathSerial(FIRST=first, SECOND=ScriptPort([samples(2)]))
        self.patched(serial)
        with self.assertRaises(ShroomLicenseError):
            scan_product_ports(timeout=0.05)
        self.assertEqual((serial.paths(), first.is_open, _serial_path._reservations), (["FIRST"], False, {}))

    def test_ports_owned_by_connections_are_never_probed(self):
        pair = samples(1)
        managed_port = ScriptPort([pair], fail=OSError(errno.ENODEV, "gone"))
        serial = PathSerial(OWNED=[managed_port, ScriptPort([pair])], GENERIC=ScriptPort())
        device = self.connect(serial, "glove", "OWNED", side="left", reconnect={"interval": 0.2, "max_attempts": 2},
                              on_data=lambda frame: None, on_error=lambda error: None)
        self.assertTrue(wait_until(lambda: device.state == "reconnecting"))
        blocked = scan_product_ports(paths=["OWNED"], timeout=0.05)  # Not even in the gap before the reopen.
        self.assertEqual((blocked["ports"][0]["error"]["code"], len(serial.opened)), ("PORT_BUSY", 1))
        self.assertTrue(wait_until(lambda: device.state == "open" and len(serial.opened) == 2))
        self.assertEqual(scan_product_ports(paths=["owned"] if _serial_path.os.name == "nt" else ["OWNED"], timeout=0.05)["ports"][0]["error"]["code"], "PORT_BUSY")
        self.assert_code("PORT_BUSY", connect_product, "pad", "OWNED")
        device.close()
        serial.ports["OWNED"] = [ScriptPort([pair])]
        self.assertEqual(scan_product_ports(paths=["OWNED"], timeout=0.05)["devices"][0]["side"], "left")
        # A plain synchronous connection is respected as well, until it is closed.
        with patch("shroom_sdk.device._serial_module", return_value=serial):
            generic = Shroom.connect("GENERIC")
        self.assertEqual(scan_product_ports(paths=["GENERIC"], timeout=0.05)["ports"][0]["error"]["code"], "PORT_BUSY")
        generic.close()
        serial.ports["GENERIC"] = [ScriptPort()]
        self.assertEqual(scan_product_ports(paths=["GENERIC"], timeout=0.05)["ports"][0]["status"], "unrecognized")

    def test_reservations_are_per_device_path_and_stale_releases_are_harmless(self):
        release = _serial_path.reserve_serial_path("COM7")
        self.assert_code("PORT_BUSY", _serial_path.reserve_serial_path, " COM7 ")
        self.assert_code("PORT_BUSY", _serial_path.assert_serial_path_available, "COM7")
        release()
        second = _serial_path.reserve_serial_path("COM7")
        release()  # The first owner releasing again must not free the new owner.
        self.assert_code("PORT_BUSY", _serial_path.reserve_serial_path, "COM7")
        second()
        _serial_path.assert_serial_path_available("COM7")
        for url in ("loop://", "socket://127.0.0.1:7000"):  # Each open of a pySerial URL is its own connection.
            _serial_path.reserve_serial_path(url)
            _serial_path.reserve_serial_path(url)
        self.assertEqual(_serial_path._reservations, {})


class AutomaticConnectionTests(DiscoveryCase):
    def test_manual_path_and_side_connect_directly_without_scanning(self):
        serial = PathSerial(MANUAL=ScriptPort([samples(2)]), OTHER=ScriptPort())
        listing = self.patched(serial)
        device = connect_glove("MANUAL", side="left")  # The stated side wins; type 2 is just the pairing byte.
        self.devices.append(device)
        self.assertEqual((serial.paths(), device.info["path"], device.info["side"], device.read_frame(1).side),
                         (["MANUAL"], "MANUAL", "left", "left"))
        self.assertNotIn("packet_type", device.info)
        listing.assert_not_called()

    def test_side_without_path_scans_and_never_forwards_probe_samples(self):
        serial = PathSerial(NOISE=ScriptPort(), AUTO=[ScriptPort([samples(1, 11)]), ScriptPort([samples(1, 42)])])
        frames = []
        device = self.connect(serial, "glove", side="left", scan={"timeout": 0.05}, on_data=frames.append)
        self.assertTrue(wait_until(lambda: len(frames) == 3))
        self.assertEqual((device.info["path"], device.info["side"], device.info["packet_type"], device.info["protocol"]),
                         ("AUTO", "left", 1, "segmented"))
        self.assertEqual(({frame.pressure[0] for frame in frames}, serial.paths()), ({42}, ["NOISE", "AUTO", "AUTO"]))

    def test_product_only_finds_a_single_hand_and_refuses_to_choose_between_two(self):
        serial = PathSerial(ONLY=[ScriptPort([samples(2)]), ScriptPort([samples(2)])])
        device = self.connect(serial, "glove", scan={"timeout": 0.05})
        self.assertEqual((device.info["side"], device.read_frame(1).side), ("right", "right"))
        device.close()
        both = PathSerial(LEFT=ScriptPort([samples(1)]), RIGHT=ScriptPort([samples(2)]))
        self.patched(both)
        error = self.assert_code("PORT_AMBIGUOUS", read_product, "glove", scan={"timeout": 0.05})
        self.assertEqual(([device["side"] for device in error.details["scan"]["devices"]], error.stage), (["left", "right"], "query"))
        self.assertTrue(all(not port.is_open for _, _, port in both.opened))

    def test_explicit_path_with_automatic_side_probes_only_that_port(self):
        serial = PathSerial(CHOSEN=[ScriptPort([samples(2)]), ScriptPort([samples(2)])], UNTOUCHED=ScriptPort())
        for options in ({"side": "auto"}, {}):
            serial.ports["CHOSEN"] = [ScriptPort([samples(2)]), ScriptPort([samples(2)])]
            serial.opened.clear()
            device = self.connect(serial, "glove", "CHOSEN", scan={"timeout": 0.05}, **options)
            self.assertEqual((device.info["side"], serial.paths()), ("right", ["CHOSEN", "CHOSEN"]))
            device.close()

    def test_no_match_and_several_matches_report_the_scan(self):
        same = PathSerial(LEFT_A=ScriptPort([samples(1)]), LEFT_B=ScriptPort([samples(1)]))
        self.patched(same)
        error = self.assert_code("PORT_AMBIGUOUS", connect_product, "glove", side="left", scan={"timeout": 0.05})
        self.assertEqual([device["path"] for device in error.details["scan"]["devices"]], ["LEFT_A", "LEFT_B"])
        none = PathSerial(UNKNOWN=ScriptPort([samples(15)]), RIGHT=ScriptPort([samples(2)]))
        self.patched(none)
        error = self.assert_code("PORT_NOT_FOUND", connect_product, "glove", side="left", scan={"timeout": 0.05})
        self.assertEqual((error.details["scan"]["devices"], [port["status"] for port in error.details["scan"]["ports"]]),
                         ([], ["unrecognized", "matched"]))  # The right hand was seen but did not match the request.
        self.assertEqual(_serial_path._reservations, {})

    def test_identity_is_kept_across_reconnects_and_a_swapped_hand_is_rejected(self):
        serial = PathSerial(IDENTITY=[ScriptPort([samples(1)]),
                                      ScriptPort([samples(1)], fail=OSError(errno.ENODEV, "gone")),
                                      ScriptPort([samples(2)])])
        frames, errors = [], []
        device = self.connect(serial, "glove", scan={"timeout": 0.05}, reconnect={"interval": 0.01, "max_attempts": 2},
                              on_data=frames.append, on_error=errors.append)
        self.assertTrue(wait_until(lambda: any(error.code == "PARSE_FAILED" for error in errors)))
        self.assertTrue(wait_until(lambda: device.state == "error" and not serial.opened[2][2].is_open))
        self.assertEqual(({frame.side for frame in frames}, serial.paths(), [error.code for error in errors]),
                         ({"left"}, ["IDENTITY"] * 3, ["DISCONNECTED", "PARSE_FAILED"]))
        self.assertEqual(errors[1].details["expected_side"], "left")

    def test_scan_options_are_validated_and_only_the_segmented_glove_accepts_them(self):
        serial = PathSerial(LEFT=ScriptPort([samples(1)]))
        listing = self.patched(serial)
        for arguments, options in ((("glove",), {"scan": {"timeoutMs": 50}}), (("glove",), {"scan": ["LEFT"]}),
                                   (("glove", "LEFT"), {"scan": {"paths": ["LEFT"]}}), (("glove",), {"side": "both"}),
                                   (("glove",), {"scan": {"timeout": 99}}), (("pad", "LEFT"), {"scan": {}}),
                                   (("handGloveFullPacket", "LEFT"), {"side": "left", "scan": {}}),
                                   (("handGloveFullPacket", "LEFT"), {"side": "auto"}),
                                   (("insole", "LEFT"), {"side": "auto"}), (("glove",), {"on_data": 5}),
                                   (("glove",), {"reconnect": "always"})):
            with self.subTest(arguments=arguments, options=options):
                self.assert_code("INVALID_CONFIG", connect_product, *arguments, **options)
        self.assert_code("INVALID_CONFIG", read_product, url="ws://127.0.0.1:1", scan={})
        self.assertEqual(serial.opened, [])
        listing.assert_not_called()
        clear_license()
        with self.assertRaises(ShroomLicenseError):
            connect_product("glove")
        self.assertEqual(serial.opened, [])


class GenericDeviceRegistryTests(LicensedTestCase):
    def test_plain_connections_keep_their_previous_behaviour(self):
        _serial_path._reservations.clear()
        first, second = serial_device(), serial_device()  # Two plain opens of one fake path were always allowed.
        self.assertEqual((first.state, second.state), ("open", "open"))
        with self.assertRaises(OSError) as busy:
            _serial_path.reserve_serial_path("memory-port")
        self.assertEqual(busy.exception.code, "PORT_BUSY")
        second.close()
        first.close()
        _serial_path.reserve_serial_path("memory-port")()
