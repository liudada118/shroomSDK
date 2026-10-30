# 产品适配扩展

新增产品时，把协议、参数和数据校验放进独立适配器，再登记到 `registry.js`。客户继续使用 `readProduct()` 等五个函数；注册一个名字并不能完成产品接入。

## 先看这几个文件

| 文件 | 职责 |
| --- | --- |
| `registry.js` | 静态登记适配器，解析正式产品 ID 与连接别名 |
| `glove.js` | 整包手套参数、解析器、五指/手掌/IMU 的 WS 校验 |
| `pad.js` | 检测垫参数、mat32 解码与矩阵 WS 校验 |
| `tail-parser.js` | 固定载荷长度 + 尾分隔符的共用拆帧器 |
| `stream-utils.js` | 数值、数组、形状与独立快照的校验工具 |

上层 `../product.js` 准备串口连接；`../stream-codec.js` 先校验通用帧，再调用对应适配器。Node 和浏览器使用同一份产品定义。

## 适配器需要提供什么

| 成员 | 要求 |
| --- | --- |
| `profile` | `product / label / family / baudRate / payloadLength / sensorPoints / rows / cols`，明确正式 ID、串口与数据形状 |
| `aliases` | 连接时接受的短名称；正式 ID 与全部别名必须唯一 |
| `optionFields` | 此产品额外接受的连接字段，如 `side`；公共字段由上层处理 |
| `validateOptions(options, invalid)` | 校验专用参数，错误调用 `invalid(field, message)`；不得猜测手侧或型号 |
| `connectionInfo(options)` | 返回设备 `info` 中的专用元数据，例如手侧 |
| `createParser(options)` | 为每个连接创建独立、有界的流解析器 |
| `readStreamFields(input, output, typed)` | 校验并复制产品字段到已验证的通用帧 `output`，返回该结果 |

目前 `glove` 对应 `handGloveFullPacket`，`pad` 对应 `hand`。别名只用于连接；输出的 `frame.product` 和网络传输必须使用正式 ID。`listDeviceProducts()` 返回 profile 的副本，不增加 aliases 字段，也不探测硬件。

## 1. 实现协议与参数

先确认真实设备的波特率、包边界、载荷字段、点位映射及必填参数。应用只传产品和业务参数，不能覆盖已经固化的波特率、分隔符或线序。

如果仍是“固定载荷 + 尾分隔符”，复用 `createTailProductParser({ payloadLength, delimiter, decodePayload })`。`decodePayload` 收到的是长度正确、已复制且不含分隔符的字节，返回已映射的产品帧。可参照 `pad.js`，不要重复实现相同拆帧规则。

其他协议由适配器实现自己的解析器，保持以下接口：

| 接口 | 行为 |
| --- | --- |
| `push(chunk)` | 接收 `Uint8Array`，保留未完成包，返回本次解析出的帧数组 |
| `reset()` | 清空半包、协议状态和累计诊断 |
| `droppedCount` | 累计丢弃包/错误片段数，供设备诊断使用 |
| `frameLength` | 最近成功解析的载荷长度，尚无有效帧时为 0 |

缓存必须有界；覆盖跨 chunk、粘包、坏长度、无效校验和及重新同步。若新协议需要主动握手、启动命令或改变串口生命周期，需另外扩展并测试传输层；当前解析器契约本身不提供发送命令能力。

## 2. 实现 WS 字段校验

只完成串口解码还不够：`readStreamFields` 同时用于发送编码和接收解码。

- 通用帧已验证 `raw / values / rows / cols / min / max / avg / area / center / timestamp`；矩阵 `values.length` 必须等于 `rows * cols`，最多 16384 点。
- 校验产品自己的必填字段、数据长度、范围及嵌套形状，再按白名单复制到 `output`。不能直接展开整个输入对象。
- `typed: false` 输出可 JSON 序列化的普通数组；`typed: true` 恢复所需 TypedArray。可复用 `streamOutput()`，保持数据快照独立。
- 不在传输层重新映射、重新标定或补造传感点。非矩形产品使用明确的分区和真实行长。

`streamPressureFields()` 适合现有压力帧；其他数据类型应实现对应验证，不强行套用压力字段。如果新产品不能满足当前通用 Frame 契约，先设计并版本化扩展协议。

## 3. 登记并同步对外能力

在 `registry.js` 静态导入新适配器，并加入 `deviceProductAdapters`。两个产品共用协议也应各自拥有明确的 profile 与映射，不用未知名称退回默认产品。

随后同步：

- `sdk/index.d.ts` 的 `DeviceProductTypes`：为正式 ID 增加一项，包含 `names`（正式 ID 和别名）、`frame`、`node`、`web`；定义对应的产品帧和参数类型。Node/Web `connectProduct` 与快速 `readProduct` 从该映射推导参数和返回值，无需再逐个修改函数重载。
- 验证 `sdk/quick-flow.d.ts`、Node/Web 声明对新产品的推导结果；五个函数名保持不变，运行时注册表与类型映射必须一致。
- 产品字段文档、菜单和示例。新增产品不会自动获得 `createProductView()` 的绘图；需要时增加并验证视图，或由客户用 `onData` 自行展示。
- Node/Web 模块、经典脚本与下载包中的实际接入结果。

经典脚本构建会沿静态 import 自动加入注册的适配器，无需再改一份模块清单。当前拼接器仅支持 SDK 内的单行具名导入及顶层具名声明；不支持导入别名或循环依赖，共享作用域中的顶层名称要避免冲突。修改源码后重新构建，不手改 `web/shroom.bundle.js`。

## 4. 用真实协议样本验证

覆盖产品参数拒绝、正式 ID/别名解析、串口分块恢复、点位映射、WS 往返与损坏字段拒绝。确认原有产品、模块入口和经典脚本继续兼容，再验证五步流程的读取、录制、停止及下载。模拟样本通过后，仍需实际设备核对固件、触点与持续取数结果。

客户调用见[快速接入](../../docs/QUICK-START.md)，通用串口入口见[基础与自定义](../../docs/CUSTOM.md)。
