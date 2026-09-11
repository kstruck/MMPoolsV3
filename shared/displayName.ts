/**
 * Display-name placeholders — the ONE list both sides consult when deciding
 * whether a stored name is a real one or a fallback somebody wrote.
 *
 * `users/{uid}.name` is the source of truth for a person's display name
 * (functions/src/lib/displayName.ts carries the server rules; the client's
 * `syncUserToFirestore` the login-time rule). Every placeholder below is a
 * value some code path writes when it has nothing better:
 *
 *   New User      — the old `createParticipantProfile` Auth trigger (race, fixed 2026-09-10)
 *   Unknown       — client `syncUserToFirestore` existing-user branch
 *   Unknown User  — client `mapUser`, server `userSync` when even the email is missing
 *   Member        — `joinNFLPoolInternal`
 *   Participant   — pick / entry writes
 *   Host          — seeded pool owner (poolCreation)
 *   Player        — userProfile
 *   Anonymous     — NFL dashboard leaders strip
 */
export const PLACEHOLDER_DISPLAY_NAMES: ReadonlySet<string> = new Set([
  'new user',
  'unknown',
  'unknown user',
  'member',
  'participant',
  'host',
  'player',
  'anonymous',
]);

/** True for a non-string, empty, whitespace-only, or known-placeholder name. */
export function isPlaceholderName(name: unknown): boolean {
  if (typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_DISPLAY_NAMES.has(trimmed.toLowerCase());
}

/**
 * Choose between two candidate names, preferring `primary`.
 *
 *   real primary                 -> primary
 *   placeholder primary, real secondary -> secondary
 *   both placeholders            -> whichever is non-empty, primary first
 *   nothing                      -> undefined
 *
 * Trimmed on the way out. Callers decide what `primary` means: the server
 * passes the profile as primary and the login token as secondary; the client's
 * login sync passes the STORED profile name as primary and the Auth
 * `displayName` as secondary, so a sign-in can no longer overwrite a name the
 * person or an admin set on the profile.
 */
export function pickPreferredName(primary: unknown, secondary: unknown): string | undefined {
  const a = typeof primary === 'string' ? primary.trim() : '';
  const b = typeof secondary === 'string' ? secondary.trim() : '';
  if (a && !isPlaceholderName(a)) return a;
  if (b && !isPlaceholderName(b)) return b;
  return a || b || undefined;
}
