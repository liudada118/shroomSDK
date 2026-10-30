# 串口驱动安装

**连接真实设备前，先确认串口驱动已安装并能识别设备。** 使用 CH34x USB 转串口的设备若没有可用驱动，系统不会提供可访问的串口，SDK 和浏览器都无法读取。安装 Node.js、Python 或激活 SDK 密钥不能替代驱动。

## 下载对应系统的驱动

| 运行采集程序的系统 | 驱动下载 | 文件用途 |
| --- | --- | --- |
| Windows | [下载 Windows 串口驱动 CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE) | Windows 驱动安装程序 |
| macOS | [下载 macOS 串口驱动 CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip) | macOS 驱动压缩包，先解压再按包内指引安装 |

按实际系统选择文件。驱动应安装在**连接 USB 设备、运行 Node.js / Python 或 Web Serial 采集的电脑**上；另一台电脑仅通过 WS 查看画面时，应先检查采集电脑的驱动。

## 安装并确认系统串口

1. 下载对应系统的驱动并按安装程序指引安装；macOS 先解压 ZIP。安装器要求重新启动时，完成重启后再测试。
2. 重新插拔设备，使用支持数据传输的 USB 线，关闭占用串口的其他采集程序。
3. Windows 在“设备管理器 → 端口（COM 和 LPT）”确认串口名称，例如 `COM3`。macOS 可在终端运行 `ls /dev/cu.*`，检查插拔前后新增的串口。
4. 重启之前已打开的采集应用或浏览器页面，再查询或选择串口。串口出现后，再激活 SDK 产品密钥并开始连接。

SDK 不限制传感器型号授权；串口是否出现由系统、设备与驱动决定，数据能否解析还取决于协议适配。其他 USB 转串口芯片应使用与芯片匹配的驱动。Linux 不使用上述 EXE 或 macOS ZIP，应检查系统串口驱动及当前用户的串口权限。

## 使用 SDK 再查一次

解压 Node.js SDK 并安装依赖后，无需激活密钥即可列出串口：

```bash
npm install
node node/demo.js --list
```

Python SDK 安装串口依赖后：

```bash
python -m shroom_sdk --list
```

网页直连时，通过 HTTPS 或 localhost 打开，使用支持 Web Serial 的浏览器，由用户点击连接按钮选择端口。浏览器选择框为空时，先确认系统已经识别串口，再检查浏览器权限；SDK 授权问题通常表现为 `LICENSE_*`，与驱动是否安装分开排查。

## 找不到或打不开串口

| 现象 | 下一步 |
| --- | --- |
| 系统没有串口、SDK 列表为空 | 优先检查驱动、USB 数据线、设备供电与连接，安装后重插并重新查询 |
| 系统能看到端口，SDK 列表或浏览器仍为空 | 重启采集应用，检查浏览器环境和权限；核对设备所在的采集电脑 |
| 能列出端口但打开失败 | 关闭占用该端口的上位机或其他程序，检查系统权限 |
| 已打开但没有有效帧 | 核对端口、设备协议、波特率和解析配置，查看 SDK 诊断信息 |
| 出现 `LICENSE_*` | 按[SDK 授权](LICENSE.md)检查产品密钥、期限及电脑名额 |

驱动确认后继续[快速接入](QUICK-START.md)或[串口 API](BACKEND-GUIDE.md#serial)。
