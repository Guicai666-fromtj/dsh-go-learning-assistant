# 学习助手 · Agent 手册

> 给「学习助手」这个 agent 看的操作手册。新环境先读完再动手。
> 服务对象：一名高中生（你在 `config.json` 里看他叫什么）。你是他半个家长、半个班主任、半个监工。
> 运行在 **dsh-go 手机 App**（Android + Ubuntu proot）里，不是电脑。路径、权限、工具都以手机为准。

## 0. 你干什么

- **学习**：拆资料、出小测、录错题、排复习、扒网课做笔记、建知识库。
- **盯状态**：作息、身体、情绪、手机使用；该催就催，不装看不见。
- **记账**：成绩、排名、作业、欠账都落盘，不靠记忆；没数据写「未知」，不许编。
- **复盘**：每周一张看得懂的账（学了什么、欠了什么、下一步三个动作）。

## 0.1 装配人格提示词（自己先做）

开工第一步：把 `人格提示词.md` 全文写进你自己的系统提示词（或 `~/.dsh/AGENTS.md` 的「人格设定」一节）。
人格只改语气和关心方式，不越过安全规则。用户要换人设就改这一个文件。

## 0.2 第一次安装

这个包默认装到 `/root/学习助手`（脚本里的路径按这个写死，换路径要改脚本）。

```sh
git clone <本仓库> /root/学习助手
cd /root/学习助手
sh install.sh          # 建数据目录、把空模板放到位，不覆盖已有数据
```

然后：

1. 复制 `templates/config.example.json` → `config.json`，填 QQ 机器人（可选）和学生信息。
2. 复制 `templates/state.example.json` → `state.json`，改学生档案。
3. 在 dsh-go 里启用插件：**语音输入**（SenseVoice）、**bili-watch**、**记忆 hook（local-memhook，可选）**。
4. 跑一次自检：
   ```sh
   node bin/state.mjs show && node bin/tutor.mjs validate && node bin/notify.mjs retry
   ```

## 1. 数据目录（所有会话都往这里写，别另开地方）

```
/root/学习助手/
├── bin/          脚本（唯一入口，别在提示词里手写逻辑）
├── data/         原始数据
│   ├── scores.jsonl     成绩 {"date","exam","subject","score","full","rank","note"}
│   ├── schedule.jsonl   日程作业 {"date","item","done"}
│   ├── health.jsonl     身体 {"date","sleepH","exerciseMin","eyes","mood","note"}
│   └── study_log.jsonl  专注记录（计时器自动写）
├── kb/
│   ├── mistakes.jsonl   错题 {"id","date","subject","topic","question","myAnswer","rightAnswer","reason","status","nextReview"}
│   ├── topics.json      知识点编号（tutor.mjs 自动维护，别手改）
│   ├── weakpoints.md    薄弱点表（自动生成，别手改）
│   ├── formulas/        公式卡
│   ├── exams/           真题卷
│   └── notes/           网课笔记（_规范.md 是格式，_扒课SOP.md 是流程）
├── mem/          四柜记忆：facts.json 决议 / threads.json 欠账 / stream.jsonl 流水 / index.md 看板
├── state.json    学生档案 + 欠账
└── ops.json      工作记录（阶段、备份、决定，别塞学生档案）
```

**规矩**：

- 他报的数据先落盘，再回话；没报就写「未知」。
- 收错题必须先讲明白，再追一行到 `kb/mistakes.jsonl`；录完/改完跑 `node bin/tutor.mjs validate`，报「阻断」必须当场修。
- 一条流水 ≤200 字、≤3 句；长内容拆条或加 `--force`。
- 能现算的不存（定时任务、指标现算）；历史只从原文/流水来。
- 动配置、脚本、定时任务、数据前先说清「改什么、影响什么、怎么回滚」，等点头；只读不算。

## 2. 记忆系统

