# 人体全身：协议与物理线序

要求 SDK **0.3.0 或更高版本**。旧项目运行 `npm install --save-exact shroom-sdk@0.3.0` 升级。请让 Node 服务端与浏览器项目安装相同版本，并重新构建前端。

`product: 'humanBody'`（连接别名 `'body'`）返回完整 1024 通道扫描帧，同时提供十个身体源矩阵，共 400 个不同通道。无需 `side`，不根据串口或帧长推断产品。

这份说明依据 2026-11-04 检查的 `C:/code/shroom1.0` 本地源码。SDK 只移植协议与物理通道表；上位机的模型 UV、屏幕翻转、插值、显示阈值和归零流程不属于该映射。

## 串口协议

| 项目 | 固定值 | 源码依据（相对 `C:/code/shroom1.0`） |
| --- | --- | --- |
| 上位机产品 ID | `humanBody`、`humanBodyOptimized` 使用相同传输配置 | `sdk/backend/sensors/registry.js:109`、`:110` |
| 产品通道 | `sit`，32×32，共 1024 个扫描通道 | `sdk/backend/sensors/registry.js:38`、`:109` |
| 波特率 | `1000000` | `sdk/backend/protocol/presets/standard-1024.json:9` |
| 数据载荷 | 1024 字节；逐字节无符号整数 `0…255`；字节偏移 0 | 同上 `:16` 至 `:18`；`backend/extensions/built-in-sensors/sit1024FrameProcessor.js:54`、`:232` |
| 分帧 | 1024 字节载荷后接 `AA 55 03 99`；分隔符不进入数据 | `sdk/backend/protocol/presets/standard-1024.json:11`；`sdk/backend/serial/serialParserManager.js:50` |
| 数据位/校验/停止位 | 软件使用 serialport 默认 8N1，无 RTS/CTS 或 XON/XOFF 流控 | `sdk/backend/serial/serialManager.js:218` 仅传 path/baudRate/autoOpen；已安装 `@serialport/bindings-cpp/dist/win32.js:37` 的默认值 |

`backend/kernel/serial/nativeSerialDetection.js:16` 将两种人体展示系统都关联到 `standard-1024`。本 SDK 只提供一个规范产品 `humanBody`，不把优化后的可视化页面注册成另一种硬件协议。

每个采样值只有一个字节，不涉及 16 位大小端转换。上位机处理器在 `sit1024FrameProcessor.js:232` 拒绝非 1024 字节载荷；`:85` 的产品映射分支没有人体特例，`:218` 返回原序 `sitData`。未发现人体帧的 CRC、序号或转义校验；SDK 不凭此声称设备数据已经过完整性校验。上述串口默认值来自软件配置，尚未经实机验证。

分帧沿用来源的尾标记规则：如果 ADC 载荷内部恰好出现完整 `AA 55 03 99`，该帧会被提前切分并因长度不符而丢弃。协议未定义转义，因此不能将此方式视为无损定长传输；SDK 不把碎片拼成猜测数据。

## 返回字段

| 字段 | 表示 |
| --- | --- |
| `raw`、`pressure` | 同一个 `Uint8Array(1024)`，按串口扫描顺序保留全部 ADC；包括不在十块源矩阵中的通道 |
| `rows`、`cols` | `32`、`32`，仅是原扫描数据的存储形状 |
| `pressureMatrix` | `Uint8Array(1024)`；依次仍为原扫描通道，不是身体展开图 |
| `values` | `Float32Array(1024)`；对应原扫描值除以 `255`，不等于标定后的物理压力 |
| `regions` | 十个源矩阵，详见下表；矩阵不翻转、不插值、不重复行 |
| `timestamp` | SDK 接收解析时的时间戳，不是设备自带时间戳 |

顶层 `center`、`area` 等继承基础 Frame 对扫描存储矩阵的统计，**不能当成人体空间重心或接触面积**。身体数据应按 `regions` 读取，再由应用明确决定模型/屏幕位置与几何单位。

产品描述中的 `sensorPoints: 1024` 表示完整扫描通道数，`mappedSensorPoints: 400` 表示当前物理源表覆盖的不同通道数。其余 624 通道仍保留在原始帧中；本映射不推断它们的硬件用途。

每个 `regions[key]` 含：

```js
{
  name: 'back',                    // 原始物理表的稳定 key；不是屏幕方向标签
  rows: 6,
  cols: 10,
  sourceIndices: Uint16Array(60),  // 0 基原扫描下标，可达 1023
  raw: Uint8Array(60),             // raw[i] = frame.raw[sourceIndices[i]]
  values: Float32Array(60),        // 每点 ADC / 255
  matrix: [/* 6 行，每行 10 个 ADC */], // number[][]；按行展开等于 raw
}
```

各帧区域的类型数组、行数组和 `sourceIndices` 都是独立快照。`raw` 与 `pressure` 的共享引用仅用于表示它们是同一份完整扫描数据；修改快照不会更改后续帧的固定线序。

