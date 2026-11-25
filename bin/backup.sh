#!/bin/sh
# 备份学习助手数据和 DSH 配置到手机存储
R=/root/学习助手
DEST=/sdcard/Download/DSH-Go/学习助手备份
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST/$TS"
tar czf "$DEST/$TS/xuexi.tar.gz" -C /root 学习助手 2>/dev/null || true
cp /root/.dsh/AGENTS.md "$DEST/$TS/AGENTS.md" 2>/dev/null || true
cp /root/.dsh/profiles/web/package.json "$DEST/$TS/package.json" 2>/dev/null || true
cp /root/.dsh/profiles/web/cordis.patch.yml "$DEST/$TS/cordis.patch.yml" 2>/dev/null || true
cp -r /root/.dsh/dsh-go/plugins/local-xuexi "$DEST/$TS/" 2>/dev/null || true
# 只留最近 10 份
ls -1dt "$DEST"/*/ 2>/dev/null | tail -n +11 | while read -r d; do rm -rf "$d"; done
echo "备份完成: $DEST/$TS"
