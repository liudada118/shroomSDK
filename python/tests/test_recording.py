"""SQLite recording store: committed counts, draining, directory ownership, recovery and exports."""

from contextlib import closing
import csv
import io
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import time
import unittest

from shroom_sdk import ShroomError, create_recording_url, encode_stream_frame
from shroom_sdk.recording import (CSV_COLUMNS, RecordingStore, recording_csv, recording_from_wire,
                                  recording_jsonl, recording_to_wire)
from product_fixture import product_frames

OTHER_ID = "11111111-2222-4333-8444-555555555555"


def wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class RecordingStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = [encode_stream_frame(frame) for frame in product_frames("handGloveSegmented", {"side": "left"}, 3)]

    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name) / "recordings"
        self.stores = []
        self.addCleanup(self.close_stores)

    def close_stores(self):
        for store in self.stores:
            try:
                store.close()
            except ShroomError:
                pass

    def store(self, **options):
        store = RecordingStore(self.directory, **options)
        self.stores.append(store)
        return store

    def database(self):
        """A second connection, as another tool would open it; sqlite3's own context manager does not close."""
        return closing(sqlite3.connect(self.directory / "recordings.sqlite", isolation_level=None))

    def rows(self, query, *parameters):
        with self.database() as database:
            return database.execute(query, parameters).fetchall()

    def assert_code(self, code, callable_, *args, **kwargs):
        with self.assertRaises(ShroomError) as caught:
            callable_(*args, **kwargs)
        self.assertEqual((caught.exception.code, caught.exception.stage), (code, "recording"))
        return caught.exception

    def test_stop_drains_every_accepted_frame_and_counts_only_committed_rows(self):
        changes = []
        store = self.store(on_change=lambda meta: changes.append((meta["status"], meta["frame_count"])))
        started = store.start("  握力  ", product="handGloveSegmented", side="left", source="mock")
        self.assertEqual((started["label"], started["status"], started["frame_count"], started["ended_at"]),
                         ("握力", "recording", 0, None))
        for index in range(450):
            store.append(self.frames[index % 3])
        stopped = store.stop()
        self.assertEqual((stopped["status"], stopped["frame_count"], stopped["id"]), ("stopped", 450, started["id"]))
        self.assertGreaterEqual(stopped["ended_at"], stopped["started_at"])
        self.assertEqual(self.rows("SELECT COUNT(*), MIN(frame_index), MAX(frame_index) FROM frames"), [(450, 0, 449)])
        self.assertEqual(self.rows("SELECT frame_count, status, product, side, source FROM sessions"),
                         [(450, "stopped", "handGloveSegmented", "left", "mock")])
        self.assertEqual((changes[0], changes[-1]), (("recording", 0), ("stopped", 450)))
        self.assertEqual(store.stop()["frame_count"], 450)  # Repeated stop returns the same finished session.
        stopped["label"] = "changed"
        self.assertEqual(store.status()["label"], "握力")
        store.append(self.frames[0])  # Ignored after stop.
        self.assertEqual(store.list()[0]["frame_count"], 450)

    def test_low_rate_frames_are_committed_within_the_flush_interval(self):
        store = self.store()
        store.start("slow")
        store.append(self.frames[0])
        self.assertEqual(store.status()["frame_count"], 0)
        self.assertTrue(wait_until(lambda: store.status()["frame_count"] == 1, timeout=2))
        store.append(self.frames[1])
        self.assertEqual(store.stop()["frame_count"], 2)

    def test_labels_are_validated_and_only_one_session_runs(self):
        store = self.store()
        for label in ("", "   ", None, 7, "x" * 201, "line\nbreak", "tab\tseparated", "del\x7f"):
            with self.subTest(label=label):
                self.assert_code("INVALID_CONFIG", store.start, label)
        self.assert_code("RECORDING_NOT_ACTIVE", store.stop)
        self.assertIsNone(store.status())
        store.start("x" * 200)
        self.assert_code("RECORDING_ACTIVE", store.start, "second")
        store.stop()
        self.assertEqual(store.start("second")["label"], "second")
        self.assertEqual([meta["label"] for meta in store.list()][-1], "x" * 200)

    def test_bounded_queue_fails_explicitly_and_keeps_accepted_frames(self):
        store = self.store(max_queue_frames=3)
        started = store.start("overflow")
        for _ in range(50):
            store.append(self.frames[0])
        stopped = store.stop()
        self.assertEqual((stopped["status"], stopped["error"]["code"]), ("error", "RECORDING_OVERFLOW"))
        self.assertGreaterEqual(stopped["frame_count"], 3)
        self.assertLess(stopped["frame_count"], 50)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM frames")[0][0], stopped["frame_count"])
        # The partial recording can still be exported, and a new one can start.
        self.assertEqual(len(list(recording_jsonl(store.download(started["id"])))), stopped["frame_count"])
        self.assertEqual(store.start("next")["status"], "recording")

    def test_a_failed_batch_rolls_back_completely(self):
        store = self.store()
        started = store.start("conflict")
        with self.database() as other:
            other.execute("INSERT INTO frames VALUES (?, 3, 0, '{}')", (started["id"],))
        for _ in range(5):
            store.append(self.frames[0])
        stopped = store.stop()
        self.assertEqual((stopped["status"], stopped["frame_count"], stopped["error"]["code"]),
                         ("error", 0, "RECORDING_WRITE_FAILED"))
        self.assertNotIn(str(self.directory), stopped["error"]["message"])
        self.assertEqual(self.rows("SELECT frame_index FROM frames"), [(3,)])  # None of the new batch stayed.
        self.assertEqual(self.rows("SELECT frame_count, status FROM sessions"), [(0, "error")])

    def test_unserialisable_frames_end_the_recording_as_an_error(self):
        store = self.store()
        store.start("bad")
        store.append({"timestamp": 1, "values": [float("nan")]})
        self.assertEqual(store.stop()["error"]["code"], "RECORDING_WRITE_FAILED")

    def test_abort_keeps_the_cause_and_committed_frames(self):
        store = self.store()
        self.assertIsNone(store.abort(RuntimeError("nothing active")))
        store.start("interrupted")
        store.append(self.frames[0])
        error = ShroomError("device gone", code="DISCONNECTED", stage="read", suggestion="")
        aborted = store.abort(error)
        self.assertEqual((aborted["status"], aborted["frame_count"], aborted["error"]),
                         ("error", 1, {"code": "DISCONNECTED", "message": "device gone"}))
        self.assertEqual(store.abort(RuntimeError("again"))["error"]["code"], "DISCONNECTED")  # First cause wins.

    def test_one_directory_has_one_owner_and_restart_recovers_unfinished_sessions(self):
        first = self.store()
        started = first.start("crash")
        for index in range(250):
            first.append(self.frames[index % 3])
        self.assertTrue(wait_until(lambda: first.status()["frame_count"] >= 200))
        error = self.assert_code("RECORDING_WRITE_FAILED", RecordingStore, self.directory)
        self.assertNotIn(str(self.directory), str(error))
        committed = self.rows("SELECT COUNT(*) FROM frames")[0][0]
        first._database._release()  # The process dies: no stop, no close.
        second = self.store()
        recovered, = second.list()
        self.assertEqual((recovered["id"], recovered["status"], recovered["frame_count"], recovered["error"]["code"]),
                         (started["id"], "error", committed, "RECORDING_INTERRUPTED"))
        self.assertIsNotNone(recovered["ended_at"])
        self.assertEqual(len(list(recording_jsonl(second.download(started["id"])))), committed)
        second.close()
        second.close()
        self.assert_code("SERVER_CLOSED", second.start, "after close")

    def test_unknown_databases_are_never_overwritten(self):
        self.directory.mkdir(parents=True)
        with self.database() as database:
            database.execute("CREATE TABLE notes (text TEXT)")
            database.execute("INSERT INTO notes VALUES ('keep me')")
        self.assert_code("RECORDING_WRITE_FAILED", RecordingStore, self.directory)
        self.assertEqual(self.rows("SELECT text FROM notes"), [("keep me",)])
        with self.database() as database:
            database.execute("DROP TABLE notes")
            database.execute("PRAGMA user_version = 9")
        self.assert_code("RECORDING_WRITE_FAILED", RecordingStore, self.directory)
        for options in ({"max_queue_frames": 0}, {"max_queue_frames": True}):
            self.assert_code("INVALID_CONFIG", RecordingStore, self.directory, **options)
        self.assert_code("INVALID_CONFIG", RecordingStore, "")

    def test_exports_select_the_exact_recording_and_release_the_reader(self):
        store = self.store()
        ids = []
        for count in (2, 5):
            ids.append(store.start("same label")["id"])
            self.assert_code("RECORDING_ACTIVE", store.download, ids[-1])
            for index in range(count):
                store.append(self.frames[index % 3])
            store.stop()
        self.assertEqual([len(list(recording_jsonl(store.download(identifier)))) for identifier in ids], [2, 5])
        for identifier in (OTHER_ID, "not-an-id", "../recordings", None):
            self.assert_code("RECORDING_NOT_FOUND", store.download, identifier)
        descriptor = store.download(ids[1])
        self.assertEqual((descriptor["format"], descriptor["meta"]["frame_count"]), ("sqlite", 5))
        rows = [json.loads(line) for line in recording_jsonl(descriptor)]
        self.assertEqual(list(rows[0]), ["schema", "sessionId", "label", "index", "timestamp", "source", "frame"])
        self.assertEqual([row["index"] for row in rows], [0, 1, 2, 3, 4])
        self.assertEqual((rows[0]["schema"], rows[0]["sessionId"], rows[0]["frame"]), ("shroom.frame.v1", ids[1], self.frames[0]))
        # An export abandoned half-way must not block later recordings or keep the file open.
        partial = recording_jsonl(descriptor)
        next(partial)
        later = store.start("after a paused export")
        store.append(self.frames[0])
        self.assertEqual(store.stop()["frame_count"], 1)
        partial.close()
        self.assertEqual(len(list(recording_jsonl(store.download(later["id"])))), 1)
        self.assert_code("RECORDING_NOT_FOUND", lambda: list(recording_jsonl({**descriptor, "meta": {"id": OTHER_ID}})))
        self.assert_code("INVALID_CONFIG", lambda: list(recording_csv({"path": descriptor["path"], "format": "xml"})))

    def test_csv_is_streamed_with_bom_quotes_and_formula_protection(self):
        store = self.store()
        started = store.start('=HYPERLINK("http://x","y")', product="handGloveSegmented", side="left", source="@mock")
        store.append(self.frames[0])
        store.stop()
        text = "".join(recording_csv(store.download(started["id"])))
        self.assertTrue(text.startswith("\ufeff"))
        self.assertTrue(text.endswith("\r\n"))
        header, row = list(csv.reader(io.StringIO(text[1:], newline="")))
        self.assertEqual(tuple(header), CSV_COLUMNS)
        cells = dict(zip(header, row))
        self.assertEqual((cells["label"], cells["source"]), ("'=HYPERLINK(\"http://x\",\"y\")", "'@mock"))
        self.assertEqual((cells["sessionId"], cells["index"], cells["product"], cells["side"], cells["sequence"]),
                         (started["id"], "0", "handGloveSegmented", "left", ""))
        self.assertEqual(json.loads(cells["raw"]), self.frames[0]["raw"])
        self.assertEqual(json.loads(cells["palm"])["rowLengths"], [12, 15, 15, 15, 15])
        self.assertEqual(json.loads(cells["frame"]), self.frames[0])

    def test_legacy_jsonl_recordings_stay_readable_and_untouched(self):
        self.directory.mkdir(parents=True)
        finished, unfinished = OTHER_ID, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        line = json.dumps({"schema": "shroom.frame.v1", "sessionId": finished, "label": "old", "index": 0,
                           "timestamp": 5, "source": "node-serial", "frame": self.frames[0]})
        files = {
            f"{finished}.meta.json": json.dumps({"id": finished, "label": "old", "startedAt": 10, "endedAt": 20,
                                                 "frameCount": 1, "status": "stopped", "product": "hand"}),
            f"{finished}.jsonl": line + "\n",
            f"{unfinished}.meta.json": json.dumps({"id": unfinished, "label": "cut", "startedAt": 30, "endedAt": None,
                                                   "frameCount": 0, "status": "recording"}),
            f"{unfinished}.jsonl": "",
            "not-a-recording.meta.json": "{}",
            "cccccccc-dddd-4eee-8fff-000000000000.meta.json": "{broken",
        }
        for name, content in files.items():
            (self.directory / name).write_text(content, encoding="utf-8")
        store = self.store()
        listed = {meta["id"]: meta for meta in store.list()}
        self.assertEqual(set(listed), {finished, unfinished})
        self.assertEqual((listed[finished]["status"], listed[finished]["frame_count"], listed[finished]["product"]),
                         ("stopped", 1, "hand"))
        self.assertEqual((listed[unfinished]["status"], listed[unfinished]["error"]["code"]), ("error", "RECORDING_INTERRUPTED"))
        descriptor = store.download(finished)
        self.assertEqual(descriptor["format"], "jsonl")
        self.assertEqual(list(recording_jsonl(descriptor)), [line + "\n"])
        self.assertEqual(len(list(recording_csv(descriptor))), 2)
        self.assertEqual(len(list(recording_csv(descriptor["path"]))), 2)  # A bare path is still accepted.
        store.close()
        for name, content in files.items():
            self.assertEqual((self.directory / name).read_text(encoding="utf-8"), content)

    def test_wire_names_and_download_urls(self):
        meta = {"id": OTHER_ID, "label": "x", "started_at": 1, "ended_at": 2, "frame_count": 3, "status": "error",
                "product": "hand", "error": {"code": "RECORDING_OVERFLOW", "message": "full"}}
        wire = recording_to_wire(meta)
        self.assertEqual(wire, {"id": OTHER_ID, "label": "x", "startedAt": 1, "endedAt": 2, "frameCount": 3,
                                "status": "error", "product": "hand", "error": {"code": "RECORDING_OVERFLOW", "message": "full"}})
        self.assertEqual(recording_from_wire(wire), meta)
        self.assertIsNone(recording_to_wire(None))
        self.assertIsNone(recording_from_wire("x"))
        self.assertEqual(create_recording_url("ws://127.0.0.1:19999/ws?token=1", OTHER_ID),
                         f"http://127.0.0.1:19999/recordings/{OTHER_ID}.csv")
        self.assertEqual(create_recording_url("wss://sensors.example", OTHER_ID, format="jsonl"),
                         f"https://sensors.example/recordings/{OTHER_ID}.jsonl")
        self.assertEqual(create_recording_url("http://[::1]:8080", OTHER_ID), f"http://[::1]:8080/recordings/{OTHER_ID}.csv")
        for arguments, options in (((("ws://x", "label")), {}), (("ws://x", OTHER_ID), {"format": "xlsx"}),
                                   (("ws://x", None), {}), (("", OTHER_ID), {})):
            with self.subTest(arguments=arguments, options=options), self.assertRaises(ValueError) as caught:
                create_recording_url(*arguments, **options)
            self.assertEqual(caught.exception.code, "INVALID_CONFIG")
