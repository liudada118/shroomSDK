"""命令行入口：python -m shroom_sdk，安装后也可执行 shroom-demo。

不传串口路径时使用模拟设备；真实串口需要有效 SDK 授权。
采集由主线程同步读取，Ctrl+C 或退出 with 块都会释放设备。
"""

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from . import Shroom, ShroomError
from .device import _timeout
from .license import DEFAULT_SERVER_URL


def main(argv=None) -> int:
    """解析命令并输出帧；argv 省略时读取命令行，正常退出返回 0，错误返回 1。"""
    parser = argparse.ArgumentParser(description="Shroom serial / mock pressure sensor demo")
    parser.add_argument("path", nargs="?", help="COM3, /dev/ttyUSB0, etc.; omit for mock")
    parser.add_argument("--list", action="store_true", help="List serial ports")
    parser.add_argument("--frames", type=int, default=0, help="Stop after N frames; 0 = run until Ctrl+C")
    parser.add_argument("--json", action="store_true", help="One JSON object per frame")
    parser.add_argument("--rows", type=int)
    parser.add_argument("--cols", type=int)
    parser.add_argument("--layout", choices=("raw", "mat32"), default="raw")
    parser.add_argument("--baud-rate", type=int, default=1_000_000)
    parser.add_argument("--fps", type=float, default=30, help="Mock frame rate")
    parser.add_argument("--timeout", type=float, default=5.0, help="Seconds to wait for a complete frame")
    parser.add_argument("--license-file", help="UTF-8 file containing a shroom-sdk license (required for real serial)")
    parser.add_argument("--license-mode", choices=("online", "offline"), default="online")
    parser.add_argument("--license-server", default=DEFAULT_SERVER_URL, help="HTTPS key manager URL")
    parser.add_argument("--device-id", help="Persisted 64-character lowercase hex computer ID for limited licenses")
    parser.add_argument("--license-public-key", help="Trusted RSA public-key PEM file for a custom offline signer")
    args = parser.parse_args(argv)
    if args.frames < 0:
        parser.error("--frames must be >= 0")
    if (args.rows is None) != (args.cols is None):
        parser.error("Use --rows and --cols together")
    try:
        if args.list:
            ports = Shroom.list_ports()
            if args.json:
                print(json.dumps([asdict(p) for p in ports]))
            else:
                for p in ports:
                    print(f"{p.path}: {p.description or ''}")
                if not ports:
                    print("No serial ports found.")
            return 0
        # 读取超时由 CLI 控制，必须在打开真实串口前检查参数。
        _timeout(args.timeout)
        # 查询端口和模拟模式不激活授权；真实读取使用调用者指定的密钥文件。
        if args.path and args.license_file:
            license_options = {"mode": args.license_mode, "server_url": args.license_server,
                               "device_id": args.device_id}
            if args.license_public_key:
                license_options["public_key"] = Path(args.license_public_key).read_text(encoding="utf-8-sig")
            Shroom.activate_license(Path(args.license_file).read_text(encoding="utf-8-sig").strip(), **license_options)
        options = {"layout": args.layout}
        if args.rows is not None:
            options.update(rows=args.rows, cols=args.cols)
        device = (Shroom.connect(args.path, baud_rate=args.baud_rate, **options) if args.path
                  else Shroom.mock(fps=args.fps, **options))
        # with 同时覆盖帧数达到上限、异常和键盘中断的资源释放。
        with device:
            count = 0
            while not device.closed:
                frame = device.read_frame(timeout=args.timeout)
                if frame is None:
                    print("No complete frame before timeout. " + device.get_diagnostics()["hint"], file=sys.stderr)
                    return 1
                if args.json:
                    print(json.dumps(frame.to_dict()))
                else:
                    print(Shroom.render_ascii(frame))
                    print(f"{frame.rows}x{frame.cols} max={frame.max:.3f} area={frame.area} "
                          f"center=({frame.center.x:.3f}, {frame.center.y:.3f})")
                count += 1
                if args.frames and count >= args.frames:
                    break
        return 0
    except KeyboardInterrupt:
        return 0
    except ShroomError as exc:
        print(f"shroom [{exc.code}/{exc.stage}]: {exc}\n{exc.suggestion}", file=sys.stderr)
        return 1
    except (ImportError, OSError, ValueError, RuntimeError) as exc:
        print(f"shroom: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
