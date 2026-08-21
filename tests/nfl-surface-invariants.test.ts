import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * NFL surface invariants — the season-type rule has ONE definition.
 *
 * `src/utils/nflPending.test.ts` proves `gamesForPoolWeek` and `poolSeasonType`
 * are correct; it cannot prove the surfaces USE them. Both defects this file
 * guards were re-derivations, not wrong logic:
 *
 *  - Manager surfaces filtered `g.week === week` alone while member surfaces
 *    also required the pool's season type, so on a pool holding a week-1 game of
 *    the other season type the manager's `isWeekFullyFinal` gate for Score &
 *    Recap counted games the member checklist did not.
 *  - Every member-side copy read `Number(pool.seasonType)` with no default.
 *    `seasonType` is OPTIONAL and omitting it means REGULAR season
 *    (`shared/schemas/nfl.ts`), so an unset pool coerced to `NaN`, which matches
 *    no game — that pool rendered with no schedule at all.
 *
 * Deliberately coarse source greps, same as `admin-surface-invariants`: they
 * assert the wiring, not the behavior.
 */

const root = resolve(__dirname, '..');

const SURFACES = [
  'src/components/NFLPoolDashboard/NFLManagerView.tsx',
  'src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx',
  'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx',
  'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx',
  'src/components/NFLPoolDashboard/WeekChecklist.tsx',
  'src/components/NFLPoolDashboard/PickemPickEntry.tsx',
  'src/services/nflStatusService.ts',
];

