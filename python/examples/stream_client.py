"""五步流程的查看端示例：连接 WS 数据服务，采集几秒并把这次记录下载到本地。

    python examples/stream_client.py                      # 连接 ws://127.0.0.1:19999
    python examples/stream_client.py --url ws://127.0.0.1:19999 --seconds 5 --label 握力测试 --output capture.csv

服务可以由 examples/quick_demo.py 创建，也可以是 JavaScript SDK 的 serveDevice / createWS。
本示例不直接访问串口，也不需要 SDK 授权；采集权限由服务端判断。
"""

import argparse
import time

from shroom_sdk import ShroomError, download_recording, read_product, start_recording, stop_recording

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--url", default="ws://127.0.0.1:19999")
parser.add_argument("--seconds", type=float, default=3.0, help="采集时长")
parser.add_argument("--label", default="本次采集")
parser.add_argument("--output", default="capture.csv", help="保存路径；扩展名为 .jsonl 时下载 JSONL")
args = parser.parse_args()

count = 0


def on_data(frame):
    global count
    count += 1
    if count % 30 == 1:
        print(f"第 {count} 帧：{frame.product} max={frame.max:.3f} area={frame.area}")


try:
    # ① 取数：传入 url 表示订阅数据服务，而不是打开本机串口。
    with read_product(url=args.url, on_data=on_data,
                      on_error=lambda error: print(f"[{error.code}] {error}")) as stream:
        print("已连接：", stream.info)
        session = start_recording(stream, label=args.label)          # ③ 开始保存（由服务端写入磁盘）
        print("开始采集：", session["id"])
        time.sleep(args.seconds)
        recording = stop_recording(stream)                           # ④ 等待文件写完
        print(f"已停止：{recording['status']}，共 {recording['frame_count']} 帧")
        fmt = "jsonl" if args.output.lower().endswith(".jsonl") else "csv"
        print("已保存：", download_recording(stream, args.output, format=fmt))  # ⑤ 下载本次记录
except ShroomError as error:
    raise SystemExit(f"[{error.code}/{error.stage}] {error}\n{error.suggestion}")
except KeyboardInterrupt:
    pass
