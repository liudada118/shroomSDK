"""Shared builders for product wire bytes and a controllable custom data source."""

import json
from pathlib import Path
import random
import shutil
import struct
import subprocess

from shroom_sdk import create_product_parser, encode_stream_frame

TAIL = bytes.fromhex("AA550399")
TESTS = Path(__file__).resolve().parent
REPOSITORY = TESTS.parents[1]
HAS_NODE = bool(shutil.which("node")) and (REPOSITORY / "src/core/product.js").exists()
HAS_NODE_PACKAGES = HAS_NODE and all((REPOSITORY / "node_modules" / name).exists() for name in ("ws", "better-sqlite3"))

#: Every supported protocol with the options a caller has to state explicitly.
PRODUCT_CASES = (
    ("handGloveSegmented", {"side": "left"}),
    ("handGloveSegmented", {"side": "right"}),
    ("handGloveFullPacket", {"side": "left"}),
    ("handGloveFullPacket", {"side": "right"}),
    ("hand", {}),
    ("humanBody", {}),
    ("jqInsole", {"side": "left", "protocol": "12bit"}),
    ("jqInsole", {"side": "right", "protocol": "12bit"}),
    ("jqInsole", {"side": "left", "protocol": "8bit"}),
    ("jqInsole", {"side": "right", "protocol": "8bit"}),
)


def random_bytes(rng: random.Random, size: int) -> bytes:
    return bytes(rng.randrange(256) for _ in range(size))


def segmented_first(pressure: bytes, packet_type: int = 2) -> bytes:
    return bytes((1, packet_type)) + pressure[:128] + TAIL


def segmented_second(pressure: bytes, packet_type: int = 2, imu: bytes = bytes(16)) -> bytes:
    return bytes((2, packet_type)) + pressure[128:256] + imu + TAIL


def segmented_pair(pressure: bytes, packet_type: int = 2, imu: bytes = bytes(16)) -> bytes:
    return segmented_first(pressure, packet_type) + segmented_second(pressure, packet_type, imu)


def full_packet(pressure: bytes, sequence: int = 0, packet_type: int = 2, imu: bytes = bytes(16)) -> bytes:
    return bytes((sequence, packet_type)) + pressure + imu + TAIL


def insole_12bit(adc, imu=(1.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3, 0.0, 0.0, 9.8)) -> bytes:
    return TAIL + struct.pack("<256H", *adc) + struct.pack("<10f", *imu)


def insole_8bit_first(adc: bytes, index: int) -> bytes:
    return TAIL + bytes((1, index)) + adc[:128]


def insole_8bit_second(adc: bytes, index: int, imu=(1.0, 0.0, 0.0, 0.0)) -> bytes:
    return TAIL + bytes((2, index)) + adc[128:256] + struct.pack("<4f", *imu)


def wire_bytes(product: str, options: dict, rng: random.Random, index: int = 0) -> bytes:
    """One complete, valid transmission unit for the given product."""
    if product == "handGloveSegmented":
        return segmented_pair(random_bytes(rng, 256), packet_type=rng.randrange(256), imu=random_bytes(rng, 16))
    if product == "handGloveFullPacket":
        return full_packet(random_bytes(rng, 256), index & 255, rng.randrange(256), random_bytes(rng, 16))
    if product in ("hand", "humanBody"):
        return random_bytes(rng, 1024) + TAIL
    if options.get("protocol") == "8bit":
        adc = random_bytes(rng, 256)
        imu = [rng.uniform(-1, 1) for _ in range(4)]
        return insole_8bit_first(adc, index & 255) + insole_8bit_second(adc, index & 255, imu)
    return insole_12bit([rng.randrange(4096) for _ in range(256)], [rng.uniform(-20, 20) for _ in range(10)])


def product_frames(product: str, options: dict, count: int = 3, seed: int = 11) -> list:
    """Frames produced by the real parser from synthetic bytes."""
    rng = random.Random(seed)
    parser = create_product_parser(product, **options)
    frames = []
    for index in range(count):
        frames += parser.push(wire_bytes(product, options, rng, index))
    assert len(frames) == count, (product, options, len(frames))
    return frames


def wire(frame, *, keep_timestamp: bool = False) -> dict:
    """JSON-normalised wire form; integers and floats compare as numbers on both sides."""
    encoded = encode_stream_frame(frame)
    if not keep_timestamp:
        encoded = {**encoded, "timestamp": 0}
    return json.loads(json.dumps(encoded), parse_int=float)


def run_node(script: str, cases=None, *arguments: str, timeout: float = 120):
    """Run a helper in tests/ with JSON on stdin and return the parsed JSON it prints."""
    result = subprocess.run(["node", str(TESTS / script), *arguments], capture_output=True, text=True,
                            input=None if cases is None else json.dumps(cases), encoding="utf-8",
                            cwd=REPOSITORY, timeout=timeout)
    if result.returncode:
        raise AssertionError(f"node {script} failed: {result.stderr[-2000:]}")
    return json.loads(result.stdout, parse_int=float)


class PushSource:
    """A caller-owned data source: frames are delivered only when the test pushes them."""

    def __init__(self, info=None, state="open"):
        self.info = info if info is not None else {"source": "custom"}
        self.state = state
        self.handlers, self.error_handlers = [], []
        self.closed = False

    def on_data(self, handler):
        self.handlers.append(handler)
        return lambda: self.handlers.remove(handler) if handler in self.handlers else None

    def on_error(self, handler):
        self.error_handlers.append(handler)
        return lambda: self.error_handlers.remove(handler) if handler in self.error_handlers else None

    def push(self, frame):
        for handler in list(self.handlers):
            handler(frame)

    def fail(self, error):
        for handler in list(self.error_handlers):
            handler(error)

    def close(self):
        self.closed = True
