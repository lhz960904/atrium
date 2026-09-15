/**
 * Wait for work to finish, but not forever. A failure counts as finished — the
 * caller is shutting down and has nowhere to report it — and the timer is
 * cleared either way, so a short budget can't hold the process open.
 */
export async function drainWithin(
  pending: Promise<unknown>,
  ms: number,
): Promise<'drained' | 'timed_out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), ms);
  });
  const drained = pending.then(
    () => 'drained' as const,
    () => 'drained' as const,
  );
  try {
    return await Promise.race([drained, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
