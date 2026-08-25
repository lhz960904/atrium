---
Status: Ready
Last updated: 2026-08-21
Baseline: main@4ca74fd5 (v0.14.3) + feat/artifact-workspace
Purpose: Parity ledger for the ground-up rebuild — every capability the rebuild must eventually cover or explicitly drop.
---

# Atrium main：Feature inventory（重建对齐账本）

> 本文是重建期间的对齐清单：每个里程碑关闭时，在此勾掉已覆盖条目或标注「有意不做」。技术正文用英文记录，避免翻译损耗。

## 0. Architecture contract (current)

- Two renderer↔main transports: `electron-trpc` over IPC (19 sub-routers, all CRUD/config) + localhost Hono HTTP server (random port, per-launch token `x-atrium-token`) for chat streaming.
- Resumable streams: in-memory store decoupled from clients (`server/resumable.ts`); reload/thread-switch rejoins mid-generation. Bounds: 64 streams / 100k chunks / idle TTL.
- DB is source of truth for history; client sends only the newest message.
- HTTP endpoints: `POST /api/chat`, `/abort`, `/acp-permission`, `/resolve-clarify`, `/compact`, `GET /stream` (replay).

## 1. Agent core (main)

- **Loop**: AI SDK `streamText` + `stopWhen: stepCountIs(100)`; `createUIMessageStream` wrapper so middleware emits transient data parts; smoothStream; Anthropic prompt-cache breakpoints (last two messages, anthropic-protocol only); readable error surfacing; retries.
- **System prompt**: identity, SOUL.md soul block, communication rules, workspace/platform/permission notes, codebase rules, workflow loop, VCS safety.
- **Middleware chain** (`beforeRun/beforeStep/afterStep/beforeToolUse/afterToolUse/afterRun/messageMetadata` + short-circuit/step-override):
  seal-tool-calls · title (≤6 words, same language) · metadata (durations, token/cache split, contextTokens) · usage ledger (frozen pricing) · screenshot-trim (keep 2, spill rest to disk) · compaction (cross-turn + within-turn at ~0.8 ratio; checkpoint pair; todo/skill preservers) · loop-detection (warn 3 / text-only stop 5) · skills index injection · memory injection (global+project, 25KB each) · instructions (AGENTS.md > CLAUDE.md, ancestor chain, 32KB) · profile (USER.md) · date (latest-user-turn anchored) · persistence.
- **Built-in tools (33)**:
  - fs/search: `read_file`, `write_file`†, `edit_file`†, `list_dir`, `grep`, `glob`
  - shell: `bash`† (120s, 20k cap, background), `bash_output`, `kill_shell` (process-tree kill)
  - web: `web_search` (headless BrowserWindow scraping, engine chain), `web_fetch` (Readability→Markdown, 5MB)
  - control: `todo_write`, `task` (subagent), `skill`, `ask_clarification` (client-side)
  - media: `image_gen` (model picked from enabled image-output models, `edit_previous`), `view_image`
  - persistence: `memory` (scopes global/project; types preference/project/reference), `profile`
  - scheduling: `schedule_create/list/update/cancel`
  - computer use (macOS, 9): `computer_list_apps/get_app_state/click/type_text/press_key/scroll/drag/set_value/perform_action`
  - MCP: `mcp__<server>__<tool>`, always gated, built-ins never shadowed. († = permission-gated)
