# SDK 授权接入

真实设备连接前先[确认串口驱动](DRIVERS.md)，再激活 `shroom-sdk` 产品密钥。SDK 不限制传感器型号；密钥由现有授权管理后台统一签发、续期和停用。上位机使用 `shroom-desktop`，旧密钥缺少产品字段时只属于上位机。下载 SDK、解析字节、渲染和 SDK 内置模拟数据无需激活。

## 签发什么密钥

在后台生成在线密钥或 RSA 离线码时，选择“Shroom SDK”，设置到期时间及电脑数量，无需选择传感器型号范围。客户同时使用上位机时分别签发两个产品的密钥。SDK 密钥可以随设备交付，是否另收费按订单约定。

| 接口 | 使用方式 |
| --- | --- |
| `connectHandPad()` | 已封装的手部检测垫协议 |
| `connectGlove()` | 已封装的整包手套协议，仍需明确左右手 |
| JS `connect()` / Python `connect()` | 通用串口，按实际设备协议配置解析 |

SDK 产品密钥默认包含 `serial`、`serial.raw`、`stream`、`recording`，同一 SDK 许可可使用产品接口和通用串口，既有 SDK 密钥中原先的型号范围也不再拦截。产品密钥类型、有效期、停用状态和电脑名额仍校验；独立功能被撤销时仍会拒绝相应功能。型号授权放开不代表所有硬件协议已经适配；Python 当前提供通用串口，仍没有整包手套的专用协议入口。

## Node.js 激活

```js
import { Shroom } from './node/index.js';

await Shroom.activateLicense(process.env.SHROOM_LICENSE_KEY, {
  deviceId: process.env.SHROOM_DEVICE_ID, // 限定电脑数量时必填：稳定的 64 位小写 hex
});
const device = await Shroom.connectHandPad({ path: 'COM3' });
device.onError((error) => console.error(error.code, error.message));
device.onData(console.log);
```

应用负责提供并保留稳定的 `deviceId`，同一次安装重启后不能重新随机生成。这个标识用于后台名额登记，不是 SDK 证明物理电脑身份的硬件凭证。更换标识会占用新名额；迁移电脑时在后台解绑旧登记。

内置 `node/demo.js`、`product-demo.js`、`quick-demo.js` 从环境变量读取授权。PowerShell 示例：

```powershell
$env:SHROOM_LICENSE_KEY = '管理员签发的SDK在线密钥'
node node/product-demo.js hand-pad COM3
```

示例默认将电脑标识保存到用户目录 `.shroom-sdk/device-id`，只保存标识，不保存密钥。可用 `SHROOM_DEVICE_ID` 指定已有标识。也可设置 `SHROOM_LICENSE_FILE` 从本地文件读取密钥。`SHROOM_LICENSE_MODE=offline` 切换为 RSA 码格式；自建服务地址使用 `SHROOM_LICENSE_SERVER`，自定义离线发行公钥使用 `SHROOM_LICENSE_PUBLIC_KEY_FILE`。这些变量供示例使用，SDK 核心不会自动读取环境变量。

## 浏览器激活

先单独完成异步激活，再由用户点击连接。不要在串口按钮中先等待网络校验，以免丢失浏览器手势。

```js
await Shroom.activateLicense(key, { deviceId: stableInstallationId });
connectButton.onclick = async () => {
  const device = await Shroom.connectHandPad();
  device.onError(console.error);
  device.onData(console.log);
};
```

`web/index.html` 提供激活表单；电脑标识保存在该网站的浏览器存储中，密钥仅在当前页面内使用。不同浏览器、来源地址或清除存储会产生新的安装标识。该页面使用通用串口诊断，激活 SDK 许可后即可使用。`web/quick-start.html` 连接已经授权的 Node 服务，观看与下载由服务端入口控制，无需在每个查看页面重复激活。

## RSA 离线码

```js
await Shroom.activateLicense(rsaCode, {
  mode: 'offline',
  deviceId: stableInstallationId,
  // publicKey: trustedIssuerPublicPem, // 自定义发行者的可信 RSA 公钥
});
```

离线码是 Base64 JSON `{payload, signature}`，RSA-SHA256 签名覆盖 `payload` 的 Base64 文本。SDK 校验签名、`productType`、`sdkFeatures`、`expireDate` 和电脑数量要求；不信任显示前缀或许可证自带的公钥。默认公钥与现有后台默认发行公钥一致，自定义密钥对需在应用中配置可信公钥。新 SDK 码使用 `boundSensorTypes: 'all'`；这个隔离字段阻止旧上位机读取 SDK 码，新版 SDK 不再依据旧型号字段限制连接。

不限定电脑数量的 RSA 码可以纯本地验签使用。限定数量的 RSA 码必须提供 `deviceId`，通过 `/api/license/devices/check` 联网登记并持续复核；本版没有离线设备租约缓存。后台现有的七天设备租约不会自动延长 SDK 的本地可用时间。

## 有效期与失效行为

在线密钥使用 `/licenseCheck`，请求始终声明 `productType: 'shroom-sdk'`，服务端还会核对数据库记录及密文产品。在线授权约每 30 秒复核，单次授权最长 60 秒且不超过密钥到期时间；网络中断不会无限延用旧结果。限定数量的 RSA 码采用相同复核上限。远程授权地址必须使用 HTTPS，本机调试可用 localhost HTTP。

打开设备、交付数据帧和启动录制都会校验许可。到期、清除、换密钥或复核拒绝会关闭已授权串口；空闲连接也会检测失效。服务端录制会中断并保留已有数据；停止录制、查询与下载历史记录仍可使用。重新激活后需要重新连接设备并启动服务。

`Shroom.getLicenseStatus()` 返回当前产品、功能及期限，不包含密钥；兼容字段 `allProducts` 为 true、`products` 为空数组，表示不限定型号。`Shroom.clearLicense()` 清除本次运行的授权。失败使用 `ShroomError`，`stage` 为 `license`，常见 `code` 包括 `LICENSE_PRODUCT_MISMATCH`、`LICENSE_FEATURE_DENIED`、`LICENSE_EXPIRED`、`LICENSE_REJECTED`、`LICENSE_UNAVAILABLE`、`LICENSE_DEVICE_REQUIRED`。连接前捕获 Promise 拒绝，连接后订阅 `onError()`。

已有 `BackendSdkClient` 连接的独立上位机服务继续由其服务端鉴权。SDK 的源码入口检查不能阻止客户修改已交付源码，纯本地离线码也无法实时获知吊销；需强制在线撤销时选择在线许可。授权控制不改变传感器通信协议本身。
