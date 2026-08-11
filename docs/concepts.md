# 核心概念

## Profile

Profile 描述某类传感器的串口协议和数据结构，包括：

- `baudRate`：波特率。
- `delimiter`：分帧尾标记。
- `valueType`：字节解析方式，如 `uint8`、`uint16le`、`int16le`。
- `pressureLength`：压力点数量。
- `matrixWidth` / `matrixHeight`：矩阵尺寸。
- `lineOrder`：可选线序函数名称。

## Frame

SDK 解析出的标准帧结构：

```js
{
  sensorType: 'hand0205',
  channel: 'sit',
  timestamp: Date.now(),
  rawLength: 260,
  data: [],
  pressureData: [],
  rotate: [],
  matrix: { width: 16, height: 16 },
  stats: { max, min, mean, total, point },
  rawValues: [],
}
```

## Channel

Channel 是业务通道名称，例如：

- `sit`
- `back`
- `head`
- `sensor`

本地串口链路里，`channels` 用来把业务通道绑定到 COM 口：

```js
await sdk.open({
  sensorType: 'hand0205',
  channels: {
    sit: 'COM3',
    back: 'COM4',
  },
});
```

## Line Order

线序用于把设备采集顺序转换成显示顺序。SDK 支持：

- 在 profile 中配置 `lineOrder`。
- 运行时 `registerLineOrder()`。
- 单次 `applyLineOrder()`。

## Capture

Capture 是一次采集记录。SDK 支持 SQLite 存储和内存存储：

- `CaptureStore`：写入 SQLite。
- `MemoryCaptureStore`：用于测试和 demo。

## Replay / Export

采集完成后可以：

- 使用 `ReplayService` 生成历史时间线。
- 使用 `CsvExporter` 导出 CSV。
