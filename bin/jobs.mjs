#!/usr/bin/env node
// 任务队列：单执行器 + 票号 + 失败重试 + 重启恢复（2026-11-14 学生拍板，借鉴大肥鱼 2.0）
// 用法：
//   node bin/jobs.mjs enqueue --kind qq --data '{"text":"该睡了"}' [--run-at 2026-11-14T23:00]
//   node bin/jobs.mjs run [--once]
//   node bin/jobs.mjs status
//   node bin/jobs.mjs recover
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = path.join(ROOT, 'data', 'queue');
const DIRS = ['pending', 'running', 'done', 'failed'].reduce((a, d) => (a[d] = path.join(Q, d), a), {});
const LOCK = path.join(Q, '.lock');
const LOG = path.join(ROOT, 'data', 'jobs.jsonl');
const MAX_ATTEMPTS = 3;
const LOCK_STALE_MS = 15 * 60 * 1000;   // 15 分钟没心跳就当锁死了
const RUN_TIMEOUT_MS = 4 * 60 * 1000;   // 单个任务最多跑 4 分钟

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (k) => argv.includes('--' + k);
const nowIso = () => new Date().toISOString();
const local = () => {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().replace('Z', '+08:00');
};
const stamp = () => {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
};
const writeLog = (o) => { try { fs.appendFileSync(LOG, JSON.stringify({ t: local(), ...o }) + '\n'); } catch {} };

for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

function list(dir) {
  return fs.readdirSync(DIRS[dir]).filter(f => f.endsWith('.json')).sort()
    .map(f => ({ file: path.join(DIRS[dir], f), job: JSON.parse(fs.readFileSync(path.join(DIRS[dir], f), 'utf8')) }));
}
function readLock() {
  try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch { return null; }
}
function acquire() {
  const l = readLock();
  if (l && Date.now() - new Date(l.at).getTime() < LOCK_STALE_MS) return false;
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: nowIso() }));
  return true;
}
const release = () => { try { fs.unlinkSync(LOCK); } catch {} };
const beat = () => { try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: nowIso() })); } catch {} };

function recover() {
  let n = 0;
  for (const { file, job } of list('running')) {
    const age = Date.now() - new Date(job.startedAt || job.createdAt).getTime();
    if (age > RUN_TIMEOUT_MS) {
      job.attempts = (job.attempts || 1);
      job.lastError = job.lastError || '执行中断（超时回收）';
      job.recoveredAt = nowIso();
      const back = path.join(DIRS.pending, path.basename(file));
      fs.renameSync(file, back);
      fs.writeFileSync(back, JSON.stringify(job, null, 1));
      writeLog({ kind: 'recover', id: job.id, reason: 'stale-running' });
      n++;
    }
  }
  return n;
}

// 执行器：内置 noop / qq / shell；其它种类走 bin/handlers/<kind>.mjs
function exec(job) {
  const dataFile = path.join(DIRS.running, job.id + '.data.json');
  fs.writeFileSync(dataFile, JSON.stringify(job.data || {}));
  let cmdline;
  if (job.kind === 'noop') cmdline = ['node', '-e', 'process.exit(0)'];
  else if (job.kind === 'qq') cmdline = ['node', path.join(ROOT, 'bin', 'qq-send.mjs'), String((job.data || {}).text || '')];
  else if (job.kind === 'shell') cmdline = ['bash', '-lc', String((job.data || {}).cmd || '')];
  else {
    const h = path.join(ROOT, 'bin', 'handlers', job.kind + '.mjs');
    if (!fs.existsSync(h)) throw new Error('没有处理程序：bin/handlers/' + job.kind + '.mjs');
    cmdline = ['node', h, dataFile];
  }
  const [bin, ...rest] = cmdline;
  const r = spawnSync(bin, rest, { cwd: ROOT, timeout: RUN_TIMEOUT_MS, encoding: 'utf8' });
  try { fs.unlinkSync(dataFile); } catch {}
  const out = ((r.stdout || '') + (r.stderr || '')).trim().slice(-800);
  return { code: r.status === null ? 124 : r.status, out };
}

