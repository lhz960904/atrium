---
Status: Awaiting Human review
Last updated: 2026-08-22
Topic: 会话/任务持久化与 Run 生命周期 —— M1（db/domain/engine.session）动码前调研
Sources:
  - pi-coding-agent @ v0.84.2（官方参考消费者；此前词汇轮已深读）
  - llm-space @ 4.14.1（pi 生产实证；此前词汇轮已深读）
  - Codex CLI @ main 343074d（openai/codex，Rust）
  - Kimi CLI @ main（MoonshotAI/kimi-cli，Python；后继 kimi-code 未开源）
Related: docs/spec.md §2 §3.4 §4
---

# 会话持久化与 Run 生命周期：四仓对照

## 1. 收敛面（四仓一致或多数一致 → 直接采纳）

| 议题 | 收敛结论 | 各仓证据 |
|---|---|---|
| **流式期间写什么** | **delta 永不落盘；只持久化完成单元** | pi-coding-agent：仅 `message_end` 单点持久化；Kimi：wire 双队列，recorder 只订阅 merged（part 完成才写）；Codex：persistence policy 一个穷举函数——delta/`*Begin` 全部 ephemeral，终态事件 durable；llm-space：运行中 onChange 抑制，run 结束一次性落盘 |
| **空对象避免** | **首条真实输入触发物化**（懒创建）| Codex：`deferred_creation` + `PersistContext::TurnStart`（首条用户输入被记录时建文件）+ 失败丢弃 guard；pi-coding-agent：首条 assistant 前懒刷盘。Kimi 反例：急切建 + 列表隐藏空会话 + 退出 GC——用户可见行为等价，代价是 GC 路径 |
| **中断表达** | **生命周期靠事件括号闭合，任何路径都写终结记录** | Kimi：`finally` 里保证 `TurnEnd`；Codex：cancel token → 100ms 宽限 → 硬杀 → **写模型可见的 interrupted 标记 → flush → 终态 `TurnAborted` → flush**（终态双屏障）；pi：abort 也合成闭合事件序列 |
| **恢复时修复在读取侧，不改存储** | **存储保留诚实的残缺记录；prompt 构建时确定性修复** | Codex：悬空 tool call 在 prompt-build 时插入合成 `"aborted"` 输出（**确定性 UUIDv5 id，重复归一化不打破 prompt cache**）；孤儿输出丢弃。Kimi：无需修复（格式上不存在"open run"）|
| **重放与实时同路** | **回放 = 把事件重新灌进实时渲染同一条 reducer** | Kimi：replay 重灌 `visualize()`；Codex：TUI replay 走同映射；我们 spec 的 reducer 重放设计被双仓印证 |
| **单活跃 Run** | **结构性持有 + 越界明确语义** | Codex：`Option<ActiveTurn>` + 新输入 `Replaced` 语义 + 跨进程 writer lock；Kimi：结构性 + web 侧 409 busy。我们的 DB 部分唯一索引是更强的一层（两仓都没有 DB 级约束，因为它们没有 DB）|
| **容错读取** | **坏行跳过继续读，绝不因单行损坏拒载** | Codex：skip + 计数 + 尾行补 `\n` 自愈 + 反向扫描找最后有效记录；Kimi：三档策略（元数据原子写 / JSONL 容错读 / 改史走轮转不截断）|

## 2. 分歧面（需要选边）

### 2.1 事实源：JSONL 追加日志 vs SQLite

Codex（JSONL 为真 + SQLite 可修复投影 + 按 byte offset/ordinal 断点续投）、Kimi（双 JSONL）、pi-coding-agent（JSONL 树）、llm-space（JSON 文件）——全是文件派，但**它们都是 CLI/文件型产品**：无列表检索、无 FTS、无用量台账联查。Atrium 是桌面应用，列表/搜索/usage/归档全靠查询。

**选择：维持 SQLite 唯一事实源（铁律 2 不变）。** 可迁移的不是"用文件"，而是三条语义：追加倾向（改史少做原地更新）、终态单点写入 + 事务屏障、读取侧容错。Codex 的"投影 + 读修复"模式记入 M8 备忘：若未来做 FTS 重建/导出，DB 即真源，无需投影层。

### 2.2 Run 状态：status 列 vs 事件推导

