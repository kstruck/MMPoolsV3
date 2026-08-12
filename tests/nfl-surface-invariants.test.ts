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

  it('the pool-home CTA names the action it will actually perform', () => {
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx'),
      'utf8',
    );
    expect(src).toContain('Edit My Picks');
    expect(src).toContain('Make My Picks');
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

    // Overview owns the bento and the payouts card.
    expect(at('<NFLManagerBentoDashboard')).toBeGreaterThan(overview);
    expect(at('<RecordPayoutsCard')).toBeGreaterThan(overview);
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
