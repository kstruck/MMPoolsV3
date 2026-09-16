import { ESPN_SITE_API } from './espnHost';

/**
 * ESPN's site API stopped accepting date-RANGE scoreboard requests on
 * 2026-09-15 (~21:55Z). Any URL of the form
 * `.../scoreboard?dates=YYYYMMDD-YYYYMMDD` now answers HTTP 400 with body
 * `{"code":400,"message":"Failed to get events endpoint."}`. Measured host-wide
 * on the ESPN site API host (the one named in `espnHost.ts` — do not paste the
 * hostname here, `espnHost.test.ts` fails on a literal), including for
 * prior-season dates, so it is an ESPN API change and not our data. A SINGLE
 * date (`?dates=YYYYMMDD`) still answers 200.
 *
 * This module replaces a range request with one request per day over the span,
 * unioning the events. Measured 2026-09-15 against the LIVE API over the real
 * 2025 tournament span (20250315..20250410, `limit=200&groups=100`):
 * 27 single-date requests, every one HTTP 200, 67 events total — exactly the
 * 67 games of a 68-team bracket. The range URL for that same span returned 400.
 *
 * Two deliberate behaviours, both pinned by
 * `functions/src/__tests__/espnScoreboardSpan.test.ts`:
 *
 *  - A day that fails is SKIPPED, never fatal. One 400 (or one flaky socket)
 *    in the middle of the span must not throw away the other days' games.
 *  - If EVERY day fails, the caller gets a throw. A total ESPN outage must not
 *    be indistinguishable from "the tournament has no games", which would let a
 *    caller happily import an empty bracket.
 *
 * The span is capped (SCOREBOARD_SPAN_MAX_DAYS) so a typo'd year can never fan
 * out into thousands of live requests.
 */

/** Hard ceiling on span length. The real spans here are 14 and 27 days. */
export const SCOREBOARD_SPAN_MAX_DAYS = 45;

/** How many single-date requests are in flight at once. */
const SPAN_FETCH_CONCURRENCY = 6;

/**
 * Per-request deadline. A span is 27 requests where it used to be 1, so a
 * stalled ESPN socket is now 27x more likely to be the thing that ends the run:
 * without a deadline it holds its worker until the CLOUD FUNCTION times out, and
 * `scheduledBracketSync` loops over tournaments sequentially, so the stall costs
 * every LATER tournament its run too (qodo review of PR #696).
 *
 * With this, a stall becomes an ordinary failed day: skipped, logged, and the
 * other days still land. 10s is well clear of a healthy response — the live
 * 2026-09-15 measurement returned each day in well under a second — and 5 waves
 * of 10s worst case is 50s per tournament, inside the job's 300s budget.
 */
export const SCOREBOARD_DAY_TIMEOUT_MS = 10_000;

const YYYYMMDD = /^\d{8}$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcMillis(yyyymmdd: string): number {
    if (!YYYYMMDD.test(yyyymmdd)) {
        throw new Error(`ESPN scoreboard date must be YYYYMMDD, got "${yyyymmdd}"`);
    }
    const year = Number(yyyymmdd.slice(0, 4));
    const month = Number(yyyymmdd.slice(4, 6));
    const day = Number(yyyymmdd.slice(6, 8));
    const ms = Date.UTC(year, month - 1, day);
    // Date.UTC happily rolls 20260231 over into March. Re-format and compare so
    // an impossible calendar date is rejected instead of silently shifting.
    if (formatScoreboardDate(ms) !== yyyymmdd) {
        throw new Error(`ESPN scoreboard date is not a real calendar date: "${yyyymmdd}"`);
    }
    return ms;
}

