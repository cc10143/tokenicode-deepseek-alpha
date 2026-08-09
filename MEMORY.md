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

## 2026-08-08 模型显示映射 miss：CLI 上报的 model 名变体未映射

**症状**：聊天顶栏显示未映射的 Claude 内部名（`claude-haiku-4-5`），而右下角选择器正确显示上游名 `deepseek-v4-flash`。

**根因**：`resolveModelDisplay` 用精确 ID 匹配 `TIER_MAP`，表键只有带日期后缀的 `claude-haiku-4-5-20251001`。CLI 上报的 model 来自 settings.json 的 `ANTHROPIC_DEFAULT_HAIKU_MODEL`（`claude-haiku-4-5`，无日期后缀）→ 匹配 miss → fallback 原样显示。sonnet/opus 因带 `[1M]` 被剥掉后命中，只有 haiku 暴露。**潜在同类**：`claude-opus-4-8[1M]` 剥掉后 `claude-opus-4-8` 也不在 TIER_MAP（表里只有 `claude-opus-4-6`），切 opus tier 时也会 miss。

**修复**：`api-provider.ts` 新增 `tierFromModel()`（子串匹配 `opus`/`sonnet`/`haiku`），`resolveModelDisplay` 改用它。上游名 `deepseek-v4-pro/flash` 不含 tier 关键词，不会被误映射。`resolveModelOrError` 的 `TIER_MAP[selectedModel]`（GUI 受控 ModelId）保持不变。

**验证**：vitest 新增 5 个 `resolveModelDisplay` 测试（含 `claude-haiku-4-5` 无日期、`claude-opus-4-8[1M]`、上游名不误伤）全过；tsc 通过。文档：D:\KaiFa\Claude GUI\CLAUDE.md 第 10 项 + 本文件已更新。

## 2026-08-08 inherit 模式模型选择器真正生效（issue #7）

**背景**：方案 7/10 只解决了 inherit 模式（无 GUI Provider）下模型**显示**，发送路径 `resolveModelForSend` 恒返回 `undefined` → CLI 永远用 settings.json `model` tier，GUI 选择器是 inert 的。

**路由证据**（issue #7 详述）：CC Switch `map_model()` 子串 tier 匹配，上游别名（deepseek-v4-pro 等）静默落 default，只有 Claude tier 名路由正确 → `--model` 必须传 `_MODEL` 值（含 `[1M]`）。`[1M]` 是客户端上下文声明，非上游参数。

**改动**（9 文件）：
- **Rust** `get_cli_model_mappings`：返回 `{activeTier, mappings: {tier: {display, pass}}}`，`display`= `_MODEL_NAME` 剥 `[1M]`，`pass`= `_MODEL` 保留 `[1M]`
- **settingsStore**：`modelMappings` 类型 `Record<string, ModelTierMapping>`（`display?`/`pass?`）；新增 `inheritedActiveTier`
- **api-provider**：`resolveModelForSend` inherit 分支返回 `mappings[tier]?.pass`（无映射 → undefined → CLI 默认）；`resolveModelOrError` inherit 分支读 `.display`
- **ModelSelector**：inherit 下拉显示上游名；一次性默认选中同步到 settings.json `model` tier（ref 守卫）
- **3 个 spawn 调用点**（InputBar / ChatPanel pre-warm / useStreamProcessor 重试）：`model`= `resolveModelForSend`；`context_window`= `getContextWindowForModel(sendModel ?? resolvedModel, ...)`——**必须用 send 模型**，否则前端显式传的 `context_window` 覆盖 Rust 的 `[1M]` 检测，1M 被砍成 200K
- **GeneralTab**：上下文窗口显示改用 send 模型；tier 映射显示读 `.display`

**验证**：vitest 全量 21 通过、`tsc --noEmit` 干净、`cargo build --release --frozen` 通过。**commit 待提交**。

**遗留**：`inheritedModel` 仍只加载不消费（legacy，未删）。

## 2026-08-08 Upstream v1.0.8 同步（context snapshot 恢复 + 日志脱敏）

从 upstream 检测到 v1.0.8（commit `a51edd7`，父提交 `9c3bb65` = 我们的 v1.0.7 tag）。按用户决策部分合入：

**合入**：
- **#3+#7+#8+#9 context snapshot 恢复**：`get_session_tokens` 重写为 `compute_session_tokens`（读 assistant JSONL 记录，按 message id 去重 totals；context snapshot = 最后一条 assistant 的 `input + cache_read + cache_creation`）。ConversationList 打开会话时恢复 `sessionMeta`；useStreamProcessor 删除 result 段 2 处 `contextSnapshot()` 调用（保留 message_start 段）
- **#1 日志脱敏**：采纳 upstream"不记内容"原则，但用我们的 `log::info!`（fern）替代 upstream 的 `eprintln!`。启动 stdout 前 10 行 + post-stdin 段改为只记 `type/subtype/bytes`，不再打印 line content（prompts/replies/thinking/tool args）

