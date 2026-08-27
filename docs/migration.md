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
   - 开头两件事：① 装上 pi 后把 `src/shared/protocol/` 冻结副本对真实 `.d.ts` 复核；② 加**类型一致性测试**（仅测试文件 import pi 类型，断言冻结副本是 pi 协议的严格子集——pi 消息可赋值给我们的、事件负载是 pi 对应事件的投影），此后协议漂移直接 typecheck 失败。
   - 协议与 pi 的关系定为：**pi 词汇的严格子集 + 扩展事件（approval_*、notice）**。wire 上省略 `partial`/`turn_end.toolResults`/`agent_end.messages` 等重负载字段是序列化边界的职责（pi 的 AgentEvent 是进程内协议，靠引用共享才免费；跨 SSE 逐帧带累积消息在写大文件 / computer-use 截图场景是 MB~几十 MB 级浪费），不随引擎切换回收。进程内（persistence/hooks）阶段 2 起直接消费 pi 原生事件。pi 升版本时同步复核冻结副本是固定动作。
3. **服务端业务架构重思**——Workspace→Task→Run 产品重塑、会话存储选型、模块结构（v2 分支的 interfaces / routers-are-domain 实验是候选形态）。
4. **Renderer 整体优化**。

## 阶段 1 子步（全部完成）

- **1a. 协议模块落库** ✅（`991a7b1`）：`src/shared/protocol/` pi 词汇冻结副本，对真实 0.84.2 `.d.ts` 逐字段核过；偏离表在 events.ts 头部。
- **1b. 线协议 + 渲染端消费** ✅（`ad32bac`→`bc90cdc`）：protocol-bridge（UIMessageChunk→pi 事件，闭合保证）；pi-events 信封日志（seq 重放 + 实时尾随）；RunAssembler + PiChat 替换 useChat/transport，组件层零改动；auto-resume/审批/澄清/停止/重连语义逐项对齐并真机回归。
- **1c. DB 格式翻转** ✅（`84d136e`→`f79f83b`）：行粒度 pi 原生（user / 每 turn assistant / toolResult 单行，run_id 分组）；写侧 split、读侧 merge，旧行（run_id 空）原样透传不迁移；FTS 触发器双形态；编辑删除/scheduled 归因按 run 寻址。
- **1d. 单轨化 + 渲染端脱 SDK** ✅（`ce134d5`→`c53f6ce`）：旧 UIMessage SSE 轨/resumable store/`/stream` 端点退役，pi 事件日志成为唯一传输（assistant-stream、@ai-sdk/react 依赖移除）；`shared/ui-message.ts` 自持 UI 词汇，renderer 可达模块零 `ai` import。run-image/ACP 发射器仍产 UIMessageChunk 经 bridge 转换——它们随阶段 2 引擎一起换。

每子步收口条件（已执行）：回归清单相关段 + CDP 实测 + DB 对账，行为与迁移前一致。

## 纪律

- main 迁移期冻结新功能，只收 fix。
- **replace-in-kind**：阶段 1-2 只做等价替换；看到想重构的东西记入 `docs/debt.md`，不顺手动。
- 每子步结束停下 review；行为差异即 bug，不辩解。

## 资产索引

- `docs/feature-inventory.md`——全功能回归清单（原地迁移的验收底线）。
- `docs/research/v2-spec-reference.md`——协议设计（事件词汇、偏差表、防丢失不变量、reducer 参考）。
- `docs/research/session-persistence.md` / `session-layer.md`——阶段 2/3 的调研输入。
- 归档分支 `codex/rebuild-pi-agent-core`——pi 实操验证代码（Agent/Session/流式/打包 spike 全通过）、结构实验。
