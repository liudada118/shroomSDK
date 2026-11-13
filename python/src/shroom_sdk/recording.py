"""单会话 SQLite 采集：批量事务保存完整帧，CSV / JSONL 仅在下载时导出。

数据库结构（v1）、目录独占锁和逐行 JSON 与 JavaScript SDK 相同，同一个录制目录可由
两种语言的服务先后打开（不能同时）。对外的会话快照使用 snake_case 键；写入数据库的
逐帧 JSON 与导出文件保持 JavaScript SDK 的字段名。
"""

from collections import deque
import json
import os
from pathlib import Path
import re
import sqlite3
from threading import Condition, Event, RLock, Thread
from time import monotonic, time_ns
from urllib.parse import quote, urlsplit
import uuid

from .errors import ShroomError, make_error
from .stream_codec import STREAM_SCHEMA

#: 仅接受 SDK 生成的 UUID v4；下载接口不接受任意文件路径。
RECORDING_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z", re.IGNORECASE)
RECORDING_DATABASE_VERSION = 1
MAX_QUEUE_BYTES = 16 * 1024 * 1024
BATCH_SIZE = 200
FLUSH_INTERVAL = 0.25
CSV_COLUMNS = ("sessionId", "label", "index", "timestamp", "source", "product", "side", "sequence",
               "raw", "pressure", "pressureMatrix", "fingers", "palm", "frame")
