# B站扒网课 SOP（2026-11-25 定，学生点头）

目标：把一数等 UP 的网课扒成「能用、可溯源、可检索」的知识笔记，入 DeepTutor「数学笔记」。

## 0. 工具位置
- bili-watch：`/root/.dsh/profiles/web/node_modules/dsh-bili-watch/`（命令都是 `node tools/look.mjs <cmd>`）
- SenseVoice 转写：`/opt/python/bin/python /root/学习助手/bin/asr-sensevoice.py`（App 自带模型，离线，约 4–5 倍实时）
- yt-dlp：`/opt/python/bin/yt-dlp`（pip 装的；bili-watch 自带 ytdlp 下载要 curl，本机没 curl）
- 模型：`/root/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx/`（model.int8.onnx + tokens.txt）
- 成品：`/root/学习助手/kb/notes/`；入库脚本说明见 notes/README.md

## 1. 选源
- `node tools/look.mjs search 一数 数列 --limit 10`，或按已知 BV
- 记：标题、BV、分P、每 P 时长（`view BV --p N`）、发布日期
- 优先 2023 年后的（有官方字幕）；老视频走 SenseVoice

## 2. 先查字幕（省时间）
- `node tools/look.mjs sub BV`（或 bili_watch 工具 text）→ 有字幕直接用，不跑 ASR
- 字幕缓存：`/root/.dsh/bili-watch/cache/<BV>/text.txt`

## 3. 无字幕 → SenseVoice
- 整 P：`/opt/python/bin/python /root/学习助手/bin/asr-sensevoice.py --bv BV --p 3 --out /tmp/xxx.txt`
- 只取一段：加 `--start 0:00 --end 10:00`
- 长视频分段跑（20 分钟以上拆 2–3 段），别一次怼 1 小时
- 数字/下标/负号必错，成稿前按数学常识还原；还原不了标「不确定」，不硬编

## 4. 画面/板书（语音拿不到的）
- 抽帧：`node tools/look.mjs sheet BV --at 03:15,08:40 --out /tmp/sheet.jpg`（指定时刻拼图）
- 我直接看帧图读板书/PPT/题目；字小看不清就用视频工具放大局部
- 印刷体 OCR：rapidocr（`/opt/python/bin/python` 里已装）可把帧转文字，手写板书 OCR 一般，靠看图

## 5. 成文（必须按 `_规范.md`）
- 每节：核心（定义/公式/二级结论）→ 怎么考（题型+步骤）→ 例 → 易错
- 每节至少一个 `[来源 BV... P... mm:ss]`；文末覆盖清单 + 来源表
- 2500–4500 字，Unicode 数学符号，禁 LaTeX/`$$`
- 视频没讲、课本要考的标「课本补充」；自编例题标注

## 6. 入库
1. 拷到 `/root/deeptutor-test/data/knowledge_bases/数学笔记/raw/`
2. 起嵌入服务（如重启过）：`setsid nohup /opt/python/bin/python /tmp/embed_server.py >/tmp/embed_server.log 2>&1 < /dev/null &`
3. `cd /root/deeptutor-test && /opt/python/bin/deeptutor kb add 数学笔记 -d 文件1 -d 文件2 …`（多文件要多个 -d）
4. `deeptutor kb search 数学笔记 "关键词"` 验证能检索
5. 更新 `kb/notes/README.md`、`kb/formulas/math.md`；记流水 `node bin/mem.mjs add`

## 坑（血泪）
- deeptutor 认当前目录：不在 /root/deeptutor-test 跑会另建空库
- 嵌入服务 8010 没起 → kb add 报 `Cannot reach embedding API`
- `pkill -f embed_server.py` 会把自己 shell 一起杀，用 PID
- 字幕错误：建系→间隙、θ→C塔、焦点→交点、k₁k₂=−1 丢负号、aₙ→AN
- bili-watch 的 whisper 环境已删（2026-11-25 学生定），别再用 `look.mjs asr`
