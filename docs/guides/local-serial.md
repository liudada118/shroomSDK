# 本地串口链路

本地串口链路用于直接验证硬件，不需要启动主项目后端。

## 数据流

```text
物理传感器
  -> serialport
  -> DelimiterParser
  -> ProtocolRegistry.parse()
  -> 可选 lineOrder
  -> ZeroCalibrator
  -> session.on('frame')
  -> CaptureStore / MemoryCaptureStore
```

## 枚举串口

```js
const ports = await sdk.listPorts();
const likely = await sdk.listPorts({ onlyLikelySensorPorts: true });
```

`listPorts()` 会返回：

```js
{
  path: 'COM3',
  manufacturer: 'wch.cn',
  serialNumber: '',
  pnpId: '',
  vendorId: '1A86',
  productId: '',
  friendlyName: '',
  isLikelySensorPort: true,
}
```

## 打开串口

```js
const session = await sdk.open({
  sensorType: 'hand0205',
  channels: {
    sit: 'COM3',
    back: 'COM4',
  },
});
```

## 监听事件

```js
session.on('channelOpen', ({ channel, portPath }) => {});
session.on('rawFrame', ({ channel, rawFrame }) => {});
session.on('frame', (frame) => {});
session.on('error', ({ channel, error }) => {});
session.on('channelClose', ({ channel, portPath }) => {});
```

## 关闭

```js
await session.close();
sdk.close();
```

## Demo 命令

```powershell
pnpm run sdk:serial-demo -- --list-ports
pnpm run sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
pnpm run sdk:serial-demo -- --mock
```