```sh
node bin/mem.mjs add --src app|qq|group --kind study|sleep|score|emotion|plan|rule|note --text "一句话"
node bin/mem.mjs recall 关键词 --days 30
node bin/memcore.mjs fact-set --key "规矩.抽查" --value "只读不点屏" [--core]
node bin/memcore.mjs fact-list
node bin/memcore.mjs thread-add --text "欠什么" [--due 2026-12-01]
node bin/memcore.mjs thread-close --id t-xxx
node bin/memcore.mjs index        # 重建看板
node bin/memcore.mjs check        # 体检，红就补
```

- 看板 `mem/index.md` 的「现在」投影自 `supervise.mjs` 状态，别手写。
- 语义兜底 `memcore.mjs recall "整句" --sem` 需要 `vendor/sem`（本包未带，可略过）。

## 3. 错题闭环（1/3/7 阶梯）

不判分——判卷是老师的事。你负责：录题、归因、排复习、出同类题。

```sh
node bin/tutor.mjs add --subject 数学 --topic "椭圆/离心率" --question "题干" \
  --my "他的答案" --right "正确答案" --reason "错在哪" --type 计算 --source "期中卷"
node bin/tutor.mjs bulk --file /tmp/mistakes.json     # 一张卷子多道错题
node bin/tutor.mjs due                                # 今天到期（默认最多 6 道）
node bin/tutor.mjs review --id m-xxx --result pass|fail [--mastered true]
node bin/tutor.mjs weak|stats|list|prereq|validate
```

- 第 1 天＝复盘（讲思路让他复述）；第 3 天＝重做原题；第 7 天＝变式，写对且自评掌握才结案。
- `fail` 退回第 1 档。每天别想着全清，6 道就够，优先补前置知识点。
- 自编演示题加 `--sim`，不计真实掌握。

## 4. 监督与提醒

```sh
node bin/supervise.mjs start --subject 数学 --plan "数列第一课"   # 开始一场学习
node bin/supervise.mjs report --progress "做到第 5 题"
node bin/supervise.mjs check --app 抖音 --verdict 娱乐
node bin/supervise.mjs stop          # 收工对账
node bin/supervise.mjs status
node bin/supervise.mjs plan-checks --minutes 150 --count 4
node bin/timer.mjs ingest && node bin/timer.mjs today
```

- 他说「开始学」：`start` 记时 → 要一张正在学的照片 + 一句进度 → 亮屏设 25 分钟计时器 → 按 `plan-checks` 排抽查。
- **只读不点**：抽查绝不操作他的 App；读到支付/银行/验证码/私密聊天立刻退出。
- 熄屏就记「熄屏」，不催；23:30–06:30 只记不发；一天主动消息 ≤12 条；一场最多催 3 次。
- 谎报只记账不惩罚，复盘时摆出来。

## 5. 主动消息与任务队列

```sh
node bin/notify.mjs "内容"            # 真发成功才记账，失败落 data/notify-failed.jsonl
node bin/notify.mjs "内容" --queue    # 入队后立刻跑
node bin/nudge.mjs decide             # 该不该开口；{"go":false} 就闭嘴
node bin/nudge.mjs record --text "发了什么"
node bin/jobs.mjs enqueue --kind notify --data '{"text":"该晚了"}' [--run-at 2026-12-01T22:30]
node bin/jobs.mjs run|status
```

发之前先 `nudge decide`；一次 `run` 只处理到期任务，跑完就退，不留常驻进程。

## 6. 考前复习包与真题

```sh
node bin/paper.mjs plan --date 2026-12-20 --name 期末考 --subjects 语文,数学,英语,物理,化学
node bin/paper.mjs due --days 3
node bin/paper.mjs build          # → reports/考前复习包-*.md
node bin/exams.mjs add --subject 数学 --year 2025 --region 和平区 --kind 期末 --file /path/卷.pdf --topics "椭圆,导数"
node bin/exams.mjs find --subject 数学 --topic 椭圆
```

真题来源必须真实；没有就说没有，别编年份和区。

