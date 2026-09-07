---
Status: Awaiting Human review
Last updated: 2026-08-22
Scope: 重建核心技术 Spec——领域 schema、事件协议、pi 接入、目录结构。随里程碑扩展；M1（基础 Task 对话）部分为施工级，之后各节标注扩展点。
Related: docs/roadmap.md · docs/feature-inventory.md
---

# Atrium 重建技术 Spec

## 1. 总体架构

```
┌─ renderer ─────────────────────────────────────┐
│  routes (TanStack) · components · stores        │
│  React Query ←─ tRPC/IPC ─→ CRUD、控制指令      │
│  run-stream store ←─ SSE/HTTP ─→ Run 事件流     │
└────────────────────────────────────────────────┘
┌─ main ─────────────────────────────────────────┐
│  trpc/    CRUD + 控制（create/send/stop）       │
│  server/  Hono：Run 事件 SSE（重放 + 直播）      │
│  engine/  AtriumSession（Run 状态机·外层循环）   │
│           └─ pi Agent 装配（pi 边界仅限本目录）  │
│  domain/  事务与查询（workspace/task/run/msg）  │
│  db/      SQLite（新库文件）+ drizzle 迁移       │
└────────────────────────────────────────────────┘
```

三条铁律，全部来自旧架构的教训：

1. **Run 的生命周期属于 main 进程，不属于任何 HTTP 请求或渲染端连接。** 旧架构一次 POST 就是一轮、断开即失控；v2 中 HTTP 只承担"事件旁路"，渲染端掉线、重连、切换都不影响执行。这是后台运行、多 Task 并行、重启对账的结构前提。
2. **DB 是唯一事实源。** 执行前先持久化（BR-003），事件流只是投影；渲染端任何时刻都能靠 tRPC 查询 + SSE 重放恢复一致状态。
3. **pi 只出现在 `engine/` 一个目录里。** `shared/protocol.ts` 持有事件词汇的冻结副本（不 import pi），其余代码面向自有类型编程；pi 的 0.x breaking 被隔离在单目录。

## 2. 数据层

### 2.1 库与基建

- 新库文件 `userData/data.db`（✅5：旧 `atrium.db` 不读不删）。
- better-sqlite3 + WAL + 外键开启；drizzle-orm + drizzle-kit 迁移（旧架构验证过的基建，原样复用模式）。
- id 一律 `crypto.randomUUID()`；排序靠 `created_at` + 自增 `rowid`，id 保持不透明。

### 2.2 表（M1 全量）

```sql
workspaces  id pk · kind ('default')        · name · created_at
tasks       id pk · workspace_id fk         · title · created_at · updated_at · archived_at?
runs        id pk · task_id fk · status ('running'|'completed'|'limited'|'failed'|'interrupted')
            · outcome_detail json?          -- {kind:'user-stop'|'app-restart'|'context-limit'|'auth'|…, message?}
            · provider_id · model_id        -- 创建时记录，历史归属不随之后换模型改变（BR-002.3）
            · started_at · ended_at?
messages    id pk · task_id fk · run_id fk · role ('user'|'assistant')
            · parts json · metadata json?   -- metadata: {model, durationMs, usage?…}
            · created_at
app_config  key pk · value blob · encrypted int  -- M1: anthropic 凭据(safeStorage)、默认模型；M2 被 providers 表取代
```

- **单 Task 单主 Run 硬约束**（DB 级，非进程内）：`CREATE UNIQUE INDEX runs_one_active ON runs(task_id) WHERE status='running'`。
- **启动对账**（BR-008）：open + migrate 之后、IPC 挂载之前执行 `UPDATE runs SET status='interrupted', outcome_detail='{"kind":"app-restart"}', ended_at=now WHERE status='running'`。
- **status 写入点恰好两处**（Codex/Kimi 事件折叠纪律的 SQLite 版，见 research/session-persistence.md §2.2）：创建事务（'running'）与 `seal()`（终态）；启动对账即"无终结记录 = interrupted"的折叠实现。第三写入点为禁止项。
- **读取容错**：`parts`/`outcome_detail` JSON 解析失败 → 跳过该 part/字段记警告，绝不整条消息或整个 Task 拒载。
- Task 无 status 列：进行中/等待用户等注意力状态从当前 Run 派生；`archived_at` 预留归档（M3+ 才有 UI）。
- **归属预留不靠死列**：后续 artifacts 表引用 `run_id`、delegations 表引用父 `run_id`——id 空间与归属方向现在定死，列到对应里程碑再迁移，不留休眠 schema。

