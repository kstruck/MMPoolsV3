import { describe, it, expect } from 'vitest';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST, WIZARD_FIELD_ALLOWLIST } from '../src/help/coverage-allowlist';
import { NFL_PICKEM_PLACEMENTS, NFL_PICKEM_TOPICS } from '../src/help/content/nfl-pickem';
import { NFL_SEASON_TYPES, NFL_SHARED_TOPICS } from '../src/help/content/nfl-shared';
import { resolveCopy, staticCopy } from '../src/help/registry';
import { nflLockMode } from '../shared/nflLockMode';
import { DEFAULT_LOCK_BUFFER_MINUTES, LOCK_BUFFER_PRESETS } from '../shared/weeklyHardLock';

/**
 * T9 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * The generic registry guards prove the content is well-formed. This file
 * proves the two things that are specific to T9 and that nothing else can see:
 *
 *  1. **Pick'em copy does not leak to Survivor or Margin.** `pool.nfl.*` is ONE
 *     set of Help pages shared by all three season formats, so every Pick'em
 *     topic is placed on a page a Survivor reader also opens. Scope is the only
 *     thing keeping them apart — a topic authored with `poolTypes: 'all'`, or
 *     with the survivor type added by a later edit, would silently tell a
 *     Survivor player about confidence points their pool does not have.
 *
 *  2. **The manager copy does not leak to members.** The commissioner tabs'
 *     topics are `['commissioner']`, and `resolveTopic` is the tooltip's only
 *     filter.
 *
 * Each check is paired with a planted counter-example, so a guard that stopped
 * discriminating fails here rather than going quietly green.
 */

const MEMBER = { audience: 'member' } as const;
const HOST = { audience: 'commissioner' } as const;

/** The pages `content/pool-pages.ts` builds for the three NFL season formats. */
const NFL_PAGE_IDS = helpRegistry.pages
  .filter((p) => p.id === 'pool.nfl' || p.id.startsWith('pool.nfl.'))
  .map((p) => p.id);

/** Topic ids visible on a page to a reader in `poolType` with `audience`. */
function visibleOn(pageId: string, poolType: PoolType, audience: 'member' | 'commissioner'): string[] {
  return helpRegistry
    .placementsForPage(pageId, { poolType, audience })
    .flatMap((s) => s.topics)
    .map((t) => t.id);
}

describe('T9 — the NFL pages exist to be placed on', () => {
  it('finds the shared NFL pool pages', () => {
    // A rename in `pool-pages.ts` would otherwise make every assertion below
    // vacuously true by leaving nothing to check.
    expect(NFL_PAGE_IDS).toContain('pool.nfl.picks');
    expect(NFL_PAGE_IDS).toContain('pool.nfl.rules');
    expect(NFL_PAGE_IDS).toContain('pool.nfl.manager.settings');
    expect(NFL_PAGE_IDS.length).toBeGreaterThan(10);
  });

  it('every T9 placement names a page that exists', () => {
    const pageIds = new Set(helpRegistry.pages.map((p) => p.id));
    const missing = NFL_PICKEM_PLACEMENTS.filter((p) => !pageIds.has(p.page)).map((p) => p.page);
    expect(missing).toEqual([]);
  });
});

