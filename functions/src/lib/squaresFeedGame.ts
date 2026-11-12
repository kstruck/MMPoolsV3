/**
 * Look a squares pool's game up in the score feed — ON THE SERVER — so a game
 * link stores what the feed says, not what the commissioner's browser says
 * (PLAN-SQUARES-SERVER-FIELDS §2b/§2c; plan K11 of PLAN-SQUARES-REOPEN).
 *
 * Before this, `createPool` stored the game id, kickoff, league and team names
 * the wizard sent, and the manage page wrote them straight onto the pool. A
 * crafted request could pair one game's scores with another game's teams and
 * kickoff, or link a game already under way — and a grid linked to a game
 * under way locks at once on whatever numbers it has.
 *
 * The endpoint and the fields read are the ones the squares score sync already
 * reads in production (`fetchESPNScores`, `scoreUpdates.ts`): the summary's
 * `header.competitions[0]` — its competitors, its date — and its status. Logos,
 * season type and week are OPTIONAL in the shared `squaresGameLink`, so they
 * are read defensively here and simply left out if the feed's shape differs;
 * a link never fails on them.
 */
import * as admin from 'firebase-admin';
import { ESPN_SITE_API } from './espnHost';
import type { LinkableGame } from '../shared/squaresDefaults';

export type SquaresLeague = 'nfl' | 'college';

export interface SquaresFeedGame extends LinkableGame {
    /** The feed's own state: 'pre' before kickoff, 'in' during, 'post' after. */
    state: string;
}

const obj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function teamLogo(team: Record<string, unknown>): string | undefined {
    const direct = str(team.logo);
    if (direct) return direct;
    const logos = Array.isArray(team.logos) ? team.logos : [];
    const first = str(obj(logos[0]).href);
    return first || undefined;
}

/**
 * The feed's summary JSON → the game, or null when it is not a game this
 * code can link to (no competition, a missing side, no parsable kickoff, or an
 * id that is not the one asked for). Pure, so it is tested without a network.
 *
 * Team names are `displayName`, falling back to `name` — the same choice the
 * schedule picker makes (`src/services/espnSchedule.ts`), so a pool linked on
 * the server is named exactly as one linked from the picker always was.
 */
export function parseSquaresFeedGame(json: unknown, gameId: string): SquaresFeedGame | null {
    const header = obj(obj(json).header);
    const competitions = Array.isArray(header.competitions) ? header.competitions : [];
    const competition = obj(competitions[0]);
    const competitors = Array.isArray(competition.competitors) ? competition.competitors.map(obj) : [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) return null;

    const homeTeam = str(obj(home.team).displayName) || str(obj(home.team).name);
    const awayTeam = str(obj(away.team).displayName) || str(obj(away.team).name);
    const kickoff = Date.parse(str(competition.date));
    if (!homeTeam || !awayTeam || !Number.isFinite(kickoff) || kickoff <= 0) return null;
    // `header.id` is the event id the summary was asked for. If it is there it
    // must match; if the feed leaves it out, the URL already named the event.
    const headerId = str(header.id);
    if (headerId && headerId !== gameId) return null;

    const status = obj(Object.keys(obj(header.status)).length ? header.status : competition.status);
    const state = str(obj(status.type).state) || 'pre';

    const game: SquaresFeedGame = { id: gameId, kickoff, homeTeam, awayTeam, state };
    const homeLogo = teamLogo(obj(home.team));
    const awayLogo = teamLogo(obj(away.team));
    if (homeLogo) game.homeLogo = homeLogo;
    if (awayLogo) game.awayLogo = awayLogo;
    const seasonType = String(obj(header.season).type ?? '');
    if (seasonType === '1' || seasonType === '2' || seasonType === '3') game.seasonType = seasonType;
    const week = Number(obj(header.week).number ?? header.week);
    if (Number.isInteger(week) && week > 0) game.week = week;
    return game;
}

/**
 * Has the game started? By the FEED's state, or by the SERVER's clock against
 * the feed's kickoff — whichever says so first. The same two tests the picker
 * applies in the browser (`hasStarted`), made where they cannot be skipped.
 */
export function squaresFeedGameHasStarted(game: Pick<SquaresFeedGame, 'state' | 'kickoff'>, nowMs: number): boolean {
    return game.state !== 'pre' || game.kickoff <= nowMs;
}

