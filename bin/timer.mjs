#!/usr/bin/env node
// 计时事件流整理：AutoX 写的 timer-*.jsonl → data/study_log.jsonl
// 用法：
//   node bin/timer.mjs ingest [--close-partial]
//   node bin/timer.mjs today
//   node bin/timer.mjs show [-n 10]
// 环境变量：TIMER_DIR 覆盖输入目录，STUDY_LOG 覆盖输出文件，
//           TIMER_STATE 覆盖进度文件（默认跟 STUDY_LOG 同目录的 .timer-ingest.json）
import fs from 'node:fs';
import path from 'node:path';

const TIMER_DIR = process.env.TIMER_DIR || '/sdcard/Download/DSH-Go/autox';
const STUDY_LOG = process.env.STUDY_LOG || '/root/学习助手/data/study_log.jsonl';
const STATE_PATH = process.env.TIMER_STATE || path.join(path.dirname(STUDY_LOG), '.timer-ingest.json');
const BJ_MS = 8 * 3600e3; // 北京时间 = UTC+8（无夏令时）
const DAY_MS = 86400e3;
const PARTIAL_GATE_MS = 90 * 60e3; // 未结段至少 90 分钟没动静才认为已结束

// ---------- 时间工具（全部按北京时间算）----------
function bjISO(ts) { return new Date(ts + BJ_MS).toISOString(); }
function bjDay(ts) { return bjISO(ts).slice(0, 10); }
function bjTime(ts) { return bjISO(ts).slice(0, 19).replace('T', ' '); }
function dayStart(day) { return Date.parse(day + 'T00:00:00+08:00'); }
function nextDay(day) { return bjDay(dayStart(day) + DAY_MS); }
function r1(n) { const x = Number(n); return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0; }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }

// ---------- 参数 ----------
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^--?[A-Za-z]/.test(a)) {
      const k = a.replace(/^--?/, '');
      const v = argv[i + 1] && !/^--?[A-Za-z]/.test(argv[i + 1]) ? argv[++i] : 'true';
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

// ---------- 读事件 ----------
function evTs(e) {
  const n = Number(e.ts);
  if (Number.isFinite(n) && n > 0) return n;
  if (typeof e.bj === 'string') {
    const m = e.bj.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) {
      const t = Date.parse(`${m[1]}T${m[2]}+08:00`);
      if (Number.isFinite(t)) return t;
    }
  }
  return NaN;
}

// 整行切分：没有结尾换行的最后一行可能是写到一半，留到下次再读
function splitLines(text) {
  if (!text) return { lines: [], incomplete: false };
  const parts = text.split('\n');
  let incomplete = false;
  if (parts[parts.length - 1] !== '') { incomplete = true; parts.pop(); }
  else parts.pop();
  return { lines: parts, incomplete };
}

function sessionOf(e, ts) {
  return {
    cat: String(e.cat || '未知'),
    startTs: ts,
    endTs: ts,
    focusSec: 0,
    distractSec: 0,
    distractCnt: 0
  };
}
function normalizeSession(s) {
  if (!s || !Number.isFinite(Number(s.startTs))) return null;
  return {
    cat: String(s.cat || '未知'),
    startTs: Number(s.startTs),
    endTs: num(s.endTs, Number(s.startTs)),
    focusSec: Math.max(0, num(s.focusSec, 0)),
    distractSec: Math.max(0, num(s.distractSec, 0)),
    distractCnt: Math.max(0, Math.round(num(s.distractCnt, 0)))
  };
}

// 一段 → 1~N 条记录（跨北京日期就按时间比例拆开）
function finalizeSeg(s, partial) {
  const startTs = s.startTs;
  const endTs = Math.max(s.endTs || startTs, startTs);
  const totalMin = Math.max(0, num(s.focusSec, 0)) / 60;
  const totalDm = Math.max(0, num(s.distractSec, 0)) / 60;
  const totalCnt = Math.max(0, Math.round(num(s.distractCnt, 0)));
  const row = (date, minutes, dm, dc, startAt, endAt) => ({
    date,
    subject: s.cat,
    minutes: Math.max(0, r1(minutes)),
    distractMin: Math.max(0, r1(dm)),
    distractCnt: Math.max(0, Math.round(dc)),
    source: 'autox',
    startAt,
    endAt,
    partial: !!partial
  });

  if (endTs <= startTs) {
    return [row(bjDay(startTs), totalMin, totalDm, totalCnt, bjTime(startTs), bjTime(endTs))];
  }

  // 按北京日期的自然日边界切
  const parts = [];
  let cur = startTs;
  while (cur < endTs) {
    const day = bjDay(cur);
    const stop = Math.min(endTs, dayStart(nextDay(day)));
    parts.push({ day, a: cur, b: stop });
    cur = stop;
  }
  if (parts.length === 1) {
    return [row(parts[0].day, totalMin, totalDm, totalCnt, bjTime(startTs), bjTime(endTs))];
  }

  const span = endTs - startTs;
  let leftMin = r1(totalMin), leftDm = r1(totalDm), leftCnt = totalCnt;
  const out = [];
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    const frac = Math.min(1, Math.max(0, (p.b - p.a) / span));
    const mins = last ? leftMin : r1(totalMin * frac);
    const dm = last ? leftDm : r1(totalDm * frac);
    const dc = last ? leftCnt : Math.round(totalCnt * frac);
    leftMin = r1(leftMin - mins);
    leftDm = r1(leftDm - dm);
    leftCnt -= dc;
    out.push(row(p.day, mins, dm, dc, bjTime(p.a), bjTime(last ? endTs : p.b - 1000)));
  });
  return out;
}

