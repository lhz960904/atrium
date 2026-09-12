# Atrium · Project Instructions

## Engineering principles

- **Best practice first** — research, cite the evidence (issue / doc / thread), then decide.
- **Latest stable major** — pin every package to its latest stable major; bump when new majors ship. On conflict with best-practice, use the version best-practice prescribes.
- **Reuse package types, don't reinvent them.** Before hand-rolling a type (especially a loose `Record<string, unknown>` shim), check whether the package already exports it. Prefer importing the real type; when no single export fits, derive from one with indexed/utility types (e.g. `Exclude<ModelMessage['content'], string>[number]` for a content part) over re-declaring the shape. *Why: hand-rolled types drift from the source of truth and lose the package's discriminated-union narrowing.*

## Vercel AI SDK (core code)

- **Read the docs before writing.** Any Vercel AI SDK code MUST be preceded by reading the official docs (ai-sdk.dev) and using the latest documented best practice — proactively, before writing or changing it, not after being told. *Why: this is the software's core code region, so it must always be correct and best-practice.*

## Main-process layout

`src/main` is organised by ownership, not by dependency. Put a new file where its
responsibility lives, not next to whatever it already imports.

| Module | Owns |
| --- | --- |
| `api/` | The renderer-facing surface: the chat endpoints and every tRPC router. |
| `agent/runtime/` | How a turn is assembled and executed — plus `context/` (what goes into the prompt) and `stream/` (the run's outward event path). |
| `agent/<capability>/` | One thing the agent can do or be configured with: tools, mcp, skills, subagent, sandbox, memory, profile, instructions, prompts, permissions, providers, automation. |
| `conversation/` | The durable conversation: threads, sessions, the journal a run writes, the projection a reader gets back. |
| `db/`, `settings/` | Schema and access; user and window settings. |
| `platform/` | Modules whose whole job is a boundary with Electron, the OS or a native process. Not "anything that imports electron" — `db`, `settings` and others do too, and own a domain of their own. |
| `utils/` | Depends on no top-level module. Anyone may import it; it imports nobody. |

Rules, each of which currently holds:

- `agent/runtime` is the **only** turn-level composition layer, and `index.ts` the only process-level one.
- `api` owns no state and makes no domain decisions — it translates a request into a call and a result into a response. Model resolution, folding, persistence and "which calls are still open" belong to the layer that owns a turn.
- `conversation` must not depend on providers, MCP servers, skills or tools.
- `platform` must not depend on `agent` or `conversation`.
- Cross-module imports use `@main/*`; inside a module, relative paths. Root-level `index.ts` keeps plain relative paths.

## Code comments

- **Placement decides the style.** Inside a function body, prefer single-line comments. At a function head/top, or for hack / trick / non-obvious logic, use a multi-line comment that fully explains the *why* — don't truncate where understanding is at stake.
- **No internal numbers.** Never reference project design / step numbers in comments (D6.1, Variant A, Step 5, 5.c, V0…). Describe what the code is and why — carry the knowledge into the comment, not the bookkeeping.

## Commits

- **Angular Conventional Commits** format: `type(scope): subject` (e.g. `feat(chat): stream tool calls`). Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `build`, `ci`. Scope is the area touched (`chat`, `tools`, `agent`, `db`…); omit it if the change is cross-cutting. Subject is imperative and lowercase.
- Describe what the change does in plain functional terms; **never** include project-internal numbering (Step 1.1, D8, V0, Phase…). Reference a design by its semantic name ("empty state"), not its D-number.
- Commit cadence: each reviewed sub-task → commit before the next; don't batch a whole step into one big diff.

## Pull requests

- **Squash-merge only.** A PR lands on `main` as exactly **one** commit, so the release-please changelog shows a single entry per PR. The branch may carry many small per-step commits for review — squashing collapses them. Never rebase-merge or merge-commit a PR. The repo is configured to allow squash only (the other buttons are disabled). The squash commit's subject is the **PR title**, so write the PR title as a clean `type(scope): subject` conventional commit — that's what release-please reads.
- Merge via `gh pr merge <n> --squash` (add `--auto` after `gh pr ready` to land on green CI).
