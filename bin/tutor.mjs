#!/usr/bin/env node
// 错题闭环 A 段：录题 / 到期 / 复习推进 / 弱点统计 / 出小测
// 用法：node tutor.mjs <add|due|review|list|weak|quiz|stats> [参数]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = process.env.TUTOR_ROOT || '/root/学习助手';
const KB = path.join(ROOT, 'kb', 'mistakes.jsonl');
const WP = path.join(ROOT, 'kb', 'weakpoints.md');
const QUIZ = path.join(ROOT, 'data', 'quiz.json');
const LADDER = [1, 3, 7]; // 复习间隔天数
// 第 1 轮＝复盘（讲一遍怎么写，不重做）；第 3 轮＝重做原题；第 7 轮＝重做＋变式，对且自评掌握才结案
const MODE = { 1: '复盘', 3: '重做', 7: '变式' };

function today(off = 0) {
  const d = new Date(Date.now() + 8 * 3600e3 + off * 86400e3);
  return d.toISOString().slice(0, 10);
}
function load() {
  if (!fs.existsSync(KB)) return [];
  return fs.readFileSync(KB, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function save(items) {
  fs.writeFileSync(KB, items.map(o => JSON.stringify(o)).join('\n') + '\n');
}
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}
const a = parse(process.argv.slice(2));
const cmd = a._[0];

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s，。、；：""''（）()【】\[\].,;:!?]/g, '');
}
function nextId(items) {
  const day = today().replace(/-/g, '');
  const n = items.filter(x => (x.id || '').startsWith('m-' + day)).length + 1;
  return `m-${day}-${String(n).padStart(2, '0')}`;
}

function selfCheck() {
  const bad = validateData().filter(p => p.blocking);
  if (bad.length) console.log(`⚠️ 自检 ${bad.length} 条阻断，跑 \`node bin/tutor.mjs validate\` 看明细`);
}

function cmdAdd() {
  if (!a.subject || !a.question) {
    console.error('缺 --subject 或 --question');
    process.exit(2);
  }
  const items = load();
  const it = {
    id: a.id || nextId(items),
    date: a.date || today(),
    subject: a.subject,
    topic: a.topic || '未分类',
    question: a.question,
    myAnswer: a.my || '',
    rightAnswer: a.right || '',
    reason: a.reason || '',
    errorType: a.type || '未归因',
    source: a.source || '',
    wrongStep: a.step || '',
    redo: a.redo || '',
    simulated: !!a.sim,
    status: 'new',
    stage: 1,
    mode: MODE[1],
    nextReview: today(1),
    history: []
  };
  items.push(it);
  save(items);
  console.log(`已入库 ${it.id} · ${it.subject}/${it.topic} · 下次复习 ${it.nextReview}`);
  weak();
  selfCheck();
}

function cmdDue() {
  const t = today();
  const lim = Number(a.limit || 6); // 每天最多 6 道，其余排队轮转
  let items = load().filter(x => !x.simulated && x.status !== 'mastered' && (!x.nextReview || x.nextReview <= t));
  if (a.subject) items = items.filter(x => x.subject === a.subject);
  items.sort((x, y) => (x.nextReview || '').localeCompare(y.nextReview || ''));
  items = items.slice(0, lim);
  if (a.json) {
    console.log(JSON.stringify(items, null, 1));
    return;
  }
  if (!items.length) { console.log('今天没有到期的错题'); return; }
  console.log(`到期 ${items.length} 道（每天最多 6 道）：`);
  for (const x of items) console.log(`- ${x.id} · ${x.subject}/${x.topic} · 第${x.stage ?? 1}轮（${x.mode || MODE[x.stage] || '复盘'}）· ${x.question.slice(0, 40)}`);
}