// ---------- study_log 读写 ----------
function readLog() {
  if (!fs.existsSync(STUDY_LOG)) return [];
  const out = [];
  for (const line of fs.readFileSync(STUDY_LOG, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o);
    } catch { /* 旧行坏了不影响新数据 */ }
  }
  return out;
}

function keyOf(r) {
  return [r.date, r.subject, r.startAt, r.endAt].join('|');
}

// 手写序列化：minutes / distractMin 固定 1 位小数（JSON.stringify 会把 25.0 写成 25）
function formatRow(r) {
  return '{"date":' + JSON.stringify(r.date)
    + ',"subject":' + JSON.stringify(r.subject)
    + ',"minutes":' + Number(r.minutes).toFixed(1)
    + ',"distractMin":' + Number(r.distractMin).toFixed(1)
    + ',"distractCnt":' + Math.round(Number(r.distractCnt) || 0)
    + ',"source":"autox"'
    + ',"startAt":' + JSON.stringify(r.startAt)
    + ',"endAt":' + JSON.stringify(r.endAt)
    + ',"partial":' + (r.partial ? 'true' : 'false') + '}';
}

function appendRows(rows) {
  if (!rows.length) return 0;
  fs.mkdirSync(path.dirname(STUDY_LOG), { recursive: true });
  fs.appendFileSync(STUDY_LOG, rows.map(formatRow).join('\n') + '\n');
  return rows.length;
}

// ---------- 进度 ----------
function loadState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { s = {}; }
  const files = s && s.files && typeof s.files === 'object' ? s.files : {};
  return { version: 1, files, pending: normalizeSession(s && s.pending) };
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 0) + '\n');
  fs.renameSync(tmp, STATE_PATH);
}

function listTimerFiles() {
  let names = [];
  try { names = fs.readdirSync(TIMER_DIR); } catch { return []; }
  return names.filter(f => /^timer-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
}

// ---------- ingest ----------
function cmdIngest(closePartial) {
  const files = listTimerFiles();
  if (!files.length) {
    console.log(`没有找到 timer-*.jsonl（目录：${TIMER_DIR}）`);
    return;
  }
  const state = loadState();
  let open = state.pending;

  const seen = new Set();
  for (const r of readLog()) {
    if (r && r.source === 'autox' && r.startAt) seen.add(keyOf(r));
  }
  const freshOnly = rows => {
    const out = [];
    for (const r of rows) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  };

  let grandSeg = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(TIMER_DIR, f), 'utf8'); } catch (e) {
      console.log(`文件 ${f}：读取失败（${e.code || e.message}）`);
      continue;
    }
    const { lines, incomplete } = splitLines(text);
    let done = Math.max(0, Math.round(num(state.files[f], 0)));
    if (done > lines.length) done = 0; // 文件被重写/截断：从头再读，靠去重兜底
    const newCount = lines.length - done;

    const rows = [];
    let bad = 0, dup = 0, orphan = 0, superseded = 0;

    for (let i = done; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let e;
      try { e = JSON.parse(raw); } catch { bad++; continue; }
      if (!e || typeof e !== 'object' || Array.isArray(e)) { bad++; continue; }
      const ts = evTs(e);
      if (!Number.isFinite(ts)) { bad++; continue; }
      const ev = String(e.ev || '');

      if (ev === 'start') {
        if (open) { // 上一段没 stop 就开了新段：按被新段切断处理，记 partial
          rows.push(...finalizeSeg(open, true));
          superseded++;
        }
        open = sessionOf(e, ts);
        continue;
      }
      if (!open) {
        if (ev === 'stop') dup++;   // 重复 stop / 没有对应 start
        else orphan++;             // tick/pause 等孤立事件
        continue;
      }

      if (ev === 'tick') {
        open.focusSec = Math.max(open.focusSec, num(e.focusSec, open.focusSec));
        open.endTs = ts;
      } else if (ev === 'pause' || ev === 'resume') {
        open.focusSec = Math.max(open.focusSec, num(e.accSec, open.focusSec));
        open.endTs = ts;
      } else if (ev === 'distract') {
        open.distractSec = Math.max(0, open.distractSec + Math.max(0, num(e.gapSec, 0)));
        open.distractCnt += 1;
        open.endTs = ts;
      } else if (ev === 'pomo') {
        open.endTs = ts;
      } else if (ev === 'stop') {
        rows.push(...finalizeSeg({
          cat: String(e.cat || open.cat),
          startTs: open.startTs,
          endTs: Math.max(ts, open.startTs),
          focusSec: num(e.focusSec, open.focusSec),
          distractSec: num(e.distractSec, open.distractSec),
          distractCnt: Math.max(0, num(e.distractCnt, open.distractCnt))
        }, false));
        open = null;
      } else {
        orphan++;
      }
    }

    const fresh = freshOnly(rows);
    appendRows(fresh);
    grandSeg += fresh.length;
    state.files[f] = lines.length;
    state.pending = open;
    saveState(state);

    const skipped = bad + dup + orphan + superseded;
    console.log(`文件 ${f}：新 ${newCount} 行，新增段 ${fresh.length}，跳过 ${skipped}`);
    const detail = [];
    if (bad) detail.push(`坏行 ${bad}`);
    if (dup) detail.push(`重复/无主 stop ${dup}`);
    if (orphan) detail.push(`孤立事件 ${orphan}`);
    if (superseded) detail.push(`被新段切断 ${superseded}`);
    if (incomplete) detail.push('末行未写完，下次再读');
    if (detail.length) console.log(`  其中：${detail.join('，')}`);
  }

  // 收尾：仍有未结段
  if (open) {
    const idleMin = Math.max(0, Math.round((Date.now() - open.endTs) / 60000));
    const stale = Date.now() - open.endTs > PARTIAL_GATE_MS;
    if (stale || closePartial) {
      const rows = freshOnly(finalizeSeg(open, true));
      appendRows(rows);
      grandSeg += rows.length;
      const why = stale ? `已 ${idleMin} 分钟没动静` : '--close-partial';
      console.log(`未结段（${open.cat} ${bjTime(open.startTs)}）按 partial 落盘 1 段：${why}，${rows[0] ? Number(rows[0].minutes).toFixed(1) : '0.0'} 分钟`);
      open = null;
    } else {
      console.log(`未结段（${open.cat} ${bjTime(open.startTs)}）暂缓：距最后事件 ${idleMin} 分钟 < 90 分钟，可能还在跑；要强制收尾加 --close-partial`);
    }
    state.pending = open;
    saveState(state);
  }
  if (!grandSeg) console.log('本次没有新增段。');
}

