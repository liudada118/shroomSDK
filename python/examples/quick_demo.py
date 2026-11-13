"""五步流程的采集端示例：取数并创建本机 WS 数据服务，供查看端连接、采集和下载。

    python examples/quick_demo.py --mock --port 19999
    python examples/quick_demo.py --product glove --side left --path COM3 --license-file sdk.license
    python examples/quick_demo.py --product glove --license-file sdk.license      # 自动发现唯一的分包手套
    python examples/quick_demo.py --product pad --path COM4 --license-file sdk.license

查看端可以运行 examples/stream_client.py，也可以用 JavaScript SDK 的网页（协议相同）。
录制保存在当前目录的 .shroom-recordings；查看端断开不会停止录制，Ctrl+C 会写完并退出。
"""

import argparse
from pathlib import Path
import time

from shroom_sdk import Shroom, ShroomError, create_product_mock_device, create_ws, read_product

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--product", choices=("glove", "handGloveFullPacket", "pad", "body", "insole"), default="glove")
parser.add_argument("--side", choices=("left", "right"))
parser.add_argument("--path")
parser.add_argument("--port", type=int, default=19999)
parser.add_argument("--mock", action="store_true", help="合成数据（仅手套和手垫），不需要授权")
parser.add_argument("--license-file")
parser.add_argument("--license-mode", choices=("online", "offline"), default="online")
parser.add_argument("--device-id")
args = parser.parse_args()
# 只有分包手套的真实设备可以省略 --side / --path，由 SDK 扫描串口并按协议识别手侧。
discoverable = args.product == "glove" and not args.mock
if args.product in ("glove", "handGloveFullPacket", "insole") and not args.side and not discoverable:
    parser.error("请按实物指定 --side left 或 right（只有分包手套的真实设备可以自动识别）")
if not args.mock and not args.path and not discoverable:
    parser.error("真实设备请明确指定 --path COM3；无硬件请使用 --mock")

options = {"side": args.side} if args.side else {}
try:
    if args.mock:
        device = create_product_mock_device(args.product, **options)
    else:
        if not args.license_file:
            parser.error("真实设备需要 --license-file（含 serial、stream；采集另需 recording 功能）")
        Shroom.activate_license(Path(args.license_file).read_text(encoding="utf-8-sig").strip(),
                                mode=args.license_mode, device_id=args.device_id)
        # ① 取数：不在这里处理数据也可以，服务会自行订阅设备。
        device = read_product(args.product, args.path,
                              on_error=lambda error: print(f"[{error.code}] {error}"), **options)
    # ② 创建 WS：启动失败会自动释放设备；之后由 server.close() 一并关闭。
    server = create_ws(device, port=args.port)
except ShroomError as error:
    raise SystemExit(f"[{error.code}/{error.stage}] {error}\n{error.suggestion}")

print(f"产品：{device.info['product']}，数据源：{device.info['source']}")
print(f"WS：{server.url}；录制下载：{server.http_url}/recordings/<id>.csv")
print("另开终端运行 python examples/stream_client.py 查看、采集并下载。Ctrl+C 退出。")
try:
    while device.state != "error":
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    # 先等待入库队列排空并关闭服务，再释放串口。
    server.close()
