---
Status: Draft — 待 Haoze review
Last updated: 2026-08-28
Scope: 迁移阶段 2 —— 主进程 agent 引擎从 Vercel AI SDK 换到 pi-agent-core 0.84.2
---

# 阶段 2 技术方案：引擎换 pi-agent-core

## 0. 目标与边界

**目标**：`src/main/agent/` 的模型循环从 AI SDK `streamText` 换成 pi `Agent` 类。换完后：引擎原生产出 pi 消息与 pi 事件（阶段 1 的 protocol-bridge、persist-convert 的 split 侧整体退役）；行为与现状逐项等价（replace-in-kind，回归清单 `docs/feature-inventory.md`）。

**非目标**：renderer 不动（PiChat/RunAssembler 原样消费事件）；服务端业务结构不动（阶段 3）；不引入 pi Session 账本（阶段 3 议题）；产品行为不加不减（steering 等 pi 解锁的新能力记录为后续项，不在本阶段实现）。

**版本纪律**：`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` **精确锁 0.84.2**（pi 在 patch 版本发过 breaking change）；ESM-only、Node≥22.19（Electron 39 满足）。打包可行性已由早期 spike 验证（asar 内懒加载协议模块全通过）。

---

## 1. pi API 核心面（对照真实 0.84.2 `.d.ts` 摘录）

用 **`Agent` 类**（生产路径，pi-coding-agent 同款）。不用裸 `agentLoop`（无状态管理），不用 `AgentHarness`（编码 harness 脚手架，绑定它的 session/工具体系）。

```ts
new Agent({
  streamFn,                  // (model, context, options) => AssistantMessageEventStream；Models.streamSimple 即可
  getApiKey,                 // (provider) => key —— 每次 LLM 调用动态解析
  convertToLlm,              // AgentMessage[] → Message[]：过滤/转换非 LLM 消息（不许 throw）
  transformContext,          // 每次 LLM 调用前对消息做变换（压缩/注入的落点，不许 throw）
  beforeToolCall,            // 参数校验后、执行前；返回 {block, reason, terminate} 可拦截
  afterToolCall,             // 执行后、事件发出前；可整体覆盖 content/details/isError/terminate
  shouldStopAfterTurn,       // turn_end 后；true → 优雅停（步数上限、循环刹车的落点）
  prepareNextTurnWithContext,// 下一轮开跑前；可换 context/model/thinkingLevel
  toolExecution,             // 'sequential' | 'parallel'（默认 parallel；工具可单独覆盖 executionMode）
  maxRetryDelayMs,           // provider retry-after 的上限
})
agent.state                  // {systemPrompt, model, thinkingLevel, tools, messages, isStreaming, ...}
agent.subscribe(listener)    // AgentEvent 流；listener 的 promise 计入 run 的收尾
agent.prompt(msgs) / agent.continue() / agent.abort() / agent.waitForIdle()
agent.steer(msg) / agent.followUp(msg)   // 队列（本阶段不用，记录为解锁能力）
```

**AgentTool**（TypeBox）：

```ts
interface AgentTool<TParams extends TSchema, TDetails> extends Tool<TParams> {
  name: string; description: string; parameters: TParams;   // TypeBox TSchema
  label: string;
  execute(toolCallId, params, signal?, onUpdate?): Promise<AgentToolResult<TDetails>>;
  // AgentToolResult = { content: (Text|Image)[], details, usage?, addedToolNames?, terminate? }
  prepareArguments?(raw): params;      // 校验前的参数兼容垫
  executionMode?: 'sequential' | 'parallel';
}
// 失败语义：execute 直接 throw，循环负责编码 isError 结果（现在是返回错误字符串——要翻转）
```

**模型层**：`Model = {id, name, api, provider, baseUrl, reasoning, input: ('text'|'image')[], cost, contextWindow, maxTokens, thinkingLevelMap?}`；`createModels/createProvider` 支持自定义 provider；`KnownApi` 含 `openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai` 等；`calculateCost(model, usage)` 内置计价。anthropic-messages 实现**内部自动管理 cache_control 断点**（api/anthropic-messages.js 证实；2a 落地时用真流量复核）。

**Harness 独立导出**（不用 AgentHarness 也能引）：compaction 原语（`estimateContextTokens`/`estimateTokens`/`shouldCompact`…）、`loadSkills`、system-prompt 模板、coding 工具参考实现。