describe('one definition — no NFL surface re-derives the season-type rule', () => {
  it.each(SURFACES)('%s reads the pool season type only through poolSeasonType()', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // A game's seasonType is a required field, so `Number(g.seasonType)` is fine.
    // Coercing a POOL's is the NaN bug.
    const poolSideCoercions = src.match(/Number\(\s*\w*[Pp]ool\??\.seasonType/g) ?? [];
    expect(poolSideCoercions).toEqual([]);
  });

  it.each(SURFACES)('%s filters games by week only through gamesForPoolWeek()', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // `.filter(g => g.week === ...)` in a surface is the manager-side defect.
    const inlineWeekFilters = src.match(/\.filter\([^;]{0,120}?\.week\s*===/g) ?? [];
    expect(inlineWeekFilters).toEqual([]);
  });

  it('the greps above actually match the code they are meant to catch', () => {
    // A guard that matches nothing looks identical to a guard that passes. These
    // are the two exact shapes that were removed; if either regex stops matching
    // them, the guard has silently stopped guarding.
    const oldPoolCoercion = 'const seasonType = Number(castPool.seasonType);';
    const oldWeekFilter = 'const weeklyGames = useMemo(() => games.filter(g => g.week === week), [games, week]);';
    expect(oldPoolCoercion.match(/Number\(\s*\w*[Pp]ool\??\.seasonType/g)).toHaveLength(1);
    expect(oldWeekFilter.match(/\.filter\([^;]{0,120}?\.week\s*===/g)).toHaveLength(1);
  });

  it('every surface imports the shared helpers it needs', () => {
    for (const file of SURFACES) {
      const src = readFileSync(resolve(root, file), 'utf8');
      const usesHelper = /\b(gamesForPoolWeek|poolSeasonType)\s*\(/.test(src);
      expect(usesHelper, `${file} should read season type via the shared helpers`).toBe(true);
      expect(src, `${file} should import from utils/nflPending`).toMatch(/utils\/nflPending/);
    }
  });
});

/**
 * Saved-pick visibility — the three member pick sheets say the same things.
 *
 * `src/utils/pickHighlight.test.ts` proves the helper returns distinguishable
 * classes; it cannot prove the sheets USE it. Every defect in this area has
 * been a re-derivation or an omission on one sheet out of three:
 *
 *  - Survivor and Margin gained a saved-pick button state in #378 and Pick'em
 *    did not, so a fully-saved Pick'em sheet still read "Submit Weekly Picks".
 *  - Survivor and Margin gained a saved BANNER in #378 and Pick'em only got one
 *    in #379, for the same reason.
 *  - All three inlined one navy/gold class string for "selected" with no saved
 *    state at all, copied between three separate files.
 *
 * Coarse source greps, same convention as the season-type block above: they
 * assert the wiring, not the rendering.
 */
describe('saved-pick visibility — all three member sheets, one definition', () => {
  const SHEETS = [
    'src/components/NFLPoolDashboard/PickemPickEntry.tsx',
    'src/components/NFLPoolDashboard/SurvivorPickEntry.tsx',
    'src/components/NFLPoolDashboard/MarginPickEntry.tsx',
  ];

  /**
   * ⚠️ THE INVARIANT MOVED, IT DID NOT WEAKEN (2026-08-12, pick-sheet overhaul).
   *
   * This used to assert that each sheet calls `pickHighlightClass` directly.
   * Survivor and Margin now render their team buttons through the shared
   * `TeamPickButton`, which owns the selected/saved styling — a STRONGER form of
   * "one definition", not an escape from it. Keeping the old assertion would
   * force the styling back into the three files it was just extracted from.
   *
   * So: each sheet must route through ONE of the two shared definitions, and the
   * shared component must itself distinguish saved from unsaved (the next test).
   * A sheet that hand-rolls its own selected state satisfies neither.
   */
  it.each(SHEETS)('%s highlights team buttons through a SHARED definition', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    const viaHelper = /\bpickHighlightClass\s*\(/.test(src);
    const viaComponent = /\bTeamPickButton\b/.test(src);
    expect(
      viaHelper || viaComponent,
      `${file} must style selected teams via pickHighlightClass() or TeamPickButton, never its own copy`,
    ).toBe(true);
  });

  it('TeamPickButton distinguishes a SAVED pick from an unsaved change', () => {
    // What the old per-sheet assertion actually protected: colour alone cannot
    // say "this is in". Two sheets now depend on this one component getting it
    // right, so it is asserted once here rather than three times over.
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/pickSheet/TeamPickButton.tsx'),
      'utf8',
    );
    expect(src).toMatch(/\bsaved\b/);
    expect(src).toContain('Not saved yet');
  });

  it.each(SHEETS)('%s inlines no copy of the old selected-team class string', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // The exact string that was duplicated six times. A re-inlined copy would
    // render gold for a saved pick again and no test would otherwise notice.
    expect(src).not.toContain('ring-2 ring-navy-600 dark:border-gold-500');
  });

  it('that grep matches the string it was written to catch', () => {
    // A guard that matches nothing is indistinguishable from a guard that
    // passes — this is the literal pre-change source, and it must still trip.
    const removed = "'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500'";
    expect(removed).toContain('ring-2 ring-navy-600 dark:border-gold-500');
  });

  it.each(SHEETS)('%s tells the member their pick is saved without relying on colour', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    expect(/\bpickHighlightLabel\s*\(/.test(src), `${file} should render the text state`).toBe(true);
  });

  it("Pick'em's submit button is state-aware, like Survivor's and Margin's", () => {
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
      'utf8',
    );
    // All three labels must exist, or the button is stuck on one of them again.
    expect(src).toContain('Picks Saved (');
    expect(src).toContain('Save Edited Picks');
    expect(src).toContain('Submit Weekly Picks');
    // "Edited" must be derived from the entry, not from the dirty flag, which
    // latches on the first tap and never clears.
    expect(src).toMatch(/matchesSaved/);
    expect(src).not.toMatch(/hasUnsavedEdits\s*=\s*dirtyRef/);
  });

  it("the Pick'em receipt no longer offers a jump to an unopened week", () => {
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
      'utf8',
    );
    // It landed the member on "Spreads Not Yet Finalized" with nothing to do.
    expect(src).not.toContain('onGoToWeek');
    expect(src).not.toMatch(/week\s*\+\s*1/);
  });

  /**
   * ⚠️ RECORDS ARE "AS OF" THE SELECTED WEEK — the defect codex holed TWICE.
   *
   * Two separate ways to get this wrong, and both produce a plausible-looking
   * row rather than an obvious one:
   *
   *  - Folding `games` (already filtered to the selected week) gives every team
   *    0-0 all season long.
   *  - Folding the whole season gives a team's WEEK 10 record beside a WEEK 1
   *    matchup — the dashboard lets a member scrub back, so this is reachable.
   *
   * `src/utils/nflTeamRecords.test.ts` proves the fold and the `< week` filter
   * behave; it cannot prove the three sheets APPLY them. Pick'em joined the two
   * others on 2026-08-13 and inherited both traps with them.
   */
  it.each(SHEETS)('%s computes records as of the selected week', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    expect(src, `${file} should derive records from the season slate`).toMatch(
      /computeTeamRecords\(/,
    );
    // The season slate, not the week slate, and cut off strictly BEFORE the
    // selected week. Whitespace-tolerant, but it must be one expression — a
    // sheet that folds the wrong array cannot satisfy it.
    expect(src, `${file} must fold seasonGames filtered to weeks before the selected one`).toMatch(
      /computeTeamRecords\(\s*\(seasonGames \?\? games\)\.filter\(g => Number\(g\.week\) < week\)/,
    );
  });

  it('that grep rejects both shapes it was written to catch', () => {
    // Guard the guard. Neither defect may satisfy the assertion above.
    const wholeSeason = 'computeTeamRecords(seasonGames ?? games, seasonType)';
    const weekOnly = 'computeTeamRecords(games, seasonType)';
    const rule = /computeTeamRecords\(\s*\(seasonGames \?\? games\)\.filter\(g => Number\(g\.week\) < week\)/;
    expect(rule.test(wholeSeason)).toBe(false);
    expect(rule.test(weekOnly)).toBe(false);
    expect(rule.test('computeTeamRecords((seasonGames ?? games).filter(g => Number(g.week) < week), seasonType)')).toBe(true);
  });

  it('Quick Picks offers no "optimal" or premium strategy', () => {
    // Kevin's instruction, 2026-08-12, verbatim: no "Optimal/premium picks"
    // option. Every strategy must be a mechanical read of stored data, never a
    // recommendation — a pool product that appears to advise its members on
    // which side to take is a different product with different obligations.
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/pickSheet/quickPicks.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // Guard the guard: the comment naming the refused option must survive in
    // the file while being absent from the code the union is built from.
    expect(src).toContain('Optimal');
    expect(code).not.toContain('Optimal');
    expect(code).not.toMatch(/OPTIMAL|PREMIUM|BEST_BETS/);
    // The union is exactly these four, so a fifth cannot be added silently.
    const union = code.match(/export type QuickPickStrategy = ([^;]+);/);
    expect(union?.[1].trim()).toBe("'FAVORITES' | 'UNDERDOGS' | 'HOME' | 'AWAY'");
  });

  it('Quick Picks re-plans at the press, not at dialog render', () => {
    // codex round 1 on this PR: the dialog computes its counts once, on open.
    // A member who opens it a minute before kickoff and then chooses is
    // choosing after that game may have locked — the sheet re-evaluates lock
    // state only every 30s — and applying the cached plan would write a pick
    // the server refuses. The sheet must re-plan against its own live lock
    // predicate, exactly as tapping a team does.
    const sheet = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
      'utf8',
    );
    expect(sheet).toMatch(/const handleQuickPicks = \(strategy: QuickPickStrategy\) => \{/);
    expect(sheet).toMatch(/planQuickPicks\(games, strategy, picks, g => !isGameLocked\(g\)\)/);

    const dialog = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx'),
      'utf8',
    );
    const dialogCode = dialog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // It hands back the STRATEGY. Handing back `plan` is the regression.
    expect(dialogCode).toContain('onApply(id)');
    expect(dialogCode).not.toContain('onApply(plan)');
  });

  it('the pool-home CTAs share ONE label rule and name the action they will perform', () => {
    // Item 8 (Kevin, 2026-08-14): the two red buttons must agree. Every picks
    // CTA on the pool home derives its label from `pickCtaFor` — no button
    // carries its own hardcoded verb any more ("Submit My Picks Now" was one).
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).toContain("from '../../utils/pickCta'");
    expect(code.match(/picksCta\.label/g)?.length).toBe(2);
    expect(code).not.toContain('Submit My Picks Now');
    expect(code).not.toContain("'Make My Picks'");
    // The labels themselves live in the util (and its test) — Kevin's words.
    const util = readFileSync(resolve(root, 'src/utils/pickCta.ts'), 'utf8');
    expect(util).toContain("'Edit My Picks'");
    expect(util).toContain("'Make Picks'");
    // The banner uses the same words.
    const checklist = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/WeekChecklist.tsx'),
      'utf8',
    );
    expect(checklist).toContain('Make Picks <ArrowRight');
    // Vacuous-true guard: an empty slate makes `every()` true, which would
    // label a pool with no games as already picked.
    expect(src).toMatch(/weeklyGames\.length === 0\) return false/);
  });
});

/**
 * The commissioner surface is SPLIT INTO FOUR SECTIONS, and every one of them
 * still renders.
 *
 * `NFLManagerView` was one ~870-line scroll. That length was not a cosmetic
 * problem: it is the whole reason the same `SaveSettingsControl` was repeated
 * five times (HANDOFF item 3 — harmless and deliberate, but it reads as a bug),
 * and it is why the roster and the scoring console shared a three-column grid
 * that made both cramped.
 *
 * The split moved existing JSX blocks under `commishTab` conditionals without
 * rewriting them. That is a mechanical change, and the failure mode of a
 * mechanical change is a block ending up in NO branch — it compiles, it lints,
 * it renders nothing, and nobody notices until a commissioner goes looking for a
 * control on game night. These greps pin that each section is reachable from the
 * nav and that the controls people depend on are still inside one.
 */
