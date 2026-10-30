# SDK 版本与发布

本仓库只维护 SDK。版本唯一来源是根目录 `package.json` 的 `version`；版本命令同步 Node.js、浏览器与 Python 运行时及 Python 包元数据。官网在独立的 [shroomSDKWEB](https://github.com/liudada118/shroomSDKWEB) 仓库，其网站版本不代表 SDK 版本。

日常流程：**修改源码 → 升版与更新日志 → 验证 → 提交 → 推送版本标签 → 检查 Release 草稿 → 发布**。

## 常用命令

在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run sdk:version -- --check` | 只读检查各入口的版本是否一致 |
| `npm run sdk:version -- --sync` | 按根 `package.json` 同步生成的版本文件 |
| `npm run sdk:version -- bump patch` | 修复升版，例如 `0.1.0 → 0.1.1` |
| `npm run sdk:version -- bump minor` | 功能升版，例如 `0.1.0 → 0.2.0` |
| `npm run sdk:version -- bump major` | 不兼容升级，例如 `0.2.0 → 1.0.0` |
| `npm run sdk:version -- bump 0.2.0` | 明确指定更高的稳定版本 |
| `npm run sdk:check` | 快速检查发布配置的一致性 |
| `npm run pack:sdk` | 构建并生成当前版本的三个兼容 ZIP |
| `npm run sdk:verify` | 运行完整发布门禁 |
| `npm run sdk:release` | 完整门禁通过后生成本地版本制品 |
| `npm run sdk:release -- --require-clean` | 正式发布检查：干净 Git 工作区、匹配版本标签与当前提交 |

版本命令只接受 `X.Y.Z` 稳定版本，拒绝覆盖当前版本、降级、前导 `v` 和预发布后缀。修改产品协议、返回字段或生命周期时，在更新日志中明确兼容性影响，不仅根据改动行数选择版本。

## 准备维护环境

维护环境使用 Node.js 22.22.0 / npm 10.9.4 与 Python 3.11+；CI 固定 Node.js 22.22.0 和 Python 3.12。Python SDK 客户运行时仍支持 3.10+，发布测试锁文件的要求更高。SDK 构建与发布无需安装官网或 React。首次安装或锁文件更新后执行：

```powershell
# 独立 SDK 仓库：运行依赖与构建工具。
git clone https://github.com/liudada118/shroomSDK.git
cd shroomSDK
npm ci

# Python：建议使用独立虚拟环境。
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r python/requirements-test.lock
.venv/Scripts/python.exe -m pip install --no-build-isolation --no-deps -e python
$env:SDK_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
```

macOS/Linux 将虚拟环境解释器换成 `.venv/bin/python`，环境变量使用 `export SDK_PYTHON="$PWD/.venv/bin/python"`。`SDK_PYTHON` 指向执行 Python 检查的解释器；未设置时依次查找 `work/sdk-release-venv`、`.venv` 中的解释器，再使用 `python`。脚本会检查依赖版本与 SDK 安装位置，避免误测全局旧包。

根 `package-lock.json` 固定 JavaScript SDK 的维护环境，`python/requirements-test.lock` 固定 Python 测试环境。Python 客户包的可选运行依赖由 `python/pyproject.toml` 声明。修改依赖后要更新对应锁文件并重新跑门禁；不要直接编辑锁文件中的解析结果。

`sdk:verify` 检查版本、原生模块加载、JS 测试、发布工具测试、Python 测试和 TypeScript 类型，再生成 ZIP。官网文档渲染、页面测试和构建由官网仓库验证，不是 SDK 发布的依赖。

完整门禁还会把实际 ZIP 解压到临时目录，按客户安装方式运行 `npm ci` 与 Python 本地安装，验证五步采集/下载及 Python 模拟取数，再清理临时目录。这一步需要能够下载 SDK 的锁定依赖；维护环境和客户安装结果分开验证。

## 制作本地候选包

1. 完成功能修改，用版本命令升版；首次受管基线保留 `0.1.0`。
2. 在 [CHANGELOG.md](CHANGELOG.md) 添加唯一的版本小节，格式为 `## [0.2.0] - YYYY-MM-DD`，写清用户可见变化、迁移要求和语言差异。
3. 执行 `npm run sdk:release`，检查测试输出与生成的文件。

普通 `pack:sdk` 输出 `dist/shroom-sdk.zip`、`dist/shroom-sdk-node.zip` 和 `dist/shroom-sdk-python.zip`。版本制品输出目录为 `dist/releases/<版本>/`，包含：

| 文件 | 内容 |
| --- | --- |
| `shroom-sdk-<版本>.zip` | 完整 SDK |
| `shroom-sdk-node-<版本>.zip` | Node.js 与浏览器 SDK |
| `shroom-sdk-python-<版本>.zip` | Python SDK |
| `manifest.json` | 版本、Git 来源、候选状态与制品信息 |
| `SHA256SUMS` | 文件校验值 |
| `RELEASE-NOTES.md` | 从对应更新日志小节提取的发布说明 |

工作区有未提交修改时，只能得到候选制品，清单会记录 `source.dirty: true`。它能用于本地检查，不能作为正式发布依据；修改需要先提交，再由 CI 的干净工作区生成正式制品。

同一版本的六个文件全部一致时，可重复执行而不改写内容。文件内容、来源提交或候选状态改变都会拒绝覆盖。已生成的候选目录不应复制到正式 CI 工作区；正式发布使用匹配标签的新工作区构建。已有正式版本需要修正时，升到新版本。

## 正式发布到 GitHub

1. 执行 `npm run sdk:verify`，检查差异并提交本次版本的源码、锁文件、更新日志及需要跟踪的构建产物。
2. 确认工作区干净，推送提交和匹配版本的标签。以下是 PowerShell 示例：

```powershell
git status --short
$sdkVersion = node -p "require('./package.json').version"
git tag -a "sdk-v$sdkVersion" -m "Shroom SDK $sdkVersion"
git push origin HEAD
git push origin "sdk-v$sdkVersion"
```

3. 查看 `.github/workflows/sdk-release.yml` 对应的 **SDK release draft** 工作流。标签必须严格等于 `sdk-v<SDK版本>`，并指向当前发布提交；已有同名 Release 不会被覆盖。
4. 等 Windows、macOS、Linux 检查通过。Linux 执行完整门禁并打包，后续发布任务重新校验文件哈希、干净状态和来源提交，再创建带附件的 GitHub Release 草稿。
5. 在 GitHub 检查版本、更新说明和三个 ZIP，确认后点击 **Publish release**。草稿不是已经对外发布的版本。

日常分支或 PR 使用 `.github/workflows/sdk-ci.yml` 的 **SDK checks**。发布配置不会自动发布到 npm 或 PyPI；当前客户交付方式是官网 ZIP 与 GitHub Release 附件。

## 官网下载与回退

官网 `shroomSDKWEB` 的 `sdk/` 是本仓库的 Git 子模块，固定到明确提交。官网文档、产品配置和版本展示读取该提交；构建时将对应 SDK 的 ZIP 和浏览器演示复制到官网 `public/`，保留 `/shroom-sdk-node.zip`、`/shroom-sdk-python.zip` 和 `/shroom-sdk.zip` 下载入口。这些兼容入口随官网构建更新，不能作为历史版本定位依据。

官网不会自动跟随 SDK 的 `main`。升级官网时，先选择已验证的 SDK 提交或标签，再更新并提交官网的子模块指针，运行官网集成检查。克隆官网时使用 `git clone --recurse-submodules`；已有检出执行 `git submodule update --init --recursive`。

历史发行通过 [GitHub Releases](https://github.com/liudada118/shroomSDK/releases) 的标签与附件定位；本地版本制品位于 `dist/releases/<版本>/`。网站部署仍走现有部署流程，创建或发布 GitHub Release 不会自动替换线上网站。

排查客户问题时，先取得 `Shroom.version` 或 `shroom_sdk.__version__`，再对照该版本的更新日志和文件哈希。需要回退时安装此前保留的版本包，保留采集数据，并先检查版本间的数据格式兼容性。

## 底层制品检查

这些命令供诊断与 CI 使用，不代替 `sdk:verify` 的完整门禁：

```bash
node scripts/sdk-release-artifacts.mjs verify
node scripts/sdk-release-artifacts.mjs verify --directory dist/releases/0.1.0
```

正式验证还可以传入 `--require-clean` 与 `--expected-commit <Git提交SHA>`，确保附件来自约定的已提交源码。发布失败时根据检查结果修正，不手动改清单来绕过哈希或来源校验。
