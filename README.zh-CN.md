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

- **多供应商支持：** Anthropic、Google Gemini、任意 OpenAI 兼容端点、通过 Ollama 运行的本地模型，以及外部 CLI agent（Claude Code、Codex、Gemini CLI）—— 全部使用你自己的密钥，并在本地加密。

- **MCP：** 连接 Model Context Protocol 服务器（stdio / HTTP / SSE），在对话里直接使用它们的工具。

- **跨会话记忆：** 持久、分作用域的记忆，agent 可读可写，让上下文在多次对话间延续。

- **Skills：** 把可复用的流程打包成渐进式加载的 `SKILL.md`，agent 只在需要时才拉取。

- **Subagents：** 把隔离的子任务委派给专注的 agent，由它回报结果，不污染主线程。

## 架构

渲染进程以两种方式与主进程通信：CRUD 与配置走 tRPC over Electron IPC，对话则从本地服务
拉取 HTTP 流。AI agent 循环、存储与提供商解析都位于主进程。

<div align="center">
  <img src="docs/architecture.png" alt="Atrium 架构分层总览" width="900" />
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
- **要提 PR？** 从 `main` 切分支，确保 `bun run check` 与 `bun test` 通过，并遵循
  [Conventional Commits](https://www.conventionalcommits.org/)（如
  `feat(chat): stream tool calls`）。切勿在 diff 中包含任何 API Key 或密钥。项目的工程
  原则见 [CLAUDE.md](./CLAUDE.md)。

## 许可证

[MIT](./LICENSE) © lhz960904
