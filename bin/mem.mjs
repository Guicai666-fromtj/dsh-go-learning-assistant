#!/usr/bin/env node
// 记忆 2.0：流水 / 日报 / 回忆
// 命令：add | tail | recall | merge [--date D | --all] | daily | check
import fs from 'node:fs';

const R = '/root/学习助手/';
const STREAM = R + 'mem/stream.jsonl';
const DAILY = R + 'mem/daily/';
const INDEX = R + 'mem/daily/index.md'; // 日报索引；看板是 mem/index.md（memcore 管），两者别混
const MEMORY = R + 'memory.md';
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
const nowLocal = () => { const d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 19) + '+08:00'; };
const today = () => nowLocal().slice(0, 10);
const readLines = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()); } catch { return []; } };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayOf = (s) => { const m = String(s || '').match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; };
const streamRows = () => readLines(STREAM).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const streamDates = () => { const s = new Set(); for (const o of streamRows()) { const d = dayOf(o.t); if (isDay(d)) s.add(d); } return [...s].sort(); };
const dailyDays = () => { try { return fs.readdirSync(DAILY).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map(f => f.slice(0, 10)).sort(); } catch { return []; } };
const lastDays = (n) => { const cur = new Date(today() + 'T00:00:00Z'); const out = []; for (let i = 0; i < n; i++) { out.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() - 1); } return out; };

