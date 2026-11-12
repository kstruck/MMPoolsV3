/**
 * Squares payout math (PLAN-SQUARES-REOPEN B1). PURE — no Firebase.
 *
 * ONE definition of "who wins a period and what they are paid", used by the
 * score sync that RECORDS winners and by the pool page that DISPLAYS them.
 *
 * Why it exists. The server and the client each had their own copy and they
 * disagreed on every rule a commissioner can switch on:
 *
 *   - charity      — the wizard promises it is "deducted from the Total Pot
 *                    before winner payouts"; the client did, the server paid
 *                    percentages of the gross pot.
 *   - reverse      — the server halved every prize even when the reverse square
 *                    WAS the winning square (14–24), so half went to nobody.
 *   - rollover     — implemented only in the client, and only until the server
 *                    recorded an "Unsold" winner, after which it stopped.
 *   - unsold event — "rollover to next event / split among winners / return to
 *                    organizer" was read by nothing at all.
 *
 * A winner doc stores a dollar amount a commissioner then pays out, so a drift
 * here is money.
 */

export type Period = 'q1' | 'half' | 'q3' | 'final';
export const PERIODS: readonly Period[] = ['q1', 'half', 'q3', 'final'];

export const PERIOD_SHORT_LABEL: Record<Period, string> = {
  q1: 'Q1', half: 'Halftime', q3: 'Q3', final: 'Final',
};

/** What a winning square nobody bought is recorded as. */
export const UNSOLD = 'Unsold';
/** What a prize that moved on to a later period is recorded as. */
export const ROLLOVER = 'Rollover';

export interface AxisNumbers { home: number[]; away: number[] }
export interface PeriodScore { home: number; away: number }

/** The parts of a pool document the math reads. Extra fields are ignored. */
export interface PayoutPool {
  costPerSquare?: number;
  squares?: ReadonlyArray<{ owner?: string | null } | null | undefined>;
  payouts?: Partial<Record<Period, unknown>> | null;
  charity?: { enabled?: boolean; percentage?: number } | null;
  numberSets?: number;
  axisNumbers?: AxisNumbers | null;
  quarterlyNumbers?: Partial<Record<'q1' | 'q2' | 'q3' | 'q4', AxisNumbers | null>> | null;
  ruleVariations?: {
    reverseWinners?: boolean;
    quarterlyRollover?: boolean;
    unclaimedFinalPrizeStrategy?: 'last_winner' | 'random';
    scoreChangePayout?: boolean;
    scoreChangePayoutStrategy?: 'equal_split' | 'hybrid';
    scoreChangeHybridWeights?: { final?: number; halftime?: number; other?: number } | null;
    scoreChangeHandleUnsold?: 'rollover_next' | 'house' | 'split_winners';
  } | null;
}

/**
 * WHEN THESE RULES BEGAN — 2026-11-10T00:00:00Z.
 *
 * Squares creation was closed in code from 2026-08-28 until this work reopened
 * it, so every squares pool created before this date is a game that has already
 * been played and paid under the OLD rules (prizes on the gross pot, no
 * rollover on the server, a halved prize with no second winner). Its winner
 * records are history: what the commissioner actually paid from.
 *
 * Recomputing them under today's rules would rewrite that history — and it
 * would happen the first time anyone opened the pool's admin page. So the
 * record-keeping in `functions/src/lib/squaresWinners.ts` applies only to pools
 * created on or after this date, and every older pool is left exactly as it is.
 */
export const SQUARES_RULES_SINCE_MS = Date.UTC(2026, 10, 10);

/** A stored time in any of the shapes a pool document carries it. `NaN` when unreadable. */
export function storedTimeMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') return Date.parse(v);
  if (v && typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown };
    if (typeof o.toMillis === 'function') return o.toMillis();
    const secs = typeof o.seconds === 'number' ? o.seconds : typeof o._seconds === 'number' ? o._seconds : NaN;
    return secs * 1000;
  }
  return NaN;
}

/**
 * Does this pool's record-keeping follow the current rules?
 *
 * A pool with no readable creation time is treated as OLD: leaving a record
 * alone is recoverable, rewriting one is not. `createPool` is the only way a
 * pool comes into being (firestore.rules: `allow create: if false`) and it
 * always stamps `createdAt`, so a new pool cannot land on the wrong side.
 */
