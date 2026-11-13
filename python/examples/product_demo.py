"""产品取数示例：选产品即可收到已解析的数据，协议、波特率和点位映射由 SDK 内置。

    python examples/product_demo.py glove --side left --mock
    python examples/product_demo.py glove --side left COM3 --license-file sdk.license
    python examples/product_demo.py glove --license-file sdk.license              # 自动发现唯一的分包手套
    python examples/product_demo.py pad COM5 --license-file sdk.license
    python examples/product_demo.py insole --side right --protocol 8bit COM6 --license-file sdk.license

整包手套和鞋垫的左右必须按实物指定；分包手套省略串口或 --side 时由 SDK 扫描并按协议识别。
--mock 使用合成数据（仅手套和手垫，需指定 --side），不需要授权。
"""

import argparse
from pathlib import Path
from threading import Event

from shroom_sdk import Shroom, ShroomError, connect_product, create_product_mock_device

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("product", choices=("glove", "handGloveFullPacket", "pad", "body", "insole"))
parser.add_argument("path", nargs="?", help="COM3、/dev/ttyUSB0 等；省略时仅在恰有一个串口时自动选择")
parser.add_argument("--side", choices=("left", "right"))
parser.add_argument("--protocol", choices=("12bit", "8bit"), help="仅鞋垫")
parser.add_argument("--mock", action="store_true", help="无硬件演示")
parser.add_argument("--frames", type=int, default=0, help="收到 N 帧后退出；0 表示一直运行到 Ctrl+C")
parser.add_argument("--license-file")
parser.add_argument("--license-mode", choices=("online", "offline"), default="online")
parser.add_argument("--device-id")
args = parser.parse_args()

options = {key: value for key, value in (("side", args.side), ("protocol", args.protocol)) if value}
done = Event()
count = 0


def on_data(frame):
    """回调在读取线程上执行，只做轻量处理；完整分区和 IMU 原始字节都在 frame 里。"""
    global count
    summary = f"{frame.product} {frame.rows}x{frame.cols} max={frame.max:.3f} area={frame.area}"
    if hasattr(frame, "fingers"):
        pulps = {name: finger.pulp.raw[0] for name, finger in frame.fingers.items()}
        summary += f" side={frame.side} 指腹ADC={pulps} 手掌首行={frame.palm.matrix[0]}"
    elif hasattr(frame, "sensors"):
        summary += f" side={frame.side} {frame.protocol} 真实点最大ADC={max(frame.sensors.raw)}"
    elif hasattr(frame, "regions"):
        summary += " 各区最大ADC=" + str({name: max(region.raw) for name, region in frame.regions.items()})
    print(summary)
    count += 1
    if args.frames and count >= args.frames:
        done.set()


def on_error(error):
    """连接后的运行期错误；重连期间的中间错误也会到这里。回调可能早于 device 变量赋值，不要在这里引用它。"""
    print(f"[{error.code}/{error.stage}] {error}\n{error.suggestion}")


try:
    if args.mock:
        device = create_product_mock_device(args.product, **options)
        device.on_error(on_error)
        device.on_data(on_data)
    else:
        if not args.license_file:
            parser.error("真实设备需要串口驱动和 --license-file（含 serial 功能的 shroom-sdk 密钥）；无硬件请加 --mock")
        Shroom.activate_license(Path(args.license_file).read_text(encoding="utf-8-sig").strip(),
                                mode=args.license_mode, device_id=args.device_id)
        device = connect_product(args.product, args.path, on_data=on_data, on_error=on_error,
                                 on_state_change=lambda status: print("连接状态：", status), **options)
except ShroomError as error:
    # 自动发现没有唯一结果时，把候选列出来交给使用者选择，而不是替他挑一个。
    for candidate in error.details.get("scan", {}).get("devices", []):
        print(f"候选：{candidate['path']}（{candidate['side']}）")
    raise SystemExit(f"[{error.code}/{error.stage}] {error}\n{error.suggestion}")

print(f"已连接：{device.info['label']}（{device.info['source']}）。Ctrl+C 关闭。")
try:
    # 重试用尽、授权失效等终止性错误会让设备进入 error 状态。
    while not done.wait(0.2) and device.state != "error":
        pass
except KeyboardInterrupt:
    pass
finally:
    device.close()
