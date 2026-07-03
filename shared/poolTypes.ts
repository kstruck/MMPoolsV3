// Canonical Pool-type contract, shared by src/ (wizard client) and functions/
// (createPool callable). This is the SINGLE source of truth for the pool-type
// enum — it must match the values the live code already persists and routes on.
//
// Confidence is NOT a pool type: it is `settings.confidenceMode` on NFL_PICKEM
// (verified against createNFLPool + nflPoolTypes). Do not add CONFIDENCE here.

export const POOL_TYPES = [
  'SQUARES',
  'BRACKET',
  'NFL_PLAYOFFS',
  'PROPS',
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
] as const;

export type PoolType = (typeof POOL_TYPES)[number];

// Types created through the NFL callable path (createNFLPool today).
export const NFL_SEASON_TYPES: readonly PoolType[] = [
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
];

export function isPoolType(v: unknown): v is PoolType {
  return typeof v === 'string' && (POOL_TYPES as readonly string[]).includes(v);
}

export function isNflSeasonType(t: PoolType): boolean {
  return NFL_SEASON_TYPES.includes(t);
}
