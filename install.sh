#!/bin/sh
# 安装学习助手：把脚本和空模板放到目标目录，不覆盖已有数据。
# 用法：sh install.sh [目标目录]    默认且推荐 /root/学习助手
# 注意：多数脚本把根路径写死成 /root/学习助手，换目录需改脚本里的 ROOT。
set -e
SRC=$(cd "$(dirname "$0")" && pwd)
TARGET=${1:-/root/学习助手}

if [ "$TARGET" != "/root/学习助手" ]; then
  echo "警告：脚本按 /root/学习助手 写死路径，装到 $TARGET 后多数命令会读不到数据（只改 tutor.mjs 认 TUTOR_ROOT）。" >&2
fi

echo "安装到：$TARGET"
mkdir -p "$TARGET/data"
mkdir -p "$TARGET/kb/mistakes" "$TARGET/kb/exams" "$TARGET/kb/notes" "$TARGET/kb/formulas"
mkdir -p "$TARGET/mem/daily" "$TARGET/mem/archive"
mkdir -p "$TARGET/logs" "$TARGET/reports"

# 脚本：直接覆盖（随仓库更新）
cp -r "$SRC/bin" "$TARGET/"
cp -r "$SRC/docs" "$TARGET/"
# 笔记规范与流程：覆盖（文档，不是数据）
cp "$SRC/kb/notes/_规范.md" "$SRC/kb/notes/_扒课SOP.md" "$TARGET/kb/notes/"
# 公式卡：没有才放
[ -f "$TARGET/kb/formulas/math.md" ] || cp "$SRC/kb/formulas/math.md" "$TARGET/kb/formulas/"

# 数据文件：没有才放空模板
for f in scores schedule health study_log; do
  [ -f "$TARGET/data/$f.jsonl" ] || : > "$TARGET/data/$f.jsonl"
done
[ -f "$TARGET/kb/mistakes.jsonl" ] || : > "$TARGET/kb/mistakes.jsonl"
[ -f "$TARGET/kb/topics.json" ]    || cp "$SRC/templates/kb/topics.json" "$TARGET/kb/"
[ -f "$TARGET/kb/weakpoints.md" ]  || cp "$SRC/templates/kb/weakpoints.md" "$TARGET/kb/"
[ -f "$TARGET/mem/facts.json" ]    || cp "$SRC/templates/mem/facts.json" "$TARGET/mem/"
[ -f "$TARGET/mem/threads.json" ]  || cp "$SRC/templates/mem/threads.json" "$TARGET/mem/"
[ -f "$TARGET/mem/index.md" ]      || cp "$SRC/templates/mem/index.md" "$TARGET/mem/"
for f in stream turns; do
  [ -f "$TARGET/mem/$f.jsonl" ] || : > "$TARGET/mem/$f.jsonl"
done
[ -f "$TARGET/state.json" ]  || cp "$SRC/templates/state.example.json" "$TARGET/state.json"
[ -f "$TARGET/config.json" ] || cp "$SRC/templates/config.example.json" "$TARGET/config.json"

chmod +x "$TARGET/bin/"*.sh "$TARGET/bin/"*.py 2>/dev/null || true

echo
echo "装好了。下一步："
echo "  1) 改 $TARGET/config.json（QQ 机器人可选）和 state.json（学生档案）"
echo "  2) App 里启用：语音输入 / bili-watch / 记忆 hook"
echo "  3) 自检：cd $TARGET && node bin/state.mjs show && node bin/tutor.mjs validate"
