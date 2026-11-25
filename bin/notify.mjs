#!/usr/bin/env node
// 主动消息闸门（2026-11-15 学生拍板）
// 起因：11-15 早上模型请求中途失败，nudge 账记了、QQ 没收到——记账不等发送成功。
// 规矩：先真发，发成功才记账；发失败就落 failed 文件 + 自动进队列重试。
// 用法：
//   node bin/notify.mjs "内容"                 # 直接发，成功才记 nudge 账
//   node bin/notify.mjs "内容" --group <openid>
//   node bin/notify.mjs "内容" --queue [--at 2026-11-15T22:30]   # 走队列（3 次重试）
//   node bin/notify.mjs "内容" --dry-run
//   node bin/notify.mjs retry [--max 5]        # 补发失败票
//   node bin/notify.mjs status
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QQ = path.join(ROOT, 'bin', 'qq-send.mjs');
const JOBS = path.join(ROOT, 'bin', 'jobs.mjs');
const NUDGES = path.join(ROOT, 'data', 'nudge.jsonl');
const FAILED = path.join(ROOT, 'data', 'notify-failed.jsonl');
const JOBS_LOG = path.join(ROOT, 'data', 'jobs.jsonl');
const MAX_TRIES = 5;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (k) => argv.includes('--' + k);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const SH = 8 * 3600e3;
const localIso = (ms = Date.now()) => new Date(ms + SH).toISOString().replace('Z', '+08:00');

function qqSend(text, group) {
  const args = [QQ, text];
  if (group) args.push('--group', group);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 90_000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  return { ok: r.status === 0, code: r.status, out };
}

function recordNudge(text) {
  try { fs.appendFileSync(NUDGES, JSON.stringify({ t: localIso(), text: String(text).slice(0, 200), via: 'notify' }) + '\n'); } catch {}
}

function failTicket(text, group, err) {
  try { fs.appendFileSync(FAILED, JSON.stringify({ t: localIso(), text: String(text).slice(0, 500), group: group || '', err: String(err).slice(0, 300), tries: 1 }) + '\n'); } catch {}
}

function jobEnqueue(text, group, runAt, run) {
  const data = JSON.stringify({ text, group: group || '' });
  const a = [JOBS, 'enqueue', '--kind', 'notify', '--data', data];
  if (runAt) a.push('--run-at', runAt);
  const r = spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) return { ok: false, out: ((r.stdout || '') + (r.stderr || '')).trim() };
  if (run) spawnSync(process.execPath, [JOBS, 'run', '--once'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  return { ok: true, out: (r.stdout || '').trim() };
}

function readFailed() {
  try { return fs.readFileSync(FAILED, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
function writeFailed(rows) {
  fs.writeFileSync(FAILED, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

const text = cmd && !['retry', 'status', 'enqueue'].includes(cmd) ? cmd : '';

switch (cmd) {
  case 'retry': {
    const max = Number(opt('max', MAX_TRIES));
    const rows = readFailed();
    if (!rows.length) { console.log('没有待补发的'); break; }
    const keep = [];
    let ok = 0, bad = 0;
    for (const row of rows) {
      if ((row.tries || 1) > max) { bad++; continue; }
      const res = qqSend(((row.tries || 1) > 1 ? '（补发）' : '') + row.text, row.group);
      if (res.ok) { recordNudge(row.text); ok++; }
      else { keep.push({ ...row, tries: (row.tries || 1) + 1, err: res.out.slice(0, 300) }); bad++; }
    }
    writeFailed(keep);
    console.log(JSON.stringify({ ok, failed: bad, left: keep.length }));
    if (bad) process.exit(1);
    break;
  }
  case 'status': {
    const rows = readFailed();
    let n = 0;
    try { n = fs.readFileSync(NUDGES, 'utf8').split('\n').filter(Boolean).length; } catch {}
    console.log(JSON.stringify({ failedQueue: rows.length, lastFailed: rows.slice(-5).map(r => ({ t: r.t, tries: r.tries, text: r.text.slice(0, 40) })), nudgeTotal: n }, null, 2));
    break;
  }
  default: {
    if (!text) { console.log('用法: notify.mjs "内容" [--group ID] [--queue] [--at ISO] [--dry-run] | retry | status'); process.exit(2); }
    const group = opt('group', '');
    if (flag('dry-run')) { console.log(JSON.stringify({ ok: true, dryRun: true, text: text.slice(0, 60) })); break; }

    if (flag('queue')) {
      let jobsLogBefore = 0;
      try { jobsLogBefore = fs.readFileSync(JOBS_LOG, 'utf8').split('\n').filter(Boolean).length; } catch {}
      const r = jobEnqueue(text, group, opt('at', null), !flag('no-run'));
      if (!r.ok) { failTicket(text, group, '入队失败：' + r.out); console.error('入队失败：' + r.out); process.exit(1); }
      let doneOk = false;
      try {
        const rows = fs.readFileSync(JOBS_LOG, 'utf8').split('\n').filter(Boolean).slice(jobsLogBefore)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        doneOk = rows.some(l => l.kind === 'done' && l.type === 'notify');
      } catch {}
      if (doneOk) recordNudge(text);
      console.log(JSON.stringify({ ok: true, queued: true, sent: doneOk, out: r.out.slice(-200) }));
      break;
    }

    const res = qqSend(text, group);
    if (res.ok) {
      recordNudge(text);
      console.log('已发送');
    } else {
      failTicket(text, group, res.out);
      jobEnqueue(text, group, null, false);
      console.error('发送失败，已排重试：' + res.out.slice(0, 200));
      process.exit(1);
    }
  }
}
