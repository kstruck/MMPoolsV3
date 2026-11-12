/**
 * Squares winner records follow the scores (PLAN-SQUARES-REOPEN B2, D12). PURE.
 *
 * `pools/{id}/winners/{docId}` is the record a commissioner pays from. It used
 * to be written once, at the moment a period went final, by code that had its
 * own copy of the payout rules — so it ignored charity, rollover and the
 * reverse-winner edge, never healed a period that finalized before the grid had
 * numbers, and never moved when a score was corrected.
 *
 * Now: every time scores are processed, the winner documents the rules call for
 * are computed by `squaresPayouts` and compared with what is stored. Only
 * differences are written.
 *
 * WHY THIS IS IN `shared/`. `planWinnerWrites` decides what the server writes.
 * The commissioner's page has to answer the same question — "do the records
 * match the scores?" — before it offers to record anything, and it used to
 * answer it with a shorter rule of its own that only looked for records that
 * were MISSING. A record that should be REMOVED (a quarter's score switched
 * off after its winner was recorded) was invisible to it, so the page said the
 * records matched and hid the one button that would have fixed them (qodo, PR
 * #759). The page now runs this planner and shows what it returns. So does the
 * reading of a drawn prize (`recordedEntry`), which had a second copy on the
 * page for the same reason.
 *
 * The part that touches Firestore (`applyWinnerPlan`) stays in
 * `functions/src/lib/squaresWinners.ts`.
 */
import {
    computeEventPayouts,
    computePeriodPayouts,
    isPlayerOwner,
    scoreEventStrategy,
    toCents,
    type EventClaimInput,
    type PayoutPool,
    type Period,
    type PeriodScore,
    type RecordedWinners,
} from './squaresPayouts';

/** Every document id a period (as opposed to a scoring event) can produce. */
export const PERIOD_WINNER_IDS: ReadonlySet<string> = new Set([
    'q1', 'q1_reverse', 'half', 'half_reverse', 'q3', 'q3_reverse',
    'final', 'final_reverse', 'final_rollover',
]);

export const isEventWinnerId = (id: string): boolean => id.startsWith('event_');

/**
 * A stored period record as the payout math takes it.
 *
 * For a DRAWN `final_rollover` the winner is read from `drawnOwner` /
 * `drawnSquareId` — what the draw chose — not from `owner`, which a later
 * change of rule can overwrite. The draw is a fact; the current owner is a
 * computed value.
 */
export function recordedEntry(w: StoredWinner): { squareId: number; owner: string | null; drawn?: boolean } {
    const drawn = !!w.data.drawnAt;
    const owner = drawn && typeof w.data.drawnOwner === 'string' ? w.data.drawnOwner : w.data.owner;
    const squareId = drawn && w.data.drawnSquareId !== undefined && w.data.drawnSquareId !== null ? w.data.drawnSquareId : w.data.squareId;
    return { squareId: Number(squareId), owner: typeof owner === 'string' ? owner : null, drawn };
}

/** `event_14_7` / `event_rev_14_7` → the score that event produced. */
export function parseEventWinnerId(id: string): { home: number; away: number; isReverse: boolean } | null {
    const m = /^event_(rev_)?(\d+)_(\d+)$/.exec(id);
    if (!m) return null;
    return { isReverse: !!m[1], home: Number(m[2]), away: Number(m[3]) };
}

export interface StoredWinner {
    id: string;
    data: Record<string, unknown>;
}

/** The audit line a write carries. Structurally what the server's audit writer takes. */
export interface AuditSpec {
    type: 'WINNER_COMPUTED';
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    payload?: Record<string, unknown>;
}

export type WinnerWrite =
    | { kind: 'create'; id: string; doc: Record<string, unknown>; audit: AuditSpec }
    | { kind: 'update'; id: string; fields: Record<string, unknown>; audit?: AuditSpec }
    | { kind: 'delete'; id: string; audit: AuditSpec }
    | { kind: 'audit'; audit: AuditSpec };

/** The fields the payout math owns. Everything else on the doc is left alone. */
const COMPUTED_FIELDS = ['period', 'squareId', 'owner', 'amount', 'homeDigit', 'awayDigit', 'isReverse', 'isRollover', 'description'] as const;

const money = (n: unknown) => `$${toCents(Number(n) || 0).toFixed(2)}`;

/**
 * What must be written so the winner documents match the scores.
 *
 * `scores` holds the periods that are FINAL. `existing` is every document in
 * the pool's `winners` subcollection, plus any event document this same
 * transaction is about to create.
 *
 * Returns nothing for a grid with no numbers: no winner can be computed, and an
 * empty result must not be read as "delete what is recorded".
 */
