#!/usr/bin/env node
// 天津真题库 D 段：登记卷子 / 给题目挂知识点 / 按知识点检索
// 用法：node exams.mjs <add|find|stats|list> [参数]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = '/root/学习助手';
const DIR = path.join(ROOT, 'kb', 'exams');
const INDEX = path.join(DIR, 'index.jsonl');

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
function load() {
  if (!fs.existsSync(INDEX)) return [];
  return fs.readFileSync(INDEX, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function save(items) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(INDEX, items.map(o => JSON.stringify(o)).join('\n') + '\n');
}
const a = parse(process.argv.slice(2));
const cmd = a._[0];

function add() {
  if (!a.subject || !a.file) { console.error('用法：add --subject 数学 --year 2024 --region 和平区 --kind 期末 --file /root/手机存储/Download/xxx.pdf --topics "椭圆,导数"'); process.exit(2); }
  if (!fs.existsSync(a.file)) { console.error('文件不存在：' + a.file); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  const base = path.basename(a.file);
  const dest = path.join(DIR, base);
  if (path.resolve(a.file) !== path.resolve(dest)) fs.copyFileSync(a.file, dest);
  const items = load();
  const it = {
    id: `e-${(a.year || '')}-${(a.region || '')}-${(a.kind || '')}-${base}`.replace(/\s+/g, '_'),
    subject: a.subject,
    year: a.year || '',
    region: a.region || '',
    kind: a.kind || '',
    file: dest,
    topics: (a.topics || '').split(',').map(s => s.trim()).filter(Boolean),
    note: a.note || '',
    addedAt: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
  };
  const old = items.findIndex(x => x.id === it.id);
  if (old >= 0) items[old] = it; else items.push(it);
  save(items);
  console.log(`已登记 ${it.subject} ${it.year} ${it.region} ${it.kind}：${base}（知识点 ${it.topics.join('/') || '无'}）`);
}

function match(x) {
  if (a.subject && x.subject !== a.subject) return false;
  if (a.year && x.year !== a.year) return false;
  if (a.kind && x.kind !== a.kind) return false;
  if (a.topic && !x.topics.some(t => t.includes(a.topic))) return false;
  return true;
}

function find() {
  let items = load().filter(match);
  if (a.limit) items = items.slice(0, Number(a.limit));
  if (!items.length) { console.log('没找到符合条件的卷子'); return; }
  for (const x of items) {
    console.log(`${x.subject} ${x.year} ${x.region} ${x.kind}｜${x.topics.join('/') || '无知识点'}｜${x.file}`);
  }
}

function stats() {
  const items = load();
  if (!items.length) { console.log('真题库还是空的'); return; }
  const bySub = {};
  const topics = {};
  for (const x of items) {
    bySub[x.subject] = (bySub[x.subject] || 0) + 1;
    for (const t of x.topics) topics[t] = (topics[t] || 0) + 1;
  }
  console.log(`卷子 ${items.length} 份：${Object.entries(bySub).map(([k, v]) => k + ':' + v).join(' ')}`);
  const top = Object.entries(topics).sort((p, q) => q[1] - p[1]).slice(0, 8);
  if (top.length) console.log('知识点覆盖：' + top.map(([k, v]) => `${k}×${v}`).join(' '));
}

function list() {
  const items = load();
  if (!items.length) { console.log('真题库还是空的'); return; }
  for (const x of items) console.log(`${x.id}\t${x.subject}\t${x.year}\t${x.region}\t${x.kind}\t${x.file}`);
}

const table = { add, find, stats, list };
if (!table[cmd]) { console.error('命令：add|find|stats|list'); process.exit(2); }
table[cmd]();