_INTERRUPTED = {"code": "RECORDING_INTERRUPTED", "message": "上次服务退出前未正常停止录制；文件可能不完整。"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_FORMULA = re.compile(r"[\s\x00-\x1f]*[=+\-@]")
_SCHEMA = (
    """CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            frame_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK (status IN ('recording', 'stopped', 'error')),
            product TEXT,
            side TEXT,
            source TEXT,
            error_json TEXT
          )""",
    """CREATE TABLE frames (
            session_id TEXT NOT NULL REFERENCES sessions(id),
            frame_index INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            row_json TEXT NOT NULL,
            PRIMARY KEY (session_id, frame_index)
          )""",
    "PRAGMA user_version = 1",
)


def _now_ms() -> int:
    return time_ns() // 1_000_000


def _dumps(value) -> str:
    """与 JSON.stringify 相同的紧凑格式；非有限数值视为无法序列化。"""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _recording_error(code: str, message: str, cause: BaseException | None = None) -> ShroomError:
    """将底层异常归入录制阶段，公开消息不包含本机磁盘路径。"""
    return make_error(code, message, stage="recording", cause=cause,
                      suggestion="请检查录制目录的权限、磁盘空间和采集状态后重试。")


_ANY_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z", re.IGNORECASE)


def create_recording_url(service_url: str, recording_id: str, *, format: str = "csv") -> str:
    """从 WS/WSS 或 HTTP/HTTPS 服务地址构造同主机、同端口的下载 URL。

    recording_id 必须是采集记录 UUID，format 仅支持 csv / jsonl。只拼地址，
    不检查记录是否存在或是否已经写完，也不发起下载。
    """
    if not isinstance(recording_id, str) or not _ANY_UUID.match(recording_id):
        raise make_error("INVALID_CONFIG", "必须传入采集记录 ID（recording['id']），不能使用标签、产品 ID 或 WS 端口",
                         stage="stream")
    if format not in ("csv", "jsonl"):
        raise make_error("INVALID_CONFIG", "下载格式仅支持 csv 或 jsonl", stage="stream")
    try:
        parsed = urlsplit(service_url)
        host, port = parsed.hostname, parsed.port
    except (ValueError, AttributeError, TypeError) as exc:
        raise make_error("INVALID_CONFIG", "服务地址无效", stage="stream", cause=exc) from exc
    if not host:
        raise make_error("INVALID_CONFIG", "服务地址无效", stage="stream")
    scheme = "https" if parsed.scheme in ("wss", "https") else "http"
    authority = (f"[{host}]" if ":" in host else host) + (f":{port}" if port else "")
    return f"{scheme}://{authority}/recordings/{recording_id}.{format}"


def recording_to_wire(meta: dict | None) -> dict | None:
    """把会话快照转成 WS / 旧元信息文件使用的 camelCase 字段。"""
    if meta is None:
        return None
    wire = {"id": meta["id"], "label": meta["label"], "startedAt": meta["started_at"],
            "endedAt": meta["ended_at"], "frameCount": meta["frame_count"], "status": meta["status"]}
    for key in ("product", "side", "source"):
        if meta.get(key):
            wire[key] = meta[key]
    if meta.get("error"):
        wire["error"] = dict(meta["error"])
    return wire


def recording_from_wire(wire) -> dict | None:
    """把服务端的 camelCase 会话信息转成 snake_case 快照；结构不符时返回 None。"""
    if not isinstance(wire, dict) or not isinstance(wire.get("id"), str):
        return None
    meta = {"id": wire["id"], "label": wire.get("label"), "started_at": wire.get("startedAt"),
            "ended_at": wire.get("endedAt"), "frame_count": wire.get("frameCount", 0),
            "status": wire.get("status")}
    for key in ("product", "side", "source"):
        if wire.get(key):
            meta[key] = wire[key]
    if isinstance(wire.get("error"), dict):
        meta["error"] = {"code": wire["error"].get("code"), "message": wire["error"].get("message")}
    return meta


def _snapshot(meta: dict | None) -> dict | None:
    """返回独立状态快照，外部修改不会影响内部会话或历史列表。"""
    if meta is None:
        return None
    copy = dict(meta)
    if meta.get("error"):
        copy["error"] = dict(meta["error"])
    return copy


def _session_from_row(row) -> dict:
    meta = {"id": row[0], "label": row[1], "started_at": row[2], "ended_at": row[3],
            "frame_count": row[4], "status": row[5]}
    for key, value in zip(("product", "side", "source"), row[6:9]):
        if value:
            meta[key] = value
    if row[9]:
        meta["error"] = json.loads(row[9])
    return meta


class _Database:
    """SQLite 录制仓库：事务写入帧与进度，独立数据库锁防止同目录被多个服务同时恢复。"""

    def __init__(self, directory: Path):
        self.path = directory / "recordings.sqlite"
        self._lock = RLock()
        self._closed = False
        self._owner = self._db = None
        try:
            # owner 库保持独占事务，主库仍使用 WAL 供下载连接并行读取。
            # 异常退出由 SQLite / 操作系统释放锁，不删除未知锁文件。
            self._owner = sqlite3.connect(directory / "recordings.owner.sqlite", timeout=0,
                                          isolation_level=None, check_same_thread=False)
            self._owner.execute("PRAGMA journal_mode = DELETE")
            self._owner.execute("BEGIN EXCLUSIVE")
            db = self._db = sqlite3.connect(self.path, timeout=1.0, isolation_level=None,
                                            check_same_thread=False)
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("PRAGMA synchronous = FULL")
            db.execute("PRAGMA foreign_keys = ON")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, RECORDING_DATABASE_VERSION):
                raise ValueError("不支持的录制数据库版本。")
            if version == 0:
                tables = db.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchall()
                if tables:
                    raise ValueError("未识别的数据库结构，不能覆盖。")
                with self._transaction():
                    for statement in _SCHEMA:
                        db.execute(statement)
            # 帧与 frame_count 同事务提交；异常退出只恢复已提交记录，不把队列长度当已保存帧数。
            with self._transaction():
                db.execute(
                    """UPDATE sessions SET status = 'error', ended_at = ?, error_json = ?,
                       frame_count = (SELECT COUNT(*) FROM frames WHERE frames.session_id = sessions.id)
                       WHERE status = 'recording'""", (_now_ms(), _dumps(_INTERRUPTED)))
        except BaseException as cause:
            self._release()
            if isinstance(cause, sqlite3.OperationalError) and "locked" in str(cause).lower():
                message = "采集目录正被其他服务使用，请关闭该服务或选择另一个目录。"
            else:
                message = "无法打开录制数据库，请检查目录权限、磁盘空间和数据库版本。"
            if isinstance(cause, Exception):
                raise _recording_error("RECORDING_WRITE_FAILED", message, cause) from cause
            raise

    class _Transaction:
        def __init__(self, db):
            self._db = db

        def __enter__(self):
            self._db.execute("BEGIN IMMEDIATE")

        def __exit__(self, exc_type, exc, traceback):
            if exc_type is None:
                try:
                    self._db.execute("COMMIT")
                    return False
                except BaseException:
                    # 提交失败（如磁盘已满）时事务可能仍然打开；不回滚会让后续所有事务都无法开始。
                    self._rollback()
                    raise
            self._rollback()
            return False

        def _rollback(self) -> None:
            try:
                if self._db.in_transaction:
                    self._db.execute("ROLLBACK")
            except sqlite3.Error:
                pass

    def _transaction(self):
        return self._Transaction(self._db)

    def list(self) -> list[dict]:
        """历史列表只读取会话元数据，不把全部帧载入内存。"""
        with self._lock:
            rows = self._db.execute(
                """SELECT id, label, started_at, ended_at, frame_count, status, product, side, source, error_json
                   FROM sessions ORDER BY started_at DESC""").fetchall()
        return [_session_from_row(row) for row in rows]

    def start(self, meta: dict) -> None:
        """先持久化会话，再允许向该会话追加帧。"""
        with self._lock:
            self._db.execute(
                """INSERT INTO sessions
                   (id, label, started_at, ended_at, frame_count, status, product, side, source, error_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (meta["id"], meta["label"], meta["started_at"], None, 0, "recording",
                 meta.get("product"), meta.get("side"), meta.get("source"), None))

    def append(self, session_id: str, rows: list) -> None:
        """整批帧与帧数原子提交；任意一帧失败会回滚整批。"""
        with self._lock, self._transaction():
            self._db.executemany(
                "INSERT INTO frames (session_id, frame_index, timestamp, row_json) VALUES (?, ?, ?, ?)",
                [(session_id, index, timestamp, text) for index, timestamp, text, _ in rows])
            cursor = self._db.execute("UPDATE sessions SET frame_count = frame_count + ? WHERE id = ?",
                                      (len(rows), session_id))
            if cursor.rowcount != 1:
                raise ValueError("录制会话不存在。")

    def finish(self, meta: dict) -> None:
        """所有帧提交后保存最终状态，失败时由录制器保留错误快照。"""
        with self._lock:
            cursor = self._db.execute(
                "UPDATE sessions SET ended_at = ?, frame_count = ?, status = ?, error_json = ? WHERE id = ?",
                (meta["ended_at"], meta["frame_count"], meta["status"],
                 _dumps(meta["error"]) if meta.get("error") else None, meta["id"]))
            if cursor.rowcount != 1:
                raise ValueError("录制会话不存在。")

    def _release(self) -> list:
        errors = []
        for connection, rollback in ((self._db, False), (self._owner, True)):
            if connection is None:
                continue
            try:
                if rollback and connection.in_transaction:
                    connection.execute("ROLLBACK")
            except Exception as error:
                errors.append(error)
            try:
                connection.close()
            except Exception as error:
                errors.append(error)
        self._db = self._owner = None
        return errors

    def close(self) -> None:
        """关闭主库并释放独占锁；主库关闭失败也继续释放锁连接。"""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            errors = self._release()
        if errors:
            raise _recording_error("RECORDING_WRITE_FAILED", "关闭录制数据库失败。", errors[0])


def _reader_uri(path: str, windows: bool = os.name == "nt") -> str:
    """只读打开数据库用的 SQLite URI。

    授权部分必须留空：Path.as_uri() 会把网络路径写成 file://server/share，SQLite 拒绝这种形式；
    这里统一写成 file:///C:/…、file:////server/share/… 或 file:///var/…。
    """
    text = str(path).replace("\\", "/") if windows else str(path)
    return "file://" + ("" if text.startswith("/") else "/") + quote(text, safe="/:") + "?mode=ro"


def _open_reader(path) -> sqlite3.Connection:
    """为一次下载打开独立只读连接；生成器结束或取消时必须关闭。"""
    db = None
    try:
        db = sqlite3.connect(_reader_uri(os.path.abspath(path)), uri=True, timeout=1.0,
                             isolation_level=None, check_same_thread=False)
        if db.execute("PRAGMA user_version").fetchone()[0] != RECORDING_DATABASE_VERSION:
            raise ValueError("不支持的录制数据库版本。")
        # 下载只读取已结束、不可变的会话；逐页读取并取完结果，慢速下载不阻塞 WAL 回收。
        return db
    except Exception as cause:
        if db is not None:
            db.close()
        raise _recording_error("RECORDING_WRITE_FAILED", "无法读取录制数据库，请检查文件和权限。", cause) from cause


def _descriptor(recording) -> dict:
    """接受 download() 返回的描述符，或旧版 JSONL 文件路径。"""
    if isinstance(recording, (str, os.PathLike)):
        return {"path": os.fspath(recording), "format": "jsonl"}
    if (not isinstance(recording, dict) or not isinstance(recording.get("path"), (str, os.PathLike))
            or recording.get("format") not in ("sqlite", "jsonl")):
        raise _recording_error("INVALID_CONFIG", "请传入有效的录制下载描述符。")
    if recording["format"] == "sqlite":
        meta = recording.get("meta")
        if not isinstance(meta, dict) or not isinstance(meta.get("id"), str) or not RECORDING_ID.match(meta["id"]):
            raise _recording_error("RECORDING_NOT_FOUND", "找不到录制记录。")
    return recording


def _recording_lines(recording):
    """按序分页读取 SQLite 帧或旧 JSONL 行，下载中断后释放只读连接和文件句柄。"""
    descriptor = _descriptor(recording)
    if descriptor["format"] == "sqlite":
        db = _open_reader(descriptor["path"])
        try:
            session_id = descriptor["meta"]["id"]
            if db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                raise _recording_error("RECORDING_NOT_FOUND", "找不到录制记录。")
            last_index = -1
            while True:
                rows = db.execute(
                    """SELECT frame_index, row_json FROM frames
                       WHERE session_id = ? AND frame_index > ? ORDER BY frame_index LIMIT ?""",
                    (session_id, last_index, BATCH_SIZE)).fetchall()
                if not rows:
                    break
                for _, text in rows:
                    yield text
                last_index = rows[-1][0]
        finally:
            db.close()
        return
    with open(descriptor["path"], encoding="utf-8", newline="") as stream:
        for line in stream:
            line = line.rstrip("\r\n")
            if line:
                yield line


def recording_jsonl(recording):
    """逐行生成完整 JSONL 文本；每行是一帧的 schema、会话、序号、时间戳与完整帧。"""
    for line in _recording_lines(recording):
        yield line + "\n"


def _csv_cell(value) -> str:
    """转义 CSV 引号，并给可能被表格软件当作公式的内容加前缀。"""
    if value is None:
        text = ""
    elif isinstance(value, (dict, list)):
        text = _dumps(value)
    elif isinstance(value, bool):
        text = "true" if value else "false"
    else:
        text = str(value)
    if _FORMULA.match(text):
        text = "'" + text
    return '"' + text.replace('"', '""') + '"'


def recording_csv(recording):
    """流式生成带 UTF-8 BOM 的 CSV 文本；每次最多读取 200 帧，数组与分区保留为 JSON 单元格。"""
    yield "\ufeff" + ",".join(_csv_cell(column) for column in CSV_COLUMNS) + "\r\n"
    for line in _recording_lines(recording):
        row = json.loads(line)
        frame = row.get("frame") or {}
        values = {**row, **{key: frame.get(key) for key in CSV_COLUMNS[5:13]}, "frame": row.get("frame")}
        yield ",".join(_csv_cell(values.get(column)) for column in CSV_COLUMNS) + "\r\n"


class _Session:
    def __init__(self, meta: dict):
        self.meta = meta
        self.accepting = True
        self.queue: deque = deque()
        self.queued_bytes = self.outstanding = self.next_index = 0
        self.flush_at = 0.0
        self.stopping = False
        self.condition = Condition()
        self.finished = Event()
        self.finish_error: ShroomError | None = None
        # 每行 JSON 的固定部分只序列化一次；字段顺序与 JavaScript SDK 的录制行一致。
        self.prefix = ('{"schema":' + _dumps(STREAM_SCHEMA) + ',"sessionId":' + _dumps(meta["id"])
                       + ',"label":' + _dumps(meta["label"]) + ',"index":')
        self.middle = ',"source":' + _dumps(meta.get("source") or "") + ',"frame":'


class RecordingStore:
    """带目录锁的 SQLite 录制器，兼容读取旧 JSONL 与元信息文件。

    满 200 帧、等待 250 毫秒或停止时事务提交；帧数只计已提交记录。待提交帧受
    max_queue_frames 与 16 MiB 限制，溢出时停止接收并尽量写完已接收帧。
    append 接收 encode_stream_frame 的结果；本类不关闭串口设备。
    """

    def __init__(self, directory, *, max_queue_frames: int = 1000, on_change=None):
        if (not isinstance(directory, (str, os.PathLike)) or not str(directory).strip()
                or isinstance(max_queue_frames, bool) or not isinstance(max_queue_frames, int)
                or max_queue_frames < 1):
            raise _recording_error("INVALID_CONFIG", "请提供有效的录制目录与队列帧数上限。")
        self._root = Path(directory).resolve()
        self._max_queue_frames = max_queue_frames
        self._on_change = on_change
        self._lock = RLock()
        self._records: dict[str, dict] = {}
        self._legacy_ids: set[str] = set()
        self._active: _Session | None = None
        self._starting = self._closed = False
        self._database = None
        try:
            self._root.mkdir(parents=True, exist_ok=True)
            self._database = _Database(self._root)
            for meta in self._database.list():
                self._records[meta["id"]] = meta
            self._load_legacy()
        except BaseException as cause:
            if self._database is not None:
                try:
                    self._database.close()
                except ShroomError:
                    pass
            if isinstance(cause, ShroomError) or not isinstance(cause, Exception):
                raise
            raise _recording_error("RECORDING_WRITE_FAILED", "无法打开录制目录，请检查目录权限和磁盘空间。",
                                   cause) from cause

    def _load_legacy(self) -> None:
        """旧数据只读兼容：不将未完成记录或损坏文件误报为成功，也不修改原文件。"""
        for entry in self._root.iterdir():
            name = entry.name
            if not name.endswith(".meta.json"):
                continue
            identifier = name[:-len(".meta.json")]
            if not RECORDING_ID.match(identifier) or identifier in self._records:
                continue
            try:
                wire = json.loads(entry.read_text(encoding="utf-8"))
                meta = recording_from_wire(wire)
                if meta is None or meta["id"] != identifier or meta["status"] not in ("recording", "stopped", "error"):
                    continue
                if meta["status"] == "recording":
                    meta.update(status="error", ended_at=_now_ms(), error=dict(_INTERRUPTED))
                self._records[identifier] = meta
                self._legacy_ids.add(identifier)
            except (OSError, ValueError, TypeError, AttributeError):
                continue  # 损坏或不属于 SDK 的旧文件不进入列表。

    def _notify(self, meta: dict) -> None:
        """广播快照，观察者异常不改变事务和采集生命周期。"""
        if self._on_change is not None:
            try:
                self._on_change(_snapshot(meta))
            except Exception:
                pass

    def _fail(self, session: _Session, error) -> None:
        """保留最先出现的异常，停止接收新帧并等待已接收帧收尾。"""
        with session.condition:
            if session.meta["status"] == "error":
                return
            session.accepting = False
            session.meta["status"] = "error"
            session.meta["error"] = {"code": getattr(error, "code", None) or "RECORDING_WRITE_FAILED",
                                     "message": str(error)}
            session.stopping = True
            session.condition.notify_all()
        self._notify(session.meta)

    def _write(self, session: _Session) -> None:
        """写入线程：按批提交事务，停止时排空队列并保存最终状态。"""
        condition = session.condition
        while True:
            with condition:
                while not session.stopping and len(session.queue) < BATCH_SIZE:
                    if session.queue:
                        delay = session.flush_at - monotonic()
                        if delay <= 0:
                            break
                        condition.wait(delay)
                    else:
                        condition.wait()
                rows = [session.queue.popleft() for _ in range(min(BATCH_SIZE, len(session.queue)))]
                if not rows and session.stopping:
                    break
            while rows:
                try:
                    self._database.append(session.meta["id"], rows)
                except Exception as cause:
                    # SQLite 已回滚整个批次；剩余队列不能继续写成一条看似成功的记录。
                    with condition:
                        session.queue.clear()
                        session.outstanding = session.queued_bytes = 0
                    self._fail(session, _recording_error(
                        "RECORDING_WRITE_FAILED", "录制数据库写入失败，请检查磁盘、权限和数据库状态。", cause))
                    break
                with condition:
                    session.meta["frame_count"] += len(rows)
                    session.outstanding -= len(rows)
                    session.queued_bytes -= sum(row[3] for row in rows)
                    # 触发一次提交后连续排空，不让剩余的小批次再等一个间隔。
                    rows = [session.queue.popleft() for _ in range(min(BATCH_SIZE, len(session.queue)))]
        meta = session.meta
        meta["ended_at"] = _now_ms()
        if meta["status"] != "error":
            meta["status"] = "stopped"
        try:
            self._database.finish(meta)
        except Exception as cause:
            meta["status"] = "error"
            meta["error"] = {"code": "RECORDING_WRITE_FAILED", "message": "录制状态保存失败，重启后需检查记录是否完整。"}
            session.finish_error = _recording_error("RECORDING_WRITE_FAILED", meta["error"]["message"], cause)
        with self._lock:
            self._records[meta["id"]] = _snapshot(meta)
        # 先广播最终状态再放行等待方：下一场采集的“开始”不会排在这一场的“结束”之前。
        self._notify(meta)
        session.finished.set()

    def _finish(self, session: _Session, wait: bool = True) -> None:
        """幂等收尾：先关闭接收入口，再排空事务队列，最后保存状态；错误记录仍可导出已提交帧。"""
        with session.condition:
            session.accepting = False
            session.stopping = True
            session.condition.notify_all()
        if wait:
            session.finished.wait()
            if session.finish_error is not None:
                raise session.finish_error

    @property
    def is_recording(self) -> bool:
        """当前是否有会话在接收新帧。"""
        session = self._active
        return session is not None and session.accepting

    def start(self, label, *, product=None, side=None, source=None) -> dict:
        """创建固定标签会话；上一记录收尾后才开始下一条，失败时不进入采集中状态。"""
        with self._lock:
            if self._closed:
                raise _recording_error("SERVER_CLOSED", "服务已关闭。")
            active = self._active
            if self._starting or (active is not None and not active.stopping and active.accepting):
                raise _recording_error("RECORDING_ACTIVE", "请先停止当前录制，再开始新的标签录制。")
            trimmed = label.strip() if isinstance(label, str) else ""
            if not trimmed or len(trimmed.encode("utf-16-le")) > 400 or _CONTROL.search(label):
                raise _recording_error("INVALID_CONFIG", "标签需要是 1–200 字符的非空文本，不能包含控制字符。")
            self._starting = True
        try:
            if active is not None:
                active.finished.wait()
            with self._lock:
                if self._closed:
                    raise _recording_error("SERVER_CLOSED", "服务已关闭。")
                meta = {"id": str(uuid.uuid4()), "label": trimmed, "started_at": _now_ms(), "ended_at": None,
                        "frame_count": 0, "status": "recording"}
                for key, value in (("product", product), ("side", side), ("source", source)):
                    if value:
                        meta[key] = value
                self._database.start(meta)
                session = _Session(meta)
                Thread(target=self._write, args=(session,), name="shroom-recording-writer", daemon=True).start()
                self._active = session
                self._records[meta["id"]] = _snapshot(meta)
            self._notify(meta)
            return _snapshot(meta)
        except ShroomError:
            raise
        except Exception as cause:
            raise _recording_error("RECORDING_WRITE_FAILED", "无法创建录制会话，请检查数据库、目录权限和磁盘空间。",
                                   cause) from cause
        finally:
            self._starting = False

    def append(self, frame: dict, frame_text: str | None = None) -> None:
        """将一帧加入有界队列；溢出明确结束记录，不静默丢帧继续采集。

        frame 是 encode_stream_frame 的结果；frame_text 可传入同一帧已序列化的 JSON，避免重复编码。
        """
        session = self._active
        if session is None or not session.accepting:
            return
        try:
            timestamp = frame["timestamp"]
            stamp = _dumps(timestamp)
            if frame_text is None:
                frame_text = _dumps(frame)
        except Exception as cause:
            self._fail(session, _recording_error("RECORDING_WRITE_FAILED", "录制帧无法序列化，请检查产品数据。", cause))
            return
        overflow = False
        with session.condition:
            if not session.accepting:
                return
            text = (session.prefix + str(session.next_index) + ',"timestamp":' + stamp
                    + session.middle + frame_text + "}")
            size = len(text.encode("utf-8"))
            if session.outstanding >= self._max_queue_frames or session.queued_bytes + size > MAX_QUEUE_BYTES:
                overflow = True
            else:
                if not session.queue:
                    session.flush_at = monotonic() + FLUSH_INTERVAL
                session.queue.append((session.next_index, timestamp, text, size))
                session.next_index += 1
                session.outstanding += 1
                session.queued_bytes += size
                if len(session.queue) >= BATCH_SIZE or len(session.queue) == 1:
                    session.condition.notify_all()
        if overflow:
            self._fail(session, _recording_error(
                "RECORDING_OVERFLOW", "磁盘写入跟不上采集，录制已停止；已接收帧会写完，请降低采集频率或使用更快磁盘。"))

    def stop(self) -> dict:
        """停止接收并等待全部事务收尾；重复停止返回新的独立快照。"""
        session = self._active
        if session is None:
            raise _recording_error("RECORDING_NOT_ACTIVE", "当前没有录制任务。")
        self._finish(session)
        return _snapshot(session.meta)

    def abort(self, error, *, wait: bool = True) -> dict | None:
        """设备或授权异常时结束采集，尽量提交已接收帧并保留错误原因。"""
        session = self._active
        if session is None:
            return None
        if session.accepting:
            self._fail(session, error)
        if wait and session.stopping:
            session.finished.wait()
        return _snapshot(session.meta)

    def status(self) -> dict | None:
        """返回最近一次会话的快照；关闭数据库后仍可查询最后结果。"""
        session = self._active
        return _snapshot(session.meta) if session is not None else None

    def list(self) -> list[dict]:
        """历史按开始时间倒序，活动记录用当前已提交帧数覆盖缓存。"""
        with self._lock:
            records = dict(self._records)
            if self._active is not None:
                records[self._active.meta["id"]] = self._active.meta
        def started(meta: dict):
            # 旧版元信息文件可能缺少开始时间；这样的记录排在最后，而不是让整个列表失败。
            value = meta.get("started_at")
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
        return sorted((_snapshot(meta) for meta in records.values()), key=started, reverse=True)

    def download(self, identifier: str) -> dict:
        """只定位已知、完成收尾的记录；返回供 recording_csv / recording_jsonl 使用的描述符。"""
        if not isinstance(identifier, str) or not RECORDING_ID.match(identifier):
            raise _recording_error("RECORDING_NOT_FOUND", "找不到录制记录。")
        with self._lock:
            session = self._active
            active = session is not None and session.meta["id"] == identifier
            meta = session.meta if active else self._records.get(identifier)
            if meta is None:
                raise _recording_error("RECORDING_NOT_FOUND", "找不到录制记录。")
            if meta["status"] == "recording" or (active and not session.finished.is_set()):
                raise _recording_error("RECORDING_ACTIVE", "请先停止录制并等待事务提交完成，再下载。")
            legacy = identifier in self._legacy_ids
            return {"meta": _snapshot(meta), "format": "jsonl" if legacy else "sqlite",
                    "path": str(self._root / f"{identifier}.jsonl") if legacy else str(self._database.path)}

    def close(self) -> None:
        """禁止新采集，等待事务收尾并关闭数据库；任何失败仍释放目录锁。可重复调用。"""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            session = self._active
        errors = []
        if session is not None:
            try:
                self._finish(session)
            except ShroomError as error:
                errors.append(error)
        try:
            self._database.close()
        except ShroomError as error:
            errors.append(error)
        if errors:
            raise errors[0]
