"""逐帧读取示例：python examples/read_frames.py [COM3 --license-file sdk.license]。

不传串口路径时使用模拟数据；传入路径时先用 SDK 产品密钥激活，再读取最多 100 帧。
"""

import argparse
from itertools import islice
from pathlib import Path

from shroom_sdk import Shroom

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("path", nargs="?")
parser.add_argument("--license-file")
parser.add_argument("--license-mode", choices=("online", "offline"), default="online")
parser.add_argument("--device-id")
args = parser.parse_args()
# 真实串口需要授权；电脑名额受限时，device-id 应由宿主生成并稳定保存。
if args.path:
    if not args.license_file:
        parser.error("Real serial requires the system serial driver and --license-file with a shroom-sdk key authorizing serial")
    Shroom.activate_license(Path(args.license_file).read_text(encoding="utf-8-sig").strip(),
                            mode=args.license_mode, device_id=args.device_id)
device = Shroom.connect(args.path) if args.path else Shroom.mock()
try:
    # 退出循环或按 Ctrl+C 都会离开 with，关闭设备并释放串口。
    with device:
        # device 迭代器跨过暂时超时继续等待；islice 只限制成功读到的帧数。
        for frame in islice(device, 100):
            print(frame.timestamp, frame.max, frame.area, frame.center)
except KeyboardInterrupt:
    pass
