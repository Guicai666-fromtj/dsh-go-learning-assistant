#!/usr/bin/env node
// 记忆内核：决议柜（facts / threads）+ 一页看板（index）+ 校验（check）
// 设计见 /root/workspace/memcore/DESIGN.md
// 规矩：一条一件事；能现算的不进决议柜；错了不删，标作废/被取代。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const R = process.env.MEMCORE_ROOT || '/root/学习助手'
const F = {
  facts: path.join(R, 'mem/facts.json'),
  threads: path.join(R, 'mem/threads.json'),
  index: path.join(R, 'mem/index.md'),
  stream: path.join(R, 'mem/stream.jsonl'),
  daily: path.join(R, 'mem/daily'),
  memories: path.join(R, 'memory.md'),
  mistakes: path.join(R, 'kb/mistakes.jsonl'),
  scores: path.join(R, 'data/scores.jsonl'),
  health: path.join(R, 'data/health.jsonl'),
  studylog: path.join(R, 'data/study_log.jsonl'),
  session: path.join(R, 'data/session.json'),
  backupRoot: process.env.MEMCORE_BACKUP || '/sdcard/Download/DSH-Go/学习助手备份',
}
const CORE_BUDGET = Number(process.env.MEMCORE_CORE_BUDGET || 1500)
const INDEX_BUDGET = Number(process.env.MEMCORE_INDEX_BUDGET || 2000)
const MAX_VALUE = 200
const MAX_SENTENCES = 3

const nowISO = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00'
const today = () => nowISO().slice(0, 10)
const args = process.argv.slice(2)
const cmd = args[0]
const SEM = path.join(R, 'vendor/sem/sem.mjs')
const opt = (k, d = null) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const has = (k) => args.includes('--' + k)

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  fs.renameSync(tmp, file)
}
function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
const loadFacts = () => readJSON(F.facts, { version: 1, updatedAt: nowISO(), facts: {} })
const loadThreads = () => readJSON(F.threads, { version: 1, updatedAt: nowISO(), threads: {} })
const liveFacts = () => Object.entries(loadFacts().facts || {}).filter(([, f]) => f && !f.stale)

// ---------- 校验写入 ----------
function validateValue(v) {
  const s = String(v ?? '').trim()
  if (!s) return '空值'
  if (s.length > MAX_VALUE) return `太长（${s.length} > ${MAX_VALUE} 字），拆成多条`
  const sentences = s.split(/[。！？!?；;\n]+/).filter(x => x.trim())
  if (sentences.length > MAX_SENTENCES) return `太多句（${sentences.length} > ${MAX_SENTENCES}），一条只写一件事`
  return null
}
function validateKey(k) {
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_.·-]{2,40}$/.test(k || '')) return 'key 不合法（2-40 字符，中文/字母/数字/._·-）'
  return null
}

// ---------- 命令：facts ----------
function factSet() {
  const key = opt('key'); const value = opt('value')
  const err = validateKey(key) || validateValue(value)
  if (err) { console.error('拒绝写入：' + err); process.exitCode = 1; return }
  const db = loadFacts()
  const old = db.facts[key]
  const at = nowISO()
  const rec = {
    v: String(value).trim(), at, by: opt('by', 'app'), src: opt('src', null),
    core: has('core') || !!old?.core, history: old ? [...(old.history || []), { v: old.v, at: old.at, supersededAt: at }] : [],
  }
  db.facts[key] = rec
  const sup = (opt('supersede') || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const k of sup) {
    if (db.facts[k]) db.facts[k] = { ...db.facts[k], supersededBy: key, staleAt: at, history: [...(db.facts[k].history || []), { v: db.facts[k].v, at: db.facts[k].at, supersededAt: at }] }
    else console.error('提示：supersede 指向不存在的 key ' + k)
  }
  db.updatedAt = at
  writeJSON(F.facts, db)
  console.log(`已记 ${key} = ${rec.v}${rec.core ? '（核心）' : ''}${sup.length ? '，取代 ' + sup.join(',') : ''}`)
}

function factRm() {
  const key = opt('key')
  const db = loadFacts()
  if (!db.facts[key]) { console.error('没有这个 key：' + key); process.exitCode = 1; return }
  db.facts[key] = { ...db.facts[key], stale: true, staleAt: nowISO(), staleReason: opt('reason', null) }
  db.updatedAt = nowISO()
  writeJSON(F.facts, db)
  console.log(`已作废 ${key}（原文保留，可查）`)
}

