# Atrium

Personal AI workspace

## Stack

- **Shell**: Electron 39 + electron-vite 5
- **UI**: React 19 + TypeScript + Tailwind CSS v4
- **State / IPC**: electron-trpc + tRPC 10
- **Storage**: better-sqlite3 + Drizzle ORM + drizzle-kit (migration)
- **Tooling**: Bun (pkg mgr) + Biome (lint/format)

## Develop

```bash
bun install                   # 装依赖；electron-builder 自动 rebuild native bindings
bun run dev                   # 起 Electron + Vite HMR
bun run check                 # biome + tsc，提交前过一遍
bun run build                 # production 打包到 out/
```

## DB schema

Schema 定义在 `src/main/db/schema.ts`。改 schema 后：

```bash
bun run db:generate           # 生成 drizzle/migrations/*.sql
bun run db:push               # 直接把 schema sync 到 dev.db（开发期方便快速迭代）
bun run db:studio             # 在浏览器里浏览 dev.db
```

应用启动时自动 `migrate()` 同步到 `~/Library/Application Support/Atrium/atrium.db`（macOS）。

实现细节：runtime 用 `better-sqlite3`（原生 binding，跟 Electron 同 ABI）；drizzle-kit CLI 走 `@libsql/client`（纯 JS，跑在 Node 下不需要 ABI 重编译）。SQL dialect 一致，互不干扰。

## 目录

```
src/
├── main/            # Electron 主进程
│   ├── db/          # Drizzle schema + connection
│   └── trpc/        # tRPC router
├── preload/         # ipc 桥（electron-trpc bridge）
├── renderer/        # React UI
│   └── src/
│       ├── assets/  # tokens.css + styles.css（Tailwind v4 入口）
│       └── lib/     # tRPC client
└── shared/          # 跨进程共享类型（按需）
drizzle/migrations/  # 自动生成的 SQL migration
```

## 主题

`<html data-theme="light|dark">` 切换。Tokens 在 `src/renderer/src/assets/tokens.css`；Tailwind v4 `@theme inline` 把 CSS 变量暴露为 utility（`bg-canvas` / `text-fg-primary` / `border-accent` …）。
