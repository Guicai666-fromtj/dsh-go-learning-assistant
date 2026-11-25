#!/usr/bin/env node
// jobs 队列里的 notify 执行器（2026-11-15）
// 入队：node bin/jobs.mjs enqueue --kind notify --data '{"text":"内容","group":""}'
// 行为：调 qq-send 真发；成功才记 nudge 账；失败退出码非 0，交给 jobs 重试（最多 3 次）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QQ = path.join(ROOT, 'bin', 'qq-send.mjs');
const NUDGE = path.join(ROOT, 'bin', 'nudge.mjs');
const dataFile = process.argv[2];
if (!dataFile) { console.error('缺 data 文件参数'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const text = String(data.text || '');
if (!text) { console.error('缺 text'); process.exit(2); }

const args = [QQ, text];
if (data.group) args.push('--group', String(data.group));
const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 90_000 });
if (r.status !== 0) {
  console.error(((r.stdout || '') + (r.stderr || '')).trim().slice(-300) || '发送失败');
  process.exit(1);
}
spawnSync(process.execPath, [NUDGE, 'record', '--text', text], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
console.log('已发送');
