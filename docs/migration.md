---
Status: Active
Last updated: 2026-08-25
Branch: feat/protocol-isolation（基于 main@4ca74fd）
---

# pi 迁移计划：原地替换，四阶段

## 背景与决策

从零重建路线（codex/rebuild-pi-agent-core，已归档为参考库）被放弃：Atrium 代码量中 AI 底层只占两三成，从零重写把七八成产品功能重构横在核心目标之前。改为**原地替换**：每一步结束后应用完整可用，行为与迁移前一致。

四阶段，每阶段内部再拆子步、逐子步 review：

1. **协议隔离**——线协议 / DB parts 格式 / 渲染端消费层脱离 Vercel AI SDK 的 UIMessage，换成自有协议（pi 词汇冻结副本）。引擎仍是 AI SDK，在边缘做转换（转换器与旧引擎同生共死）。
2. **AI 层换 pi**——引擎 / 33 个工具（TypeBox）/ HITL（beforeToolCall）/ subagent / compaction 重接。业务层与 DB 不动；不引入 pi Session 账本（那是阶段 3 议题）。
3. **服务端业务架构重思**——Workspace→Task→Run 产品重塑、会话存储选型、模块结构（v2 分支的 interfaces / routers-are-domain 实验是候选形态）。
4. **Renderer 整体优化**。

## 阶段 1 子步

- **1a. 协议模块落库**：`src/shared/protocol/` 放 pi 词汇冻结副本（事件 + 消息内容），参考 `docs/research/v2-spec-reference.md` 的事件节与偏差表。不接线，纯类型 + 单测。
- **1b. 线协议 + 渲染端消费**：服务端在 SSE 边缘 `UIMessageChunk → pi 事件` 转换；渲染端自建 store + reducer 替换 useChat/chat-store/transport；保住 `shared/message-parts.ts` 的 NormalizedPart 形状（把它的输入换成 pi 词汇），组件层少动。断线重连语义不回退（resumable 等价物）。
- **1c. DB 格式翻转**：`messages.parts` 写入侧改 pi 词汇；旧行读取时转换（text/reasoning/tool part 机械映射），历史数据不迁移不丢失。
- **1d. 其余发射源改词汇**：`run-image.ts`、ACP `chunk-emitter`、scheduled 链路。

每子步收口条件：回归清单（`docs/feature-inventory.md`）相关段 + CDP 实测，行为与迁移前一致。

## 纪律

- main 迁移期冻结新功能，只收 fix。
- **replace-in-kind**：阶段 1-2 只做等价替换；看到想重构的东西记入 `docs/debt.md`，不顺手动。
- 每子步结束停下 review；行为差异即 bug，不辩解。

## 资产索引

- `docs/feature-inventory.md`——全功能回归清单（原地迁移的验收底线）。
- `docs/research/v2-spec-reference.md`——协议设计（事件词汇、偏差表、防丢失不变量、reducer 参考）。
- `docs/research/session-persistence.md` / `session-layer.md`——阶段 2/3 的调研输入。
- 归档分支 `codex/rebuild-pi-agent-core`——pi 实操验证代码（Agent/Session/流式/打包 spike 全通过）、结构实验。