**未合入（fork 取舍）**：
- **#5 thinking 默认展开**：用户明确不合并
- **ghost 会话过滤（冲突 A）**：upstream 把它当 regression 回退，我们保留自己的三元组过滤
- **sendStdin fallback（冲突 B）**：保留我们的实现

**版本号**：1.0.7 → 1.0.8（package.json / Cargo.toml / Cargo.lock / tauri.conf.json + changelog.ts + CHANGELOG.md + README）

**验证**：tsc exit 0、vitest 21 通过、`cargo test test_session_tokens` 通过（新增 `test_session_tokens_use_latest_context_and_deduplicate_blocks`）、`pnpm tauri build --no-bundle` exit 0（tokenicode.exe 生成）。

**注意**：v1.0.8 是手动合入（直接编辑），不是 cherry-pick，因为改动与我们 fork 有重叠（compute 逻辑在本地已存在，日志段重叠）。下次同步起点仍是 upstream `9c3bb65` 之后。

## 2026-08-09 验证式 auto-compact（issue #8，commit `facea32`）

**背景**：CLI 原生自动压缩在 stream-json 模式下不可靠（issue #3561 autoclose 未修），fork 自带的 auto-compact 用一次性 flag `autoCompactFiredRef`，无验证、失败不重试，是最弱一环。

**协议事实**（CLI 2.1.195 二进制确认，写成 issue #8）：
- `compact_boundary` 是压缩完成的**确定信号**，带 token 数值：`{type:"system", subtype:"compact_boundary", compact_metadata:{trigger:enum("manual","auto"), pre_tokens, post_tokens, preservedMessages}}`
- `compact_result`（status 事件）只有 `success`/`error` 枚举，**不带 token 数值** → 无法据此刷新 Ctx，必须靠 `compact_boundary`
- **CLI 没有汇报上下文占用的斜杠命令**（无 `/context`）；`/usage` `/cost` 在 fork 里是**前端本地实现**（显示 fork 缓存的数据，不透传 CLI），不是兜底
- CLI `/compact` 会把生成的会话摘要作为一条 **user 消息注入**（`This session is being continued...`），GUI 如实显示——这就是"压缩后屏幕上冒出非用户输入的英文长文"的来源，不是旧回合重放

**修复**（`useStreamProcessor.ts` / `InputBar.tsx`）：
1. 消费 `compact_boundary`：压缩完成即 `setSessionMeta({contextInputTokens: post_tokens})` 刷新 Ctx（让 auto-compact 判据自然失效）+ 命令卡显示 `pre → post (-X%)`；`compact_result` 也置 confirmed 对齐判据
2. auto-compact 一次性 flag → 验证式 + 重试：`compactInFlightRef`（防重入）/ `compactRetryRef`（MAX=3）/ `compactConfirmedRef`，60s 未确认自动重试，耗尽标失败
3. `result` 分支 guard：`/compact` 不抢先标完成（否则掩盖未验证的压缩）；用 `compactInFlightRef.current` 区分 auto/manual——auto 交给 60s 重试，手动 `/compact` 延迟 3s 等 `compact_boundary`，超时读 JSONL（`get_session_tokens`）校正 Ctx + result 文本兜底标完成
4. **`compact_result` 区分 success/error（2026-08-09 补丁）**：原 `if (msg.compact_result)` 把 error 当确认，命令卡只显示 `Compact error` 不重试，用户误以为压缩成功。改为 `=== 'success'` 才确认；error 时用 `compactInFlightRef` 区分 auto/manual——
   - **auto**：`compactRetryRef += 1` + 释放 in-flight + `compactConfirmedRef = true`（阻止 60s 定时器对同一尝试重复记账），命令卡显示「自动压缩失败, 可手动输入 /compact 重试」；下轮 result 仍超阈值会重新触发（最多 3 次），不立即重发（与超时逻辑一致，避免打爆 CLI）
   - **manual**：命令卡显示「Compact 失败, 可重新输入 /compact 重试」，completed；**不动 `compactRetryRef`**（避免用户手动失败污染 auto 的重试计数）
   - foreground（`handleStreamMessage`）+ background（`handleBackgroundStreamMessage`）两处 handler 同步改
   - 手动失败仅回 `result` 不带 `compact_result` 的场景仍由 3s 兜底覆盖，无需改

**验证**：tsc exit 0、vitest 21/21、vite build 通过、cargo release build 通过（exe 已覆盖便携版）。真实 CLI 交互路径（compact_boundary 到达时序）需实际使用确认。

**issue 拆分**：原 #8 拆为 #8（验证式 auto-compact，本次实现）+ #9（协议层抽象，`lib.rs` 拆 `protocol/*` 模块，待排期，排在 #8 之后）。

## 2026-08-09 stdout 看门狗误触发重放历史（issue #10）