### 2.3 消息内容 = pi 消息词汇（冻结副本，无独立 parts 层）

不再维护自有 Part 联合（2026-08-22 废止）——`message_end` 事件本就携带完整消息，消息形状已是协议的一部分。`messages.parts` 列直接序列化 pi 内容词汇：`TextContent / ThinkingContent / ToolCall`（assistant）、`string | (TextContent|ImageContent)[]`（user）、tool result 内容；类型住在 `shared/protocol.ts` 的**冻结副本**里（DB 数据比代码长寿，不绑 pi 0.x 的字段变动）。

- 扩展规则与事件同款：Atrium 自有内容类型（compaction 标记、artifact 引用…）在副本联合上按需追加；消费方忽略未知 type 并**原样保留**（forward-compat，旧 message-parts 层的核心教训）。
- 图像偏差（M5）：pi `ImageContent` 是 base64 内嵌——DB 只存文件引用，`convertToLlm` 时经 codec 转 base64（媒体落盘 + 引用，旧架构定论）。

## 3. 事件协议（wire protocol v1）

### 3.1 传输

- **tRPC/IPC**：全部 CRUD 与控制指令（创建、发送、Stop、查询）。
- **SSE over localhost HTTP**：仅 Run 事件流。不用 tRPC subscription 的原因：SSE 配"重放 + 直播"语义天然（旧 resumable 模式验证过）、独立于 IPC handler 的窗口绑定、未来 headless（自动化）与外部引擎共用同一通道。

### 3.2 端点

```
tRPC  tasks.create      {text, providerId, modelId}          → {taskId, runId}   -- BR-003 原子事务后启动引擎
tRPC  tasks.sendMessage {taskId, text, providerId, modelId}  → {runId}           -- BR-007
tRPC  runs.stop         {runId}                                                  -- BR-006
tRPC  tasks.list / tasks.get / messages.list / runs.active                       -- 查询
HTTP  GET /api/runs/:runId/events   (SSE)  -- 从头重放缓冲区 + 续直播；无缓冲且已终态 → 204
```

创建/发送在 tRPC 事务返回后引擎才异步起跑；渲染端拿到 runId 再挂事件流。首发确认丢失时（BR-003.4），渲染端用 `runs.active` / `tasks.list` 解析既有对象重挂，绝不重复提交。

### 3.3 事件：pi AgentEvent 词汇（冻结副本 + 最小偏差）

> 2026-08-22 修订：弃自造命名，词汇表全量采用 pi-agent-core 0.84.2 的 `AgentEvent` / `AssistantMessageEvent`——名字、语义、顺序保证照抄；类型在 `shared/protocol.ts` **冻结本地副本，不 import pi**（协议稳定面与 pi 0.x 解耦）。不选 Anthropic events 作底：其词汇只覆盖单条消息（content_block 层），没有 turn / 工具执行 / 循环层——那半仍要自造；而 pi 外层补齐循环层，内层 `AssistantMessageEvent`（text/thinking/toolcall 三元组 + contentIndex）本就是 Anthropic content_block 语义的多协议泛化。生产实证：pi-coding-agent RPC/JSON 模式与 llm-space 全线都直接跨进程传输这套事件。

**核心事件（照抄，9 种）**：`agent_start` · `turn_start` · `message_start{message}` · `message_update{assistantMessageEvent}` · `message_end{message}` · `tool_execution_start{toolCallId,toolName,args}` · `tool_execution_update{+partialResult}` · `tool_execution_end{+result,isError}` · `turn_end{message,toolResults}` · `agent_end`。内层 `AssistantMessageEvent`：`start` · `text_start/delta/end` · `thinking_start/delta/end` · `toolcall_start/delta/end`（均带 contentIndex）· `done{reason,usage}` · `error{reason,error}`。顺序保证沿 pi：**错误是事件不是异常**（`stopReason:'error'|'aborted'` 的 assistant 消息），任何路径都闭合 `turn_end → agent_end`。

**会话层扩展（照抄 pi-coding-agent 的 AgentSessionEvent）**：`agent_settled`（真正静默——`agent_end` ≠ 结束，重试/压缩续跑/队列可立刻再跑一轮）· `agent_end` 附注 `willRetry` · `queue_update{steering,followUp}`（M3）· `compaction_start/end`（M4）· `auto_retry_start/end`（M4）。

