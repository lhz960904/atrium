---
Status: Awaiting Human review
Last updated: 2026-09-15
Scope: Refactor
Source revision: 1d645c860dbdf20d5837e9d5ca8df0f6bd0d4391
Source branch: refactor/provider-runtime
---

# Agent Runtime：连续交互与原生事件

## 概述

审批和询问是一次运行中的等待，不是一次运行的结束。进程仍在运行时，用户提交决定只解除原调用的等待，由原来的 pi loop 继续执行；退出、取消和崩溃才进入中断收尾或历史修复。

事件描述真实发生的事情，不为某个 UI 的当前展示方式删字段、复制错误文本或改变生命周期含义。pi 事件直接复用包类型；Atrium 的运行身份、交互请求和应用收尾作为独立业务事件。前端负责按角色组织消息、关联工具卡片和提取错误文字。

本方案依据当前工作区，而不只是 HEAD：已包含暂存的 capabilities 调整和未提交的 `execute-run.ts` / Runner 重构。实施时保留这些已有改动；不能重新从旧的 `execute-turn.ts` 开始。Provider 优化不在本次范围，已有 `provider-runtime-simplification.md` 不改写、不替代。

已确认的交互策略：

- 桌面聊天默认不限时，直到用户决定、停止或进程退出；底层支持可选超时参数，本轮不新增超时设置界面。
- 定时任务也保留等待，允许用户稍后打开绑定会话处理；不自动批准，不因为暂时没有前端订阅者而失败。
- 不做旧版协议、旧 `/resume` 写接口或跨版本待审批任务的兼容执行。保留现有已完成会话数据，不重置用户数据库。
- 保留当前审批、询问和工具卡片的视觉布局；本次改变其数据与运行生命周期，不另做 UI 设计。

## 当前流程

```mermaid
flowchart LR
  UI["前端提交消息"] --> API["HTTP / Runner.start"]
  API --> Run["executeRun / pi loop"]
  Run --> Gate["tool-interactions：park + block + terminate"]
  Gate --> Store["session：保存待交互记录，跳过占位结果"]
  Gate --> End["结束 loop / 关闭事件流"]
  End --> Reply["前端提交决定 / resume"]
  Reply --> Restart["applyResolutions 执行旧工具 / 创建新 loop"]
  Restart --> Run
  Run --> Project["event-projector / projector：过滤、裁剪、改写"]
  Project --> Buffer["事件对象缓存 / SSE"]
  Buffer --> UI
```

当前模型 `message_update` 被裁掉累计消息；`message_start/end` 增加了实际等于 runId 的 messageId；`agent_end` 被吞掉，再由应用收尾伪造。前端也假定所有消息事件都是 assistant，并从 `details.errorText` 读取工具错误。

## 目标流程

```mermaid
flowchart LR
  API["修改 · HTTP / Runner：启动、决定、取消"] --> Run["修改 · executeRun：单次运行生命周期"]
  Run --> Pi["现有 · pi loop"]
  Pi --> Interact["修改 · tool-interactions：审批钩子 / 询问执行"]
  Interact --> Pending["新增 · pending-interactions：进程内 Promise"]
  API -->|"提交决定，不启动运行"| Pending
  Pending -->|"解除原调用等待"| Interact
  Interact --> Session["修改 · session：请求、决定、真实结果"]
  Pi -->|"原生 AgentEvent"| Buffer["修改 · buffer：固定 JSON 帧 / SSE"]
  Run -->|"Atrium 业务事件"| Buffer
  Buffer --> UI["修改 · 前端按角色和业务状态消费"]
  Run --> Recover["修改 · conversation：仅在中断后修复"]
```

## 关键技术决策

### 所有权与正常路径

| 决策 | 现状与证据 | 选择、理由和取舍 |
|---|---|---|
| 同一 loop 等待 | pi 0.84.2 的 `beforeToolCall` 返回 Promise，内部直接 await；`dist/types.d.ts:232`、`dist/agent-loop.js:405` | 审批在 beforeToolCall 内 await；批准返回 undefined；拒绝返回 block + reason，不默认 terminate。保留进程内运行资源，换取正常路径不重建上下文和工具。 |
| 询问也使用真正的工具执行 | `src/main/agent/tools/builtins/ask-clarification.ts` 目前 execute 只会抛错，依赖 clientSide 标记 | 在询问工具 execute 内 await，答案成为真实工具结果。不能把答案塞进只能决定是否放行的 beforeToolCall 返回值。 |
| 集中登记能力 | `capabilities/tool-interactions.ts` 已是交互注册点 | 该能力负责审批判断、请求/决定持久化、业务事件，并暴露一个给询问工具使用的 ask 方法。新增的 `pending-interactions.ts` 只管理等待与决策竞争，不访问 DB，也不是通用中间件框架。 |
| Runner 的边界 | 当前 Runner 已只管理 active、取消和缓冲区 | Runner 为每个 run 创建一个待决请求表，负责按 threadId/runId 投递决定；executeRun 负责 session、工具和能力装配。HTTP 不读 DB、不执行工具、不重建 Agent。 |
| 消息身份 | `pi-chat/store.ts` 用消息 ID 合并历史；目前它等于 runId | 删除 pi 消息上的 messageId；每条运行流的首个 Atrium `run_started` 业务事件携带 runId。一个 run 仍对应前端一条 assistant 回复，多个 pi turn 是其中的步骤。 |
| 运行结束 | `execute-run.ts` 在用量、录制和资源收尾后手工发 agent_end | 原生 agent_end 只表示 pi loop 结束，原样转发；`run_finished` 才表示应用收尾已完成。准备阶段失败时允许没有 agent_start/end，但必须有失败的 run_finished。 |
| 原生事件类型 | `shared/protocol/events.ts`、`messages.ts` 手抄了 pi 类型，并主动删字段 | 使用 type-only import / re-export。保留 partial、message、toolResults、agent_end.messages、user/toolResult 消息事件；不把 pi 运行时代码打包进 renderer。 |

### 交互身份、接口与安全

每个请求有服务器生成的 interactionId，绑定 runId、原始 ToolCall 和交互类型。前端只能提交决定，不能替换工具名、参数、模型或执行目录。

新 `POST /api/chat/:threadId/decisions` 每次处理一个请求：

```ts
type DecisionBody = {
  runId: string;
  interactionId: string;
  decision:
    | { kind: 'approved' }
    | { kind: 'denied'; reason?: string }
    | { kind: 'answered'; answers: string[] }
    | { kind: 'cancelled' };
};
```

- approved / denied 只适用于审批；answered / cancelled 只适用于询问。答案按原问题顺序提交，服务端恢复问题文字，不能信任前端自带的问题或工具结果。
- 继续使用本机 token 校验。Zod 严格校验结构、字符串长度和答案个数；请求体上限 64 KiB，原因最长 2,000 字符，每个答案最长 8,000 字符。问题最多四个，具体答案数量须匹配该请求的原始 questions。
- 返回 `202 { status: 'accepted' | 'already_accepted' }`：表示进程内已经接纳决定，不表示工具已执行或结果已落盘。落盘成功后发送 interaction_resolved；之后才放行工具。写入失败就停止运行，绝不执行已批准但未成功记录决定的工具。
- 同一运行中相同决定重试返回 already_accepted；不同决定竞争返回 409，首次有效决定获胜。过期、已关闭运行、runId 不匹配或不存在的 interactionId 返回 409；非法类型/答案返回 400；未认证返回 401。迟到请求不能创建运行。
- `/resume` 写接口删除。GET pi-events 的“恢复”只指事件重连，与恢复工具执行无关。
- 批准、停止、超时竞争需要同步抢占状态；Promise 只能 settle 一次。批准已接纳后若 run 被取消，仍不能执行工具。

### 状态、持久化与失败

待决表仅在内存里保存 Promise 和 resolver。会话用 pi 的 custom entry 保存请求及终态，类型为 `atrium.interaction`；用 `atrium.run_stop` 保存已知停止原因。无需增加 SQL 表或绕过 Session 写入。

| 场景 | 运行行为 | 记录与下一次输入 |
|---|---|---|
| 等待决定 | run 活跃，Promise 未完成，不制造 toolResult | 请求已持久化，可由 SSE 重放恢复卡片 |
| 批准 | 原调用放行，由 pi 执行 | 保存决定，然后保存 pi 真正产生的结果 |
| 拒绝 | 原调用被阻止，pi 生成带拒绝原因的错误结果；允许模型继续解释 | 保存拒绝决定，不复制错误到 details |
| 取消询问 | 原询问得到 cancelled 结果，同时取消本轮，不再请求模型 | 记录 clarification_cancelled；已完成的工具结果保留 |
| 点击停止 / 可选超时 | 取消所有待决请求、传播 abort、清理定时器和监听 | 分别记录 user_cancelled / interaction_timeout；只补实际缺失的结果 |
| 前端离开、断流 | 不取消 run，不解除 Promise | 重连只重放，不重新执行 |
| 正常退出 | 拒绝新运行，停止调度，中止运行，有界等待收尾再关库 | 尽量记录 app_shutdown；退出等待上限建议 3 秒 |
| 强杀 / 崩溃 | Promise 随进程消失，不恢复执行栈 | 下次启动运行前修复旧缺口；未知原因只能记 interrupted |

