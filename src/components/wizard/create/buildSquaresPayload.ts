import { writePaymentHandles, CLEAR } from '@shared/paymentHandles';
import { readLaunchFields } from './launchFields';
import { isFeedLogoUrl } from '@shared/squaresDefaults';

// Maps validated wizard values to the SQUARES pool payload for
// dbService.createPool. Fee is costPerSquare (top-level, not settings.entryFee).
// The callable seeds squares[]/scores and stamps server-only fields.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const n = (x: unknown): number => {
  const v = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
};

/**
 * The game the pool is linked to — ALL of it or none of it. A `gameId` without
 * a kickoff time would link the scores but leave the grid to be locked by
 * hand, and nothing on the pool would say so.
 */
function linkedGame(v: Record<string, unknown>): Record<string, unknown> {
  const gameId = typeof v.gameId === 'string' ? v.gameId.trim() : '';
  const gameTime = typeof v.gameTime === 'number' && Number.isFinite(v.gameTime) && v.gameTime > 0 ? v.gameTime : null;
  if (!gameId || gameTime === null) return {};
  return {
    gameId,
    gameTime,
    league: v.league === 'college' ? 'college' : 'nfl',
    // A badge that is not the feed's own is dropped, not sent: the create
    // contract refuses it, and a missing badge falls back to the team name.
    homeTeamLogo: isFeedLogoUrl(v.homeTeamLogo) ? v.homeTeamLogo : undefined,
    awayTeamLogo: isFeedLogoUrl(v.awayTeamLogo) ? v.awayTeamLogo : undefined,
    seasonType: v.seasonType === '1' || v.seasonType === '2' || v.seasonType === '3' ? v.seasonType : undefined,
    week: typeof v.week === 'number' && Number.isInteger(v.week) ? v.week : undefined,
  };
}

function payoutSplit(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return { q1: n(r.q1), half: n(r.half), q3: n(r.q3), final: n(r.final) };
}

function charity(raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Off means off: a percentage left in the box from before does not ride along.
  return r.enabled === true
    ? { enabled: true, percentage: n(r.percentage), name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : undefined }
    : { enabled: false, percentage: 0 };
}

export function buildSquaresPayload(values: Record<string, unknown>): Record<string, unknown> {
  const v = values as Record<string, any>;

  const hp = writePaymentHandles(v.paymentHandles);
  const legacyHandles: Record<string, string> = {};
  (['venmo', 'zelle', 'cashapp', 'paypal'] as const).forEach((k) => {
    const val = hp[k];
    if (val && val !== CLEAR) legacyHandles[k] = val as string;
  });

  return dropUndefined({
    ...readLaunchFields(values),
    type: 'SQUARES',
    name: v.name,
    costPerSquare: Number(v.costPerSquare ?? 0),
    maxSquaresPerPlayer: Number(v.maxSquaresPerPlayer ?? 0),
    homeTeam: v.homeTeam || undefined,
    awayTeam: v.awayTeam || undefined,
    ...linkedGame(v),
    numberSets: Number(v.numberSets ?? 1),
    theme: v.theme || 'default',
    // `payouts` is server-owned and stripped from every create payload, so the
    // split travels as `squaresPayouts`; `createPool` copies it in once the
    // create schema has accepted it.
    squaresPayouts: payoutSplit(v.squaresPayouts),
    charity: charity(v.charity),
    ruleVariations: {
      reverseWinners: v.ruleVariations?.reverseWinners === true,
      quarterlyRollover: v.ruleVariations?.quarterlyRollover === true,
      unclaimedFinalPrizeStrategy: v.ruleVariations?.unclaimedFinalPrizeStrategy === 'random' ? 'random' : 'last_winner',
    },
    managerName: v.managerName || undefined,
    contactEmail: v.contactEmail || undefined,
    ...legacyHandles,
    paymentHandles: hp.paymentHandles,
    paymentInstructions: v.paymentInstructions || undefined,
    branding: v.branding,
    isPublic: v.isPublic ?? true,
  });
}
