# 记忆 3.0（四柜 + 看板 + 注入）

给学生的学习助手用的跨会话记忆。2026-11-12 上线，替代「memory.md 当档案」的旧做法。

## 结构

| 柜 | 文件 | 谁写 | 说明 |
|---|---|---|---|
| 原始数据 | `data/*.jsonl`、`kb/*` | 各业务脚本 | 成绩、身体、错题、背默，可现算的不进记忆 |
| 流水 | `mem/stream.jsonl` | `mem.mjs add`、记忆钩子 | 只追加，一条一句话，≤200 字/3 句 |
| 决议 | `mem/facts.json`、`mem/threads.json` | `memcore.mjs fact-set/thread-add` | 决定、规矩、欠账；不物理删，作废用 `fact-rm`/`thread-close` |
| 看板 | `mem/index.md` | `memcore.mjs index` | 核心决议+进行中+近三天+欠账，≤2000 字，自动注入上下文 |

日报：`mem/daily/YYYY-MM-DD.md`（`mem.mjs merge --all` 生成），索引在 `mem/daily/index.md`。
`memory.md` 退役为路标；旧档 `mem/archive/`。

## 命令

```bash
node bin/memcore.mjs index                      # 重建看板
node bin/memcore.mjs check                      # 自检（有阻断 exit 1）
node bin/memcore.mjs fact-set --key 规矩.x --value "…" [--core]
node bin/memcore.mjs fact-rm --key 规矩.x        # 作废（不删）
node bin/memcore.mjs thread-add --text "…" [--due 2026-11-14]
node bin/memcore.mjs recall "整句话" --sem        # 关键词优先，语义兜底
node bin/mem.mjs add --src app --kind note --text "一句话"
```

## 防线

- `check` 10 条：看板出现手写日期章节、近 7 天有流水没日报、核心超预算、缺来源、supersededBy 失效、看板比决议旧、备份超 24 小时、日报过短/过长、进行中超过 4 小时。
- 看板自动注入：插件 `local-memhook` 的 `agent/pre-step`，按内容指纹去重、5 分钟间隔、上限 1200 字，消息带水印「非用户输入」。
- 语义检索默认不跑：模型 98MB、峰值内存 420MB，实测 20 条查询只比关键词多命中 1 条；用 `--sem` 显式触发，失败自动降级关键词。

## 回滚

`node bin/memcore.mjs` 不删数据；要回滚旧档案见 `mem/archive/memory-2026-11-12.md`，整套备份在 `/sdcard/Download/DSH-Go/学习助手备份/`。
