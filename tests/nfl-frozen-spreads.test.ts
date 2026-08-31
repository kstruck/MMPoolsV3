import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyFrozenSpreads, FROZEN_SPREADS_COLLECTION, type FrozenSpread } from '@shared/frozenSpread';
import { spreadLabel } from '../src/components/NFLPoolDashboard/pickSheet/GameMeta';
import type { NFLGame } from '../src/types';

/**
 * PLAN-NFL-SPREAD-FREEZE Revision 1, PR 1 — the client half.
 *
 * Two invariants, and the plan names both because a review round found each one
 * missing:
 *
 *  1. THE DISPLAY PATH RESOLVES TOO (codex round 1 on the revision). The pick
 *     sheet renders `game.spread.value` through `GameMeta`. Resolve only the
 *     grading path and the feed can move the working line after a freeze, so an
 *     ATS player is SHOWN one number and GRADED on another — which breaks the
 *     fairness requirement more directly than the bug the plan started from.
 *  2. NO CLIENT MAY WRITE THE FROZEN STORE. Source-level, because this repo's
 *     emulator suites run through the Admin SDK and bypass rules entirely — the
 *     same reasoning as `tests/nfl-settings-lockdown.test.ts`.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const game = (over: Partial<NFLGame> = {}): NFLGame => ({
  id: 'g1', espnGameId: '1', week: 4, season: '2026', seasonType: 1,
  homeTeam: { id: 'h', name: 'Bengals', abbreviation: 'CIN' },
  awayTeam: { id: 'a', name: 'Lions', abbreviation: 'DET' },
  startTime: 1_800_000_000_000, status: 'SCHEDULED',
  ...over,
} as NFLGame);

const frozen = (over: Partial<FrozenSpread> = {}): FrozenSpread => ({
  gameId: 'g1', value: -6.5, frozenAt: 1_700_000_000_000,
  season: '2026', seasonType: 1, week: 4, source: 'freeze',
  ...over,
});

describe('the pick sheet renders the FROZEN line, not the working one', () => {
  it('shows the frozen number when the two disagree', () => {
    // The working line has moved to DET -2.5 since the freeze; the sheet must
    // still say CIN -6.5, because that is what the week will be graded on.
    const working = game({ spread: { value: 2.5, locked: false } });
    expect(spreadLabel(working)).toBe('DET -2.5');

    const [resolved] = applyFrozenSpreads([working], { g1: frozen({ value: -6.5 }) });
    expect(spreadLabel(resolved)).toBe('CIN -6.5');
  });

  it('shows the working line while the slate has not been frozen', () => {
    const [resolved] = applyFrozenSpreads([game({ spread: { value: 2.5, locked: false } })], {});
    expect(spreadLabel(resolved)).toBe('DET -2.5');
  });

  it('shows a frozen line on a game the feed never gave one to', () => {
    // The preseason case: imported before odds existed, so `nfl_games.spread` is
    // absent entirely and the operator's number lives only in the frozen store.
    const [resolved] = applyFrozenSpreads([game()], { g1: frozen({ value: -3 }) });
    expect(spreadLabel(resolved)).toBe('CIN -3');
  });

  it('reports a frozen game as locked, which is what unblocks the pick sheet banner', () => {
    // `PickemPickEntry` blocks the whole sheet on `games.every(g => g.spread?.locked)`,
    // mirroring the server's SPREADS_NOT_LOCKED gate. Both read `spread.locked`,
    // so both are satisfied by the resolution rather than by learning a new field.
    const [resolved] = applyFrozenSpreads([game()], { g1: frozen() });
    expect(resolved.spread?.locked).toBe(true);
  });
});

describe('firestore.rules — nfl_frozen_spreads is unwritable by every client', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf(`match /${FROZEN_SPREADS_COLLECTION}/`));

  it('declares the collection', () => {
    expect(rules).toContain(`match /${FROZEN_SPREADS_COLLECTION}/{gameId}`);
  });

  it('refuses every client write — flat, not conditionally on `locked`', () => {
    // "Refused when locked" is a condition that can be subtly wrong, and this
    // collection exists because an invariant defended by four writers kept
    // leaking. `if false` has no such failure mode, and a SUPER_ADMIN is a
    // client too.
    expect(block).toMatch(/allow write:\s*if false;/);
    expect(block.slice(0, block.indexOf('}'))).not.toMatch(/isSuperAdmin/);
  });

  it('is publicly readable, so a member can see the number they are graded on', () => {
    expect(block).toMatch(/allow read:\s*if true;/);
  });
});
