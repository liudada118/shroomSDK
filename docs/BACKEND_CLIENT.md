# 后端连接链路

`BackendSdkClient` 用于连接正在运行的 Shroom 主项目后端。

## 前置条件

主项目需要已经启动，并监听：

```text
HTTP: http://127.0.0.1:19245
WS:   ws://127.0.0.1:19999
```

## 最小例子

```js
const { BackendSdkClient } = require('shroom-backend-sdk');

async function main() {
  const client = new BackendSdkClient({
    httpBaseUrl: 'http://127.0.0.1:19245',
    wsUrl: 'ws://127.0.0.1:19999',
  });

  const contract = await client.getContract();
  console.log(contract.contractVersion);

  console.log(await client.listSerialPorts());
  console.log(await client.listDisplaySystems());

  client.on('frame', (frame) => {
    console.log(frame.channelId, frame.value?.length);
  });

  client.connectRealtime({ channels: ['sit'] });
}

main().catch(console.error);
```

## 打开串口并订阅实时数据

```js
await client.setSensorType('hand0205');
await client.openSerial({ role: 'sit', port: 'COM3' });

client.on('frame', console.log);
client.connectRealtime({ channels: ['sit'] });
```

## 启动采集

```js
await client.startCollection({
  name: 'sdk_demo',
  frequencyHz: 12,
});

await client.stopCollection();
```

## Display Systems metadata

```js
const systems = await client.listDisplaySystems();
const detail = await client.getDisplaySystem('system-id');
```

## 什么时候用这条链路

适合：

- 产品实验室验证后端能力
- 前端/第三方工具控制主项目
- SDK demo 验证完整系统链路
- 不想直接接触 `server.js`、parser、runtime 内部模块