function cmdReview() {
  const id = a.id || a._[1];
  const result = a.result || a._[2];
  const mastered = String(a.mastered || a.self || '') === 'true';
  if (!id || !['pass', 'fail'].includes(result)) {
    console.error('用法：review --id m-xxx --result pass|fail [--mastered true]');
    process.exit(2);
  }
  const items = load();
  const it = items.find(x => x.id === id);
  if (!it) { console.error('没这道题：' + id); process.exit(1); }
  it.history = it.history || [];
  it.history.push({ date: today(), result, note: a.note || '', mastered: mastered || undefined });
  const cur = Number(it.stage) || 1;
  if (result === 'fail') {
    it.stage = 1;
    it.mode = MODE[1];
    it.status = 'reviewing';
    it.nextReview = today(1);
  } else if (cur === 7) {
    if (mastered) {
      it.status = 'mastered';
      it.stage = 'done';
      it.mode = '';
      it.nextReview = '';
      it.masteredAt = today();
    } else {
      it.stage = 7;
      it.mode = MODE[7];
      it.status = 'reviewing';
      it.nextReview = today(7);
    }
  } else {
    const idx = LADDER.indexOf(cur);
    const next = LADDER[Math.min(idx + 1, LADDER.length - 1)];
    it.stage = next;
    it.mode = MODE[next];
    it.status = 'reviewing';
    it.nextReview = today(next);
  }
  save(items);
  console.log(`${id} 已记 ${result}${mastered ? '（自评已掌握）' : ''} → 状态 ${it.status}，下轮 ${it.nextReview || '不再排'}${it.mode ? '，形式：' + it.mode : ''}`);
  weak();
}

function cmdBulk() {
  if (!a.file) { console.error('用法：bulk --file /tmp/mistakes.json（JSON 数组，字段同 add）'); process.exit(2); }
  const arr = JSON.parse(fs.readFileSync(a.file, 'utf8'));
  if (!Array.isArray(arr)) { console.error('文件要 JSON 数组'); process.exit(2); }
  const items = load();
  const seen = new Set(items.map(x => norm(x.question)));
  let added = 0, skipped = 0;
  for (const r of arr) {
    if (!r.question || !r.subject) { skipped++; continue; }
    if (seen.has(norm(r.question))) { skipped++; continue; }
    const it = {
      id: nextId(items),
      date: r.date || today(),
      subject: r.subject,
      topic: r.topic || '未分类',
      question: r.question,
      myAnswer: r.my || r.myAnswer || '',
      rightAnswer: r.right || r.rightAnswer || '',
      reason: r.reason || '',
      errorType: r.type || r.errorType || '未归因',
      source: r.source || a.source || '',
      wrongStep: r.step || r.wrongStep || '',
      redo: r.redo || '',
      simulated: !!r.simulated,
      status: 'new',
      stage: 1,
      nextReview: today(1),
      history: []
    };
    items.push(it);
    seen.add(norm(it.question));
    added++;
  }
  save(items);
  console.log(`批量入库：新增 ${added} 道，跳过重复/缺字段 ${skipped} 道`);
  weak();
  selfCheck();
}

function cmdList() {
  let items = load();
  if (a.subject) items = items.filter(x => x.subject === a.subject);
  if (a.status) items = items.filter(x => x.status === a.status);
  if (!items.length) { console.log('没有错题记录'); return; }
  console.log(`共 ${items.length} 道：`);
  for (const x of items) {
    console.log(`${x.id}\t${x.date}\t${x.subject}/${x.topic}\t${x.status}\t下轮 ${x.nextReview || '-'}\t${(x.question || '').slice(0, 30)}`);
  }
}

function topicsFile() { return path.join(ROOT, 'kb', 'topics.json'); }
function loadTopics() { try { return JSON.parse(fs.readFileSync(topicsFile(), 'utf8')); } catch { return {}; } }
function saveTopics(m) { fs.writeFileSync(topicsFile(), JSON.stringify(m, null, 1)); }


// ── 前置依赖（kb/prereq.json：{"K02":["K01"]}，表示 K02 要先会 K01）──
function prereqFile() { return path.join(ROOT, 'kb', 'prereq.json'); }
function loadPrereq() { try { return JSON.parse(fs.readFileSync(prereqFile(), 'utf8')); } catch { return {}; } }
function savePrereq(m) { fs.writeFileSync(prereqFile(), JSON.stringify(m, null, 1) + '\n'); }
function topicByK(tm) { const m = new Map(); for (const [k, v] of Object.entries(tm)) m.set(v, k); return m; }

