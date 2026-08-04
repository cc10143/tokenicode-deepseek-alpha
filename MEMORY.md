# MEMORY.md

TOKENICODE (Tauri 2 + React + Rust) — Claude Code 桌面 GUI。
forked from mistydew/tokenicode-deepseek-alpha。

创建：2026-08-04

## 2026-08-04 通信可靠性修复（lib.rs）

针对用户报告的"通信中断需按停止重发"和"AskUserQuestion 回答了收不到"两个 bug，修了两处 `src-tauri/src/lib.rs` stdout reader 循环：

1. **permission 事件静默吞错**：`can_use_tool` 的 `let _ = emit_to_frontend(...)` 改为打日志 + 计入 emit_fail_count。原代码 permission 事件 emit 失败无痕丢失（不打日志、不计数），是"AskUserQuestion 收不到"的根因。
2. **reader 不死于短暂抖动**：原"连续 10 次 emit 失败 → reader 线程永久退出"改为"持续失败 60 秒才放弃"（`emit_fail_start: Option<Instant>` 记录首次失败时间）。原逻辑下 IPC 短暂抖动就杀死 reader，CLI 进程还活着但前端收不到任何输出（"通信中断"根因）。恢复时打日志。

**验证**：cargo check 通过，release 构建成功（updater 签名失败是已知问题，不影响 exe）。构建产物 `src-tauri/target/release/tokenicode.exe`。

**背景**：本次修复源于对 cc-gui-electron（Electron 验证原型）的调研——诊断发现 pipe + stream-json 本身工作正常，问题在 Tauri IPC 层的静默吞错和 reader 死亡。node-pty（TTY）与 claude stream-json 不兼容（强制 --print），验证原型最终改回 pipe。

## 2026-08-04 AskUserQuestion 答案格式修复（QuestionCard.tsx）——关键协议坑

**问题**：用户触发 AskUserQuestion，点击卡片选择提交后，claude 回复"用户没有回答问题"（The user did not answer the questions.），答案收不到。

**根因**：AskUserQuestion 的 `answers` 对象，**键必须是问题的文本**（`q.question`），不是索引。TOKENICODE 原代码用 `answers[String(qIdx)]`（索引键 "0"/"1"），claude 解析为空 → 判定"没回答问题"。

**验证方法**（cc-gui-electron/tests/diag-ask-question.mjs）：用真实 claude 触发 AskUserQuestion，测试 5 种键格式：
- 索引键 `{"0": "label"}` ❌ "The user did not answer the questions."
- header 键 ❌ 同上
- 数组值 ❌ 同上
- **question 文本键** `{"你现在最想让我优先处理哪类工作？": "修 bug"}` ✅ claude 复述答案

**官方依据**：Claude Code SDK docs（Handle approvals and user input / Agent SDK user-input）——"Build the answers object as a record where each key is the question text and each value is the selected option's label." 多选值可用数组或 ", " 拼接。

**修复**：`src/components/chat/QuestionCard.tsx` 的 handleConfirm 里 `answers[String(qIdx)]` → `answers[q.question]`（含 Other 分支）。handleSkip 用空 answers（跳过，合理）。

**备注**：此坑同样适用于 cc-gui-electron 的极简 QuestionCard（若未来接入 AskUserQuestion 须用 question 文本键）。

## 2026-08-04 Upstream v1.0.7 同步

从 upstream main fetch 到 `c3deffc` 之后 3 个新 commit：
- `9c3bb65`（v1.0.7，stabilize sessions/models/skills/credentials）→ **cherry-pick**，本地 `61f1244`
- `32b59dc`（watcher 200ms debounce）、`901738f`（home 目录跳过）→ **跳过**，本地已有同功能 commit（`5407150`/`4ac7af0`）

**lib.rs 8 处冲突全部在日志行**，解决原则：采用 upstream 脱敏文本 + 保留本项目 `log::info!`：
- 代理日志不再打印 URL（`system HTTPS proxy detected` 等）
- `start_claude_session` 不再打印 args/PATH/env 全量值——**这是安全修复**，原实现会泄漏 API key 和代理凭据
- `test_provider_connection` 代理日志同样脱敏

**v1.0.7 带来的主要功能**：
- Provider 凭据加密升级：Windows 用 DPAPI 密封主密钥（TK-303），legacy raw key 文件自动迁移
- 流式处理新增 `commitPartialText`：provider 省略最终 assistant 事件时保留 partialText
- 技能系统重构：`skill-invocation.ts`、skills 面板、skill translation config、`list_all_commands`/`listSkills` 加 `additionalDirs`
- 新增 changelog 面板 + 多个单元测试

**验证**：cargo check + 前端 tsc 通过；完整 `pnpm tauri build` 成功生成 exe 和 MSI/NSIS 安装包（updater 签名失败是已知问题）。版本号 1.0.6 → 1.0.7。