export function usesCurrentWinnerRules(pool: { createdAt?: unknown } | null | undefined): boolean {
  const ms = storedTimeMs(pool?.createdAt);
  return Number.isFinite(ms) && ms >= SQUARES_RULES_SINCE_MS;
}

/** Dollars, to the cent. Every amount this module returns goes through it. */
export function toCents(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const lastDigit = (n: number) => Math.abs(Math.trunc(num(n))) % 10;

/**
 * The pot: squares sold × price, charity off the top, the rest for prizes.
 *
 * Charity is floored to a whole dollar, as `statsTrigger.ts` and the pool page
 * always have — the three must report the same donation.
 *
 * THE PRIZE POT IS NOT FLOORED (qodo, PR #761, asked for `floor(gross -
 * charity)`). A fee may carry cents — the create contract allows it — and the
 * prizes are paid to the cent, so a floored pot would strand up to 99 cents
 * that players paid in and nobody is paid out. `statsTrigger.ts` does floor
 * its own figure: that is a site-wide display total, not what winners are
 * paid. What the finding did turn up: `gross` and `net` were the only amounts
 * in this module that skipped `toCents`, so 100 squares at $1.10 read
 * 110.00000000000001. They go through it now, and `gross = charity + net`
 * holds exactly.
 */
export function squaresPot(pool: PayoutPool): { sold: number; gross: number; charity: number; net: number } {
  const sold = (pool.squares ?? []).filter((s) => !!s && !!s.owner).length;
  const gross = toCents(sold * num(pool.costPerSquare));
  const pct = pool.charity?.enabled ? Math.min(100, Math.max(0, num(pool.charity.percentage))) : 0;
  const charity = Math.floor(gross * (pct / 100));
  return { sold, gross, charity, net: toCents(gross - charity) };
}

/** `equal_split`, or `hybrid` — which is also what an unset strategy has always been played as. */
export function scoreEventStrategy(pool: PayoutPool): 'equal_split' | 'hybrid' | null {
  if (!pool.ruleVariations?.scoreChangePayout) return null;
  return pool.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? 'equal_split' : 'hybrid';
}

/** Hybrid weights with the defaults every reader applies: final 40, halftime 20. */
export function hybridWeights(pool: PayoutPool): { final: number; halftime: number; events: number } {
  const w = pool.ruleVariations?.scoreChangeHybridWeights;
  const final = Math.min(100, num(w?.final) > 0 ? num(w?.final) : 40);
  // Clamped so the three can never add up to more than the pot.
  const halftime = Math.min(100 - final, num(w?.halftime) > 0 ? num(w?.halftime) : 20);
  return { final, halftime, events: Math.max(0, 100 - final - halftime) };
}

/**
 * The percentage of the prize pot a period pays.
 *
 * Every-Score-Pays changes it: `equal_split` pays periods nothing (it all goes
 * to scoring events); `hybrid` pays only halftime and final, by the weights.
 */
export function periodPercent(pool: PayoutPool, period: Period): number {
  const strategy = scoreEventStrategy(pool);
  if (strategy === 'equal_split') return 0;
  if (strategy === 'hybrid') {
    const w = hybridWeights(pool);
    return period === 'final' ? w.final : period === 'half' ? w.halftime : 0;
  }
  return Math.max(0, num(pool.payouts?.[period]));
}

/**
 * The numbers a period is judged against.
 *
 * One set: the grid's numbers. Four sets: q1 → first quarter, q2 → halftime,
 * q3 → third quarter, q4 → final. A missing quarter set falls back to the
 * grid's current numbers rather than paying nobody.
 */
export function axisForPeriod(pool: PayoutPool, period: Period): AxisNumbers | null {
  const usable = (a: AxisNumbers | null | undefined): a is AxisNumbers =>
    !!a && Array.isArray(a.home) && Array.isArray(a.away) && a.home.length === 10 && a.away.length === 10;
  if (pool.numberSets === 4) {
    const key = ({ q1: 'q1', half: 'q2', q3: 'q3', final: 'q4' } as const)[period];
    const set = pool.quarterlyNumbers?.[key];
    if (usable(set)) return set;
  }
  return usable(pool.axisNumbers) ? pool.axisNumbers : null;
}

/**
 * The winning square for a score: the AWAY score's last digit picks the row,
 * the HOME score's the column. `squareId = row * 10 + col`.
 */
export function winningSquare(
  axis: AxisNumbers,
  score: PeriodScore,
): { squareId: number; homeDigit: number; awayDigit: number } | null {
  const homeDigit = lastDigit(score.home);
  const awayDigit = lastDigit(score.away);
  const row = axis.away.indexOf(awayDigit);
  const col = axis.home.indexOf(homeDigit);
  if (row === -1 || col === -1) return null;
  return { squareId: row * 10 + col, homeDigit, awayDigit };
}

/** The digit-swapped square, or `null` when it is the winning square itself. */
export function reverseSquare(axis: AxisNumbers, score: PeriodScore): number | null {
  const regular = winningSquare(axis, score);
  const row = axis.away.indexOf(lastDigit(score.home));
  const col = axis.home.indexOf(lastDigit(score.away));
  if (row === -1 || col === -1) return null;
  const squareId = row * 10 + col;
  return regular && regular.squareId === squareId ? null : squareId;
}

/** One claim on a period's prize — one winner document. */
export interface PeriodClaim {
  /** The winner document id: `q1`, `q1_reverse`, `final_rollover`. */
  docId: string;
  period: Period;
  isReverse: boolean;
  squareId: number;
  /** A player's name, `Unsold`, or `Rollover`. */
  owner: string;
  /** Does this claim pay a player? */
  sold: boolean;
  amount: number;
  homeDigit: number;
  awayDigit: number;
  /** The prize moved on (to a later period, a previous winner, or a draw). */
  isRollover: boolean;
  description: string;
}

export interface PeriodResult {
  period: Period;
  percent: number;
  /** This period's own share of the prize pot. */
  base: number;
  /** Unclaimed money carried in from earlier periods. */
  rolloverIn: number;
  /** `base + rolloverIn` — what is on the table this period. */
  prize: number;
  claims: PeriodClaim[];
  /** Unclaimed money carried out to the next period. */
  rolloverOut: number;
}

const ownerAt = (pool: PayoutPool, squareId: number): string | null => {
  const s = pool.squares?.[squareId];
  return s && s.owner ? s.owner : null;
};

/** Is this recorded owner a player (rather than `Unsold` / `Rollover` / empty)? */
export function isPlayerOwner(owner: string | null | undefined): owner is string {
  return !!owner && owner !== UNSOLD && owner !== ROLLOVER;
}

/**
 * A winner that has already been recorded, keyed by winner document id.
 *
 * WHY. Once a period's winner is on record, putting a name on that square
 * afterwards must not hand them the prize, and releasing the square must not
 * take it away. So while the winning SQUARE for a claim is unchanged, the owner
 * on record decides who holds it — not whoever holds the square today. If the
 * score is corrected and a different square wins, the record no longer applies.
 */
export type RecordedWinners = Readonly<Record<string, {
  squareId: number;
  owner: string | null | undefined;
  /** Set on `final_rollover` once the organizer's random draw has been made. */
  drawn?: boolean;
} | undefined>>;

/** The money to divide into `n` shares, to the cent, with nothing left over. */
export function splitCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(toCents(total) * 100);
  const each = Math.floor(cents / n);
  const extra = cents - each * n;
  // The odd cents go to the earliest shares.
  return Array.from({ length: n }, (_, i) => (each + (i < extra ? 1 : 0)) / 100);
}