---

## 2. 目标架构总览

```
http.ts /api/chat
  └─ runAgent(opts)                        ← 对外签名不变，内部重写
       ├─ 装配: buildContext(系统提示+历史) + resolvePiModel + buildTools
       ├─ new Agent({...钩子})
       ├─ agent.subscribe(projector)       ← pi AgentEvent → AgentSessionEvent 信封
       │     └─ pi-events 日志(不变) → SSE → PiChat(不变)
       ├─ agent.subscribe(persister)       ← message_end/tool_execution_end → pi 行直写
       └─ agent.prompt(userMessage) / agent.continue()
```

**陪葬清单**（引擎切换即删）：`protocol-bridge.ts`（UIMessageChunk→事件转换器）、`persist-convert.splitAssistantMessage/splitUserMessage`（引擎原生产 pi 消息，直接落行）、`middleware/` 运行时（runner/compose，逻辑迁入 pi 钩子）、`convertToModelMessages` 相关胶水、`prompt-cache.ts`（pi 内建）。**保留**：`persist-convert.merge*`（renderer DTO 读路径，阶段 4 退役）、RunAssembler/PiChat（renderer 面不动）。

**投影器**（bridge 的替任，薄得多）：pi `AgentEvent` → 冻结副本 `AgentSessionEvent`，只做偏离表规定的裁剪——`message_update` 去 `message`/`partial`、`turn_end` 去 `toolResults`、`agent_end` 去 `messages` 补 `willRetry`、message_start/end 补 `messageId`（run id）。事件名与负载其余逐字段一致，接近恒等映射。

---

## 3. 模型与 Provider 层

现状：`resolveModel(db, providerId, modelId)` 返回 AI SDK `LanguageModel`；密钥 safeStorage 加密存 DB。目标：返回 pi `Model` 对象 + `getApiKey` 回调。

| Atrium provider | pi `api` | baseUrl | 备注 |
|---|---|---|---|
| `anthropic` | `anthropic-messages` | 官方 | cache 断点 pi 内建 |
| `openai` | `openai-responses`（或 completions，按现状对齐） | 官方 | |
| `deepseek` | `openai-completions` | `api.deepseek.com` | pi KnownProvider 有 deepseek |
| `volcengine-agent` / `volcengine-coding` | `openai-completions` | ark 端点 | doubao thinking 参数：ark 的 openai 兼容层是否吃 pi 的 reasoning 选项——2a 冒烟验证项 |
| `aihubmix`（openai 面） | `openai-completions` | aihubmix | |
| `aihubmix`（claude 模型） | `anthropic-messages` | aihubmix 原生 anthropic 端点 | 复用现状"anthropic 原生直通"的判定逻辑；beta header 直通已验证过 |
| local-cli（claude-code/codex/gemini） | 不进引擎 | — | ACP 整轮接管，见 §9 |

- **manifest 即 Model 工厂**：manifest 的模型条目 + `models/catalog.ts` 的 contextWindow/pricing 合成 pi `Model` 对象（`createProvider`/自定义对象皆可，倾向直接构造对象——模型即数据，与 llm-space 调研结论一致）。
- **视觉门控**：`Model.input` 含 `'image'` 与否取代 `supportsImageToolResults`（工具结果是否带 ImageContent、computer-use 非视觉刹车沿用此判定）。
- `getApiKey(provider)` ← 现有加密密钥读取，逐调用解析（顺带解决密钥轮换）。
- 计价：**保留自家 usage 账本与 litellm 价格表**（连续性），pi `calculateCost` 仅作交叉校验；pi Model.cost 填我们的价格。

---

## 4. 工具层（33 内置 + MCP + 客户端工具）

- **Schema**：zod → TypeBox 手工移植（机械劳动，33 个；TypeBox 即 JSON Schema，模型看到的 schema 不变——用快照测试钉住每个工具的 JSON Schema 与迁移前一致）。
- **签名翻转**：`execute(input, {experimental_context}) → 返回值/错误对象` 改为 `execute(toolCallId, params, signal, onUpdate) → AgentToolResult | throw`。
  - 现在"返回错误字符串"的失败路径改为 **throw**（pi 循环编码 isError）；
  - `toModelOutput`（文本/图像双通道）→ `content: (TextContent|ImageContent)[]`；UI 结构化负载 → `details`（阶段 1 已经让渲染端吃 `details`，合同现成）；
  - 流式部分结果（computer-use 截图进度）→ `onUpdate(partialResult)`（对应 `tool_execution_update`）；
  - RunContext 注入从 `experimental_context` 改为**构造时闭包**（getTools 已经拿到 sandbox/db/workspace，本来就是闭包风格，改动小）。