export type FeedFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Fetch one game from the feed. Resolves:
 *   - the game, when the feed answered with a linkable one;
 *   - `'not-found'`, when the feed answered but not with that game (4xx, or a
 *     body this code cannot link);
 *   - `'unreachable'`, when the feed could not be asked (timeout, network, 5xx).
 * Never throws. Same bounds as the score sync: 8 s per attempt, one retry on
 * a 5xx or a network failure.
 */
export async function fetchSquaresFeedGame(
    gameId: string,
    league: SquaresLeague,
    fetchImpl: FeedFetch = fetch as unknown as FeedFetch,
): Promise<SquaresFeedGame | 'not-found' | 'unreachable'> {
    if (!/^\d{1,15}$/.test(gameId)) return 'not-found';
    const leaguePath = league === 'college' ? 'college-football' : 'nfl';
    const url = `${ESPN_SITE_API}/football/${leaguePath}/summary?event=${gameId}`;
    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const resp = await fetchImpl(url, { signal: controller.signal });
            if (resp.ok) {
                const game = parseSquaresFeedGame(await resp.json(), gameId);
                return game ?? 'not-found';
            }
            if (resp.status < 500) return 'not-found';
        } catch {
            // network failure or timeout — retry once, then give up as unreachable
        } finally {
            clearTimeout(timer);
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
    return 'unreachable';
}

/**
 * True only inside the local Firebase emulator suite — the same test
 * `isEmulatedEnvironment` in `stripe.ts` makes, and for the same reason: both
 * variables are set by the emulators and by nothing in a deployed function.
 * Repeated rather than imported so this module does not load Stripe.
 */
export function feedFixturesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.FUNCTIONS_EMULATOR === 'true' || !!env.FIRESTORE_EMULATOR_HOST;
}

/** Where an EMULATOR run reads a game in place of the feed: `emulatorFixtures/squaresFeed_<id>`. */
export const FEED_FIXTURE_COLLECTION = 'emulatorFixtures';
export const feedFixtureDocId = (gameId: string) => `squaresFeed_${gameId}`;

export type FixtureReader = (gameId: string) => Promise<Record<string, unknown> | null>;

/** A fixture document → the game, with the same checks the feed's answer gets. */
export function gameFromFixture(gameId: string, d: Record<string, unknown>): SquaresFeedGame | null {
    const kickoff = Number(d.kickoff);
    const homeTeam = str(d.homeTeam);
    const awayTeam = str(d.awayTeam);
    if (!Number.isFinite(kickoff) || kickoff <= 0 || !homeTeam || !awayTeam) return null;
    const game: SquaresFeedGame = { id: gameId, kickoff, homeTeam, awayTeam, state: str(d.state) || 'pre' };
    if (str(d.homeLogo)) game.homeLogo = str(d.homeLogo);
    if (str(d.awayLogo)) game.awayLogo = str(d.awayLogo);
    const seasonType = String(d.seasonType ?? '');
    if (seasonType === '1' || seasonType === '2' || seasonType === '3') game.seasonType = seasonType;
    if (Number.isInteger(d.week) && (d.week as number) > 0) game.week = d.week as number;
    return game;
}

/**
 * The lookup both the create path and `linkSquaresPoolGame` use.
 *
 * ⚠️ EMULATOR ONLY: a test cannot depend on what the real feed has on the day
 * it runs, and the end-to-end walk-through drives `createPool` through the
 * functions emulator, which would otherwise ask the real feed about a made-up
 * game. So when — and only when — `feedFixturesAllowed()` is true, a fixture
 * document for the id is used if one exists. In a deployed function the reader
 * is never called and the feed is always asked.
 */
export async function lookupSquaresGame(
    gameId: string,
    league: SquaresLeague,
    deps: { env?: NodeJS.ProcessEnv; readFixture?: FixtureReader; fetchImpl?: FeedFetch } = {},
): Promise<SquaresFeedGame | 'not-found' | 'unreachable'> {
    if (feedFixturesAllowed(deps.env ?? process.env) && deps.readFixture) {
        const fixture = await deps.readFixture(gameId);
        if (fixture) return gameFromFixture(gameId, fixture) ?? 'not-found';
    }
    return fetchSquaresFeedGame(gameId, league, deps.fetchImpl);
}

/** The fixture reader for the real (emulated) database. Only ever called when `feedFixturesAllowed()`. */
export const firestoreFixtureReader: FixtureReader = async (gameId) => {
    const snap = await admin.firestore().collection(FEED_FIXTURE_COLLECTION).doc(feedFixtureDocId(gameId)).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
};