function runLoop(once) {
  if (!acquire()) { console.log(JSON.stringify({ ok: false, msg: '已有执行器在跑（锁未过期）' })); return; }
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  let done = 0, failed = 0;
  try {
    for (;;) {
      beat();
      recover();
      const due = list('pending').filter(({ job }) => !job.runAt || new Date(job.runAt).getTime() <= Date.now());
      if (!due.length) break;
      const { file, job } = due[0];
      job.attempts = (job.attempts || 0) + 1;
      job.startedAt = nowIso();
      const runFile = path.join(DIRS.running, job.id + '.json');
      fs.renameSync(file, runFile);
      fs.writeFileSync(runFile, JSON.stringify(job, null, 1));
      let res;
      try { res = exec(job); } catch (e) { res = { code: 1, out: String(e.message || e) }; }
      beat();
      job.lastError = res.code === 0 ? null : (res.out || ('exit code ' + res.code));
      job.lastCode = res.code;
      job.finishedAt = nowIso();
      if (res.code === 0) {
        fs.renameSync(runFile, path.join(DIRS.done, job.id + '.json'));
        writeLog({ kind: 'done', id: job.id, type: job.kind, attempts: job.attempts, out: res.out.slice(0, 200) });
        done++;
      } else if (job.attempts < MAX_ATTEMPTS) {
        const back = path.join(DIRS.pending, job.id + '.json');
        delete job.startedAt;
        fs.renameSync(runFile, back);
        fs.writeFileSync(back, JSON.stringify(job, null, 1));
        writeLog({ kind: 'retry', id: job.id, type: job.kind, attempts: job.attempts, err: res.out.slice(0, 300) });
      } else {
        fs.renameSync(runFile, path.join(DIRS.failed, job.id + '.json'));
        writeLog({ kind: 'failed', id: job.id, type: job.kind, attempts: job.attempts, err: res.out.slice(0, 300) });
        failed++;
      }
      if (once) break;
    }
  } finally { release(); }
  console.log(JSON.stringify({ ok: true, done, failed }));
}

switch (cmd) {
  case 'enqueue': {
    const kind = opt('kind');
    if (!kind) { console.error('缺 --kind'); process.exit(1); }
    const id = 'j-' + stamp() + '-' + Math.random().toString(36).slice(2, 6);
    const job = { id, kind, data: JSON.parse(opt('data', '{}')), createdAt: nowIso(), runAt: opt('run-at'), attempts: 0 };
    fs.writeFileSync(path.join(DIRS.pending, id + '.json'), JSON.stringify(job, null, 1));
    writeLog({ kind: 'enqueue', id, type: kind });
    console.log(JSON.stringify({ ok: true, id }));
    break;
  }
  case 'run': runLoop(flag('once')); break;
  case 'recover': console.log(JSON.stringify({ ok: true, recovered: recover() })); break;
  case 'status': {
    const counts = Object.fromEntries(Object.keys(DIRS).map(d => [d, list(d).length]));
    const pending = list('pending').slice(0, 10).map(({ job }) => ({ id: job.id, kind: job.kind, attempts: job.attempts, runAt: job.runAt }));
    const failedList = list('failed').slice(-5).map(({ job }) => ({ id: job.id, kind: job.kind, err: (job.lastError || '').slice(0, 120) }));
    const lock = readLock();
    console.log(JSON.stringify({ counts, runningLock: lock ? (Date.now() - new Date(lock.at).getTime()) / 1000 | 0 : null, pending, failed: failedList }, null, 2));
    break;
  }
  default:
    console.log('用法: enqueue --kind qq|shell|noop|自定义 --data \'{}\' [--run-at ISO] | run [--once] | status | recover');
}