- **Sandbox**: `Sandbox` interface + `LocalSandbox` (workspace-rooted), `BackgroundShells` (1MB buffer, cursor reads, detached process groups), pure-Node grep/glob, ignore lists.
- **Permissions**: 3 modes (default / auto-review / full-access); crossing codes network/dangerous/substitution/unparseable/wrapper/fsEscape/mcp; shell-quote command analysis with network/dangerous/wrapper lists; TrustRules (bash prefix, exact path, mcp server); LLM reviewer (6s timeout, deny-on-uncertainty); approval resumption native (turn end + auto-resume) vs ACP (parked promise + side endpoint).
- **Compaction**: token estimation (provider counts + 4-chars/token tail, 1600/image), budgeted recent window, structured summary prompt, checkpoint + ack pair, preserver interface.
- **Subagents**: built-ins `general-purpose`, `deep-research` (tool-allowlisted); custom in DB (prompt, tool allow/deny, pinned model); denied tools: task/skill/ask_clarification/schedule_*; 100 steps; own compaction/loop-detection/usage rows; live activity bubbled to parent.
- **Skills**: `<name>/SKILL.md` + frontmatter (`allowed-tools`); 4 roots (bundled, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`); bundled: computer-use, browser-control, get-acquainted; foreign tool-name aliasing; tool scoping while active; `${SKILL_DIR}`.
- **Memory**: file-backed `userData/memory/{global,projects/<ws>}` with MEMORY.md index; **dream** consolidation (30-min sweep, 24h+5-session gates, pid lock, snapshot/rollback, memory-tool-only agent, 40 steps).
- **MCP**: stdio/http/sse; per-server status + backoff reconnect (1s→30s), 30s connect / 120s call timeouts; OAuth 2.1 (discovery+DCR+PKCE+refresh, loopback callback, separate encrypted blob); qualified naming (≤64 bytes slug+hash); image results → real image parts (vision-gated), oversized spill to `.atrium/media`; safeStorage secrets, envPassthrough/headersFromEnv; bidirectional `mcp.json` (Cursor/Claude Desktop/VS Code dialect) + imports from Cursor/Claude Code/Claude Desktop/Codex(TOML); `managed: true` rows (browser).
- **ACP external agents**: Claude Code / Codex CLI / Gemini CLI; one live session per thread (LRU 6), session id persisted → resume via `session/load`; ChunkEmitter translates session/update → UIMessageChunks (external tools as dynamic-tool parts); permission broker; auto-review can auto-allow; not-installed hinting.
- **Computer use (macOS)**: signed Swift helper app spawned as child (inherits TCC), JSON-lines RPC, 30s timeout, SIGKILL+respawn; AX tree + `desktopCapturer` screenshots; virtual cursor overlay (toggleable, hidden on settle, suppressed for list_apps); drag-to-grant flow into Privacy pane with tracking overlay; renderer permission dialog + relaunch.
- **Browser control**: two managed MCP rows running `npx @playwright/mcp` (`browser` --isolated; `browser-login` --extension into user Chrome); output-dir under `userData/media/browser`; Chrome + extension detection; clipboard token import (polled), encrypted.
- **Scheduled tasks**: recurring (5-field cron, croner, IANA tz) + once (self-disabling); bound thread/project/model/permission mode (default full-access); catchUpPolicy fire_once/skip; boot rebuild + powerMonitor resume catch-up; powerSaveBlocker during runs; run history (`running|ok|error|skipped|interrupted`); auto-pause after 5 consecutive failures; skip if thread busy; desktop notification → open thread.
- **Providers**: kinds cloud-api / local-cli / local-service; protocols anthropic / openai-compatible / google-gemini (+`/v1` normalization); manifest catalog (Anthropic, OpenAI, DeepSeek, Gemini, Moonshot, Kimi/Z.AI/Volcengine plans, OpenRouter, AiHubMix, 3 CLIs, Ollama); safeStorage credentials; model fetch per protocol; Ollama probe/list/pull-with-progress; litellm model catalog 3-tier (bundled→disk→hourly refresh) supplying context/output limits, vision/tool/reasoning flags, image-output detection, pricing; image-output models route chat turns to `run-image.ts`.
- **DB (SQLite WAL, Drizzle)**: threads (per-thread model, metadata.acpSession, last_read_at, archived_at, pinned) · projects · messages (parts JSON) · artifacts (unused on main) · providers · subagents · mcp_servers · usage (kind chat/subagent/title/summary/review, frozen cost) · scheduled_tasks + runs. **FTS**: `chat_fts` with jieba-wasm as SQL function, trigger-maintained, bm25 + title boost, custom snippets.
- **Settings** (zod schema → defaults + patch validation, electron-conf): general (language, defaultModel, autoTitle, menuBar, sendKey, hideTokenUsage) · appearance (windowState, uiFont, fontSize, light/dark Shiki themes) · keyboard · permissions (mode, trustRules, reviewerModel) · browser · computerUse (+openAtLogin via Electron API).
- **Shell/OS**: hidden-inset window (min 880×560), hide-on-close macOS, tray + New Chat, notifications, login-shell env resolution before stdio MCP, `atrium-favicon://` protocol (direct fetch, disk cache), openExternal.
- **Auto-update**: electron-updater state machine, startup + hourly checks, GitHub provider, mac dmg+zip / win nsis / linux AppImage, per-arch runners + merged mac manifest, helper disposed before install.
- **Logging**: electron-log behind lazy facade; ~18 scoped loggers; no analytics.

## 2. Renderer

- **Routes** (TanStack Router, hash history): root (palette, attachment viewer, update + computer dialogs, toaster, global hooks) · `_app` home (greeting, composer, project picker, onboarding card, recent 5) · `chat/$threadId` · `scheduled` (list + sliding detail) · `settings/$section` (17 sections, 4 groups, MCP attention dot).
- **Chat**: `useChat` + per-thread Chat LRU (switch never aborts; `resume` reconnects) · newest-message-only transport · throttle 50 · stick-to-bottom · Streamdown (GFM, KaTeX `$$`, Mermaid pan/zoom, char fade-in) · Shiki sync highlighter (15 themes, language icons, copy) · link chips with real favicons · attachments/images · generated-image viewer (zoom/download).
- **Turn structure** (Codex-style assistant-view): thinking disclosure / trace ("Worked for Xs", tool markers + expands, per-tool presentation, inline screenshots latest-only, SubagentCard live activity, duration+tokens) / final answer; CompactionDivider; loading states.
- **Interaction**: message edit + branch (truncate tail, re-run, attachments preserved) · Stop (button/Esc, abort POST, mirror-seal) · approval cards unified native+ACP (allow once/always/deny, 600ms hold) · AutoReviewToast · ClarifyCard (tabs, single/multi/text, previews) · PlanPanel (progress, collapsible) · long-message collapse · skill chips · header (rename, copy-as-Markdown, export .md, archive) · per-message metadata · error notice.
- **Composer**: Tiptap; configurable send key, IME-safe; attachments (picker/paste/drag; image + text allowlists); `/` menu (commands + skills); inline ModelPicker (grouped, icons, search, inherit); PermissionPicker; TokenCounter (session + context occupancy, amber/red); ProjectPicker.
- **Sidebar**: Pinned / Projects (collapsible, per-project threads, native-dialog add, menus) / Chats; unread dot, running spinner (2s poll), scheduled badge, context menus; background-run detection invalidates caches; resizable/collapsible; memoized rows.
- **Command palette**: cmdk; commands + FTS chat search (debounced, highlighted snippets, deep-link to message).
- **Settings**: general · identity (edit SOUL/USER, onboarding) · appearance (theme tiles, font, size, code themes with live preview) · memories browser · keyboard rebinding · usage (range picker, stat cards, DailyCostChart, TokenHeatmap) · providers (two-pane, masked keys, model toggles, Ollama pull UI) · skills (read-only) · subagents CRUD · mcp (status poll, forms, OAuth, CodeMirror JSON editor, imports, export) · browser · computer (grant flow) · permissions (mode, reviewer, trust rules) · hooks/connections/worktrees (placeholders) · archived (search + restore) · about (update).
- **State**: 15 zustand stores (approval, attachments, palette, compaction, image-gen, per-thread model, nav, pending-input, permission, sidebar, subagent, theme, toast, update, usage-prefs).
- **Theming/i18n**: token CSS + data-theme + ui-scale; en + zh-CN (~780 keys, 22 namespaces), typed keys, system-follow, startup cache; bilingual map in main for notifications.
- **Misc**: AttachmentViewer (zoom, text decode, PDF blob iframe), UpdateDialog (progress/ETA/notes), CodeEditor (CodeMirror + VS Code-style merge/diff theme), Kbd/Select/Tooltip/Toaster.

## 3. Shared layer

`tools.ts` (TOOL_NAMES/ToolName) · `chat-types.ts` (Trace/Tool/Subagent/Todo/Clarify/ImageToolOutput) · `chat.ts` (transient data parts, AtriumUIMessage, metadata) · `message-parts.ts` (NormalizedPart — the conversation-traversal layer) · `chat-markdown.ts` (copy/export) · `permissions/*` · `settings.ts` · `keybindings.ts` · `mcp.ts` · `cost.ts` · `update.ts` · `computer-use.ts` · `seal-tool-calls.ts`.

## 4. feat/artifact-workspace (unmerged, 9 commits, +11k lines)

Session dirs (`threads.sessionDir`, day-grouped, dual-root writes) · session folder contract in prompts + workspace menu · generated images as files in session outputs · structured file-change output from write/edit · diff overflow store + bash deliverable detection · ArtifactCard + artifacts tRPC router (wires the dormant `artifacts` table) · full design package `docs/product/design/artifact-viewing/` (297-line design + Vite preview: FileNavigator, ChangesSurface, TextSurface, ImageSurface, PdfSurface, UnsupportedSurface) + feature PRD + Codex/Cursor competitive references. Companion designs on main: `design/ARTIFACT-PANEL.md`, `design/SESSION-WORKSPACE.md`.

## 5. Known gaps on main (not parity targets)

artifacts table unused · hooks/connections/worktrees settings are placeholders · skills lack enable/disable · computer use macOS-only · auto-review shown but disabled in composer picker · no analytics, no cloud, no multi-window.