请求登记顺序固定为：先在待决表占位 → await 保存 requested entry → 发布 interaction_requested → await 决定 → await 保存 resolved entry → 发布 interaction_resolved → 原调用继续。登记失败必须撤销等待；取消发生在登记期间也必须正常清理，不能产生未处理的 Promise rejection。

用户决定和“工具是否执行成功”是两件事：崩溃前即使记录了批准，也不能据此重执行有副作用的旧工具。恢复时若没有结果，只能说“执行中断，结果未知”；仍处于待审批的调用则可明确说明“审批已失效，未执行”。修复使用原 toolCallId，不新增虚构调用。

pi 在 beforeToolCall 返回后若发现 signal 已取消，会生成通用 `Operation aborted`。不为展示具体 reason 改写这条原生事件；精确原因保存在 Atrium 的交互终态和 run_finished / session 记录中。

### 并发、调度与资源

pi 的默认 parallel 模式先顺序执行所有工具的 preflight，再并行执行已放行的工具（`dist/agent-loop.js:332`）。因此本轮接受审批逐个出现；不承诺一个批次的所有审批同时弹出，也不改 pi 的调度算法。

取消的安全补充：这个实现可能在中止 preflight 后仍调用此前已准备好的工具。所有当前内置与 MCP 工具都通过 `tools/define.ts` 的 defineTool 创建；在那里统一增加“execute 入口检查 signal”的保护，防止未开始的工具在取消后产生副作用。已经执行中的副作用不能靠 Promise 回滚，不能承诺跨崩溃 exactly-once。

定时任务保持同一条活跃运行，继续占用该会话的运行槽；现有调度器不得为同一任务启动重叠执行。需要调整现有 `blockSuspension()`：有待交互请求时释放防休眠锁，全部解决且任务继续执行时再获取，避免默认无限等待导致机器一直不能休眠。这是本方案建议的资源策略，列入评审重点。

定时任务通过 RunHandle 的事件订阅读取相同业务事件，不另做“只给 UI 用”的审批通道。新增订阅只用于观察；持久化仍是 executeRun 的 awaited recorder，不转移到异步观察者里。现有 subagent 的询问工具禁用规则保留，不新增子 Agent 交互转发能力。

### 传输与存储分开

`run-event-buffer.ts` 目前保存对象引用，发流/重放时才 JSON.stringify；pi provider 会持续修改 partial 的 content。改为事件进入缓冲区时序列化一次，缓存完整 UTF-8 SSE 帧，重放同一份字节。保证的是“进入本应用缓冲区时”的快照，不声称修复 pi 上游排队前已经发生的对象修改。

原生事件里的两份累计内容确实会增加编码、解析和缓存成本，这是接受原生结构的取舍，不称其为零成本。保留当前每线程一个日志、完成日志最多 64 个的策略；不在本轮引入丢帧、裁剪、磁盘事件仓库或另一套紧凑协议。长输出基准是实施验证门槛，内存无法接受时返回评审，不悄悄删除字段。未完成日志当前没有字节上限，这一限制在回归证据里必须披露。

## 实施步骤

每一步前后端一起切换并保持仓库可运行。下列新接口都是拟新增的应用接口，不是声称 pi 已提供的 API。片段只保留与本次决策相关的控制流；实施时复用现有工具 schema、Session 和测试 fixture。

### S-001 — 审批和询问在同一个 loop 中完成

先用真实 pi + SQLite 的运行测试锁住“决定前运行不结束，决定后原工具只执行一次”；再实现单个待决表，连接现有能力、工具、录制器和 HTTP，最后一起切换前端和定时任务。此步仍使用现有事件编码，原生事件切换在 S-002；但待审批不再产生占位错误。

#### `src/shared/interactions.ts`（新增）

这里定义 Atrium 自己的交互，而不是复制 pi 工具结构。输入使用严格 Zod schema，输出类型从 schema 推导；InteractionRequest 直接携带原生 ToolCall。

```ts
import type { ToolCall } from '@earendil-works/pi-ai';
import { z } from 'zod';

export const interactionDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approved') }).strict(),
  z.object({ kind: z.literal('denied'), reason: z.string().max(2000).optional() }).strict(),
  z.object({ kind: z.literal('answered'), answers: z.array(z.string().max(8000)).min(1).max(4) }).strict(),
  z.object({ kind: z.literal('cancelled') }).strict(),
]);
export const decideInteractionSchema = z.object({
  runId: z.string().min(1),
  interactionId: z.string().uuid(),
  decision: interactionDecisionSchema,
}).strict();
export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;
export type DecideInteraction = z.infer<typeof decideInteractionSchema>;
export type RunStopReason =
  | 'user_cancelled' | 'clarification_cancelled' | 'interaction_timeout'
  | 'app_shutdown' | 'interrupted';
export type InteractionOutcome = InteractionDecision | { kind: 'interrupted'; reason: RunStopReason };
export type InteractionRequest = {
  id: string;
  runId: string;
  kind: 'approval' | 'clarification';
  toolCall: ToolCall;
  createdAt: number;
  expiresAt?: number;
};
export type InteractionEvent =
  | { type: 'interaction_requested'; request: InteractionRequest }
  | { type: 'interaction_resolved'; request: InteractionRequest; outcome: InteractionOutcome };
```

`shared/protocol/events.ts` 此步仅把旧 approval_requested / approval_resolved 扩展替换为 InteractionEvent，并移除旧 ToolDecision；其余 pi 形状留待 S-002 一次替换。`shared/protocol/index.ts` 仅增加类型导出。

#### `src/main/agent/runtime/pending-interactions.ts`（新增）

Runner 每个 run 创建一个实例，传入该 run 的 AbortController。不依赖 Electron、DB 或前端。方法登记请求、竞争决定并清理资源；终态接纳记录只保留到本次 run 结束，用于相同决定重试。

```ts
export function createPendingInteractions(opts: {
  runId: string;
  abort: AbortController;
  timeoutMs?: number;
}): PendingInteractions {
  // PendingInteractions 的公开方法见返回值；entries 内保存 request、settle、timer、detach。
  const entries = new Map<string, PendingEntry>();
  const accepted = new Map<string, InteractionDecision>();
  let failure: Error | undefined;

  return {
    get failure() { return failure; },
    open(kind, toolCall) {
      // 创建 request 和带取消处理的 response；登记后才允许调用方发布 requested。
      // 已取消时不得留 pending；取消与超时返回 interrupted，并清理全部资源。
      // timeoutMs 未提供时不创建定时器；超时还要 abort 整个 run。
      return createEntry(entries, opts, kind, toolCall);
    },
    respond({ runId, interactionId, decision }) {
      // 先校验 runId、存活状态、请求类型、原始问题和答案数量。
      // 已接纳同一决定返回 already_accepted，不同决定/过期请求抛 409。
      // 在任何 await 之前从 pending 转入 accepted，然后 settle；不能执行工具。
      return acceptDecision(entries, accepted, opts, runId, interactionId, decision);
    },
    cancel(reason: RunStopReason | Error) {
      if (reason instanceof Error) failure ??= reason;
      opts.abort.abort(reason);
    },
    dispose() {
      // 撤销未完成等待并清理计时器/监听；清空 accepted，不持久化 resolver。
      closeEntries(entries);
      accepted.clear();
    },
  };
}
```

`open` 返回 `{ request, response, cancel }`。cancel 用于“请求保存失败”的局部撤销；全 run 取消通过 cancel(reason)。respond 接纳 cancelled 时，先 settle 该询问，再同步取消整个 run，防止另一个工具继续进入执行。停止原因以 run 的原始 AbortSignal.reason 为准，不依赖 pi 转发后可能丢失的 reason。Error 表示内部执行故障而非用户取消；待决表暴露只读 failure，记住首个内部故障，避免已经发生用户取消时 AbortSignal.reason 无法再次更新而吞掉持久化失败。

#### `src/main/agent/runtime/capabilities/tool-interactions.ts`

一个能力拥有完整交互流程。审批在 beforeToolCall 中等待；ask 交给询问工具的 execute。请求/决定先记录后发布，数据库故障不能被当作批准。gate 不变，包括已有 trust rules 与自动审核。

```ts
export function toolInteractions(opts: {
  gate: ReturnType<typeof approvalGate>;
  pending: PendingInteractions;
  recorder: SessionRecorder;
  emit: (event: AgentSessionEvent) => void;
  signal: AbortSignal;
}) {
  async function request(kind: InteractionRequest['kind'], call: ToolCall) {
    const waiting = opts.pending.open(kind, call);
    try {
      await opts.recorder.interactionRequested(waiting.request);
      opts.emit({ type: 'interaction_requested', request: waiting.request });
      const outcome = await waiting.response;
      await opts.recorder.interactionResolved(waiting.request, outcome);
      opts.emit({ type: 'interaction_resolved', request: waiting.request, outcome });
      return outcome;
    } catch (error) {
      waiting.cancel();
      opts.pending.cancel(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
  return {
    name: 'tool-interactions',
    beforeToolCall: async ({ toolCall, args }) => {
      if (!(await opts.gate(toolCall.name, args, toolCall.id))) return;
      const decision = await request('approval', toolCall);
      // 检查原始 signal，防止批准接纳后又被取消；不在这里执行工具。
      opts.signal.throwIfAborted();
      if (decision.kind === 'approved') return;
      if (decision.kind === 'denied') return { block: true, reason: decision.reason ?? 'The user denied this operation. Do not retry it.' };
      throw new Error('Approval did not complete');
    },
    ask: async (call, signal) => {
      signal?.throwIfAborted();
      const outcome = await request('clarification', call);
      // 按原 questions 重建 ClarifyResult；明确取消返回 cancelled:true，其他中断抛出带原因的错误。
      return clarificationResult(call, outcome);
    },
  };
}
```