Codex 与 Kimi 独立收敛到同一形：**不存 status 字段**——状态是对持久化生命周期事件的纯折叠（`TurnStarted/TurnComplete{error?}/TurnAborted` → `InProgress/Completed/Failed/Interrupted`），"崩溃后卡 running"这一类问题从格式上不存在（无终结记录 = 中断，定义即真）。

我们 spec 的 runs 表有 status 列 + 启动对账 UPDATE。对照后**维持 status 列，但吸收其纪律**：

1. status 的写入点收敛到**恰好两处**：创建事务（'running'）与 `seal()`（终态）——等价于"事件括号"，只是括号写在列上；
2. 启动对账那条 UPDATE 就是"无终结记录 = interrupted"的折叠实现，一条语句，保留；
3. **不引入第三个写入点**。任何"顺手改状态"的诱惑都是这次对照否决的对象。

理由：SQLite 下 status 列换来的是可索引查询（sidebar 的 running/unread 投影、DB 级单主 Run 唯一索引**依赖此列**），事件推导派的好处（崩溃自洽）我们用两写入点 + 对账等价获得。

### 2.3 abort 时的 partial 文本

Kimi：取消时流式内容直接丢（只保留完成的 step）。Codex：已产出的完整 item 都在 + `TurnAborted` 终结。我们的 PRD（BR-005/006）**要求**保留 partial——pi 的 abort 路径恰好发出带 `stopReason:'aborted'` 的 `message_end`，partial 随之落库。**有意偏离 Kimi，跟随 PRD + pi 语义。**

## 3. 直接借鉴清单（M1 落地项）

1. **模型可见的中断标记（Codex）**：Run 终态为 interrupted/limited 时，**prompt 构建期**（codec/上下文组装）注入确定性的中断说明（不改存储、内容确定性以稳 prompt cache）——正好实现 BR-007.3"部分回复进入后续上下文时始终保留未完成性质"。
2. **终态双屏障（Codex）**：`seal()` 内先持久化消息与终态（一个事务），事务提交后才广播 `agent_settled`——客户端收到终态事件时 DB 必然已可读，消除"收到 finished 去查库却查不到"的窗口。
3. **持久化策略单函数（Codex）**：哪些事件/内容 durable、哪些 ephemeral，收敛为 `server/run-events.ts` 里一个穷举函数，不许调用点各自判断。
4. **容错读取（Codex/Kimi）**：`messages.parts` JSON 解析失败 → 跳过该 part 记警告，绝不整条消息/整个 Task 拒载。
5. **懒物化 + 失败丢弃 guard（Codex）**：BR-003 原子事务已覆盖"懒"；补其 guard 语义——事务失败无任何残留（SQLite 天然）。
6. M3 预约：**悬空 tool call 的 prompt-build 修复**（确定性合成 "aborted" 输出，取代旧 seal-tool-calls 中间件的存储改写路线）；**Queue 剩余输入永不丢**（Codex：run 结束时把未消费的 queued input 记入历史）；Steer 语义 `Steer{expected_turn_id}` 防错投（Codex TurnInputMode）。
7. M8 备忘：Codex `SuspendTurnAndShutdown/RecoverTurn`（turn 跨进程移交）、fork/revert 的不可变文件模式（对应我们未来的消息编辑分叉）；Kimi 的双日志 turn 边界截断 fork。

## 4. 明确不采纳

- JSONL 事实源 / 双日志（§2.1，产品形态不同）。
- 急切建会话 + GC（Kimi）：SQLite 单事务成本趋零，原子创建更简单且已被 Codex 懒物化印证。
- 无 status 列的纯事件推导（§2.2，吸收纪律不吸收形式）。
- Codex app-server 的 `thread/turn/item` 事件命名：好，但事件词汇已锁 pi（roadmap ✅ 决策），仅作对照参考。

## 5. 对 spec 的修订（本纪要通过后并入）

- §3.4 追加：持久化策略单函数；`seal()` 事务提交先于 `agent_settled` 广播（终态双屏障）。
- §4.2 追加：中断/受限 Run 的模型可见标记在 prompt 构建期确定性注入（codec 职责）。
- §2.2 补注：status 列写入点恰好两处（创建事务 / seal），第三写入点为禁止项。
- domain 读取侧：parts 解析容错（跳 part 不拒载）。