describe('commissioner tabs — every section is reachable and nothing was dropped', () => {
  const view = readFileSync(
    resolve(root, 'src/components/NFLPoolDashboard/NFLManagerView.tsx'),
    'utf8',
  );

  // Guard the guard: a moved or renamed file must fail loudly rather than make
  // every assertion below vacuously true.
  it('read the manager view source', () => {
    expect(view).toContain('NFLManagerView');
    expect(view.length).toBeGreaterThan(20000);
  });

  const TABS = ['overview', 'members', 'scoring', 'settings'];

  it.each(TABS)('tab %s is declared in the nav', (id) => {
    expect(view).toContain(`id: '${id}'`);
  });

  it.each(TABS)('tab %s actually gates a render block', (id) => {
    expect(view).toContain(`commishTab === '${id}'`);
  });

  it('the nav renders every declared tab, not a hardcoded subset', () => {
    expect(view).toContain('COMMISH_TABS.map');
    const declared = [...view.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...TABS].sort());
  });

  it('each control lives inside the section that claims it', () => {
    // Offsets, not mere presence: a block that fell outside every conditional
    // still "contains" its markup. Each control must sit after its own tab gate
    // and before the next one opens.
    const at = (needle: string) => {
      const i = view.indexOf(needle);
      expect(i, `missing from the manager view: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const overview = at("commishTab === 'overview'");
    const settings = at("commishTab === 'settings'");
    const scoring = at("commishTab === 'scoring'");
    const members = at("commishTab === 'members'");

    // Overview owns the bento (the payouts card folded into the ledger — T7).
    expect(at('<NFLManagerBentoDashboard')).toBeGreaterThan(overview);
    expect(at('<NFLManagerBentoDashboard')).toBeLessThan(settings);

    // Anchored on the JSX USE SITE, not the handler name: every handler is
    // declared near the top of the component, so `handleScoreWeek` alone matches
    // its definition and would compare the wrong offset — which is exactly what
    // the first draft of this test did, and it failed for that reason rather
    // than because anything was misplaced.

    // Scoring owns Score & Recap — the control the whole season runs through.
    expect(at('onClick={handleScoreWeek}')).toBeGreaterThan(scoring);
    expect(at('onClick={handleScoreWeek}')).toBeLessThan(members);

    // Members owns the roster and its per-row reminder control.
    expect(at('handleRemindOne(row.uid')).toBeGreaterThan(members);

    // Settings owns the exceptions block, which is the second 'settings' gate.
    expect(view.lastIndexOf("commishTab === 'settings'"))
      .toBeLessThan(at('onClick={handleCancelPool}'));
  });

  it('the five duplicate save controls are down to one', () => {
    const saves = view.match(/<SaveSettingsControl\s/g) ?? [];
    expect(saves).toHaveLength(1);
    // ...and it is still wired to the one shared handler, not a new save path.
    expect(view).toContain('<SaveSettingsControl onSave={handleSaveSettings}');
  });

  it('the feedback alert sits OUTSIDE the tab groups', () => {
    // A save started on Settings must still report its result if the tab changed
    // underneath it, so the alert must precede the first tab gate.
    //
    // EXISTENCE FIRST, then position. The first draft asserted only
    // `indexOf('{feedback && (') < indexOf(gate)`, which a mutation deleting the
    // block passes trivially — indexOf returns -1 and -1 is less than anything.
    // Caught by mutation, not by reading it. Same hole as the guard in
    // admin-surface-invariants that pinned plumbing without pinning behaviour.
    const alert = view.indexOf('{feedback && (');
    expect(alert, 'the feedback alert is gone entirely').toBeGreaterThan(-1);
    expect(alert).toBeLessThan(view.indexOf("commishTab === 'overview'"));
    // ...and it must appear exactly once — the old copy sat between the payouts
    // card and the control-room header, inside what is now the Overview group.
    expect(view.match(/\{feedback && \(/g) ?? []).toHaveLength(1);
  });

  it('the three-column grid that squeezed the roster is gone', () => {
    expect(view).not.toContain('lg:col-span-2');
    expect(view).not.toContain('grid-cols-1 lg:grid-cols-3');
  });
});

/**
 * The section nav must not CLAIM the WAI-ARIA tab pattern (codex r1 on the split).
 *
 * `role="tablist"` / `role="tab"` is a promise of behaviour the browser does not
 * supply: a keyboard user is then entitled to Arrow/Home/End under a roving
 * tabindex, and each section is entitled to be an associated `role="tabpanel"`.
 * Announcing a tablist and then ignoring the arrow keys is worse for a screen
 * reader user than plain buttons, which already work with Tab and Enter.
 */
describe('commissioner nav — no half-implemented ARIA tab pattern', () => {
  const view = readFileSync(
    resolve(root, 'src/components/NFLPoolDashboard/NFLManagerView.tsx'),
    'utf8',
  );

  it('uses a nav with aria-current, not tablist/tab roles', () => {
    expect(view).toContain('aria-label="Commissioner sections"');
    expect(view).toContain("aria-current={commishTab === t.id ? 'page' : undefined}");
  });

  // Asserted against CODE, with comments stripped. The comment above the nav has
  // to name the roles it is refusing in order to explain the decision, and a
  // whole-file `not.toContain` fails on that explanation — which happened three
  // separate times tonight across two test files. A guard that forbids
  // documenting its own reason is a guard people delete.
  const code = view
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('the comment stripper actually removed the explanation', () => {
    // Guard the guard: if this stops working, the assertions below either fail
    // spuriously or (worse) pass against text nobody checked.
    expect(view).toContain('role="tablist"');   // present, in the comment
    expect(code).not.toContain('role="tablist"'); // absent from the code
    expect(code).toContain('aria-label="Commissioner sections"'); // code survived
  });

  it.each(['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected'])(
    'the markup does not claim %s',
    (attr) => {
      expect(code).not.toContain(attr);
    },
  );
});

/**
 * Confidence weights: the graying is a GUARD RAIL, the duplicate check is the
 * CHECK (LAUNCH-READINESS I1, Kevin 2026-08-13).
 *
 * `src/utils/confidenceWeights.test.ts` proves the rule — a weight another game
 * holds is taken, a game's own weight never is, and a pre-existing duplicate
 * leaves BOTH holders able to keep theirs. It cannot prove the pick sheet USES
 * it, nor that adding it did not quietly retire the backstop it sits in front
 * of. That is what this block is for, and the second half is the load-bearing
 * one: an entry saved by an older client can already carry a duplicate, so if
 * the graying is ever wrong the sheet must still refuse the submit rather than
 * silently accept it.
 */
describe('confidence weights — graying is wired, and the duplicate backstop survives it', () => {
  const sheet = readFileSync(
    resolve(root, 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
    'utf8',
  );
  // Comments stripped: the block above the `<option>` has to explain what it
  // refuses to disable, and a whole-file grep would pass on the explanation
  // rather than on the code. Same trick, and same reason, as the nav block.
  const code = sheet
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('the comment stripper actually removed the explanation', () => {
    // Guard the guard — see the nav block. Both strings live only in comments.
    expect(sheet).toContain('strand the member');
    expect(code).not.toContain('strand the member');
    expect(code).toContain('availableConfidenceValues.map'); // code survived
  });

  it('the per-game dropdown disables values from the shared rule, not a local re-derivation', () => {
    expect(code).toContain("from '../../utils/confidenceWeights'");
    expect(code).toContain('isConfidenceValueTaken(confidenceOwners, v, game.id)');
    expect(code).toContain('disabled={taken}');
  });

  it('the owners map is built from THIS week\'s games only', () => {
    // Folding the whole entry in would gray out weights spent on other weeks.
    expect(code).toContain('confidenceValueOwners(games.map(g => g.id), confidence)');
  });

  it('the duplicate detection is still present and still blocks the submit', () => {
    expect(code).toContain('duplicateConfidenceValues');
    expect(code).toContain('Duplicate value!');
    // The `canSubmit` refusal and the save bar's reason for it — the two halves
    // a member actually experiences.
    expect(code).toContain('if (duplicateConfidenceValues.size > 0) return false;');
    expect(code).toContain("'Two games share a confidence weight'");
  });
});

/**
 * The Season/Week standings toggle (Kevin, 2026-08-13: a pool paying weekly
 * needs the week's own ranking on screen).
 *
 * The invariant worth pinning is NULL-IS-NOT-ZERO. A member the scorer has not
 * reached this week has no weekly value; coalescing that to 0 would rank
 * "hasn't been scored" above a Margin player who played and lost by 3, and tie
 * them with a Pick'em player who played and got everything wrong. The view is
 * read during live Sunday scoring, which is exactly when half the pool is in
 * that state.
 */
describe('week results view — absence is not zero, and Survivor has no week to rank', () => {
  // ⚠️ RELOCATED, NOT WEAKENED. These invariants were written against
  // `NFLStandings.tsx` when #422 put a Season/Week toggle there. Kevin's
  // 2026-08-13 ruling moved the weekly view to its own Results page, so the
  // rules they guard now live in `src/utils/nflResults.ts` — and they are
  // STRONGER there, because that module is pure and `src/utils/nflResults.test.ts`
  // exercises the behavior directly instead of grepping for it.
  //
  // The greps below stay because a source grep catches a different failure than
  // a unit test does: a future edit that reintroduces `?? 0` inside the util
  // would still pass a test suite someone updated to match it.
  const src = readFileSync(resolve(root, 'src/utils/nflResults.ts'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('weekValueFor returns null for a missing week, never a coalesced 0', () => {
    expect(code).toContain("return typeof v === 'number' ? v : null;");
    // The one wrong implementation this is most likely to rot into.
    expect(code).not.toContain('weeklyPoints?.[week] ?? 0');
    expect(code).not.toContain('weeklyScores?.[week] ?? 0');
  });

  it('the week ranking drops nulls to the bottom instead of sorting them as values', () => {
    expect(code).toContain('weekValueFor(row, week, isMargin) !== null');
  });

  it('Survivor is excluded from the Results tab — N/A, not just unranked', () => {
    const dash = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx'),
      'utf8',
    );
    expect(dash).toContain("const showResultsTab = pool.type !== 'NFL_SURVIVOR';");
    // ...and a stale ?tab=results link into a Survivor pool must fall back to a
    // rendered tab, never to an empty content area.
    //
    // ⚠️ This used to grep for a `requestedTab === 'results' && !showResultsTab`
    // ternary. The Current Picks tab is the SECOND conditional tab, so the rule
    // became a per-tab availability map instead of a chain of special cases —
    // the assertion follows it rather than pinning the old shape. What it
    // guards is unchanged: an offered tab renders, an unoffered one falls back
    // to the dashboard, and `results` is entered in that map from
    // `showResultsTab`.
    expect(dash).toContain('results: showResultsTab');
    expect(dash).toContain("const activeTab: TabType = tabOffered[requestedTab] ? requestedTab : 'dashboard';");
  });

  it('a not-yet-scored week shows no place chip', () => {
    const results = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLResults.tsx'),
      'utf8',
    );
    expect(results).toContain('place === null ? dash');
  });

  it('the standings table no longer carries a week toggle of its own', () => {
    // Two implementations of "this week's ranking" is how the standings and the
    // results page start disagreeing about who won a week.
    const standings = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLStandings.tsx'),
      'utf8',
    );
    expect(standings).not.toContain('standingsView');
    expect(standings).not.toContain('weekRanked');
  });
});

/**
 * WEEK-view ties share a place (competition ranking). Positional numbering
 * would hand a tied week to the alphabet, and the tiebreak is the SCORER's
 * call — the recap's winner line applies the MNF prediction (Pick'em) or
 * declares the tie shared (Margin). A table showing a different first place
 * than the recap is the exact contradiction this view exists to remove.
 * (codex r1 on the standings-toggle PR; carried across the relocation.)
 */
describe('week results view — tied scores share a place', () => {
  const src = readFileSync(resolve(root, 'src/utils/nflResults.ts'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('a place is shared with the previous row on an equal value, never taken from the index', () => {
    // One O(n) pass over the sorted list: same-value rows reuse the previous
    // place, a new value takes index+1. Asserted in BOTH ranking functions —
    // the season grid ranks too, and only pinning the weekly one is how the two
    // drift apart.
    expect(code.match(/const place = value === prevValue \? prevPlace : i \+ 1;/g) || []).toHaveLength(2);
  });

  it('the season standings table still ranks positionally', () => {
    const standings = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLStandings.tsx'),
      'utf8',
    );
    expect(standings).toContain('rank={index + 1}');
  });
});

/**
 * CURRENT PICKS grid (Kevin's A2) — the one NFL surface that prints another
 * player's pick, so the wiring around it is what these guard.
 *
 * The unit tests in `src/utils/picksGrid.test.ts` prove the cell rule. What a
 * unit test cannot prove is that the component still USES it and that the tab
 * is still gated — the same gap `SURFACES` above exists for.
 */
describe('current picks grid — the reveal boundary stays the server\'s', () => {
  // 🛑 COMMENTS STRIPPED BEFORE MATCHING, on every source these assertions read.
  //
  // These files are heavily commented and several of the comments QUOTE the very
  // expressions asserted below — so a raw `toContain` would keep passing after
  // the code was deleted, as long as the comment explaining it survived. That is
  // a guard that looks like a guard and is not, which is this repo's own most
  // repeated defect class. The `not.toContain` direction fails the opposite way:
  // a comment merely MENTIONING `setEntries(` would fail a green build.
  //
  // Same stripper the `nflResults` block above uses. (qodo #2, re-review of #430.)
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = (p: string) => strip(readFileSync(resolve(root, p), 'utf8'));
  const grid = src('src/components/NFLPoolDashboard/NFLPicksGrid.tsx');
  const dash = src('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');

  it('the tab is offered to any signed-in viewer, on all three NFL types', () => {
    // ⚠️ DELIBERATELY REVERSED. This used to assert
    // `pool.type === 'NFL_PICKEM' && isManager`, and BOTH halves were removed on
    // purpose (PLAN-MEMBER-PICKS-VISIBILITY, Kevin 2026-08-14):
    //
    //   * `isManager` was an AUTHORIZATION fact — `getPoolPicks` refused
    //     participants — and the callable now admits a proven member, so the
    //     client gate would be the only thing still refusing them.
    //   * `NFL_PICKEM` alone left Margin and Survivor with no tab at all, which
    //     contradicted the ticket that adds their grid.
    //
    // What still holds: a NON-member is refused BY THE SERVER and sees "?", and
    // the pool type now selects the COMPONENT rather than whether the tab exists.
    expect(dash).toContain("const showPicksGridTab = !!user && ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(pool.type);");
    expect(dash).toContain('grid: showPicksGridTab');
    expect(dash).toContain("pool.type === 'NFL_PICKEM' ? (");
    expect(dash).toContain('<NFLWeeklyPicksGrid');
  });

  it('the grid derives no reveal rule of its own — it consumes revealedGameIds', () => {
    expect(grid).toContain('picksGridCell');
    // A client-side lock comparison here would be a SECOND definition of the
    // boundary, which is what PLAN-COMMISSIONER-BLIND-PICKS removed.
    const code = grid
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).not.toContain('startTime <');
    expect(code).not.toContain('lockBufferMinutes');
    expect(code).not.toContain('serverNow');
  });

  it('a stale reveal from another week is dropped, not applied to this slate', () => {
    expect(grid).toContain('reveal.week === week');
  });

  it('a reveal is scoped to the POOL that asked for it, not the week alone', () => {
    // NFL game ids are global, so two pools on the same week share a slate:
    // navigating between two pools the same commissioner runs leaves the
    // previous pool's response matching by week, and buildMemberStandings
    // grafts its picks onto any uid present in both rosters. (codex r1.)
    // Now week-KEYED as well as pool-stamped: the Survivor/Margin grid draws
    // many weeks at once, so one response per pool is no longer enough.
    expect(dash).toContain('prev.poolId === pool.id');
    expect(dash).toContain('reveal.poolId === pool.id && reveal.uid === viewerUid ? reveal.byWeek : {}');
    // The response is per-principal now, so a cache keyed only by pool would
    // survive a sign-out or a removal and keep serving the previous viewer's
    // revealed picks. A denial empties it rather than being logged. (codex P1.)
    expect(dash).toContain("err as { code?: string })?.code === 'functions/permission-denied'");
    expect(dash).toContain('setReveal({ poolId: pool.id, uid: viewerUid, byWeek: {} });');
    // ...and an in-flight success must not repopulate it AFTER that denial,
    // which ordering alone would otherwise allow. (codex P1, r5.)
    expect(dash).toContain('authGen.current += 1;');
    // A viewer change supersedes in-flight requests too, or the new user's
    // cache is overwritten with the old stamp and they see "?" for a whole
    // poll interval. (codex r6.)
    expect(dash).toContain('useEffect(() => { authGen.current += 1; }, [viewerUid, pool.id]);');
    // BOTH paths check it — a superseded failure is as stale as a superseded
    // success, and only guarding one inverts the purpose of the guard.
    expect(dash.match(/if \(authGen\.current !== gen\) return;/g) || []).toHaveLength(2);
    expect(dash).toContain('revealsForPool[selectedWeek]?.week === selectedWeek');
    // Same rule for the Majority row's aggregate, checked at RENDER time —
    // clearing it in the effect leaves one frame of the previous pool's splits,
    // because effects run after the render that changed the pool. (codex r2.)
    expect(grid).toContain('consensus?.poolId === pool.id ? consensus.byGame : undefined');
  });

  it('the rows are derived during render, so they cannot lag the reveal by a paint', () => {
    // The grid reads the allowlist and the rows TOGETHER. Setting the rows from
    // an effect made them lag `weekReveal` by one paint, so on the render where
    // a game first revealed, every player who picked it was drawn as "—" —
    // "made no pick" — and corrected a frame later. (codex r6.)
    expect(dash).toContain('const entries = useMemo(');
    expect(dash).not.toContain('setEntries(');
  });

  it('a REVEALED grid week is fetched once; an open one is re-polled', () => {
    // `members` changes on every member-record write — i.e. every pick
    // submission in the pool — and each participant call scans the pool's
    // members and entries. One shared effect turned a single submission into
    // one full-pool read per historical week PER CONNECTED VIEWER. (codex P2.)
    //
    // The selected week still reacts to `members`; the historical columns must
    // not, and must only load while their grid is on screen.
    expect(dash).toContain('[isManager, selectedWeek, commissionerRosterDep, user?.id, loadWeek, wantsReveal]');
    // The members-driven refresh is the COMMISSIONER's, and the fetch only runs
    // on a tab that renders the response.
    expect(dash).toContain('const commissionerRosterDep = isManager ? members : null;');
    // ...and dropping that dependency must not let a REMOVED member keep
    // rendering cached picks until the poll collects a denial. (codex r12.)
    // 🛑 The revoke signal is `participantIds`, NOT the members snapshot:
    // `subscribeToPoolMembers` reports a permission error as `[]`, and losing
    // that read is exactly what removal causes — so a members-derived guard
    // went quiet in the one case it existed for. (qodo re-review.)
    expect(dash).toContain('|| castPool.participantIds.includes(viewerUid);');
    expect(dash).not.toContain('members.length === 0');
    expect(dash).toContain('if (viewerStillMember) return;');
    // Item 9 (2026-08-15) added 'results' DELIBERATELY: Results opens a row's
    // picks via EntryWeekPicks, so it consumes the same reveal Standings does.
    expect(dash).toContain("const revealTabs: TabType[] = ['grid', 'standings', 'results', 'manager'];");
    expect(dash).toContain('if (!user || !wantsReveal) return;');
    expect(dash).toContain('[user?.id, activeTab, pool.type, openWeeks, loadWeek, isManager]');
    expect(dash).toContain("activeTab !== 'grid'");
    // 'Cached' must mean REVEALED. An unrevealed response is a snapshot of a
    // clock still running; caching it as final left the column at "?" forever
    // once that week locked. (codex r9.)
    // An unrevealed column is re-requested BY THE POLL, not merely left on a
    // to-fetch list — re-fetching it returns another unrevealed response, so a
    // list keyed on that predicate never changes and never fires again.
    expect(dash).toContain('const openWeeks = gridWeeks.filter(w => w !== selectedWeek && !cachedWeeks[w]?.weekRevealed)');
    // ONE owner for the historical columns — issuing them from the poll too
    // ran them on Standings/Manager and doubled them on the grid. (codex r11.)
    expect(dash.match(/for \(const w of openWeeks/g) || []).toHaveLength(1);
  });

  it('a weekly-pool column is admitted by ITS OWN weekRevealed, never a shared one', () => {
    // Survivor and Margin key a pick by the WEEK NUMBER, so `weekRevealed` — not
    // `revealedGameIds` — is what admits a cell. A multi-week grid reading one
    // selected week's flag would render week 2's pick on a week where only week
    // 1 had locked. The rule is unit-tested in `picksGrid.test.ts`; this pins
    // that the COMPONENT still routes each column to its own response.
    const weekly = src('src/components/NFLPoolDashboard/NFLWeeklyPicksGrid.tsx');
    expect(weekly).toContain('reveal: revealsByWeek[w]');
    expect(weekly).toContain('weeklyPickCell');
    const util = src('src/utils/picksGrid.ts');
    expect(util).toContain('reveal?.week === week && reveal?.weekRevealed === true');
  });

  it('the dashboard is keyed on the pool, so no subscribed state survives navigation', () => {
    // The route sets `pool` from the global cache with no loading state, so the
    // dashboard stays MOUNTED between pools and every subscribed state
    // (`entries`, `ownEntry`, `members`, `standingsRows`) held the previous
    // pool's data until its snapshot landed. The own-entry row bypasses the
    // reveal guard by design, so the grid rendered the old pool's picks as this
    // one's. (codex r4.)
    // Stripped too — the `key` is introduced by a long JSX comment that names it.
    const route = src('src/components/routes/PoolRoute.tsx');
    expect(route).toMatch(/<NFLPoolDashboard\s+key=\{pool\.id\}/);
  });

  it('an unrevealed cell reads "?" and never collapses into the no-pick dash', () => {
    expect(grid).toContain("cell.kind === 'HIDDEN' ? '?'");
    // ...and the Set column uses the SAME glyph for the same fact. Inside one
    // table "—" cannot mean both "revealed, picked nothing" and "not known".
    // (qodo #8 — its compliance framing rejected, the overloading absorbed.)
    expect(grid).toContain("{set === undefined ? '?' : `${set}/${weekGames.length}`}");
  });

  it('the own-row reveal bypass waits for the own entry to actually load', () => {
    // The bypass exists because the entry document is the source. Before it
    // lands, `buildMemberStandings` still emits a row for the viewer from their
    // Member Record with no `picks` at all — so the bypass printed "0/16" and a
    // "made no pick" dash across the commissioner's whole week. Passed as a
    // prop, never inferred from `row.picks` being absent: an entry that has no
    // picks yet is indistinguishable from one that has not loaded. (qodo #9.)
    expect(grid).toContain('const ownPicksKnown = (row: any): boolean => isMe(row) && ownEntryLoaded;');
    // ⚠️ `!!ownEntry` USED TO BE THE SOURCE HERE AND IT WAS THE WEAKER QUESTION:
    // it is false for a viewer whose entry HAS loaded and is genuinely absent, so
    // the bypass stayed off and their own row read "?" — "not revealed yet" about
    // picks the client can see are not there. `ownEntryKnown` is "a successful
    // snapshot for this pool and this uid has landed", which is what the prop's
    // own doc comment says it means. (#497.)
    expect(dash).toContain('ownEntryLoaded={ownEntryKnown}');
    expect(dash).not.toContain('ownEntryLoaded={!!ownEntry}');
    // The "Me" badge and the row highlight are the OTHER question and must not
    // disappear while the entry loads.
    expect(grid).toContain('{mine && (');
  });
});

/**
 * ROW IDENTITY IS THE ENTRY, NOT THE PLAYER (PLAN-MULTI-ENTRY §0b, ticket T0).
 *
 * Today every NFL entry id IS the owner's uid, so `reveal.counts[row.ownerUid]`
 * and `reveal.counts[row.id]` return the same thing — which is exactly why the
 * uid-keyed form kept getting written. Under multi-entry one player owns
 * several rows and a uid-keyed lookup silently merges them. This guard makes
 * the rule a test rather than prose: on the NFL row/reveal surfaces, `ownerUid`
 * may decide "is this me" and the profile link, and nothing else.
 *
 * Coarse regexes over comment-stripped source, same convention as the rest of
 * this file. It is NOT an AST rule — an alias (`const k = row.ownerUid`) can
 * slip past it; the behaviour test on `buildMemberStandings` with two rows
 * sharing an owner (PLAN-MULTI-ENTRY T4) is the compensating check.
 *
 * The allow-list below is PER SYMBOL, each with the plan ticket that deletes
 * it. Adding a line here is a plan decision, not a convenience.
 */
describe('NFL row/reveal surfaces key by ENTRY id, never by owner uid (PLAN-MULTI-ENTRY §0b)', () => {
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const FILES = [
    'src/components/NFLPoolDashboard/NFLPicksGrid.tsx',
    'src/components/NFLPoolDashboard/NFLWeeklyPicksGrid.tsx',
    'src/components/NFLPoolDashboard/NFLStandings.tsx',
    'src/components/NFLPoolDashboard/NFLResults.tsx',
    'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx',
    'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx',
    'src/components/NFLPoolDashboard/NFLManagerView.tsx',
    'src/components/PaymentsPanel.tsx',
    'src/utils/memberStandings.ts',
    'src/utils/poolRoster.ts',
  ];
  // Residue the plan's T4/T5 remove. Exact symbol per file; nothing else in
  // that file is exempt.
  const ALLOW: Record<string, RegExp[]> = {
    'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx': [/entries\.find\(e => e\.ownerUid === user\.id/],  // myEntry — T5
    'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx': [/entries\.find\(e => e\.ownerUid === user\.id/], // myEntry — T5
    'src/components/PaymentsPanel.tsx': [/entries\.find\(e => e\.ownerUid === user\.id/],                     // myEntry — T6
    'src/utils/memberStandings.ts': [/const uidOf = /, /scoredByUid/, /r\.picks\?\.\[uid\]/, /reveal\.picks\?\.\[uid\]/, /reveal\.confidence\?\.\[uid\]/, /reveal\.tiebreakers\?\.\[uid\]/], // the fold — T4
    'src/utils/poolRoster.ts': [/const uidOf = /, /entryByUid/],                                              // dues per MEMBER are correct; renamed by T6
  };
  const FORBIDDEN: Array<[string, RegExp]> = [
    ['`ownerUid ?? …` used as a key',            /ownerUid \?\? [\w.]+\]/],
    ['`ownerUid || …` used as a key',            /ownerUid \|\| [\w.]+\]/],
    ['a `uidOf` helper',                         /const uidOf = /],
    ['reveal map indexed by an owner/uid name',  /\.(picks|counts|confidence|tiebreakers)\??\.\[[^\]]*(ownerUid|uid)\b[^\]]*\]/],
    ['`pickCounts` indexed by an owner/uid name', /pickCounts\??\.\[[^\]]*(ownerUid|uid)\b[^\]]*\]/],
    ['singular `entries.find` on ownerUid',      /entries\.find\([^)]*ownerUid/],
  ];

  it.each(FILES)('%s', file => {
    // Allowed residue is REMOVED from the source before the forbidden shapes
    // are matched — so an allow entry exempts exactly the text it names.
    const raw = strip(readFileSync(resolve(root, file), 'utf8'));
    const code = (ALLOW[file] ?? []).reduce((c, a) => c.replace(new RegExp(a.source, 'g'), ''), raw);
    for (const [label, re] of FORBIDDEN) {
      const bad = code.match(new RegExp(re.source, 'g')) ?? [];
      expect(bad, `${file}: ${label} → ${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it('the allow-list names only files that still carry residue (delete the line when the ticket lands)', () => {
    for (const [file, patterns] of Object.entries(ALLOW)) {
      const code = strip(readFileSync(resolve(root, file), 'utf8'));
      for (const p of patterns) {
        expect(p.test(code), `${file}: allow-list entry ${p} matches nothing — remove it`).toBe(true);
      }
    }
  });

  it('the forbidden regexes match the shapes they were written to catch', () => {
    // A guard that matches nothing is indistinguishable from one that passes.
    expect(FORBIDDEN[0][1].test("wk?.counts?.[row.ownerUid ?? row.id]")).toBe(true);
    expect(FORBIDDEN[2][1].test("const uidOf = (row: any) => row?.ownerUid ?? row?.id;")).toBe(true);
    expect(FORBIDDEN[3][1].test("reveal.picks?.[uid]")).toBe(true);
    expect(FORBIDDEN[4][1].test("pickCounts?.[entry.ownerUid ?? entry.id]")).toBe(true);
    expect(FORBIDDEN[5][1].test("entries.find(e => e.ownerUid === user.id)")).toBe(true);
    // And the entry-keyed forms pass.
    expect(FORBIDDEN[3][1].test("reveal.picks?.[row.id]")).toBe(false);
    expect(FORBIDDEN[4][1].test("pickCounts?.[entry.id]")).toBe(false);
  });
});


/**
 * Item 10 (Kevin, 2026-08-14): the standings tiebreaker column names what it
 * IS — the member's prediction — and explains the pool's rule via the ONE
 * shared sentence (`tiebreakerCopy`), never a hardcoded "MNF Score".
 */
describe('standings tiebreaker column — a prediction, described by the shared rule copy', () => {
  it('NFLStandings says "Tiebreaker Guess" and reads tiebreakerCopy for the hint', () => {
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLStandings.tsx'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).toContain('Tiebreaker Guess');
    expect(code).not.toContain('MNF Score');
    expect(code).toMatch(/tiebreakerCopy\(\s*tiebreakerRule\s*\)/);
  });
});


/**
 * Items 11/12: the Pick'em grid gained a Week Pts column. Every row — including
 * the Majority summary row — must carry a cell for it, or the game cells shift
 * one column left under the wrong headers (codex r2 caught the Majority row).
 * Coarse: count the header cells before the game map against the fixed cells
 * on the Majority row before ITS game map.
 */
describe('current picks grid — the Majority row has a cell for every fixed column', () => {
  it('Player, Set, Week Pts headers ↔ label, dash, dash before weekGames.map', () => {
    const src = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLPicksGrid.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // Every marker is asserted present before it is used to slice, so a
    // refactor fails HERE with a name, not downstream with a wrong count.
    // (qodo on #440.)
    const theadOpen = code.indexOf('<thead>');
    const theadClose = code.indexOf('</thead>');
    expect(theadOpen, '<thead> marker').toBeGreaterThan(0);
    expect(theadClose, '</thead> marker').toBeGreaterThan(theadOpen);
    const headerBlock = code.slice(theadOpen, theadClose);
    const headerGamesMap = headerBlock.indexOf('{weekGames.map');
    expect(headerGamesMap, 'header {weekGames.map marker').toBeGreaterThan(0);
    const fixedHeaders = (headerBlock.slice(0, headerGamesMap).match(/<th\b/g) ?? []).length;
    const majorityStart = code.search(/\bMajority\s*<\/td>/);
    expect(majorityStart, 'Majority label marker').toBeGreaterThan(0);
    const majorityGamesMap = code.indexOf('{weekGames.map', majorityStart);
    expect(majorityGamesMap, 'Majority-row {weekGames.map marker').toBeGreaterThan(majorityStart);
    const majorityBlock = code.slice(majorityStart, majorityGamesMap);
    // label cell is the <td> that wraps "Majority" itself, opened before the marker
    const fixedMajorityCells = 1 + (majorityBlock.match(/<td\b/g) ?? []).length;
    expect(fixedHeaders).toBe(3);
    expect(fixedMajorityCells).toBe(fixedHeaders);
  });
});

/**
 * Item 9: the row-click picks strip on Standings and Results is a THIRD
 * consumer of the reveal, and it obeys the same rule as the two grids — it
 * derives no lock of its own, and it renders through the shared cell rules.
 */
describe('row-click picks (EntryWeekPicks) — the reveal boundary stays the server\'s', () => {
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const code = strip(readFileSync(resolve(root, 'src/components/NFLPoolDashboard/EntryWeekPicks.tsx'), 'utf8'));
  it('renders through picksGridCell / weeklyPickCell and re-derives no lock', () => {
    expect(code).toContain('picksGridCell(');
    expect(code).toContain('weeklyPickCell(');
    expect(code).not.toContain('startTime <');
    expect(code).not.toContain('lockBufferMinutes');
    expect(code).not.toContain('serverNow');
  });
  it('Standings and Results both mount it and take the reveal as a prop', () => {
    for (const f of ['NFLStandings.tsx', 'NFLResults.tsx']) {
      const src = strip(readFileSync(resolve(root, `src/components/NFLPoolDashboard/${f}`), 'utf8'));
      expect(src, f).toContain('<EntryWeekPicks');
      expect(src, f).toContain('reveal={reveal}');
      expect(src, f).toContain('setOpenRowId(');
    }
    const dash = strip(readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx'), 'utf8'));
    expect((dash.match(/reveal=\{weekReveal\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * A FAILED READ OF THE MEMBER'S OWN ENTRY IS NOT "THEY HAVE NO ENTRY".
 *
 * `subscribeToMyNFLEntry` is the single source for the viewer's own picks on
 * every NFL surface — the pick sheets, the checklist banners, and the grid's own
 * row (which bypasses the reveal because that document IS its source). Its
 * success path already distinguishes an absent document from a present one, so
 * an error handler that also calls back with `null` collapses "the read failed"
 * into "you have not picked".
 *
 * That is not cosmetic: Firestore's `onSnapshot` TERMINATES a listener on error,
 * so a single errored snapshot leaves the member reading "picks not in yet" over
 * a completed sheet until they reload the page. A behavioural test would need a
 * Firestore double for a three-line subscription; this coarse grep pins the one
 * thing that matters — the error path does not invent state.
 */
describe('subscribeToMyNFLEntry — an error must not be reported as "no entry"', () => {
  const src = readFileSync(resolve(root, 'src/services/dbService.ts'), 'utf8');
  const body = src.slice(src.indexOf('subscribeToMyNFLEntry:'));
  const handler = body.slice(0, body.indexOf('subscribeToWeeklyRecaps:'));

  it('parsed the subscription out of the source', () => {
    // Guard the guard: a mis-parse would make the assertion below vacuous.
    expect(handler).toContain("Error subscribing to own NFL entry:");
    expect(handler.length).toBeGreaterThan(0);
    expect(handler.length).toBeLessThan(src.length);
  });

  it('the error handler logs and calls back with nothing', () => {
    const errorHandler = handler.slice(handler.indexOf('}, (error) => {'));
    expect(errorHandler).toContain('logger.error');
    // The removed line, verbatim. Keeping the last known state is the fix.
    expect(errorHandler).not.toContain('callback(null)');
  });

  it('the success path still reports a genuinely absent entry as null', () => {
    expect(handler).toContain('snap.exists() ?');
    expect(handler).toContain(': null');
  });
});

/**
 * …and the dashboard state it feeds is STAMPED, so the removed error callback
 * cannot become a cross-pool leak.
 *
 * The old error contract cleared `ownEntry` by accident on the way past. Losing
 * it means a listener that errors before its FIRST snapshot would leave the
 * previous pool's — or the previous account's — picks on screen and prefilled
 * into this pool's sheet. Same stamp-and-check-at-render rule `reveal`,
 * `consensus` and the grid sort already follow. (codex r1 on this change, P1.)
 */
describe('NFLPoolDashboard stamps the own-entry snapshot with pool AND uid', () => {
  const src = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx'), 'utf8');

  it('the subscription callback records which pool and which uid it came from', () => {
    expect(src).toContain('setOwnEntryState({ poolId: pool.id, uid: user.id, entry })');
    // The pre-change shape: the setter handed straight to the subscription, so
    // nothing recorded the source.
    expect(src).not.toContain('subscribeToMyNFLEntry(pool.id, user.id, setOwnEntry)');
  });

  it('and it is checked at render, not in an effect', () => {
    // An effect-based reset lands only AFTER the render that changed the pool has
    // already committed the previous pool's picks — the exact reason `reveal` and
    // the grid sort are checked at render too.
    expect(src).toContain('ownEntryState.poolId === pool.id');
    expect(src).toContain('ownEntryState.uid === user.id');
  });
});

/**
 * …and no surface states the absent-entry fact until the entry is KNOWN.
 *
 * `entry === null` means BOTH "never picked" and "the read never arrived", and
 * only the first licenses "you have not entered your picks". `onSnapshot`
 * terminates a listener on error, so an initial-snapshot failure means nothing
 * ever arrives — and the checklist would repeat the false claim for the life of
 * the page, which is the reported symptom. (codex r2 on #497, P2.)
 */
describe("WeekChecklist says nothing until the viewer's own entry is known", () => {
  const dash = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx'), 'utf8');
  const strip2 = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/WeekChecklist.tsx'), 'utf8');

  it('the dashboard derives it from a landed snapshot, not from `entry` being truthy', () => {
    expect(dash).toContain('const ownEntryKnown = !!user');
    expect(dash).toContain('entryKnown={ownEntryKnown}');
    // The grid's own-row bypass asks the SAME question, so the two cannot drift.
    expect(dash).not.toContain('ownEntryLoaded={!!ownEntry}');
    expect(dash).toContain('ownEntryLoaded={ownEntryKnown}');
  });

  it('and the strip renders nothing when it is false', () => {
    expect(strip2).toContain('if (!entryKnown) return null;');
  });
});

/**
 * PLAN-MEMBER-PICK-PROGRESS T3 — the pool-wide chip.
 *
 * The number itself is proved on the server (unit tests on `pickProgressFor`,
 * emulator tests on the callable). What only a source grep can pin is that the
 * GRID renders it under the two conditions the plan turns on:
 *
 *   1. `total > 0` gates it. `{complete: 0, total: 0}` is the server saying "I
 *      cannot answer" — no schema-2 `rosterSummary`, or a week with no games —
 *      and rendering it would print "0 of 0 in", which is the plausible-looking
 *      substitute this repo bans. There is no other signal: the field is a plain
 *      pair, so the zero IS the sentinel.
 *   2. It reads the WEEK-MATCHED reveal (`wk`), like every other field off it.
 *      Last week's fraction over this week's slate is a confident wrong answer.
 *
 * And the label says "Players", which is load-bearing rather than cosmetic: the
 * chip beside it counts uid-deduplicated ROWS today, and once PLAN-MULTI-ENTRY
 * T4 makes rows per-entry the two numbers legitimately differ. Only the words
 * keep them from reading as a contradiction.
 */
describe('the Current Picks grid renders pool-wide progress, and hides it when unanswerable', () => {
  const grid2 = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLPicksGrid.tsx'), 'utf8');

  it('takes the fraction from the week-matched reveal, not the raw prop', () => {
    expect(grid2).toContain('const progress = wk?.progress;');
    expect(grid2).not.toContain('reveal?.progress');
  });

  it('renders nothing at all when total is 0', () => {
    // Both the header chip and the legend sentence are gated. A legend that
    // explains a chip nobody can see is its own small lie.
    expect((grid2.match(/progress && progress\.total > 0/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(grid2).not.toMatch(/\{progress\.complete\} of \{progress\.total\}[\s\S]{0,40}<\/span>\s*<span[^>]*>\s*\{entries\.length\}/);
  });

  it('says PLAYERS, and does not reuse the row count as its denominator', () => {
    expect(grid2).toContain('{progress.complete} of {progress.total} Players In');
    // The denominator is the server's, never `entries.length` — those count
    // different things the moment one player holds two entries.
    expect(grid2).not.toContain('of {entries.length} Players');
  });

  it('the Survivor/Margin grid shows the same fraction, named for its WEEK', () => {
    // That grid draws many weeks at once and the chip describes exactly one, so
    // an unlabelled fraction there reads as "12 of 16 have finished the season".
    const weekly = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLWeeklyPicksGrid.tsx'), 'utf8');
    expect(weekly).toContain('progress && progress.total > 0');
    expect(weekly).toContain('{nflWeekLabel(seasonType, week)}: {progress.complete} of {progress.total} Players In');
    // …and off the reveal for THAT week, never whichever one happens to be cached.
    expect(weekly).toContain('revealsByWeek[week]?.week === week');
  });

  it('the client mirror of the response carries the field', () => {
    // `getPoolPicks` CASTS its result, so nothing checks the two shapes against
    // each other; the field has to be added to both by hand (codex r4 on the plan).
    const dbsrc = readFileSync(resolve(root, 'src/services/dbService.ts'), 'utf8');
    expect(dbsrc).toContain('progress?: { complete: number; total: number };');
  });
});
