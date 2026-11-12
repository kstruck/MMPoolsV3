/**
 * Run `attempt`; if it fails in a way `retriable` accepts, wait and run it
 * again — a few times, and then give the last failure to the caller.
 *
 * For a request that is refused only because another request has not landed
 * yet. It is NOT a general "try harder": the caller says exactly which failure
 * is worth waiting out, and every other failure is thrown at once.
 *
 * `sleep` is a parameter so a test does not have to wait.
 */
export async function retryWhile<T>(
  attempt: () => Promise<T>,
  retriable: (error: unknown) => boolean,
  opts: { tries: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Never unbounded: NaN or Infinity would make `n >= tries` false forever.
  // (A count below one needs no clamp — the first attempt is always made.)
  const tries = Number.isFinite(opts.tries) ? Math.floor(opts.tries) : 1;
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      if (n >= tries || !retriable(error)) throw error;
      await sleep(opts.delayMs);
    }
  }
}

/**
 * "Record winners" was refused because the scores this page shows are not the
 * ones stored yet — the request that saves a typed score is still on its way.
 *
 * Matched on the server's own words (`recomputeSquaresWinners` in
 * `functions/src/squaresAdmin.ts`); `tests/squares-record-retry.test.ts` fails
 * if those words change without this.
 */
export const SCORES_NOT_SAVED_YET = /the scores are still being saved/i;

export function isScoresNotSavedYet(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && SCORES_NOT_SAVED_YET.test(message);
}
