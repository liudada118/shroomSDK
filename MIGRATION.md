# 从仓库原有 SDK 迁移

2026-10-30，本仓库主线切换为官网正在使用的五步 SDK。原代码保留在 [legacy-backend-sdk-0.2.0](https://github.com/liudada118/shroomSDK/tree/legacy-backend-sdk-0.2.0) 标签及 Git 历史中。此次按项目决定直接替换，不提供旧接口的兼容层。

## 先确认使用的是哪套包

| 项目 | 原有版本 | 当前版本 |
| --- | --- | --- |
| 包名 | `shroom-backend-sdk@0.2.0` | `shroom-sdk@0.1.0` |
| JavaScript 模块 | CommonJS，`require(...)` | ES Module，`import ...` |
| 开发依赖管理 | pnpm | npm 与 `package-lock.json` |
| 主要入口 | `ShroomSensorSDK` 等类 | `readProduct / createWS / startRecording / stopRecording / downloadRecording` |
| 语言 | Node.js 与 React UI | Node.js、浏览器、Python（范围见 Python 文档） |
| 源码位置 | `index.js`、`src/`、`UI/` | `quick-flow.js`、`flow/`、`core/`、`node/`、`web/`、`python/` |

版本号分别属于两个不同包，`0.1.0` 不是旧包 `0.2.0` 的降级或兼容更新。依赖旧导出、React 组件或存储格式的项目，应继续固定旧标签，完成迁移后再切换。

## 接入代码需要调整

按[五步调用](docs/QUICK-START.md#quick-call)接入，五个函数来自 `quick-flow.js`。只需要实时数据时调用 `readProduct()`；需要网页传输、采集和下载时继续后续步骤。Node.js 与浏览器入口、返回值和资源关闭方式以当前文档为准。

旧版的回放播放器、调零、算法通道、报告服务及 React / Three.js 组件不在当前包中。当前的 `BackendSdkClient` 用于连接已运行的主项目后端，也不等同于旧包全部后端功能。需要这些功能的应用可继续依赖旧版本，或在应用层实现对应能力。

真实设备需激活 **Shroom SDK** 产品密钥，旧版注入解密函数的 `LicenseService` 不能直接替换当前授权机制。驱动、安装标识和授权配置见[接入准备](docs/QUICK-START.md#product-guide)与[授权说明](docs/LICENSE.md)。

## 采集数据库必须分开

原有 `CaptureStore` 使用 `captures` 与 `frames(capture_id, data_json, ...)`；当前 SDK 使用 `sessions` 与 `frames(session_id, frame_index, row_json, ...)`。

**不要让当前 SDK 打开旧版数据库，也不要共用录制目录。** 新版录制使用单独的目录和 `recordings.sqlite`；旧数据库交给旧版读取。需要迁移历史数据时，应先用旧版导出，再按业务字段进行转换；本次没有自动数据库迁移工具。

手套帧也不能直接互换：当前版本按 `fingers / palm` 访问命名分区，`imu.raw` 保留原始字节，不承诺旧版的 `mappedData / matrixData / rotate` 或姿态解算。不要沿用旧矩阵布局推断当前数据含义，详见[产品数据](README.md#s5)。

## 取回旧版

在单独目录克隆旧标签，避免改变已经运行的新版本工作区：

```bash
git clone --branch legacy-backend-sdk-0.2.0 https://github.com/liudada118/shroomSDK.git shroomSDK-legacy
```

旧版的安装、组件和回放文档随该标签保留。当前仓库的发布说明、版本工具和官网引用流程见 [SDK-RELEASING.md](https://github.com/liudada118/shroomSDK/blob/main/SDK-RELEASING.md)。
