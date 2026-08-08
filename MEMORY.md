# MEMORY.md

TOKENICODE (Tauri 2 + React + Rust) — Claude Code 桌面 GUI。
forked from mistydew/tokenicode-deepseek-alpha。

创建：2026-08-04

## 工作规范（2026-08-08）

- **Git commit 必须带 scope**：格式 `<type>(<scope>): <desc>`（如 `fix(stdin): ...`）。禁止无 scope 或自定义前缀（如 `@ perf:`）。scope 用本项目模块名（stdin/session/stream/model-display/file-tree/mcp/settings/ui/docs 等）。详见 CLAUDE.md「Git Commit Convention」。这是用户明确要求强制的。
- **已知待办已迁移到 GitHub Issues**：`cc10143/tokenicode-deepseek-alpha` issues #3-#6。MEMORY 不再重复维护待办清单。

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

## 2026-08-05 AskUserQuestion 选项 preview 渲染（issue #2）

**问题**：AskUserQuestion 选项的 `preview` 字段（聚焦/hover 选项时显示的预览内容）不渲染。`label`/`description` 正常，`preview` 完全无显示。

**根因**：不是传参问题——`useStreamProcessor.ts` 和 `session-loader.ts` 都是把 `input.questions` 原样透传，运行时 `preview` 本来就到达前端。缺的是：① `QuestionOption` 类型没声明 `preview`（TS 拦截）；② QuestionCard 渲染处只处理 `label`+`description`。

**修复**（`QuestionCard.tsx` + `chatStore.ts` + `i18n.ts`）：
- 新增 `hoverIdx` 状态，选项按钮挂 `onMouseEnter`/`onFocus`/`onBlur` 追踪聚焦选项
- 选项列表下方渲染 preview 区块，CSS 组合保障全文可读：
  - `whitespace-pre-wrap` — 保留换行/空格，ASCII art 不变形
  - `overflow-wrap: break-word` — 超长 URL 横向断行，不溢出
  - `max-h-32` + `overflow-y-auto` — 超长内容内部滚动可读，**不裁切**
- 选项容器 `onMouseLeave` 清空 hover：鼠标从选项移到 preview（同容器内）时预览保持，可滚动
- 附带修复：选项 label 加 `break-words`——超长无空格 label 在窄宽度下会把卡片撑破（实测 320px 下 scrollW 541 > 317）
- `QuestionOption` 补 `preview?: string`；i18n 新增 `msg.questionPreview`（中英）

**验证**：tsc + vite build 通过；编译 CSS 确认 `.break-words{overflow-wrap:break-word}` 生成。用复刻 preview 区块的独立 HTML + BrowserClaw `evaluate` 量化实测四类极端样例（ASCII art / 超长 URL / 40 行日志 / 超长 label），640px 与 320px 两档宽度：无横向溢出、ASCII 空格与换行完整、40 行内容可滚动不裁切。提交 `cd9bce5` 已 push fork。

## 2026-08-05 AskUserQuestion preview hover 劫持 bug → 点击锁定方案

**问题**：preview 区块固定在选项列表**最下方**，内容超长需鼠标滚轮翻动。鼠标从选项区移到预览区滚动的路径必然穿过中间选项——每经过一个 hover 就触发切换，preview 被依次劫持，最终显示最后经过的选项内容。

**根因**：preview 由 hover 被动跟随，而"滚动预览需要鼠标停留"——结构性冲突，不是偶发。

**方案（用户提出，已实施）**：preview 从 hover 跟随改为**点击锁定**：
- 未锁定：hover 跟随（保留快速浏览）
- **点击选项 → 锁定** preview 到该选项（标题显示锁图标 + 来源选项名），此后 hover 其他选项不切换 → 滚动预览稳定
- **再点一次已锁定选项 → 解锁**，回 hover 模式
- 多选：preview 显示**最后点击**的选项（不绑定选择集）
- 键盘 Enter 走按钮 onClick，同锁定逻辑；切题（handleConfirm 非最后一题）时重置 `lockedIdx`/`hoverIdx`，避免残留到下一题

**实现**：`lockedIdx: number | null` 状态，`activePreviewIdx = lockedIdx ?? hoverIdx`；handleToggle 里 `setLockedIdx(prev => prev === optIdx ? null : optIdx)`。

