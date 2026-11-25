#!/usr/bin/env node
// 考前复习包 C 段：排考试 / 查是否快到 / 生成一页 A4
// 用法：node paper.mjs <plan|due|build|list> [参数]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = '/root/学习助手';
const EXAMS = path.join(ROOT, 'data', 'exams.json');
const MISTAKES = path.join(ROOT, 'kb', 'mistakes.jsonl');
const FORMULAS = path.join(ROOT, 'kb', 'formulas');
const WP = path.join(ROOT, 'kb', 'weakpoints.md');
const STREAM = path.join(ROOT, 'mem', 'stream.jsonl');
const OUT = path.join(ROOT, 'reports');

function today(off = 0) {
  return new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
}
function daysBetween(d1, d2) {
  return Math.round((new Date(d2 + 'T00:00:00Z') - new Date(d1 + 'T00:00:00Z')) / 86400e3);
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
function loadExams() {
  if (!fs.existsSync(EXAMS)) return { exams: [] };
  return JSON.parse(fs.readFileSync(EXAMS, 'utf8'));
}
function saveExams(o) { fs.writeFileSync(EXAMS, JSON.stringify(o, null, 1)); }
function loadMistakes() {
  if (!fs.existsSync(MISTAKES)) return [];
  return fs.readFileSync(MISTAKES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const a = parse(process.argv.slice(2));
const cmd = a._[0];

function plan() {
  if (!a.date || !a.name) { console.error('用法：plan --date 2026-11-11 --name 期中 --subjects 数学,物理'); process.exit(2); }
  const o = loadExams();
  o.exams = (o.exams || []).filter(e => !(e.date === a.date && e.name === a.name));
  o.exams.push({ date: a.date, name: a.name, subjects: (a.subjects || '').split(',').filter(Boolean) });
  o.exams.sort((x, y) => x.date.localeCompare(y.date));
  saveExams(o);
  console.log(`已排考试：${a.date} ${a.name} 距今天 ${daysBetween(today(), a.date)} 天`);
}

function list() {
  const o = loadExams();
  if (!(o.exams || []).length) { console.log('还没排考试'); return; }
  for (const e of o.exams) {
    const d = daysBetween(today(), e.date);
    console.log(`${e.date} ${e.name} ${d >= 0 ? '还有 ' + d + ' 天' : '已过 ' + -d + ' 天'} ${(e.subjects || []).join('/')}`);
  }
}

function due() {
  const days = Number(a.days || 3);
  const o = loadExams();
  const hit = (o.exams || []).filter(e => {
    const d = daysBetween(today(), e.date);
    return d >= 0 && d <= days;
  });
  if (!hit.length) { console.log('NONE'); return; }
  for (const e of hit) console.log(`${e.name}（${e.date}）还有 ${daysBetween(today(), e.date)} 天——该出复习包了`);
}

function build() {
  const o = loadExams();
  const days = Number(a.days || 3);
  let exam = (o.exams || []).find(e => e.name === a.name);
  if (!exam) {
    exam = (o.exams || []).filter(e => { const d = daysBetween(today(), e.date); return d >= 0 && d <= days; })[0];
  }
  if (!exam) { console.log('NONE'); return; }
  const left = daysBetween(today(), exam.date);

  const ms = loadMistakes().filter(x => x.status !== 'mastered');
  const near = left <= 3;
  const dueNow = (near ? ms : ms.filter(x => !x.nextReview || x.nextReview <= today()))
    .sort((x, y) => (x.nextReview || '9999').localeCompare(y.nextReview || '9999'))
    .slice(0, near ? 12 : 8);
  const byTopic = new Map();
  for (const x of ms) {
    const k = `${x.subject}·${x.topic}`;
    byTopic.set(k, (byTopic.get(k) || 0) + 1);
  }
  const weak = [...byTopic.entries()].sort((p, q) => q[1] - p[1]).slice(0, 8);

  let formulas = '';
  if (fs.existsSync(FORMULAS)) {
    for (const f of fs.readdirSync(FORMULAS).filter(f => f.endsWith('.md')).sort()) {
      const sub = f.replace(/\.md$/, '');
      const body = fs.readFileSync(path.join(FORMULAS, f), 'utf8').trim();
      formulas += `### ${sub}\n\n${body}\n\n`;
    }
  }

  let stream = '';
  if (fs.existsSync(STREAM)) {
    const lines = fs.readFileSync(STREAM, 'utf8').split('\n').filter(Boolean).slice(-8);
    stream = lines.map(l => { try { const o = JSON.parse(l); return `- ${o.t.slice(5, 16).replace('T', ' ')} [${o.kind}] ${o.text}`; } catch { return ''; } }).filter(Boolean).join('\n');
  }

  const md = [
    `# 考前复习包 · ${exam.name}（${exam.date}，还剩 ${left} 天）`,
    '',
    `> 生成时间 ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} · 科目 ${(exam.subjects || []).join('/') || '未指定'}`,
    '',
    '## 一、必须过一遍的错题',
    '',
    ...(dueNow.length ? dueNow.map(x => `- [ ] ${x.subject}/${x.topic}：${(x.question || '').slice(0, 60)}（错因：${x.reason || '未归因'}）`) : ['- 没有到期错题，那就把已掌握的公式过一遍']),
    '',
    '## 二、薄弱点排行',
    '',
    ...(weak.length ? weak.map(([k, n], i) => `${i + 1}. ${k} × ${n} 道`) : ['- 数据不足，先攒错题']),
    '',
    '## 三、公式速查',
    '',
    formulas.trim() || '（kb/formulas/ 下还没放公式卡）',
    '',
    '## 四、最近状态',
    '',
    stream || '（没有近期记录）',
    '',
    '## 五、这三天怎么用',
    '',
    '1. 每天先做「必须过一遍的错题」里没打勾的，做完打勾。',
    '2. 薄弱点前两名，各出 3 道同类题练手，别刷整套。',
    '3. 考前最后一晚只看公式速查，不再做新题。',
    ''
  ].join('\n');

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `考前复习包-${exam.name}-${exam.date}.md`);
  fs.writeFileSync(file, md);
  console.log(file);
}

const table = { plan, list, due, build };
if (!table[cmd]) { console.error('命令：plan|list|due|build'); process.exit(2); }
table[cmd]();