**现象**：长历史会话中，CLI 回合完成后停顿 >10s，stdout 看门狗把会话历史里所有 `stop_reason=="end_turn"` 的 assistant 逐条合成 emit 给前端（每 10 秒一条），GUI 屏幕把整个历史重放一遍。用户误以为 CLI 在 compact 后继续回答旧问题。

**根因**（三层叠加）：
1. **触发条件过宽（核心）**：看门狗只看 `last_text_activity.elapsed() > 10s`，无法区分"stdout 真卡住（块缓冲，方案 8 目标）"vs"CLI 回合正常完成、等待下一条输入"。CLI 回合完成（result 到达）后 stdout 进入等待输入的静默，10s 后看门狗误判"卡住"触发。
2. **基线错误**：`jsonl_emitted_assistant_count` 初始化为 0，没排除会话已有历史。看门狗从头扫描 JSONL，把第一条 `> count` 的 end_turn 历史当成"前端未收到"合成，break；下次触发再合成下一条 → 逐条重放整个历史。
3. **前端去重失效（放大）**：流式 assistant 文本 id = `${msg.uuid}_text_${blockIdx}`（useStreamProcessor L1341），`parseSessionMessages` 加载历史 id = `msg.uuid`（session-loader L123）。id 格式不一致，`addMessage` 的按 id 去重被绕过，看门狗合成的每条历史都作为新消息追加。

**为什么长历史会话才可见**：新建/短会话前端消息都是 stdout 流式来的（id=`uuid_text_N`），看门狗合成同条 id 一致 → 去重，无感；长历史会话历史以 `uuid` 加载，看门狗合成 `uuid_text_N` → 去重绕过 → 逐条追加。日志显示看门狗自 8/5 起频繁触发（100+ 条 synthesizing 记录），只有这次（长历史会话 + 停顿 >10s）可见。

**修复**（`lib.rs` watchdog，方案 1 + 2）：
1. **armed 门控**：`watchdog_armed` spawn 时 true；stdout 收到 `result` → false（回合完成，stdout 通畅）；收到 assistant/text → true（回合活动）。Err(_) 分支开头 `if !watchdog_armed { continue; }`。看门狗只在 CLI 回合进行中（spawn→result）触发，回合完成后的正常静默不再误触发。
2. **基线**：首次扫描 JSONL 时把 `jsonl_emitted_assistant_count` 设为最后一个 end_turn assistant 序号（`jsonl_baseline_inited` 标记），历史永不被当成"未送达"重放。

**方案 8 保留**：stdout 真卡住时 result 不达，armed 保持 true，看门狗仍补发当前回合新消息；前端按 id 去重，重复补发无害。

**验证**：cargo check + release 构建通过（3 warning 均为既有 dead_code），exe 覆盖便携版 `D:\TOKENICODE\tokenicode-deepseek-alpha.exe`。真实 CLI 交互（长历史会话回合后停顿 >10s 不再重放）需实际使用确认。

**issue**：[#10](https://github.com/cc10143/tokenicode-deepseek-alpha/issues/10)

## 2026-08-09 assistant 消息 id 对齐（issue #9 配套项）

**问题**：assistant 消息 id 双格式不一致。流式（`useStreamProcessor` L1373/L1542）用 `${uuid}_text_${blockIdx}` / `${uuid}_thinking_${blockIdx}`（blockIdx = content 数组原始下标）；加载历史（`session-loader` L138/L212）text 用 `msg.uuid`、thinking 用 `${msg.uuid}_thinking_${messages.length}`。流式因 addMessage 按 id 去重 + 同回合多 text block 必须区分，设计了 block 级下标；加载历史直接 append 不经过 addMessage，就用了裸 uuid/运行计数——**没对齐**。加载产出的 id 后续被流式/看门狗消费时去重被绕过（#10 放大因素，根因已修，id 不一致本身仍是隐患）。

**修复**（`session-loader.ts`，commit 待提交）：assistant 循环 `for..of` → `for (let blockIdx...)`；text id → `${msg.uuid}_text_${blockIdx}`、thinking id → `${msg.uuid}_thinking_${blockIdx}`。blockIdx 用**原始下标**（被 continue 跳过的 tool_use/system text 仍占位），与流式遍历同一 content 数组 → id 精确对齐。

**契约测试**（`session-loader.test.ts`）：text block 用原始下标——tool_use 占 index 2 时第二个 text id 是 `asst-uuid-1_text_3` 而非 `_1`。把"加载与流式 id 一致"锁死。

**验证**：tsc exit 0、vitest 22/22、vite build 通过、tauri build 打包 exe。

**决策记录**：用户选择**最小对齐（方案 A）**而非结构化 id（方案 B：ChatMessage 加稳定 id + block 次键、addMessage 去重键改复合键）。理由：B 是面向假想需求的建模，成本高（碰 addMessage 20+ 调用点、rewind/时间线），且 CLI text block 无自身 id（只有 tool_use 有），blockIndex 漂移问题 A/B 同样存在，B 不解决根本。tool_use/question/todo 用 CLI 稳定 `block.id` 两边一致，不在此改动范围。
