#!/usr/bin/env node
// B 段：桌宠陪学的数据底座（宠物状态随学习数据变化）
// 用法：node pet.mjs <status|tick|name|add-exp> [参数]
import fs from 'node:fs';

const ROOT = '/root/学习助手';
const PET = ROOT + '/data/pet.json';
const LOG = ROOT + '/data/study_log.jsonl';
const MIST = ROOT + '/kb/mistakes.jsonl';
const QUIZ = ROOT + '/data/quiz.json';

function today(off = 0) {
  return new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
}
function now() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
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
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function loadPet() {
  if (!fs.existsSync(PET)) {
    return { name: '小灭', level: 1, exp: 0, mood: 70, hunger: 60, fedToday: 0, lastTick: today(), born: today(), log: [] };
  }
  return JSON.parse(fs.readFileSync(PET, 'utf8'));
}
function savePet(p) {
  fs.mkdirSync(ROOT + '/data', { recursive: true });
  fs.writeFileSync(PET, JSON.stringify(p, null, 1));
}
function todayMinutes() {
  if (!fs.existsSync(LOG)) return 0;
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } })
    .filter(x => x.date === today()).reduce((s, x) => s + (Number(x.minutes) || 0), 0);
}
function pendingMistakes() {
  if (!fs.existsSync(MIST)) return 0;
  return fs.readFileSync(MIST, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return {}; } })
    .filter(x => x.status !== 'mastered').length;
}
function levelOf(exp) { return 1 + Math.floor(exp / 100); }

function tick(p, update = true) {
  const d = today();
  if (p.lastTick !== d) {
    const gap = Math.max(1, Math.round((new Date(d + 'T00:00:00Z') - new Date(p.lastTick + 'T00:00:00Z')) / 86400e3));
    p.hunger = clamp(p.hunger - 15 * gap);
    p.mood = clamp(p.mood - 8 * gap);
    p.lastTick = d;
    p.fedToday = 0;
  }
  const mins = todayMinutes();
  const feed = Math.min(mins, 120); // 今天学了多久，最多喂 120 口
  const newFeed = Math.max(0, feed - (p.fedToday || 0));
  if (update && newFeed > 0) {
    p.hunger = clamp(p.hunger + newFeed * 0.8);
    p.mood = clamp(p.mood + newFeed * 1.2);
    p.exp += newFeed;
    p.fedToday = feed;
  }
  p.level = levelOf(p.exp);
  if (update) savePet(p);
  return p;
}
function face(p) {
  if (p.hunger < 25) return '😿';
  if (p.mood < 25) return '😾';
  if (p.mood > 80) return '😻';
  if (p.hunger > 80) return '😺';
  return '🐱';
}
function statusText(p) {
  const mins = todayMinutes();
  return `${face(p)} ${p.name} Lv${p.level}｜今天学 ${mins} 分钟 · 饱食 ${Math.round(p.hunger)} · 心情 ${Math.round(p.mood)} · 经验 ${p.exp}（升级还需 ${100 - (p.exp % 100)}）｜未掌握错题 ${pendingMistakes()} 道`;
}
const a = parse(process.argv.slice(2));
const cmd = a._[0];

if (cmd === 'status') {
  const p = tick(loadPet(), a.tick === 'true');
  if (a.json) console.log(JSON.stringify(p, null, 1));
  else console.log(statusText(p));
} else if (cmd === 'pat') {
  const p = tick(loadPet(), false);
  const d = today();
  if (p.lastPat === d) {
    console.log('今天已经摸过了，一天一次。去学 25 分钟，它自己就高兴了。');
  } else {
    p.lastPat = d;
    p.mood = clamp(p.mood + 6);
    p.log = (p.log || []).slice(-50).concat([{ at: now(), why: '摸摸（一天一次）', n: 0 }]);
    savePet(p);
    console.log(statusText(p));
  }
} else if (cmd === 'tick') {
  const p = tick(loadPet(), true);
  console.log(statusText(p));
} else if (cmd === 'name') {
  const p = loadPet();
  if (!a.name) { console.log(p.name); } else { p.name = a.name; savePet(p); console.log('改名：' + a.name); }
} else if (cmd === 'add-exp') {
  const p = loadPet();
  p.exp += Number(a.n || 0);
  if (a.mood) p.mood = clamp(p.mood + Number(a.mood));
  p.level = levelOf(p.exp);
  p.log = (p.log || []).slice(-50).concat([{ at: now(), why: a.why || '', n: Number(a.n || 0) }]);
  savePet(p);
  console.log(statusText(p));
} else {
  console.error('命令：status|tick|pat|name|add-exp');
  process.exit(2);
}
