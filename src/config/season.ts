// 2026 NFL pool creation is OPEN. Flipped for the Monday 2026-08-25 invites
// (PLAN-WIZARD-BUYFLOW-FIXES G1 / D6). This is a BUILD-TIME constant: changing
// it needs a Coolify `www` rebuild to take effect, and rolling back is another
// commit plus another rebuild. Prerequisite, already merged: T6a's G2 fix, or a
// logged-out visitor clicking the now-enabled create CTA hits a silent bounce.
export const POOLS_OPEN = true;

/**
 * 🛑 THE SEASON'S MILESTONE DATES — ONE SOURCE, BECAUSE FIVE COPIES DISAGREED.
 *
 * Kevin, 2026-08-26, on the pool-home footer: *"The dates are incorrect.
 * Kickoff is Sept 9. Superbowl is Feb 14, 2027."*
 *
 * What the audit found was not one wrong string but **five hardcoded copies of
 * the season start, in three different formats, that did not agree with each
 * other**:
 *
 * | Where | Was | What it drove |
 * |---|---|---|
 * | `Countdown.tsx:6` | `2026-09-09T18:20:00-06:00` | the landing countdown — **the only one that was right** |
 * | `LandingPage.tsx:156` | the literal `Sep 10` | the hero milestone strip |
 * | `NFLUserBentoDashboard.tsx:1292` | the literal `Sep 10` | the pool-home footer strip |
 * | `NFLPoolDashboard.tsx:167` | `2026-09-10T00:00:00` | the fallback week estimator |
 * | `NFLManagerView.tsx:298` | `2026-09-10T00:00:00-06:00` | whether a manager may still edit settings |
 *
 * So the site told a visitor "Sep 10" in two places while its own countdown
 * ticked down to Sep 9. Fixing the two strings Kevin saw would have left three
 * more copies to drift again next season, which is why this constant exists
 * instead.
 *
 * ⚠️ **`Super Bowl LX` was wrong in a way the date alone does not explain.**
 * Super Bowl **LX** really was Feb 8 2026 — the 2025 season. The numeral and
 * the date were a matched pair carried over from last year, so changing only
 * the date would have produced "Super Bowl LX — Feb 14", a NEW false statement.
 * The 2026 season ends at Super Bowl **LXI**.
 */

/**
 * The timezone every milestone label is formatted in.
 *
 * 🛑 NOT THE VIEWER'S. Kickoff is 18:20 MDT, which is 00:20 UTC on the TENTH —
 * so formatting the instant in the viewer's own zone would print "Sep 10" for
 * everyone in the UK and eastward, which is the exact wrong string this change
 * exists to remove. Pinning the zone makes the label the same for every viewer.
 */
export const SEASON_TIMEZONE = 'America/Denver';

/** NFL Kickoff Game — Wed 2026-09-09, 6:20pm MDT. The instant, not a label. */
export const NFL_KICKOFF_MS = new Date('2026-09-09T18:20:00-06:00').getTime();

/**
 * Super Bowl LXI — Sun 2027-02-14.
 *
 * ⚠️ **THE DATE IS KEVIN'S; THE TIME OF DAY IS A PLACEHOLDER.** He gave
 * "Feb 14, 2027" and nothing more, and 16:30 MST (6:30pm ET) is merely the
 * usual kickoff hour. Nothing reads the time — the only consumer is
 * `milestoneLabel`, which formats the DATE — so the placeholder is inert. If a
 * countdown is ever pointed at this constant, confirm the real kickoff time
 * first rather than inheriting this guess as though it were sourced.
 */
export const SUPER_BOWL_MS = new Date('2027-02-14T16:30:00-07:00').getTime();

/** The Super Bowl's roman numeral, for the milestone strips. */
export const SUPER_BOWL_NUMERAL = 'LXI';

/** `"Super Bowl LXI"` — one string, so the two strips cannot disagree. */
export const SUPER_BOWL_TITLE = `Super Bowl ${SUPER_BOWL_NUMERAL}`;

/**
 * A milestone's short display label (`"Sep 9"`), derived from the INSTANT
 * rather than stored beside it.
 *
 * That derivation is the whole point: a literal label sitting next to a
 * timestamp is free to drift from it, and that is precisely how the site came
 * to show `Sep 10` while its countdown ran to Sep 9. There is now nothing to
 * drift — change the instant and every surface follows.
 */
export function milestoneLabel(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: SEASON_TIMEZONE,
  }).format(new Date(ms));
}