function cmdPrereq() {
  const tm = loadTopics();
  const byK = topicByK(tm);
  const pq = loadPrereq();
  if (!a.topic) { // 不带参数：列出现有前置关系
    const keys = Object.keys(pq).sort();
    if (!keys.length) console.log('还没有前置关系。用法：tutor.mjs prereq --topic K02 --needs K01,K05');
    for (const k of keys) console.log(`${k} ${byK.get(k) || '?'} ← 先会 ${pq[k].join('、')} ${pq[k].map(x => byK.get(x) || '?').join(' / ')}`);
    return;
  }
  let k = a.topic;
  if (!byK.has(k)) { // 也认「科目·知识点」或知识点名
    const hit = Object.entries(tm).find(([kk]) => kk === a.topic || kk.endsWith('·' + a.topic));
    if (!hit) { console.error('找不到知识点：' + a.topic); process.exit(2); }
    k = hit[1];
  }
  if (a.clear) { delete pq[k]; savePrereq(pq); console.log(`已清空 ${k} 的前置`); return; }
  const needs = String(a.needs || a.add || '').split(/[,，\s]+/).filter(Boolean);
  if (!needs.length) { console.log(`${k} ${byK.get(k)} 的前置：${(pq[k] || []).join('、') || '（无）'}`); return; }
  for (const n of needs) {
    const id = byK.has(n) ? n : (Object.entries(tm).find(([kk]) => kk === n || kk.endsWith('·' + n)) || [])[1];
    if (!id) { console.error('找不到前置知识点：' + n); process.exit(2); }
    if (id === k) { console.error('不能把自己当前置'); process.exit(2); }
    if (a.add) pq[k] = [...new Set([...(pq[k] || []), id])];
    else pq[k] = a.needs ? needs.map(x => byK.has(x) ? x : (Object.entries(tm).find(([kk]) => kk === x || kk.endsWith('·' + x)) || [])[1]) : [id];
  }
  savePrereq(pq);
  console.log(`${k} ${byK.get(k)} 前置已设：${pq[k].join('、')}`);
}

// ── 数据校验器：坏数据当场报，阻断=必须改 ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_SET = new Set(['new', 'reviewing', 'mastered', 'unverified']); // unverified=当年手录、答案待核实，按未掌握算
function validateData() {
  const problems = [];
  const add = (file, line, message, blocking = true) => problems.push({ file, line, message, blocking });
  const tm = loadTopics();
  const byK = topicByK(tm);
  const lines = fs.existsSync(KB) ? fs.readFileSync(KB, 'utf8').split('\n').filter(Boolean) : [];
  const ids = new Set();
  const seenK = new Map();
  lines.forEach((raw, i) => {
    const ln = i + 1;
    let x;
    try { x = JSON.parse(raw); } catch (e) { add('kb/mistakes.jsonl', ln, 'JSON 解析失败：' + e.message); return; }
    for (const f of ['id', 'date', 'subject', 'topic', 'question'])
      if (!x[f] || typeof x[f] !== 'string') add('kb/mistakes.jsonl', ln, `缺字段 ${f}`);
    if (x.id) { if (ids.has(x.id)) add('kb/mistakes.jsonl', ln, `id 重复：${x.id}`); ids.add(x.id); }
    if (x.date && !DATE_RE.test(x.date)) add('kb/mistakes.jsonl', ln, `date 格式不对：${x.date}`);
    if (x.nextReview && !DATE_RE.test(x.nextReview)) add('kb/mistakes.jsonl', ln, `nextReview 格式不对：${x.nextReview}`);
    if (x.status && !STATUS_SET.has(x.status)) add('kb/mistakes.jsonl', ln, `status 不认识：${x.status}`);
    if (x.simulated !== undefined && typeof x.simulated !== 'boolean') add('kb/mistakes.jsonl', ln, 'simulated 只能是 true/false');
    if (x.stage !== undefined && ![1, 3, 7].includes(x.stage)) add('kb/mistakes.jsonl', ln, `stage 只能是 1/3/7：${x.stage}`);
    if (x.history !== undefined) {
      if (!Array.isArray(x.history)) add('kb/mistakes.jsonl', ln, 'history 必须是数组');
      else x.history.forEach((h, j) => {
        if (!DATE_RE.test(h.date || '')) add('kb/mistakes.jsonl', ln, `history[${j}].date 不对`);
        if (!['pass', 'fail'].includes(h.result)) add('kb/mistakes.jsonl', ln, `history[${j}].result 只能是 pass/fail`);
      });
    }
    const key = x.subject && x.topic ? `${x.subject}·${x.topic}` : '';
    if (key && !tm[key] && !byK.has(x.topic)) add('kb/mistakes.jsonl', ln, `知识点没编号：${key}（跑 tutor.mjs weak 会自动补）`);
  });
  for (const [k, v] of Object.entries(tm)) {
    if (!/^K\d{2,}$/.test(String(v))) add('kb/topics.json', 0, `编号不规范：${k} → ${v}`);
    if (!k.includes('·')) add('kb/topics.json', 0, `键应为「科目·知识点」：${k}`);
    if (seenK.has(v)) add('kb/topics.json', 0, `编号重复：${v} 同时用于「${seenK.get(v)}」和「${k}」`);
    seenK.set(v, k);
  }
  const pq = loadPrereq();
  for (const [k, list] of Object.entries(pq)) {
    if (!byK.has(k)) { add('kb/prereq.json', 0, `前置表里的 ${k} 不存在`); continue; }
    if (!Array.isArray(list)) { add('kb/prereq.json', 0, `${k} 的前置必须是数组`); continue; }
    for (const pdep of list) {
      if (!byK.has(pdep)) add('kb/prereq.json', 0, `${k} 的前置 ${pdep} 不存在`);
      else if (pdep === k) add('kb/prereq.json', 0, `${k} 不能把自己当前置`);
    }
  }
  // 有环：k → 前置 p
  const color = new Map();
  let cycle = null;
  const dfs = (k, trail) => {
    if (cycle) return;
    color.set(k, 1);
    for (const pdep of pq[k] || []) {
      if (!byK.has(pdep)) continue;
      if (color.get(pdep) === 1) { cycle = [...trail, k, pdep]; return; }
      if (!color.get(pdep)) dfs(pdep, [...trail, k]);
    }
    color.set(k, 2);
  };
  for (const k of Object.keys(pq)) if (!color.get(k)) dfs(k, []);
  if (cycle) add('kb/prereq.json', 0, `前置关系成环：${cycle.join(' → ')}`);
  return problems;
}

