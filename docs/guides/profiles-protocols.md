# 协议与 Profiles

SDK 用 `Profile` 描述传感器协议。`ProtocolRegistry` 根据 `sensorType` 找到 profile，然后把原始 buffer 解析成标准 frame。

## 内置 Profiles

| sensorType | baudRate | 点数 | 矩阵 | 说明 |
| --- | ---: | ---: | --- | --- |
| `default` | 1000000 | 自动 | 自动 | 默认 uint8 分帧 |
| `hand0205` | 921600 | 256 | 16x16 | 手套常用协议 |
| `hand0205Double` | 921600 | 256 | 16x16 | 双通道手套 |
| `handGlove115200` | 115200 | 256 | 16x16 | 低波特率手套 |
| `handGloveFullPacket` | 921600 | 256 | 16x16 | 274 字节完整包 |
| `hand` | 1000000 | 1024 | 32x32 | 手部 1024 点 |
| `handSinglePoint` | 1000000 | 1024 | 32x32 | 单点手部 |
| `fast1024` | 1000000 | 1024 | 32x32 | 快速 1024 矩阵 |
| `smallBed12B` | 1500000 | 1024 | 32x32 | uint16le 小床垫 |
| `bed4096` | 3000000 | 4096 | 64x64 | 4096 点床垫 |
| `bed4096num` | 3000000 | 4096 | 64x64 | 4096 点数字床垫 |

## 分帧 delimiter

常用帧尾：

```js
Buffer.from([0xaa, 0x55, 0x03, 0x99])
```

`smallBed12B` 使用 16 位尾标记：

```js
Buffer.from([0xaa, 0x00, 0x55, 0x00, 0x03, 0x00, 0x99, 0x00])
```

## 解析过程

```js
const frame = sdk.registry.parse('hand0205', rawBuffer, {
  channel: 'sit',
});
```

默认解析会：

1. 按 `valueType` 读取数值。
2. 取 `pressureLength` 段作为压力数据。
3. 可选应用 `lineOrder`。
4. 读取 `rotateOffset` / `rotateLength`。
5. 计算 `stats` 和 `matrix`。

## 自定义 Profile

```js
sdk.registerProfile('mySensor', {
  sensorType: 'mySensor',
  baudRate: 1000000,
  delimiter: Buffer.from([0xaa, 0x55, 0x03, 0x99]),
  valueType: 'uint8',
  pressureLength: 1024,
  matrixWidth: 32,
  matrixHeight: 32,
});
```

带线序：

```js
sdk.registerProfile('mySensorWithLineOrder', {
  sensorType: 'mySensorWithLineOrder',
  baudRate: 1000000,
  delimiter: Buffer.from([0xaa, 0x55, 0x03, 0x99]),
  valueType: 'uint8',
  pressureLength: 1024,
  matrixWidth: 32,
  matrixHeight: 32,
  lineOrder: 'myLineOrder',
});
```
