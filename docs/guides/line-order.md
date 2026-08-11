# 线序处理

线序用于把设备采集顺序转换成显示顺序。当前版本 SDK 提供 `LineOrderRegistry`，不内置具体手套左右手线序函数；你需要通过 `extraLineOrders` 或 `registerLineOrder()` 注入项目自己的线序。

## 构造时注册

```js
const sdk = new ShroomSensorSDK({
  extraLineOrders: {
    reverse: (data) => data.reverse(),
  },
});
```

## 运行时注册

```js
sdk.registerLineOrder('myLineOrder', (data, context) => {
  return data.map((value) => Number(value) || 0);
});
```

## 手动应用

```js
const output = sdk.applyLineOrder('myLineOrder', input, {
  channel: 'sit',
});
```

## 在 Profile 中使用

```js
sdk.registerProfile('mySensor', {
  sensorType: 'mySensor',
  baudRate: 1000000,
  delimiter: Buffer.from([0xaa, 0x55, 0x03, 0x99]),
  valueType: 'uint8',
  pressureLength: 1024,
  matrixWidth: 32,
  matrixHeight: 32,
  lineOrder: 'myLineOrder',
});
```

之后 `ProtocolRegistry.parse()` 和 `SensorSession` 会自动应用该线序。

## 查看已注册线序

```js
console.log(sdk.listLineOrders());
```

## context 参数

线序函数会收到第二个参数：

```js
function myLineOrder(data, context) {
  console.log(context.profile);
  console.log(context.channel);
  return data;
}
```

常见字段：

| 字段 | 说明 |
| --- | --- |
| `profile` | 当前传感器 profile |
| `channel` | 当前通道，默认 `sit` |
| `lineOrderOptions` | 单次解析或 profile 传入的附加参数 |

## 旧项目线序迁移建议

1. 先把旧项目线序函数改成纯函数：输入数组，输出新数组。
2. 不要在函数里直接读写 Vue/React 状态。
3. 明确输入点数和输出点数，例如 `256 -> 1024`。
4. 在 SDK 里注册线序名称，再在 profile 里引用。