## 十块源矩阵与核对点

唯一线序依据是 `client/src/visualization/human-body/humanBodyRawLayout.js:11` 的 `HUMAN_BODY_RAW_SOURCE_MATRICES`。源文件 `:8` 明确这是屏幕投影前的十块物理矩阵，`:9` 明确通道号从 1 开始。SDK 只将每个通道号减 1；保持表内行序和列序。

| `regions` key / `name` | 行×列 | 首点 `sourceIndices[0]` | 末点 `sourceIndices.at(-1)` | 源表起始行 |
| --- | --- | --- | --- | --- |
| `back` | 6×10 | 618 | 4 | 12 |
| `chest` | 6×10 | 691 | 69 | 20 |
| `rightArm` | 6×7 | 735 | 986 | 28 |
| `rightShoulder` | 6×3 | 959 | 890 | 36 |
| `leftArm` | 6×7 | 1012 | 729 | 44 |
| `leftShoulder` | 6×3 | 884 | 953 | 52 |
| `backPantsRight` | 8×5 | 196 | 320 | 60 |
| `backPantsLeft` | 8×5 | 494 | 362 | 70 |
| `frontPantsLeft` | 8×5 | 499 | 367 | 80 |
| `frontPantsRight` | 8×5 | 201 | 325 | 90 |

`rightArm.sourceIndices[5] === 1023`，对应源表第一行第六列的通道 `1024`。这个核对点可以发现误用 `Uint8Array` 导致通道号截断的问题。十块矩阵共 400 项且全部唯一，最小下标 0，最大 1023。

`name` 与 key 保持一致，因为源工程的显示左右并不直接等于源表命名：`humanBodyOrientation.js:1` 将模型标签“右肩”“右手臂”分别映射到 `leftShoulder`、`leftArm`。SDK 不从这些显示标签反推穿戴者的解剖左右；如果应用要贴到模型或实物上，需要按安装与显示朝向核对。

完整表的回归摘要：将十个 key 按上表顺序组成对象，每个值为按行展开后的 **0 基** 普通数组，再对 `JSON.stringify` 的 UTF-8 字节取 SHA-256：

```text
bd85c8fbc2535d0b9dc52a067042d029ce079d18971d90d939222c83b2948a54
```

该摘要直接从上位机源表生成，测试不依赖外部上位机目录。

## 哪些显示处理没有移植

| 上位机代码 | 处理 | 为什么不能作为串口线序 |
| --- | --- | --- |
| `humanBodyRawLayout.js:106`、`:211`、`:274` | 显示槽的行列投影；胸背重复行 | 14 个显示槽合计 520 个显示单元，实际仍只有 400 个源通道；重复行不是新增采样点 |
| `humanBodyRawLayout.js:234`、`:242`、`:297`、`:306` | 前后腿显示槽与源矩阵的左右映射 | 属于屏幕布局，SDK 保留源 key，不调换源表 |
| `humanBody.jsx:97`、`:108` | 两个 `backPants` 表 `.reverse()` | 模型显示行序；这两块与物理源表相反，其余八块相同 |
| `humanBody.jsx:143`、`:236` | UV 放置；低于显示阈值的值设为 0 | UV 与阈值改变的是可视化，不能改写客户收到的 ADC |
| `humanBodyOrientation.js:10`、`:53` | 模型/数字图翻行、翻列 | 不同显示方式朝向不同，不是硬件重新采样 |
| `HumanBodyOptimized.jsx:331` | 四邻点双线性加权采样 | 是几何热力图插值，不是一个单元对应一个硬件通道 |
| `backend/kernel/realtime/frameOutputPipelineService.js:44` | 可选归零适配器 | 是上位机输出阶段的数值变换，不属于原始串口协议 |
| `client/src/page/home/Home.jsx:427` | 不足 1024 长度的旧展示数据经 `robot0401` 变换 | 本产品适配器只接收明确的 1024 字节串口载荷，不推断旧格式 |

已有 SDK 的 `src/core/layout.js:614` 仅把人体列为 `layout: 'raw'`、32×32；`:538` 的 `getLayout` 对 `raw` 返回 `null`。它原本没有上述十块源矩阵。新增线序位于 `src/core/products/body-layout.js`，没有改变通用 `raw` 的含义。

## 验证范围

`tests/body-product.test.mjs` 用合成字节验证固定帧长/帧尾、跨 chunk 半帧、400 点全表摘要、高位通道 1023、未映射通道保留、快照隔离，以及 WS 编解码。WS 校验在转成类型数组前检查下标为 `0…1023` 整数且与固定线序完全一致，并核对区域 ADC、归一化值和矩阵与完整扫描值一致。

另外已只读调用上位机 `sit1024FrameProcessor`：`humanBody` 与 `humanBodyOptimized` 的合成 1024 字节均逐字节原序返回，1023 字节均被拒绝。本次没有连接真实人体硬件，也没有把上位机后续归零/展示算法作为验证结果的一部分。