export function planWinnerWrites(
    pool: PayoutPool,
    scores: Partial<Record<Period, PeriodScore | null | undefined>>,
    existing: ReadonlyArray<StoredWinner>,
    opts: { gameFinal: boolean },
): WinnerWrite[] {
    const usable = (a: unknown): boolean => {
        const x = a as { home?: unknown; away?: unknown } | null | undefined;
        return !!x && Array.isArray(x.home) && Array.isArray(x.away) && x.home.length === 10 && x.away.length === 10;
    };
    const hasNumbers = usable(pool.axisNumbers)
        || (pool.numberSets === 4 && Object.values(pool.quarterlyNumbers ?? {}).some(usable));
    if (!hasNumbers) return [];

    const writes: WinnerWrite[] = [];
    const byId = new Map(existing.map((w) => [w.id, w]));

    // ---- Periods ----
    const recorded: Record<string, { squareId: number; owner: string | null; drawn?: boolean }> = {};
    for (const w of existing) {
        if (!PERIOD_WINNER_IDS.has(w.id)) continue;
        recorded[w.id] = recordedEntry(w);
    }

    const claims = computePeriodPayouts(pool, scores, recorded as RecordedWinners).flatMap((r) => r.claims);
    const wanted = new Set<string>();

    for (const c of claims) {
        wanted.add(c.docId);
        const target: Record<string, unknown> = {
            period: c.period,
            squareId: c.squareId,
            owner: c.owner,
            amount: c.amount,
            homeDigit: c.homeDigit,
            awayDigit: c.awayDigit,
            isReverse: c.isReverse,
            isRollover: c.isRollover,
            description: c.description,
        };
        const payload = { period: c.period, docId: c.docId, squareId: c.squareId, winner: c.owner, amount: c.amount, homeDigit: c.homeDigit, awayDigit: c.awayDigit, isReverse: c.isReverse };
        const prior = byId.get(c.docId);

        if (!prior) {
            writes.push({
                kind: 'create', id: c.docId, doc: target,
                audit: { type: 'WINNER_COMPUTED', severity: 'INFO', message: `${c.description}: ${c.owner} (${money(c.amount)})`, payload },
            });
            continue;
        }

        const changed = COMPUTED_FIELDS.filter((k) => prior.data[k] !== target[k]);
        if (changed.length === 0) continue;

        const winnerChanged = prior.data.squareId !== c.squareId || prior.data.owner !== c.owner;
        const wasPaid = prior.data.isPaid === true;
        const fields: Record<string, unknown> = {};
        for (const k of changed) fields[k] = target[k];

        if (winnerChanged) {
            // "Paid" was a statement about the PREVIOUS winner. It does not carry over.
            if (wasPaid) { fields.isPaid = false; fields.paidAt = null; fields.paidByUid = null; }
            writes.push({
                kind: 'update', id: c.docId, fields,
                audit: {
                    type: 'WINNER_COMPUTED',
                    severity: wasPaid ? 'CRITICAL' : 'WARNING',
                    message: `${c.description} CHANGED: ${String(prior.data.owner)} → ${c.owner} (${money(c.amount)})`
                        + (wasPaid ? ' — the previous winner had been marked PAID' : ''),
                    payload: { ...payload, previousWinner: prior.data.owner, previousSquareId: prior.data.squareId, previousAmount: prior.data.amount, wasPaid },
                },
            });
        } else if (changed.includes('amount')) {
            writes.push({
                kind: 'update', id: c.docId, fields,
                audit: {
                    type: 'WINNER_COMPUTED',
                    severity: wasPaid ? 'WARNING' : 'INFO',
                    message: `${c.description}: prize for ${c.owner} is now ${money(c.amount)} (was ${money(prior.data.amount)})`
                        + (wasPaid ? ' — already marked PAID at the old amount' : ''),
                    payload: { ...payload, previousAmount: prior.data.amount, wasPaid },
                },
            });
        } else {
            writes.push({ kind: 'update', id: c.docId, fields });
        }
    }

    for (const w of existing) {
        if (!PERIOD_WINNER_IDS.has(w.id) || wanted.has(w.id)) continue;

        // 🛑 A DRAWN RECORD IS NEVER DELETED. Deleting it took `drawnAt` with
        // it, so a commissioner who disliked the draw could switch the final
        // score off and on and draw again (qodo, PR #759). It is kept at $0
        // while the scores call for no unclaimed prize, and it is still what
        // `drawSquaresFinalPrize` refuses a second draw on.
        if (w.data.drawnAt) {
            if (w.data.amount !== 0) {
                writes.push({
                    kind: 'update', id: w.id, fields: { amount: 0 },
                    audit: {
                        type: 'WINNER_COMPUTED',
                        severity: 'CRITICAL',
                        message: `The scores no longer call for an unclaimed final prize, so the drawn prize for ${String(w.data.drawnOwner ?? w.data.owner)} is now $0.00 (was ${money(w.data.amount)}). The draw stays on record and cannot be made again`,
                        payload: { docId: w.id, drawnOwner: w.data.drawnOwner ?? w.data.owner, previousAmount: w.data.amount, wasPaid: w.data.isPaid === true },
                    },
                });
            }
            continue;
        }

        const wasPaid = w.data.isPaid === true;
        writes.push({
            kind: 'delete', id: w.id,
            audit: {
                type: 'WINNER_COMPUTED',
                severity: wasPaid ? 'CRITICAL' : 'WARNING',
                message: `Winner record ${w.id} (${String(w.data.owner)}, ${money(w.data.amount)}) no longer applies and was removed`
                    + (wasPaid ? ' — it had been marked PAID' : ''),
                payload: { docId: w.id, previousWinner: w.data.owner, previousAmount: w.data.amount, wasPaid },
            },
        });
    }

    // ---- Scoring events (Every Score Pays) ----
    // Amounts are only knowable once the game is over and the events are counted.
    if (opts.gameFinal && scoreEventStrategy(pool) !== null) {
        const events: EventClaimInput[] = [];
        for (const w of existing) {
            const parsed = isEventWinnerId(w.id) ? parseEventWinnerId(w.id) : null;
            if (!parsed) continue;
            events.push({ docId: w.id, owner: typeof w.data.owner === 'string' ? w.data.owner : '', home: parsed.home, away: parsed.away, isReverse: parsed.isReverse });
        }
        if (events.length > 0) {
            const { pot, amounts, unclaimed } = computeEventPayouts(pool, events);
            let updated = 0;
            for (const e of events) {
                if (byId.get(e.docId)?.data.amount !== amounts[e.docId]) {
                    writes.push({ kind: 'update', id: e.docId, fields: { amount: amounts[e.docId] } });
                    updated++;
                }
            }
            if (updated > 0) {
                const paid = events.filter((e) => isPlayerOwner(e.owner)).length;
                writes.push({
                    kind: 'audit',
                    audit: {
                        type: 'WINNER_COMPUTED', severity: 'INFO',
                        message: `Finalized scoring-event payouts: ${money(pot)} across ${events.length} event(s), ${paid} won by a player`,
                        payload: { scoreChangePot: pot, eventCount: events.length, paidEvents: paid, unclaimed, updatedCount: updated },
                    },
                });
            }
        }
    }

    return writes;
}