// ---------- 命令：threads ----------
function threadAdd() {
  const text = opt('text')
  const err = validateValue(text)
  if (err) { console.error('拒绝写入：' + err); process.exitCode = 1; return }
  const db = loadThreads()
  const id = 't-' + Date.now().toString(36)
  db.threads[id] = { v: String(text).trim(), due: opt('due') || null, at: nowISO(), by: opt('by', 'app'), status: 'open' }
  db.updatedAt = nowISO()
  writeJSON(F.threads, db)
  console.log(`已挂 ${id}：${text}${opt('due') ? '（due ' + opt('due') + '）' : ''}`)
}
function threadClose() {
  const id = opt('id')
  const db = loadThreads()
  if (!db.threads[id]) { console.error('没有这条线索：' + id); process.exitCode = 1; return }
  db.threads[id].status = 'closed'
  db.threads[id].closedAt = nowISO()
  db.updatedAt = nowISO()
  writeJSON(F.threads, db)
  console.log(`已结 ${id}`)
}

// ---------- 现算数据 ----------
function studyToday() {
  const d = today()
  let mins = 0; const by = {}
  for (const r of readLines(F.studylog)) {
    if (r.date !== d) continue
    const m = Number(r.minutes) || 0
    mins += m
    const k = r.subject || '未分类'
    by[k] = (by[k] || 0) + m
  }
  return { mins: Math.round(mins * 10) / 10, by }
}
function mistakes() {
  const list = readLines(F.mistakes).filter(m => !m.simulated)
  const notMastered = list.filter(m => m.status !== 'mastered')
  const due = notMastered.filter(m => m.nextReview && m.nextReview <= today())
  return { total: list.length, notMastered: notMastered.length, due: due.length }
}
function sleepLast() {
  const rows = readLines(F.health).filter(r => r.sleepH)
  if (!rows.length) return null
  const r = rows[rows.length - 1]
  return { date: r.date, h: r.sleepH }
}
function currentActivity() {
  const s = readJSON(F.session, null)
  if (s && s.active) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(s.startAt).getTime()) / 60000))
    return { active: true, subject: s.subject, plan: s.plan, startAt: s.startAt, mins }
  }
  return { active: false }
}

// ---------- 命令：index ----------
function buildIndex() {
  const facts = liveFacts()
  const core = facts.filter(([, f]) => f.core)
  const openThreads = Object.entries(loadThreads().threads || {}).filter(([, t]) => t.status === 'open')
  const act = currentActivity()
  const st = studyToday()
  const mk = mistakes()
  const sl = sleepLast()
  const coreChars = core.reduce((a, [, f]) => a + f.v.length + 8, 0)
  const lines = []
  lines.push(`# 看板 · ${nowISO().slice(0, 16)}`)
  lines.push('> 自动生成，别手改。重建：`node bin/memcore.mjs index`')
  lines.push('')
  lines.push('## 现在')
  if (act.active) lines.push(`- 进行中：${act.subject || '?'}${act.plan ? '（' + act.plan + '）' : ''}，已 ${act.mins} 分钟；开始 ${act.startAt}${act.mins > 240 ? ' ⚠️超过4小时，可能忘了收尾' : ''}`)
  else lines.push('- 进行中：无（监督状态 idle）')
  lines.push(`- 今天：学时 ${st.mins} 分${Object.keys(st.by).length ? '（' + Object.entries(st.by).map(([k, v]) => k + ' ' + v + '分').join('/') + '）' : ''}；错题 ${mk.total} 道、未掌握 ${mk.notMastered}、到期 ${mk.due}`)
  if (sl) lines.push(`- 最近一次睡眠：${sl.date} ${sl.h}h`)
  lines.push('')
  lines.push('## 核心事实')
  for (const [k, f] of core) lines.push(`- ${k}：${f.v}`)
  lines.push('')
  if (openThreads.length) {
    lines.push('## 欠账')
    for (const [id, t] of openThreads) lines.push(`- [${id}] ${t.v}${t.due ? '（due ' + t.due + '）' : ''}`)
    lines.push('')
  }
  const recent = recentDaily(3)
  if (recent.length) { lines.push('## 最近三天'); for (const r of recent) lines.push(r); lines.push('') }
  lines.push('## 文件入口')
  lines.push('- 决议：mem/facts.json · mem/threads.json')
  lines.push('- 流水：mem/stream.jsonl · 日报：mem/daily/')
  lines.push('- 原始数据：data/ · 错题：kb/mistakes.jsonl')
  let text = lines.join('\n')
  if (text.length > INDEX_BUDGET) {
    // 超预算先砍「最近三天」，再砍非核心事实（本版只有核心事实，故砍最近三天）
    const cut = text.indexOf('## 最近三天')
    if (cut > 0) text = text.slice(0, cut) + '\n（最近三天因预算省略）\n'
    if (text.length > INDEX_BUDGET) text = text.slice(0, INDEX_BUDGET - 20) + '\n（看板超预算已截断）'
  }
  fs.mkdirSync(path.dirname(F.index), { recursive: true })
  fs.writeFileSync(F.index, text + '\n')
  return { chars: text.length, coreChars, core: core.length, threads: openThreads.length }
}
function recentDaily(n) {
  try {
    const files = fs.readdirSync(F.daily).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-n).reverse()
    const out = []
    for (const f of files) {
      const body = fs.readFileSync(path.join(F.daily, f), 'utf8')
      const bullets = body.split('\n').filter(l => /^\s*[-*]\s+/.test(l)).slice(0, 2).map(l => l.trim())
      out.push(`- ${f.slice(0, 10)}：${bullets.join('；').replace(/^-\s*/, '') || '（无要点）'}`)
    }
    return out
  } catch { return [] }
}

