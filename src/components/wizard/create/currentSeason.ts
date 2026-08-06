/**
 * The NFL season every pool the wizard creates belongs to.
 *
 * This used to be a free-typed `<TextField name="season">` on four wizards,
 * defaulting to **'2025'** — a season that is over. Nothing validated it beyond
 * "non-empty", so a commissioner could launch a pool stamped 2025, 202, or
 * "next year", and `nfl_games` documents are keyed on `season` as a STRING
 * (`shared/schemas/nfl.ts` accepts `string | number`; `buildNFLPayload` coerces
 * with `String(v.season)`). A pool whose season does not match the imported
 * schedule renders no games at all — the same blast radius as the `seasonType`
 * NaN bug in #319, reachable by typing.
 *
 * It is a constant rather than `new Date().getFullYear()` on purpose. The NFL
 * season year is NOT the calendar year for half its length: the 2026 season's
 * postseason is played in January 2027, so a clock-derived value would silently
 * start stamping brand-new playoff pools '2027' at midnight on New Year's Eve
 * and point them at a schedule that does not exist. Rolling this by hand once a
 * year is the cheap, visible option.
 *
 * ⚠️ Keep it a STRING. `season` is stored and queried as a string.
 */
export const CURRENT_SEASON = '2026';
