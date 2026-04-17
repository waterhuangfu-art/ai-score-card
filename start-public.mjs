import { spawn } from 'node:child_process';

const PORT = String(process.env.PORT || '8787');
let shuttingDown = false;
let localReady = false;
let publicUrl = '';

const localServer = spawn(process.execPath, ['local-server.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

let tunnel = null;

function killProcess(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killProcess(tunnel);
  killProcess(localServer);
  setTimeout(() => process.exit(code), 300);
}

function startTunnel() {
  if (tunnel || !localReady) return;

  tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  function handleTunnelOutput(source, chunk) {
    const text = String(chunk);
    source.write(`[tunnel] ${text}`);

    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && !publicUrl) {
      publicUrl = match[0];
      console.log('\n==============================');
      console.log(`公网填写地址: ${publicUrl}`);
      console.log(`公网后台地址: ${publicUrl}/admin.html`);
      console.log('说明: 保持这个终端窗口不要关闭，公网地址每次启动都会变化。');
      console.log('如果刚打开遇到 1033，等 5-10 秒刷新一次，通常是 quick tunnel 刚创建时的短暂延迟。');
      console.log('==============================\n');
    }
  }

  tunnel.stdout.on('data', (chunk) => {
    handleTunnelOutput(process.stdout, chunk);
  });

  tunnel.stderr.on('data', (chunk) => {
    handleTunnelOutput(process.stderr, chunk);
  });

  tunnel.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`公网隧道已退出，退出码 ${code ?? 'unknown'}`);
    shutdown(code || 1);
  });
}

localServer.stdout.on('data', (chunk) => {
  const text = String(chunk);
  process.stdout.write(`[local] ${text}`);

  if (!localReady && text.includes('评分卡本地服务已启动')) {
    localReady = true;
    startTunnel();
  }
});

localServer.stderr.on('data', (chunk) => {
  process.stderr.write(`[local] ${String(chunk)}`);
});

localServer.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`本地服务已退出，退出码 ${code ?? 'unknown'}`);
  shutdown(code || 1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
