# Atrium · Project Instructions

## Engineering principles

- **Best practice first** — research, cite the evidence (issue / doc / thread), then decide.
- **Latest stable major** — pin every package to its latest stable major; bump when new majors ship. On conflict with best-practice, use the version best-practice prescribes.

## Vercel AI SDK (core code)

- **Read the docs before writing.** Any Vercel AI SDK code MUST be preceded by reading the official docs (ai-sdk.dev) and using the latest documented best practice — proactively, before writing or changing it, not after being told. *Why: this is the software's core code region, so it must always be correct and best-practice.*

## Code comments

- **Placement decides the style.** Inside a function body, prefer single-line comments. At a function head/top, or for hack / trick / non-obvious logic, use a multi-line comment that fully explains the *why* — don't truncate where understanding is at stake.
- **No internal numbers.** Never reference project design / step numbers in comments (D6.1, Variant A, Step 5, 5.c, V0…). Describe what the code is and why — carry the knowledge into the comment, not the bookkeeping.

## Commits

- Describe what the change does in plain functional terms; **never** include project-internal numbering (Step 1.1, D8, V0, Phase…). Reference a design by its semantic name ("empty state"), not its D-number.
- Commit cadence: each reviewed sub-task → commit before the next; don't batch a whole step into one big diff.