/** UTC epoch millis -> `YYYYMMDD`. */
export function formatScoreboardDate(ms: number): string {
    const d = new Date(ms);
    const y = String(d.getUTCFullYear()).padStart(4, '0');
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

/**
 * Every date in `[start, end]` inclusive, as `YYYYMMDD`, in ascending order.
 * Throws on a malformed date, on `end` before `start`, and on a span longer
 * than SCOREBOARD_SPAN_MAX_DAYS.
 */
export function enumerateScoreboardDates(start: string, end: string): string[] {
    const startMs = toUtcMillis(start);
    const endMs = toUtcMillis(end);
    if (endMs < startMs) {
        throw new Error(`ESPN scoreboard span ends before it starts: ${start}..${end}`);
    }
    const dayCount = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
    if (dayCount > SCOREBOARD_SPAN_MAX_DAYS) {
        throw new Error(
            `ESPN scoreboard span ${start}..${end} is ${dayCount} days, over the ` +
            `${SCOREBOARD_SPAN_MAX_DAYS}-day cap`,
        );
    }
    const dates: string[] = [];
    for (let i = 0; i < dayCount; i++) {
        dates.push(formatScoreboardDate(startMs + i * MS_PER_DAY));
    }
    return dates;
}

export interface ScoreboardDayUrlParams {
    /** e.g. `basketball/mens-college-basketball` — no leading or trailing slash. */
    leaguePath: string;
    /** A SINGLE `YYYYMMDD`. A range here is exactly the thing that 400s. */
    date: string;
    limit: number;
    groups: number | string;
}

/**
 * Build the one-day scoreboard URL. Single `dates=` value by construction —
 * this function is the reason a range can no longer be reintroduced by accident.
 */
export function buildScoreboardDayUrl({ leaguePath, date, limit, groups }: ScoreboardDayUrlParams): string {
    if (!YYYYMMDD.test(date)) {
        throw new Error(`ESPN scoreboard day URL needs a single YYYYMMDD date, got "${date}"`);
    }
    return `${ESPN_SITE_API}/${leaguePath}/scoreboard?dates=${date}&limit=${limit}&groups=${groups}`;
}

export interface ScoreboardSpanParams extends Omit<ScoreboardDayUrlParams, 'date'> {
    /** First day of the span, `YYYYMMDD`. */
    start: string;
    /** Last day of the span, `YYYYMMDD`, inclusive. */
    end: string;
}

export interface ScoreboardSpanResult<TEvent> {
    /** Union of every day's events, de-duplicated by event id, date order. */
    events: TEvent[];
    /** Every day we asked for. */
    requestedDates: string[];
    /** Days that did not come back 200, or whose body would not parse. */
    failedDates: string[];
}

export interface ScoreboardSpanDeps {
    /** Injected in tests. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Injected in tests so a failing day is visible without a logger. */
    onDayFailed?: (date: string, error: unknown) => void;
    /** Per-request deadline. See SCOREBOARD_DAY_TIMEOUT_MS. */
    requestTimeoutMs?: number;
}

/**
 * One day's request, with a hard deadline.
 *
 * The deadline is enforced TWICE on purpose: the `AbortSignal` asks the
 * transport to give up (so a stalled socket is actually released rather than
 * left running), and the race guarantees this promise settles even if the
 * `fetchImpl` in play ignores signals. Belt and braces, because the failure this
 * guards against is "the run never finishes", which no retry can recover.
 */
async function fetchWithDeadline(
    fetchImpl: typeof fetch,
    url: string,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`ESPN scoreboard request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([fetchImpl(url, { signal: controller.signal }), deadline]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

interface MinimalEvent {
    id?: string;
}

/**
 * Fetch every day in the span and union the events.
 *
 * Resolves with the events it could get, plus the list of days it could not.
 * Rejects only when EVERY day failed — see the module comment.
 */
export async function fetchScoreboardSpanEvents<TEvent extends MinimalEvent>(
    { leaguePath, start, end, limit, groups }: ScoreboardSpanParams,
    { fetchImpl = fetch, onDayFailed, requestTimeoutMs = SCOREBOARD_DAY_TIMEOUT_MS }: ScoreboardSpanDeps = {},
): Promise<ScoreboardSpanResult<TEvent>> {
    const requestedDates = enumerateScoreboardDates(start, end);

    // Index-keyed so the union stays in date order no matter what order the
    // concurrent requests settle in.
    const perDay: (TEvent[] | undefined)[] = new Array(requestedDates.length);
    const failedDates: string[] = [];

    let cursor = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const index = cursor++;
            if (index >= requestedDates.length) return;
            const date = requestedDates[index];
            try {
                const url = buildScoreboardDayUrl({ leaguePath, date, limit, groups });
                const response = await fetchWithDeadline(fetchImpl, url, requestTimeoutMs);
                if (!response.ok) {
                    throw new Error(`ESPN API Error: ${response.status} ${response.statusText}`);
                }
                const data = await response.json() as { events?: TEvent[] };
                perDay[index] = data?.events ?? [];
            } catch (error) {
                failedDates.push(date);
                onDayFailed?.(date, error);
            }
        }
    };

    const workerCount = Math.min(SPAN_FETCH_CONCURRENCY, requestedDates.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    if (failedDates.length === requestedDates.length) {
        // Every single day failed. Do NOT hand back an empty span as success.
        throw new Error(
            `ESPN scoreboard span ${start}..${end} failed on all ${requestedDates.length} days`,
        );
    }

    const events: TEvent[] = [];
    const seenIds = new Set<string>();
    for (const dayEvents of perDay) {
        if (!dayEvents) continue;
        for (const event of dayEvents) {
            // A game listed on two adjacent days (late tip rolling past UTC
            // midnight) must not be imported twice.
            if (typeof event?.id === 'string' && event.id !== '') {
                if (seenIds.has(event.id)) continue;
                seenIds.add(event.id);
            }
            events.push(event);
        }
    }

    // Sorted failures read better in logs than settle order.
    failedDates.sort();

    return { events, requestedDates, failedDates };
}
