/**
 * 一个零依赖的小服务器，用来打开浏览器示例。
 *
 *   node start.mjs
 *
 * 为什么不能直接双击 web/index.html：浏览器不允许 file:// 页面加载 ES 模块，
 * 而且 Web Serial 只在 https 或 localhost 下可用。跑这个脚本两个问题一起解决。
 */
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5178;
// 端口被占用就顺延，不要直接崩掉
const PORT_CANDIDATES = [PORT, PORT + 1, PORT + 2, PORT + 3, PORT + 4];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** 用系统默认浏览器打开，失败也无所谓，命令行里有地址 */
function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* 打不开就算了 */
  }
}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/') path = '/web/index.html';

  // 防目录穿越：normalize 之后必须还在 ROOT 里
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + path);
  }
});

// 跑之前先确认目录对不对 —— 在外层文件夹里跑是最常见的错误
try {
  await access(join(ROOT, 'web', 'index.html'));
} catch {
  console.error(`\n  这个目录下没有 web/index.html：\n    ${ROOT}`);
  console.error('  你可能在外层文件夹里运行了。先 cd 到解压出来的 shroom-sdk 目录再试。\n');
  process.exit(1);
}

// 只在这里报地址，而且用真正绑定成功的端口，避免重试后报错端口
server.once('listening', () => {
  server.removeAllListeners('error');
  const url = `http://localhost:${server.address().port}`;
  console.log(`\n  Shroom SDK 示例已启动：${url}`);
  console.log(`  WS、标签录制与下载示例：${url}/web/quick-start.html`);
  console.log('  浏览器应该会自动打开；没打开就自己把上面这行地址复制过去。');
  console.log('  用 Chrome 或 Edge 打开，Ctrl+C 退出。\n');
  openBrowser(url);
});

/** 依次尝试候选 HTTP 端口；只有地址占用才重试，其他启动失败直接报告。 */
function listen(ports) {
  const port = ports[0];
  if (port === undefined) {
    console.error(`\n  ${PORT_CANDIDATES.join('、')} 这几个端口都被占用了。`);
    console.error('  换一个端口再试，例如：\n    PORT=6001 node start.mjs\n');
    process.exit(1);
  }
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`  端口 ${port} 被占用，换 ${ports[1] ?? '下一个'} 试试`);
      listen(ports.slice(1));
    } else {
      console.error('\n  启动失败：', err.message, '\n');
      process.exit(1);
    }
  });
  server.listen(port);
}

listen(PORT_CANDIDATES);