// ---------- today ----------
function cmdToday() {
  const day = bjDay(Date.now());
  const rows = readLog().filter(r => r && r.date === day && Number.isFinite(Number(r.minutes)));
  if (!rows.length) {
    console.log('今天还没有计时记录');
    return;
  }
  const byCat = new Map();
  let total = 0, dm = 0, dc = 0, partial = 0;
  for (const r of rows) {
    const m = Number(r.minutes) || 0;
    total += m;
    const cat = r.subject || r.plan || '未分类';
    byCat.set(cat, (byCat.get(cat) || 0) + m);
    dm += Number(r.distractMin) || 0;
    dc += Number(r.distractCnt) || 0;
    if (r.partial) partial++;
  }
  console.log(`今天（${day}）合计 ${r1(total).toFixed(1)} 分钟（${rows.length} 段）`);
  for (const [cat, m] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}  ${r1(m).toFixed(1)} 分钟`);
  }
  console.log(`分心 ${r1(dm).toFixed(1)} 分钟 · ${dc} 次`);
  if (partial) console.log(`未完成段 ${partial} 条`);
}

// ---------- show ----------
function cmdShow(n) {
  const rows = readLog()
    .filter(r => r && r.source === 'autox' && r.startAt)
    .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)))
    .slice(0, n);
  if (!rows.length) {
    console.log('还没有计时记录');
    return;
  }
  console.log(`最近 ${rows.length} 段：`);
  for (const r of rows) {
    const end = String(r.endAt || '');
    const sameDay = end.startsWith(String(r.date));
    const endShow = sameDay ? end.slice(11) : end;
    const tag = r.partial ? '  [未完成]' : '';
    console.log(`${r.startAt} → ${endShow}  ${r.subject}  ${r1(r.minutes).toFixed(1)} 分  分心 ${r1(r.distractMin).toFixed(1)} 分/${r.distractCnt || 0} 次${tag}`);
  }
}

// ---------- main ----------
const args = parse(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'ingest') {
  cmdIngest(String(args['close-partial']) === 'true' || String(args.closePartial) === 'true');
} else if (cmd === 'today') {
  cmdToday();
} else if (cmd === 'show') {
  const n = Math.max(1, Math.round(num(args.n ?? args.N, 10)));
  cmdShow(n);
} else {
  console.log(`用法：
  node bin/timer.mjs ingest [--close-partial]   增量整理 timer-*.jsonl → data/study_log.jsonl
  node bin/timer.mjs today                      今天的合计
  node bin/timer.mjs show [-n 10]               最近 N 段`);
  if (cmd) process.exitCode = 2;
}
