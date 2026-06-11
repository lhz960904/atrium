import { generateText, type LanguageModel } from 'ai';

/** allow = auto-approve; deny = fall back to a user prompt. There is no third
 *  state — uncertainty, timeout, and failure all resolve to deny. */
export type ReviewVerdict = 'allow' | 'deny';

/** A model this slow on the approval path is worse than just asking the user. */
const REVIEW_TIMEOUT_MS = 6000;

const SYSTEM = `You are a security gate for a coding agent. The agent wants to run one operation that was flagged as sensitive. Decide whether it is clearly safe to auto-approve, or whether a human should confirm it.

Reply with exactly one word: ALLOW or DENY. No explanation. When in any doubt, reply DENY — a human will then confirm.

Auto-approve only routine, clearly-harmless operations (reading public docs, installing a well-known package). DENY anything that deletes or overwrites data, exposes secrets, runs an opaque or obfuscated command, or reaches an untrusted host.`;

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
    const { text } = await generateText({
      model: args.model,
      system: SYSTEM,
      prompt: `${lead}\n\n${args.subject}\n\nALLOW or DENY?`,
      abortSignal: signal,
      maxOutputTokens: 8,
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