function cmdValidate() {
  const problems = validateData();
  const blocking = problems.filter(p => p.blocking);
  const info = problems.filter(p => !p.blocking);
  const n = fs.existsSync(KB) ? fs.readFileSync(KB, 'utf8').split('\n').filter(Boolean).length : 0;
  const t = Object.keys(loadTopics()).length;
  const pq = Object.keys(loadPrereq()).length;
  console.log(`自检：错题 ${n} 条 / 知识点 ${t} 个 / 前置 ${pq} 条`);
  for (const p of problems) console.log(`- [${p.blocking ? '阻断' : '提示'}] ${p.file}${p.line ? ':' + p.line : ''} ${p.message}`);
  console.log(blocking.length ? `阻断 ${blocking.length} 条，提示 ${info.length} 条 → 打回` : `阻断 0 条，提示 ${info.length} 条 → 放行`);
  if (blocking.length) process.exitCode = 1;
}

function weak() {
  const items = load().filter(x => !x.simulated);
  const map = new Map();
  for (const x of items) {
    const k = `${x.subject}·${x.topic}`;
    const o = map.get(k) || { total: 0, open: 0, mastered: 0, sources: new Set(), next: '' };
    o.total++;
    if (x.status === 'mastered') o.mastered++;
    else { o.open++; if (x.nextReview && (!o.next || x.nextReview < o.next)) o.next = x.nextReview; }
    if (x.source) o.sources.add(x.source);
    map.set(k, o);
  }
  const tm = loadTopics();
  let seq = Object.values(tm).reduce((m, v) => Math.max(m, Number(String(v).replace(/\D/g, '')) || 0), 0);
  for (const k of map.keys()) if (!tm[k]) tm[k] = 'K' + String(++seq).padStart(2, '0');
  saveTopics(tm);
  const rows = [...map.entries()].sort((p, q) => (q[1].open - p[1].open) || p[0].localeCompare(q[0]));
  const deg = o => o.open === 0 ? '✅ 已掌握' : (o.total - o.open >= 2 ? '⚠️ 巩固中' : '❌ 未掌握');
  const openByK = new Map();
  for (const x of items) { const kk = tm[`${x.subject}·${x.topic}`]; if (!kk) continue; if (x.status !== 'mastered') openByK.set(kk, (openByK.get(kk) || 0) + 1); }
  const pqw = loadPrereq(); const byKw = topicByK(tm);
  const gate = k => (pqw[k] || []).filter(q => byKw.has(q) && (openByK.get(q) || 0) === 0).map(q => `${q} ${byKw.get(q)}`).join('、');
  const strong = rows.filter(([, o]) => o.open >= 2);
  const watch = rows.filter(([, o]) => o.open === 1).slice(0, 8);
  const lines = [
    '# 知识点表',
    '',
    '> 自动统计，别手改；编号稳定存 kb/topics.json；模拟题不计入。',
    '',
    `## 知识点（${rows.length}）`,
    '',
    '| 编号 | 科目·知识点 | 错题 | 来源 | 掌握度 | 下次复习 |',
    '|---|---|---|---|---|---|',
    ...rows.map(([k, o]) => `| ${tm[k]} | ${k} | ${o.total} | ${[...o.sources].join('、') || '-'} | ${deg(o)} | ${o.open ? (o.next || '未排') : '-'} |`),
    '',
    `## 薄弱点（未掌握 ≥2 道，${strong.length}）`,
    '',
    ...(strong.length ? strong.map(([k]) => `- ${tm[k]} ${k} × ${map.get(k).open} 道——重点补${gate(tm[k]) ? `（前置没掌握：${gate(tm[k])}）` : ''}`) : ['（还没有累计到 2 道的知识点）']),
    '',
    '## 待观察（1 道）',
    '',
    ...(watch.length ? watch.map(([k]) => `- ${tm[k]} ${k}`) : ['（空）']),
    '',
    `## 前置关系（${Object.keys(pqw).length}）`,
    '',
    ...(Object.keys(pqw).length
      ? Object.keys(pqw).sort().map(k => `- ${k} ${byKw.get(k) || ''} ← 先会 ${(pqw[k] || []).map(q => `${q} ${byKw.get(q) || '?'}`).join('、')}${gate(k) ? ' ⚠️ 前置未掌握' : ''}`)
      : ['（没设。用法：node bin/tutor.mjs prereq --topic K02 --needs K01）']),
    '',
    '## 下一步练习方向',
    '',
    ...(strong.length
      ? strong.slice(0, 5).map(([k], i) => `${i + 1}. ${tm[k]} ${k}：${gate(tm[k]) ? `先补前置 ${gate(tm[k])}，再` : ''}出 3 道同类题，做完讲错因`)
      : ['1. 先把错题攒起来，够 2 道同类的再定方向']),
    ''
  ];
  fs.writeFileSync(WP, lines.join('\n'));
}

