<div align="center">

<img src="resources/icon.png" alt="Atrium" width="120" />

# Atrium

Atrium 是一款本地优先的桌面 AI Agent 助手。支持携带秘钥接入任意模型提供商，涵盖目前市面常见的 AI Agent 功能。

[English](./README.md) · [简体中文](./README.zh-CN.md) · [下载](https://github.com/lhz960904/atrium/releases/latest)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/lhz960904/atrium?display_name=tag)](https://github.com/lhz960904/atrium/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/lhz960904/atrium/total)](https://github.com/lhz960904/atrium/releases)

</div>

## 演示

<!-- 演示占位 —— 录制好后替换：
     • 动图：  <img src="docs/demo.gif" alt="Atrium 演示" width="860" />
     • 或视频：https://github.com/user-attachments/assets/<id>.mp4 -->

<div align="center">
  <em>这里将放一段简短演示。</em>
</div>

## 功能特性

- **多供应商支持：** Anthropic、Google Gemini、任意 OpenAI 兼容端点、通过 Ollama 运行的本地模型，以及外部 CLI agent（Claude Code、Codex、Gemini CLI）- 全部使用你自己的密钥，并在本地加密。

- **MCP：** 连接 Model Context Protocol 服务器（stdio / HTTP / SSE），在对话里直接使用第三方服务提供的工具。支持从主流工具直接导入，支持 第三方服务 Oauth 授权。

- **Skills：** 把可复用的流程打包成技能包（SKILL.md 等）渐进式披露给 Agent。支持从 Claude Code、Codex、.Agents 多数据源读取已有技能，自动统计使用频率过滤无用 Skill 描述。

- **Subagents：** 将大任务拆成子任务委派给专注的 Agent，在隔离的上下文中执行子任务并汇报结果，不污染主Agent 的上下文。支持创建和删除子Agent。

- **跨会话记忆：** 包含用户身份的录入（`get-acquainted` 技能），会话过程中自动写入记忆，可区分全局记忆、项目域记忆  持久。后台自动总结保证记忆的长期质量。

## 架构

渲染进程以两种方式与主进程通信：CRUD 与配置走 tRPC over Electron IPC，对话则从本地服务
拉取 HTTP 流。AI agent 循环、存储与提供商解析都位于主进程。

<div align="center">
  <img width="2288" height="2484" alt="image" src="https://github.com/user-attachments/assets/b9308391-f2b0-4e12-9a39-cd6369fec987" />
</div>


## 快速开始

**前置依赖：** [Bun](https://bun.sh/)，以及一套用于编译 `better-sqlite3` 原生模块的 C/C++
工具链（macOS 装 Xcode Command Line Tools，Linux 装 `build-essential`，Windows 装 Visual
Studio C++ 工作负载）。

```bash
git clone https://github.com/lhz960904/atrium.git
cd atrium
bun install        # 装依赖；postinstall 会为 Electron 重新编译原生模块
bun run dev        # 启动 Electron + Vite，带 HMR
```

首次启动后，打开 **设置 → 提供商**，启用某个提供商并粘贴你的 API Key（它会用操作系统
钥匙串加密后存放在本地）。

其他常用脚本：

```bash
bun run check      # biome（lint + 格式化）+ tsc 类型检查——每次提交前跑一遍
bun test           # 单元测试
bun run build      # 类型检查 + 打包进 out/
bun run build:mac  # 打包 .dmg（另有 build:win / build:linux）

# 数据库 Schema 在 src/main/db/schema.ts：
bun run db:generate   # 生成迁移到 drizzle/migrations/*.sql
bun run db:push       # 把 schema 直接同步到 dev.db
bun run db:studio     # 在 Drizzle Studio 里浏览 dev.db
```

## Issues & PRs

欢迎贡献。

- **发现 bug 或有想法？** 开一个
  [issue](https://github.com/lhz960904/atrium/issues/new/choose)。
- **要提 PR？** 从 `main` 切分支，确保 `bun run check` 与 `bun test` 通过，项目的工程原则见 [CLAUDE.md](./CLAUDE.md)。

## 许可证

[MIT](./LICENSE) © lhz960904
