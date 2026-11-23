# dsh-go 学习助手安装包

一个住在手机里的学习管家：盯人、记账、出题。配合 dsh-go（手机版 DeepSeek Harness）使用。

## 下载

- **`学习助手-安装包-v3.zip`** —— 当前版本（含 2026-11-23 修复，v3.1）

装法：把 zip 发给你的 dsh-go，对它说：

> 把这个学习助手装上，读 AGENT.md，按它带我上手。

装完在 `/root/学习助手`，数据全在手机本地，一行一条纯文本。

## 更新说明

### 2026-11-23 · 修复 v3 里真题库 / 考前复习包启动即崩（v3.1）

**问题**：`bin/exams.mjs` 和 `bin/paper.mjs` 第 7 行写的是

```js
const ROOT = process.env.LEARN_HOME || resolve(__dirname_, '..');;
```

但这两个文件只 import 了 `node:path`，没有 `resolve` 和 `__dirname_` 的定义（ESM 里本来也没有 `__dirname`）。由于 `||` 短路，只要没设 `LEARN_HOME`，脚本一启动就报 `ReferenceError: resolve is not defined`——**真题库（exams）和考前复习包（paper）在 v3 里全部不可用**。原安装自检只跑了 `state.mjs` 和 `tutor.mjs`，扫不到这两个文件，所以一直没被发现。

**修复**：

1. 两个文件第 7 行改成标准写法：`path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`；
2. `install.sh` 自检补上 `exams.mjs`、`paper.mjs`，这类问题以后装的时候就报错；
3. 顺手修了自定义安装目录时，装完提示里的 AGENT.md 路径没跟着变的问题；
4. 重新打包成单层目录结构（旧的 zip 里套了 `root/workspace/...` 前缀）。

**已经装了 v3 的**：不用重装。把 `bin/exams.mjs`、`bin/paper.mjs` 两个文件覆盖到 `/root/学习助手/bin/` 就行；或者在包目录里重跑 `sh install.sh`（只覆盖脚本，不动已有数据）。

**验证**：解压后在包目录执行 `env -u LEARN_HOME node bin/exams.mjs stats`，不再报错即修复。

旧的 `学习助手-安装包-v3 (2).zip` 就是出问题的版本，已删除（git 历史里还能翻到）。

## 包里有什么

- `bin/` 16 个脚本：学习场次监督与抽查、错题 1/3/7 阶梯复习、背默、真题库、考前复习包、记忆四柜、桌宠
- `templates/` 初始数据模板
- `extras/autox/timer.js` AutoX 悬浮计时器
- `docs/` 两篇上手文档（DeepTutor 讲题、AutoX 计时）

详细用法看包里的 `README.md`（给人看）和 `AGENT.md`（给助手看）。
