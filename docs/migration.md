---
Status: Active — 阶段 1 完成，停在阶段 2（引擎换 pi）门口
Last updated: 2026-08-27
Branch: feat/protocol-isolation（基于 main@4ca74fd）
---

# pi 迁移计划：原地替换，四阶段

## 背景与决策

从零重建路线（codex/rebuild-pi-agent-core，已归档为参考库）被放弃：Atrium 代码量中 AI 底层只占两三成，从零重写把七八成产品功能重构横在核心目标之前。改为**原地替换**：每一步结束后应用完整可用，行为与迁移前一致。

四阶段，每阶段内部再拆子步、逐子步 review：

1. **协议隔离**——线协议 / DB parts 格式 / 渲染端消费层脱离 Vercel AI SDK 的 UIMessage，换成自有协议（pi 词汇冻结副本）。引擎仍是 AI SDK，在边缘做转换（转换器与旧引擎同生共死）。
2. **AI 层换 pi**——引擎 / 33 个工具（TypeBox）/ HITL（beforeToolCall）/ subagent / compaction 重接。业务层与 DB 不动；不引入 pi Session 账本（那是阶段 3 议题）。
   - 开头两件事：① 装上 pi 后把 `src/shared/protocol/` 冻结副本对真实 `.d.ts` 复核（已执行，一次性类型断言验证为严格子集后移除）；② 此后每次 pi 升版本，手工复核冻结副本是固定动作。
   - 协议与 pi 的关系定为：**pi 词汇的严格子集 + 扩展事件（approval_*、notice）**。wire 上省略 `partial`/`turn_end.toolResults`/`agent_end.messages` 等重负载字段是序列化边界的职责（pi 的 AgentEvent 是进程内协议，靠引用共享才免费；跨 SSE 逐帧带累积消息在写大文件 / computer-use 截图场景是 MB~几十 MB 级浪费），不随引擎切换回收。进程内（persistence/hooks）阶段 2 起直接消费 pi 原生事件。pi 升版本时同步复核冻结副本是固定动作。
3. **服务端业务架构重思**——Workspace→Task→Run 产品重塑、会话存储选型、模块结构（v2 分支的 interfaces / routers-are-domain 实验是候选形态）。
4. **Renderer 整体优化**。

## 阶段 1 子步（全部完成）

- **1a. 协议模块落库** ✅（`991a7b1`）：`src/shared/protocol/` pi 词汇冻结副本，对真实 0.84.2 `.d.ts` 逐字段核过；偏离表在 events.ts 头部。
- **1b. 线协议 + 渲染端消费** ✅（`ad32bac`→`bc90cdc`）：protocol-bridge（UIMessageChunk→pi 事件，闭合保证）；pi-events 信封日志（seq 重放 + 实时尾随）；RunAssembler + PiChat 替换 useChat/transport，组件层零改动；auto-resume/审批/澄清/停止/重连语义逐项对齐并真机回归。
- **1c. DB 格式翻转** ✅（`84d136e`→`f79f83b`）：行粒度 pi 原生（user / 每 turn assistant / toolResult 单行，run_id 分组）；写侧 split、读侧 merge，旧行（run_id 空）原样透传不迁移；FTS 触发器双形态；编辑删除/scheduled 归因按 run 寻址。
- **1d. 单轨化 + 渲染端脱 SDK** ✅（`ce134d5`→`c53f6ce`）：旧 UIMessage SSE 轨/resumable store/`/stream` 端点退役，pi 事件日志成为唯一传输（assistant-stream、@ai-sdk/react 依赖移除）；`shared/ui-message.ts` 自持 UI 词汇，renderer 可达模块零 `ai` import。run-image/ACP 发射器仍产 UIMessageChunk 经 bridge 转换——它们随阶段 2 引擎一起换。

每子步收口条件（已执行）：回归清单相关段 + CDP 实测 + DB 对账，行为与迁移前一致。

## 阶段 2 子步进度

- **2a. 模型/Provider 层换 pi** ✅（`a7de9ab`）：`resolvePiModel` 把 manifest 映射成 pi `Model`，元数据与计价取自 pi 内置目录（内置命中 → 跨目录借条目 → manifest 声明 → 硬默认），注册表模块加载期静态装配，密钥逐调用解析；ark agent plan 真流量冒烟通过。
- **2b. 工具层 TypeBox 化** ✅：33 个工具 + MCP 适配器改成 pi `AgentTool`（TypeBox 参数、`execute(toolCallId, params, signal)`、`content`/`details` 双通道），失败路径由返回 `Error: …` 字符串翻成 throw；RunContext 从 `experimental_context` 改为构造时闭包，工具集在 run 上下文就绪后装配。JSON Schema 快照测试钉住每个工具的 name/description/schema 与 zod 时代一致。旧引擎期间由一层 AI SDK 适配器承接（用 pi 自己的 `validateToolArguments` 校验参数），随引擎切换退役。

