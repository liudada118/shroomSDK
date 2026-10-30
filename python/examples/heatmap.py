"""二维热力图：python examples/heatmap.py [COM3 --license-file sdk.license]。

需要安装 [plot] 可选依赖；无串口路径时展示模拟数据，真实串口需先激活 SDK 授权。
"""

import argparse
from pathlib import Path

from shroom_sdk import Shroom


def main():
    """在 Matplotlib 窗口显示相对 ADC 值，关闭窗口或 Ctrl+C 时释放设备。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?")
    parser.add_argument("--license-file")
    parser.add_argument("--license-mode", choices=("online", "offline"), default="online")
    parser.add_argument("--device-id")
    args = parser.parse_args()
    if args.path:
        if not args.license_file:
            parser.error("Real serial requires the system serial driver and --license-file with a shroom-sdk key authorizing serial")
        Shroom.activate_license(Path(args.license_file).read_text(encoding="utf-8-sig").strip(),
                                mode=args.license_mode, device_id=args.device_id)
    # 绘图依赖仅在运行示例时导入，不影响 SDK 核心和 --help 的使用。
    import matplotlib.pyplot as plt

    device = Shroom.connect(args.path) if args.path else Shroom.mock()
    try:
        with device:
            fig, ax = plt.subplots()
            # 关闭窗口时释放设备，让后续读取循环退出，避免串口继续占用。
            fig.canvas.mpl_connect("close_event", lambda event: device.close())
            picture = None
            while plt.fignum_exists(fig.number) and not device.closed:
                # 每次只短暂等帧，让 GUI 仍有机会响应窗口交互。
                frame = device.read_frame(timeout=0.05)
                if frame is not None:
                    if picture is None:
                        # 色标固定为相对 ADC 的 0～1；此图不代表已标定的物理压力。
                        picture = ax.imshow(frame.matrix(), vmin=0, vmax=1, cmap="jet", origin="upper")
                        fig.colorbar(picture, ax=ax, label="Relative ADC (0-1)")
                    else:
                        # 复用图像对象，避免每帧新建绘图对象；同时兼容矩阵尺寸变化。
                        picture.set_data(frame.matrix())
                        picture.set_extent((-0.5, frame.cols - 0.5, frame.rows - 0.5, -0.5))
                    ax.set_title(f"Shroom | max={frame.max:.3f} | active points={frame.area}")
                plt.pause(0.01)
    except KeyboardInterrupt:
        pass
    finally:
        plt.close("all")


if __name__ == "__main__":
    main()
