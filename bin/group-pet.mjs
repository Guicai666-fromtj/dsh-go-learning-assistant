#!/usr/bin/env node
/**
 * 群宠「小灭」—— 群成员一起养的桌宠
 *
 * 用法：
 *   node group-pet.mjs status
 *   node group-pet.mjs pat  --user <openid> --name <昵称>
 *   node group-pet.mjs feed --user <openid> --name <昵称>
 *   node group-pet.mjs tick            # 每天衰减（幂等，按 lastDay）
 *   node group-pet.mjs top             # 摸/喂排行榜
 *
 * 规则：
 *   - 每人每天摸 1 次（+5 心情 +2 经验）、喂 1 次（+10 饱食 +2 经验）
 *   - 每天过点衰减：饱食 -10，心情 -5
 *   - 100 经验升一级
 *   - 数据：data/group-pet.json + data/group-pet-log.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/root/学习助手';
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'group-pet.json');
const LOG_FILE = path.join(DATA, 'group-pet-log.jsonl');

const DECAY_FULL = 10;
const DECAY_MOOD = 5;
const PAT_MOOD = 5;
const PAT_EXP = 2;
const FEED_FULL = 10;
const FEED_EXP = 2;
const EXP_PER_LEVEL = 100;
const MAX_STAT = 100;
const STUDY_DAILY_CAP = 240; // 每人每天最多算 240 分钟
const STUDY_EXP_PER_MIN = 0.5; // 每分钟 0.5 经验：1 小时 = 30 经验

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function load() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      name: '小灭',
      level: 1,
      exp: 0,
      full: 60,
      mood: 60,
      totalPats: 0,
      totalFeeds: 0,
      lastDay: today(),
      daily: {},
    };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function save(s) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function appendLog(entry) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function applyDecay(s) {
  const t = today();
  if (s.lastDay === t) return false;
  s.full = Math.max(0, s.full - DECAY_FULL);
  s.mood = Math.max(0, s.mood - DECAY_MOOD);
  s.lastDay = t;
  s.daily = {};
  return true;
}

function levelUp(s) {
  while (s.exp >= EXP_PER_LEVEL) {
    s.exp -= EXP_PER_LEVEL;
    s.level += 1;
    s.mood = Math.min(MAX_STAT, s.mood + 10);
  }
}

function face(s) {
  const avg = (s.full + s.mood) / 2;
  if (avg >= 80) return '😸';
  if (avg >= 60) return '😺';
  if (avg >= 40) return '😼';
  if (avg >= 20) return '😾';
  return '😿';
}

function bar(n) {
  const filled = Math.round(n / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function statusLine(s) {
  return `${face(s)} ${s.name} Lv${s.level} · 饱食 ${s.full} ${bar(s.full)} · 心情 ${s.mood} ${bar(s.mood)} · 累计被摸 ${s.totalPats} 次、喂 ${s.totalFeeds} 次`;
}

function readLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs
    .readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function cmdStatus() {
  const s = load();
  if (applyDecay(s)) save(s);
  console.log(statusLine(s));
  const todayLogs = readLogs().filter((l) => l.day === today());
  const patters = new Set(todayLogs.filter((l) => l.action === 'pat').map((l) => l.user));
  const feeders = new Set(todayLogs.filter((l) => l.action === 'feed').map((l) => l.user));
  const studyMin = todayLogs
    .filter((l) => l.action === 'study')
    .reduce((sum, l) => sum + (l.minutes || 0), 0);
  console.log(`今天：${patters.size} 个人摸过，${feeders.size} 个人喂过，群里累计专注 ${studyMin} 分钟。`);
}

function act(kind, user, name) {
  if (!user) {
    console.error('缺少 --user');
    process.exit(1);
  }
  const s = load();
  if (applyDecay(s)) save(s);

  const t = today();
  s.daily[t] ??= {};
  s.daily[t][user] ??= { pat: false, feed: false };
  const mine = s.daily[t][user];
  const label = name || user.slice(0, 6);

  if (kind === 'pat') {
    if (mine.pat) {
      save(s);
      console.log(`「${label}」今天已经摸过了，${s.name}说别薅了。`);
      return;
    }
    mine.pat = true;
    s.mood = Math.min(MAX_STAT, s.mood + PAT_MOOD);
    s.exp += PAT_EXP;
    s.totalPats += 1;
    appendLog({ ts: Date.now(), day: t, user, name: label, action: 'pat' });
  } else {
    if (mine.feed) {
      save(s);
      console.log(`「${label}」今天已经喂过了，${s.name}吃不下了。`);
      return;
    }
    mine.feed = true;
    s.full = Math.min(MAX_STAT, s.full + FEED_FULL);
    s.exp += FEED_EXP;
    s.totalFeeds += 1;
    appendLog({ ts: Date.now(), day: t, user, name: label, action: 'feed' });
  }

  levelUp(s);
  save(s);
  const verb = kind === 'pat' ? '摸了摸' : '喂了喂';
  console.log(`${label} ${verb}${s.name}：${face(s)} Lv${s.level} · 饱食 ${s.full} · 心情 ${s.mood}`);
}

function cmdStudy(user, name, minutes) {
  if (!user) {
    console.error('缺少 --user');
    process.exit(1);
  }
  const min = Number(minutes);
  if (!Number.isFinite(min) || min <= 0) {
    console.error('--minutes 要给正数');
    process.exit(1);
  }
  const s = load();
  if (applyDecay(s)) save(s);

  const t = today();
  s.daily[t] ??= {};
  s.daily[t][user] ??= { pat: false, feed: false, study: 0 };
  const mine = s.daily[t][user];
  mine.study ??= 0;

  const room = Math.max(0, STUDY_DAILY_CAP - mine.study);
  const counted = Math.min(min, room);
  const label = name || user.slice(0, 6);
  if (counted <= 0) {
    save(s);
    console.log(`${label}今天已经记满 ${STUDY_DAILY_CAP} 分钟专注了，再多不算数。`);
    return;
  }

  mine.study += counted;
  const exp = Math.round(counted * STUDY_EXP_PER_MIN);
  s.exp += exp;
  s.mood = Math.min(MAX_STAT, s.mood + Math.max(1, Math.round(counted / 30)));
  appendLog({
    ts: Date.now(),
    day: t,
    user,
    name: label,
    action: 'study',
    minutes: counted,
    exp,
  });
  levelUp(s);
  save(s);

  const extra =
    counted < min ? `（超出的 ${min - counted} 分钟今天不计）` : '';
  console.log(
    `${label}专注 ${counted} 分钟，${s.name}涨了 ${exp} 点经验：${face(s)} Lv${s.level} · 经验 ${s.exp}/${EXP_PER_LEVEL} · 心情 ${s.mood}${extra}`,
  );
}

function cmdTop() {
  const logs = readLogs();
  const byUser = new Map();
  for (const l of logs) {
    if (!l.user) continue;
    const cur = byUser.get(l.user) ?? { name: l.name || l.user.slice(0, 6), pat: 0, feed: 0 };
    if (l.action === 'pat') cur.pat += 1;
    if (l.action === 'feed') cur.feed += 1;
    byUser.set(l.user, cur);
  }
  const rows = [...byUser.values()]
    .sort((a, b) => b.pat + b.feed - (a.pat + a.feed))
    .slice(0, 5);
  if (!rows.length) {
    console.log('还没人摸过它。');
    return;
  }
  console.log('摸得最多的：');
  for (const r of rows) console.log(`- ${r.name}：摸 ${r.pat} 次，喂 ${r.feed} 次`);
}

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i]?.startsWith('--')) args[rest[i].slice(2)] = rest[i + 1];
}

switch (cmd) {
  case 'status':
    cmdStatus();
    break;
  case 'pat':
  case 'feed':
    act(cmd, args.user, args.name);
    break;
  case 'study':
    cmdStudy(args.user, args.name, args.minutes);
    break;
  case 'tick': {
    const s = load();
    if (applyDecay(s)) {
      save(s);
      console.log(`过了一天，${s.name}饿了：饱食 ${s.full}，心情 ${s.mood}`);
    } else {
      console.log('还没过点，不用喂。');
    }
    break;
  }
  case 'top':
    cmdTop();
    break;
  default:
    console.log(
      '用法: status | pat --user <openid> --name <昵称> | feed --user <openid> --name <昵称> | study --user <openid> --name <昵称> --minutes <分钟> | tick | top',
    );
}