function mergeDay(day) {
  fs.mkdirSync(DAILY, { recursive: true });
  const rows = readLines(STREAM).filter(l => l.slice(1, 11) === day || l.includes('"' + day)).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const seen = new Set(); const uniq = [];
  for (const r of rows) { const k = r.kind + '|' + r.text; if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
  let study = { minutes: 0, checks: 0, ent: 0 }, health = null, mistakes = 0, scores = [];
  for (const l of readLines(R + 'data/study_log.jsonl')) { try { const o = JSON.parse(l); if (o.date === day) { study.minutes += o.minutes || 0; study.checks += o.checks || 0; study.ent += o.entertainment || 0; } } catch {} }
  const hRows = [];
  for (const l of readLines(R + 'data/health.jsonl')) { try { const o = JSON.parse(l); if (o.date === day) hRows.push(o); } catch {} }
  if (hRows.length) { const withSleep = hRows.filter(o => o.sleepH != null); health = withSleep.length ? withSleep[withSleep.length - 1] : hRows[hRows.length - 1]; }
  for (const l of readLines(R + 'kb/mistakes.jsonl')) { try { const o = JSON.parse(l); if ((o.date || '').slice(0, 10) === day) mistakes++; } catch {} }
  for (const l of readLines(R + 'data/scores.jsonl')) { try { const o = JSON.parse(l); if (o.date === day) scores.push(`${o.subject} ${o.score}/${o.full ?? '?'}`); } catch {} }
  // 作息：有 sleepH 就写小时；没有就写未知（11-10 只有饮食条，别写成 undefinedh）
  const sleepTxt = health && health.sleepH != null
    ? `${health.sleepH}h${health.note ? '，' + health.note : ''}`
    : (health && (health.note || health.notes) ? `未知（${health.note || health.notes}）` : '未知');
  const hasSleep = uniq.some(r => r.kind === 'sleep');
  const md = [];
  md.push(`# ${day} 日报`, '');
  md.push(`- 学习：${study.minutes} 分钟 · 抽查 ${study.checks} 次 · 娱乐 ${study.ent} 次`);
  md.push(`- 作息：${sleepTxt}`);
  if (!hasSleep) md.push('- ⚠️ 睡眠：当天没报备（流水里无 sleep 记录）');
  md.push(`- 错题新增：${mistakes} 道` + (scores.length ? ` · 成绩：${scores.join('、')}` : ''));
  md.push('', '## 流水', '');
  for (const r of uniq) md.push(`- ${r.t.slice(11, 16)} [${r.src}/${r.kind}] ${r.text}`);
  const out = DAILY + day + '.md';
  fs.writeFileSync(out, md.join('\n') + '\n');
  const idxLine = `- ${day} · 学习 ${study.minutes} 分 · 抽查 ${study.checks} 次 · 娱乐 ${study.ent} 次 · 错题 ${mistakes} · 睡 ${health && health.sleepH != null ? health.sleepH : '?'}h`;
  const idxRest = readLines(INDEX).filter(l => !l.startsWith(`- ${day} · `));
  idxRest.push(idxLine);
  fs.writeFileSync(INDEX, idxRest.sort().reverse().join('\n') + '\n');
  console.log(`已生成 ${out}（${uniq.length} 条流水）`);
  if (!hasSleep) console.log(`⚠️ ${day} 没有睡眠流水（上床/起床都没报）`);
  return { out, n: uniq.length };
}

switch (cmd) {
  case 'add': {
    const row = { t: nowLocal(), src: opt('src', 'app'), kind: opt('kind', 'note'), text: opt('text', '') };
    if (!row.text) { console.log('缺 --text'); break; }
    if (!args.includes('--force')) {
      const len = [...row.text].length;
      const sentences = row.text.split(/[。！？!?；;\n]+/).map((x) => x.trim()).filter(Boolean).length;
      if (len > 200 || sentences > 3) {
        console.log(`拒绝写入：${len} 字 / ${sentences} 句（上限 200 字、3 句，一条只写一件事）`);
        console.log('长内容请拆条或摘一句；确需整段加 --force');
        process.exitCode = 1; break;
      }
    }
    fs.mkdirSync(R + 'mem', { recursive: true });
    fs.appendFileSync(STREAM, JSON.stringify(row) + '\n');
    console.log('已记：' + row.text.slice(0, 40));
    break;
  }
  case 'tail': {
    const n = +(args[1] || 10);
    const lines = readLines(STREAM).slice(-n);
    for (const l of lines) {
      try { const o = JSON.parse(l); console.log(`${o.t.slice(5, 16)} [${o.src}/${o.kind}] ${o.text}`); }
      catch { console.log(l); }
    }
    break;
  }
  case 'recall': {
    const kw = args[1];
    if (!kw) { console.log('用法: recall 关键词 [--days 30]'); break; }
    const days = +(opt('days', 30));
    const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const re = new RegExp(kw, 'i');
    let hits = 0;
    for (const l of readLines(STREAM)) {
      if (l.slice(0, 10) < since) continue;
      if (re.test(l)) { try { const o = JSON.parse(l); console.log(`${o.t.slice(5, 16)} [${o.src}/${o.kind}] ${o.text}`); } catch {} hits++; }
    }
    let dir = [];
    try { dir = fs.readdirSync(DAILY).filter(f => f.endsWith('.md') && f.slice(0, 10) >= since).sort(); } catch {}
    for (const f of dir) {
      const txt = fs.readFileSync(DAILY + f, 'utf8');
      const ls = txt.split('\n').filter(l => re.test(l));
      if (ls.length) { console.log(`--- ${f}`); ls.forEach(l => console.log('  ' + l.trim())); hits += ls.length; }
    }
    console.log(hits ? `共 ${hits} 条` : '没找着');
    break;
  }
  case 'merge': {
    const days = has('all') ? streamDates() : [opt('date', today())].filter(isDay);
    if (!days.length) { console.log('流水里没有可生成的日期'); break; }
    for (const d of days) mergeDay(d);
    const N = readLines(STREAM).length;
    const M = dailyDays().length;
    console.log(`覆盖率：流水 ${N} 条 / 日报 ${M} 条`);
    break;
  }
  case 'daily': {
    const day = args[1] || today();
    const p = DAILY + day + '.md';
    console.log(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '这天还没有日报');
    break;
  }
  case 'check': {
    const errs = [];
    let mem = '';
    try { mem = fs.readFileSync(MEMORY, 'utf8'); } catch { errs.push('memory.md 读不到：' + MEMORY); }
    const dateHeads = mem.split('\n').filter(l => /^##\s*20\d{2}-\d{2}-\d{2}/.test(l.trim()));
    if (dateHeads.length) errs.push(`memory.md 里还有 ${dateHeads.length} 个日期章节标题（只该留结论）：${dateHeads.slice(0, 3).map(s => s.trim()).join(' / ')}`);
    const dd = new Set(dailyDays());
    const noDaily = streamDates().filter(d => !dd.has(d));
    if (noDaily.length) errs.push('流水有记录但没日报：' + noDaily.join(', '));
    const win = lastDays(7);
    const from = win[win.length - 1], to = win[0];
    const dataDays = new Set();
    for (const [file, field] of [['data/study_log.jsonl', 'date'], ['data/health.jsonl', 'date'], ['kb/mistakes.jsonl', 'date']]) {
      for (const l of readLines(R + file)) { try { const d = dayOf(JSON.parse(l)[field]); if (isDay(d)) dataDays.add(d); } catch {} }
    }
    const recent = [...dataDays].filter(d => d >= from && d <= to).sort();
    const recentNoDaily = recent.filter(d => !dd.has(d));
    if (recentNoDaily.length) errs.push(`最近 7 天（${from}~${to}）有数据但缺日报：` + recentNoDaily.join(', '));
    if (errs.length) { console.log('CHECK FAILED'); for (const e of errs) console.log(' - ' + e); process.exitCode = 1; }
    else console.log(`OK（流水 ${readLines(STREAM).length} 条 / 日报 ${dd.size} 个；最近 7 天有数据 ${recent.length} 天）`);
    break;
  }
  default:
    console.log('用法: add --src app --kind study --text "..." | tail [10] | recall 关键词 [--days 30] | merge [--date 2026-11-09 | --all] | daily [日期] | check');
}
