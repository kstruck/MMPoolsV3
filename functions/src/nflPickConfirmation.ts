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

/**
 * Full team names by ESPN abbreviation. The feed's `team.name` is the nickname
 * alone ("Bills", measured on prod nfl_games 2026-09-16), and Kevin asked for
 * full names in this email. Unknown abbreviations fall back to the feed name,
 * then the abbreviation — a new or renamed team degrades, it never breaks.
 */
export const NFL_TEAM_NAMES: Record<string, string> = {
    ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
    CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
    DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
    HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
    LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
    MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
    NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers',
    SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WSH: 'Washington Commanders',
};

type Team = { abbreviation?: string; name?: string } | undefined;
const teamName = (abbr: string, team?: Team): string =>
    NFL_TEAM_NAMES[abbr] || team?.name || abbr;

/** "Sun, Sep 20 · 1:00 PM ET". Eastern, like every other kickoff time we email. */
export function kickoffLabel(startTime: number | undefined): string {
    if (!startTime || !Number.isFinite(startTime)) return '';
    const d = new Date(startTime);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);
    return `${day} · ${time} ET`;
}

export interface PickConfirmationRow {
    /** The team picked, full name. */
    pick: string;
    /** Full names; empty when the pick's game is not in this week's slate. */
    away: string;
    home: string;
    /** Which side of the game is the pick — drives the highlight. */
    pickedSide?: 'away' | 'home';
    kickoff: string;
    points?: number;
}

/** Pick rows as plain data, in kickoff order. Pure — unit tested. */
export function pickConfirmationRows(input: PickConfirmationInput): PickConfirmationRow[] {
    const games = [...input.games].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const rowFor = (team: string, g: PickConfirmationInput['games'][number] | undefined, points?: number): PickConfirmationRow => {
        const awayAbbr = g?.awayTeam?.abbreviation ?? '';
        const homeAbbr = g?.homeTeam?.abbreviation ?? '';
        const pickedSide = !g ? undefined : team === awayAbbr ? 'away' : team === homeAbbr ? 'home' : undefined;
        const pickedTeam = pickedSide === 'away' ? g?.awayTeam : pickedSide === 'home' ? g?.homeTeam : undefined;
        return {
            pick: teamName(team, pickedTeam),
            away: g ? teamName(awayAbbr, g.awayTeam) : '',
            home: g ? teamName(homeAbbr, g.homeTeam) : '',
            ...(pickedSide ? { pickedSide } : {}),
            kickoff: kickoffLabel(g?.startTime),
            ...(typeof points === 'number' ? { points } : {}),
        };
    };

    if (input.poolType === 'NFL_SURVIVOR' || input.poolType === 'NFL_MARGIN') {
        // One team for the week, keyed by week number.
        const team = input.picks?.[String(input.week)];
        if (!team) return [];
        const g = games.find(x => x.homeTeam?.abbreviation === team || x.awayTeam?.abbreviation === team);
        return [rowFor(team, g)];
    }

    // Pick'em: keyed by game id. Only this week's games are listed.
    const rows: PickConfirmationRow[] = [];
    for (const g of games) {
        const team = input.picks?.[g.id];
        if (!team) continue;
        rows.push(rowFor(team, g, input.confidence?.[g.id]));
    }
    return rows;
}

/**
 * Subject + HTML. Pure — unit tested. Every user-supplied string is escaped.
 *
 * Picks come FIRST and are a plain stack of blocks, not a table (Kevin,
 * 2026-09-16): some mail apps render tables badly, and the picks are the point
 * of the email. Each block: the team picked, the game with the pick bolded, the
 * kickoff time, and confidence points when the pool uses them.
 */
