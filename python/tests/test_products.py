"""Product protocols, layouts and the stream codec, checked against the JavaScript reference."""

from array import array
from decimal import Decimal
import json
import math
import random
import struct
import unittest
from unittest.mock import patch

from shroom_sdk import (COLORMAPS, BodyFrame, Frame, GloveFrame, InsoleFrame, PadFrame, ShroomError, Shroom,
                        get_colormap, grey, jet, jet_white, shroom,
                        create_glove_regions, create_product_parser, decode_frame, decode_glove_packet,
                        decode_stream_frame, encode_stream_frame, get_product, list_device_products,
                        list_layouts, list_products)
from shroom_sdk.layout import LAYOUTS, get_named_layout
from shroom_sdk.products import _adapter
from shroom_sdk.products.body import HUMAN_BODY_REGION_LAYOUTS
from product_fixture import (HAS_NODE, PRODUCT_CASES, TAIL, full_packet, insole_12bit, insole_8bit_first,
                             insole_8bit_second, product_frames, random_bytes, run_node, segmented_first,
                             segmented_pair, segmented_second, wire, wire_bytes)

RAMP = bytes(range(256))


def assert_code(test, code, callable_, *args, **kwargs):
    with test.assertRaises(ShroomError) as caught:
        callable_(*args, **kwargs)
    test.assertEqual(caught.exception.code, code)
    return caught.exception