/** A period's own share of the prize pot, before any rollover. */
export function periodBase(pool: PayoutPool, period: Period): number {
  return toCents((squaresPot(pool).net * periodPercent(pool, period)) / 100);
}

/**
 * Who wins each finalized period, and for how much.
 *
 * `scores` holds only the periods that are FINAL. Periods are worked in order,
 * so unclaimed money carries forward; a period with no score yet is skipped and
 * the carry waits for the next one that has.
 *
 * REVERSE WINNERS. Two squares each claim half: the winning square and the one
 * with the digits swapped. When those are the SAME square (14–24 → 4 and 4) it
 * holds both claims and takes the whole prize — the old server code paid it
 * half and nobody the rest.
 *
 * AN UNSOLD CLAIM. With "roll over winnings" on, its money moves to the next
 * period. With it off, the claim is recorded as `Unsold` with its amount and
 * the organizer keeps it — which is what has always been recorded.
 *
 * `recorded` holds the winners already on record — see `RecordedWinners`.
 *
 * THE FINAL PERIOD has nowhere to roll to. `last_winner` (the default) gives
 * the unclaimed money to the most recent claim a player actually won;
 * `random` records it as awaiting the organizer's draw.
 */
export function computePeriodPayouts(
  pool: PayoutPool,
  scores: Partial<Record<Period, PeriodScore | null | undefined>>,
  recorded: RecordedWinners = {},
): PeriodResult[] {
  const { net } = squaresPot(pool);
  const rules = pool.ruleVariations ?? {};
  const rollover = rules.quarterlyRollover === true;
  const strategy = scoreEventStrategy(pool);
  const results: PeriodResult[] = [];
  let carry = 0;

  for (const period of PERIODS) {
    // Every-Score-Pays: equal split pays no period; hybrid pays half and final.
    if (strategy === 'equal_split') continue;
    if (strategy === 'hybrid' && (period === 'q1' || period === 'q3')) continue;

    const score = scores[period];
    if (!score) continue;
    const axis = axisForPeriod(pool, period);
    if (!axis) continue;
    const regular = winningSquare(axis, score);
    if (!regular) continue;

    const label = PERIOD_SHORT_LABEL[period];
    const percent = periodPercent(pool, period);
    const base = toCents((net * percent) / 100);
    const rolloverIn = carry;
    const prize = toCents(base + rolloverIn);

    const reverseId = rules.reverseWinners ? reverseSquare(axis, score) : null;
    const share = reverseId === null ? prize : toCents(prize / 2);
    // The second half takes whatever the first left, so two halves always sum
    // to the prize exactly — never a cent created or lost to rounding.
    const reverseShare = reverseId === null ? 0 : toCents(prize - share);

    const claims: PeriodClaim[] = [];
    let unclaimed = 0;

    const add = (docId: string, squareId: number, isReverse: boolean, amount: number, homeDigit: number, awayDigit: number) => {
      const onRecord = recorded[docId];
      const owner = onRecord && onRecord.squareId === squareId
        ? (isPlayerOwner(onRecord.owner) ? onRecord.owner : null)
        : ownerAt(pool, squareId);
      const what = isReverse ? `${label} Reverse Winner` : `${label} Winner`;
      if (owner) {
        claims.push({ docId, period, isReverse, squareId, owner, sold: true, amount, homeDigit, awayDigit, isRollover: false, description: what });
      } else if (rollover) {
        unclaimed = toCents(unclaimed + amount);
        claims.push({ docId, period, isReverse, squareId, owner: ROLLOVER, sold: false, amount: 0, homeDigit, awayDigit, isRollover: true, description: `${what} — square unsold, prize rolls over` });
      } else {
        claims.push({ docId, period, isReverse, squareId, owner: UNSOLD, sold: false, amount, homeDigit, awayDigit, isRollover: false, description: `${what} — square unsold` });
      }
    };

    add(period, regular.squareId, false, share, regular.homeDigit, regular.awayDigit);
    if (reverseId !== null) {
      // The reverse claim's digits are the swapped pair, as the docs have always stored them.
      add(`${period}_reverse`, reverseId, true, reverseShare, regular.awayDigit, regular.homeDigit);
    }

    let rolloverOut = unclaimed;

    if (period === 'final' && unclaimed > 0) {
      rolloverOut = 0;
      const base0 = { period, isReverse: false, homeDigit: regular.homeDigit, awayDigit: regular.awayDigit } as const;
      const draw = recorded.final_rollover;
      if (draw?.drawn && isPlayerOwner(draw.owner)) {
        // The draw has been made. It is not made twice — AND IT STANDS, whatever
        // the rule is set to afterwards. This branch used to apply only while
        // the rule still said "random", so switching the rule to "last winner"
        // moved the prize to somebody else (clearing "paid", since that was a
        // statement about the drawn winner), and switching it back returned the
        // prize to the drawn winner as UNPAID — a prize that had already been
        // handed over, on the books to be handed over again (qodo, PR #759).
        // The rule decides who gets a prize that has not been awarded. Once a
        // draw has awarded it, there is nothing left for the rule to decide.
        claims.push({ ...base0, docId: 'final_rollover', squareId: draw.squareId, owner: draw.owner, sold: true, isRollover: false, amount: unclaimed, description: 'Unclaimed final prize — awarded by random draw' });
      } else if (rules.unclaimedFinalPrizeStrategy === 'random') {
        claims.push({ ...base0, docId: 'final_rollover', squareId: regular.squareId, owner: ROLLOVER, sold: false, isRollover: true, amount: unclaimed, description: 'Unclaimed final prize — awaiting the random draw' });
      } else {
        // The most recent claim a player won: this period's own first, then back.
        const earlier = results.flatMap((r) => r.claims);
        const lastWinner = [...earlier, ...claims].reverse().find((c) => c.sold);
        if (lastWinner) {
          claims.push({ ...base0, docId: 'final_rollover', squareId: lastWinner.squareId, owner: lastWinner.owner, sold: true, isRollover: false, amount: unclaimed, description: `Unclaimed final prize — awarded to the ${PERIOD_SHORT_LABEL[lastWinner.period]} winner` });
        } else {
          claims.push({ ...base0, docId: 'final_rollover', squareId: regular.squareId, owner: UNSOLD, sold: false, isRollover: false, amount: unclaimed, description: 'Unclaimed final prize — no winning square was sold' });
        }
      }
    }

    carry = rolloverOut;
    results.push({ period, percent, base, rolloverIn, prize, claims, rolloverOut });
  }

  return results;
}

