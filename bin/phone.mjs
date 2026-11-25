#!/usr/bin/env node
/**
 * phone.mjs — 直接调用手机桥（不经过 AI，脚本自己用）
 *
 * 用法:
 *   node phone.mjs screen
 *   node phone.mjs foreground          # 只返回前台应用名
 *   node phone.mjs <tool> '<json args>'
 *
 * 原理：手机桥是 unix socket（抽象命名空间）+ token，说 MCP JSON-RPC。
 */
import fs from 'node:fs';
import net from 'node:net';

const BRIDGE = '/var/lib/dsh-app/phone/bridge.json';
const cfg = JSON.parse(fs.readFileSync(BRIDGE, 'utf8'));
const token = String(cfg.token || '');
const abstract = String(cfg.abstract || '');
const tcpPort = Number(cfg.tcpPort || 0);

const tool = process.argv[2] || 'screen';
let toolArgs = {};
if (process.argv[3]) {
  try {
    toolArgs = JSON.parse(process.argv[3]);
  } catch {
    console.error('第三个参数要 JSON');
    process.exit(2);
  }
}

const sock = tcpPort > 0
  ? net.connect({ host: '127.0.0.1', port: tcpPort })
  : net.connect({ path: '\0' + abstract });

let buf = '';
const pending = new Map();
let nextId = 1;

function send(obj) {
  sock.write(JSON.stringify(obj) + '\n');
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('timeout: ' + method));
      }
    }, 30000);
  });
}

sock.on('connect', () => {
  send({ dshPhone: 1, token });
});

sock.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

sock.on('error', (e) => {
  console.error('桥连接失败: ' + (e.code || e.message));
  process.exit(1);
});

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'study-helper', version: '1.0.0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const res = await rpc('tools/call', { name: tool, arguments: toolArgs });
  const text = (res?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (tool === 'foreground') {
    // 屏幕文本第一段通常带应用名；挑最常见的“标题行”
    const first = text.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n');
    console.log(JSON.stringify({ raw: first.slice(0, 600) }));
  } else {
    console.log(text);
  }
  sock.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
