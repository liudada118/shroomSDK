# 安装 JavaScript SDK

一步获取产品数据；需要网页传输或保存数据时，再调用创建 WS、开始采集、停止采集和下载。

## 安装到自己的项目

打开[官网 SDK 下载区](https://sdk.jq-industries.com/#downloads)，在 JavaScript / TypeScript 卡片点击 **复制安装命令**，粘贴到自己项目的终端执行即可。命令包含当前版本的完整下载地址，npm 会自动下载并安装到 `node_modules/shroom-sdk`，不用先下载、解压或复制源码。

SDK 下载与安装不要求登记联系方式。真实设备使用的 **Shroom SDK 产品密钥另行申请**，下载完成不代表已经激活。

也可以点击 **下载安装包**，在保存 `.tgz` 的目录运行以下命令；文件名以实际下载版本为准：

```bash
npm install --save-exact ./shroom-sdk-0.1.0.tgz
```

**当前尚未发布到 npm 注册表，不要直接运行 `npm install shroom-sdk`。** 使用官网复制的完整命令，或安装已经下载的 `.tgz`。

安装后保存项目的 `package.json` 和锁文件。使用官网 URL 安装时，其他电脑或 CI 可直接 `npm ci`；使用本地 `.tgz` 安装时，应将包放在 `vendor/` 并随项目保存，否则其他电脑找不到该文件。升级时重新复制官网对应版本的安装命令，安装后提交新的锁文件。首次安装需要能够下载运行依赖，或已有对应 npm 缓存。

## 只导入需要的函数

```js
import {
  readProduct,       // ① 获取产品数据；只取数时，到这里即可
  createWS,          // ② Node.js 创建 WS 服务，让网页接收数据
  startRecording,    // ③ 开始保存采集数据
  stopRecording,     // ④ 停止采集，等待数据写入 SQLite
  downloadRecording // ⑤ 导出 CSV 或 JSONL
} from 'shroom-sdk/quick-flow';
```

Node.js 取数传入 `product / path` 等设备参数；网页取数传入 WS `url`。后三步共用同一个服务或网页连接。参数和调用位置见[五步调用说明](https://sdk.jq-industries.com/docs/quick-start)。

| 使用位置 | 入口与要求 |
| --- | --- |
| Node.js / Electron 主进程 | 五步入口 `shroom-sdk/quick-flow`；基础 API `shroom-sdk/node`；Node.js 18+，推荐使用受支持的 LTS |
| Vite 等浏览器构建项目 | 五步入口仍为 `shroom-sdk/quick-flow`；基础 API `shroom-sdk/web`；构建工具自动选择浏览器入口 |
| 普通 HTML，无构建工具 | 使用源码 ZIP 的相对路径示例；浏览器不能直接解析上述包名 |
| Python | 单独使用 Python ZIP 与 pip；不包含在这个 npm 安装包中 |

浏览器五步入口通过 WS 接收数据和控制采集；`createWS()` 和产品串口取数在 Node.js 执行。浏览器直接连接串口需改用基础 Web Serial API，并满足其浏览器与安全上下文要求。

## 接入前确认

- **先装串口驱动**：[Windows](https://shroom.jq-industries.com/drive/CH341SER.EXE) · [macOS](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。安装后重新插拔设备，见[驱动排查](https://github.com/liudada118/shroomSDK/blob/main/docs/DRIVERS.md)。
- 真实设备需激活 **Shroom SDK** 产品密钥，Node.js 从 `shroom-sdk/node` 导入 `Shroom` 后调用 `await Shroom.activateLicense(key, { deviceId })`；`deviceId` 使用应用保存的稳定安装标识，配置见[授权说明](https://sdk.jq-industries.com/docs/license)。不要从安装包导入源码示例专用的 `node/license-env.js`。
- 用 `try / catch` 处理连接和起停失败，用 `onError` 处理运行错误；结束时关闭连接或服务。见[连接与采集排查](https://github.com/liudada118/shroomSDK/blob/main/docs/QUICK-START.md#连接与采集排查-troubleshooting)。Node.js 串口与 SQLite 依赖安装失败时会返回 `DEPENDENCY_MISSING`，应先修复依赖再连接。

## 安装包与源码

安装包只包含压缩后的运行 JavaScript、类型声明和交付说明，不包含测试、开发工具、Python、采集数据或 source map。客户通过公开入口调用；需要扩展产品时，由维护者在源码仓库修改适配器、验证并重新打包。

压缩和包入口用于减少误改与保持版本一致，**不是加密或防篡改保护**。GitHub 源码是否公开与 npm 安装是两个独立设置；完全在客户机器执行的授权判断不能保证无法绕过。

[源码仓库](https://github.com/liudada118/shroomSDK) · [版本更新](https://github.com/liudada118/shroomSDK/blob/main/CHANGELOG.md) · [旧 SDK 迁移](https://github.com/liudada118/shroomSDK/blob/main/MIGRATION.md)
