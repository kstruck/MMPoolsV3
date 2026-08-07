import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nflWeekLabel, nflWeekChip } from '../shared/nflWeekLabel';
import { nflWeekLabel as clientLabel, nflWeekChip as clientChip } from '../src/utils/nflWeekLabel';

/**
 * One week label, client AND server.
 *
 * Preseason importer weeks are OFFSET from what fans call them: importer week 1
 * is HOF Weekend and importer week 2 is "Preseason Week 1". Every client surface
 * has rendered that since `nflWeekLabel` was introduced, but `scoreNFLWeek`'s
 * result strings, errors and audit messages interpolated the RAW importer week —
 * so scoring the Hall of Fame game reported "Week 1 scored successfully." under
 * a button reading "Score & Recap HOF Weekend".
 *
 * The implementation moved into `shared/` (compiled into the functions bundle)
 * and `src/utils/nflWeekLabel.ts` re-exports it, so there is one definition
 * rather than a copy plus a parity test. These cases pin the OFFSET, which is
 * the part that is easy to get wrong in either direction.
 */
describe('nflWeekLabel — the preseason offset', () => {
  it('calls importer week 1 of the preseason "HOF Weekend"', () => {
    expect(nflWeekLabel(1, 1)).toBe('HOF Weekend');
    expect(nflWeekChip(1, 1)).toBe('HOF');
  });

  it('shifts every later preseason week down by one', () => {
    // Importer week 2 is the slate ESPN and fans call Preseason Week 1.
    expect(nflWeekLabel(1, 2)).toBe('Preseason Week 1');
    expect(nflWeekLabel(1, 4)).toBe('Preseason Week 3');
    expect(nflWeekChip(1, 2)).toBe('P1');
  });

  it('does not shift regular season or postseason', () => {
    expect(nflWeekLabel(2, 1)).toBe('Week 1');
    expect(nflWeekLabel(2, 14)).toBe('Week 14');
    expect(nflWeekLabel(3, 1)).toBe('Week 1');
    expect(nflWeekChip(2, 14)).toBe('W14');
  });

  it('treats an ABSENT seasonType as regular season, never as preseason', () => {
    // `seasonType` is optional and omitting it means REGULAR (shared/schemas/nfl.ts).
    // Defaulting the other way would relabel every unset pool's week 1 "HOF Weekend".
    expect(nflWeekLabel(undefined, 1)).toBe('Week 1');
  });
});

describe('the client re-export is the same function, not a copy', () => {
  it('exports the identical references', () => {
    // Identity, not behaviour: a copy that happened to agree today would pass a
    // behavioural check and drift tomorrow. This cannot.
    expect(clientLabel).toBe(nflWeekLabel);
    expect(clientChip).toBe(nflWeekChip);
  });

  it('src/utils/nflWeekLabel.ts holds no second implementation', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/utils/nflWeekLabel.ts'), 'utf8');
    expect(src).toMatch(/export \{ nflWeekLabel, nflWeekChip \} from '@shared\/nflWeekLabel'/);
    // No local definition. Matched on the DECLARATION, not on the string
    // 'HOF Weekend' — the file's own docblock explains the offset and mentions
    // it, so a content match here fails on the comment rather than on a copy.
    expect(src).not.toMatch(/(export\s+)?function\s+nflWeek(Label|Chip)\s*\(/);
    expect(src).not.toMatch(/week === 1 \?/);
  });
});

describe('nflPools.ts renders labels, not raw importer week numbers', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'functions/src/nflPools.ts'),
    'utf8',
  );

  it('has no user-visible `Week ${week}` interpolation left', () => {
    // The exact shapes that were wrong: the scoring result strings, the audit
    // messages, and the not-found / not-playing errors.
    expect(src).not.toMatch(/`Week \$\{week\}/);
    expect(src).not.toMatch(/for [Ww]eek \$\{week\}/);
    expect(src).not.toMatch(/not playing in week \$\{week\}/);
  });

  it('that grep matches the strings it was written to catch', () => {
    // Guard the guard, with the literal pre-change source.
    expect('`Week ${week} scored successfully.`').toMatch(/`Week \$\{week\}/);
    expect('`No NFL games found for week ${week}.`').toMatch(/for [Ww]eek \$\{week\}/);
  });

  it('routes every label through one pool-aware helper', () => {
    expect(src).toMatch(/const weekLabelFor =/);
    // `seasonType` is optional and means REGULAR when unset — the `|| 2` is the
    // direction #319 got wrong, so it is pinned rather than left to a comment.
    expect(src).toMatch(/nflWeekLabel\(Number\(p\?\.seasonType\) \|\| 2, w\)/);
    // Used in more than the one place Kevin reported.
    expect((src.match(/weekLabelFor\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('leaves the persisted payments-ledger note alone', () => {
    // `Survivor rebuy (week N)` is a stored money record. Changing the format of
    // a persisted ledger string is a data-shape change, not a copy fix, and it
    // trips mmp-change-control's money trigger. Deliberately out of scope.
    expect(src).toContain('`Survivor rebuy (week ${week})`');
  });
});
