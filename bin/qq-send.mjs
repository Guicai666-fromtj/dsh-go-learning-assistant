#!/usr/bin/env node
/**
 * qq-send.mjs — 主动给学生发 QQ 消息（不依赖当前对话是否活跃）
 *
 * 用法:
 *   node qq-send.mjs "内容"
 *   node qq-send.mjs "内容" --group <group_openid>
 *   node qq-send.mjs --file /path/to/text.md
 *
 * 依赖 Node 18+ 内置 fetch。token 只有 ~143 秒，所以每次现取。
 */
import fs from 'node:fs';

const CFG_PATH = '/root/学习助手/config.json';
const LOG = '/root/学习助手/logs/qq-send.log';

const args = process.argv.slice(2);
let text = '';
let group = '';
let file = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--group') group = args[++i] || '';
  else if (args[i] === '--file') file = args[++i] || '';
  else if (!text) text = args[i];
}
if (file) text = fs.readFileSync(file, 'utf8');
if (!text) {
  console.error('用法: node qq-send.mjs "内容" [--group openid] [--file path]');
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const qq = cfg.qq || {};
const target = group || qq.groupOpenid || '';
const openid = group ? group : qq.c2cOpenid;

function log(line) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

async function token() {
  const r = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: qq.appId, clientSecret: qq.appSecret }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('取 token 失败: ' + JSON.stringify(j));
  return j.access_token;
}

async function main() {
  const t = await token();
  const url = group
    ? `https://api.sgroup.qq.com/v2/groups/${openid}/messages`
    : `https://api.sgroup.qq.com/v2/users/${openid}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `QQBot ${t}`,
    },
    body: JSON.stringify({ content: text, msg_type: 0 }),
  });
  const body = await r.text();
  if (r.status !== 200) {
    log(`FAIL ${group ? 'group' : 'c2c'} status=${r.status} ${body.slice(0, 300)}`);
    console.error(`发送失败 status=${r.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }
  log(`OK ${group ? 'group' : 'c2c'} ${text.slice(0, 40)}`);
  console.log('已发送');
}

main().catch((e) => {
  log('ERR ' + e.message);
  console.error(e.message);
  process.exit(1);
});
