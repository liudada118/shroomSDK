# 快速开始

## 安装

本地项目直接引用 SDK 文件夹：

```powershell
pnpm add E:\ShroomSDK
```

如果使用 npm：

```powershell
npm install file:E:\ShroomSDK
```

## 方式一：连接正在运行的主项目后端

主项目需要先启动 HTTP 和 WebSocket 服务：

```text
HTTP: http://127.0.0.1:19245
WS:   ws://127.0.0.1:19999
```

最小代码：

```js
const { BackendSdkClient } = require('shroom-backend-sdk');

async function main() {
  const client = new BackendSdkClient({
    httpBaseUrl: 'http://127.0.0.1:19245',
    wsUrl: 'ws://127.0.0.1:19999',
  });

  console.log(await client.getContract());
  console.log(await client.listSerialPorts());

  client.on('frame', (frame) => {
    console.log(frame.channelId, frame.value?.length);
  });

  client.connectRealtime({ channels: ['sit'] });
}

main().catch(console.error);
```

## 方式二：SDK 本地直接读取串口

```js
const { ShroomSensorSDK, MemoryCaptureStore } = require('shroom-backend-sdk');

async function main() {
  const sdk = new ShroomSensorSDK({
    store: new MemoryCaptureStore(),
  });

  const ports = await sdk.listPorts({ onlyLikelySensorPorts: true });
  console.log(ports);

  const session = await sdk.open({
    sensorType: 'hand0205',
    channels: {
      sit: 'COM3',
    },
  });

  session.on('frame', (frame) => {
    console.log(frame.channel, frame.pressureData.length, frame.stats);
  });
}

main().catch(console.error);
```

## 内置 demo

```powershell
pnpm run sdk:demo
pnpm run sdk:serial-demo -- --list-ports
pnpm run sdk:serial-demo -- --mock
```

## 验证 SDK

```powershell
pnpm test
pnpm docs:build
```
