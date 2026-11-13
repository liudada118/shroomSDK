"""Interoperability with the JavaScript SDK: its browser client, its Node server and its SQLite files."""

from contextlib import closing
import csv
import io
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import time
import unittest

from shroom_sdk import (GloveFrame, PadFrame, ShroomError, connect_stream, encode_stream_frame, read_product,
                        serve_device, start_recording, stop_recording, download_recording)
from shroom_sdk.recording import RecordingStore, recording_csv, recording_jsonl
from license_fixture import LicensedTestCase
from product_fixture import HAS_NODE_PACKAGES, PRODUCT_CASES, REPOSITORY, TESTS, PushSource, product_frames, run_node


def wait_until(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def numbers(value):
    """Compare JSON from both runtimes as numbers: 1 and 1.0 are the same value on the wire."""
    return json.loads(json.dumps(value), parse_int=float)


def node_process(*arguments):
    return subprocess.Popen(["node", str(TESTS / "js_interop.mjs"), *arguments], cwd=REPOSITORY, text=True,
                            encoding="utf-8", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


@unittest.skipUnless(HAS_NODE_PACKAGES, "Interoperability tests need Node and the repository's installed npm packages")
class JavaScriptInteropTests(LicensedTestCase):
    def setUp(self):
        super().setUp()
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name)

    def test_javascript_client_decodes_records_and_downloads_from_the_python_server(self):
        for product, options in PRODUCT_CASES[::2] + PRODUCT_CASES[5:6]:
            with self.subTest(product=product, options=options):
                frames = product_frames(product, options, 3)
                source = PushSource({"source": "interop", "product": product, **options})
                name = f"{product}-{options.get('protocol', '')}"
                with serve_device(source, port=0, recordings_dir=self.directory / name) as server:
                    process = node_process("client", server.url, "6", f"互通 {name}")
                    try:
                        ready = json.loads(process.stdout.readline() or "null")
                        self.assertIsNotNone(ready, process.stderr.read() if ready is None else "")
                        json.loads(process.stdout.readline())  # The JS side has started its recording.
                        for index in range(6):
                            source.push(frames[index % 3])
                        output, errors = process.communicate(timeout=60)
                    finally:
                        process.kill()
                    self.assertEqual(process.returncode, 0, errors[-2000:])
                    done = json.loads(output)
                self.assertEqual(ready["info"], {"source": "interop", "product": product, **options})
                # Every frame passed the strict JS validator and came back identical after its own re-encoding.
                self.assertEqual(numbers(done["frames"]), [numbers(encode_stream_frame(frames[i % 3])) for i in range(6)])
                self.assertEqual(done["errors"], [])
                self.assertEqual((done["stopped"]["id"], done["stopped"]["status"], done["stopped"]["frameCount"],
                                  done["stopped"]["label"], done["stopped"]["product"]),
                                 (done["started"]["id"], "stopped", 6, f"互通 {name}", product))
                self.assertEqual([meta["id"] for meta in done["list"]], [done["started"]["id"]])
                self.assertEqual((done["csv"]["status"], done["csv"]["type"], done["jsonl"]["status"], done["jsonl"]["type"]),
                                 (200, "text/csv; charset=utf-8", 200, "application/x-ndjson; charset=utf-8"))
                self.assertIn(f'shroom-{done["started"]["id"]}.csv', done["csv"]["disposition"])
                rows = [json.loads(line) for line in done["jsonl"]["body"].splitlines()]
                self.assertEqual(numbers([row["frame"] for row in rows]), numbers(done["frames"]))
                self.assertEqual(len(done["csv"]["body"].splitlines()), 7)

    def test_python_client_reads_and_controls_the_javascript_server(self):
        for product, side, kind in (("handGloveSegmented", "right", GloveFrame), ("hand", "-", PadFrame)):
            with self.subTest(product=product):
                process = node_process("server", product, side, str(self.directory / f"js-{product}"))
                try:
                    line = process.stdout.readline()
                    self.assertTrue(line, process.stderr.read() if not line else "")
                    address = json.loads(line)
                    received, errors = [], []
                    with read_product(url=address["url"], on_data=received.append, on_error=errors.append) as stream:
                        self.assertEqual((stream.info["product"], stream.info["source"]), (product, "mock"))
                        started = start_recording(stream, label="来自 Python")
                        self.assertTrue(wait_until(lambda: len(received) >= 5))
                        stopped = stop_recording(stream)
                        self.assertEqual((stopped["id"], stopped["status"], stopped["label"], stopped["product"]),
                                         (started["id"], "stopped", "来自 Python", product))
                        self.assertGreaterEqual(stopped["frame_count"], 3)
                        self.assertEqual([meta["id"] for meta in stream.list_recordings()], [started["id"]])
                        target = download_recording(stream, self.directory / f"{product}.jsonl", format="jsonl")
                        rows = [json.loads(text) for text in target.read_text(encoding="utf-8").splitlines()]
                        self.assertEqual(len(rows), stopped["frame_count"])
                        csv_file = download_recording(stream, self.directory / f"{product}.csv")
                        self.assertEqual(len(csv_file.read_text(encoding="utf-8-sig").splitlines()), len(rows) + 1)
                        with self.assertRaises(ShroomError) as caught:
                            stream.start_recording("x" * 201)
                        self.assertEqual(caught.exception.code, "INVALID_CONFIG")
                    self.assertTrue(all(isinstance(frame, kind) for frame in received))
                    self.assertEqual(errors, [])
                    if kind is GloveFrame:
                        self.assertEqual((received[0].side, received[0].protocol, received[0].palm.row_lengths),
                                         ("right", "segmented", (12, 15, 15, 15, 15)))
                    # Frames recorded by the JS server decode with the Python codec and match what was streamed.
                    recorded = [numbers(row["frame"]) for row in rows]
                    streamed = [numbers(encode_stream_frame(frame)) for frame in received]
                    self.assertTrue(all(frame in streamed for frame in recorded))
                finally:
                    try:
                        process.communicate("stop\n", timeout=30)
                    finally:
                        process.kill()
                self.assertEqual(process.returncode, 0)

    def test_recording_directories_are_readable_by_both_sdks(self):
        frames = [encode_stream_frame(frame) for frame in product_frames("handGloveSegmented", {"side": "left"}, 3)]
        python_directory = self.directory / "written-by-python"
        with closing(RecordingStore(python_directory)) as store:
            started = store.start("跨语言 =1+1", product="handGloveSegmented", side="left", source="mock")
            for frame in frames:
                store.append(frame)
            stopped = store.stop()
            python_jsonl = "".join(recording_jsonl(store.download(started["id"])))
            python_csv = "".join(recording_csv(store.download(started["id"])))
        from_js = run_node("js_interop.mjs", None, "store-read", str(python_directory), started["id"])
        self.assertEqual([(meta["id"], meta["label"], meta["status"], meta["frameCount"], meta["product"], meta["side"],
                           meta["source"], meta["startedAt"], meta["endedAt"]) for meta in from_js["list"]],
                         [(started["id"], "跨语言 =1+1", "stopped", 3.0, "handGloveSegmented", "left", "mock",
                           float(stopped["started_at"]), float(stopped["ended_at"]))])
        self.assertEqual(from_js["jsonl"], python_jsonl)  # Stored rows are exported byte for byte.
        self.assertEqual(self.cells(from_js["csv"]), self.cells(python_csv))

        js_directory = self.directory / "written-by-js"
        process = node_process("store-write", str(js_directory), "JS 写入")
        output, errors = process.communicate(json.dumps(frames) + "\n", timeout=60)
        self.assertEqual(process.returncode, 0, errors[-2000:])
        written = json.loads(output)
        with closing(RecordingStore(js_directory)) as store:
            listed, = store.list()
            self.assertEqual((listed["id"], listed["label"], listed["status"], listed["frame_count"], listed["product"],
                              listed["side"], listed["source"], listed["started_at"], listed["ended_at"]),
                             (written["stopped"]["id"], "JS 写入", "stopped", 3, "handGloveSegmented", "left", "interop",
                              written["stopped"]["startedAt"], written["stopped"]["endedAt"]))
            rows = [json.loads(line) for line in recording_jsonl(store.download(listed["id"]))]
            self.assertEqual(numbers([row["frame"] for row in rows]), numbers(frames))
            self.assertEqual(([row["index"] for row in rows], rows[0]["label"], rows[0]["schema"]),
                             ([0, 1, 2], "JS 写入", "shroom.frame.v1"))
            # The same directory keeps working: a Python recording is appended next to the JS one.
            again = store.start("追加")
            store.append(frames[0])
            self.assertEqual(store.stop()["frame_count"], 1)
            self.assertEqual({meta["label"] for meta in store.list()}, {"JS 写入", "追加"})
        after = run_node("js_interop.mjs", None, "store-read", str(js_directory), again["id"])
        self.assertEqual(sorted(meta["label"] for meta in after["list"]), ["JS 写入", "追加"])

    @staticmethod
    def cells(text):
        """CSV cells with embedded JSON parsed, so number formatting differences do not matter."""
        rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"), newline="")))
        parsed = []
        for row in rows:
            cells = []
            for cell in row:
                try:
                    cells.append(numbers(json.loads(cell)) if cell[:1] in "[{" else cell)
                except ValueError:
                    cells.append(cell)
            parsed.append(cells)
        return parsed