**Atrium 偏差（每条有官方先例或硬理由，其余照抄）**：

| 偏差 | 理由 |
|---|---|
| 信封 `{v, seq, runId, messageId?}` 包裹每个事件 | seq 重放/去重（§3.4 不变量）；pi 消息本身无 id，DB 身份经信封携带（llm-space 用 renderer 端随机 uuid——我们 DB 是事实源，id 必须服务端定） |
| `message_update` 及内层事件裁掉累积 `partial`，只留 delta + contentIndex | pi-coding-agent JSON/RPC 模式同款裁法（O(delta) vs O(message²)），`message_end` 为权威 |
| `agent_end` 不带 `messages` 数组，只留 `willRetry` | 全量消息又重又冗余——每条已由 `message_end` 送达，DB 对账兜底 |
| `agent_settled` 携带 `{status: RunTerminal, detail?}` | Run 终态是我们的领域语义，挂在 pi 的静默信号上（原事件无 payload，纯增量扩展） |

**领域扩展槽**（同一 snake_case 风格，事件名现在定死）：`approval_requested / approval_resolved`（M3）· `attention`（M3，sidebar 注意力投影）· `notice`（M4，瞬态通道，不入历史）· `delegation_start/update/end`（M5，归属父 runId）。

**Reducer 参考实现 = llm-space** `packages/core/src/client/reducer.ts`：contentIndex slot 累积；toolcall args 增量 best-effort JSON parse（定稿于 `toolcall_end`）；`message_end` 以最终消息替换流式累积；`_normalizeUsage`（钳制非负有限、全零丢弃）；`agent_end` 扫描 assistant `errorMessage` 判失败。渲染帧节流（~100ms 合帧）+ 终态清理前显式取消节流帧（防迟到帧复活旧预览——llm-space 实测坑）。

M1 实际发射：`agent_start · turn_start · message_start/update/end · turn_end · agent_end(willRetry) · agent_settled{status}`（无工具）。

### 3.3.1 协议是引擎无关的稳定面

执行接口统一为 **`start/stop + 发射 RunEvents`**：native pi 引擎、ACP 外部引擎（M8）、未来任何引擎替换都实现同一接口。渲染端、DB、事件缓冲只认 RunEvent 协议——换引擎 = 换一个转换层实现，协议与前端零改动。

### 3.3.2 钩子与事件：同一生命周期的内外两面

> 2026-08-22 修订：钩子词汇弃自造（PipelinePolicy / beforeRun / beforeTurn 废止），全量采用 **Claude Code hooks** 的事件名与决策契约：`permissionDecision: allow/deny/escalate` · `updatedInput` · `additionalContext` · `systemMessage` · `continue: false`。内部 handler 是类型化函数而非 shell 命令，但决策 schema 同构——未来把内部钩子开放成用户可配置 hooks（旧设置页的 hooks 占位节）时，配置形态直接抄 CC 的 `hooks.{Event}[{matcher, hooks}]`。

Run 只有一个状态机；每个边界时刻两个朝向——**内侧钩子**（代码，可介入可修改）与**外侧事件**（数据，不可变广播、可重放）。对照表：

| 时刻 | 钩子（CC 词汇） | 协议事件（pi 词汇） | 里程碑 |
|---|---|---|---|
| 用户消息提交 / Run 创建 | `UserPromptSubmit`（deny 阻止、additionalContext 注入） | `agent_start` | 事件 M1 · 钩子 M4 |
| 模型流式中 | —（无钩子：已展示文本不可变） | `message_start/update/end` | M1 |
| 工具执行前 | `PreToolUse`（allow/deny/escalate、updatedInput） | `tool_execution_start` | M3 |
| 权限升级点 | `PermissionRequest`（auto-review 的 reviewer = 此钩子的 LLM handler） | `approval_requested/resolved` | M3 |
| 工具执行后 | `PostToolUse`（观察）/ `PostToolUseFailure`（可重试/升级） | `tool_execution_end` | M3 |
| 压缩前后 | `PreCompact` / `PostCompact` | `compaction_start/end` | M4 |
| Run 将静默 | `Stop`（continue:false 续跑）/ `StopFailure` | `agent_end(+willRetry)` → `agent_settled` | M4 |
| 委派 | `SubagentStart` / `SubagentStop` | `delegation_start/end` | M5 |
| 会话生命周期 | `SessionStart` / `SessionEnd` | — | M4 |