- **MCP**：pi 无 MCP——**保留现有 mcpManager**，`buildMcpTools` 改产 AgentTool：`parameters: Type.Unsafe(entry.inputSchema)`（MCP 的 JSON Schema 直接包一层，零转换），execute 走现有 MCP 调用与图像结果处理。
- **动态工具**：`AgentToolResult.addedToolNames` 是 pi 原生的延迟加载机制——skill 工具后续可用它替代"提示注入 + 全量注册"（记录为改进项，本阶段先保持现状语义）。
- **并行度**：AI SDK 与 pi 默认都是并行执行工具；computer-use 系列标 `executionMode: 'sequential'`（屏幕操作天然串行，现状 UI 也是逐个渲染）。
- **`ask_clarification`（客户端工具，无 execute）**：pi 要求每个 call 有 result。方案：execute 返回 `{content: [占位文本"等待用户回答"], details: {pendingClarify: true}, terminate: true}` 结束本轮；行里存占位结果 + toolStates 记 pending。用户作答 → 客户端 patch 部件 → POST assistant 消息 → 服务端**重写该 toolResult 行**为真实答案 → `agent.continue()`。用户取消 → resolve-clarify 端点重写为 cancelled，不续跑。与现状语义逐点等价（跨重启存活、不自动续跑取消项）。

---

## 5. HITL / Permission（决策点 D1）

现状语义：审批**结束本轮**（部件 state=approval-requested 持久化，跨重启存活），用户决定后客户端 POST approval-responded，服务端重跑并执行被批准的工具。

**推荐方案（复刻现状语义）**：
1. `beforeToolCall`：`needsApprovalFor(...)` 判定（trust rules / auto-review reviewer 全沿用）。需要审批 → 发扩展事件 `approval_requested` → 返回 `{block: true, terminate: true, reason: '等待审批'}`；
2. `afterToolCall`：识别被拦的调用，把 error 结果**覆写**为 `{details: {pendingApproval: {approvalId}}, isError: false}`——行里落"待审批"标记而非错误；
3. 决定到达（沿用现有端点）：**批准** → 服务端直接调用该 AgentTool 的 execute（我们持有工具表），用真实结果**重写该 toolResult 行** → `agent.continue()`；**拒绝** → 重写为 denied 标记 → `agent.continue()`（模型看到拒绝自行调整，与现状一致）；
4. auto-review 的 ALLOW 徽标（notice('autoReview')）在 beforeToolCall 里原位发出。

**备选（pi 原生 park 式，记录不采用的原因）**：beforeToolCall 挂起 await 决定（ACP 现在就是这么做的）——轮次保持活跃、客户端免续跑。不采用：改变持久语义（挂起态跨重启即死）、与"审批可以搁置几小时"的使用方式冲突。阶段 4 若做"实时审批不落轮"再评估。

---

## 6. 中间件 13 个 → pi 钩子映射

`transformContext` 每次 LLM 调用前执行、作用于消息副本——**正好对应现在的 beforeStep 合成链**，注入顺序原样保留：

