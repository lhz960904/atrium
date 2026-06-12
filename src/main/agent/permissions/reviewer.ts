import { generateText, type LanguageModel } from 'ai';

/** allow = auto-approve; deny = fall back to a user prompt. There is no third
 *  state — uncertainty, timeout, and failure all resolve to deny. */
export type ReviewVerdict = 'allow' | 'deny';

/** A model this slow on the approval path is worse than just asking the user. */
const REVIEW_TIMEOUT_MS = 6000;

const SYSTEM = `You are a security gate for a coding agent working inside a user's project. The agent wants to run one operation that a static check flagged as crossing the workspace boundary. Decide whether it is clearly safe to auto-approve, or whether a human should confirm it.

End your reply with exactly one word on its own: ALLOW or DENY.

ALLOW routine developer operations whose worst realistic outcome is harmless:
- read-only network requests to public sites (GET/HEAD: fetching docs, pages, public APIs, package metadata)
- installing well-known packages (npm/pip/brew/cargo install <known-package>)
- reading, listing, searching files; building; running tests

DENY operations that could cause real harm, exfiltrate data, or that you cannot fully judge:
- deleting or overwriting data (rm, mv onto an existing file, truncation, force-push)
- piping downloaded content into a shell (curl ... | sh)
- sending local data out (POST/PUT uploads, posting secrets or files)
- reaching internal, localhost, or cloud-metadata endpoints
- opaque, obfuscated, or unclear commands

When genuinely unsure, reply DENY — a human will then confirm.`;

export type ReviewArgs = {
  model: LanguageModel;
  /** The command or path to judge, shown to the reviewer verbatim. */
  subject: string;
  /** Optional hint on why it was flagged, when the caller knows something the
   *  subject alone doesn't show — the static gate passes its CrossingCode
   *  framing (e.g. "contains command substitution that hides what runs").
   *  Omitted by callers (like external agents) where the kind adds nothing the
   *  model can't read off the subject. */
  risk?: string;
  /** The turn's abort signal; the review is also bounded by its own timeout. */
  abortSignal?: AbortSignal;
};

/**
 * Ask the reviewer model whether a flagged operation is safe to auto-approve.
 * Only an explicit ALLOW passes; uncertainty, a DENY, a timeout, an
 * unconfigured/erroring model, or unparseable output all return 'deny', so the
 * caller falls back to a user prompt. The gate never widens access on its own —
 * it can only spare the user a prompt it was already going to show.
 */
export async function reviewBoundaryCrossing(args: ReviewArgs): Promise<ReviewVerdict> {
  const timeout = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
  const signal = args.abortSignal ? AbortSignal.any([args.abortSignal, timeout]) : timeout;
  try {
    const lead = args.risk ? `The operation ${args.risk}:` : 'The operation:';
    // No maxOutputTokens cap: a reasoning model spends tokens thinking before it
    // answers, and a tight cap would truncate it to empty (→ a false deny). The
    // 6s timeout bounds latency instead; the prompt keeps the answer terse.
    const { text } = await generateText({
      model: args.model,
      system: SYSTEM,
      prompt: `${lead}\n\n${args.subject}\n\nALLOW or DENY?`,
      abortSignal: signal,
    });
    return parseVerdict(text);
  } catch {
    // Timed out, model unreachable, generation failed — treat as "ask the user".
    return 'deny';
  }
}

/**
 * Read a verdict from free-form model output. DENY wins ties (a reply naming
 * both words is treated as not-clearly-safe), and the absence of an explicit
 * ALLOW is itself a deny — the safe default.
 */
function parseVerdict(text: string): ReviewVerdict {
  const upper = text.toUpperCase();
  if (upper.includes('DENY')) return 'deny';
  return upper.includes('ALLOW') ? 'allow' : 'deny';
}
