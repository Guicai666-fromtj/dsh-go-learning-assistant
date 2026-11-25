#!/usr/bin/env node
// A 段升级：背默间隔重复（单词/古诗文/化学方程式/生物概念）
// 用法：node recite.mjs <add|bulk|due|review|list|stats> [参数]
import fs from 'node:fs';

const ROOT = '/root/学习助手';
const DB = ROOT + '/kb/recite.jsonl';
const LADDER = [1, 3, 7];

function today(off = 0) {
  return new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
}
function load() {
  if (!fs.existsSync(DB)) return [];
  return fs.readFileSync(DB, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function save(items) {
  fs.writeFileSync(DB, items.map(o => JSON.stringify(o)).join('\n') + '\n');
}
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const k = x.slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    } else out._.push(x);
  }
  return out;
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s，。、；：""''（）()【】\[\].,;:!?]/g, '');
}
function nextId(items) {
  const day = today().replace(/-/g, '');
  const n = items.filter(x => (x.id || '').startsWith('r-' + day)).length + 1;
  return `r-${day}-${String(n).padStart(3, '0')}`;
}
function mk(items, r) {
  return {
    id: nextId(items),
    date: today(),
    subject: r.subject || '未分类',
    tag: r.tag || '',
    front: r.front,
    back: r.back || '',
    note: r.note || '',
    source: r.source || '',
    status: 'new',
    stage: 1,
    nextReview: today(1),
    history: []
  };
}
const a = parse(process.argv.slice(2));
const cmd = a._[0];

function add() {
  if (!a.front) { console.error('用法：add --subject 英语 --front "abandon" --back "v.放弃" --tag 单词'); process.exit(2); }
  const items = load();
  if (items.some(x => norm(x.front) === norm(a.front))) { console.log('已有这条，跳过：' + a.front); return; }
  const it = mk(items, { subject: a.subject, tag: a.tag, front: a.front, back: a.back, note: a.note, source: a.source });
  items.push(it);
  save(items);
  console.log(`已入库 ${it.id} · ${it.subject} ${it.tag} · ${it.front} → 下次 ${it.nextReview}`);
}

function bulk() {
  if (!a.file) { console.error('用法：bulk --file /tmp/recite.json'); process.exit(2); }
  const arr = JSON.parse(fs.readFileSync(a.file, 'utf8'));
  if (!Array.isArray(arr)) { console.error('文件要 JSON 数组'); process.exit(2); }
  const items = load();
  const seen = new Set(items.map(x => norm(x.front)));
  let added = 0, skipped = 0;
  for (const r of arr) {
    if (!r.front || seen.has(norm(r.front))) { skipped++; continue; }
    const it = mk(items, r);
    items.push(it);
    seen.add(norm(it.front));
    added++;
  }
  save(items);
  console.log(`批量入库：新增 ${added} 条，跳过重复 ${skipped} 条`);
}

function due() {
  const t = today();
  const lim = Number(a.n || 5);
  let items = load().filter(x => x.status !== 'mastered' && (!x.nextReview || x.nextReview <= t));
  if (a.subject) items = items.filter(x => x.subject === a.subject);
  items.sort((x, y) => (x.nextReview || '').localeCompare(y.nextReview || ''));
  items = items.slice(0, lim);
  if (a.json) { console.log(JSON.stringify(items, null, 1)); return; }
  if (!items.length) { console.log('NONE'); return; }
  for (const x of items) console.log(`${x.id}\t${x.subject}/${x.tag || '-'}\t第${x.stage ?? 1}轮\t${x.front}`);
}

function review() {
  const id = a.id || a._[1];
  const result = a.result || a._[2];
  if (!id || !['pass', 'fail'].includes(result)) { console.error('用法：review --id r-xxx --result pass|fail'); process.exit(2); }
  const items = load();
  const it = items.find(x => x.id === id);
  if (!it) { console.error('没这条：' + id); process.exit(1); }
  it.history = it.history || [];
  it.history.push({ date: today(), result });
  if (result === 'fail') {
    it.stage = 1; it.status = 'reviewing'; it.nextReview = today(1);
  } else {
    const idx = LADDER.indexOf(it.stage ?? 1);
    if (idx === -1 || idx === LADDER.length - 1) {
      it.status = 'mastered'; it.stage = 'done'; it.nextReview = '';
    } else {
      it.stage = LADDER[idx + 1]; it.status = 'reviewing'; it.nextReview = today(LADDER[idx + 1]);
    }
  }
  save(items);
  console.log(`${id} 记 ${result} → ${it.status}，下次 ${it.nextReview || '不再排'}`);
}

function list() {
  let items = load();
  if (a.subject) items = items.filter(x => x.subject === a.subject);
  if (!items.length) { console.log('背诵库还是空的'); return; }
  for (const x of items) console.log(`${x.id}\t${x.subject}\t${x.tag || '-'}\t${x.status}\t下轮 ${x.nextReview || '-'}\t${x.front}`);
}

function stats() {
  const items = load();
  if (!items.length) { console.log('背诵库还是空的'); return; }
  const by = {};
  for (const x of items) by[x.subject] = (by[x.subject] || 0) + 1;
  const pending = items.filter(x => x.status !== 'mastered').length;
  const todayDue = items.filter(x => x.status !== 'mastered' && (!x.nextReview || x.nextReview <= today())).length;
  console.log(`背诵条 ${items.length} 条，未掌握 ${pending} 条，今天到期 ${todayDue} 条`);
  console.log(Object.entries(by).map(([k, v]) => `${k}:${v}`).join(' '));
}

const table = { add, bulk, due, review, list, stats };
if (!table[cmd]) { console.error('命令：add|bulk|due|review|list|stats'); process.exit(2); }
table[cmd]();