class Clock:
    """Replaces the pairing clock so timeouts can be tested without sleeping."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class LayoutTests(unittest.TestCase):
    def test_named_layout_decides_shape_and_moves_only_positions(self):
        payload = random_bytes(random.Random(3), 1024)
        frame = decode_frame(payload, layout="car10")
        self.assertEqual((frame.rows, frame.cols, len(frame.values)), (10, 10, 100))
        perm = get_named_layout("car10").perm
        self.assertEqual(list(frame.values), list(array("f", [payload[i] / 255 for i in perm])))
        self.assertEqual(frame.raw, payload)

    def test_missing_sensor_positions_stay_zero(self):
        frame = decode_frame(bytes([255]) * 1024, layout="carCol")
        perm = get_named_layout("carCol").perm
        self.assertEqual((frame.rows, frame.cols), (9, 10))
        self.assertIn(-1, perm)
        self.assertEqual([value for value, source in zip(frame.values, perm) if source < 0], [0.0] * perm.count(-1))
        self.assertEqual(frame.area, 90 - perm.count(-1))

    def test_small_scan_layouts_and_shape_mismatch_are_explicit(self):
        self.assertEqual((decode_frame(RAMP, layout="footInsole").rows, decode_frame(RAMP, layout="footInsole").cols), (10, 6))
        for arguments in ({"layout": "car10"}, {"layout": "mat32"}):
            with self.subTest(arguments), self.assertRaises(ValueError):
                decode_frame(RAMP, **arguments)  # 256 points cannot fill a 1024-point scan.
        with self.assertRaises(ValueError):
            decode_frame(bytes(1024), layout="car10", rows=32, cols=32)
        with self.assertRaises(ValueError):
            decode_frame(bytes(1024), layout="not-a-layout")

    def test_device_options_accept_named_layouts_and_reject_mismatched_shapes(self):
        with Shroom.mock(layout="carSeat", fps=1000, seed=1) as device:
            frame = device.read_frame()
            perm = get_named_layout("carSeat").perm
            self.assertEqual((frame.rows, frame.cols), (32, 32))
            self.assertEqual(list(frame.values), list(array("f", [frame.raw[i] / 255 for i in perm])))
        for options in ({"layout": "car10"}, {"rows": 10, "cols": 10, "layout": "mat32"}):
            with self.subTest(options), self.assertRaises(ValueError):
                Shroom.mock(**options)

    def test_menus_match_the_desktop_order_and_resolve_shapes(self):
        self.assertEqual(len(LAYOUTS), 30)
        self.assertEqual([entry["name"] for entry in list_layouts()], list(LAYOUTS))
        products = list_products()
        self.assertEqual(products[0], {"name": "hand", "label": "手部检测", "layout": "mat32", "rows": 32, "cols": 32})
        self.assertEqual(get_product("fast256"), {"name": "fast256", "label": "16*16高速", "layout": "raw", "rows": 16, "cols": 16})
        self.assertIsNone(get_product("handGlove"))
        self.assertEqual(Shroom.list_products(), products)


class ColormapTests(unittest.TestCase):
    def test_palettes_clamp_and_keep_the_desktop_colour_stops(self):
        self.assertEqual((jet(0), jet(0.5), jet(1), jet(-3), jet(9)),
                         ((0, 0, 255), (0, 255, 0), (255, 0, 0), (0, 0, 255), (255, 0, 0)))
        self.assertEqual((jet_white(0), jet_white(0.001), jet_white(1)), ((255, 255, 255), (255, 255, 255), (255, 0, 0)))
        self.assertEqual((grey(0), grey(0.5), grey(1)), ((0, 0, 0), (128, 128, 128), (255, 255, 255)))
        self.assertEqual((shroom(0), shroom(0.4), shroom(0.55), shroom(1), shroom(2)),
                         ((21, 18, 42), (62, 0, 248), (149, 253, 237), (216, 36, 36), (216, 36, 36)))
        self.assertEqual(sorted(COLORMAPS), ["grey", "jet", "jetWhite", "shroom"])
        custom = lambda value: (1, 2, 3)
        self.assertEqual((get_colormap("shroom"), get_colormap("unknown"), get_colormap(None), get_colormap(custom)),
                         (shroom, jet, jet, custom))


class DeviceProductTests(unittest.TestCase):
    def test_registry_lists_canonical_products_and_accepts_aliases_only_for_connections(self):
        products = list_device_products()
        self.assertEqual([entry["product"] for entry in products],
                         ["handGloveSegmented", "handGloveFullPacket", "hand", "humanBody", "jqInsole"])
        self.assertEqual(products[0]["payload_length"], 276)
        self.assertEqual((products[3]["sensor_points"], products[3]["mapped_sensor_points"]), (1024, 400))
        self.assertEqual((products[4]["sensor_points"], products[4]["mapped_sensor_points"]), (256, 112))
        products[0]["baud_rate"] = 1  # A copy: the registry itself must not change.
        self.assertEqual(list_device_products()[0]["baud_rate"], 921600)
        for alias, options, canonical in (("glove", {"side": "left"}, "handGloveSegmented"), ("pad", {}, "hand"),
                                          ("body", {}, "humanBody"), ("insole", {"side": "left"}, "jqInsole")):
            rng = random.Random(1)
            frames = create_product_parser(alias, **options).push(wire_bytes(canonical, options, rng))
            self.assertEqual([frame.product for frame in frames], [canonical])

    def test_options_are_validated_per_product(self):
        for product, options in (("glove", {}), ("glove", {"side": "middle"}), ("handGloveFullPacket", {}),
                                 ("hand", {"side": "left"}), ("body", {"side": "left"}), ("insole", {}),
                                 ("insole", {"side": "left", "protocol": "16bit"}),
                                 ("insole", {"side": "left", "baud_rate": 1000000}),
                                 ("glove", {"side": "left", "baud_rate": 921600}), ("unknown", {}), (None, {})):
            with self.subTest(product=product, options=options):
                error = assert_code(self, "INVALID_CONFIG", create_product_parser, product, **options)
                self.assertIsInstance(error, ValueError)
        # None means "not provided", so generic callers can pass side=None for products without one.
        self.assertIsNotNone(create_product_parser("pad", side=None))


class SegmentedGloveTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        patcher = patch.object(_adapter, "now_ms", self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_matching_pair_emits_independent_pressure_and_imu(self):
        for side in ("left", "right"):
            with self.subTest(side=side):
                parser = create_product_parser("glove", side=side)
                imu = bytes(range(100, 116))
                self.assertEqual(parser.push(segmented_first(RAMP, 9)), [])
                frame, = parser.push(segmented_second(RAMP, 9, imu))
                self.assertIsInstance(frame, GloveFrame)
                self.assertEqual((frame.product, frame.protocol, frame.side, frame.packet_type, frame.sequence),
                                 ("handGloveSegmented", "segmented", side, 9, None))
                self.assertEqual((frame.pressure, frame.raw, frame.imu.raw), (RAMP, RAMP, imu))
                self.assertEqual((frame.rows, frame.cols, len(frame.pressure_matrix)), (13, 15, 195))
                self.assertNotIn("sequence", frame.to_dict())
                self.assertEqual((parser.frame_length, parser.dropped_count), (276, 0))

    def test_single_bytes_and_sticky_packets_give_one_frame_per_pair(self):
        rng = random.Random(4)
        stream = b"".join(segmented_pair(random_bytes(rng, 256), 3) for _ in range(4))
        parser = create_product_parser("glove", side="left")
        self.assertEqual(sum(len(parser.push(stream[i:i + 1])) for i in range(len(stream))), 4)
        self.assertEqual(len(create_product_parser("glove", side="left").push(stream)), 4)
        self.assertEqual(parser.dropped_count, 0)

    def test_packet_type_pairs_packets_but_never_selects_the_side(self):
        parser = create_product_parser("glove", side="left")
        self.assertEqual(parser.push(segmented_first(RAMP, 1) + segmented_second(RAMP, 2)), [])
        self.assertEqual(parser.dropped_count, 1)
        for side, packet_type in (("left", 2), ("right", 1), ("left", 255)):
            frame, = create_product_parser("glove", side=side).push(segmented_pair(RAMP, packet_type))
            self.assertEqual((frame.side, frame.packet_type), (side, packet_type))

    def test_only_the_latest_head_can_pair_and_tails_are_consumed_once(self):
        other = bytes(reversed(RAMP))
        parser = create_product_parser("glove", side="left")
        frame, = parser.push(segmented_first(RAMP) + segmented_first(other) + segmented_second(other))
        self.assertEqual(frame.pressure, other)
        self.assertEqual(parser.dropped_count, 1)
        self.assertEqual(parser.push(segmented_second(other)), [])  # A repeated tail cannot replay the head.
        self.assertEqual(parser.push(segmented_second(RAMP)), [])   # Nor can an orphan tail.
        self.assertEqual(parser.dropped_count, 3)

    def test_boundaries_between_head_and_tail_clear_the_pending_head(self):
        for between, dropped in ((TAIL, 2), (b"\x03" + TAIL, 2), (bytes(40) + TAIL, 3), (bytes(1000) + TAIL, 3)):
            with self.subTest(length=len(between)):
                parser = create_product_parser("glove", side="right")
                self.assertEqual(parser.push(segmented_first(RAMP) + between + segmented_second(RAMP)), [])
                self.assertEqual(parser.dropped_count, dropped)
                self.assertEqual(len(parser.push(segmented_pair(RAMP))), 1)  # The stream recovers afterwards.

    def test_oversized_noise_is_bounded_and_cannot_form_a_frame(self):
        parser = create_product_parser("glove", side="left")
        self.assertEqual(parser.push(segmented_first(RAMP) + bytes(200_000)), [])
        self.assertLessEqual(len(parser._pending), 150)
        self.assertEqual(parser.push(segmented_second(RAMP)[:-4]), [])
        self.assertEqual(parser.push(TAIL + segmented_second(RAMP)), [])
        self.assertEqual(len(parser.push(segmented_pair(RAMP))), 1)

    def test_pair_timeout_backward_clock_and_reset(self):
        parser = create_product_parser("glove", side="left")
        parser.push(segmented_first(RAMP))
        self.clock.now += 1000
        self.assertEqual(len(parser.push(segmented_second(RAMP))), 1)  # Exactly at the limit still pairs.
        parser.push(segmented_first(RAMP))
        self.clock.now += 1001
        self.assertEqual(parser.push(segmented_second(RAMP)), [])
        parser.push(segmented_first(RAMP))
        self.clock.now -= 5
        self.assertEqual(parser.push(segmented_second(RAMP)), [])
        parser.push(segmented_first(RAMP))
        parser.reset()  # A reconnect must not keep the previous half frame.
        self.assertEqual(parser.push(segmented_second(RAMP)), [])
        self.assertEqual((parser.dropped_count, parser.frame_length), (1, 0))
        with self.assertRaises(TypeError):
            parser.push("not bytes")


class GloveRegionTests(unittest.TestCase):
    def test_regions_follow_the_product_table_exactly(self):
        fingers, palm = create_glove_regions(RAMP, side="left")
        thumb = fingers.thumb
        self.assertEqual((thumb.name, thumb.rows, thumb.cols, thumb.row_lengths), ("大拇指", 4, 3, (3, 3, 3, 3)))
        self.assertEqual(list(thumb.source_indices), [18, 17, 16, 2, 1, 0, 242, 241, 240, 226, 225, 224])
        self.assertEqual(list(thumb.raw), list(thumb.source_indices))  # pressure[i] == i in the ramp.
        self.assertEqual(thumb.matrix, [[18, 17, 16], [2, 1, 0], [242, 241, 240], [226, 225, 224]])
        self.assertEqual((thumb.pulp.name, list(thumb.pulp.source_indices), thumb.pulp.row_lengths), ("大拇指指腹", [209], (1,)))
        self.assertEqual((palm.name, palm.rows, palm.cols, palm.row_lengths), ("手掌", 5, 15, (12, 15, 15, 15, 15)))
        self.assertEqual((len(palm.raw), palm.source_indices[0], palm.source_indices[-1]), (72, 206, 128))
        self.assertEqual([len(row) for row in palm.matrix], [12, 15, 15, 15, 15])
        right, right_palm = create_glove_regions(RAMP, side="right")
        self.assertEqual(list(right.thumb.source_indices[:3]), [239, 238, 237])
        self.assertEqual((list(right.little.pulp.source_indices), right_palm.source_indices[0]), ([34], 60))
        self.assertEqual([key for key, _ in fingers.items()], ["thumb", "index", "middle", "ring", "little"])

    def test_every_mapped_channel_is_used_once_and_zero_is_kept(self):
        for side in ("left", "right"):
            fingers, palm = create_glove_regions(bytes(256), side=side)
            channels = list(palm.source_indices)
            for _, finger in fingers.items():
                channels += list(finger.source_indices) + list(finger.pulp.source_indices)
                self.assertEqual(list(finger.values), [0.0] * 12)
            self.assertEqual((len(channels), len(set(channels))), (137, 137))
        scaled, _ = create_glove_regions(RAMP, side="left", full_scale=510)
        self.assertEqual(scaled.thumb.values[0], array("f", [18 / 510])[0])

    def test_invalid_input_is_structured(self):
        assert_code(self, "INVALID_CONFIG", create_glove_regions, RAMP, side="up")
        assert_code(self, "INVALID_CONFIG", create_glove_regions, RAMP, side="left", full_scale=0)
        assert_code(self, "PARSE_FAILED", create_glove_regions, RAMP[:255], side="left")
        assert_code(self, "PARSE_FAILED", create_glove_regions, "x" * 256, side="left")

    def test_full_packet_keeps_sequence_type_and_raw_imu(self):
        imu = bytes(range(16))
        frame = decode_glove_packet(full_packet(RAMP, 200, 7, imu)[:-4], side="right")
        self.assertEqual((frame.product, frame.sequence, frame.packet_type, frame.protocol, frame.imu.raw),
                         ("handGloveFullPacket", 200, 7, None, imu))
        self.assertEqual(frame.pressure, RAMP)
        self.assertNotIn("protocol", frame.to_dict())
        assert_code(self, "PARSE_FAILED", decode_glove_packet, bytes(273), side="left")
        assert_code(self, "INVALID_CONFIG", decode_glove_packet, bytes(274), side=None)
        parser = create_product_parser("handGloveFullPacket", side="left")
        stream = b"noise" + TAIL + full_packet(RAMP, 1) + bytes(100) + TAIL + full_packet(RAMP, 2)
        self.assertEqual([f.sequence for f in parser.push(stream)], [1, 2])
        self.assertEqual((parser.dropped_count, parser.frame_length), (2, 274))


class PadAndBodyTests(unittest.TestCase):
    def test_pad_keeps_scan_order_and_adds_the_mapped_matrix(self):
        payload = bytearray(1024)
        payload[15 * 32] = 255
        frame, = create_product_parser("pad").push(bytes(payload) + TAIL)
        self.assertIsInstance(frame, PadFrame)
        self.assertEqual((frame.product, frame.rows, frame.cols), ("hand", 32, 32))
        self.assertEqual((frame.pressure, frame.raw), (bytes(payload), bytes(payload)))
        self.assertEqual((frame.pressure_matrix[0], frame.values[0], sum(frame.pressure_matrix)), (255, 1.0, 255))

    def test_body_extracts_the_ten_physical_regions(self):
        payload = bytes((index * 7 + 3) & 255 for index in range(1024))
        frame, = create_product_parser("body").push(payload + TAIL)
        self.assertIsInstance(frame, BodyFrame)
        self.assertEqual((frame.product, frame.rows, frame.cols, frame.pressure, frame.pressure_matrix),
                         ("humanBody", 32, 32, payload, payload))
        self.assertEqual(list(frame.regions), ["back", "chest", "rightArm", "rightShoulder", "leftArm", "leftShoulder",
                                               "backPantsRight", "backPantsLeft", "frontPantsLeft", "frontPantsRight"])
        channels = [index for region in frame.regions.values() for index in region.source_indices]
        self.assertEqual((len(channels), len(set(channels)), max(channels)), (400, 400, 1023))
        back = frame.regions["back"]
        self.assertEqual((back.rows, back.cols, back.source_indices[0], back.source_indices[-1]), (6, 10, 618, 4))
        for region in frame.regions.values():
            self.assertEqual(list(region.raw), [payload[index] for index in region.source_indices])
            self.assertEqual(region.matrix, [list(region.raw[r * region.cols:(r + 1) * region.cols]) for r in range(region.rows)])
            self.assertEqual(list(region.values), list(array("f", [value / 255 for value in region.raw])))

    def test_tail_framing_recovers_from_split_short_and_overlong_payloads(self):
        rng = random.Random(8)
        good = [random_bytes(rng, 1024) for _ in range(3)]
        stream = good[0] + TAIL + bytes(100) + TAIL + good[1] + TAIL + bytes(3000) + TAIL + good[2] + TAIL
        for step in (1, 5, 1027, len(stream)):
            with self.subTest(step=step):
                parser = create_product_parser("humanBody")
                frames = [f for i in range(0, len(stream), step) for f in parser.push(stream[i:i + step])]
                self.assertEqual([frame.raw for frame in frames], good)
                self.assertEqual((parser.dropped_count, parser.frame_length), (2, 1024))
        self.assertLessEqual(len(parser._pending), 1027)


class InsoleTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        patcher = patch.object(_adapter, "now_ms", self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_12bit_preserves_adc_precision_imu_and_layout(self):
        adc = [(index * 17) % 4096 for index in range(256)]
        imu = (0.5, -0.5, 0.25, -0.0, 1.5, -2.5, 3.5, 0.0, -9.8, 0.125)
        for side, first_index in (("left", 141), ("right", 114)):
            with self.subTest(side=side):
                parser = create_product_parser("insole", side=side)
                data = insole_12bit(adc, imu)
                frames = [f for i in range(len(data)) for f in parser.push(data[i:i + 1])]
                frame, = frames
                self.assertIsInstance(frame, InsoleFrame)
                self.assertEqual((frame.product, frame.side, frame.protocol, frame.bit_depth, frame.full_scale, frame.sequence),
                                 ("jqInsole", side, "12bit", 12, 4095, None))
                self.assertEqual((len(frame.raw), frame.pressure.typecode, list(frame.pressure)), (512, "H", adc))
                self.assertEqual(list(frame.values), list(array("f", [value / 4095 for value in adc])))
                self.assertEqual((list(frame.imu.quaternion), list(frame.imu.gyroscope), list(frame.imu.acceleration)),
                                 ([0.5, -0.5, 0.25, -0.0], [1.5, -2.5, 3.5], [0.0, array("f", [-9.8])[0], 0.125]))
                self.assertEqual(math.copysign(1, frame.imu.quaternion[3]), -1)
                sensors = frame.sensors
                self.assertEqual((sensors.rows, sensors.cols, len(sensors.positions), sensors.source_indices[0]), (14, 8, 112, first_index))
                self.assertEqual(len(set(sensors.source_indices)), 112)
                self.assertEqual(list(sensors.raw), [adc[index] for index in sensors.source_indices])
                self.assertEqual((sensors.positions[0].x_mm, sensors.positions[0].y_mm, sensors.positions[-1].row), (-14.2, -1.6, 13))
                self.assertEqual((parser.frame_length, parser.dropped_count), (552, 0))

    def test_12bit_rejects_bad_candidates_and_rescans(self):
        good = insole_12bit([7] * 256)
        too_large = insole_12bit([4096] + [0] * 255)
        not_finite = insole_12bit([0] * 256, [math.nan] + [0.0] * 9)
        for bad in (too_large, not_finite):
            parser = create_product_parser("insole", side="left")
            frames = parser.push(bad + good + b"\xaa\x55" + good)
            self.assertEqual([list(frame.pressure)[:2] for frame in frames], [[7, 7], [7, 7]])
            self.assertGreaterEqual(parser.dropped_count, 1)
        embedded = create_product_parser("insole", side="left")
        # A real frame that starts inside a rejected candidate must still be found.
        self.assertEqual(len(embedded.push(TAIL + bytes(10) + good + bytes(552))), 1)

    def test_8bit_pairs_only_adjacent_segments_with_the_same_index(self):
        adc = bytes((index * 3) & 255 for index in range(256))
        parser = create_product_parser("insole", side="right", protocol="8bit")
        frame, = parser.push(insole_8bit_first(adc, 5) + insole_8bit_second(adc, 5, (0.0, 1.0, 0.0, 0.0)))
        self.assertEqual((frame.protocol, frame.bit_depth, frame.full_scale, frame.sequence), ("8bit", 8, 255, 5))
        self.assertEqual((frame.raw, frame.pressure, list(frame.imu.quaternion)), (adc, adc, [0.0, 1.0, 0.0, 0.0]))
        self.assertIsNone(frame.imu.gyroscope)
        self.assertEqual(parser.push(insole_8bit_first(adc, 5) + insole_8bit_second(adc, 6)), [])
        self.assertEqual(parser.push(insole_8bit_second(adc, 5)), [])
        self.assertEqual(parser.push(insole_8bit_second(adc, 6) + insole_8bit_first(adc, 6)), [])
        latest, = parser.push(insole_8bit_first(adc, 7) + insole_8bit_second(adc, 7))
        self.assertEqual(latest.sequence, 7)
        self.assertEqual(parser.push(insole_8bit_first(adc, 8) + b"\x00\x01" + insole_8bit_second(adc, 8)), [])
        self.assertEqual(parser.push(TAIL + bytes([9]) + insole_8bit_first(adc, 1) + insole_8bit_second(adc, 1, (math.inf, 0, 0, 0))), [])
        self.assertEqual(len(parser.push(insole_8bit_first(adc, 2) + insole_8bit_second(adc, 2))), 1)

    def test_8bit_segment_expires_and_reset_isolates_sessions(self):
        adc = bytes(256)
        parser = create_product_parser("insole", side="left", protocol="8bit")
        parser.push(insole_8bit_first(adc, 1))
        self.clock.now += 1000
        self.assertEqual(len(parser.push(insole_8bit_second(adc, 1))), 1)
        parser.push(insole_8bit_first(adc, 2))
        self.clock.now += 1001
        self.assertEqual(parser.push(insole_8bit_second(adc, 2)), [])
        parser.push(insole_8bit_first(adc, 3))
        parser.reset()
        self.assertEqual(parser.push(insole_8bit_second(adc, 3)), [])
        self.assertEqual(parser.frame_length, 0)
        noisy = create_product_parser("insole", side="left", protocol="8bit")
        self.assertEqual(noisy.push(bytes(100_000)), [])
        self.assertLessEqual(len(noisy._buffer), 3)


class StreamCodecTests(unittest.TestCase):
    def test_every_product_round_trips_through_json(self):
        for product, options in PRODUCT_CASES:
            with self.subTest(product=product, options=options):
                for frame in product_frames(product, options):
                    text = json.dumps(encode_stream_frame(frame), allow_nan=False)
                    decoded = decode_stream_frame(json.loads(text))
                    self.assertIs(type(decoded), type(frame))
                    self.assertEqual(decoded, frame)
                    self.assertEqual(wire(decoded, keep_timestamp=True), wire(frame, keep_timestamp=True))

    def test_generic_frames_and_plain_dictionaries_are_supported(self):
        frame = decode_frame(bytes([0, 64, 128, 255]))
        decoded = decode_stream_frame(json.loads(json.dumps(encode_stream_frame(frame))))
        self.assertIs(type(decoded), Frame)
        self.assertEqual(decoded, frame)
        self.assertEqual(encode_stream_frame(frame.to_dict())["values"], encode_stream_frame(frame)["values"])

    def test_signed_zero_survives_json_without_normalisation(self):
        data = insole_12bit([0] * 256, [-0.0] * 10)
        frame, = create_product_parser("insole", side="left").push(data)
        text = json.dumps(encode_stream_frame(frame))
        # JSON carries a plain 0, exactly as JSON.stringify(-0) does; the sign comes back from the raw bytes.
        self.assertEqual(json.loads(text)["imu"]["quaternion"], [0, 0, 0, 0])
        self.assertNotIn("-0", json.dumps(encode_stream_frame(frame)["imu"]))
        decoded = decode_stream_frame(json.loads(text))
        self.assertTrue(all(math.copysign(1, value) == -1 for value in decoded.imu.quaternion))

    def test_large_integer_literals_from_other_runtimes_compare_as_doubles(self):
        data = insole_12bit([0] * 256, [6e17] + [0.0] * 9)
        frame, = create_product_parser("insole", side="left").push(data)
        encoded = json.loads(json.dumps(encode_stream_frame(frame)))
        value = frame.imu.quaternion[0]
        # JavaScript prints this float32 with its shortest digits padded by zeros: an integer
        # literal that is not the float's exact integer value but denotes the same double.
        literal = int(Decimal(repr(value)))
        self.assertNotEqual(literal, int(value))
        encoded["imu"]["quaternion"][0] = literal
        self.assertEqual(decode_stream_frame(encoded).imu.quaternion[0], value)

    def test_damaged_frames_are_rejected_before_use(self):
        def damaged(product, options, change):
            encoded = json.loads(json.dumps(encode_stream_frame(product_frames(product, options, 1)[0])))
            change(encoded)
            return encoded
        cases = {
            "alias on the wire": damaged("hand", {}, lambda f: f.update(product="pad")),
            "unknown product": damaged("hand", {}, lambda f: f.update(product="mystery")),
            "null product": damaged("hand", {}, lambda f: f.update(product=None)),
            "pressure differs from raw": damaged("hand", {}, lambda f: f["pressure"].__setitem__(0, (f["pressure"][0] + 1) % 256)),
            "invented sequence": damaged("handGloveSegmented", {"side": "left"}, lambda f: f.update(sequence=1)),
            "missing protocol": damaged("handGloveSegmented", {"side": "left"}, lambda f: f.pop("protocol")),
            "missing sequence": damaged("handGloveFullPacket", {"side": "left"}, lambda f: f.pop("sequence")),
            "padded palm": damaged("handGloveSegmented", {"side": "left"}, lambda f: f["palm"].update(rowLengths=[15] * 5)),
            "bad side": damaged("handGloveSegmented", {"side": "left"}, lambda f: f.update(side="both")),
            "short imu": damaged("handGloveSegmented", {"side": "left"}, lambda f: f["imu"].update(raw=[0] * 15)),
            "forged body index": damaged("humanBody", {}, lambda f: f["regions"]["back"]["sourceIndices"].__setitem__(0, 0)),
            "missing body region": damaged("humanBody", {}, lambda f: f["regions"].pop("chest")),
            "body value mismatch": damaged("humanBody", {}, lambda f: f["regions"]["back"]["values"].__setitem__(0, 2)),
            "insole sensor mismatch": damaged("jqInsole", {"side": "left"}, lambda f: f["sensors"]["raw"].__setitem__(0, (f["sensors"]["raw"][0] + 1) % 4096)),
            "insole wrong side layout": damaged("jqInsole", {"side": "left"}, lambda f: f.update(side="right")),
            "insole 12bit with sequence": damaged("jqInsole", {"side": "left"}, lambda f: f.update(sequence=1)),
            "insole imu mismatch": damaged("jqInsole", {"side": "left"}, lambda f: f["imu"]["quaternion"].__setitem__(0, 99)),
            "insole adc overflow": damaged("jqInsole", {"side": "left", "protocol": "8bit"}, lambda f: f["pressure"].__setitem__(0, 256)),
            "not finite": damaged("hand", {}, lambda f: f["values"].__setitem__(0, math.nan)),
            "string number": damaged("hand", {}, lambda f: f.update(rows="32")),
            "boolean number": damaged("hand", {}, lambda f: f.update(area=True)),
            "values length": damaged("hand", {}, lambda f: f["values"].pop()),
            "min above max": damaged("hand", {}, lambda f: f.update(min=2, max=1)),
            "center out of range": damaged("hand", {}, lambda f: f["center"].update(x=1.5)),
            "too many points": {"raw": [], "values": [0] * 16385, "rows": 1, "cols": 16385, "min": 0, "max": 0,
                                "avg": 0, "area": 0, "center": {"x": 0.5, "y": 0.5}, "timestamp": 1},
            "not an object": [1, 2, 3],
        }
        for name, encoded in cases.items():
            with self.subTest(name):
                error = assert_code(self, "PARSE_FAILED", decode_stream_frame, encoded)
                self.assertEqual(error.stage, "parse")
                assert_code(self, "PARSE_FAILED", encode_stream_frame, encoded)


@unittest.skipUnless(HAS_NODE, "Cross-language parity tests require Node and the full repository's JS reference")
class JavaScriptParityTests(unittest.TestCase):
    def test_all_layout_tables_menus_and_profiles_match(self):
        reference, = run_node("js_reference.mjs", [{"kind": "layouts"}])
        self.assertEqual(list(reference["layouts"]), list(LAYOUTS))
        for name in LAYOUTS:
            layout = get_named_layout(name)
            self.assertEqual({"rows": layout.rows, "cols": layout.cols, "perm": list(layout.perm)},
                             reference["layouts"][name], name)
        self.assertEqual(list_layouts(), reference["list"])
        self.assertEqual(list_products(), reference["products"])

        def snake(profile):
            return {"".join("_" + c.lower() if c.isupper() else c for c in key): value for key, value in profile.items()}
        self.assertEqual(list_device_products(), [snake(profile) for profile in reference["deviceProducts"]])

    def test_colormaps_match_for_every_palette(self):
        values = [index / 2000 for index in range(-20, 2021)] + [0.15, 0.25, 0.5, 0.75, 1 / 3, 0.001, 0.0011]
        reference, = run_node("js_reference.mjs", [{"kind": "colormap", "values": values}])
        self.assertEqual(set(reference), set(COLORMAPS))
        for name, palette in COLORMAPS.items():
            self.assertEqual([list(palette(value)) for value in values], reference[name], name)

    def test_decoding_with_every_named_layout_matches(self):
        rng = random.Random(21)
        cases = [{"kind": "frame", "payload": list(random_bytes(rng, get_named_layout(name).scan)),
                  "options": {"layout": name}} for name in LAYOUTS]
        for case, expected in zip(cases, run_node("js_reference.mjs", cases)):
            actual = decode_frame(bytes(case["payload"]), layout=case["options"]["layout"]).to_dict()
            actual["timestamp"] = 0
            self.assertEqual(actual, expected, case["options"]["layout"])

    def test_product_parsers_match_on_clean_streams_for_every_chunking(self):
        cases, actual = [], []
        for product, options in PRODUCT_CASES:
            rng = random.Random(5)
            stream = b"".join(wire_bytes(product, options, rng, index) for index in range(4))
            for step in (1, 7, 151, 556, len(stream)):
                chunks = [stream[i:i + step] for i in range(0, len(stream), step)]
                cases.append({"kind": "product", "product": product, "options": self.js_options(options),
                              "chunks": [list(chunk) for chunk in chunks]})
                actual.append(self.run_parser(product, options, chunks))
        for case, mine, expected in zip(cases, actual, run_node("js_reference.mjs", cases)):
            self.assertEqual(sum(len(step["frames"]) for step in mine), 4)
            self.assertEqual(mine, expected, (case["product"], case["options"], len(case["chunks"])))

    def test_product_parsers_match_on_corrupted_streams(self):
        cases, actual = [], []
        for seed in (1, 2):
            rng = random.Random(seed)
            for product, options in PRODUCT_CASES:
                for _ in range(5):
                    stream = b"".join(self.piece(product, options, rng, index) for index in range(rng.randrange(4, 12)))
                    mode = rng.choice(("tiny", "mixed", "big", "whole"))
                    chunks, position = [], 0
                    while position < len(stream):
                        step = {"tiny": rng.randrange(1, 6), "mixed": rng.choice((1, 3, 17, 150, 151, 556, 1028, 4096)),
                                "big": rng.randrange(200, 5000), "whole": len(stream)}[mode]
                        chunks.append(stream[position:position + step])
                        position += step
                    cases.append({"kind": "product", "product": product, "options": self.js_options(options),
                                  "chunks": [list(chunk) for chunk in chunks]})
                    actual.append(self.run_parser(product, options, chunks))
        frames = dropped = 0
        for case, mine, expected in zip(cases, actual, run_node("js_reference.mjs", cases)):
            self.assertEqual(mine, expected, (case["product"], case["options"], len(case["chunks"])))
            frames += sum(len(step["frames"]) for step in mine)
            dropped += mine[-1]["droppedCount"] if mine else 0
        # The corpus must exercise both delivery and recovery, otherwise the comparison proves little.
        self.assertGreater(frames, 100)
        self.assertGreater(dropped, 100)

    def test_javascript_accepts_python_frames_and_rejects_the_same_damage(self):
        frames = [frame for product, options in PRODUCT_CASES for frame in product_frames(product, options, 2)]
        encoded = [json.loads(json.dumps(encode_stream_frame(frame))) for frame in frames]
        damaged = json.loads(json.dumps(encoded[0]))
        damaged["sequence"] = 3
        result, = run_node("js_reference.mjs", [{"kind": "codec", "frames": [*encoded, damaged]}])
        for mine, theirs in zip(encoded, result):
            self.assertTrue(theirs["ok"], theirs)
            self.assertEqual(json.loads(json.dumps(mine), parse_int=float), theirs["frame"])
        self.assertEqual((result[-1]["ok"], result[-1]["code"], result[-1]["field"]), (False, "PARSE_FAILED", "sequence"))

    @staticmethod
    def js_options(options):
        return {("baudRate" if key == "baud_rate" else key): value for key, value in options.items()}

    @staticmethod
    def run_parser(product, options, chunks):
        parser = create_product_parser(product, **options)
        steps = []
        for chunk in chunks:
            frames = [wire(frame) for frame in parser.push(chunk)]
            steps.append({"frames": frames, "droppedCount": float(parser.dropped_count),
                          "frameLength": float(parser.frame_length)})
        return steps

    @staticmethod
    def piece(product, options, rng, index):
        """A valid unit or one of the corruptions seen on real links: truncation, noise, reordering."""
        def noise(size):
            return bytes(rng.choice((0xAA, 0x55, 0x03, 0x99, 1, 2, 3, rng.randrange(256))) for _ in range(size))
        good = wire_bytes(product, options, rng, index)
        roll = rng.random()
        if roll < 0.5:
            return good
        if roll < 0.6:
            return good[:rng.randrange(1, len(good))]
        if roll < 0.68:
            return noise(rng.randrange(1, 12)) + good
        if roll < 0.74:
            return TAIL
        if roll < 0.8:
            middle = len(good) // 2
            return good[:middle] + noise(rng.randrange(1, 9)) + good[middle:]
        if roll < 0.86:
            return good[len(good) // 2:] + good[:len(good) // 2]
        if roll < 0.92:
            return good + good[len(good) // 2:]
        if product == "jqInsole" and options.get("protocol") == "12bit" and roll < 0.96:
            return TAIL + struct.pack("<256H", *([5000] * 256)) + bytes(40)
        return noise(rng.randrange(1, 3000))