| 现 middleware | pi 落点 | 说明 |
|---|---|---|
| toolCallSealer | 装配期（行→消息加载时） | 悬空 toolCall 合成 error toolResult（读侧修复，Codex 模式） |
| screenshotTrim | `transformContext` ① | 步视图裁旧截图，逻辑照搬（pi 消息形状） |
| compaction（轮内折叠） | `transformContext` ② | 见 §7 |
| loopDetection | `afterToolCall`（计数/警告注入）+ `shouldStopAfterTurn`（5 次刹停） | 警告文本用 pi 原生 `steer()` 注入，比现在改步视图更干净；阈值语义不变（warn 3 / stop 5） |
| skills → memory → instructions → profile | `transformContext` ③④⑤⑥ | 注入到压缩后视图的首条用户消息/系统提示，顺序不变 |
| date | `transformContext` ⑦ | 锚在最后一条用户消息（保缓存前缀），逻辑照搬 |
| title | run 装配期（首轮触发，独立模型调用） | 引擎无关，重挂 |
| metadata | run 包装层 | createdAt/durationMs 自算；tokens 直接取 pi `AssistantMessage.usage`（**每 turn 原生精确**，比现在的 run 总量更细）；仍发 notice('message-metadata') 喂渲染端 |
| usage（账本） | `subscribe` message_end | 同上，自家价格表计价不变 |
| persistence | `subscribe` message_end / tool_execution_end | pi 消息直写行（split 退役）；continuation 重写语义沿用 run_id 事务 |
| seal-tool-calls（中止时） | `handleRunFailure`/abort 路径 + 读侧修复 | pi 中止本身会产 stopReason aborted 的规范收尾 |
| prompt-cache（非 middleware） | 删除 | anthropic 断点 pi 内建（2a 复核） |
| stepCountIs(100) | `shouldStopAfterTurn` 计数 | 同值 |
| smoothStream(word,12ms) | 不移植 | pi 按 provider 原始节奏出 delta；如体感变差，在 renderer store 侧做节流平滑（已有 50ms notify 节流垫底）。回归时人工对比 |
| 重试（MODEL_CALL_MAX_RETRIES） | pi 内建 retry + `maxRetryDelayMs`；`handleRunFailure` → `agent_end.willRetry` | 429 场景回归验证（曾修过 PR #83） |

**convertToLlm**：过滤压缩检查点（metadata.kind）等非 LLM 消息；如后续需要自定义消息类型（通知、artifact 标记），pi 的 `CustomAgentMessages` declaration-merging 是正路。

---

## 7. Compaction（决策点 D2）

现状两层：轮内折叠（beforeStep 改步视图，不落库）+ 持久检查点（compactThread 摘要对，preservers 保 todo/skill 状态）。

**推荐：算法整体保留，词汇换 pi，原语借 pi**：
- 轮内折叠迁 `transformContext`（作用于消息副本，天然"不落库"，比现在改 ModelMessage 视图更贴合）；
- token 计数：`tokensOfUIMessage/countTokens` 改用 pi 的 `estimateTokens/estimateContextTokens`（AgentMessage 上直接可用），contextTokens 锚点改取 pi usage（每 turn 原生）；
- `compactThread`（/compact 端点 + 阈值触发）: renderTranscript/summarize 移植到 pi 消息，检查点仍是带 `metadata.kind` 的 assistant 行,preservers 逻辑不变;
- 不采用 pi harness 的 `compact()` 全套：它建立在 pi Session `Entry` 账本上（我们阶段 3 才碰 Session），只借它不依赖 Entry 的纯函数。

---

## 8. Subagent（task 工具）

现状：runSubagent 用 streamText 起嵌套循环，经 experimental_context 复用父 run 的 model/sandbox/db，活动经 notice('subagent') 冒泡。

方案：嵌套 `new Agent`（共享 streamFn/getApiKey/model 或子代理钉住的模型），工具表按子代理白名单裁剪；`subscribe` 里把 tool_execution 事件折算成现有 `data.subagent` notice 负载（start/step/done），渲染端零改动。结果文本 + usage 归并进父轮的 toolResult（usage 走 `AgentToolResult.usage`，pi 原生支持工具级用量——比现状的 metadata 汇总更规范）。

---

## 9. ACP 发射器与 run-image

- **ACP**（外部 CLI 整轮接管，不经引擎）：`ChunkEmitter` 从产 UIMessageChunk 改为**直接产 `AgentSessionEvent` 写入事件日志**（text/thinking/tool 三元组 + message_end；权限卡片仍走 notice('permissionRequest'/'permissionResolved')，parked-ask 端点不变）。持久化：ACP 轮次的 onFinish 消息按 pi 行直写。这是 1d 递延项的收口。
- **run-image**（决策点 D3）：pi 无图像生成 API（仅 openrouter-images）。**推荐**：图像生成模块暂留 AI SDK（`ai` 依赖因此保留到本阶段末，模块已隔离），事件侧同 ACP 直接产 pi 事件；后续用 provider 原生 HTTP 重写后再摘 `ai` 依赖（记 debt）。若你倾向本阶段一步到位，加一个子步做 aihubmix/openai images 的裸 HTTP 客户端。