function cmdWeak() {
  weak();
  const txt = fs.readFileSync(WP, 'utf8');
  const m = txt.match(/## 薄弱点[\s\S]*?(?=\n## )/);
  console.log(m ? m[0].trim() : txt.slice(0, 400));
}

function cmdQuiz() {
  const t = today();
  let all = load().filter(x => !x.simulated && x.status !== 'mastered');
  if (a.subject) all = all.filter(x => x.subject === a.subject);
  const due = all.filter(x => !x.nextReview || x.nextReview <= t)
    .sort((x, y) => (x.nextReview || '').localeCompare(y.nextReview || ''));
  const rest = all.filter(x => !due.includes(x))
    .sort((x, y) => (x.nextReview || '9999').localeCompare(y.nextReview || '9999'));
  let items = [...due, ...rest].slice(0, Number(a.n || 3));
  const pack = {
    date: today(),
    createdAt: new Date().toISOString(),
    sent: false,
    items: items.map(x => ({ id: x.id, subject: x.subject, topic: x.topic, question: x.question, reason: x.reason, stage: x.stage ?? 1 }))
  };
  fs.writeFileSync(QUIZ, JSON.stringify(pack, null, 1));
  if (!items.length) { console.log('NONE'); return; }
  console.log(JSON.stringify(pack.items, null, 1));
}

function cmdStats() {
  const items = load();
  const by = {};
  for (const x of items) by[x.subject] = (by[x.subject] || 0) + 1;
  const pending = items.filter(x => !x.simulated && x.status !== 'mastered').length;
  const simN = items.filter(x => x.simulated).length;
  console.log(`错题 ${items.length} 道，未掌握 ${pending} 道，今天到期 ${items.filter(x => !x.simulated && x.status !== 'mastered' && (!x.nextReview || x.nextReview <= today())).length} 道，模拟题 ${simN} 道（不计入）`);
  console.log(Object.entries(by).map(([k, v]) => `${k}:${v}`).join(' '));
}

const table = { add: cmdAdd, bulk: cmdBulk, due: cmdDue, review: cmdReview, list: cmdList, weak: cmdWeak, quiz: cmdQuiz, stats: cmdStats, validate: cmdValidate, prereq: cmdPrereq };
if (!table[cmd]) { console.error('命令：add|bulk|due|review|list|weak|quiz|stats|validate|prereq'); process.exit(2); }
table[cmd]();