划分纪律：**必然发生的引擎行为不是钩子**——usage 记账、metadata、`message_end` 持久化直接写进 engine；钩子只留给可插拔策略（上下文注入、工具拦截、审批、续跑决策）。CC 恰好没有"每次模型调用前"的钩子，与此划分互证。钩子 handler 与所属能力模块 colocate 原则不变；handler 另持有 `emit()` 能力（旧 middleware `ctx.emit` 的 v2 版）向 `notice` 等扩展通道发射事件——**协议内容经钩子生长，核心事件集冻结**。

### 3.4 main 侧事件基建（`server/run-events.ts`）

每个活动 Run 一个环形缓冲（上限 10k 事件）+ 订阅者扇出；终态后缓冲保留 60s 供迟到重连，之后丢弃（DB 已有终态）。旧 resumable.ts 的模式重建，容量按新事件粒度收紧。

**防丢失不变量**（create-then-attach 模式的三个丢失窗口，逐条封死；来自旧实现的实测教训）：

1. **缓冲先于引擎**：环形缓冲在 run 创建的同一同步段建立，引擎只写缓冲、永不直发订阅者——create 返回到 SSE 建连之间的事件零丢失。
2. **订阅与重放原子**：挂载时同步完成"注册订阅 + 快照缓冲"（中间无 await），客户端按 seq 去重——重放/直播接缝幂等。
3. **持久化不依赖消费者**：`seal()` 在 main 侧无条件落库，零监听者的 Run 照样写全——杜绝"客户端驱动持久化 + 流无人消费 = 消息永久丢失"这一类。
4. 渲染端兜底闭环：进入 Task 视图恒为"先查 DB → 再挂流"；挂流得 204 → refetch。
5. **终态双屏障**（Codex 模式）：`seal()` 的持久化事务提交**先于** `agent_settled` 广播——客户端收到终态事件时 DB 必然已可读。
6. **持久化策略单函数**：哪些事件/内容 durable、哪些 ephemeral，收敛为一个穷举函数，调用点不得各自判断。

**总不变量：事件流只是加速器——丢流最多丢实时感，永不丢数据。**（对照：llm-space 无 seq 无重放，掉流即丢一轮，因其单轮模式损失可控；我们的 Run 是长执行，不采纳。）

## 4. 引擎层（`src/main/engine/`）

### 4.1 pi 接入形态（✅3 修订：`Agent` 类 + 自有 Session 包装）

> 2026-08-22 调研修订（原"单轮 terminate 桩 + 自持循环"废止，Haoze 已确认）。证据：官方参考实现 pi-coding-agent 的生产路径 = `new Agent(...)` + 自有 `AgentSession` 包装，从不用裸 agentLoop，也不用 AgentHarness。pi 的 `Agent`（~590 行）就是我们原计划自写的那个循环：内置 steering/followUp 队列（两种 queue 模式）、`beforeToolCall/afterToolCall`（block/reason/terminate + 结果覆写）、`prepareNextTurn`（轮边界刷新模型/工具/系统提示）、abort 语义、`handleRunFailure`（回调异常时合成闭合事件序列）。自写循环 = 重踩它已修的坑：assistant-last 陷阱、回调不可 throw、length 截断工具调用需整批失败、`agent_end` ≠ settled。原单轮方案的理由逐条失效——HITL 在新领域模型下本就是 Run 保活等审批（`beforeToolCall` 内 await 渲染端即官方设计的审批挂点）；Queue/Steer 原生内置且语义正合 Codex/Cursor 研究建议；llm-space 坚持单轮是其产品形态使然（step-by-step 工具检查台，用户手点 "Call tools"、无 steering、掉流不重放）——Atrium 是自主执行 + 关键点接管，与 pi-coding-agent 同形。

```
engine/
  session.ts   AtriumSession（对标 pi-coding-agent AgentSession）：外层循环（自动重试/压缩续跑/队列）、
               message_end 统一持久化、事件信封化 + 扇出、agent_settled 终态封口 —— Run 状态机在此
  agent.ts     Agent 实例装配：streamFn（models.streamSimple 注入）、convertToLlm、
               钩子接线（PreToolUse→beforeToolCall 等）、prepareNextTurn 状态刷新
  codec.ts     DB parts ⇄ pi AgentMessage（M1 纯文本，M3+ 长出工具/图像）
  tokens.ts    上下文估算（BR-009；移植旧 char/4 + provider 计数算法）
  hooks.ts     HookBus（CC 词汇，§3.3.2）
```