- **2c. 引擎装配** ✅：`runAgent` 内部由 `streamText` 换成 pi `Agent`——事件投影器（pi AgentEvent → 冻结词汇，按偏差表裁剪）+ 持久器（run 结束时把 pi 消息整体写成行）两个 subscriber；metadata/usage/title/persistence/seal/date 六个 middleware 退出链条，分别落到 run 装配、事件订阅、读侧和 `transformContext`；事件日志由「拉流」翻成「写入端」（`withRunLog` + `RunLog.append`），ACP / 图像生成两条仍产 UIMessageChunk 的路径经 `drainChunkStream` 走 bridge 汇入同一日志；历史改为 `loadThreadAgentMessages` 直接读行成 pi 消息（旧行经 split 转换），悬空 toolCall 在读侧封口。真机验证：文本轮 / 三工具并行轮 / 工具失败 / 停止（partial 落库 + markRead）/ 中途切走再回来续流 / MCP / 子智能体 全通。

**引擎切换期熄灯的能力**已全部接回：`beforeStep` 管线随引擎一起退役，skills / memory / instructions / profile 注入、screenshot-trim、loop-detection 由 2d 用 `transformContext` 重接，compaction 由 2e 接回，审批 / ask_clarification / auto-review 由 2f 接回（过渡期那套失败关闭的 `beforeToolCall` 就此退役）。

- **2d. 上下文管线** ✅：`transformContext` 接回全部注入与改写，按序为 截图裁剪 → 常驻块（skills / memory / instructions / profile）→ 日期 → 循环提示；每次请求重算、只作用于副本，落不到存储。常驻块每轮读一次盘后纯函数注入，锚在首条用户消息上以留在缓存前缀里；日期锚在当轮，且排在循环提示之前，免得提示消息抢走锚点。循环刹车与技能限工具改走 `prepareNextTurnWithContext`——pi 的工具集在 context 上而不在消息里：识别到同参重复调用第 5 次即把工具集清空（等价于旧的 `toolChoice: 'none'`），技能的 allowed-tools 每轮都从全集重算，绝不逐轮收窄。记忆的会话计数移到 run 收尾。首条消息 dump 与迁移前逐字节对拍通过（同块、同序）；旧的 skills/memory/instructions/profile/screenshot-trim/date 及 2c 已退役的 metadata/usage/persistence/seal 一并删除。真机验证：四类注入模型端逐条确认可见、循环刹车在第 3 次告警第 5 次断工具（DB 恰好 5 条工具结果、提示不入库）、技能加载后下一轮工具集收窄到 allow-list、刷新重放无残留。

- **2e. compaction 移植** ✅：算法整体保留、词汇换成 pi 消息，两层各归其位——跨轮折叠在 run 装配期（阈值 0.8、摘要成检查点对、发 `data-compaction` 通知），轮内折叠是 `transformContext` 里的一段（记住 [summary, coveredCount] 后每次请求确定性重建 `[summary, …live tail]`，前缀逐字节稳定、不落库、不上报）。检查点仍是两条普通行（`kind: compaction` / `compaction-ack` + `coveredThroughId`），折叠改在**读侧**：`loadThreadHistory` 按行 id 重建（检查点写入时间最新、必然排在被折叠区之后，只能按 id 找），被折叠的行原样留在库里给 UI。计数改用 pi 原生 usage 作锚（取 `usage.totalTokens`，天然含系统提示与注入块），锚永远取最新一轮，所以折完不会立刻再折；轮内是纯估算，另把注入块的体积作为常量 overhead 计入。**pi 的 usage 语义与 AI SDK 不同**：命中缓存的一轮只把未命中部分记进 `input`、其余进 `cacheRead`，照搬 `input + output` 会把 78k 的提示读成 8.8k（真机实测），阈值永远不触发——`contextTokens` 一并改成 `totalTokens`。摘要调用也从 AI SDK `generateText` 换成引擎自己的 `streamFn`：同一模型走非流式路径会 `Invalid JSON response`（真机实测），而流式路径本来就是这一轮在用的。preserver 收敛成一个函数签名（pi 只有一族消息），`/compact` 走同一套 `foldToCheckpoint`。AI SDK 那份只剩子智能体用的轮内折叠，跨轮半边（applyCheckpoint / compactThread / persist / UI 侧 token 与窗口函数）一并删除。真机验证：`/compact` 出分隔线与摘要、DB 检查点对与 `coveredThroughId` 正确（8 条折 4 条）、折叠后追问「口令」从保留窗口答对、追问最早的城市与茶从摘要答对；自动阈值用 128k 窗口的模型 + 一条 39k token 的长消息压到 `161750/128000` 真实触发，检查点落库、本轮在折叠视图上照常答对，刷新重放完整。轮内折叠只有单测（要让单轮自身撑爆窗口，成本不划算）。

