---
Status: Awaiting Human review
Last updated: 2026-08-23
Topic: Session 层选型——官方 v4 Session vs 自研 vs 社区实现
---

# Session 层调研

## 结论

**用 pi 官方 v4 Session（裸 `Agent` + `Session` + 官方 Repo 后端），先 JSONL 后端起步。** 这不是妥协，是当前生态收敛的唯一姿势。

## 证据

1. **官方 v4 Session 与 harness 是解耦的**（依赖只有 harness→session 单向）：`Session` 是具体类，`appendMessage(AgentMessage)` / `findEntriesOnBranch` / lanes / facts；`SessionRepo` 契约 `create/open/list/delete/fork`；官方两个后端 `JsonlSessionRepo`（`{fs, sessionsRoot}`，还能打开 pi-coding-agent 的 v3 旧文件）和 `@earendil-works/pi-session-backend-sqlite-node`（单 DB 多会话、writer lease、FTS 搜索服务、分支缓存；SQLite 驱动可插拔——Electron 下可用 better-sqlite3 实现其小接口）。
2. **Agent 桥接是现成的**：`buildSessionContext(entries)` 把分支条目投影成 `{messages, model, thinkingLevel, activeToolNames}`，直接喂 `agent.state.messages`——与 pi-coding-agent 自研 SessionManager 的恢复姿势逐行同构（v4 就是那套东西的泛化收编）。
3. **第三方轮子：没有。** npm/GitHub 全量搜索——零个社区 Session 后端包；用旧 harness 的项目（pibot、Kernel cua-agent）全部钉死 ≤0.83；Sentry 的 pi 集成指南明文："production 用裸 Agent + session APIs，AgentHarness 是脚手架（HarnessNotImplemented）"。
4. **Entry 词汇**（message / model_change / compaction / branch_summary / custom）与我们此前四仓调研的收敛模式一致；`fork` 原生支持（未来消息编辑分叉的地基）。

## 选 JSONL 起步的理由

- 零新增依赖（在 pi-agent-core 里）；文件可 cat 可 diff，正合"从 demo 长出来"的可观察性。
- 与 SQLite 后端**同一 Repo 契约**——将来换后端是构造函数级替换，不是重写。
- v4 表面在 npm 上仅两周大、且 harness.md 预告契约还会演进——用薄封装隔离，JSONL 先行让爆炸半径最小。

## 不采纳

- 自研 JSONL（Kimi/coding-agent 式）：官方泛化版已存在，自研即重复。
- 直接上 SQLite 后端：多一个 lockstep 包 + 驱动适配，等多会话/搜索需求真出现再换。
- lane-record API（`appendRecord`/operation records）：harness 簿记，裸 Agent 应用只用 entries + facts + `buildSessionContext`，records 完全不碰。

## 本次增量范围（单会话常驻，先证明层的存在）

1. `JsonlSessionRepo` 落 `userData/sessions`；启动时 list → 打开最新或新建。
2. 常驻 Agent 挂一个常驻持久化订阅：`message_end` → `session.appendMessage`。
3. 启动恢复：`findEntriesOnBranch` → `buildSessionContext().messages` → 喂 Agent；新增一个历史端点，页面加载即恢复对话。
4. 多会话列表/切换/删除 = 下一个增量，不在本次。
