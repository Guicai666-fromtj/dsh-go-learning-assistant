#!/usr/bin/env node
// 余额监测：估算当前余额 = 上次官方同步余额 - 同步之后的事件花费
// 用法：node balance-watch.mjs [--watch 秒] [--quiet]
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const USAGE = process.env.DSHW_USAGE || '/root/.dsh/.dshw-usage.json'
const STATE = process.env.BAL_STATE || '/root/学习助手/data/balance-watch.json'
const ALERT = process.env.BAL_ALERT || '/root/学习助手/data/balance-alert.json'
const QQ = '/root/学习助手/bin/qq-send.mjs'
const WARN = Number(process.env.BAL_WARN || 2)
const STOP = Number(process.env.BAL_STOP || 1.2)

function read() {
  const u = JSON.parse(fs.readFileSync(USAGE, 'utf8'))
  const ev = Array.isArray(u.events) ? u.events : []
  const books = u?.accounting?.books || {}
  const active = u?.accounting?.active
  const baseTs = Number(books?.[active]?.lastAt) || 0
  const base = Number(u.lastBalance) || 0
  let after = 0
  let today = 0
  const d = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  for (const e of ev) {
    if (Number(e.ts) > baseTs) after += Number(e.cost) || 0
    if (e.day === d) today += Number(e.cost) || 0
  }
  const est = Math.max(0, base - after)
  return { est, base, after, today, baseTs, syncedAt: baseTs ? new Date(baseTs).toISOString() : null }
}

function state() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)) }

function sendQQ(text) {
  return new Promise(resolve => {
    execFile(process.execPath, [QQ, text], { timeout: 30000 }, (err) => resolve(!err))
  })
}

let lastSent = 0
async function tick(quiet) {
  const s = read()
  const st = state()
  const now = Date.now()
  const low = s.est < WARN
  const critical = s.est < STOP
  const payload = { at: new Date(now + 8 * 3600e3).toISOString().replace('Z', '+08:00'), ...s, warn: WARN, stop: STOP, low, critical }
  fs.mkdirSync(path.dirname(ALERT), { recursive: true })
  fs.writeFileSync(ALERT, JSON.stringify(payload, null, 2))
  if (!quiet) console.log(`est ¥${s.est.toFixed(2)}（base ${s.base.toFixed(2)} − 同步后 ${s.after.toFixed(2)}）今 ¥${s.today.toFixed(2)}${low ? ' ⚠️低' : ''}`)
  if (low && now - lastSent > 10 * 60e3 && now - (st.lastSent || 0) > 10 * 60e3) {
    const msg = critical
      ? `🛑 余额估算只剩 ¥${s.est.toFixed(2)}（<${STOP}），我立刻停手，等你充值。`
      : `⚠️ 余额估算 ¥${s.est.toFixed(2)}（低于 ${WARN} 元），我准备收尾停手，等你充值。`
    const ok = await sendQQ(msg)
    lastSent = now
    saveState({ ...st, lastSent: now, lastEst: s.est, qqOk: ok })
  } else {
    saveState({ ...st, lastEst: s.est })
  }
  return s
}

const args = process.argv.slice(2)
const watchIdx = args.indexOf('--watch')
const quiet = args.includes('--quiet')
if (watchIdx >= 0) {
  const sec = Number(args[watchIdx + 1]) || 60
  await tick(quiet)
  setInterval(() => { tick(quiet).catch(e => console.error('tick', e.message)) }, sec * 1000)
} else {
  await tick(quiet)
}