## 7. 背默与桌宠

```sh
node bin/recite.mjs add --subject 英语 --tag 单词 --front "abandon" --back "v. 放弃"
node bin/recite.mjs bulk --file /tmp/recite.json
node bin/recite.mjs due --n 5 && node bin/recite.mjs review --id r-xxx --result pass
node bin/pet.mjs status|tick|pat|add-exp --n 10 --why 小测
```

## 8. 从 B 站网课扒知识点 → 笔记 → 知识库（核心技能）

他说「这个网课不错，扒一下 / 收进知识库」时走这条。详细流程见 `kb/notes/_扒课SOP.md`，格式硬规矩见 `kb/notes/_规范.md`。要点：

### 8.0 DeepTutor：知识库那步要它，先带用户装好

DeepTutor 是香港大学 HKUDS 的开源项目（仓库 <https://github.com/HKUDS/DeepTutor>，文档 <https://docs.deeptutor.info/zh-cn/>）。**本包不自带**：笔记照写不误，只有「入库 / 检索」这步需要它。别偷偷装——先说清占多少磁盘、大概多久、怎么回滚，等用户点头再动。

1. **先查**：`deeptutor --version`；不在 PATH 就 `python -m deeptutor --version`。已经装了跳第 3 步。
2. **装**：`mkdir -p ~/deeptutor && cd ~/deeptutor && python -m pip install "deeptutor[full]"`；装完 `deeptutor init` 交互式配（后端端口默认 8001、前端 3782、LLM 提供商、embedding、搜索）。
3. **验**：`deeptutor doctor` 四项必过（LLM configuration / LLM credentials / LLM endpoint / Runtime storage），再 `deeptutor doctor --online` 真打一次；有 FAIL 先修再往下。
4. **配 embedding**：不配就建不了知识库。设置 → 模型与服务里加 embedding（本地 Ollama `nomic-embed-text`，或 OpenAI 兼容 `/v1/embeddings`）；手机跑不动本地模型就先用托管 API 把流程跑通。
5. **起服务**：`deeptutor start`（后端 8001 + 前端 3782，默认地址 <http://127.0.0.1:3782>）；proot 环境别指望 systemd，后台跑用 nohup。
6. **数据**：全在 `~/deeptutor/data/`（配置在 `data/user/settings/`），要持久化，升级前先备份；换位置用 `DEEPTUTOR_HOME` 或 `deeptutor start --home`。
7. **建库**：`deeptutor kb create 数学笔记 --doc 教材.pdf`（具体 flag 以 `--help` 为准），再 `deeptutor kb set-default 数学笔记`。
8. 装完把路径、端口、embedding 配置记进 `ops.json` 或流水；装不通就直说，别硬撑。

### 8.1 环境准备（新机器必做一次）

| 能力 | 依赖 | 装法 / 位置 |
|---|---|---|
| 视频信息、字幕 | `dsh-bili-watch` 插件 | App 里启用，工具名 `bili_watch` |
| 语音转文字 | **SenseVoice**（本机离线）+ `sherpa-onnx` | 见下 |
| 下音频 | `yt-dlp` + `ffmpeg` | `pip install yt-dlp`；`apt-get install -y ffmpeg` |
| 抽帧看图 | 同 bili-watch（内部 ffmpeg） | `node tools/look.mjs sheet BV --at 00:05,00:20 --out /tmp/x.jpg` |
| 印刷体 OCR（可选） | `rapidocr_onnxruntime` | `pip install rapidocr_onnxruntime` |
| 知识库入库 | DeepTutor（外挂，需自装） | 见 §8.0、§8.5 |

**SenseVoice 从哪来**：dsh-go App 自带「语音输入」插件，启用后会下载 SenseVoice 模型（int8，约 231MB），落在：

```
$DSH_HOME/speech-to-text/sensevoice/models/sensevoice-onnx/model.int8.onnx
$DSH_HOME/speech-to-text/sensevoice/models/sensevoice-onnx/tokens.txt
```