#### `src/main/agent/tools/builtins/ask-clarification.ts`

保留现有参数 schema。移除 clientSide 标记，execute 返回原生工具结果；未装配 ask 的工厂可用于 schema 测试，但执行会明确报 unavailable，不自行寻找全局 Runner。

```ts
// 工厂新增可选 ask 参数，类型从 ToolCtx['ask'] 复用。
execute: async (toolCallId, args, signal) => {
  if (!ask) throw new Error('User interaction is unavailable in this context.');
  return ask({ type: 'toolCall', id: toolCallId, name: 'ask_clarification', arguments: args }, signal);
},
```

`src/main/agent/tools/context.ts` 增加 `ask?: (call: ToolCall, signal?: AbortSignal) => Promise<AgentToolResult<ClarifyResult>>`，使用包类型和已有 ClarifyResult。`src/main/agent/tools/registry.ts` 仅将 `askClarificationTool()` 改为 `askClarificationTool(ctx.ask)`。不把 resolver 或 DB 写入能力暴露给工具。

#### `src/main/agent/tools/define.ts`

移除 clientSide 扩展，AtriumTool 直接别名 AgentTool。统一工具执行入口的取消检查，覆盖内置和通过同一工厂生成的 MCP 工具；工具已经启动后的取消仍由各工具实现负责。

```ts
export type AtriumTool<P extends TSchema = TSchema, D = unknown> = AgentTool<P, D>;

export function defineTool<P extends TSchema, D>(tool: AtriumTool<P, D>): AtriumTool {
  return {
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      args[2]?.throwIfAborted();
      return tool.execute(...args);
    },
  } as unknown as AtriumTool;
}
```

#### `src/main/agent/runtime/execute-run.ts`

去掉 parked、resumeRunId、resolutions、applyResolutions；待交互不再是 RunResult 的终态。prepareRun 调整为先构建 gate，再构建交互能力和工具；能力只注册一次，ask 只接到询问工具。prepareMessages 只负责正常历史与压缩。

```ts
// ExecuteRunOptions 新增 pending，signal 继续使用该 run 的原始 signal。
const session = await openThreadSession(db, input.threadId, workspaceRoot);
const recorder = createSessionRecorder({ session, runId });
await recorder.begin(prompt);
// prepareRun 内已有 ctx、gate、工具依赖；这里展示新的装配顺序。
const interactions = toolInteractions({ gate, pending: opts.pending, recorder, emit, signal });
const tools = getTools({ ...toolContext, ask: interactions.ask });
const capabilities = [/* 保留已存在的上下文、scope、loop detection */ interactions];
const loop = createAgentLoop({ /* 保留 model / system / messages / tools */ ...composeCapabilities(capabilities) });
loop.subscribe(createRunEventProjector({ runId, emit })); // 此步还保留旧编码，S-002 删除。
loop.subscribe(recorder.observe);
await loop.run(signal);
// 先检查 pending.failure，存在则 result=failed；之后才按 signal 判断 aborted。
// pi 会把钩子抛错转成工具错误，不能仅靠 throw 让整个 run 失败。
// 原有独立收尾仍执行；pending.dispose 放 finally，waiting 不再跳过 recorder.end。
```

`stream/event-projector.ts` 此步删除 parked 检查，仅保留旧字段编码与错误提取；其函数暂时仍需 runId 提供旧 messageId，装配调用保留 `{ runId, emit }`。S-002 整个文件删除，不能把旧过滤路径继续带进原生协议。

#### `src/main/agent/runtime/runner.ts`

active 项持有 runId、AbortController、pending、settled 和只读事件订阅。审批响应只路由到已有实例。所有入口复用同一个 active 校验；等待时不能再次 start，也不能并行 compact 该线程。

```ts
type ActiveRun = {
  runId: string;
  abort: AbortController;
  pending: PendingInteractions;
  settled: Promise<RunOutcome>;
};

function respond(threadId: string, input: DecideInteraction) {
  const run = active.get(threadId);
  if (!run || run.runId !== input.runId || run.abort.signal.aborted) {
    throw new InteractionConflict('The interaction is no longer active.');
  }
  return run.pending.respond(input);
}

function abort(threadId: string): boolean {
  const run = active.get(threadId);
  if (!run) return false;
  run.pending.cancel('user_cancelled');
  return true;
}
```

start 仍同步校验模型并返回 RunHandle，不等待审批。删除 resume / settle。RunHandle 增加 `subscribe(listener): () => void`：与传输接收相同的原生/业务事件，不取代 recorder，不允许观察者修改事件；观察者抛错只记录日志，不使已保存的决定回滚。事件订阅在 start 返回后的异步执行开始前可建立；请求必须先经过异步 session 装配。完成后清理观察者。

#### `src/main/conversation/session-recorder.ts`

移除 resuming / park / parked set；所有 pi message_end 的真实 toolResult 都正常记录。用已有 Session.appendEntry 写交互请求及终态，Entry ID 按 interactionId + 阶段稳定生成，单 run 内重复响应不重复写。

```ts
async function interactionRequested(request: InteractionRequest): Promise<void> {
  await session.appendEntry({
    id: `${request.id}:requested`, type: 'custom', customType: 'atrium.interaction',
    data: durable({ phase: 'requested', request }),
  }, 'main');
}

async function interactionResolved(request: InteractionRequest, outcome: InteractionOutcome): Promise<void> {
  await session.appendEntry({
    id: `${request.id}:resolved`, type: 'custom', customType: 'atrium.interaction',
    data: durable({ phase: 'resolved', request, outcome }),
  }, 'main');
}
```

#### `src/main/conversation/project.ts`

按 custom entry 顺序折叠 requested/resolved，而不是见过审批标记就永远显示待批。只有未解决请求可以恢复为交互卡片，拒绝、取消、超时必须恢复为终态。工具成功/失败仍以真实 toolResult 为准。

```ts
function toolStatesOf(entries: Entry[]): Record<string, unknown> {
  const states = new Map<string, InteractionState>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== 'atrium.interaction') continue;
    // 校验 entry.data；同一 interactionId 后写的 resolved 覆盖 requested。
    applyInteractionEntry(states, entry.data);
  }
  // 转换成现有 UI extras；保留 id、审批决定与中断原因，不修改 pi 消息。
  return toToolStateExtras(states);
}
```

#### `src/main/conversation/ui-messages.ts`

审批拒绝来自交互决定，而不是等待某个后端补上 details.denied。询问终态同样不能因为缺少工具结果而继续显示可提交表单。ToolStateExtras 的已知状态增加 errorText / 交互决定字段，从共享交互类型推导，不再用无约束对象猜字段。

现有 run 的 toolStates 只挂在第一条 assistant row 的 metadata，但后续 turn 也可能请求审批。mergeAssistantMessage 必须先收集 run 级 extras，再在每个 turn 中查找，不能只读取当前 row 的 metadata。

```ts
// mergeAssistantMessage：放在遍历 assistantRows 之前，删掉循环内的同名局部变量。
const toolStates = Object.assign({}, ...rows.map((row) => row.metadata?.toolStates ?? {})) as ToolStateExtras;
```

```ts
// mergeToolPart 中，在构造 base 后先处理已记录的交互终态。
if (extra?.state === 'output-denied') {
  return { ...base, state: 'output-denied', approval: extra.approval } as Part;
}
if (!result && extra?.state === 'output-error') {
  return { ...base, state: 'output-error', errorText: extra.errorText } as Part;
}
// 正常 toolResult 合并保留；S-002 将错误提取统一改为 content。
```

#### `src/main/api/http.ts`

提取 `createChatApp(deps)` 返回 Hono 实例供 app.request 集成测试，startHttpServer 仅负责监听。保持 token 中间件。旧 `/resume` 删除，decisions 不再启动 SSE 或直接写结果。

```ts
app.post('/api/chat/:threadId/decisions', async (c) => {
  // 在现有 token 中间件之后限制 body 大小；解析失败、非 JSON 或非法结构返回 400。
  const parsed = decideInteractionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_decision' }, 400);
  try {
    const status = deps.runner.respond(c.req.param('threadId'), parsed.data);
    return c.json({ status }, 202);
  } catch (error) {
    if (error instanceof InteractionConflict) return c.json({ error: error.message }, 409);
    if (error instanceof InvalidInteractionDecision) return c.json({ error: error.message }, 400);
    throw error;
  }
});
```

#### `src/renderer/src/lib/pi-chat/reduce.ts`

维护请求与决定的消费状态，供 PiChat 根据 interactionId 提交；请求到达只显示等待，不能把 run 标成完成。resolved 不代表工具已成功，仍要等 pi 的真实结果。拒绝/取消状态不能被随后通用错误覆盖。

