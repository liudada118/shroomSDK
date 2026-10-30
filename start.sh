#!/bin/sh
# macOS / Linux 上打开浏览器示例：sh start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node > /dev/null 2>&1; then
  echo ""
  echo "  没找到 node 命令。请先安装 Node.js 18 以上版本：https://nodejs.org"
  echo ""
  exit 1
fi

exec node start.mjs