---

## 10. 持久化与协议

- 写侧：subscribe 持久器按事件直写 pi 行（assistant 每 turn 一行、toolResult 单行，复用 run_id 事务与重写语义）；`splitUserMessage/splitAssistantMessage` 退役。
- 读侧：新增 `rowsToAgentMessages`（行 → pi AgentMessage[]，引擎历史直读，**不再经 UIMessage 往返**）；`merge*`（行 → AtriumUIMessage）仅服务 renderer DTO，阶段 4 退役。
- 旧代（run_id 空）行进引擎历史：读时经现有 merge → 再走"UI→pi"一次性转换？**不**——直接写"旧 UI parts → pi 消息"的读侧适配（split 的镜像早已存在于 persist-convert，保留其映射逻辑作为 legacy 读路径）。
- **冻结协议一致性测试**（承诺过的阶段 2 第一件事）：测试文件（仅测试 import pi 类型）断言冻结副本是 pi 词汇的严格子集——pi `AssistantMessage` 可赋值给我们的、事件负载是 pi 对应事件的投影;漂移即 typecheck 失败。

---

## 11. 子步切分（每步可跑可回归，你逐步 review）

| 子步 | 内容 | 验收 |
|---|---|---|
| **2a** | 锁版本装库；协议一致性测试；Model/Provider 层（manifest→pi Model、getApiKey）；streamFn 对 deepseek/volcengine/aihubmix-anthropic 各冒烟一轮（含 thinking、cache 断点复核、429 重试观察） | 一致性测试绿；三 provider 冒烟脚本通过 |
| **2b** | 工具层：33 工具 TypeBox 化 + throw 语义 + MCP 适配器；JSON Schema 快照测试钉不变 | 快照全对齐；工具单测绿 |
| **2c** | 引擎装配：runAgent 内部换 Agent + 事件投影器 + 持久器 + metadata/usage/title；transformContext 先接 seal+date 最小集 | 文本轮/工具轮 CDP+DB 全对账；bridge 删除 |
| **2d** | transformContext 全管线（screenshotTrim/skills/memory/instructions/profile）+ loopDetection + 步数上限 | 注入顺序对拍（dump 首条消息对比迁移前）；loop 刹车用例 |
| **2e** | compaction 移植（轮内折叠 + 检查点 + /compact） | 压缩回归段 + 长对话实测 |
| **2f** | HITL/permission + ask_clarification + auto-review | 审批/拒绝/always/澄清/取消全流程 CDP |
| **2g** | subagent + ACP 发射器原生化 + scheduled 回归 | task 工具嵌套轮 + Claude Code ACP 轮实测 |
| **2h** | run-image 处置 + `ai` 依赖收尾（按 D3 决定）+ split 等陪葬删除 + 全量回归清单过一遍 | feature-inventory 全绿 |

---

## 12. 风险与开放问题

1. **volcengine ark 的 openai 兼容度**（thinking 参数、usage 字段、SSE 细节）——2a 冒烟首要目标；不兼容则给 ark 写自定义 api 模块（pi `Api` 是开放 string union，`createProvider` 支持）。
2. **anthropic cache 断点策略差异**：pi 自动管理 vs 我们手工 stampCacheBreakpoints 的位置可能不同 → 缓存命中率变化，2a 用真实请求对比 cacheRead 指标。
3. **流式重试语义**：pi 流中断的内建重试行为与 `MODEL_CALL_MAX_RETRIES` 的等价性需实测（429 用例）。
4. **打字节奏**：无 smoothStream 后 delta 更粗——低风险，renderer 侧兜底。
5. **工具 schema 漂移**：zod→TypeBox 手抄 33 个易错——快照测试硬防。
6. **决策点汇总**：D1 HITL 复刻 vs park（推荐复刻）；D2 compaction 自家算法 vs pi harness（推荐自家）；D3 run-image 留 AI SDK vs 本阶段裸 HTTP（推荐暂留）。

---

## 13. 阶段 2 解锁但不做的能力（记录）

steering/followUp 队列（打字中途追加指令）、thinkingLevel 用户档位、`addedToolNames` 技能延迟加载、`sessionId` 转发给 cache-aware provider、pi-telemetry。均待阶段 3/4 按产品需要启用。