**验证**：tsc 通过；构建覆盖便携版，用户复测确认。commit `64c7290` 已 push fork。

## 2026-08-05 模型显示路由统一修复

**问题**：方案 7（`94cf86c`）的 `inheritedModel` 是"settings.json 当前 tier 的单条模型"，各显示点把它当作固定值，导致无论 GUI 选 Sonnet/Opus/Haiku 都显示同一个模型名。Sidebar 优先显示 `sessionMeta.model`（CLI 报告的原始 Claude 名如 `claude-sonnet-4-6[1M]`），继承模式下覆盖了映射后的显示名。显示路径散落 3 个重复 helper（`getModelDisplayName` × 2 + `modelLabel`）。

**修复**（commit `a4ba83a`，11 个文件）：
- `get_cli_model_config` 改用 `_MODEL_NAME`（上游名 `deepseek-v4-pro`）替代 `_MODEL`（Claude 内部名）
- 新增 Rust 命令 `get_cli_model_mappings` — 读全部 3 个 tier→上游名映射
- `resolveModelOrError` inherit 分支改为 `modelMappings[tier]`（按 GUI 选中的 tier 对应），非固定 `inheritedModel`
- 新增 `resolveModelDisplay(rawModel)` — 统一显示入口，继承模式下通过 `modelMappings` 把原始模型名映射到上游名
- 5 个组件中的 3 个重复 helper → 1 个统一入口
- Rust 日志用 `log::info!`，前端用 `bridge.frontendLog()` — 排查加载失败时可见

**附加发现——ConPTY 0-line bug**：ConPTY 代码（从未提交）在构建中被意外引入，`conpty::Process::output()` reader 读不到数据导致 stdout 0 lines，但 CLI 实际正常工作（JSONL 可见）。回退到 pipe 方式。ConPTY 方案暂挂起。

## 2026-08-08 UTF-8 字节切片 panic：长中文 follow-up 无回复根因

**症状**：GUI 发长中文消息（>80 字节）时偶发"无回复"——消息发出后永久卡死；同一 app 会话里短消息正常。诊断链：日志显示 `send_stdin command` 从未出现，但 `probe_echo`（异步命令）正常、两条运行时 canary 健康、前端 heartbeat 正常 → 锁定是 `send_stdin` 命令自身 panic。

**根因**：`send_stdin` 第一行日志 `&message[..message.len().min(80)]` 是**字节切片**。中文 UTF-8 每字 3 字节，byte 80 落在字符中间 → Rust panic `byte index 80 is not a char boundary`。异步命令的 panic 被 tokio 吞掉（JoinError），Tauri 不响应 → 前端 promise 永久 pending = "无回复"。panic 在日志写出之前，所以连 `send_stdin command` 都不打印。触发消息 386 字节、byte 80 = 0x8F（续字节），必中。

**同类 5 处**（全部可能含中文）：
- stdout 前 10 行预览 `&line[..150]`（CLI 中文回复必然命中）
- post-stdin 预览 `&line[..150]`
- control_request 日志 `&line[..min(200)]`
- stderr 预览 `&line[..200]`
- 启动会话扫描 `&head[..min(65536)]`（中文会话 JSONL >64KB 必崩）

**修复**（commit `111c8a0`）：新增 `safe_preview(s, max)`（`s.chars().take(max).collect()`，按字符切永不落半字），替换全部 6 处。从根上消除整类 panic，非逐个打补丁。

**诊断方法论教训**：间歇性 bug 用"分层探针"定位——前端心跳（JS 存活）、异步命令 echo（分发链路）、两条运行时 canary（运行时健康）、锁时序（锁死锁）、promise 创建日志（前端是否真的调用）。最后用"同步命令"探针把 panic 顶到主线程导致崩溃，才暴露真实 panic 点。关键转折：崩溃不是坏事，它把静默吞掉的 panic 显性化了。

**判断"是否同类坑"**：修复前全盘 grep `&[a-zA-Z_]+[..` / `.len().min(N)]` 模式，逐个确认内容是否可能含多字节。安全豁免：checksum（ASCII hex）、盘符解析（ASCII）、`.find()` 匹配点（字符边界）、`is_char_boundary` 兜底处。
