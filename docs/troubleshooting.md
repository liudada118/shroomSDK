# 常见问题

## 文档页面内容很少

先确认当前分支和文档构建：

```powershell
git status --short --branch
pnpm docs:build
pnpm docs:dev
```

如果切到了旧分支，VitePress 侧边栏可能只有少量页面。

## 串口打不开

常见原因：

- 主项目已经占用了同一个 COM 口。
- 端口号选错。
- 波特率和 profile 不匹配。
- USB 转串口驱动异常。

先运行：

```powershell
pnpm run sdk:serial-demo -- --list-ports
```

## 收不到 frame

检查：

- `delimiter` 是否和设备一致。
- `sensorType` 是否选对。
- `pressureLength` 是否正确。
- 是否监听了 `session.on('frame')`。
- 原始串口是否有数据。

## SQLite 安装失败

当前 SDK 使用 `better-sqlite3`。如果本机 native 依赖安装失败，可以先用 `MemoryCaptureStore` 跑 demo：

```js
const sdk = new ShroomSensorSDK({
  store: new MemoryCaptureStore(),
});
```

## WebSocket 无法连接

确认主项目后端已经启动：

```text
HTTP: http://127.0.0.1:19245
WS:   ws://127.0.0.1:19999
```

再检查：

```js
await client.getContract();
await client.getWsStatus();
```

## 线序没有生效

检查：

- `lineOrder` 名称是否注册。
- `profile.lineOrder` 是否和注册名称一致。
- `sdk.listLineOrders()` 是否能看到名称。
- 线序函数是否返回新数组。