/** One scoring-event winner document, as the event math needs it. */
export interface EventClaimInput {
  docId: string;
  owner: string;
  /** The score the event produced; orders events when no sequence is stored. */
  home: number;
  away: number;
  isReverse?: boolean;
}

/**
 * Every-Score-Pays: what each scoring event's winner is paid, once the game is
 * final and the number of events is known.
 *
 * The event pot is the whole prize pot (`equal_split`) or what the hybrid
 * weights leave after halftime and final. It is divided equally between the
 * event claims. An event whose square is UNSOLD is handled as the commissioner
 * chose:
 *
 *   - `rollover_next` (default) — its share goes to the next event a player
 *     won; anything left after the last such event goes to that last winner.
 *   - `split_winners` — the pot is divided between the SOLD events only.
 *   - `house` — it keeps its share, recorded against `Unsold`.
 *
 * If no event was won by a player, every share stays unsold whatever the rule.
 */
export function computeEventPayouts(
  pool: PayoutPool,
  events: ReadonlyArray<EventClaimInput>,
): { pot: number; amounts: Record<string, number>; unclaimed: number } {
  const strategy = scoreEventStrategy(pool);
  const amounts: Record<string, number> = {};
  if (strategy === null || events.length === 0) return { pot: 0, amounts, unclaimed: 0 };

  const { net } = squaresPot(pool);
  const pot = toCents(strategy === 'equal_split' ? net : (net * hybridWeights(pool).events) / 100);

  // Game order: total points, then the regular claim before its reverse.
  const ordered = [...events].sort((a, b) =>
    (a.home + a.away) - (b.home + b.away)
    || Number(!!a.isReverse) - Number(!!b.isReverse)
    || a.docId.localeCompare(b.docId));
  const isSold = (e: EventClaimInput) => isPlayerOwner(e.owner);
  const soldCount = ordered.filter(isSold).length;
  const handling = pool.ruleVariations?.scoreChangeHandleUnsold ?? 'rollover_next';

  if (soldCount > 0 && handling === 'split_winners') {
    const shares = splitCents(pot, soldCount);
    let i = 0;
    for (const e of ordered) amounts[e.docId] = isSold(e) ? shares[i++] : 0;
    return { pot, amounts, unclaimed: 0 };
  }

  const shares = splitCents(pot, ordered.length);

  if (soldCount === 0 || handling === 'house') {
    let unclaimed = 0;
    ordered.forEach((e, i) => {
      amounts[e.docId] = shares[i];
      if (!isSold(e)) unclaimed = toCents(unclaimed + shares[i]);
    });
    return { pot, amounts, unclaimed };
  }

  // rollover_next
  let carry = 0;
  let lastSold: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (isSold(e)) {
      amounts[e.docId] = toCents(shares[i] + carry);
      carry = 0;
      lastSold = e.docId;
    } else {
      amounts[e.docId] = 0;
      carry = toCents(carry + shares[i]);
    }
  }
  if (carry > 0 && lastSold) amounts[lastSold] = toCents(amounts[lastSold] + carry);
  return { pot, amounts, unclaimed: 0 };
}