pi 约束（更新）：

- 精确锁 **0.84.2**，不写 `^`。铁律 3 放宽为目录级：pi 类型只出现在 `engine/` 内；`shared/protocol.ts` 是冻结副本，不 import pi。
- 使用：`Agent` 类、`createModels` + per-provider factory、类型。**仍禁止**：AgentHarness、`/compat`、`providers/all`、pi Session/SessionRepo（JSONL 树不用——DB 是事实源；但其两个模式照抄：`message_end` 单点持久化、首条 assistant 落地前懒刷盘 ≈ 我们的 BR-001 无空对象）。
- 传给 Agent 的一切回调**不 throw**（pi 合同；throw 会中断循环且无闭合事件）。
- Models 按配置代实例化，绝不修改共享 Model 对象（llm-space 被迫 finally 还原 baseUrl 的教训）。
- 未映射 stop reason 在 pi 0.83+ 以 provider error 呈现（含 `pending`）→ session 归一化进 failed/limited，不得漏判成 completed。
- length 截断的工具调用整批失败不执行（照抄 `failToolCallsFromTruncatedMessage` 语义）。

### 4.2 Run 状态机（AtriumSession）

Run = 一次 `agent.prompt()`（或 continue）到 `agent_settled` 的完整周期，含外层循环的自动重试/压缩续跑：

```
start(runId):
  载入历史 → tokens 预检（超限 → settled(failed,{kind:'context-limit'})，不调模型，BR-009）
  → agent.prompt()：事件流信封化转发；message_end → 落库
  → agent_end{willRetry} → 外层循环（M1 仅透传；M4 起接重试/压缩）→ settled(terminal)
stop(runId): agent.abort() → pi 合成闭合事件序列 → settled('interrupted',{kind:'user-stop'})
awaiting-approval（M3）: beforeToolCall await 期间的 Run 子状态，approval_requested 事件投影
```

- **终态竞态**（BR-004.5 / BR-006.4）：settled 封口幂等，首个触发者胜出；封口后迟到事件丢弃。
- partial 文本随 `message_end`（abort 时 pi 仍发出带 `stopReason:'aborted'` 的消息）落库——BR-005.1 的"部分回复保留"。
- **模型可见的中断/受限标记**（Codex 模式）：终态为 interrupted/limited/failed 的 Run，其后续上下文在 **prompt 构建期**由 codec 注入确定性说明（内容确定性以稳 prompt cache；不改存储）——实现 BR-007.3"部分回复保留未完成性质"。
- **M1 全局单执行位**（BR-010）：session 层一个全局 slot，占用时 `tasks.create/sendMessage` 拒绝；DB 唯一索引管"同 Task 不并发"这条永久不变量，全局 slot 是 M1 临时策略，M3 放开。
- 崩溃丢失的未持久化尾部：接受（PRD 允许），对账后 UI 标注"回复可能不完整"。

## 5. 目录结构

```
src/main/
  index.ts · log.ts
  db/         schema.ts · index.ts(open+migrate+reconcile)
  domain/     workspaces.ts · tasks.ts · runs.ts · messages.ts   -- 纯函数事务/查询，无 IO 之外副作用
  engine/     session.ts · agent.ts · models.ts · codec.ts · tokens.ts · hooks.ts
  server/     http.ts · run-events.ts
  trpc/       trpc.ts · router.ts · routers/{tasks,runs,config}.ts
src/shared/   protocol.ts（事件 + 消息内容的冻结副本、DTO）· model-ref.ts
src/renderer/src/
  routes/     index.tsx(New Task) · task.$taskId.tsx
  components/ …（沿用现网视觉语言重建）
  stores/     run-stream.ts(SSE reducer) · theme.ts
  lib/        trpc.ts · query-client.ts · sse.ts(带 after=seq 重连)
```

分层依赖单向：`renderer → shared ← main`；main 内 `trpc/server → engine → domain → db`，engine 不 import trpc/server。

### 5.1 全量目标结构（M8 末态）与旧模块映射

**边界原则：`engine/` 永远只是执行内核**——session、agent 装配、codec、tokens、compaction、HookBus，到此为止。旧架构的教训是 `agent/` 长成了 15 个子目录的大杂烩（sandbox 到 scheduled 全在里面，互相 import）；v2 里各能力是 engine 的**平级邻居**，通过接口注入（DI 组装，不留内部运行时 require 边）。

