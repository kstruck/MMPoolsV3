import * as admin from 'firebase-admin';
import { sendEmail } from './reminders';
import { renderEmailHtml, escapeHtml, BASE_URL } from './emailStyles';
import { nflWeekLabel } from './shared/nflWeekLabel';
import type { NFLGame } from './nflPoolTypes';

/**
 * Pick confirmation email for NFL pools (Pick'em / Confidence / Survivor / Margin).
 *
 * Bracket and playoff entries have always emailed a confirmation on submit; NFL
 * pick submission never did, and members reported it missing (2026-09-16). The
 * mail pipeline itself was healthy — 300/300 recent `mail` docs SUCCESS — the
 * NFL path simply had no sender.
 *
 * Sent from the `submitNFLPicks` callable wrapper only — i.e. a member saving
 * their OWN picks. Proxy picks and the sim harness call
 * `submitNFLPicksInternal` directly and never email.
 *
 * Best-effort: every failure is logged and swallowed. A confirmation email must
 * never turn an accepted pick into an error response.
 */

export interface PickConfirmationInput {
    poolType: string;
    poolName: string;
    poolId: string;
    seasonType?: unknown;
    week: number;
    recipientName?: string;
    entryName?: string;
    picks: Record<string, string>;
    confidence?: Record<string, number> | null;
    tiebreakerPrediction?: number | null;
    games: Pick<NFLGame, 'id' | 'homeTeam' | 'awayTeam' | 'startTime'>[];
}

const typeLabel = (t: string): string =>
    t === 'NFL_SURVIVOR' ? 'Survivor' : t === 'NFL_MARGIN' ? 'Margin' : "Pick'em";

/** Pick rows as plain data, in kickoff order. Pure — unit tested. */
export function pickConfirmationRows(input: PickConfirmationInput): { pick: string; matchup: string; points?: number }[] {
    const games = [...input.games].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const matchupOf = (g: PickConfirmationInput['games'][number]) =>
        `${g.awayTeam?.abbreviation ?? '?'} @ ${g.homeTeam?.abbreviation ?? '?'}`;

    if (input.poolType === 'NFL_SURVIVOR' || input.poolType === 'NFL_MARGIN') {
        // One team for the week, keyed by week number.
        const team = input.picks?.[String(input.week)];
        if (!team) return [];
        const g = games.find(x => x.homeTeam?.abbreviation === team || x.awayTeam?.abbreviation === team);
        return [{ pick: team, matchup: g ? matchupOf(g) : '' }];
    }

    // Pick'em: keyed by game id. Only this week's games are listed.
    const rows: { pick: string; matchup: string; points?: number }[] = [];
    for (const g of games) {
        const team = input.picks?.[g.id];
        if (!team) continue;
        const pts = input.confidence?.[g.id];
        rows.push({ pick: team, matchup: matchupOf(g), ...(typeof pts === 'number' ? { points: pts } : {}) });
    }
    return rows;
}

/** Subject + HTML. Pure — unit tested. Every user-supplied string is escaped. */
export function buildPickConfirmationEmail(input: PickConfirmationInput): { subject: string; html: string } {
    const weekLabel = nflWeekLabel(Number(input.seasonType) || 2, input.week);
    const rows = pickConfirmationRows(input);
    const poolName = escapeHtml(input.poolName || 'your pool');
    const name = escapeHtml(input.recipientName || 'there');
    const hasPoints = rows.some(r => r.points !== undefined);

    const rowHtml = rows.map(r => `
        <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #0f172a;">${escapeHtml(r.pick)}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${escapeHtml(r.matchup)}</td>
            ${hasPoints ? `<td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${r.points ?? ''}</td>` : ''}
        </tr>`).join('');

    const picksBlock = rows.length > 0
        ? `<table style="width: 100%; border-collapse: collapse; font-size: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
            <tr style="text-align: left; color: #334155;">
                <th style="padding: 8px;">Your pick</th><th style="padding: 8px;">Game</th>${hasPoints ? '<th style="padding: 8px; text-align: right;">Points</th>' : ''}
            </tr>${rowHtml}
        </table>`
        : '<p>No picks were recorded for this week in this save.</p>';

    const tiebreaker = typeof input.tiebreakerPrediction === 'number'
        ? `<p style="margin: 5px 0 0 0;">Tiebreaker: <strong>${input.tiebreakerPrediction}</strong></p>`
        : '';

    const body = `
        <p>Hi ${name},</p>
        <p>Your ${escapeHtml(weekLabel)} picks for <strong>${poolName}</strong> are saved.</p>
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; color: #1f2937;">
            <p style="margin: 0;">${escapeHtml(typeLabel(input.poolType))} · ${escapeHtml(weekLabel)}</p>
            ${input.entryName ? `<p style="margin: 5px 0 0 0;">Entry: <strong>${escapeHtml(input.entryName)}</strong></p>` : ''}
            ${tiebreaker}
        </div>
        ${picksBlock}
        <p style="font-size: 14px; color: #64748b; margin-top: 20px;">You can change your picks until they lock. Each save sends a new confirmation.</p>
    `;

    return {
        // Subject stays plain text — mail clients do not decode entities there.
        subject: `Picks saved: ${input.poolName || 'your pool'} — ${weekLabel}`,
        html: renderEmailHtml('Picks Confirmed ✅', body, `${BASE_URL}/pool/${encodeURIComponent(input.poolId)}`, 'View Your Picks'),
    };
}

/**
 * Reads what the email needs and queues it. Never throws.
 */
export async function sendNFLPickConfirmation(
    db: admin.firestore.Firestore,
    args: {
        uid: string;
        email?: string;
        poolId: string;
        week: number;
        picks: Record<string, string>;
        confidence?: Record<string, number> | null;
        tiebreakerPrediction?: number | null;
        entryName?: string | null;
    },
): Promise<void> {
    try {
        let email = args.email;
        let displayName: string | undefined;
        if (!email) {
            const rec = await admin.auth().getUser(args.uid);
            email = rec.email;
            displayName = rec.displayName;
        }
        if (!email) return;

        const poolSnap = await db.collection('pools').doc(args.poolId).get();
        const pool = poolSnap.data() as Record<string, any> | undefined;
        if (!pool) return;

        const profile = (await db.collection('users').doc(args.uid).get()).data();
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', pool.season)
            .where('seasonType', '==', Number(pool.seasonType || 2))
            .where('week', '==', args.week)
            .get();

        const { subject, html } = buildPickConfirmationEmail({
            poolType: String(pool.type || ''),
            poolName: String(pool.name || ''),
            poolId: args.poolId,
            seasonType: pool.seasonType,
            week: args.week,
            recipientName: (typeof profile?.name === 'string' && profile.name) || displayName,
            entryName: args.entryName || undefined,
            picks: args.picks || {},
            confidence: args.confidence,
            tiebreakerPrediction: args.tiebreakerPrediction,
            games: gamesSnap.docs.map(d => d.data() as NFLGame),
        });

        await sendEmail(db, email, subject, html, {
            type: 'nfl_picks_submitted',
            poolId: args.poolId,
            uid: args.uid,
            week: args.week,
        });
    } catch (e) {
        console.error('[submitNFLPicks] pick confirmation email failed:', e);
    }
}