- **2f. 审批 / 澄清 / 自动审查** ✅：越界调用与客户端工具不再被拒，改成**搁置**——`beforeToolCall` 判定后发 `approval_requested` 并 block，`shouldStopAfterTurn` 让本轮到此为止（同批其余工具照常跑完）。搁置的调用**不写结果行**，待办状态记在所属 assistant 行的 `metadata.toolStates` 里（阶段 1 的读侧合并器本来就认这个），封口逻辑也跳过它们——所以刷新之后卡片还在，决定几小时后再来也接得上。决定回来时由**服务端**结算：批准就直接调那个 `AgentTool`（引擎只会执行当前正在流的那一轮的调用，这一轮早结束了），并照常发 `tool_execution_start/end` 让卡片正常填充；拒绝写 `details.denied`；客户端工具则把用户的答案写成结果行。续跑不再让客户端的消息覆盖存储行——服务端只从中读取用户的决定，行仍是 pi 原生的；`resumeRows` 把本轮之前写过的行带上（run 是整体替换写入的），createdAt 与累计 token 沿用原轮次，账本只记本段花费。auto-review 的 reviewer 判定与 ALLOW 徽标原位发出。顺带修掉一个真机撞到的坑：**报错轮次会存下 content 为空的 assistant 行**，下一轮把它当历史发回去会被 provider 直接拒（thread 就此卡死），现在空轮次不落库。真机验证：审批→允许一次→执行并续跑答对、审批→拒绝→模型自行改口、ask_clarification 两问答完→续跑带上答案、自动审查模式 reviewer 放行免打扰。

- **2g. 子智能体** ✅：`runSubagent` 由 `streamText` 换成嵌套 `new Agent`，跑父轮同一套 streamFn / getApiKey（子代理钉了模型就换成它的 pi Model）。工具从 AI SDK 的 `Record<string, Tool>` 改成按名字过滤 `AtriumTool[]`——`task` 在调用时才读取同轮的完整工具表（它自己也在表里，构造期拿不到）。轮内压缩、loop 刹车、日期注入复用 pi 那套；活动冒泡改从 `message_end` 折算成既有的 `data.subagent` 通知（渲染端零改动），用量按 pi 每轮原生 usage 累加，并挂到 `AgentToolResult.usage` 上（pi 原生支持工具级用量）。定时任务走的仍是 `/api/chat` 同一条路，未受影响。ACP 按 D4 冻结，不移植。真机验证：派子智能体跑 bash 回报输出正常，账本里 `kind=subagent` 独立入账。

- **2g（续）· 订阅 OAuth provider** ✅：pi 自带 Claude Pro/Max 与 ChatGPT Plus/Pro 的 OAuth 流，所以这一步做的是把它接到应用上——凭据存储复用 providers 表那块 safeStorage 加密 blob（实现 pi 的 `CredentialStore`：`modify` 是唯一写入口，因为 OAuth token 是就地刷新的，两个并发请求不能各刷一次），登录编排在主进程按状态机跑（拿到授权 URL 就开浏览器、需要粘贴时把问题递到设置页、可取消），设置页新增 `subscription` 这类 provider 的登录面板，模型目录直接取 pi 的。**一个真机才会暴露的坑**：pi 用变量 specifier 动态 import OAuth 流模块，专门躲开打包器——而 main 是打成单文件的，登录时那个 chunk 根本不存在（`Cannot find module out/main/openai-codex.js`）；pi 为此导出了 `bun-oauth` 入口（静态 import 全部流），在注册表装配处调一次 `registerBunOAuthFlows()` 才能在打包环境里登录。真机验证到「点登录 → 起流 → 开浏览器 → 停在等授权码」为止，取消能干净收尾；**最后一步的授权要 Haoze 用自己的账号完成**。
- **2h. 引擎摘掉 AI SDK** ✅：agent 走的每一次模型调用都改走引擎自己的流。三处旁路调用（压缩摘要、会话标题、auto-review 判定）都是「一问一答」，收敛成一个 `pi/complete.ts`；记忆整理（dream）改成一个小的嵌套 Agent。没有东西需要适配之后，AI SDK 工具镜像连同整条 middleware 链一起删除，`RunContext` 瘦回「一轮是什么」——在哪跑、能写什么、怎么到 UI，引擎单独交给需要的部件。

## 纪律

- main 迁移期冻结新功能，只收 fix。
- **replace-in-kind**：阶段 1-2 只做等价替换；看到想重构的东西记入 `docs/debt.md`，不顺手动。
- 每子步结束停下 review；行为差异即 bug，不辩解。

## 资产索引

- `docs/feature-inventory.md`——全功能回归清单（原地迁移的验收底线）。
- `docs/research/v2-spec-reference.md`——协议设计（事件词汇、偏差表、防丢失不变量、reducer 参考）。
- `docs/research/session-persistence.md` / `session-layer.md`——阶段 2/3 的调研输入。
- 归档分支 `codex/rebuild-pi-agent-core`——pi 实操验证代码（Agent/Session/流式/打包 spike 全通过）、结构实验。
