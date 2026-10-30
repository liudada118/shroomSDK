"""发布测试前验证隔离环境，防止缺少授权依赖导致测试被跳过。"""
import importlib.metadata
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
if sys.version_info < (3, 11):
    raise SystemExit("锁定的发布测试环境需要 Python 3.11+，CI 使用 Python 3.12；SDK 运行时要求仍为 3.10+。")
problems = []
for line in (root / "python/requirements-test.lock").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    name, expected = line.strip().split("==")
    try:
        actual = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        actual = "未安装"
    if actual != expected:
        problems.append(f"{name}: 需要 {expected}，当前 {actual}")
try:
    import shroom_sdk
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    if shroom_sdk.__version__ != version:
        problems.append(f"Python SDK 版本应为 {version}，当前 {shroom_sdk.__version__}")
    if Path(shroom_sdk.__file__).resolve().parent != (root / "python/src/shroom_sdk").resolve():
        problems.append("Python 正在引用其他位置的 SDK，请在隔离环境安装本仓库的 editable 包")
except ImportError:
    problems.append("未安装本仓库的 Python SDK")
if problems:
    raise SystemExit("\n".join(problems) + "\n请按 SDK-RELEASING.md 安装锁定测试环境，或设置 SDK_PYTHON。")
print(f"Python {sys.version.split()[0]}：锁定依赖和 SDK {version} 检查通过")
