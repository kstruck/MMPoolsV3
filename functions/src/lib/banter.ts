// The pure halves of AI banter generation (PLAN-WIZARD-BUYFLOW-FIXES T9).
//
// Kept free of firebase imports so they are unit-testable: `aiCommissioner.ts`
// calls `admin.firestore()` at module load, so importing it from a test needs a
// live app. These two functions decide what actually reaches a feed every
// member of the pool reads, which is exactly the part worth testing directly.

/** The moods the commissioner's card offers. */
export const BANTER_MOODS = ['savage', 'professional', 'analyst'] as const;
export type BanterMood = (typeof BANTER_MOODS)[number];

/**
 * Normalizes the mood off a client-written `ai_requests` document.
 *
 * Falls back to 'professional', deliberately NOT 'savage': this is the tone an
 * unrecognised value gets posted as, under the commissioner's name, to the
 * whole pool. 'professional' is the one tone that is safe unreviewed.
 */
export function normalizeBanterMood(raw: unknown): BanterMood {
    return (BANTER_MOODS as readonly string[]).includes(String(raw))
        ? (raw as BanterMood)
        : 'professional';
}

/**
 * Flattens the model's structured response into one feed post.
 *
 * The output schema is shared with dispute resolution, which wants headline +
 * bullets + step-by-step reasoning. A feed post wants prose, and
 * `explanationSteps` on a piece of trash talk reads like a court filing — so
 * the steps are dropped and only the headline and bullets survive.
 *
 * Returns '' when there is nothing usable. The caller treats that as a FAILURE
 * and marks the request ERROR rather than posting a blank message.
 */
export function banterTextFromAI(ai: unknown): string {
    const a = (ai ?? {}) as { headline?: unknown; summaryBullets?: unknown };
    const headline = typeof a.headline === 'string' ? a.headline.trim() : '';
    const bullets = Array.isArray(a.summaryBullets)
        ? a.summaryBullets
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .map((b) => b.trim())
        : [];
    return [headline, ...bullets].filter(Boolean).join(' ').trim();
}

/**
 * Is this uid a commissioner of the pool? Mirrors the `messages` delete rule
 * in firestore.rules: owner, legacy managerUid, a named NFL co-commissioner,
 * and nobody else. `coManagers` grants nothing on a non-NFL pool, exactly as
 * the rules helper and `isPoolCommissioner` enforce.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPoolCommissionerUid(pool: any, uid: string | undefined, callerRole?: unknown): boolean {
    if (!uid) return false;
    // Super admins, matching the feed's DELETE rule, which admits them
    // explicitly (codex r2 [P2]). Without this a super admin's request was
    // accepted by the rules, shown the commissioner dashboard, and then marked
    // BANTER_NOT_COMMISSIONER with no post — three layers disagreeing.
    if (String(callerRole) === 'SUPER_ADMIN') return true;
    // ⚠️ `ownerId` ONLY — no `createdByUid` fallback (codex r3 [P2]). The feed's
    // DELETE rule and the client's commissioner gate both recognise
    // ownerId / managerUid / NFL co-manager / super admin and nothing else, so
    // admitting a legacy creator here would let them PUBLISH an AI post to the
    // whole pool that they can neither see the moderation UI for nor delete.
    // Three layers, one set.
    if (uid === pool?.ownerId) return true;
    if (uid === pool?.managerUid) return true;
    const NFL = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
    if (NFL.includes(String(pool?.type)) && Array.isArray(pool?.coManagers)) {
        return pool.coManagers.includes(uid);
    }
    return false;
}

/**
 * One standings row, flattened for the model (T9, codex r3 [P1]).
 *
 * ⚠️ The projection's field names are TYPE-SPECIFIC and none of them is the
 * obvious one: it is `userName` (not name/displayName), and the season total is
 * `totalScore` on Pick'em, `seasonTotal` on Margin, with Survivor carrying no
 * points column at all — it carries alive/eliminated and strikes. The first
 * version of this mapped invented keys, so every value reached Gemini as null
 * and the "no hallucinations" rule left it with nothing to say.
 *
 * Survivor's status is included precisely BECAUSE it has no score: without it
 * the model would receive a list of names and nothing to talk about.
 */
export interface BanterStandingsRow {
    rank: number | null;
    name: string | null;
    seasonPoints: number | null;
    /** Survivor only. */
    status?: string;
    strikesUsed?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function banterStandingsRow(row: any, poolType: string): BanterStandingsRow {
    const seasonPoints =
        typeof row?.totalScore === 'number' ? row.totalScore
        : typeof row?.seasonTotal === 'number' ? row.seasonTotal
        : null;

    const out: BanterStandingsRow = {
        rank: typeof row?.rank === 'number' ? row.rank : null,
        name: typeof row?.userName === 'string' && row.userName.trim() ? row.userName : null,
        seasonPoints,
    };

    if (poolType === 'NFL_SURVIVOR') {
        if (typeof row?.status === 'string') out.status = row.status;
        if (typeof row?.strikesUsed === 'number') out.strikesUsed = row.strikesUsed;
    }
    return out;
}
