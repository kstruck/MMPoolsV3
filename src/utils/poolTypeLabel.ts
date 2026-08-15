/**
 * Human labels for a pool's TYPE and its rule OPTIONS, read from the pool doc
 * (`pool.type` + `pool.settings`) and nothing else — the My Entries cards
 * already hold the whole doc, so this costs no read.
 *
 * Item 14 (Kevin, 2026-08-14): testers could not tell a Pick'em pool from a
 * Survivor pool from a Margin pool on the My Entries page — the card showed a
 * name, a status pill and a host, and every NFL card looked identical.
 *
 * ponytail: labels only. No icons, no colours per type — the Commissioner Hub
 * chips already spell these words, and matching them is the point.
 */
export type PoolLike = { type?: string; settings?: Record<string, any> } | null | undefined;

const TYPE_LABEL: Record<string, string> = {
    NFL_PICKEM: "Pick'em",
    NFL_SURVIVOR: 'Survivor',
    NFL_MARGIN: 'Margin',
    SQUARES: 'Squares',
    BRACKET: 'Bracket',
    NFL_PLAYOFFS: 'Playoff',
    PROPS: 'Props',
};

// An unknown or missing type is SAID to be unknown — never a plausible-looking
// substitute (qodo on #437; the repo's data-integrity rule). A new pool type
// gets its label added to TYPE_LABEL, not a silent generic.
export function poolTypeLabel(pool: PoolLike): string {
    return (pool?.type && TYPE_LABEL[pool.type]) || 'Unknown type';
}

const PAYOUT_LABEL: Record<string, string> = {
    SEASON: 'Season-long',
    WEEKLY: 'Weekly prizes',
    HYBRID: 'Hybrid (weekly + season)',
};

/**
 * The options a passive participant would want to know before opening the
 * pool. Order is fixed so two pools with the same rules read the same. Empty
 * for types whose options are not settings-driven (Squares, Bracket, Props).
 */
export function poolOptionLabels(pool: PoolLike): string[] {
    const s = pool?.settings ?? {};
    const out: string[] = [];
    switch (pool?.type) {
        case 'NFL_PICKEM':
            out.push(s.pickMode === 'ATS' ? 'Against the spread' : 'Straight-up');
            if (s.confidenceMode) out.push('Confidence');
            if (PAYOUT_LABEL[s.payoutMode]) out.push(PAYOUT_LABEL[s.payoutMode]);
            break;
        case 'NFL_MARGIN':
            if (PAYOUT_LABEL[s.payoutMode]) out.push(PAYOUT_LABEL[s.payoutMode]);
            break;
        case 'NFL_SURVIVOR': {
            const strikes = Number(s.maxStrikes ?? 0);
            out.push(strikes > 0 ? `${strikes} strike${strikes === 1 ? '' : 's'}` : 'Sudden death');
            if (Number(s.maxRebuys ?? 0) > 0) out.push('Rebuys');
            break;
        }
        default:
            break;
    }
    return out;
}
