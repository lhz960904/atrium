import { pullOllamaModel } from './local-service';

export type PullState = {
  model: string;
  /** The service's own phase text (pulling manifest / verifying…), 'success', or 'error'. */
  status: string;
  completed?: number;
  total?: number;
  /** Terminal — succeeded or failed; the entry lingers briefly so the polling
   *  client can observe the outcome, then drops. */
  done: boolean;
  error?: string;
};

const TERMINAL_LINGER_MS = 8000;

/**
 * Tracks in-flight model downloads so the renderer can poll their progress.
 * A pull outlives any single request (multi-GB downloads run for minutes), so
 * this is a main-process singleton keyed by model name: the mutation starts a
 * pull and returns immediately; the progress query reads this map. Terminal
 * states linger long enough for a poll cycle to see them (success triggers the
 * client's installed-list refresh; an error gets shown), then self-clean so
 * the model's download button comes back.
 */
export class PullManager {
  private readonly pulls = new Map<string, PullState>();

  constructor(
    private readonly pull: typeof pullOllamaModel = pullOllamaModel,
    private readonly lingerMs = TERMINAL_LINGER_MS,
  ) {}

  list(): PullState[] {
    return [...this.pulls.values()];
  }

  /** Start a pull unless one for this model is already running. */
  start(baseUrl: string, model: string): boolean {
    const existing = this.pulls.get(model);
    if (existing && !existing.done) return false;

    this.pulls.set(model, { model, status: 'starting', done: false });
    void this.pull(baseUrl, model, (p) => {
      this.pulls.set(model, {
        model,
        status: p.status,
        completed: p.completed,
        total: p.total,
        done: false,
      });
    })
      .then(() => {
        this.pulls.set(model, { model, status: 'success', done: true });
      })
      .catch((err: unknown) => {
        this.pulls.set(model, {
          model,
          status: 'error',
          done: true,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        setTimeout(() => {
          if (this.pulls.get(model)?.done) this.pulls.delete(model);
        }, this.lingerMs);
      });
    return true;
  }
}

export const pullManager = new PullManager();
