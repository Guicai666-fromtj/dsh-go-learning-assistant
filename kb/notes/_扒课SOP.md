# B站扒网课 SOP（2026-11-25）

目标：把一数等 UP 的网课扒成「能用、可溯源、可检索」的知识笔记，入 DeepTutor「数学笔记」。
DeepTutor 是香港大学 HKUDS 的开源项目（https://github.com/HKUDS/DeepTutor，文档 https://docs.deeptutor.info/zh-cn/），**本包不自带**，要自己装并配 embedding；只看笔记不建库的话可以跳过第 6 节。安装见 `AGENTS.md` §8.0。

## 0. 工具位置
- bili-watch 插件：App 里启用后，工具名 `bili_watch`；需要跑它的 node 命令时，目录在 `$DSH_HOME/profiles/web/node_modules/dsh-bili-watch/`（下面命令都是在那个目录里 `node tools/look.mjs <cmd>`）
- SenseVoice 转写：本包 `bin/asr-sensevoice.py`；Python 用系统 `python3` 或 `$DSH_PYTHON`（`/opt/python/bin/python` 是常见位置），App 自带模型、离线，约 4–5 倍实时
- yt-dlp：`pip install yt-dlp`，装完在 PATH 里就能被脚本找到（脚本还会试 `/opt/python/bin/yt-dlp`）
- 模型：`$DSH_HOME/speech-to-text/sensevoice/models/sensevoice-onnx/`（model.int8.onnx + tokens.txt，启用 App「语音输入」后自动下）
- 成品：本包 `kb/notes/`（相对路径，`pwd` 核对在项目根）

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

## 6. 入库（需要先装好 DeepTutor，见 AGENTS.md §8.0）

1. 确认 DeepTutor 装好且在跑：`deeptutor --version`、`deeptutor doctor`（不在 PATH 就先 `python -m deeptutor`，还不行回去装）
2. 找到数据目录：默认 `~/deeptutor`，`DEEPTUTOR_HOME` 或 `deeptutor init` 时改过就以那个为准；不确定就问用户或 `deeptutor --help`
3. 入库（**必须先 cd 到数据目录**，deeptutor 认当前目录）：
   ```sh
   cd <DeepTutor 数据目录>
   deeptutor kb add 数学笔记 -d 笔记1.md -d 笔记2.md   # 一个文件一个 -d，不能当位置参数
   deeptutor kb search 数学笔记 "关键词"                # 验收能检索
   ```
4. 更新 `kb/formulas/math.md` 等索引文件；记流水 `node bin/mem.mjs add`

## 坑（血泪）

- `deeptutor` 认当前目录：不在数据目录跑会另建空库
- 没配 embedding / 后端没起 → kb add 报 `Cannot reach embedding API`：回 §8.0 配，别硬跑
- 手机重启后 DeepTutor 不会自己起，先 `deeptutor start` 再入库
- 字幕错误：建系→间隙、θ→C塔、焦点→交点、k₁k₂=−1 丢负号、aₙ→AN
- bili-watch 的 whisper 环境已删（2026-11-25），别再用 `look.mjs asr`
