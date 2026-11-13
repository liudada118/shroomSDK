"""RFC 6455 的最小实现：握手密钥、帧编解码与消息读取，仅依赖标准库。

只支持本 SDK 用到的子集：文本 / 二进制消息、分片重组、ping / pong / close 控制帧；
不协商扩展（无压缩）和子协议。服务端与客户端共用同一份帧读写规则。
"""

import base64
import hashlib
import json
import os
import socket
import ssl
import struct
from threading import Lock
from urllib.parse import urlsplit

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
# 一条消息最多由这么多个分片组成；空分片不占载荷额度，必须另行限制。
MAX_FRAGMENTS = 16384


def _reject_constant(name: str):
    raise ValueError(f"invalid JSON constant: {name}")


def parse_json(text):
    """解析网络上的 JSON；与 JSON.parse 一样拒绝 NaN / Infinity 字面量。"""
    return json.loads(text, parse_constant=_reject_constant)
OP_CONTINUATION, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class WebSocketProtocolError(Exception):
    """对端违反协议或超出大小限制；close_code 是应答使用的关闭码。"""

    def __init__(self, close_code: int, reason: str):
        super().__init__(reason)
        self.close_code = close_code


def accept_key(key: str) -> str:
    """由客户端的 Sec-WebSocket-Key 计算握手应答值。"""
    digest = hashlib.sha1((key + GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def new_client_key() -> str:
    return base64.b64encode(os.urandom(16)).decode("ascii")


def _apply_mask(data: bytes, mask: bytes) -> bytes:
    """用整数异或一次完成掩码运算，避免逐字节循环。"""
    size = len(data)
    if not size:
        return data
    key = (mask * (size // 4 + 1))[:size]
    return (int.from_bytes(data, "little") ^ int.from_bytes(key, "little")).to_bytes(size, "little")


def encode_frame(opcode: int, payload: bytes = b"", *, mask: bool = False) -> bytes:
    """编码一个不分片的帧；客户端发往服务端的帧必须加掩码，服务端发出的帧不加。"""
    size = len(payload)
    head = bytearray((0x80 | opcode,))
    flag = 0x80 if mask else 0
    if size < 126:
        head.append(flag | size)
    elif size < 65536:
        head.append(flag | 126)
        head += struct.pack("!H", size)
    else:
        head.append(flag | 127)
        head += struct.pack("!Q", size)
    if not mask:
        return bytes(head) + payload
    key = os.urandom(4)
    return bytes(head) + key + _apply_mask(payload, key)


def close_payload(code: int, reason: str = "") -> bytes:
    """关闭帧载荷：2 字节状态码加 UTF-8 原因；控制帧载荷最多 125 字节。"""
    text = reason.encode("utf-8")[:123]
    # 截断不能落在多字节字符中间。
    text = text.decode("utf-8", "ignore").encode("utf-8")
    return struct.pack("!H", code) + text


def parse_close(payload: bytes) -> tuple[int, str]:
    if len(payload) < 2:
        return 1005, ""
    return struct.unpack("!H", payload[:2])[0], payload[2:].decode("utf-8", "replace")


class MessageReader:
    """从阻塞读取函数里取出完整消息；控制帧可以插在分片之间。

    read(n) 必须返回恰好 n 个字节，连接结束时抛出异常。max_size 限制单条消息的总载荷，
    expect_mask 表示对端的帧是否必须带掩码（服务端读取时为 True，客户端读取时为 False）。
    """

    def __init__(self, read, *, max_size: int, expect_mask: bool):
        self._read = read
        self._max_size = max_size
        self._expect_mask = expect_mask
        self._opcode = None
        self._parts: list[bytes] = []
        self._size = 0
        self._fragments = 0

    def next(self) -> tuple[int, bytes]:
        """返回下一条完整的数据消息或控制帧 (opcode, payload)。"""
        while True:
            first, second = self._read(2)
            final, opcode = bool(first & 0x80), first & 0x0F
            masked, length = bool(second & 0x80), second & 0x7F
            if first & 0x70:
                raise WebSocketProtocolError(1002, "reserved bits are not supported")
            if masked != self._expect_mask:
                raise WebSocketProtocolError(1002, "unexpected frame masking")
            control = opcode >= 0x8
            if control:
                if not final or length > 125 or opcode not in (OP_CLOSE, OP_PING, OP_PONG):
                    raise WebSocketProtocolError(1002, "invalid control frame")
            elif opcode not in (OP_CONTINUATION, OP_TEXT, OP_BINARY):
                raise WebSocketProtocolError(1002, "unsupported opcode")
            if length == 126:
                length = struct.unpack("!H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read(8))[0]
            if not control and self._size + length > self._max_size:
                raise WebSocketProtocolError(1009, "message too large")
            mask = self._read(4) if masked else None
            payload = self._read(length) if length else b""
            if mask is not None:
                payload = _apply_mask(payload, mask)
            if control:
                return opcode, payload
            if opcode == OP_CONTINUATION:
                if self._opcode is None:
                    raise WebSocketProtocolError(1002, "unexpected continuation frame")
            elif self._opcode is not None:
                raise WebSocketProtocolError(1002, "expected continuation frame")
            else:
                self._opcode = opcode
            if length:
                self._parts.append(payload)
                self._size += length
            self._fragments += 1
            if self._fragments > MAX_FRAGMENTS:
                self._parts.clear()
                raise WebSocketProtocolError(1009, "too many fragments")
            if final:
                message = self._parts[0] if len(self._parts) == 1 else b"".join(self._parts)
                opcode, self._opcode, self._parts, self._size, self._fragments = self._opcode, None, [], 0, 0
                return opcode, message


def read_exactly(stream):
    """把文件对象包装成“恰好读 n 字节”的函数；读到连接结束时抛出 ConnectionError。"""
    def read(size: int) -> bytes:
        data = stream.read(size)
        if data is None or len(data) != size:
            raise ConnectionError("connection closed")
        return data
    return read


def force_close(sock) -> None:
    """立即断开并释放套接字句柄，即使另一线程正阻塞在它的读取上。

    仅 shutdown 在部分平台上不会唤醒阻塞中的读取，而由 makefile 引用的套接字调用 close()
    又不会真正释放句柄；这里先 shutdown，再分离并关闭底层句柄。
    """
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        socket.close(sock.detach())
    except (OSError, ValueError):
        pass


class ConnectionClosed(Exception):
    """连接已结束；code 为对端关闭码，异常断开时为 1006。"""

    def __init__(self, code: int = 1006, reason: str = ""):
        super().__init__(reason or f"WebSocket closed ({code})")
        self.code = code
        self.reason = reason


class ClientConnection:
    """阻塞式 WebSocket 客户端连接：构造时完成 TCP / TLS 连接与握手。

    receive() 只应由一个线程调用；send_text() 与 close() 可从其他线程调用。
    不使用系统代理，也不发送 Origin 头。
    """

    def __init__(self, url: str, *, timeout: float = 10.0, protocols=None,
                 max_size: int = 16 * 1024 * 1024):
        parsed = urlsplit(url)
        secure = parsed.scheme == "wss"
        host = parsed.hostname
        if parsed.scheme not in ("ws", "wss") or not host:
            raise ValueError("WebSocket URL must use ws:// or wss://")
        port = parsed.port or (443 if secure else 80)
        self._send_lock = Lock()
        self._closed = False
        self._buffer = bytearray()
        sock = socket.create_connection((host, port), timeout=timeout)
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            if secure:
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            key = new_client_key()
            target = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
            authority = (f"[{host}]" if ":" in host else host) + (f":{parsed.port}" if parsed.port else "")
            lines = [f"GET {target} HTTP/1.1", f"Host: {authority}", "Upgrade: websocket",
                     "Connection: Upgrade", f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13"]
            if protocols:
                names = [protocols] if isinstance(protocols, str) else list(protocols)
                lines.append("Sec-WebSocket-Protocol: " + ", ".join(names))
            sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
            # 直接从套接字读取（不经 makefile），关闭时才能真正释放句柄并唤醒阻塞中的读取。
            # 服务端可能紧跟握手应答发送第一条消息，多读到的字节留在缓冲区里。
            buffer = self._buffer
            while b"\r\n\r\n" not in buffer:
                chunk = sock.recv(4096)
                if not chunk or len(buffer) > 65536:
                    raise WebSocketProtocolError(1002, "incomplete WebSocket handshake response")
                buffer += chunk
            head, _, rest = bytes(buffer).partition(b"\r\n\r\n")
            buffer[:] = rest
            status, *lines = head.decode("latin-1").split("\r\n")
            headers = {name.strip().lower(): value.strip()
                       for name, _, value in (line.partition(":") for line in lines)}
            parts = status.split()
            if len(parts) < 2 or parts[1] != "101" or headers.get("sec-websocket-accept") != accept_key(key):
                raise WebSocketProtocolError(1002, "unexpected WebSocket handshake response")
            sock.settimeout(None)
        except BaseException:
            sock.close()
            raise
        self._socket = sock
        self._reader = MessageReader(self._read, max_size=max_size, expect_mask=False)

    def _read(self, size: int) -> bytes:
        buffer = self._buffer
        while len(buffer) < size:
            chunk = self._socket.recv(max(65536, size - len(buffer)))
            if not chunk:
                raise ConnectionError("connection closed")
            buffer += chunk
        data = bytes(buffer[:size])
        del buffer[:size]
        return data

    def _send(self, frame: bytes) -> None:
        with self._send_lock:
            self._socket.sendall(frame)

    def send_text(self, text: str) -> None:
        """发送一条文本消息；连接已关闭时抛出 ConnectionClosed。"""
        if self._closed:
            raise ConnectionClosed()
        try:
            self._send(encode_frame(OP_TEXT, text.encode("utf-8"), mask=True))
        except OSError as exc:
            raise ConnectionClosed() from exc

    def receive(self) -> tuple[int, bytes]:
        """阻塞等待下一条数据消息 (opcode, payload)；连接结束时抛出 ConnectionClosed。"""
        while True:
            try:
                opcode, payload = self._reader.next()
            except WebSocketProtocolError as error:
                self.close(error.close_code, str(error))
                raise ConnectionClosed(error.close_code, str(error)) from error
            except (OSError, ValueError) as exc:
                self._abort()
                raise ConnectionClosed() from exc
            if opcode == OP_PING:
                try:
                    self._send(encode_frame(OP_PONG, payload, mask=True))
                except OSError:
                    pass
            elif opcode == OP_CLOSE:
                code, reason = parse_close(payload)
                self.close(code if code != 1005 else 1000)
                raise ConnectionClosed(code, reason)
            elif opcode != OP_PONG:
                return opcode, payload

    def _abort(self) -> None:
        self._closed = True
        force_close(self._socket)

    def close(self, code: int = 1000, reason: str = "") -> None:
        """尽力发送关闭帧后断开；可重复调用，也可用于中断另一线程里阻塞的 receive()。"""
        if self._closed:
            return
        self._closed = True
        try:
            # 对端不读取时不能卡在关闭帧上：拿不到发送锁就直接断开。
            if self._send_lock.acquire(timeout=0.5):
                try:
                    self._socket.settimeout(0.5)
                    self._socket.sendall(encode_frame(OP_CLOSE, close_payload(code, reason), mask=True))
                finally:
                    self._send_lock.release()
        except OSError:
            pass
        self._abort()
