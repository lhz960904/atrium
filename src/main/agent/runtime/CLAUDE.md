# Agent Runtime

How a turn is assembled and executed. `Runner` is the only public entry: the
chat endpoints, tRPC and the scheduler all go through it.

## Who owns what

| Module | Owns |
| --- | --- |
| `runner.ts` | Application-lifetime run management: admission, cancellation, decisions, replay, shared shells. Builds no tools and creates no recorder. |
| `execute-run.ts` | One run, end to end: assembling context and tools, opening the session, registering hooks, running the loop, recording, cleanup. |
| `agent-loop.ts` | One pi `Agent` per instance. Turn limit, cancellation, `subscribe`. No business assembly. |
| `hook-compose.ts` | Folds a list of `HookSet`s into the single functions pi expects. The hooks themselves live in the modules that own them. |
| `pending-interactions.ts` | What one run is waiting on, and the race between a decision and a stop. Writes nothing to storage. |
| `complete.ts` | One text request with no tools, for titles, review and summaries. |
| `stream/convert.ts` | pi's `AgentEvent` → the wire's `AgentSessionEvent`. Drops what the wire doesn't carry. |
| `stream/run-event-buffer.ts` | `EventBuffer`: one run's event log, replayed from any seq then tailed live. Hands out envelopes; SSE framing belongs to `api/http.ts`. |

Hooks registered here but owned elsewhere: `../context/` (screenshot trim,
in-turn compaction, injection, date reminder), `../skills/scope.ts`,
`../tools/loop-detection.ts`, `../tools/interactions.ts`.

## Two maps, two lifetimes

`Runner` keeps runs in `active` and event logs in `buffers`, and they are
separate because they live for different lengths of time:

- `active` holds the runs a caller can still address — decide, abort, await. A
  run leaves the moment it settles.
- `buffers` holds one log per thread and **outlives its run**, so a reader can
  rejoin a run that just ended. Finished logs are evicted oldest-first past
  `MAX_FINISHED_LOGS`; a log whose run is still going is never evicted.

Look up by key when the caller has only a key — `subscribe`, `respond` and
`abort` arrive from outside holding a `threadId`. Hold a reference when the
caller owns the instance: a run keeps the `EventBuffer` it created, so it emits
into and closes its own log rather than whatever the thread currently has.

## A run's shape

`start()` opens the log synchronously, before returning, so the POST response
can subscribe immediately. It then awaits `executeRun` plainly and closes the
log in a `finally` — a reader tailing it must always see it end, including when
the run throws.

Inside `executeRun` the order is the meaning: `run_started` is the first event
on the stream, cleanup steps each run even if an earlier one failed, and
`run_finished` is last and means the app's own bookkeeping is done (pi's
`agent_end` only means the loop stopped). Events emitted after the log is
sealed are ignored, which is why a late title checks `finished` first.

`RunResult` distinguishes completed / aborted / failed inside the run;
`RunOutcome` collapses that to ok / error for callers, where **a cancelled run
is not an error** — the scheduler counts consecutive errors toward auto-pause.

## Two sinks, not one stream

A run's events go to two places that share only one producer:

- The wire: `emit` → `EventBuffer` → SSE. Fed by the loop (converted), by
  `executeRun` itself (`run_started`, `run_finished`, notices) and by
  `tools/interactions.ts`.
- The journal: `conversation/session-recorder.ts` → the pi session. Fed by the
  loop (`message_end` only), by `recorder.begin`/`end` and by the same
  interaction code.

pi awaits its listeners **sequentially, in subscription order**, so the two
`loop.subscribe` calls in `executeRun` are ordered on purpose: readers first,
then persistence, so the loop cannot run ahead of the store. Interactions do
the opposite — record first, then emit — because a decision must be durable
before the call it gates continues.

## Loop extension points

All of them take a single composed function; `composeHooks` does the folding.

- `beforeToolCall` — checks run in order; a `block` decision returns
  immediately and later checks do not run. A throwing check goes to pi, which
  turns it into a tool error; it is never treated as "allow".
- `afterToolCall` — runs in order, merging only fields a hook explicitly
  returned.
- `prepareNextTurn` — threads `context` forward; `model` and `thinkingLevel`
  take the last explicit value.
- `shouldStopAfterTurn` — the first `true` stops the turn. `maxTurns` is a hard
  ceiling in `agent-loop.ts` and short-circuits before the composed hook runs.
- `transformContext` — reuses `context/compose`'s skip-on-error behaviour and
  never rewrites stored history.

Registration order, main conversation: screenshot trim → in-turn compaction →
context injection → date reminder → skill tool scope → loop detection → tool
interactions. Subagents register compaction → date reminder → loop detection.
Both pin `maxTurns: 100`.

**Skill scope must stay ahead of loop detection.** Scope rebuilds the tool list
from the full set each turn so leaving a skill restores it; detection registered
after it keeps the list cleared once it trips, and cannot be undone by that
rebuild. `test/hook-compose.test.ts` covers this pairing — treat the order as a
constraint, not a preference.

There are deliberately **no turn-level hooks**. Persistence, usage and cleanup
are explicit steps in `executeRun`; nothing observes a run's start or end, so
no lifecycle layer exists to hang code on.

## Tests

`test/runtime.test.ts` spawns `runner.cases.ts` and `execute-run.cases.ts` in
child processes against real pi loops and a temporary SQLite session. The
isolation only keeps other suites' partial Electron mocks from colliding; it
replaces nothing.

Note that `bun test` does not typecheck. A stub that no longer matches a type
will run green — `tsc --noEmit` is what catches it.