export interface WinnerDrift {
    /** `add` a record, `change` one, `remove` one, or `events` (Every-Score-Pays prizes to finalize). */
    kind: 'add' | 'change' | 'remove' | 'events';
    text: string;
}

/**
 * A plan, as the commissioner is shown it BEFORE they press "Record winners":
 * what is not on record yet, what will change, and what will be removed.
 *
 * Empty means the records match the scores. A write with no audit line (a
 * reworded description, say) is housekeeping and is not listed, so it never
 * shows the commissioner a button for something they would not recognise.
 *
 * REMOVALS ARE LISTED. The page used to look only for records that were
 * missing; a quarter whose score was switched off after its winner had been
 * recorded left that winner on the books, payable, with the page reporting
 * that everything matched (qodo, PR #759).
 */
export function describeWinnerDrift(
    writes: ReadonlyArray<WinnerWrite>,
    existing: ReadonlyArray<StoredWinner>,
): WinnerDrift[] {
    const byId = new Map(existing.map((w) => [w.id, w]));
    const out: WinnerDrift[] = [];
    // "Q1 Winner — Alice ($250.00)" for a player. For a square nobody owns the
    // description already says so ("… — square unsold, prize rolls over"), so
    // no name is added — the stored owner there is the word "Rollover" or
    // "Unsold", which is a marker and not a person — and the amount is given
    // only when there is one.
    const line = (description: unknown, owner: unknown, amount: unknown, fallback: string): string => {
        const what = String(description ?? fallback);
        if (typeof owner === 'string' && isPlayerOwner(owner)) return `${what} — ${owner} (${money(amount)})`;
        return Number(amount) > 0 ? `${what} (${money(amount)})` : what;
    };
    for (const w of writes) {
        if (w.kind === 'create') {
            out.push({ kind: 'add', text: line(w.doc.description, w.doc.owner, w.doc.amount, w.id) });
        } else if (w.kind === 'delete') {
            const rec = byId.get(w.id)?.data ?? {};
            out.push({ kind: 'remove', text: line(rec.description, rec.owner, rec.amount, w.id) });
        } else if (w.kind === 'update' && w.audit) {
            out.push({ kind: 'change', text: w.audit.message });
        } else if (w.kind === 'audit') {
            out.push({ kind: 'events', text: 'Every Score Pays: the prize for each scoring event' });
        }
    }
    return out;
}

/** The final-period scores on a pool document, as the payout math takes them. */
export function finalScoresOf(scores: unknown): Partial<Record<Period, PeriodScore>> {
    const out: Partial<Record<Period, PeriodScore>> = {};
    const s = (scores ?? {}) as Record<string, unknown>;
    for (const p of ['q1', 'half', 'q3', 'final'] as const) {
        const v = s[p] as { home?: unknown; away?: unknown } | null | undefined;
        if (v && Number.isFinite(Number(v.home)) && Number.isFinite(Number(v.away))) {
            out[p] = { home: Number(v.home), away: Number(v.away) };
        }
    }
    return out;
}
