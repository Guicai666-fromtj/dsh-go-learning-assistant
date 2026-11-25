#!/usr/bin/env python3
"""qq-read.py — 读 QQ 群最近消息（从本机 qqbot 会话记录里解压提取）

用法:
  python3 bin/qq-read.py            # 主群最近 20 条
  python3 bin/qq-read.py -n 50      # 最近 50 条
  python3 bin/qq-read.py --json     # 机器可读

限制: 只能读"本机 qqbot 机器人收到的"消息；另一个机器人的发言通常收不到。
"""
import argparse
import glob
import json
import os
import re
import sys
import time

try:
    import zstandard
except ImportError:  # pragma: no cover
    sys.exit('缺 zstandard: pip install zstandard')

BASE = '/root/.dsh/sessions/--root-.dsh-qqbot-workspace--'
MAIN_GID = '4B379F734151F4AF694EDA99CC210D83'
LINE_RE = re.compile(r'^\[(?P<name>[^\]]+?)\s*\((?P<id>[0-9A-Fa-f]{8,})\)\]\s*(?P<body>.*)$')


def read_session(path):
    with open(path, 'rb') as fh:
        raw = zstandard.ZstdDecompressor().stream_reader(fh).read()
    return raw.decode('utf8', 'replace')


def extract(path, gid):
    """返回 [(ts_ms, name, uid, text), ...]"""
    raw = read_session(path)
    if gid and gid not in raw:
        return []
    out = []
    for ln in raw.splitlines():
        if not ln.startswith('{'):
            continue
        try:
            ev = json.loads(ln)
        except Exception:
            continue
        if ev.get('type') not in ('user/message', 'agent/inbox/spliced'):
            continue
        data = ev.get('data') or {}
        texts = []
        if ev['type'] == 'user/message':
            for c in data.get('content') or []:
                if c.get('type') == 'text':
                    texts.append(c.get('text') or '')
        else:
            for ins in data.get('inserted') or []:
                for c in ins.get('content') or []:
                    if c.get('type') == 'text':
                        texts.append(c.get('text') or '')
        for txt in texts:
            body = txt.split('[Current message]')[-1] if '[Current message]' in txt else txt
            cur = None
            for line in body.splitlines():
                m = LINE_RE.match(line.strip())
                if m:
                    if cur:
                        out.append(cur)
                    cur = (ev.get('time', 0), m.group('name'), m.group('id'), m.group('body'))
                elif cur is not None and line.strip():
                    ts, name, uid, b = cur
                    cur = (ts, name, uid, (b + ' ' + line.strip()).strip())
            if cur:
                out.append(cur)
    # 去重（同一时间同一句）
    seen = set()
    uniq = []
    for ts, name, uid, b in out:
        key = (ts, name, b[:60])
        if key in seen:
            continue
        seen.add(key)
        uniq.append((ts, name, uid, b))
    uniq.sort(key=lambda x: x[0])
    return uniq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-n', type=int, default=20)
    ap.add_argument('--group', default=MAIN_GID)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    files = glob.glob(os.path.join(BASE, '*', 'session.v4.jsonl.zstd'))
    if not files:
        sys.exit('没找到 qqbot 会话记录')
    files.sort(key=os.path.getmtime, reverse=True)

    rows = []
    for f in files[:8]:
        try:
            rows.extend(extract(f, args.group))
        except Exception as e:
            print('!', os.path.basename(os.path.dirname(f)), e, file=sys.stderr)
    rows.sort(key=lambda x: x[0])
    # 同一条消息在不同会话里重复，按 (时间, 内容) 去重
    seen = set()
    uniq = []
    for ts, name, uid, b in rows:
        key = (round(ts / 1000), name, b[:80])
        if key in seen:
            continue
        seen.add(key)
        uniq.append((ts, name, uid, b))
    tail = uniq[-args.n:]

    if args.json:
        print(json.dumps([
            {'time': time.strftime('%m-%d %H:%M:%S', time.localtime(ts / 1000)) if ts else '?',
             'name': n, 'uid': u, 'text': b}
            for ts, n, u, b in tail
        ], ensure_ascii=False, indent=2))
        return

    if not tail:
        print('（没读到群消息）')
        return
    for ts, name, uid, b in tail:
        t = time.strftime('%m-%d %H:%M', time.localtime(ts / 1000)) if ts else '--'
        print(f'{t} {name}: {b}')


if __name__ == '__main__':
    main()
