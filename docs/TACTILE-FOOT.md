# 触觉足底：原始数据接入

SDK 0.7.1 的 Node.js 产品 ID 为 `footVideo`，连接别名为 `foot`。输出 **60 个有效测点的原始 ADC，6 列×10 行**（`rows: 10, cols: 6`），按左、右脚各自线序排列。它与已有 `jqInsole` / `insole` 是两种不同协议，不使用旧鞋垫的 112 点物理表。本次不增加 Python 产品入口。

升级说明：0.7.0 把 256 个扫描通道作为顶层压力数据；0.7.1 修正为上述 60 点。Node 服务与网页应一起升级至 0.7.1，完整扫描通道仍保存在 `rawPackets`。

## 连接

先使用 `npm install --save-exact shroom-sdk@0.7.1` 安装 SDK，再安装串口驱动并完成含 `serial` 功能的 SDK 授权。使用本地候选包时改为 `npm install --save-exact ./shroom-sdk-0.7.1.tgz`。业务项目通过公开包名导入；直接运行源码副本时使用 `src/quick-flow.js`：

```js
import { readProduct } from 'shroom-sdk/quick-flow';

const device = await readProduct({
  product: 'foot',
  path: 'COM3',
  side: 'left',
  onData(frame) {
    console.log(frame.pressure);    // Uint8Array(60)，对应脚线序的原始 ADC
    console.log(frame.rows, frame.cols); // 10 行、6 列
    console.log(frame.imu.raw);     // Uint8Array(16)，原始 IMU 字节
    console.log(frame.rawPackets);  // 两个完整原始包，包含包头与帧尾
  },
  onError: error => console.error(error.code, error.suggestion),
});

// 结束时 await device.close();
```

也可从 `shroom-sdk/node` 导入 `connectTactileFoot(options)`，或使用 `Shroom.connectTactileFoot(options)`。`path + side` 为手动直连；省略任一项或传 `side: 'auto'` 时，先用完整协议帧识别，只有唯一匹配才连接。

`scanProductPorts({ product: 'foot', side: 'left' })` 可先查询左脚候选；同侧接了多个设备时，必须用 `path` 指定。扫描只识别包类型和脚侧，不把类型字节当作设备序列号。探测样本不进入业务回调，自动连接及重连持续核对已识别的身份。

浏览器可用同版本 `readProduct({ url, onData })` 接收 Node 创建的 WS 服务。Web Serial 的 `connectTactileFoot` 仍需用户手势、明确 `side: 'left' | 'right'` 和支持的浏览器。

## 原始数据契约

波特率为 **921600**，每包帧尾为 `AA 55 03 99`。下表偏移为零基下标，载荷长度不含四字节帧尾：

| 内容 | 首包，130 字节载荷 | 尾包，146 字节载荷 |
| --- | --- | --- |
| `byte[0]` | `1`，首段 | `2`，尾段 |
| `byte[1]` | `3=左脚`、`4=右脚` | 必须与首包一致 |
| `bytes[2:130]` | 前 128 个 uint8 ADC | 后 128 个 uint8 ADC |
| `bytes[130:146]` | 无 | 16 个原始 IMU 字节 |

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `raw` / `pressure` / `pressureMatrix` | `Uint8Array(60)` | 60 点 ADC 原值，0–255，按对应脚线序逐行排列，每行 6 点、共 10 行 |
| `rows` / `cols` | `10` / `6` | 6 列×10 行；一维数组下标为 `row * 6 + col` |
| `imu.raw` | `Uint8Array(16)` | 原始 IMU 字节，包括无法解释为有限浮点数的字节组合 |
| `rawPackets` | `[Uint8Array(134), Uint8Array(150)]` | 首包、尾包各自的全部字节，包括两字节段头和四字节帧尾 |
| `packetType` / `side` | `3或4` / `left或right` | 以协议类型为准；显式侧别不匹配的包不发布 |
| `protocol` | `'segmented'` | 分包协议，没有连续设备序号 `sequence` |
| `timestamp` | `number` | 主机交付帧的毫秒时间，不是设备采样时钟 |

需要完整原始传输单元时，可在 Node 使用 `Buffer.concat(frame.rawPackets)`，结果为 284 字节。

