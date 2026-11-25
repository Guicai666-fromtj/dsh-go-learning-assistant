#!/usr/bin/env node
// chat-watch：扫会话日志，把「用户本人」说的睡眠/成绩/身体报告自动抄进记忆流水
// 用法：
//   node bin/chat-watch.mjs            # 单次扫描（cron / 插件循环调用）
//   node bin/chat-watch.mjs --init     # 初始化基线，不写任何东西
//   node bin/chat-watch.mjs --dry      # 只打印匹配，不写盘
//   node bin/chat-watch.mjs --backfill 200  # 首次只看最后 200 行（调试用）
//   node bin/chat-watch.mjs --watch [秒]    # 常驻循环
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { classify, norm, channelOf } from './chat-match.mjs';

const R = process.env.WATCH_MEM_ROOT || '/root/学习助手/';
const SESS = process.env.WATCH_SESS_ROOT || '/root/.dsh/sessions/';
const STREAM = R + 'mem/stream.jsonl';
const TURNS = R + 'mem/turns.jsonl';
const STATE = R + 'mem/watch-state.json';
const LOG = R + 'mem/watch.log';
const LOCK = R + 'mem/.watch.lock';
const args = process.argv.slice(2);
const has = (k) => args.includes('--' + k);
const opt = (k, d = null) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = has('dry'), INIT = has('init');
const BACKFILL = Number(opt('backfill', 0)) || 0;
const WATCH = has('watch') ? Math.max(30, Number(opt('watch', 45)) || 45) : 0;
const MAX_AGE_MS = 3 * 864e5;

const nowLocal = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
const tsLocal = (ms) => new Date(Number(ms) + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
const log = (s) => { try { fs.appendFileSync(LOG, `[${nowLocal()}] ${s}\n`); } catch {} };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { fs.writeFileSync(p, JSON.stringify(o)); };

function walk(d, out = []) {
  let names; try { names = fs.readdirSync(d); } catch { return out; }
  for (const f of names) {
    const p = path.join(d, f);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (f.startsWith('session.v4.jsonl')) out.push(p);
  }
  return out;
}

function readSessionText(p) {
  const raw = fs.readFileSync(p);
  return p.endsWith('.zstd') ? zlib.zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
}

function lastStreamRows(n = 300) {
  try { return fs.readFileSync(STREAM, 'utf8').split('\n').filter(l => l.trim()).slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

function tailRows(file, n) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

function appendTurn(row) {
  try { fs.appendFileSync(TURNS, JSON.stringify(row) + '\n'); return true } catch { return false }
}

function appendRow(row, st) {
  const recent = lastStreamRows(400);
  const dup = recent.some(o => o.kind === row.kind && norm(o.text) === norm(row.text));
  if (dup) return false;
  if (DRY || INIT) return true;
  fs.appendFileSync(STREAM, JSON.stringify(row) + '\n');
  return true;
}

function scanOnce() {
  const st = readJson(STATE, { files: {}, seen: [] });
  const seen = new Set(st.seen || []);
  const turnSeen = new Set(tailRows(TURNS, 2000).map((r) => r.session + '|' + r.seq));
  let found = 0, wrote = 0;
  const files = walk(SESS);
  for (const p of files) {
    let stt; try { stt = fs.statSync(p); } catch { continue; }
    if (Date.now() - stt.mtimeMs > MAX_AGE_MS) continue;
    const rel = p.slice(SESS.length);
    let lines;
    try { lines = readSessionText(p).split('\n'); } catch (e) { log('读失败 ' + rel + ' ' + e.message); continue; }
    const n = lines.length;
    const prev = st.files[rel] ? st.files[rel].lines : (BACKFILL ? Math.max(0, n - BACKFILL) : n);
    const start = n < prev ? Math.max(0, n - 200) : prev;
    const parts = rel.split('/');
    const sid = parts.find((x) => x.startsWith('session-')) || parts[0];
    const fakeSession = { id: sid, header: { cwd: rel.includes('qqbot-workspace') ? '/root/.dsh-qqbot/workspace' : '/root/workspace' } };
    for (let i = start; i < n; i++) {
      const l = lines[i]; if (!l || !l.trim()) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.type !== 'user/message') continue;
      const src = o.data && o.data.source;
      const channel = channelOf(src, fakeSession);
      if (!channel) continue;                         // 只要真人说的；定时任务/系统注入/QQ群聊全跳过
      const parts = (o.data.content || []).filter(c => c && c.type === 'text' && c.text).map(c => c.text);
      const text = parts.join('\n').trim();
      if (!text) continue;
      const key = sid + ':' + o.seq;
      if (seen.has(key)) continue;
      if (!turnSeen.has(key)) {
        turnSeen.add(key);
        appendTurn({ t: tsLocal(o.time), ch: channel, session: sid, seq: o.seq, text: text.slice(0, 500) });
      }
      const kind = classify(text);
      if (!kind) continue;
      seen.add(key);
      found++;
      const row = { t: tsLocal(o.time), src: channel, kind, text: text.slice(0, 300), auto: true, session: sid, seq: o.seq };
      if (appendRow(row, st)) { wrote++; if (DRY || INIT) console.log('MATCH', kind, row.t, text.slice(0, 60).replace(/\n/g, ' ')); }
    }
    st.files[rel] = { lines: n, mtime: Math.round(stt.mtimeMs) };
  }
  st.seen = [...seen].slice(-5000);
  if (!DRY) writeJson(STATE, st);
  log(`扫描 ${files.length} 个会话文件，匹配 ${found} 条，写入 ${wrote} 条${DRY ? '（dry）' : ''}`);
  return { found, wrote };
}

function withLock(fn) {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); }
  catch {
    let old = 0; try { old = fs.statSync(LOCK).mtimeMs; } catch {}
    if (Date.now() - old < 120000) return null;   // 上一轮还在跑
    try { fs.unlinkSync(LOCK); } catch {}
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); } catch { return null; }
  }
  try { return fn(); } finally { try { fs.unlinkSync(LOCK); } catch {} }
}

function main() {
  if (WATCH) {
    log('守护启动，间隔 ' + WATCH + 's');
    const tick = () => { try { withLock(scanOnce); } catch (e) { log('异常 ' + e.message); } };
    tick();
    const iv = setInterval(tick, WATCH * 1000);
    process.on('SIGTERM', () => { clearInterval(iv); process.exit(0); });
    process.on('SIGINT', () => { clearInterval(iv); process.exit(0); });
    return;
  }
  const r = withLock(scanOnce);
  if (!r) { console.log('上一轮还在跑，跳过'); return; }
  console.log(`匹配 ${r.found} 条，写入 ${r.wrote} 条`);
}

main();
