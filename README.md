# 学习助手（dsh-go）

给高中生用的手机 AI 学习助手：**记忆四柜 + 错题闭环 + 学习监督 + B站网课扒知识点 → 知识库**。
跑在 [dsh-go](https://github.com/) 手机 App 的 Ubuntu 环境里，一个目录、一堆 Node 脚本，不依赖数据库。

## 它有什么

| 模块 | 命令 | 干什么 |
|---|---|---|
| 记忆 | `bin/mem.mjs`、`bin/memcore.mjs` | 流水/事实/欠账/看板，跨会话记得住 |
| 错题 | `bin/tutor.mjs` | 录题、归因、1/3/7 天阶梯复习、薄弱点表、出同类题 |
| 监督 | `bin/supervise.mjs`、`bin/timer.mjs` | 开一场学习、报进度、抽查、收工对账 |
| 提醒 | `bin/notify.mjs`、`bin/nudge.mjs`、`bin/jobs.mjs` | 主动消息闸门、频控、任务队列 |
| 考前 | `bin/paper.mjs`、`bin/exams.mjs` | 复习包、天津真题库 |
| 背默 | `bin/recite.mjs` | 单词/古诗文/方程式间隔重复 |
| 桌宠 | `bin/pet.mjs` | 小灭：状态跟真实学习数据走 |
| **扒网课** | `bin/asr-sensevoice.py` + `kb/notes/_扒课SOP.md` | 字幕优先，无字幕用本机 SenseVoice 转写，抽帧看板书，写成笔记入 DeepTutor |

## 快速开始

```sh
git clone <本仓库> /root/学习助手
cd /root/学习助手
sh install.sh
```

然后按 `AGENTS.md` 的「第一次安装」：填 `config.json`、`state.json`，在 App 里启用 **语音输入**（SenseVoice）和 **bili-watch** 插件，跑自检。

更完整的说明在 **[AGENTS.md](AGENTS.md)**：给 agent 看的操作手册，含每个脚本的用法、B站扒课全流程、常见坑。

不会敲命令的：直接下载仓库里的 `dshgo-study-assistant-20261125.zip`，发给 dsh-go，跟它说「把这个学习助手装上，读 AGENTS.md，按它带我上手」。

## 更新说明

### 2026-11-25 · 开源版 v1（第一个公开版）

**新增：B 站扒网课 → 笔记 → 知识库**

- 有字幕直接取官方字幕；没字幕用 App 自带的 **SenseVoice 本机离线转写**（`bin/asr-sensevoice.py`，无需云端 ASR）。
- 板书 / 公式 / 角标看不清就抽帧看图，印刷体可再 OCR 交叉核对。
- 按 `kb/notes/_规范.md` 写成笔记，`deeptutor kb add` 入库做 RAG；全流程见 `kb/notes/_扒课SOP.md`，成体系的技能说明在 `skills/bili-course-notes/SKILL.md`。
- 重点处理字幕硬伤：θ→C塔、焦点→交点、下标丢失、负号被吞、数字错位，一律按数学常识还原，还原不了标「不确定」。

**新增脚本**

- `chat-watch.mjs` / `chat-match.mjs`：QQ 聊天监听与匹配（可选）
- `phone.mjs`：手机前台/操控辅助
- `render-summary-map.py`：复盘图渲染
- `backup.sh` / `rollback.sh`：备份与回滚

**没带的**：模型余额看门狗（`balance-watch`）、群桌宠（`group-pet`）——只服务特定部署，不进通用包。

**去掉旧的 `bili.mjs` / `dt.mjs` / `embed_server.py`**

扒课改走 `dsh-bili-watch` 插件（工具名 `bili_watch`）；笔记入库改走 DeepTutor 自带 CLI，不再自带嵌入服务脚本，少一个常驻进程。

**开源化**

- 清掉全部个人数据（聊天原文、成绩、错题、健康记录、看板、QQ 凭据），`data/`、`mem/`、`kb/*.jsonl` 全进 `.gitignore`，只留 `templates/` 空模板。
- `install.sh` 只补缺、不覆盖已有数据：升级时重跑即可，脚本和笔记规范会被更新，数据不动。
- `AGENTS.md` 重写为完整手册（安装、数据目录、记忆四柜、错题 1/3/7、监督抽查、消息队列、真题复习包、扒课八步、常见坑）；新增 `docs/memcore.md`、`人格提示词.md` 模板。

**从旧版升级（v3.1 安装包 / 已装 `/root/学习助手`）**

把新包放到别处再装进去，别原地 clone 覆盖：

```sh
git clone <本仓库> /tmp/学习助手-新      # 或解压 zip
cd /tmp/学习助手-新
sh install.sh /root/学习助手            # 只覆盖 bin/、docs/、笔记规范，补缺模板，数据不动
```

数据格式向后兼容；升级后跑一次 `node bin/state.mjs show && node bin/tutor.mjs validate` 自检。

## 扒网课需要什么

- `dsh-bili-watch` 插件：取视频信息、字幕、抽帧
- **SenseVoice** + `sherpa-onnx`：本机离线语音转写（模型来自 dsh-go App 的「语音输入」插件，约 231MB，随 App 下载，不用另外找模型）
- `yt-dlp` + `ffmpeg`：下音频、转码
- 可选 `rapidocr_onnxruntime`：PPT/印刷体 OCR
- DeepTutor：笔记入库做 RAG（可选）

没有系统级 ASR 也能干活：新版视频优先用官方字幕，老视频才转写；转写数字/下标会错，必须按数学还原，板书看不清就抽帧看图。

## 隐私

本仓库**不含任何个人数据**：聊天原文、成绩、错题、健康记录、看板、QQ 凭据全部剔除。`data/`、`mem/`、`kb/*.jsonl` 在 `.gitignore` 里，自己用的时候才产生。上传前可跑 `git status --ignored --short` 再确认。

## 目录

```
AGENTS.md            给 agent 的手册（先读）
人格提示词.md         人设模板，装配进系统提示词
install.sh           安装：建目录、放空模板，不覆盖已有数据
bin/                 全部脚本（Node 标准库 + Python）
kb/notes/            笔记规范 _规范.md、扒课流程 _扒课SOP.md
kb/formulas/         公式卡
skills/bili-course-notes/  扒课技能（SKILL.md）
templates/           空数据/配置模板
docs/                记忆系统设计说明
```

## 许可

自用项目，未定许可证；要开源自己加一个。