```ts
case 'interaction_requested': {
  this.interactions.set(event.request.id, { request: event.request, outcome: undefined });
  this.applyInteractionState(event.request, undefined);
  break;
}
case 'interaction_resolved': {
  this.interactions.set(event.request.id, { request: event.request, outcome: event.outcome });
  this.applyInteractionState(event.request, event.outcome);
  break;
}
```

#### `src/renderer/src/lib/pi-chat/store.ts`

删除 maybeAutoResume、decisionsOf、toolRoundComplete、审批完成后开新流的逻辑。审批/回答用单独短 HTTP 请求，不调用 begin、不打断现有 SSE、不检查 isBusy 来拒绝决定。请求结果由后端事件确认；网络失败保持可重试卡片，不能乐观标记工具成功。

```ts
private async submitDecision(interactionId: string, decision: InteractionDecision): Promise<void> {
  const request = this.run?.interaction(interactionId);
  if (!request) throw new Error('The interaction is no longer active.');
  const res = await this.fetchFn(`${this.init.baseUrl}/api/chat/${this.threadId}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-atrium-token': this.init.token },
    body: JSON.stringify({ runId: request.runId, interactionId, decision }),
  });
  // 每个请求单独记录 submitting/error；不能调用会丢弃 live assembler 的 failWith。
  if (!res.ok) throw new Error(`Decision was not accepted (${res.status}).`);
}
```

保留现有 addToolApprovalResponse / addToolOutput 作为 UI 方法名也可以，但实现必须定位真实请求并调用 submitDecision。addToolOutput 的 cancelled 转为 cancelled 决定；answers 仅提交 answer 字符串。双击用请求级 submitting 状态抑制，服务端仍做幂等校验。

stop 改为先请求服务器 abort，并继续消费最终事件再结束本地 run；不能先把流断掉就认为服务器停止成功。abort HTTP 失败显示可重试错误且仍视作运行中；换页销毁订阅则仅 detach，不调用服务器 abort。

#### `src/renderer/src/lib/use-approvals.ts`

保留现有三个按钮。always 仍保存当前请求衍生出的信任规则；保存失败不放行。决定提交期间的失败展示在该请求上，不销毁聊天流。

```ts
const decide = async (id: string, action: 'allow_once' | 'allow_always' | 'reject_once') => {
  const approval = approvals.find((item) => item.approvalId === id);
  if (!approval) return;
  if (action === 'allow_always' && approval.rule) await addRule.mutateAsync(approval.rule);
  await addToolApprovalResponse({ id, approved: action !== 'reject_once' });
};
```

#### `src/renderer/src/routes/_app/chat/$threadId.tsx`

停止和取消询问都走 PiChat 的单一路径；删除路由内第二次发 decisions、提前 seal 本地消息等旁路。UI 回调处理 Promise rejection，不能静默吞掉错误。

```ts
const onStop = () => { void chat.stop(); }; // stop 内记录并展示请求失败。
const onCancelClarify = (toolCallId: string) => {
  void chat.addToolOutput({ toolCallId, output: { answers: [], cancelled: true } });
};
```

#### `src/renderer/src/lib/assistant-view.ts`

询问工具进入终态后不再显示可编辑的等待表单；取消沿用已有 cancelled 展示，错误/中断展示其实际文字。调整 toClarifySegment 返回类型，使错误分支能返回已有 narrative 段，无需新增视觉组件。

```ts
if (part.state === 'output-error') {
  return { kind: 'narrative', id: `interaction-${part.toolCallId}`, content: part.errorText };
}
```

#### `src/main/agent/automation/run.ts`

定时任务沿用同一 RunHandle 等待至真正完成。使用业务事件识别待交互区间，释放/重新获取防休眠锁；订阅不启动新 run。多个待决请求按 ID 计数。

```ts
const handle = deps.runner.start(request);
const pending = new Set<string>();
let release: (() => void) | undefined = blockSuspension();
const unsubscribe = handle.subscribe((event) => {
  if (event.type === 'interaction_requested') pending.add(event.request.id);
  if (event.type === 'interaction_resolved') pending.delete(event.request.id);
  if (pending.size > 0) { release?.(); release = undefined; }
  else if (!release) release = blockSuspension();
});
try {
  return toScheduledOutcome(await handle.settled); // 保留现有 outcome 映射。
} finally {
  unsubscribe();
  release?.();
}
```

真实代码在 start / subscribe 失败时也须释放锁；结束或取消后不再重新获取。scheduler 管理器原有同任务并发保护不改；测试确认等待期间新的 tick 不会再调用 Runner.start。

#### 删除与小接线

- 删除 `src/main/agent/runtime/tool-resolutions.ts`、`src/main/agent/runtime/test/tool-resolutions.test.ts`：旧工具不再由外层执行。
- `src/main/conversation/history.ts` 删除 withSettledResults；`src/main/conversation/test/history.test.ts` 移除专测替换占位的用例，保留中断修复测试。
- `src/main/conversation/threads.ts` 删除仅用于旧接口的 openThreadCalls / settleThreadCalls；openToolCalls 保留给恢复使用。
- `src/main/agent/runtime/README.md` 更新职责；相关组件注释中的 auto-resume 说明移除。
- `src/main/agent/automation/manager.test.ts` Runner stub 删除 resume/settle，补 respond 与 RunHandle.subscribe；这是接口接线，不改变调度逻辑。

#### 测试文件与关键断言

新增 `src/main/agent/runtime/test/pending-interactions.test.ts`，直接使用上面的公开接口验证首个决定、重复提交、类型匹配、取消竞争和清理；不 mock pi 行为。

```ts
test('one decision wins and identical retries do not execute anything', async () => {
  const abort = new AbortController();
  const inbox = createPendingInteractions({ runId: 'r1', abort });
  const waiting = inbox.open('approval', { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} });
  const input = { runId: 'r1', interactionId: waiting.request.id, decision: { kind: 'approved' as const } };
  expect(inbox.respond(input)).toBe('accepted');
  expect(inbox.respond(input)).toBe('already_accepted');
  await expect(waiting.response).resolves.toEqual({ kind: 'approved' });
  expect(() => inbox.respond({ ...input, decision: { kind: 'denied' } })).toThrow();
  inbox.dispose();
});
```

`src/main/agent/runtime/test/runner.cases.ts` 改写现有“park 后 resume”测试。fixture 使用 faux provider、临时 SQLite 和被监视的 LocalSandbox.exec；监听 interaction_requested 后再提交决定，不靠 sleep 猜测请求是否到了。

```ts
test('approval continues the original run and executes only once', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({ output: 'ok', exitCode: 0 });
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('bash', { description: 'approval', command: 'curl https://example.invalid' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  const requested = deferred<InteractionRequest>();
  const handle = runner.start(f.request);
  const unsubscribe = handle.subscribe((event) => {
    if (event.type === 'interaction_requested') requested.resolve(event.request);
  });
  const request = await requested.promise;
  expect(runner.isRunning('t1')).toBe(true);
  expect(exec).not.toHaveBeenCalled();
  expect(runner.respond('t1', { runId: handle.runId, interactionId: request.id, decision: { kind: 'approved' } })).toBe('accepted');
  expect((await handle.settled).status).toBe('ok');
  expect(exec).toHaveBeenCalledTimes(1);
  expect(runner.isRunning('t1')).toBe(false);
  unsubscribe();
  await runner.dispose();
});
```

`src/main/agent/runtime/test/execute-run.cases.ts` 的直接调用装配 pending（由同一个 AbortController 创建）。修改原 waiting / resume 断言，增加“一次 operation_started / operation_finished、无占位错误、一次询问真实结果”的完整 session 断言。

```ts
expect(records.filter((record) => record.type === 'operation_started')).toHaveLength(1);
expect(records.filter((record) => record.type === 'operation_finished')).toHaveLength(1);
expect(entries.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult')).toHaveLength(1);
```

`src/main/conversation/test/session-recorder.test.ts`、`src/main/conversation/test/project.test.ts` 各自用现有真实 Session fixture 替换 parked 数据；前者断言只写一次终态，后者断言 requested→denied 的读回状态。两个文件分别保留以下可观察断言，而不是只检查内部 helper 被调用。

```ts
// session-recorder.test.ts：entries 来自该文件已有 read(session)。
expect(entries.filter((entry) => entry.type === 'custom' && entry.customType === 'atrium.interaction')).toHaveLength(2);
```

```ts
// project.test.ts：读取相同 session 的 entries / records 后投影。
const messages = projectMessages(entries, records);
expect(messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ toolCallId: 'call-1', state: 'output-denied' }));
```

新增 `src/main/api/test/http.test.ts`：用 createChatApp().request 覆盖 token、结构、过期 run、决定类型与重复提交，确认 decisions 不调用 start。

```ts
expect((await app.request('/api/chat/t1/decisions', { method: 'POST', body: '{}' })).status).toBe(401);
expect((await app.request('/api/chat/t1/decisions', authenticatedInvalidDecision)).status).toBe(400);
expect((await app.request('/api/chat/t1/decisions', authenticatedValidDecision)).status).toBe(202);
expect(start).not.toHaveBeenCalled();
```

将本次修改的 `src/renderer/src/lib/pi-chat/tests/store.test.ts`、`tests/reduce.test.ts` 移到同目录下的 **test/**，符合统一测试目录约定；不顺手搬迁其他模块的所有旧测试。

`src/renderer/src/lib/pi-chat/test/store.test.ts` 用可控 ReadableStream 保持原 POST 未关闭，在流活跃时点击审批，断言只出现一次启动、一次 decisions，原流接着收到工具结果。

```ts
expect(chat.isBusy).toBe(true);
await chat.addToolApprovalResponse({ id: request.id, approved: true });
expect(calls.filter((call) => call.url.endsWith('/api/chat'))).toHaveLength(1);
expect(calls.filter((call) => call.url.endsWith('/decisions'))).toHaveLength(1);
expect(calls.some((call) => call.url.endsWith('/resume'))).toBe(false);
expect(chat.isBusy).toBe(true);
```

`src/renderer/src/lib/pi-chat/test/reduce.test.ts` 验证 resolved 只是解除审批状态，不伪造工具成功；拒绝不会被随后的 pi 阻止错误覆盖。

```ts
assembler.apply({ type: 'interaction_resolved', request, outcome: { kind: 'denied', reason: 'No' } });
assembler.apply(blockedToolEnd);
expect(assembler.snapshot().message?.parts).toContainEqual(expect.objectContaining({ toolCallId: request.toolCall.id, state: 'output-denied' }));
```

新增 `src/main/agent/tools/test/define.test.ts` 验证取消入口（现有 schema / define 测试继续回归）；新增 `test/ask-clarification.test.ts` 验证答案原生返回、取消与不可用执行上下文。

```ts
// tools/test/define.test.ts：tool 由 defineTool 创建，execute 为可观测副作用。
abort.abort();
await expect(tool.execute('c1', {}, abort.signal)).rejects.toThrow();
expect(execute).not.toHaveBeenCalled();
```

```ts
// tools/test/ask-clarification.test.ts：ask 为可控 Promise。
const executing = tool.execute('c1', { questions }, abort.signal);
answer.resolve({ content: [{ type: 'text', text: 'Selected A' }], details: result });
expect(await executing).toEqual({ content: [{ type: 'text', text: 'Selected A' }], details: result });
```

新增 `src/main/agent/automation/test/run.test.ts`，用可控 RunHandle 模拟请求和决定，断言 pending 期间未报告完成、释放防休眠，解决后恢复执行锁且最终清理。现有 manager 测试另外覆盖不重叠调度。

```ts
emit({ type: 'interaction_requested', request });
expect(release).toHaveBeenCalledTimes(1);
expect(completed).toBe(false);
emit({ type: 'interaction_resolved', request, outcome: { kind: 'approved' } });
expect(blockSuspension).toHaveBeenCalledTimes(2);
```

**验证：** `bun test src/main/agent/runtime/test src/main/conversation/test src/main/api/test src/main/agent/tools/test src/main/agent/automation/test src/renderer/src/lib/pi-chat/test`；另跑 `bun test src/main/agent/automation/manager.test.ts src/main/agent/tools/schema.test.ts src/main/agent/subagent/run.test.ts` 与两端 typecheck。关键补充用例：混合工具批次中取消审批，先通过检查但尚未开始的工具执行次数为零；拒绝会让模型读到拒绝原因；回答只产生一个 toolResult；重连不创建第二个 Agent。保留测试输出作为证据。

**建议提交：** `refactor(agent): await user interactions within active runs`

### S-002 — 完整转发原生事件，展示逻辑回到消费者

先替换协议类型并固定事件快照，再同时修改发送方和消费者。S-001 已删除正常等待产生的占位错误，因此不需要在前端搬一套“隐藏等待错误”的兼容逻辑。此步删除两个 projector 和错误补字段工具。

#### `src/shared/protocol/messages.ts`

只重导出 pi-ai 已有类型，不手抄字段。Content 只是已有内容类型的联合，供 UI 的通用文本/图片 helper 使用；不能为了“未来兼容”继续把已知字段降为 unknown。

```ts
import type { ImageContent, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
export type {
  AssistantMessage, ImageContent, Message, StopReason, TextContent,
  ThinkingContent, ToolCall, ToolResultMessage, Usage, UserMessage,
} from '@earendil-works/pi-ai';
export type Content = TextContent | ThinkingContent | ToolCall | ImageContent;
export type KnownContent = Content;
```

pi 的 AgentEvent 自身仍引用 AgentMessage，因而自定义角色没有被缩窄成 pi-ai.Message；这与上面的模型消息辅助类型是两个不同用途。

#### `src/shared/protocol/events.ts`

AgentSessionEvent 是原生 pi 事件与独立 Atrium 事件的联合；只有应用事件由我们定义。沿用现有 v/seq 信封，不新增旧版本解码器。主进程和 renderer 同次发布。

```ts
import type { AgentEvent, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { InteractionEvent, RunStopReason } from '../interactions';
export type { AssistantMessageEvent } from '@earendil-works/pi-ai';
export type ToolExecutionResult = AgentToolResult<unknown>;
export type RunCompletion =
  | { status: 'completed' }
  | { status: 'aborted'; reason: RunStopReason }
  | { status: 'failed'; error: string };
export type AgentSessionEvent =
  | AgentEvent
  | InteractionEvent
  | { type: 'run_started'; runId: string }
  | ({ type: 'run_finished' } & RunCompletion)
  | { type: 'notice'; name: string; payload: unknown };
export type EventEnvelope = { v: 1; seq: number; event: AgentSessionEvent };
export const PROTOCOL_VERSION = 1 as const;
```

run_started 是每个日志 seq=0 的一次性元信息。新建前端 assembler 必须从 seq=-1 重放；已有 assembler 才能按 seq 续读。当前前端沿用完整重放，不能只拿后半段却丢失 runId；若以后支持增量重连，必须把 runId 与 cursor 一起校验，不能拿旧 run 的 seq 跳过新 run 数据。

#### `src/main/agent/runtime/stream/run-event-buffer.ts`

append 时完成 JSON 序列化及 UTF-8 编码，之后缓存/重放同一帧。不存活的可变事件引用，不给每个消费者重复编码。buffer 不解释消息角色、不抽取错误、不删字段。

```ts
type Frame = { seq: number; bytes: Uint8Array };

const append = (event: AgentSessionEvent) => {
  if (threadLog.ended) return;
  const seq = threadLog.frames.length;
  const envelope: EventEnvelope = { v: 1, seq, event };
  const bytes = encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`);
  const frame: Frame = { seq, bytes };
  threadLog.frames.push(frame);
  for (const listener of threadLog.listeners) listener(frame);
};

// subscribe 的 replay 和 live listener 都只 enqueue(frame.bytes)。
// 不能序列化的自定义 result 使运行明确失败，不能静默删除 content 或整条事件。
```

RunHandle.subscribe 的进程内观察与 SSE 来自同一次 append，但不复用可被观察者写坏的原始 pi 引用：只读观察快照按需从同帧 JSON 解析一次。没有进程内观察者时不额外解析。不能把 Uint8Array 交给可修改它的业务观察者。

#### `src/main/agent/runtime/execute-run.ts`

最早发 run_started，订阅时原样传递 pi 事件。真实 pi agent_end 后仍可以有元数据事件，最后才是 run_finished；准备失败不能伪造一次根本没有启动的 Agent。

```ts
emit({ type: 'run_started', runId });
// 保留现有 try/catch、独立收尾以及 recorder 的 awaited 行为。
loop.subscribe(emit);
loop.subscribe(recorder.observe);
await loop.run(signal);
// reportUsage / recorder.end / 资源清理完成后，result 已包含收尾失败。
emit({ type: 'run_finished', ...toRunCompletion(result, signal.reason) });
return result;
```

run_started 在 executeRun 的受保护执行范围内发送。buffer 本身异常或准备失败也必须让 settled 结束；一次执行最多一个 run_finished。晚到的标题任务仍可写标题，但不能在流关闭后继续发事件。Runner 的 RunOutcome 继续使用现有 ok/error 映射，不因此更换定时任务持久化结构。

#### `src/renderer/src/lib/pi-chat/reduce.ts`

run_started 决定运行身份；仅 assistant 消息组织回复步骤。工具执行结果只选 tool_execution_end 作为此 UI 的消费入口，收到同一结果的 message_end(toolResult) 不重复生成卡片；这些事件仍完整存在于流中，其他消费者可以使用。

```ts
case 'run_started':
  this.id = event.runId;
  break;
case 'message_start':
  if (event.message.role !== 'assistant') break;
  this.parts.push({ type: 'step-start' });
  this.started = true;
  this.turnParts = new Map();
  break;
case 'message_end':
  if (event.message.role === 'assistant') this.syncTurn(event.message);
  break;
case 'agent_end':
  // pi 结束不代表应用的持久化、用量与错误收尾已经结束。
  break;
case 'run_finished':
  this.ended = true;
  if (event.status === 'failed') this.failure = event.error;
  break;
```

text/thinking 继续消费 delta，message_end 同步最终内容；不能同时把 outer message 和 partial 再追加一次。turn_end 的完整 message/toolResults 对这个 UI 不增加步骤，忽略即可。

```ts
case 'toolcall_start':
case 'toolcall_delta': {
  const call = update.partial.content[update.contentIndex];
  if (call?.type !== 'toolCall' || !call.id || !call.name) break;
  this.openOrUpdateToolInput(update.contentIndex, call);
  break;
}
// toolcall_end 仍用 update.toolCall 完成参数和身份校准，不能制造第二张卡片。
```

openOrUpdateToolInput 按本 turn 的 contentIndex 与 run 内 toolCallId 关联；某供应商早期尚未给出完整 ID 时推迟创建工具卡片，后续 delta/end 再补，不能向标准事件塞一个自造 toolCallId。

```ts
// endTool 错误分支：先保留已知的用户拒绝/取消语义，否则直接取 content。
this.patchTool(toolCallId, toolName, {
  state: 'output-error',
  errorText: contentText(result.content).trim() || 'Tool failed.',
});
```

#### `src/renderer/src/lib/pi-chat/store.ts`

从 run_started 建立当前 run 身份，完整重放以该 ID 替换历史中的同一条 assistant 消息；不再依赖 messageId 或 seed 一个已经结束的审批 run。SSE 断开不等于 run_finished，保留已接收内容和重连能力。

```ts
const envelope = JSON.parse(frame.slice('data: '.length)) as EventEnvelope;
if (envelope.seq <= this.lastSeq) continue;
this.lastSeq = envelope.seq;
this.run?.apply(envelope.event);
if (envelope.event.type === 'run_finished') {
  // 记录已见明确终态；结束读取后再统一合并 history，不在 agent_end 上提前结算。
  finished = true;
}
// 流 EOF 且未收到 run_finished：标记连接中断，可重连；不得显示为运行成功。
```

`src/renderer/src/lib/pi-chat/use-pi-chat.ts` 若需给错误重试/取消暴露 Promise，仅做方法接线，不引入另一套状态机。前端新建 assembler 后从 -1 重放，既避免多次追加，也保证 run_started 不丢失。

#### `src/main/conversation/ui-messages.ts`

历史视图是标准数据的另一个消费者，也直接从原生 content 提取错误；不要求 session 里多存一份 details.errorText。

```ts
Object.assign(base, {
  state: 'output-error',
  errorText: contentText(result.content).trim() || 'Tool failed.',
});
```

`src/shared/protocol/helpers.ts` 继续复用现有 contentText；仅适配新的 type-only imports，不创建第二套错误转换 helper。正常工具的 details 保持原样，图片和结构化输出不受影响。

#### 删除文件

- `src/main/agent/runtime/stream/projector.ts`
- `src/main/agent/runtime/stream/event-projector.ts`
- `src/main/agent/runtime/stream/tool-result.ts`
- `src/main/agent/runtime/test/stream/tool-result.test.ts`

删除对应导入；README 同步更新。原生事件不再经过业务过滤或字段转换，持久化观察仍是独立订阅。

#### 测试文件与关键断言

`src/main/agent/runtime/test/stream/run-event-buffer.test.ts` 使用完整 AgentEvent fixture，增加快照、字节一致性与订阅取消不终止生产者测试。下面测试可直接使用 pi-ai 的 fauxAssistantMessage 和当前 buffer 的 produce/subscribe。

```ts
test('replay preserves the content at append time', async () => {
  const message = fauxAssistantMessage('A');
  await buffer.produce('t1', async ({ append }) => {
    append({ type: 'message_update', message,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'A', partial: message } });
    if (message.content[0]?.type === 'text') message.content[0].text = 'AB';
  });
  const frames = await readEnvelopes(buffer.subscribe('t1', -1)!);
  expect(frames[0].event).toMatchObject({
    message: { content: [{ type: 'text', text: 'A' }] },
    assistantMessageEvent: { partial: { content: [{ type: 'text', text: 'A' }] } },
  });
});
```

`src/main/agent/runtime/test/execute-run.cases.ts` 验证完整事件，不再断言 partial 被删除。直接从 pi 的测试订阅即时序列化得到对照快照，不能拿后续已被修改的对象作期望值。

```ts
expect(events[0]).toMatchObject({ type: 'run_started', runId: 'r1' });
expect(events.at(-1)?.type).toBe('run_finished');
expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
expect(events.find((event) => event.type === 'agent_end')).toHaveProperty('messages');
const update = events.find((event) => event.type === 'message_update');
expect(update).toHaveProperty('message');
expect(update).toHaveProperty('assistantMessageEvent.partial');
```

增加准备失败测试：没有 AgentEvent，run_finished.status 为 failed；增加 agent_end 之后 recorder/usage 失败测试：原生 agent_end 不变，最终业务事件正确报告失败。

`src/renderer/src/lib/pi-chat/test/reduce.test.ts` 直接构造满足 `AgentEvent` 的原生事件，不再使用断言强行塞入缺字段对象。覆盖 user 回声、工具结果双入口、toolcall_start ID 从 partial 读取，以及 agent_end 后仍在收尾。

```ts
assembler.apply({ type: 'agent_end', messages: [] });
expect(assembler.snapshot().status).toBe('streaming');
assembler.apply({ type: 'run_finished', status: 'completed' });
expect(assembler.snapshot().status).toBe('done');
```

`src/renderer/src/lib/pi-chat/test/store.test.ts` 的 open/close fixture 改为 run_started 和 run_finished；验证重放仍只得到一个 run 对应的一条回复。

```ts
expect(chat.getSnapshot().messages.filter((message) => message.id === runId)).toHaveLength(1);
expect(calls.filter((call) => call.url.endsWith('/api/chat'))).toHaveLength(1);
```

`src/main/conversation/test/project.test.ts` 工具错误 fixture 只提供 content 和 isError，details 不含 errorText，验证历史展示与实时消费一致。

```ts
expect(projectMessages(entries, records).at(-1)?.parts).toContainEqual(
  expect.objectContaining({ state: 'output-error', errorText: 'Permission denied' }),
);
```

新增 `src/main/agent/runtime/test/stream/native-events.test.ts`，用真实 createAgentLoop + faux provider 比较原生流与 SSE 解码结果，覆盖 text/thinking、工具、错误和取消；除 JSON 正常的 undefined 省略之外不能改变字段。

```ts
expect(decodedPiEvents).toEqual(nativeSnapshots);
expect(nativeResult.details).toEqual(originalDetails);
```

新增 `src/main/agent/runtime/test/stream/native-events.bench.ts`，通过 `bun run` 显式执行而非混入普通测试：固定 50 KiB 最终正文、1,000 个均匀增量，比较原始事件、编码缓存和解码耗时；追加一个含 1 MiB 图片结果的工具事件。输出总字节数、峰值 RSS、append/完整重放耗时；这些是合成负载，不冒充真实供应商性能。

```ts
// 固定 seed，正文逐步增长；每帧都包含 message 和 partial。
// 使用真实 createRunEventBuffer append / subscribe 测量完整保留字段的路径。
const bytes = await new Response(buffer.subscribe('benchmark', -1)).arrayBuffer();
console.info({ wireBytes: bytes.byteLength, rss: process.memoryUsage().rss, appendMs, replayMs });
```

**验证：** `bun test src/main/agent/runtime/test src/main/conversation/test src/renderer/src/lib/pi-chat/test`；`bun run src/main/agent/runtime/test/stream/native-events.bench.ts`；`bun run typecheck:node`、`bun run typecheck:web`、`bunx electron-vite build`。性能结果必须保留，不能只写“通过”；类型检查与 renderer 构建必须证明 type-only 引用没有引入 Node-only pi 运行代码。

**建议提交：** `refactor(agent): preserve native pi events end to end`

### S-003 — 明确中断结果与退出顺序，恢复不重执行

先验证缺结果的会话在重新打开后可安全用于下一轮，再把修复放到原 run 收尾和新 run 的 begin 之前，最后调整主进程退出顺序。不会在正常等待期间调用历史修复，也不会因为 SSE 无订阅者就补一条工具错误。

#### `src/main/conversation/history.ts`

保留已存在的真实结果，只为无结果的调用构造 pi 原生 ToolResultMessage。区分明确未批准与已批准但执行状态未知；不复制错误到 details.errorText。此函数不执行任何工具。

```ts
export function sealDanglingToolCalls(
  messages: Message[],
  reasonFor: (call: ToolCall) => string = () => 'The previous execution was interrupted; the tool outcome is unknown.',
): Message[] {
  const answered = new Set(messages.flatMap((message) => message.role === 'toolResult' ? [message.toolCallId] : []));
  const out: Message[] = [];
  for (const message of messages) {
    out.push(message);
    if (message.role !== 'assistant') continue;
    for (const call of message.content) {
      if (call.type !== 'toolCall' || answered.has(call.id)) continue;
      answered.add(call.id);
      out.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: reasonFor(call) }], isError: true, timestamp: message.timestamp });
    }
  }
  return out;
}
```

reasonFor 只由 conversation 根据持久化的 interaction / run_stop 状态推导，不接受来自用户的任意“执行结果”。已有明确拒绝/取消原因优先；不可把未知结果描述成成功或“肯定没执行”。

#### `src/main/conversation/recovery.ts`（新增）

按 operation 的 seq 范围读取原 run 的调用、已有结果与交互终态，保存缺失结果，再关闭原 operation。用 Session 的 writer lease 保证唯一写入者；每个补写使用 runId + toolCallId 生成稳定 Entry ID。不能只扫描 open operation：原代码可能已写 operation_finished 却还有缺结果，需要在读取可运行历史时保持最后一道纯修复保护。

```ts
export async function recoverInterruptedRun(session: Session, runId: string, reason: RunStopReason): Promise<void> {
  // 使用现有 findRecords / findEntriesOnBranch 得到该 run 的 seq 区间与消息。
  const interrupted = await readRunForRecovery(session, runId);
  const existing = new Set(interrupted.messages.flatMap((message) => message.role === 'toolResult' ? [message.toolCallId] : []));
  const repaired = sealDanglingToolCalls(interrupted.messages, (call) => interruptionText(interrupted, call, reason));
  for (const message of repaired) {
    if (message.role !== 'toolResult' || existing.has(message.toolCallId)) continue;
    await session.appendEntry({ id: `${runId}:interrupted:${message.toolCallId}`, type: 'message', message: durable(message) }, 'main');
    existing.add(message.toolCallId);
  }
  // 缺失的 requested 终态写为 interrupted；已有决定不覆盖。
  // 原 run 尚未关闭才追加 operation_finished；幂等重试不得重复结果。
  await closeRecoveredOperation(session, interrupted, reason);
}
```

若恢复中途崩溃，下次先读取已存在的结果/终态后继续；没有并发写入者时 check + append 足够，确定性 Entry ID 是额外防线。不得调用底层原始 SQL 来改写已保存 pi 消息。

#### `src/main/conversation/session-recorder.ts`

begin 必须先恢复此前尚未完成的 operation，再创建新的 operation_started / 写新 prompt；这样补写的结果仍归属旧 run，不落到新用户消息之后。end 在正常完成时不补错误；只有中断时补齐缺口、保存已知 reason，然后关闭 operation。

```ts
async function begin(prompt?: { id: string; message: Message }) {
  for (const open of await session.findOpenOperations('main')) {
    await recoverInterruptedRun(session, open.id, 'interrupted');
  }
  // 此后才执行现有 operation_started 与 prompt 写入。
  await beginNewOperation(prompt);
}

async function end(outcome: RunOutcome, reason?: RunStopReason) {
  if (!operationOpen) return;
  if (outcome === 'aborted') {
    await recordRunStop(runId, reason ?? 'interrupted');
    await recoverInterruptedRun(session, runId, reason ?? 'interrupted');
  } else {
    // failed 也可能留下缺口：保存失败原因并修复，真实完成不补结果。
    await finishOrRepairOperation(outcome);
  }
  operationOpen = false;
}
```

这个文件里的 RunOutcome 是其现有 completed / aborted / failed 类型，不是 Runner 的 ok/error 类型。记录失败必须向 executeRun 传播，不能伪装为正常结束；退出时来不及完成则由下次恢复。

#### `src/main/conversation/threads.ts`

保留 runnableHistory 的纯修复防线；提供已知 reason 的推导来源，不能把所有缺失结果统一写成用户拒绝。历史只读查询不恢复或执行工具；实际持久化恢复由 recorder.begin/end 驱动。

```ts
export function runnableHistory(entries: Entry[]): Message[] {
  const messages = projectHistory(entries);
  return sealDanglingToolCalls(messages, (call) => interruptionTextFromEntries(entries, call));
}
```

#### `src/main/agent/runtime/runner.ts`

dispose 变成幂等 Promise：同步停止接纳、取消全部活跃 run 并清理等待，异步等待各 settled 完成。取消的原因使用 app_shutdown，不借用普通工具拒绝。调用多次返回同一关闭 Promise。

```ts
function dispose(): Promise<void> {
  if (disposing) return disposing;
  disposed = true;
  const running = [...active.values()];
  for (const run of running) run.pending.cancel('app_shutdown');
  bgShells.killAll();
  disposing = Promise.allSettled(running.map((run) => run.settled)).then(() => undefined);
  return disposing;
}
```

`execute-run.ts` 仅把原始 signal.reason 传给 recorder.end 和 run_finished；错误归一化只处理已知枚举，未知原因记 interrupted。其余收尾仍各自执行，第一项失败不能阻止后面的录制或清理。这里是调用参数接线，不新增一套取消协议。

#### `src/main/shutdown.ts`（新增）

进程退出顺序属于主进程，不放进 platform 或 conversation。此文件执行退出流程，依赖仍由 index 装配；一个普通异步函数，不新增生命周期框架。使用实际服务对象的窄类型，而非大量无名回调。

```ts
export async function shutdown(deps: {
  runner?: Pick<Runner, 'dispose'>;
  scheduled: Pick<typeof scheduledManager, 'dispose'>;
  mcp: Pick<typeof mcpManager, 'dispose'>;
  updater: Pick<typeof updaterManager, 'dispose'>;
}, drainMs = 3000): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>) => {
    try { await operation(); } catch (error) { errors.push(error); }
  };
  await attempt(() => deps.scheduled.dispose());
  // drainWithin 超时抛错且 clearTimeout；3 秒是等待 run 收尾的上限，不是杀进程保证。
  await attempt(() => drainWithin(deps.runner?.dispose() ?? Promise.resolve(), drainMs));
  await attempt(() => deps.mcp.dispose());
  await attempt(() => deps.updater.dispose());
  await attempt(() => disposeComputerUseHelper());
  await attempt(() => closeSessionStore());
  await attempt(() => closeDb());
  if (errors.length) throw new AggregateError(errors, 'Application shutdown was incomplete');
}
```

超时只意味着转为 best-effort 退出，不承诺所有不响应取消的第三方工具已终止。dispose 的晚到 rejection 必须被接住；下次恢复不得自动重执行这些不确定操作。数据库关闭函数沿用现有模块，不移动其 ownership。

#### `src/main/index.ts`

第一次 before-quit 阻止立即退出，等待 shutdown；重复触发复用同一次流程。只有收尾结束后才允许第二次 app.quit 真正退出。窗口隐藏不走此路径。

```ts
let closing: Promise<void> | undefined;
let shutdownComplete = false;
app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (closing) return;
  isQuitting = true;
  closing = shutdown({ runner, scheduled: scheduledManager, mcp: mcpManager, updater: updaterManager })
    .catch((error) => logShutdownError(error))
    .finally(() => { shutdownComplete = true; app.quit(); });
});
```

#### `src/renderer/src/lib/pi-chat/store.ts`

重启后 GET pi-events 返回 204 表示没有活跃执行；此时历史里遗留的审批/询问只能显示失效，不能继续提交到一个不存在的 Promise。这个显示处理不伪造 pi 事件、不修改数据库；下次新消息触发 recorder.begin 的持久化修复。

```ts
if (res.status === 204) {
  // 仅把仍待交互的旧卡片派生为“上次运行已中断”，已完成工具和正文原样保留。
  this.history = expireInactiveInteractions(this.history);
  this.settle();
  return;
}
```

用户停止成功后也保留服务端最终内容；尚未开始/缺结果工具的展示终态可由 run_finished 的中断信息派生。不能凭前端卡片状态补写工具结果，更不能把停止 HTTP 失败当作停止成功。

#### 测试文件与关键断言

`src/main/agent/runtime/test/pending-interactions.test.ts` 增加可选短超时和已经取消的 signal；等待 Promise 完成就是确定性触发条件，不循环 sleep。

```ts
test('timeout settles the wait and rejects a late approval', async () => {
  const abort = new AbortController();
  const inbox = createPendingInteractions({ runId: 'r1', abort, timeoutMs: 5 });
  const waiting = inbox.open('approval', { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} });
  await expect(waiting.response).resolves.toEqual({ kind: 'interrupted', reason: 'interaction_timeout' });
  expect(abort.signal.aborted).toBe(true);
  expect(() => inbox.respond({ runId: 'r1', interactionId: waiting.request.id, decision: { kind: 'approved' } })).toThrow();
  inbox.dispose();
});
```

新增 `src/main/conversation/test/recovery.test.ts`：复用真实 SQLite Session fixture，模拟保存 requested 后中断、批准记录后结果缺失、已有真实结果、补写一半再次中断。核对每个 toolCallId 最多一个结果，原真实结果不被替换，恢复从不调用工具。

```ts
await recoverInterruptedRun(session, 'r1', 'interrupted');
await recoverInterruptedRun(session, 'r1', 'interrupted');
const entries = await session.findEntriesOnBranch({ order: 'oldestFirst' });
const results = entries.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult');
expect(results.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'c1')).toHaveLength(1);
expect(await session.findOpenOperations('main')).toEqual([]);
```

`src/main/conversation/test/history.test.ts` 保留纯修复幂等及完整历史不变断言；增加 content 精确原因与“不插入第二个结果”。

```ts
const once = sealDanglingToolCalls(messages, () => 'Approval expired; this tool was not executed.');
expect(sealDanglingToolCalls(once)).toEqual(once);
expect(once.find((message) => message.role === 'toolResult')).not.toHaveProperty('details.errorText');
```

`src/main/agent/runtime/test/runner.cases.ts` 增加等待中 dispose，断言有终态、active 清空、工具未执行；dispose 重入不多写 session 终态。

```ts
const shutdown = runner.dispose();
await shutdown;
await runner.dispose();
expect(runner.runningThreadIds()).toEqual([]);
expect(exec).not.toHaveBeenCalled();
expect((await handle.settled).status).toBe('ok');
```

`src/main/conversation/test/session-recorder.test.ts` 增加“旧 run 缺口在新 operation_started 前补齐”，确保 run ID 归属不串。

```ts
expect(repairedResult.seq).toBeLessThan(newOperation.seq);
expect(newPrompt.seq).toBeGreaterThan(newOperation.seq);
```

新增 `src/main/test/shutdown.test.ts`：受控 runner.dispose Promise + mocked 主进程服务，验证 drain 完成前不关库、重复退出只清理一次、drain 超时仍关闭依赖、某清理步骤抛错时其余清理继续。测试宿主必须隔离 Electron mock，不能污染现有 runtime fixture。

```ts
const ending = shutdown(deps, 50);
expect(closeDb).not.toHaveBeenCalled();
drained.resolve();
await ending;
expect(order.indexOf('runner-settled')).toBeLessThan(order.indexOf('close-session-store'));
expect(order.indexOf('close-session-store')).toBeLessThan(order.indexOf('close-db'));
```

`src/renderer/src/lib/pi-chat/test/store.test.ts` 增加旧交互 + 204 重连断言：无活跃审批按钮，正文与已完成工具不变，不发 decisions / resume，也不启动新模型请求。

```ts
expect(getPendingApprovals(chat.getSnapshot().messages)).toEqual([]);
expect(calls.some((call) => call.url.endsWith('/decisions'))).toBe(false);
expect(calls.some((call) => call.url.endsWith('/resume'))).toBe(false);
```

**验证：** `bun test src/main/agent/runtime/test src/main/conversation/test src/main/test src/renderer/src/lib/pi-chat/test`；用临时 SQLite 重新打开 session 验证恢复后的模型上下文不存在缺失 toolResult。分别覆盖用户停止、默认不限时、显式超时、正常退出和模拟进程丢失；不能只测正常批准。

**建议提交：** `fix(agent): settle interrupted interactions before shutdown and reuse`

## 完整回归与运行验证

本次方案编写时实际执行的基线：

```sh
bun test src/main/agent/runtime/test src/main/conversation/test src/renderer/src/lib/pi-chat/tests
```

Bun 1.4.2，**126 pass / 0 fail**，15 个测试文件。它只证明当前工作区基线，不代表上述新行为已实现或验证。现有 runtime.test.ts 还会在隔离子进程中执行 runner / execute-run 集成用例，继续复用这个宿主以免 Electron mock 相互污染。

| 回归边界 | 风险与验证 |
|---|---|
| 权限判断 | 保持 full-access / default / auto-review 和信任规则语义。运行权限现有测试与新增 HTTP 负向用例；批准只影响该请求，拒绝不能执行，停止后不能迟到放行。 |
| loop 与工具并发 | 真实 pi 执行混合工具批次，等待前没有副作用；取消后未开始工具不执行；允许/拒绝只产生一个原生结果；不靠 mocked Agent 测这些断言。 |
| 询问 | 回答恢复原调用；取消不再发模型请求；多个问题按原顺序配对；未回答、超时、重启后表单不可错误地继续提交。 |
| SSE 与 UI | 完整原生事件、partial 快照、user 回声、toolResult 双入口、工具 ID 延迟出现、完成与断流、重连历史去重、错误 content、图片及 MCP 工具卡片。 |
| 持久化与恢复 | 一次 run 一对 operation 记录；决定先记录再执行；写入失败不放行；缺结果幂等修复；批准后崩溃不重执行；旧结果不覆盖。 |
| 调度 | 待交互任务仍 running，同任务不重叠；稍后打开会话可决定；待交互释放防休眠锁，执行/终止时正确恢复和释放。 |
| 子 Agent、上下文与模型 | 回归 subagent 询问禁用、scope 动态工具列表、loop detection、压缩、标题、用量及 Provider 完成请求；不改变 piModels 路径。 |
| 进程退出 | stop 调度 → abort / settle run → 释放其他服务 → 关闭 session store → closeDb；超时/异常每步仍执行，重复退出幂等。 |

实施结束执行：

```sh
bun test src/main/agent/runtime/test src/main/conversation/test src/main/agent/context/test src/main/agent/subagent/run.test.ts src/main/api/test src/main/agent/tools/test src/main/agent/automation/test src/main/test src/renderer/src/lib/pi-chat/test
bun run lint
bun run typecheck:node
bun run typecheck:web
bunx electron-vite build
bun test
```

全量测试如失败，必须在改动前基线或单独文件复现，区分预存故障与本次回归；不能因为历史上出现过 Electron mock 问题就直接把新失败归为已知问题。

### Agent 实际操作 UI

在实现阶段由 Agent 启动并操作应用，不只给人工检查清单。启动专用验证实例，Electron 的 `--user-data-dir` 指向 `mktemp -d` 创建的测试目录；确认 app.getPath('userData') 实际命中该目录后才写测试设置，不能使用用户当前账户配置或数据库。本地 electron-vite 5.0.0 的启动实现读取 ELECTRON_CLI_ARGS（`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js` 的 startElectron），可这样启动：

```sh
runtime_check_dir=$(mktemp -d)
ELECTRON_CLI_ARGS="[\"--user-data-dir=$runtime_check_dir/profile\"]" bun run dev
```

新增测试资产 `src/main/api/test/model-server.ts`，由 `bun run src/main/api/test/model-server.ts` 显式启动，只绑定 127.0.0.1、随机端口。提供 `/v1/chat/completions` 的确定性 OpenAI-compatible SSE 响应，以及只在测试进程内选择场景/读取计数的接口。普通 Bun 单元测试仍使用已有 fauxProvider；真实 UI 则通过正常的自定义 Provider 配置访问这个本机假模型，不把测试分支插入正式 Electron 入口。

```ts
// model-server.ts：读取请求 messages/tool_call_id 判断调用阶段；fixtureChunk 返回标准 chat.completion.chunk。
// 场景选择与请求计数仅保存在这个测试进程内；接口不返回真实凭据，不代理外网。
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/chat/completions') return testControlResponse(request);
  const input = await request.json();
  const chunks = responseChunksForScenario(input);
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
} });
console.info({ baseUrl: `http://127.0.0.1:${server.port}/v1` });
```

窗口 1280×900。Agent 在隔离实例的设置页创建自定义 Provider（本机 baseUrl、OpenAI 协议、仅用于 fixture 的假 Key）和 test 模型；创建一个临时目录项目和绑定会话，再创建同一会话的定时任务。关闭自动标题和自动审核以保持固定请求序列；使用 default 权限模式。假模型固定发出写入“项目外、但仍位于测试临时目录内”的命令触发审批，批准后只向测试计数文件追加标记；不执行外网命令，也不依赖随机模型输出。询问、拒绝、错误和长输出使用分别可选择的固定场景。

依次操作并保留应用截图、网络请求记录和临时 session 的断言输出：

1. 发送消息 → 审批卡片出现 → 等待期间切换会话再返回 → 批准 → 同一回复继续；只有一次 chat 启动请求，无 `/resume`。
2. 拒绝审批 → 工具未执行 → 模型读到真实拒绝原因；再测试“始终允许”后下一次相同受信任操作不重复询问。
3. 询问出现 → 回答并继续；另一次点击取消 → 无第二次模型请求，无永久等待表单。
4. 审批等待时断开 SSE 再重连 → 卡片恢复且工具执行次数仍为零；批准后只执行一次。
5. 审批等待时停止、正常退出再启动；另外用隔离 fixture 模拟强杀后的 session → 旧交互不可批准，下次发送前缺口已修复。
6. 定时任务触发审批 → 保持 running → 打开绑定会话批准 → 任务完成；期间不重叠触发，防休眠调用符合等待策略。

model-server.ts 属于 S-001 的 UI 验证资产，S-002/S-003 延伸其场景；必须经真实 Provider 设置和 HTTP 调用完成接线后才能声称 UI 验证通过。若宿主不支持专用实例或 native 自动化，则报告这一项未执行，不能以截图草图或 Bun 测试冒充真机验证。

## 数据与切换范围

- 不引入新 SQL migration。交互记录使用 pi custom entry；历史已完成消息仍使用原来的 Session 存储。
- 旧版审批和 `/resume` 不做双轨支持。重启后的旧待执行调用只能被标记中断并补缺口，不能沿用旧决定自动执行。
- run_started / run_finished 仅是运行流元信息，不替代 session 的 operation 和工具结果记录；事件重放缓存不变成新的持久化真相来源。
- 本地旧版数据的读取/回滚以“保留已完成对话”为边界，不保证旧二进制能处理新交互记录。回退验证使用测试数据库副本，不删除或重置真实用户数据。
- 测试放到各模块 test/ 下；仅迁移此次直接修改的 pi-chat/tests，不扩大成全仓库测试搬家。
- 实施前重新核对 staged/unstaged 边界；本方案不授权提交已有暂存内容，也不授权 push、发布或清理数据库。提交方式由后续 Develop 与用户确认。

## 本次评审重点

1. 正常审批与询问保持原 loop；取消/崩溃恢复不执行旧工具，默认不限时且定时任务也可等待。
2. 事件契约是原生 AgentEvent + 独立运行/交互业务事件；messageId、占位过滤、details.errorText 和伪造 agent_end 全部退出标准事件路径。
3. 建议接受等待期间释放定时任务的防休眠锁，以及正常退出最多等待 run 收尾 3 秒的资源策略；对仍在执行且不响应取消的外部工具不作成功或回滚保证。

文档完成后停在 Human review。确认这份方案后，下一阶段为 product-develop；本轮没有修改生产代码、测试代码或已有暂存区。