SDK 先拼接两包中的 256 个扫描通道，再按对应脚的 60 点表直接取值；数值保持字节原值，包括 0 和 255。`raw / pressure / pressureMatrix` 为相同的 60 点，`values` 是额外的 ADC / 255 兼容字段。SDK 不执行插值、边界归零、基线扣除、左右镜像、滤波或力学标定，也不推断 IMU 四元数顺序、单位或姿态。

需要二维原始矩阵时，每 6 点分为一行，不要再次套用线序：

```js
const matrix = Array.from({ length: frame.rows }, (_, row) =>
  Array.from(frame.pressureMatrix.slice(row * frame.cols, (row + 1) * frame.cols)));
// matrix.length === 10，matrix[0].length === 6；每个数仍为原始 ADC。
```

左右脚使用独立点位表。下表为一基扫描通道号，每行 6 个；SDK 内部读取对应通道原值，不做数值变换：

| 行 | 左脚 | 右脚 |
| --- | --- | --- |
| 1 | 224, 208, 192, 176, 160, 144 | 23, 7, 247, 231, 215, 199 |
| 2 | 223, 207, 191, 175, 159, 143 | 24, 8, 248, 232, 216, 200 |
| 3 | 222, 206, 190, 174, 158, 142 | 25, 9, 249, 233, 217, 201 |
| 4 | 221, 205, 189, 173, 157, 141 | 26, 10, 250, 234, 218, 202 |
| 5 | 220, 204, 188, 172, 156, 140 | 27, 11, 251, 235, 219, 203 |
| 6 | 219, 203, 187, 171, 155, 139 | 28, 12, 252, 236, 220, 204 |
| 7 | 218, 202, 186, 170, 154, 138 | 29, 13, 253, 237, 221, 205 |
| 8 | 217, 201, 185, 169, 153, 137 | 30, 14, 254, 238, 222, 206 |
| 9 | 216, 200, 184, 168, 152, 136 | 31, 15, 255, 239, 223, 207 |
| 10 | 215, 199, 183, 167, 151, 135 | 32, 16, 256, 240, 224, 208 |

通过 `createWS`、`encodeStreamFrame/decodeStreamFrame`、SQLite 录制及 JSONL 导出时，`rawPackets` 与压力、IMU 原始字节均保留。CSV 的完整帧 JSON 列也保留这些字段。

## 直接输出原始 JSONL

在 SDK 源码根目录执行：

```powershell
# 无硬件，用真实解析器验证完整原始字段
node examples/node/tactile-foot-raw.js --mock --side left --frames 3

# 实机：授权辅助函数使用既有的 SHROOM_LICENSE_FILE 配置
$env:SHROOM_LICENSE_FILE = 'C:\path\sdk.license'
node examples/node/tactile-foot-raw.js --path COM3 --side left
```

每条 JSONL 记录输出 `rows / cols`、60 点 `pressure`、`imuRaw` 和完整 `rawPackets` 数组。`--frames N` 可限制帧数，默认持续输出，Ctrl+C 释放串口；此命令行示例在运行期错误时退出，实机读取禁用自动重连以便明确记录中断。

## 组帧边界与来源

解析器仅配对同连接、同类型、一秒内相邻的首尾包；乱序、孤立尾包、超长段、未知类型及超时会丢弃候选并恢复到下一边界。重置或重连不保留旧半包。协议没有 CRC、连续帧标识和转义：完整帧丢失无法仅靠此协议发现，载荷内出现完整帧尾标记时可能丢帧，原始包字段只记录成功组成的帧，不是串口噪声或所有丢弃字节的日志。

协议布局依据 `C:/code/shroom1.0` 的 `sdk/backend/sensors/handGloveDouble.js`、`backend/extensions/built-in-sensors/legacySegmentedFrameProcessor.js` 和 `backend/kernel/serial/nativeSerialDetection.js`；60 点直接取值依据 `sdk/backend/processing/lineOrderDefinitions/foot.js` 的 `FOOT_L_ADC_ORDER / FOOT_R_ADC_ORDER` 及 `lineOrders.js` 的 `footL / footR`，矩阵按既有原始数字视图的 6 列、10 行组织。`footVideo` 名称和 921600 波特率来自产品注册表。`3=左脚、4=右脚` 依据本次设备约定。验证使用合成字节、模拟串口和真实本地 WS/SQLite 链路；实际固件、左右脚和持续采集仍需真机核对。