// ---------- 命令：check ----------
function check() {
  const errs = []; const warns = []
  const db = loadFacts(); const facts = db.facts || {}
  const coreChars = Object.entries(facts).filter(([, f]) => f.core && !f.stale).reduce((a, [, f]) => a + String(f.v || '').length + 8, 0)
  // 1 看板里出现手写日期章节
  if (fs.existsSync(F.index)) {
    const idx = fs.readFileSync(F.index, 'utf8')
    if (/^## 20\d\d-\d\d-\d\d/m.test(idx)) errs.push('看板里出现手写日期章节（只该由脚本重建）')
    if (idx.includes('## 2026-11-11 21:30')) errs.push('看板里混入了旧日期盘点')
  } else errs.push('看板不存在（跑 memcore index）')
  // 2 有流水没日报（近 7 天）
  const dailyFiles = new Set((() => { try { return fs.readdirSync(F.daily) } catch { return [] } })())
  const streamDays = new Set(readLines(F.stream).map(r => String(r.t || '').slice(0, 10)).filter(Boolean))
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + 8 * 3600e3 - i * 864e5).toISOString().slice(0, 10)
    if (streamDays.has(d) && !dailyFiles.has(d + '.md')) errs.push(`流水有记录但没日报：${d}`)
  }
  // 3 core 超预算
  if (coreChars > CORE_BUDGET) errs.push(`核心事实 ${coreChars} 字 > 预算 ${CORE_BUDGET}`)
  // 4 缺来源
  for (const [k, f] of Object.entries(facts)) if (!f.by || !f.at) warns.push(`决议缺来源 by/at：${k}`)
  // 5 supersede 指向不存在
  for (const [k, f] of Object.entries(facts)) if (f.supersededBy && !facts[f.supersededBy]) errs.push(`supersededBy 指向不存在：${k} → ${f.supersededBy}`)
  // 6 看板过期
  try {
    const fs1 = fs.statSync(F.index).mtimeMs
    const u = db.updatedAt ? Date.parse(db.updatedAt) : 0
    if (u && fs1 < u) errs.push('看板比决议旧（重建 memcore index）')
  } catch { }
  // 7 备份 24h
  try {
    const dirs = fs.readdirSync(F.backupRoot).filter(d => /^\d{8}-\d{6}$/.test(d)).sort()
    const last = dirs[dirs.length - 1]
    const t = last ? Date.parse(last.slice(0, 4) + '-' + last.slice(4, 6) + '-' + last.slice(6, 8) + 'T' + last.slice(9, 11) + ':' + last.slice(11, 13) + ':' + last.slice(13, 15) + '+08:00') : 0
    if (!t || Date.now() - t > 26 * 3600e3) warns.push('备份超过 24 小时没跑：' + (last || '无'))
  } catch { warns.push('备份目录不可读') }
  // 8 日报字符异常
  for (const f of dailyFiles) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue
    const n = fs.readFileSync(path.join(F.daily, f), 'utf8').length
    if (n < 200) errs.push(`日报过短：${f}（${n} 字）`)
    if (n > 20000) errs.push(`日报过长：${f}（${n} 字）`)
  }
  // 9 进行中超过 4 小时
  const act = currentActivity()
  if (act.active && act.mins > 240) errs.push(`进行中超过 4 小时（${act.mins} 分），可能忘了收尾：${act.subject}`)
  // 10 旧 memory.md 还带日期章节（迁移未完成）
  try {
    const md = fs.readFileSync(F.memories, 'utf8')
    if (/^## 20\d\d-\d\d-\d\d/m.test(md)) warns.push('memory.md 里还有日期章节（该迁到流水/日报）')
  } catch { }

  console.log(`自检：${Object.keys(facts).length} 条决议 / ${Object.keys(loadThreads().threads || {}).length} 条线索 / 核心 ${coreChars} 字（预算 ${CORE_BUDGET}）`)
  for (const e of errs) console.log(' [阻断] ' + e)
  for (const w of warns) console.log(' [提示] ' + w)
  if (errs.length) { console.log(`打回：${errs.length} 条阻断`); process.exitCode = 1 }
  else console.log('放行')
}

