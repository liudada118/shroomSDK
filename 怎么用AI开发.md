# 用 AI 接入 SDK：一个函数拿到产品数据

把 [AI-CONTEXT.md](AI-CONTEXT.md) 交给 AI，先用 **`readProduct()` 一个函数拿到产品数据**。你负责说明产品和目标，AI 依据现有函数写调用代码。

实时取数在 Node.js 中即可完成。需要网页接收、保存和下载时，再按需扩展为 **取数 → 创建 WS → 开始采集 → 停止采集 → 下载**。Python 请使用 [Python 专用说明](python/README.md)，目前不提供这五个函数。

## 1. 准备 SDK 和设备 {#prepare}

1. 下载 Node.js（含浏览器）SDK，安装 Node.js 18+，在 SDK 根目录执行 `npm install`；实机取数使用 `serialport`，采集服务使用 `ws / better-sqlite3`。
2. CH34x 设备先确认驱动可用：[Windows 驱动](https://shroom.jq-industries.com/drive/CH341SER.EXE) · [macOS 驱动](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。安装后重新插拔，确认系统能识别串口；没有串口先查[驱动说明](docs/DRIVERS.md)。
3. 确认产品、左右手和实际串口；准备有效的 **Shroom SDK** 密钥，按[授权说明](docs/LICENSE.md)在 Node.js 中激活。上位机密钥不能用于 SDK，密钥不要发进聊天或写进公开代码。

手套需要选左手或右手；检测垫不用选。授权不限制设备型号，但 SDK 仍需有该产品的协议适配。SDK 文件夹中有内部模块，不用逐个理解，也不要只取出 `quick-flow.js` 一个文件。

## 2. 把说明与需求交给 AI {#give-context}

在能读取项目文件的工具中，让 AI 先读 `sdk/AI-CONTEXT.md`；使用聊天工具时上传这份文件，或从文档中心“给 AI 的上下文”复制全文。涉及基础接口时再补充对应文档。

下面这段可直接发送，替换方括号内容：

> 先读 SDK 的 AI-CONTEXT.md，用 readProduct 一个函数帮我拿到产品数据。
>
> 产品是：[触觉手套 / 手部检测垫]；手套左右手是：[左 / 右]。
> 连接设备的电脑系统是：[Windows / macOS / Linux]，实际串口是：[COM3 或其他路径]。
> 我的项目是：[已有网页 / Node.js 程序]，希望展示：[需要的产品数据]。
>
> 先给 Node.js 取数调用，带中文注释，通过 onData 把数据交给我的业务。处理调用失败和运行中报错，不先搭整套页面或采集服务。
> 先给调用片段，不需要生成完整 HTML 或演示工程。授权从我的本地配置读取，不在代码中写真实密钥。

需要采集与下载时，再补充：

> 在已有取数上增加创建 WS、开始采集、停止采集和下载。说明每段在 Node.js 还是网页运行；网页三个按钮共用一个连接。处理采集结果异常，不自动重试命令，不重复实现 SDK 已有的采集功能。

## 3. 一步取数，其余按需接入 {#five-steps}

| 步骤 | 调用 | 放在哪里 |
| --- | --- | --- |
| ① 取数 | `readProduct({ product, path, onData, onError })`；手套另填 `side` | Node.js，`onData` 接收解析后的产品数据 |
| ② 创建 WS | `createWS(device, options)`；网页 `readProduct({ url, onData, onError })` | Node.js 创建服务，网页连接一次 |
| ③ 开始采集 | `startRecording(stream, { label })` | 网页“开始采集”按钮 |
| ④ 停止采集 | `stopRecording(stream)` | 网页“停止采集”按钮，等待结果写入完成 |
| ⑤ 下载 | `downloadRecording(stream, { format: 'csv' })` | 网页“下载”按钮，也可选 `jsonl` |

具体参数与带错误处理的片段见 [AI 五步说明](AI-CONTEXT.md#flow-read)。五个函数统一从 `quick-flow.js` 导入；网页的三个按钮共用一个 `stream`，SDK 会记住本次停止的记录 ID。

采集数据实际保存在 Node 电脑上的 SQLite，默认文件为 `.shroom-recordings/recordings.sqlite`。SDK 负责批量入库，停止时等待已接收帧写入完成；下载时再从数据库生成 CSV / JSONL。你不需要管理表结构或另写一套采集逻辑。

仅在 Node.js 中取数时，第 1 步就已完成。需要网页接收时，先运行 Node.js 的设备与 WS 代码，再从同一台电脑的 localhost 网页连接。已有网页项目使用自己的开发服务器；需要 SDK 自带静态服务时，在 SDK 根目录执行 `node start.mjs --no-open`，用终端打印的地址访问自己的页面。这个命令只提供网页文件，**不会替你创建设备 WS 服务**。网页 HTTP 地址与 `ws://127.0.0.1:19999` 各有用途，不要互换，也不要双击 HTML。

不要在页面加载时连续开始、停止和下载。先观察实际按压能更新数据，再由用户点击各步骤。

## 4. 错误处理有没有做 {#errors}

**SDK 已有错误检查，页面仍需要接住并提示。** 让 AI 同时处理以下三种结果：

| 情况 | 应用应该做什么 |
| --- | --- |
| 前四个函数调用失败；下载函数同步报错 | 使用 `try / catch`，说明参数、授权、连接或采集问题 |
| 连接之后断线、读流或解析出错 | 接收 `onError`，提示原因并更新连接状态 |
| 录制过程出错，或停止结果是 `status: 'error'` | 监听 `stream.onRecording()`，检查停止结果的 `status / error / frameCount`，明确告诉用户可能只保存了部分数据 |

超时不代表服务端没有执行。先查询实际采集状态，不要自动重复点击或重发开始命令。下载函数只触发下载，不保证文件已保存；出现异常记录时仍可尝试下载检查，但不能提示“完整采集成功”。

向 AI 反馈时提供：**哪一步失败、错误码和消息、预期结果、实际结果**。Node.js 报错从终端复制，网页报错从开发者工具 Console 复制；删去真实密钥等私密配置。

## 5. 验证和结束使用 {#verify}

- **取数**：真实触按能让对应产品字段持续变化。手套看五指、指腹、手掌；检测垫看矩阵。
- **采集**：开始后再停止，查看最终状态、错误和已保存帧数。
- **下载**：实际打开 CSV / JSONL，核对本次标签与数据内容。发起下载不等于验收通过。
- **退出**：只取数时调用 `await device.close()`；使用采集时明确停止，再关闭网页连接。Node.js 的 `server.close()` 会一并收尾并释放设备；仅关闭网页不会停止后台录制。

ADC 与归一化相对值不能直接标成 kPa、牛顿或公斤。模拟数据可帮助调试基础矩阵显示，不能证明真实设备或手套协议已正常工作。曲线、回放与业务算法由应用另外实现。

需要查参数时，从[五步与基础 API 对照](docs/CUSTOM.md#quick-to-base)进入；不必先读完整个 SDK 源码目录。
