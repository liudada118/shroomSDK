import json
import math
from pathlib import Path
import random
import shutil
import subprocess
import unittest

from shroom_sdk import DEFAULT_DELIMITER, Framer, decode_frame, get_layout, render_ascii, resolve_shape


class FrameTests(unittest.TestCase):
    def test_statistics_and_float32(self):
        frame = decode_frame(bytes([0, 64, 128, 255]), threshold=0.3)
        self.assertEqual((frame.rows, frame.cols), (2, 2))
        self.assertEqual(frame.values.typecode, "f")
        self.assertEqual(frame.area, 2)
        self.assertEqual(frame.min, 0)
        self.assertEqual(frame.max, 1)
        self.assertAlmostEqual(frame.avg, (64 + 128 + 255) / 255 / 4)
        self.assertAlmostEqual(frame.center.x, 255 / (128 + 255))
        self.assertEqual(frame.center.y, 1)
        self.assertGreater(frame.timestamp, 1_000_000_000_000)
        self.assertEqual(frame.matrix(), [list(frame.values[:2]), list(frame.values[2:])])
        json.dumps(frame.to_dict())

    def test_empty_padding_and_points(self):
        empty = decode_frame(b"")
        self.assertEqual(empty.to_dict()["center"], {"x": 0.5, "y": 0.5})
        self.assertEqual((empty.rows, empty.cols, empty.avg, empty.min), (0, 0, 0, 0))
        frame = decode_frame(b"\xff\x80\x01", points=1, rows=2, cols=2)
        self.assertEqual(frame.raw, b"\xff")
        self.assertEqual(list(frame.values), [1, 0, 0, 0])
        self.assertEqual(resolve_shape(6), (1, 6))

    def test_layout_moves_values_and_center_but_not_raw(self):
        raw = bytearray(1024)
        raw[15 * 32] = 255
        frame = decode_frame(raw, layout="mat32")
        self.assertEqual(frame.values[0], 1)
        self.assertEqual(frame.raw, bytes(raw))
        self.assertEqual((frame.center.x, frame.center.y), (0, 0))
        self.assertEqual(len(set(get_layout("mat32", 32, 32))), 1024)
        custom = decode_frame(b"\xff\0\0\0", layout=[3, 2, 1, 0])
        self.assertEqual((custom.center.x, custom.center.y), (1, 1))

    def test_input_snapshot(self):
        raw = bytearray([255])
        frame = decode_frame(raw)
        raw[0] = 0
        self.assertEqual(frame.raw, b"\xff")
        self.assertEqual(frame.values[0], 1)

    def test_invalid_options_fail_explicitly(self):
        for options in ({"rows": 2}, {"rows": -1, "cols": 2}, {"points": -1},
                        {"full_scale": 0}, {"full_scale": math.nan}, {"threshold": math.inf},
                        {"layout": "typo"}, {"layout": "mat32"}, {"layout": [0, 0, 1, 2]}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                decode_frame(bytes(4), **options)
        with self.assertRaises(TypeError):
            decode_frame(12)

    def test_ascii(self):
        frame = decode_frame(b"\0\xff\0\xff")
        self.assertEqual(render_ascii(frame), " @")
        self.assertEqual(render_ascii(decode_frame(b"")), "")
        with self.assertRaises(ValueError):
            render_ascii(frame, width=0)


class FramerTests(unittest.TestCase):
    def test_fragmented_stream_and_partial_frame(self):
        framer = Framer()
        payload = bytes(range(16))
        stream = b"noise" + DEFAULT_DELIMITER + payload + DEFAULT_DELIMITER
        result = []
        for byte in stream[:-1]:
            result += framer.push(bytes([byte]))
        self.assertEqual(result, [])
        self.assertEqual(framer.push(stream[-1:]), [payload])

    def test_lock_relock_and_reset(self):
        framer = Framer()
        framer.push(DEFAULT_DELIMITER)
        for _ in range(3):
            self.assertEqual(framer.push(bytes(16) + DEFAULT_DELIMITER), [bytes(16)])
        self.assertEqual(framer.frame_length, 16)
        for _ in range(11):
            self.assertEqual(framer.push(bytes(9) + DEFAULT_DELIMITER), [])
        self.assertEqual(framer.push(bytes(9) + DEFAULT_DELIMITER), [bytes(9)])
        self.assertEqual((framer.frame_length, framer.dropped_count), (9, 11))
        framer.reset()
        self.assertEqual((framer.frame_length, framer.dropped_count), (0, 0))
        self.assertEqual(framer.push(DEFAULT_DELIMITER + bytes(16)), [])

    def test_variable_lengths_and_invalid_frames(self):
        framer = Framer(min_length=2, max_length=8, lock_length=False)
        wire = DEFAULT_DELIMITER.join([b"", b"1", b"12", b"123456789", b"123", b""])
        self.assertEqual(framer.push(wire), [b"12", b"123"])
        self.assertEqual(framer.dropped_count, 2)
        self.assertEqual(framer.frame_length, 0)

    def test_bounded_buffer_and_single_byte_delimiter(self):
        framer = Framer(delimiter=b"|", min_length=1, max_length=8)
        self.assertEqual(framer.push(b"x" * 100_000), [])
        self.assertEqual(framer.push(b"|a|"), [b"a"])
        framer.push(b"z" * 100_000)
        self.assertLessEqual(len(framer._buffer), 8)

    def test_invalid_framer_options(self):
        for options in ({"delimiter": b""}, {"min_length": 0}, {"max_length": 7}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                Framer(**options)


@unittest.skipUnless(shutil.which("node") and (Path(__file__).resolve().parents[2] / "core/frame.js").exists(),
                     "Cross-language parity tests require Node and the full repository's JS reference")
class JavaScriptParityTests(unittest.TestCase):
    def reference(self, cases):
        result = subprocess.run(["node", str(Path(__file__).with_name("js_reference.mjs"))],
                                input=json.dumps(cases), capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_frame_parity(self):
        rng = random.Random(17)
        cases = [
            {"kind": "frame", "payload": [], "options": {}},
            {"kind": "frame", "payload": [0, 64, 128, 255], "options": {"threshold": 0.3}},
            {"kind": "frame", "payload": [255, 1, 2], "options": {"rows": 2, "cols": 3}},
            {"kind": "frame", "payload": list(range(16)), "options": {"points": 9, "fullScale": 200}},
            {"kind": "frame", "payload": list(range(16)), "options": {"rows": 1, "cols": 4}},
            {"kind": "frame", "payload": [rng.randrange(256) for _ in range(1024)], "options": {"layout": "mat32"}},
        ]
        for size in (1, 6, 9, 256, 1024):
            cases.append({"kind": "frame", "payload": [rng.randrange(256) for _ in range(size)], "options": {}})
        for case, expected in zip(cases, self.reference(cases)):
            with self.subTest(size=len(case["payload"]), options=case["options"]):
                options = {("full_scale" if key == "fullScale" else key): value for key, value in case["options"].items()}
                actual = decode_frame(bytes(case["payload"]), **options).to_dict()
                actual["timestamp"] = 0
                self.assertEqual(actual, expected)

    def test_framer_parity_for_chunk_boundaries_and_relocking(self):
        d = DEFAULT_DELIMITER
        stream = b"noise" + d + b"".join(bytes([7]) * n + d for n in ([16] * 4 + [2, 20, 16] + [9] * 12 + [16] * 2))
        cases = []
        for step in (1, 3, 17, len(stream)):
            cases.append({"kind": "framer", "options": {}, "chunks": [list(stream[i:i + step]) for i in range(0, len(stream), step)]})
        cases += [
            {"kind": "framer", "options": {"lockLength": False}, "chunks": [list(stream)]},
            {"kind": "framer", "options": {"minLength": 2, "maxLength": 8}, "chunks": [list(stream), list(b"x" * 200), list(d + b"12" + d)]},
            {"kind": "framer", "options": {"delimiter": [124], "minLength": 1}, "chunks": [list(b"xx"), list(b"|a|bc|")]},
        ]
        names = {"lockLength": "lock_length", "minLength": "min_length", "maxLength": "max_length"}
        for case, expected in zip(cases, self.reference(cases)):
            framer = Framer(**{names.get(k, k): v for k, v in case["options"].items()})
            actual = []
            for chunk in case["chunks"]:
                frames = framer.push(bytes(chunk))
                actual.append({"frames": [list(f) for f in frames], "droppedCount": framer.dropped_count,
                               "frameLength": framer.frame_length})
            self.assertEqual(actual, expected)
