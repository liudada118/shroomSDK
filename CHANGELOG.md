# Shroom SDK 更新日志

发行版本统一覆盖 Node.js、浏览器和 Python 下载包；不同语言的功能范围以各自文档为准。版本来源为根目录 `package.json`，运行时可通过 `Shroom.version` 或 `shroom_sdk.__version__` 查询。

本文件记录 `shroom-sdk` 的版本。仓库原有 `shroom-backend-sdk@0.2.0` 属于另一套包与接口；其更新日志和代码保留在 `legacy-backend-sdk-0.2.0` 标签，迁移差异见 [MIGRATION.md](https://github.com/liudada118/shroomSDK/blob/main/MIGRATION.md)。两个包的版本号不构成升级或降级关系。

## [0.1.0] - 2026-10-29

首次建立受管发布基线，汇总当前已有功能，并补齐版本、测试和制品追踪流程。

### Node.js 与浏览器

- 五个快速函数：`readProduct`、`createWS`、`startRecording`、`stopRecording`、`downloadRecording`。只需产品数据时调用取数函数；网页传输、采集与下载按需接入。
- 手套与手部检测垫通过产品适配器解析数据，协议、点位映射和字段校验集中管理；新增产品可扩展适配器与注册表。
- Node.js 服务以 SQLite 保存带标签的采集会话，事务批量入库，停止等待队列写完；支持按记录 ID 导出 CSV / JSONL、异常中断恢复，以及旧 JSONL 记录读取。
- SDK 产品密钥与上位机密钥分开使用，共用授权后台；SDK 不按传感器型号限制授权，仍检查有效期、电脑名额和功能权限。
- 提供连接、配置、授权和采集错误反馈；文档以一步取数及五步调用为主线，补充中文代码注释、驱动入口和 AI 接入说明。

### Python

- 提供通用串口、分帧、矩阵 `Frame`、点位排列、模拟设备、文字热力图和可选绘图示例。
- 提供 SDK 授权与结构化异常、同步帧读取和资源关闭。
- 本版 Python 不提供 JavaScript 的产品五步函数、手套专用解析、WS 采集服务或内置 SQLite 录制。

### 发布管理

- SDK 版本统一来源，Node.js、浏览器与 Python 运行时和包元数据同步校验。
- 固定维护与测试环境的依赖；通过检查与测试后生成带版本号的 ZIP、SHA-256 校验清单、来源清单和发布说明。
- 保留官网兼容下载 URL；版本目录和同名 GitHub Release 禁止静默覆盖。
- 配置 Windows、macOS、Linux 检查；推送匹配版本标签后生成 GitHub Release 草稿，由维护者确认发布。
- 2026-10-30 将源码、测试、版本工具和发布工作流迁入独立的 `shroomSDK` 仓库；SDK 构建不再依赖官网，输出在 `dist/`。官网通过固定的 Git 子模块提交引用同一份 SDK 源码。
