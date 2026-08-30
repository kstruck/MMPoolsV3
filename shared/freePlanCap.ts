// The free plan's PARTICIPANT CAP — the number that decides who may join.
//
// ⚠️ THIS IS NOT `billing_config.freePlayerThreshold`, AND CONFLATING THEM
// SHIPS A FALSE PROMISE (codex r1 on the wizard-copy PR, 2026-08-30).
//
// There are two numbers, and today they are both 10:
//
//   • `freePlayerThreshold` (Firestore `settings/billing_config`) is a PRICING
//     input. It decides, once, at creation, whether a pool launches `free` or
//     `trial` — `computeLaunchMode` / `computeQuote`. An admin can change it.
//
//   • `FREE_PLAN_PARTICIPANT_CAP` (here) is an ENFORCEMENT limit. It decides,
//     on every join, whether the next person gets in. It was hardcoded at four
//     call sites and read no config at all.
//
// The first version of the wizard notice served `freePlayerThreshold` and told
// the commissioner that player N+1 would be refused. That is true only while
// the two agree: raise the config to 25 and the wizard would have promised a
// 25-player pool while `nflPools.ts` still turned away the 11th. A promise made
// on a screen where somebody plans their invite list has to be the number that
// is actually enforced, so the wizard reads THIS constant, and so does every
// site that enforces it.
//
// Making the cap configurable is a separate, deliberate change: it is an
// authorization limit on a money surface, it would need every one of those call
// sites to read config inside their existing transactions, and it is not
// something to do on an evening when invites are going out. Until then, one
// constant, honestly named.
//
// The platform moves no money. This is a seat limit, not a price.

/** How many participants a pool on the FREE plan may hold. */
export const FREE_PLAN_PARTICIPANT_CAP = 10;

/**
 * When the commissioner gets the "approaching the limit" email. The second
 * notice is the cap itself (`onPoolParticipantChange`, functions/src/billing.ts).
 * Derived so the wizard cannot promise a nudge that never arrives.
 */
export const FREE_PLAN_WARNING_AT = 8;
