import { describe, it, expect } from 'vitest';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST, WIZARD_FIELD_ALLOWLIST } from '../src/help/coverage-allowlist';
import { NFL_PICKEM_PLACEMENTS, NFL_PICKEM_TOPICS } from '../src/help/content/nfl-pickem';
import { NFL_SHARED_TOPICS } from '../src/help/content/nfl-shared';

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
   * The two rows T9 WITHDREW, and why, pinned so the reason cannot be lost.
   *
   * `NFLPoolDashboard.tsx:515-534` derives the week lock from the earliest
   * kickoff for every NFL type and `PickemPickEntry.tsx:138-141` locks every
   * game once that flag is set — so a PER_GAME Pick'em pool locks its whole
   * sheet at the first kickoff, while the server would accept a later pick.
   * Copy for either setting would have been false on screen. Delete this test
   * when the client fix lands and the topics are authored.
   */
  it('records the lock topics it withdrew, with their reason', () => {
    for (const list of [SCHEMA_PATH_ALLOWLIST, WIZARD_FIELD_ALLOWLIST]) {
      expect(list['settings.lockMode']).toMatch(/^T9-BLOCKED:/);
    }
    expect(SCHEMA_PATH_ALLOWLIST['settings.lockBufferMinutes']).toMatch(/^T9-BLOCKED:/);
    expect(helpRegistry.getTopic('settings.lockMode')).toBeUndefined();
    expect(helpRegistry.getTopic('settings.lockBufferMinutes')).toBeUndefined();
  });

  /**
   * The one row T9 did not close, asserted rather than left as prose.
   *
   * `settings.pointsPerPick` is INERT: `scorePickemEntry` awards exactly 1 per
   * correct pick and never reads it, while the manager form sets it and the
   * rules page shows it to members as what a pick is worth. Writing help copy
   * for it would either repeat that claim or document the bug, so the row
   * stays with the finding written into it. Delete this test when Kevin's
   * decision lands — and if the row is removed without copy being written, the
   * schema audit fails, which is the backstop.
   */
  it('records the one row it could not close, with its reason', () => {
    expect(SCHEMA_PATH_ALLOWLIST['settings.pointsPerPick']).toMatch(/^T9-BLOCKED:/);
    expect(SCHEMA_PATH_ALLOWLIST['settings.pointsPerPick']).toMatch(/INERT/);
  });

  it('the isPublic topic is what accounts for settings.isListedPublic', () => {
    const topic = helpRegistry.getTopic('isPublic');
    expect(topic?.fields).toEqual(['isPublic', 'settings.isListedPublic']);
  });
});