describe("T9 — Pick'em copy is scoped to Pick'em", () => {
  it('every topic in nfl-pickem.ts is scoped to NFL_PICKEM alone', () => {
    const wrong = NFL_PICKEM_TOPICS.filter(
      (t) => t.poolTypes === 'all' || t.poolTypes.length !== 1 || t.poolTypes[0] !== 'NFL_PICKEM',
    ).map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('a Survivor or Margin reader sees none of it on the shared pages', () => {
    const pickemIds = new Set(NFL_PICKEM_TOPICS.map((t) => t.id));
    const leaked = NFL_PAGE_IDS.flatMap((page) =>
      (['NFL_SURVIVOR', 'NFL_MARGIN'] as const).flatMap((type) =>
        (['member', 'commissioner'] as const).flatMap((aud) =>
          visibleOn(page, type, aud)
            .filter((id) => pickemIds.has(id))
            .map((id) => `${type}/${aud} sees ${id} on ${page}`),
        ),
      ),
    );
    expect(leaked).toEqual([]);
  });

  it("a Pick'em reader does see it — the check above is not passing by emptiness", () => {
    const onPickSheet = visibleOn('pool.nfl.picks', 'NFL_PICKEM', 'member');
    expect(onPickSheet).toContain('pickem.picksheet');
    expect(onPickSheet).toContain('pickem.quickPicks');
    expect(onPickSheet).toContain('settings.confidenceMode');
    expect(visibleOn('pool.nfl.rules', 'NFL_PICKEM', 'member')).toContain('settings.weeklyTiebreaker');
  });

  it('the scope filter discriminates: widening a topic WOULD leak it', () => {
    // Reverting the fix in miniature. `resolveTopic` is the one filter, so a
    // topic scoped to all types resolves for Survivor — which is exactly what
    // the assertion above would then catch.
    const widened = helpRegistry.resolveTopic(
      { poolType: 'NFL_SURVIVOR', ...MEMBER },
      'settings.maxEntriesPerUser', // authored `poolTypes: 'all'` in T1
    );
    expect(widened?.id).toBe('settings.maxEntriesPerUser');
    const scoped = helpRegistry.resolveTopic({ poolType: 'NFL_SURVIVOR', ...MEMBER }, 'settings.confidenceMode');
    expect(scoped).toBeUndefined();
  });
});

describe('T9 — the shared NFL copy is shared', () => {
  it('every topic in nfl-shared.ts names all three season formats', () => {
    const wrong = NFL_SHARED_TOPICS.filter(
      (t) =>
        t.poolTypes === 'all' ||
        !['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].every((p) => (t.poolTypes as readonly string[]).includes(p)),
    ).map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('and reaches a reader of each of the three', () => {
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const) {
      expect(visibleOn('pool.nfl.payments', type, 'member')).toContain('nfl.payments.yours');
      expect(visibleOn('pool.nfl.manager.scoring', type, 'commissioner')).toContain('nfl.manager.scoreWeek');
    }
  });

  it('and not to a reader of any other pool type', () => {
    const sharedIds = new Set(NFL_SHARED_TOPICS.map((t) => t.id));
    const others = POOL_TYPES.filter(
      (t) => !(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as readonly string[]).includes(t),
    );
    const leaked = others.flatMap((type) =>
      NFL_PAGE_IDS.flatMap((page) =>
        visibleOn(page, type, 'commissioner')
          .filter((id) => sharedIds.has(id))
          .map((id) => `${type} sees ${id} on ${page}`),
      ),
    );
    expect(leaked).toEqual([]);
  });
});

describe('T9 — commissioner copy stays on the commissioner side', () => {
  it('a member sees none of the manager topics, on any NFL page', () => {
    const hostOnly = new Set(
      NFL_SHARED_TOPICS.filter((t) => !t.audience.includes('member')).map((t) => t.id),
    );
    expect(hostOnly.size).toBeGreaterThan(0);
    const leaked = NFL_PAGE_IDS.flatMap((page) =>
      (['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const).flatMap((type) =>
        visibleOn(page, type, 'member')
          .filter((id) => hostOnly.has(id))
          .map((id) => `member sees ${id} on ${page}`),
      ),
    );
    expect(leaked).toEqual([]);
  });

  it('a commissioner sees them — and also sees the member copy', () => {
    const settings = visibleOn('pool.nfl.manager.settings', 'NFL_PICKEM', 'commissioner');
    expect(settings).toContain('nfl.manager.settingsLock');
    expect(settings).toContain('settings.confidenceMode'); // audience ['member','commissioner']
    expect(helpRegistry.resolveTopic({ poolType: 'NFL_PICKEM', ...HOST }, 'nfl.manager.ledger')?.id)
      .toBe('nfl.manager.ledger');
    expect(helpRegistry.resolveTopic({ poolType: 'NFL_PICKEM', ...MEMBER }, 'nfl.manager.ledger'))
      .toBeUndefined();
  });
});

describe('T9 — the allowlist rows it closed are closed', () => {
  it("the two Pick'em schema rows T9 closed are gone", () => {
    for (const path of ['settings.confidenceMode', 'settings.isListedPublic']) {
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} should no longer be allowlisted`).toBe(false);
    }
  });

  it('the confidence wizard-field row is gone', () => {
    expect('settings.confidenceMode' in WIZARD_FIELD_ALLOWLIST).toBe(false);
  });

  /**
   * The two topics T9 WITHDREW and 93f44bb2 (#482) released.
   *
   * T9 wrote both, carried them through six codex rounds, and pulled them on
   * round 7 because the shipped client ignored `lockMode` — a PER_GAME pool
   * closed its whole sheet at the week's first kickoff, so copy describing the
   * setting would have been false on screen. #482 made the client honour the
   * setting and put the rule in `shared/nflLockMode.ts`.
   *
   * This is the same guard inverted: it now fails if either topic is dropped,
   * or if either allowlist row comes back and quietly re-hides the setting.
   */
  it('the two lock topics T9 withheld are authored, and their rows are gone', () => {
    for (const list of [SCHEMA_PATH_ALLOWLIST, WIZARD_FIELD_ALLOWLIST]) {
      expect('settings.lockMode' in list).toBe(false);
    }
    expect('settings.lockBufferMinutes' in SCHEMA_PATH_ALLOWLIST).toBe(false);

    const lockMode = helpRegistry.getTopic('settings.lockMode');
    const buffer = helpRegistry.getTopic('settings.lockBufferMinutes');
    expect(lockMode).toBeDefined();
    expect(buffer).toBeDefined();

    // Scope is what keeps the shared `pool.nfl.*` pages honest. `lockMode` is
    // a Pick'em choice — Survivor and Margin are always weekly and have no
    // such control — while the buffer exists on all three.
    expect(lockMode!.poolTypes).toEqual(['NFL_PICKEM']);
    expect(buffer!.poolTypes).toEqual([...NFL_SEASON_TYPES]);
  });

  /**
   * The claims those two topics make, held to the code that implements them.
   *
   * Voice rule 5 is the rule this effort keeps breaking, and both of these
   * sentences name a behaviour rather than a label — exactly the shape that
   * broke ten times on #480. So the numbers are asserted against
   * `shared/`, not trusted.
   */
  it('the lock copy agrees with shared/nflLockMode.ts', () => {
    const buffer = helpRegistry.getTopic('settings.lockBufferMinutes')!;
    // "Five minutes is the default."
    expect(DEFAULT_LOCK_BUFFER_MINUTES).toBe(5);
    expect(staticCopy(buffer.short)).toContain('Five minutes is the default');
    // "their shortest setting is five minutes" — the narrowest Survivor/Margin
    // preset. If a 0 or 1 preset were ever added this sentence goes false.
    expect(Math.min(...LOCK_BUFFER_PRESETS)).toBe(5);

    // "Confidence points force weekly whatever this says."
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: true })).toBe('WEEKLY');
    // "Per game is the default."
    expect(nflLockMode('NFL_PICKEM', {})).toBe('PER_GAME');
    // Survivor and Margin are always weekly, which is why `lockMode` is scoped
    // to Pick'em alone above.
    expect(nflLockMode('NFL_SURVIVOR', { lockMode: 'PER_GAME' })).toBe('WEEKLY');
    expect(nflLockMode('NFL_MARGIN', { lockMode: 'PER_GAME' })).toBe('WEEKLY');
  });

  /**
   * The row T9 could not close, now SETTLED — and the assertion flipped with
   * it rather than deleted.
   *
   * `settings.pointsPerPick` is INERT: `scorePickemEntry` awards exactly 1
   * point per correct pick and never reads it, while the manager form set it
   * and two member-facing surfaces showed the chosen number as what a pick was
   * worth. Kevin ruled on 2026-08-22: delete the controls and the rows, do not
   * honour the field in the scorer, because honouring it would retroactively
   * rewrite already-scored weeks. See PLAN-DELETE-INERT-PICKEM-SCORING.md.
   *
   * The row stays PERMANENT rather than being removed: `shared/schemas/nfl.ts`
   * still accepts the field — which is what keeps a stored value on an
   * existing pool from being rejected — and the schema audit requires every
   * schema path to be either explained or allowlisted. There is no control
   * left for help copy to explain.
   */
  it('records the settled reason for the inert scoring field', () => {
    const reason = SCHEMA_PATH_ALLOWLIST['settings.pointsPerPick'];
    expect(reason).toMatch(/^PERMANENT\b/);
    expect(reason).toMatch(/INERT/);
    // The two halves of Kevin's ruling, so a future edit that softens either
    // one has to do it deliberately.
    expect(reason).toMatch(/DELETED/);
    expect(reason).toMatch(/shared\/schemas\/nfl\.ts/);
  });

  it('the isPublic topic is what accounts for settings.isListedPublic', () => {
    const topic = helpRegistry.getTopic('isPublic');
    expect(topic?.fields).toEqual(['isPublic', 'settings.isListedPublic']);
  });
});

/**
 * The weekly tie-breaker copy, now that it is a template.
 *
 * This is the sentence voice rule 5 kept breaking on: three earlier drafts
 * opened with a claim true of the two pickable Monday rules and false of
 * MNF_COMBINED and NONE, and each fix widened the copy further. The template
 * ends that by naming the rule the reader's own pool is playing — so what has
 * to be proved is that each branch says the RIGHT thing, and that the wizard
 * still gets the widened version.
 */
/**
 * T4's near miss, pinned.
 *
 * `nfl.manager.extendDeadline` was first authored in `nfl-shared.ts` at all
 * three season types, because the OTHER two exception topics belong there. It
 * does not: `extendWeekDeadline` refuses a Survivor or Margin pool outright
 * (`HARD_WEEKLY_LOCK`), and the manager form renders an explanation instead of
 * the control for them. Left as it was, a Survivor commissioner's Help panel
 * would have described a control their pool does not have and could not use —
 * on `pool.nfl.manager.settings`, which all three types share.
 *
 * The file-level invariant above caught it. This pins the behaviour that
 * invariant is a proxy for.
 */
describe('T4 — the deadline-extension topic is Pick’em only', () => {
  const PAGE = 'pool.nfl.manager.settings';
  const TOPIC = 'nfl.manager.extendDeadline';

  it('reaches a Pick’em commissioner', () => {
    expect(visibleOn(PAGE, 'NFL_PICKEM', 'commissioner')).toContain(TOPIC);
  });

  it.each(['NFL_SURVIVOR', 'NFL_MARGIN'] as const)('does NOT reach a %s commissioner', type => {
    expect(visibleOn(PAGE, type, 'commissioner')).not.toContain(TOPIC);
    expect(helpRegistry.resolveTopic({ poolType: type, audience: 'commissioner' }, TOPIC)).toBeUndefined();
  });

  it('the other two exception topics DO reach all three — they are not scoped by accident', () => {
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const) {
      const seen = visibleOn(PAGE, type, 'commissioner');
      expect(seen).toContain('nfl.manager.proxyPick');
      expect(seen).toContain('nfl.manager.cancelPool');
    }
  });

  it('and none of the three reaches a MEMBER', () => {
    // Every one of them is a commissioner action; `resolveTopic` is the only
    // filter between the topic and a member's panel.
    for (const id of ['nfl.manager.proxyPick', 'nfl.manager.cancelPool', TOPIC]) {
      expect(helpRegistry.resolveTopic({ poolType: 'NFL_PICKEM', audience: 'member' }, id)).toBeUndefined();
    }
  });
});

describe('settings.weeklyTiebreaker renders the rule this pool is playing', () => {
  const topic = helpRegistry.getTopic('settings.weeklyTiebreaker');

  const shortFor = (settings: Record<string, unknown>) => resolveCopy(topic!.short, { settings });
  const longFor = (settings: Record<string, unknown>) => resolveCopy(topic!.long, { settings });

  it('is a template on both fields', () => {
    expect(typeof topic!.short).not.toBe('string');
    expect(typeof topic!.long).not.toBe('string');
  });

  it('names the LAST Monday game, and only that one', () => {
    const s = shortFor({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    expect(s).toContain('LAST Monday game');
    expect(s).not.toContain('FIRST');
    expect(longFor({ weeklyTiebreaker: 'MNF_LAST_GAME' })).toContain('last Monday game to kick off');
  });

  it('names the FIRST Monday game, and only that one', () => {
    const s = shortFor({ weeklyTiebreaker: 'MNF_FIRST_GAME' });
    expect(s).toContain('FIRST Monday game');
    expect(s).not.toContain('LAST');
    expect(longFor({ weeklyTiebreaker: 'MNF_FIRST_GAME' })).toContain('first Monday game to kick off');
  });

  /**
   * THE BRANCH THE WIDENED COPY EXISTED FOR. Under `NONE` nothing is
   * predicted, so a sentence about "whoever is closest" is simply false — and
   * every earlier draft had to carry a second sentence walking the first one
   * back.
   */
  it('says nothing about predictions or closeness under NONE', () => {
    const s = shortFor({ weeklyTiebreaker: 'NONE' });
    const l = longFor({ weeklyTiebreaker: 'NONE' });
    expect(s).toContain('no prediction');
    expect(s).not.toMatch(/closest|Monday/);
    expect(l).not.toMatch(/closest/);
    expect(l).toContain('shares that week outright');
  });

  /**
   * The legacy rule. `effectiveWeeklyTiebreaker` resolves BOTH an absent value
   * and a junk one to `MNF_COMBINED` — a pool holding a typo plays the
   * historical rule rather than silently becoming `NONE` — so the copy has to
   * follow it to all three.
   */
  it.each([
    ['stored explicitly', { weeklyTiebreaker: 'MNF_COMBINED' }],
    ['absent', {}],
    ['a typo', { weeklyTiebreaker: 'MNF_LASTGAME' }],
  ])('describes the legacy combined rule when the value is %s', (_label, settings) => {
    expect(shortFor(settings)).toContain('Monday games together');
    const l = longFor(settings);
    expect(l).toContain('Monday games together');
    // The half that makes it legacy, and the half a commissioner needs: it is
    // not offered any more, and it is not being taken away either.
    expect(l).toContain('no longer offered');
    // Under this rule a Monday-less week asks for nothing — the second place
    // the widened copy had to hedge.
    expect(l).toContain('no Monday game nothing is predicted');
  });

  it('every branch is distinct — the template is not collapsing to one string', () => {
    const rendered = new Set([
      shortFor({ weeklyTiebreaker: 'MNF_LAST_GAME' }),
      shortFor({ weeklyTiebreaker: 'MNF_FIRST_GAME' }),
      shortFor({ weeklyTiebreaker: 'MNF_COMBINED' }),
      shortFor({ weeklyTiebreaker: 'NONE' }),
    ]);
    expect(rendered.size).toBe(4);
  });

  /**
   * THE CONTRACT THIS PR MUST NOT BREAK. The wizard knows the pool type from
   * the moment the format is chosen and has no settings until the pool exists,
   * so the reader there is the one who genuinely needs all four rules
   * described. That is what the fallback is, and it must still be what a
   * settings-free scope returns.
   */
  it('falls back to the four-rule wording wherever no pool is in scope', () => {
    for (const ctx of [undefined, {}, { poolType: 'NFL_PICKEM' as const }]) {
      expect(resolveCopy(topic!.short, ctx)).toContain('Decides who wins a week');
      const l = resolveCopy(topic!.long, ctx);
      expect(l).toContain('either the last Monday game or the first');
      expect(l).toContain('You can also choose no tie-breaker');
    }
  });

  it('the fallback is what stands alone, and the invariants measure it', () => {
    expect(staticCopy(topic!.short)).toContain('Decides who wins a week');
    expect(staticCopy(topic!.long)).toContain('A few older pools');
  });

  /**
   * SEARCH FOLLOWS THE SAME BRANCH THE PAGE DOES.
   *
   * Indexing the fallback everywhere would hand a reader inside a `NONE` pool
   * a snippet about Monday games their own screen never says, and would fail
   * to match the words it does. Off a pool surface there are no settings and
   * the index is the fallback again, unchanged.
   */
  describe('search', () => {
    const inPool = { poolType: 'NFL_PICKEM' as const, audience: 'member' as const, settings: { weeklyTiebreaker: 'NONE' } };
    const noPool = { poolType: 'NFL_PICKEM' as const, audience: 'member' as const };
    const ids = (q: string, scope: Parameters<typeof helpRegistry.search>[1]) =>
      helpRegistry.search(q, scope).map((r) => r.id);

    it('finds the topic by wording only its own branch uses', () => {
      expect(ids('shares that week outright', inPool)).toContain('settings.weeklyTiebreaker');
      expect(ids('shares that week outright', noPool)).not.toContain('settings.weeklyTiebreaker');
    });

    it('stops offering it for wording that branch does not carry', () => {
      // A NONE pool's copy never mentions older pools; the fallback does.
      expect(ids('A few older pools', noPool)).toContain('settings.weeklyTiebreaker');
      expect(ids('A few older pools', inPool)).not.toContain('settings.weeklyTiebreaker');
    });

    it('the snippet comes from the branch the reader would open', () => {
      const hit = helpRegistry.search('no prediction', inPool).find((r) => r.id === 'settings.weeklyTiebreaker');
      expect(hit).toBeTruthy();
      expect(hit!.snippet).not.toContain('A few older pools');
    });
  });
});
