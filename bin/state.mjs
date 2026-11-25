#!/usr/bin/env node
// state.mjs —— 学习助手运行态（纯 Node ESM，零依赖）
// 命令：
//   show     档案 + 欠账（读 /root/学习助手/state.json）
//   metrics  现算指标：studyMinutesToday / mistakesTotal / mistakesDueReview；算不出的写 unknown
//   tasks    现读 /root/.dsh/storages/schedule.json，列全部定时任务（标题 / id 全量 / 下次时间 / target）
import fs from 'node:fs';

const ROOT = '/root/学习助手';
const STATE = ROOT + '/state.json';
const STUDY = ROOT + '/data/study_log.jsonl';
const MISTAKES = ROOT + '/kb/mistakes.jsonl';
const SCHEDULE = '/root/.dsh/storages/schedule.json';

// 和 mem.mjs / tutor.mjs 一致：本地时间 = UTC+8，按日期字符串比较
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const readLines = (p) => {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()); }
  catch { return null; }
};
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
};
const showLocal = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'unknown';
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' (+08:00)';
};
const val = (v) => (v === undefined || v === null || v === '' ? 'unknown' : v);

function show() {
  const s = readJson(STATE);
  if (!s) { console.log('读不到 state.json：' + STATE); process.exitCode = 1; return; }
  const st = s.student || {};
  console.log(`学习助手档案 v${val(s.version)} · 更新 ${val(s.updatedAt)}`);
  console.log('学生：' + val(st.name));
  console.log('  年级：' + val(st.grade));
  console.log('  学校：' + val(st.school));
  console.log('  目标大学：' + val(st.targetUniversity));
  console.log('  高考日期：' + val(st.examDate));
  const debts = Array.isArray(s.debts) ? s.debts : [];
  console.log('');
  console.log(`欠账 ${debts.length} 条：`);
  if (!debts.length) { console.log('  （无）'); return; }
  debts.forEach((d, i) => {
    console.log(`${i + 1}. [${val(d.status)}] ${val(d.text)}`);
    console.log(`   来源：${val(d.source)} · 首次：${val(d.firstSeen)}`);
  });
}

function metrics() {
  const day = today();
  console.log('日期：' + day + '（Asia/Shanghai）');

  // studyMinutesToday：data/study_log.jsonl 里 date == 今天 的 minutes 求和（字段名就是 minutes）
  const studyLines = readLines(STUDY);
  let minutes = 'unknown';
  let studyRows = 0;
  if (studyLines !== null) {
    minutes = 0;
    studyRows = studyLines.length;
    for (const line of studyLines) {
      try {
        const row = JSON.parse(line);
        if (row.date === day) minutes += Number(row.minutes) || 0;
      } catch { /* 坏行跳过 */ }
    }
  }
  console.log('studyMinutesToday: ' + minutes);
  if (studyLines === null) console.log('  note: 读不到 data/study_log.jsonl → unknown');

  // 错题：总数 / 今天到期未掌握（题目状态里「掌握」的编码是 mastered，见 tutor.mjs）
  const mistakeLines = readLines(MISTAKES);
  let total = 'unknown';
  let due = 'unknown';
  if (mistakeLines !== null) {
    const items = [];
    for (const line of mistakeLines) {
      try { items.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
    }
    total = items.length;
    due = items.filter((x) => x.status !== 'mastered' && (!x.nextReview || x.nextReview <= day)).length;
  }
  console.log('mistakesTotal: ' + total);
  console.log('mistakesDueReview: ' + due);
  if (mistakeLines === null) console.log('  note: 读不到 kb/mistakes.jsonl → unknown');

  // 这两项没有可现算的数据源，不编：旧 state.json 里的手填值已作废
  console.log('checkinStreak: unknown');
  console.log('proactiveMessagesToday: unknown');

  console.log(`数据源：study_log ${studyLines === null ? 'unknown' : studyRows + ' 条'} · mistakes ${mistakeLines === null ? 'unknown' : mistakeLines.length + ' 条'}`);
}

function fmtTarget(t) {
  if (!t) return 'unknown';
  let out = t.kind || 'unknown';
  if (t.sessionId) out += ' · ' + t.sessionId;
  if (t.create && t.create.cwd) out += ' · cwd=' + t.create.cwd;
  if (t.create && t.create.agentPreset) out += ' · preset=' + t.create.agentPreset;
  return out;
}

function tasks() {
  const store = readJson(SCHEDULE);
  if (!store) {
    console.log('读不到定时任务库：' + SCHEDULE + ' → unknown');
    process.exitCode = 1;
    return;
  }
  // 真实结构：{ unit, global, tables: { tasks: { <id>: { record:{id,kind,title,rrule,scheduledAt}, status, target, ... } } } }
  const table = (store.tables && store.tables.tasks) || store.tasks || null;
  if (!table || typeof table !== 'object') {
    console.log('定时任务库结构不认识（没找到 tables.tasks）→ unknown');
    process.exitCode = 1;
    return;
  }
  const rows = Object.keys(table).map((key) => {
    const entry = table[key] || {};
    const rec = entry.record || {};
    return {
      id: rec.id || key,
      title: rec.title || '（无标题）',
      at: rec.scheduledAt || '',
      status: entry.status || 'unknown',
      target: entry.target || null,
    };
  });
  // active 在前，各自按下次时间排；ended 等历史任务排后面
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return String(a.at).localeCompare(String(b.at));
  });
  for (const row of rows) {
    console.log(`[${row.status}] ${row.title}`);
    console.log('  id: ' + row.id);
    console.log('  下次: ' + (row.at ? showLocal(row.at) : 'unknown'));
    console.log('  target: ' + fmtTarget(row.target));
  }
  const active = rows.filter((r) => r.status === 'active').length;
  console.log(`共 ${rows.length} 条（active ${active} / 其余 ${rows.length - active}）`);
}

const cmd = process.argv[2];
switch (cmd) {
  case 'show':
    show();
    break;
  case 'metrics':
    metrics();
    break;
  case 'tasks':
    tasks();
    break;
  default:
    console.log('用法: node state.mjs <show|metrics|tasks>');
    process.exitCode = 2;
}
