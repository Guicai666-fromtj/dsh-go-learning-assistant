#!/bin/sh
# 回滚：sh rollback.sh <备份目录>
# 会覆盖 /root/学习助手 和 AGENTS.md、profile 的 package.json / cordis.patch.yml
set -e
B="$1"
if [ -z "$B" ] || [ ! -d "$B" ]; then
  echo "用法: sh rollback.sh /sdcard/Download/DSH-Go/学习助手备份/<时间戳>"
  exit 2
fi
echo "要回滚到: $B"
echo "回滚前会再备份一次当前状态。"
sh /root/学习助手/bin/backup.sh
rm -rf /root/学习助手
tar xzf "$B/xuexi.tar.gz" -C /root
[ -f "$B/AGENTS.md" ] && cp "$B/AGENTS.md" /root/.dsh/AGENTS.md
[ -f "$B/package.json" ] && cp "$B/package.json" /root/.dsh/profiles/web/package.json
[ -f "$B/cordis.patch.yml" ] && cp "$B/cordis.patch.yml" /root/.dsh/profiles/web/cordis.patch.yml
echo "回滚完成。需要去 App「引擎」页重启引擎生效。"
