#!/usr/bin/env node
// 主动监督 2.0 状态机：开始/报进度/抽查/收工
import fs from 'node:fs';
import path from 'node:path';

const R = '/root/学习助手/';
const P = {
  session: R + 'data/session.json',
  stream: R + 'mem/stream.jsonl',
  studylog: R + 'data/study_log.jsonl',
  checks: R + 'logs/监督抽查.log',
};
const now = () => { const d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 19) + '+08:00'; };
const local = (d = new Date()) => {
  const t = new Date(d.getTime() + 8 * 3600e3);
  return t.toISOString().slice(0, 19).replace('T', ' ');
};
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const readS = () => { try { return JSON.parse(fs.readFileSync(P.session, 'utf8')); } catch { return null; } };
const writeS = (s) => fs.writeFileSync(P.session, JSON.stringify(s, null, 2) + '\n');
const stream = (o) => fs.appendFileSync(P.stream, JSON.stringify({ t: now(), src: o.src || 'app', ...o }) + '\n');

const empty = () => ({ active: false, startAt: null, subject: null, plan: null, reports: [], checks: [], stopAt: null });

switch (cmd) {
  case 'start': {
    const prev = readS();
    if (prev && prev.active && prev.startAt) {
      const pmins = Math.max(1, Math.round((Date.now() - new Date(prev.startAt).getTime()) / 60000));
      fs.appendFileSync(P.studylog, JSON.stringify({
        date: local().slice(0, 10), start: prev.startAt, end: now(), minutes: pmins,
        subject: prev.subject, plan: prev.plan, reports: prev.reports.length, checks: prev.checks.length,
        entertainment: prev.checks.filter(c => c.verdict === '娱乐').length, auto: '被新一场顶掉，自动结算',
      }) + '\n');
      stream({ kind: 'study_stop', text: `自动收工（被新一场顶掉）：${prev.subject} ${pmins} 分钟` });
    }
    const s = empty();
    s.active = true;
    s.startAt = now();
    s.subject = opt('subject', '未知');
    s.plan = opt('plan', '');
    writeS(s);
    stream({ kind: 'study_start', text: `开始学：${s.subject}${s.plan ? ' · ' + s.plan : ''}` });
    console.log(JSON.stringify({ ok: true, startAt: s.startAt, subject: s.subject }));
    break;
  }
  case 'addtime': {
    const mins = Math.max(1, Number(opt('minutes', '0')) || 0);
    const subject = opt('subject', '学习');
    const note = opt('note', '');
    const row = { date: local().slice(0, 10), start: '', end: now(), minutes: mins, subject, plan: note, reports: 0, checks: 0, entertainment: 0, manual: true };
    fs.appendFileSync(P.studylog, JSON.stringify(row) + '\n');
    stream({ kind: 'study_add', text: `补录学习 ${mins} 分钟：${subject}${note ? ' · ' + note : ''}` });
    console.log(JSON.stringify({ ok: true, minutes: mins, subject }));
    break;
  }
  case 'report': {
    const s = readS() || empty();
    const r = { at: now(), progress: opt('progress', ''), blocked: opt('blocked', null) };
    s.reports.push(r);
    s.lastReportAt = r.at;
    writeS(s);
    stream({ kind: 'study_report', text: `进度：${r.progress}${r.blocked ? '；卡在 ' + r.blocked : ''}` });
    console.log(JSON.stringify({ ok: true, report: r, count: s.reports.length }));
    break;
  }
  case 'check': {
    const s = readS() || empty();
    const waitS = Number(opt('wait', '0')) || 0;
    const c = { at: now(), app: opt('app', '未知'), verdict: opt('verdict', '未知'), sent: opt('sent', 'false') === 'true', waitS };
    // 读屏等权限 ≥60 秒 = 那一刻他手机锁着，打开手机之后才批 → 判「熄屏」，不提醒
    if (waitS >= 60) { c.verdict = '熄屏'; c.auto = '等权限' + waitS + 's'; c.sent = false; }
    s.checks.push(c);
    s.lastCheckAt = c.at;
    s.nagCount = (s.nagCount || 0) + (c.sent ? 1 : 0);
    writeS(s);
    fs.appendFileSync(P.checks, `${local()}\t${c.app}\t${c.verdict}\t${c.sent ? '已提醒' : '不打扰'}\t等权限${waitS}s\n`);
    const nag = c.verdict === '娱乐' && s.nagCount <= 3;
    console.log(JSON.stringify({ ok: true, nag, nagCount: s.nagCount }));
    break;
  }
  case 'stop': {
    const s = readS() || empty();
    if (!s.active) { console.log(JSON.stringify({ ok: false, msg: '没在学' })); break; }
    const startMs = new Date(s.startAt).getTime();
    const raws = [startMs];
    for (const r of (s.reports || [])) raws.push(new Date(r.at).getTime());
    for (const c of (s.checks || [])) raws.push(new Date(c.at).getTime());
    const lastAct = Math.max(...raws.filter(n => !Number.isNaN(n)));
    const rawMin = Math.max(1, Math.round((Date.now() - startMs) / 60000));
    const gapMin = Math.round((Date.now() - lastAct) / 60000);
    // 超过 4 小时没有任何进度/抽查 = 场次被忘在那儿了（2026-11-14 修 1529 分钟那种挂账）
    const capped = gapMin > 240;
    const mins = capped ? Math.max(1, Math.round((lastAct - startMs) / 60000)) : rawMin;
    const endIso = capped ? new Date(lastAct + 8 * 3600e3).toISOString().replace('Z', '+08:00') : now();
    const row = {
      date: local().slice(0, 10), start: s.startAt, end: endIso, minutes: mins,
      subject: s.subject, plan: s.plan, reports: s.reports.length, checks: s.checks.length,
      entertainment: s.checks.filter(c => c.verdict === '娱乐').length,
      ...(capped ? { capped: true, rawMinutes: rawMin, note: `最后活动在 ${gapMin} 分钟前，按最后一次进度结算` } : {}),
    };
    fs.appendFileSync(P.studylog, JSON.stringify(row) + '\n');
    s.active = false; s.stopAt = endIso; s.minutes = mins;
    writeS(s);
    stream({ kind: 'study_stop', text: `收工：${s.subject} ${mins} 分钟${capped ? `（超时结算，原按时间算 ${rawMin} 分钟，已按最后一次进度截断）` : ''}，抽查 ${s.checks.length} 次，娱乐 ${row.entertainment} 次` });
    console.log(JSON.stringify({ ok: true, minutes: mins, capped, rawMinutes: capped ? rawMin : undefined, entertainment: row.entertainment }));
    break;
  }
  case 'status': {
    const s = readS() || empty();
    const mins = s.active ? Math.max(0, Math.round((Date.now() - new Date(s.startAt).getTime()) / 60000)) : 0;
    const last = s.lastReportAt || s.startAt;
    const sinceReport = last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null;
    console.log(JSON.stringify({ ...s, elapsedMin: mins, minSinceReport: sinceReport, shouldNag: s.active && sinceReport !== null && sinceReport >= 10 }, null, 2));
    break;
  }
  case 'plan-checks': {
    // 随机生成一场学习内的抽查时间点
    const minutes = +(opt('minutes', 150));
    const count = +(opt('count', 4));
    const gap = minutes / (count + 1);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const base = gap * i;
      const jitter = (Math.random() - 0.5) * gap * 0.6;
      out.push(Math.round(base + jitter));
    }
    console.log(JSON.stringify(out));
    break;
  }
  default:
    console.log('用法: start --subject X --plan "..." | report --progress "..." [--blocked "..."] | check --app X --verdict 学习|娱乐|熄屏 [--sent true] [--wait 等权限秒数] | stop | status | plan-checks --minutes 150 --count 4');
}
