#!/usr/bin/env node
// 主动性判定（2026-11-14 学生拍板，借鉴大肥鱼 2.0 的"闲置触发"）
// 不看死时钟，看"他多久没理我"：闲置 ≥90 分钟、且两小时内没主动找过他，才开口。
// 用法：
//   node bin/nudge.mjs decide   → 输出 {go:true|false, reason, ...}，go=false 就别发
//   node bin/nudge.mjs record --text "发了什么"   → 记一次主动消息
//   node bin/nudge.mjs stats
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STREAM = path.join(ROOT, 'mem', 'stream.jsonl');
const NUDGES = path.join(ROOT, 'data', 'nudge.jsonl');
const IDLE_MIN = 90;      // 他多久没说话才算"闲"
const MIN_GAP_MIN = 120;  // 两次主动至少隔 2 小时
const DAILY_CAP = 12;

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SH = 8 * 3600e3;
const localIso = (ms = Date.now()) => new Date(ms + SH).toISOString().replace('Z', '+08:00');
const today = () => localIso().slice(0, 10);
const hourMin = (ms = Date.now()) => { const d = new Date(ms + SH); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

function readJsonl(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

function lastInteraction() {
  const rows = readJsonl(STREAM).filter(r => ['qq', 'app'].includes(r.src) && !r.auto);
  const last = rows[rows.length - 1];
  return last ? new Date(last.t).getTime() : null;
}

function nudgeStats() {
  const rows = readJsonl(NUDGES);
  const t = today();
  const todayRows = rows.filter(r => (r.t || '').slice(0, 10) === t);
  const last = rows[rows.length - 1];
  return { sentToday: todayRows.length, lastSentAt: last ? new Date(last.t).getTime() : null, total: rows.length };
}

function decide() {
  const now = Date.now();
  const hm = hourMin(now);
  const { sentToday, lastSentAt } = nudgeStats();
  const last = lastInteraction();
  const idleMin = last ? Math.round((now - last) / 60000) : null;

  if (hm >= 23 * 60 + 30 || hm < 6 * 60 + 30) return { go: false, reason: '静默时段（23:30–06:30 只记不发）' };
  if (sentToday >= DAILY_CAP) return { go: false, reason: `今天已主动发 ${sentToday} 条，到上限 ${DAILY_CAP}` };
  if (lastSentAt && (now - lastSentAt) / 60000 < MIN_GAP_MIN) return { go: false, reason: `距上次主动不到 ${MIN_GAP_MIN} 分钟` };
  if (idleMin === null) return { go: false, reason: '没有他的发言记录，不敢乱开头' };
  if (idleMin < IDLE_MIN) return { go: false, reason: `他 ${idleMin} 分钟前刚说过话，不算闲` };
  return { go: true, reason: `他 ${idleMin} 分钟没说话，且 ${lastSentAt ? Math.round((now - lastSentAt) / 60000) : '∞'} 分钟没主动找过`, idleMin, sentToday };
}

switch (cmd) {
  case 'decide': {
    const d = decide();
    console.log(JSON.stringify({ t: localIso(), ...d }));
    break;
  }
  case 'record': {
    const text = opt('text', '');
    if (!text) { console.error('缺 --text'); process.exit(1); }
    fs.appendFileSync(NUDGES, JSON.stringify({ t: localIso(), text: text.slice(0, 200) }) + '\n');
    console.log(JSON.stringify({ ok: true, sentToday: nudgeStats().sentToday }));
    break;
  }
  case 'stats': console.log(JSON.stringify({ ...nudgeStats(), idleMin: (() => { const l = lastInteraction(); return l ? Math.round((Date.now() - l) / 60000) : null; })() }, null, 2)); break;
  default: console.log('用法: decide | record --text "…" | stats');
}