export function buildPickConfirmationEmail(input: PickConfirmationInput): { subject: string; html: string } {
    const weekLabel = nflWeekLabel(Number(input.seasonType) || 2, input.week);
    const rows = pickConfirmationRows(input);
    const poolName = escapeHtml(input.poolName || 'your pool');
    const name = escapeHtml(input.recipientName || 'there');

    const side = (team: string, picked: boolean) => picked
        ? `<strong style="color: #4f46e5;">${escapeHtml(team)}</strong>`
        : escapeHtml(team);

    const pickBlocks = rows.map(r => {
        const game = r.away && r.home
            ? `<div style="font-size: 14px; color: #475569; margin-top: 2px;">${side(r.away, r.pickedSide === 'away')} at ${side(r.home, r.pickedSide === 'home')}</div>`
            : '';
        const kickoff = r.kickoff
            ? `<div style="font-size: 13px; color: #64748b; margin-top: 2px;">${escapeHtml(r.kickoff)}</div>`
            : '';
        const points = r.points !== undefined
            ? ` <span style="font-weight: normal; color: #4f46e5;">· ${r.points} ${r.points === 1 ? 'point' : 'points'}</span>`
            : '';
        return `
        <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 10px 14px; margin: 0 0 10px 0;">
            <div style="font-size: 16px; font-weight: bold; color: #0f172a;">${escapeHtml(r.pick)}${points}</div>
            ${game}
            ${kickoff}
        </div>`;
    }).join('');

    const picksBlock = rows.length > 0
        ? pickBlocks
        : '<p>No picks were recorded for this week in this save.</p>';

    const tiebreaker = typeof input.tiebreakerPrediction === 'number'
        ? `<p style="margin: 5px 0 0 0;">Tiebreaker: <strong>${input.tiebreakerPrediction}</strong></p>`
        : '';

    const body = `
        <p>Hi ${name},</p>
        <p>Your ${escapeHtml(weekLabel)} picks for <strong>${poolName}</strong> are saved. Here ${rows.length === 1 ? 'is your pick' : 'are your picks'}:</p>
        <h3 style="color: #0f172a; font-size: 18px; margin: 20px 0 10px 0;">Your ${escapeHtml(weekLabel)} ${rows.length === 1 ? 'pick' : 'picks'}</h3>
        ${picksBlock}
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; color: #1f2937;">
            <p style="margin: 0;">${escapeHtml(typeLabel(input.poolType))} · ${escapeHtml(weekLabel)}</p>
            ${input.entryName ? `<p style="margin: 5px 0 0 0;">Entry: <strong>${escapeHtml(input.entryName)}</strong></p>` : ''}
            ${tiebreaker}
        </div>
        <p style="font-size: 14px; color: #64748b; margin-top: 20px;">You can change your picks until they lock. Each save sends a new confirmation.</p>
    `;

    return {
        // Subject stays plain text — mail clients do not decode entities there.
        subject: `Picks saved: ${input.poolName || 'your pool'} — ${weekLabel}`,
        html: renderEmailHtml('Picks Confirmed ✅', body, `${BASE_URL}/pool/${encodeURIComponent(input.poolId)}`, 'View Your Picks'),
    };
}

/**
 * What submitNFLPicksInternal's committing transaction wrote to the entry —
 * filled through its optional out-param, left empty on a requestId replay.
 *
 * The email is built from this, never from the request: the server merges a
 * save over earlier picks (a game that locked before this save keeps its stored
 * pick) and can drop a submitted tiebreaker once its target game locks, so
 * echoing the input could confirm data that was not saved (codex r1). And it is
 * captured INSIDE the transaction rather than re-read after commit, because a
 * re-read can already see a concurrent later save (codex r2).
 */
export interface CommittedPickSave {
    entryId?: string;
    entryName?: string;
    picks?: Record<string, string>;
    confidence?: Record<string, number> | null;
    tiebreaker?: number | null;
}

/**
 * Reads the recipient, pool, profile and week's games, then queues the email.
 * Never throws.
 *
 * The recipient is the CURRENT Auth record's email, never the caller's ID-token
 * claim: a token minted before an email change still carries the old address
 * for up to an hour, and this email lists the member's picks (qodo #3 on #697).
 */
export async function sendNFLPickConfirmation(
    db: admin.firestore.Firestore,
    args: {
        uid: string;
        poolId: string;
        week: number;
        saved: CommittedPickSave;
    },
): Promise<void> {
    try {
        const rec = await admin.auth().getUser(args.uid);
        const email = rec.email;
        const displayName = rec.displayName;
        if (!email) return;

        const pool = (await db.collection('pools').doc(args.poolId).get()).data() as
            { type?: unknown; name?: unknown; season?: unknown; seasonType?: unknown } | undefined;
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
            entryName: args.saved.entryName || undefined,
            picks: args.saved.picks ?? {},
            confidence: args.saved.confidence ?? null,
            tiebreakerPrediction: typeof args.saved.tiebreaker === 'number' ? args.saved.tiebreaker : null,
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