// ---------- 命令：export / import ----------
function exportAll() {
  const out = { facts: loadFacts(), threads: loadThreads(), exportedAt: nowISO() }
  const file = opt('out') || path.join(R, 'mem/export.json')
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  console.log('已导出 ' + file)
}

// ---------- 主入口 ----------
switch (cmd) {
  case 'fact-set': factSet(); break
  case 'fact-rm': factRm(); break
  case 'fact-list': {
    const db = loadFacts()
    for (const [k, f] of Object.entries(db.facts)) {
      if (has('core') && !f.core) continue
      if (opt('prefix') && !k.startsWith(opt('prefix'))) continue
      console.log(`${f.stale ? '✗' : f.core ? '★' : '·'} ${k} = ${f.v}${f.supersededBy ? '（被 ' + f.supersededBy + ' 取代）' : ''}  [${f.at || '?'} by ${f.by || '?'}]`)
    }
    break
  }
  case 'thread-add': threadAdd(); break
  case 'thread-close': threadClose(); break
  case 'thread-list': {
    for (const [id, t] of Object.entries(loadThreads().threads)) console.log(`${t.status === 'open' ? '○' : '✓'} ${id} ${t.v}${t.due ? '（due ' + t.due + '）' : ''}`)
    break
  }
  case 'index': {
    const r = buildIndex()
    console.log(`看板已重建：${r.chars} 字（预算 ${INDEX_BUDGET}）· 核心 ${r.core} 条 ${r.coreChars} 字 · 欠账 ${r.threads}`)
    break
  }
  case 'recall': {
    const q = args[1]
    if (!q) { console.log('用法: memcore.mjs recall "查询" [--sem] [--k 3]'); break }
    const k = Number(opt('--k', 3)) || 3
    const rows = fs.readFileSync(path.join(R, 'mem/stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const terms = q.split(/[\s，,。？?]+/).filter(Boolean)
    const scored = rows.map((r) => {
      const t = String(r.text || '')
      let sc = t.includes(q) ? 5 : 0
      for (const w of terms) if (t.includes(w)) sc += 2
      return { r, sc }
    }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || String(b.r.t).localeCompare(String(a.r.t))).slice(0, k)
    if (scored.length) {
      for (const { r, sc } of scored) console.log(`${sc}  ${String(r.t).slice(5, 16)} [${r.kind}] ${String(r.text).slice(0, 110)}`)
    } else console.log('关键词没命中')
    if (args.includes('--sem')) {
      const out = spawnSync(process.execPath, [SEM, q, String(k)], { encoding: 'utf8', timeout: 180000 })
      console.log('— 语义兜底 —')
      process.stdout.write(out.stdout || '')
      if (out.stderr) process.stderr.write(out.stderr)
    } else if (!scored.length) {
      console.log('（可以加 --sem 走语义检索；首次加载模型约 1s）')
    }
    break
  }
  case 'turns': {
    const n = Number(opt('--n', 10)) || 10
    const ch = opt('--ch', '')
    let rows = []
    try { rows = fs.readFileSync(path.join(R, 'mem/turns.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch {}
    if (ch) rows = rows.filter((r) => r.ch === ch)
    if (!rows.length) { console.log('还没有原话流水（插件/兜底扫描从启用后开始记）'); break }
    for (const r of rows.slice(-n)) console.log(`${String(r.t).slice(5, 16)} [${r.ch === 'qq' ? 'QQ私聊' : 'App'}] ${String(r.text).replace(/\n/g, ' ').slice(0, 80)}`)
    break
  }
  case 'check': check(); break
  case 'export': exportAll(); break
  default:
    console.log(`用法：
  memcore.mjs index                       重建看板 mem/index.md
  memcore.mjs check                       10 条校验
  memcore.mjs fact-set --key 学生.称呼 --value 学生 [--core] [--by app] [--src m00419]
  memcore.mjs fact-set ... --supersede 旧key,旧key2
  memcore.mjs fact-rm --key X [--reason "..."]     标作废（不删）
  memcore.mjs fact-list [--core] [--prefix 学生.]
  memcore.mjs thread-add --text "..." [--due 2026-11-14]
  memcore.mjs thread-close --id t-xxx
  memcore.mjs thread-list
  memcore.mjs export [--out file]
环境变量：MEMCORE_ROOT / MEMCORE_CORE_BUDGET / MEMCORE_INDEX_BUDGET`)
}
