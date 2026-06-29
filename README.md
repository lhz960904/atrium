<div align="center">

<img src="resources/icon.png" alt="Atrium" width="120" />

# Atrium

Atrium is a local-first desktop AI workspace. Connect to any model provider with your own
API keys, run a complete agentic toolchain on-device, and keep every conversation,
credential, and file under your control — no accounts, no intermediary servers.

[English](./README.md) · [简体中文](./README.zh-CN.md) · [Download](https://github.com/lhz960904/atrium/releases/latest)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/lhz960904/atrium?display_name=tag)](https://github.com/lhz960904/atrium/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/lhz960904/atrium/total)](https://github.com/lhz960904/atrium/releases)

</div>

## Demo

<!-- DEMO PLACEHOLDER — replace with the recorded demo once captured:
     • animated:  <img src="docs/demo.gif" alt="Atrium demo" width="860" />
     • or video:  https://github.com/user-attachments/assets/<id>.mp4 -->

<div align="center">
  <em>A short demo will go here.</em>
</div>

## Features

- **Multi-provider:** Anthropic, Google Gemini, any OpenAI-compatible endpoint, local models
  via Ollama, and external CLI agents (Claude Code, Codex, Gemini CLI) — all with your own
  keys, encrypted on-device.
- **Task planning:** the agent breaks a request into a live to-do plan you can watch it work
  through, step by step.
- **MCP:** connect Model Context Protocol servers (stdio / HTTP / SSE) and use their tools
  right inside a conversation.
- **Cross-session memory:** durable, scoped memory the agent reads and writes, so context
  carries across conversations.
- **Skills:** package reusable procedures as progressive-loading `SKILL.md` files the agent
  pulls in only when needed.
- **Subagents:** delegate isolated subtasks to focused agents that report back without
  cluttering the main thread.

## Architecture

The renderer talks to the main process two ways: tRPC over Electron IPC for CRUD and config,
and an HTTP stream from a localhost server for chat. The AI agent loop, storage, and provider
resolution all live in the main process.

<div align="center">
  <img src="docs/architecture.png" alt="Atrium architecture — layered overview" width="900" />
</div>

## Quick Start

**Prerequisites:** [Bun](https://bun.sh/) and a C/C++ toolchain for the `better-sqlite3`
native build (Xcode Command Line Tools on macOS, `build-essential` on Linux, the Visual
Studio C++ workload on Windows).

```bash
git clone https://github.com/lhz960904/atrium.git
cd atrium
bun install        # install deps; postinstall rebuilds native modules for Electron
bun run dev        # launch Electron + Vite with HMR
```

On first launch, open **Settings → Providers**, enable a provider, and paste in your API key
(it is encrypted with your OS keychain and stored locally).

Other common scripts:

```bash
bun run check      # biome (lint + format) + tsc typecheck — run before every commit
bun test           # unit tests
bun run build      # typecheck + bundle into out/
bun run build:mac  # package a .dmg (also build:win / build:linux)

# Database schema lives in src/main/db/schema.ts:
bun run db:generate   # emit a migration into drizzle/migrations/*.sql
bun run db:push       # push schema straight to dev.db
bun run db:studio     # browse dev.db in Drizzle Studio
```

## Issues & PRs

Contributions are welcome.

- **Found a bug or have an idea?** Open an
  [issue](https://github.com/lhz960904/atrium/issues/new/choose).
- **Sending a pull request?** Branch off `main`, make sure `bun run check` and `bun test`
  pass, and follow [Conventional Commits](https://www.conventionalcommits.org/)
  (e.g. `feat(chat): stream tool calls`). Never include API keys or secrets in a diff. See
  [CLAUDE.md](./CLAUDE.md) for the project's engineering principles.

## License

[MIT](./LICENSE) © lhz960904