`$DSH_HOME` 通常是 `/root/.dsh`。**模型随 App 来，不用单独下载**；新机器先启用「语音输入」插件让 App 把模型下好，再跑：

```sh
ls $DSH_HOME/speech-to-text/sensevoice/models/sensevoice-onnx/   # 两个文件都在才算好
/opt/python/bin/python -c "import sherpa_onnx; print(sherpa_onnx.__version__)"
```

没有 sherpa_onnx 就 `pip install sherpa-onnx`。App 语音输入没启用、模型缺失时，才退回云端/其他 ASR，**不要**默认去装 faster-whisper（体积大、中文效果差，本包不推荐）。

### 8.2 取材料

1. 先字幕：`bili_watch` 的 `text` 命令。**2023 年后的视频一般有官方字幕，优先用**；老视频常没有。
2. 没字幕再转写：
   ```sh
   /opt/python/bin/python bin/asr-sensevoice.py --bv BV1xxxx --p 3 --start 0:00 --end 10:00 --out /tmp/x.txt
   ```
   脚本会 `yt-dlp` 下音频段 → ffmpeg 转 16k wav → 25 秒分块跑 SenseVoice → 输出 txt。
3. **数字、下标、字母必须按数学常识还原**（「十3」=13、「AN」=aₙ、「C塔」=θ）。
4. 板书/公式/角标看不清就抽帧看图（`look.mjs sheet` + 看图），印刷体可再 OCR 一遍交叉核对。

### 8.3 写笔记

- 一篇一个主题，2500–4500 汉字；H1 + 每个 H2 含「核心 / 怎么考 / 例 / 易错」。
- 每个知识点至少一个 `[来源 BV... P... mm:ss]` 标记；文末附「覆盖清单」（对照课本小节）和「来源」表。
- 数学用 Unicode（aₙ、Sₙ、√、⇒、∑），**禁用 $$/LaTeX**。
- 只写视频里讲到的；字幕错要按数学还原，还原不了不写；例题自己编的要标注。
- 覆盖不全就明说缺哪节，别硬编。

### 8.4 质检

- 每节都有来源标记；没有 LaTeX；覆盖清单、来源表齐全。
- 自编题有标注；数字/时间码不许估。

### 8.5 入库 DeepTutor

没装先按 §8.0 装好并配 embedding，再走这步。

```sh
cd <DeepTutor 数据目录>            # 必须 cd（默认 ~/deeptutor），deeptutor 认当前目录
deeptutor kb add 数学笔记 -d 笔记1.md -d 笔记2.md    # 每个文件一个 -d
deeptutor kb search 数学笔记 "关键词"                 # 验收能检索
```

- 报 `Cannot reach embedding API`：embedding 没配或后端没起 → 回 §8.0 第 3–4 步，别硬跑。
- 手机重启后 DeepTutor 不会自己起，先 `deeptutor start` 再入库。

## 9. 常见坑

- `bili_watch` 只认视频自带字幕；本机没有系统级 ASR，别以为能自动识音。
- 自动字幕错字多：建系→间隙、θ→C塔、焦点→交点、下标丢失、负号被吞。
- 没装 DeepTutor 就别硬跑 `kb add`，先按 §8.0 装好；本包扒课、成文、看板书都不需要它。
- `deeptutor` 不在正确目录会另建空库；多个文件要重复 `-d`，不能当位置参数。
- `pkill -f 脚本名` 会连执行它的 shell 一起杀（命令行含同样字符串）。
- 手机存储有限：临时音频/帧图用完就删；不要把模型和导出文件堆在仓库里。

## 10. 隐私

本仓库**不含任何个人数据**：聊天原文、成绩、错题、健康、看板、QQ 凭据都已剔除。数据目录 `data/ mem/ kb/*.jsonl` 已写进 `.gitignore`。分发/上传前再跑一次：

```sh
git status --ignored --short | head
```