```
src/main/
  engine/       内核：session · agent 装配 · codec · tokens · compaction · hooks(CC 词汇 HookBus)
  providers/    M2  模型连接域：manifest · 凭据(实现 pi CredentialStore, safeStorage 加密) · litellm 目录
                    · pi Models 按配置代构建（M1 的 engine 内固定 anthropic 桩届时毕业搬入）
  tools/        M3  工具运行时(TypeBox) + builtins + registry          ← agent/tools
  sandbox/      M3  LocalSandbox · BackgroundShells                    ← agent/sandbox
  permissions/  M3  gate · reviewer（分析纯函数在 shared/permissions，渲染端要显示 crossing 原因）
  context/      M4  上下文服务：skills · memory(含 dream) · instructions · profile · prompt 组装
  mcp/          M5  自有 client 全套（含 managed servers/browser 供给） ← agent/mcp + browser
  delegation/   M5  durable 委派                                       ← agent/subagent
  automation/   M6  trigger + 调度（绑定既有 Task）                     ← agent/scheduled
  workspace/    M6  资源挂载 · git 执行绑定 · session dirs（新建）
  acp/          M8  外部 CLI 引擎，实现与 engine 相同的执行接口（✅6）   ← agent/acp
  computer-use/ M8  Swift helper 接线，以工具包形态挂进 tools           ← computer-use
  domain/ · db/ · server/ · trpc/ · log.ts   （既有四层不变）
```

**依赖方向与组装**：

```
trpc/server（组装根：把 providers/tools/context/permissions… 装配进 engine 的接口）
    ↓
engine ——只依赖自己定义的窄接口：ModelSource · ToolRuntime · Hook handlers
    ↓
providers · tools · permissions · sandbox · context · mcp · delegation …（实现接口，互不 import engine）
    ↓
domain → db        shared ←（renderer 与 main 共用的类型/纯函数）
```

- 旧 middleware 的 builtins（compaction/title/usage/memory 注入…）拆散归户：**挂点接口属 engine，policy 实现属对应能力模块**，server 组装链条——避免 middleware 目录再次成为万物抽屉。
- **钩子形态**（词汇与决策契约见 §3.3.2）：CC 事件名的类型化 handler，组装根显式注册、typecheck 全覆盖，不是运行时扩展机制；handler 与所属能力 colocate（usage 属引擎内建非钩子，memory 注入归 context/memory 的 `SessionStart/UserPromptSubmit` handler），旧 middleware/builtins 目录不复存在。
- `automation` 与 `acp` 都通过 Run 的统一执行接口进入，不各自造轮子（scheduled 旧账本模式只保留 definition/run 分离与对账思想）。

## 6. M1 验收对照（PRD BR → 机制）

| BR | 机制 |
|---|---|
| 001 New Task 无空对象 | 未发送内容只在渲染端 store；`tasks.create` 才落库 |
| 002 模型就绪 | `config` 路由暴露 anthropic 凭据状态；无凭据时渲染端阻止发送并引导设置；Run 记录 model 身份 |
| 003 原子首发 | 单事务 task+message+run；引擎在事务后启动；确认丢失 → `runs.active` 解析重挂 |
| 004 流式时间线 | `message_update`(AssistantMessageEvent) + contentIndex-slot reducer；已展示文本永不回退 |
| 005 终态区分 | RunTerminal 四态 + outcome_detail；partial 文本随 failed 保留 |
| 006 Stop | `runs.stop` → abort → seal(interrupted)；幂等 seal 消竞态 |
| 007 后续 Run | `tasks.sendMessage` 同构事务；历史含受限/失败 Run 的部分文本 |
| 008 重启对账 | 启动时 running→interrupted；终态 Run 永不重放 |
| 009 上下文边界 | tokens.ts 预检，超限不调模型；服务端事后报限 → limited/failed 如实呈现 |
| 010 单执行位 | 全局 slot + 渲染端导航锁；隐藏窗口不影响执行（Run 属 main） |

## 7. 本 Spec 明确不做的（防镀金）

- 不设计 M2+ 的 providers/工具/权限/MCP schema——各里程碑扩展本文档对应节。
- 不引入 workspace 资源挂载、git 绑定、session dir（M6）。
- 不做消息编辑/分叉/重试（后续 Feature 语义重定）。
- 渲染端不建通用组件库——沿用现网视觉语言按需重建。
