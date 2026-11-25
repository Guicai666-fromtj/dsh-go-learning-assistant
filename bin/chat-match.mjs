// chat-match：记忆钩子的匹配规则（插件和 chat-watch.mjs 共用，别各写一套）
import fs from 'node:fs';
// classify(text) -> 'sleep' | 'score' | 'note' | null
// channelOf(source, session) -> 'app' | 'qq' | 'qqgroup' | null
// groupVerdict(text, source) -> 'self'（学生本人）| 'work'（学习/工作相关）| null（无关，丢）

const RULES = [
  { kind: 'sleep', re: /(我.{0,6}(睡了|上床|躺下|睡觉了|起了|起床了|醒了))|晚安|(^|\s)(睡了|起了|起床了|醒了)[。！!\s]*$/ },
  { kind: 'score', re: /(\d{2,3}\s*分)|((成绩|分数|排名).{0,6}(出|是|有|报|下来|第|多少))|(考了\s*\d+)|满分|及格/ },
  { kind: 'note', re: /(头.{0,3}疼|不舒服|发烧|眼睛.{0,2}(疼|干)|没精神|困死|胃疼|肚子疼|感冒)/ },
];
const ASK = /(几点|多长时间|多久|多少小时|吗|呢|怎么办|咋整|？|\?)/;
const IGNORE = /^(ok|OK|嗯|好|行|可以|收到|？|\?|谢谢|晚安|睡了)$/;

export function clean(text) {
  return String(text || '')
    .replace(/^\[Chat history begins\][^\n]*\n?/, '')
    .replace(/^\[[^\]]{1,40}\]\s*/, '')
    .replace(/<@[^>]+>/g, '')
    .trim();
}

export function classify(text) {
  const t = clean(text);
  if (t.length < 2 || t.length > 300 || IGNORE.test(t)) return null;
  if (ASK.test(t) && /睡|成绩|分数|排名/.test(t)) return null;                 // 问句不算报备
  if (/专注|计时|倒计时|分钟/.test(t) && !/成绩|考了|满分|及格/.test(t)) return null; // “专注25分”不是成绩
  if (/记忆|流水|日报|补录/.test(t)) return null;                              // 元对话不算报备
  if (/等.{0,8}(再|后)(报|说)|还没(出|判)/.test(t)) return null;                // “等考完再报”不算已报
  for (const r of RULES) if (r.re.test(t)) return r.kind;
  return null;
}

// QQ 会话 → 会话键（qqbot:appid:c2c|group:peer），用来区分私聊和群聊
let prefsCache = { mtime: 0, map: new Map() };
export function qqPeerOf(sessionId) {
  try {
    const p = '/root/.dsh-qqbot/model-prefs.json';
    const st = fs.statSync(p);
    if (st.mtimeMs !== prefsCache.mtime) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      prefsCache = { mtime: st.mtimeMs, map: new Map(Object.entries(j.sessionIds || {}).map(([k, v]) => [v, k])) };
    }
    return prefsCache.map.get(sessionId) || null;
  } catch { return null; }
}

export function channelOf(source, session) {
  const kind = source && source.kind;
  if (kind !== 'user') return null;
  if (source.rpcId) return 'app';                    // App / 网页端：user-rpc
  const cwd = String((session && session.header && session.header.cwd) || '');
  if (!cwd.startsWith('/root/.dsh-qqbot')) return null;
  const peer = qqPeerOf(session && session.id);
  if (peer && peer.includes(':group:')) return null;  // 群聊不收：里面是同学，不是学生本人
  return 'qq';
}

// 去重用的归一化：抹掉空白和标点，只比字
export function norm(text) {
  return clean(text).replace(/[\s，。,.!！?？~～、；;：:"'“”‘’()（）]/g, '');
}
