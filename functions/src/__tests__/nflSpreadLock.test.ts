import { describe, it, expect } from 'vitest';
import { readJobGate, shouldLockSpread } from '../nflSchedule';

// PLAN-NFL-PRESEASON-PILOT A2: lockNFLSpreadsJob gained the house kill-switch +
// dry-run gate (system/config.nflSpreadLock) before being exported from index.ts.
// The job body itself is exercised by the emulator suite; these pin the two pure
// decisions it makes.

describe('readJobGate — enabled/dryRun matrix', () => {
  it('fails safe when config is missing or malformed', () => {
    expect(readJobGate(undefined)).toEqual({ enabled: false, dryRun: true });
    expect(readJobGate(null)).toEqual({ enabled: false, dryRun: true });
    expect(readJobGate({})).toEqual({ enabled: false, dryRun: true });
  });

  it('only a literal true enables', () => {
    expect(readJobGate({ enabled: true }).enabled).toBe(true);
    // truthy-but-not-true must NOT enable (config typo shouldn't arm a writer)
    expect(readJobGate({ enabled: 1 as unknown as boolean }).enabled).toBe(false);
    expect(readJobGate({ enabled: 'true' as unknown as boolean }).enabled).toBe(false);
  });

  it('only a literal false leaves dry-run', () => {
    expect(readJobGate({ enabled: true, dryRun: false }).dryRun).toBe(false);
    expect(readJobGate({ enabled: true, dryRun: true }).dryRun).toBe(true);
    expect(readJobGate({ enabled: true, dryRun: 0 as unknown as boolean }).dryRun).toBe(true);
    expect(readJobGate({ enabled: true, dryRun: undefined }).dryRun).toBe(true);
  });

  it('live requires both flags set explicitly', () => {
    expect(readJobGate({ enabled: true, dryRun: false })).toEqual({ enabled: true, dryRun: false });
  });
});

describe('shouldLockSpread', () => {
  it('locks an unlocked spread that has a value', () => {
    expect(shouldLockSpread({ spread: { value: -1.5 } as any })).toBe(true);
    expect(shouldLockSpread({ spread: { value: 0 } as any })).toBe(true); // pick'em
  });

  it('skips already-locked spreads (re-run is a no-op)', () => {
    expect(shouldLockSpread({ spread: { value: -3, locked: true } as any })).toBe(false);
  });

  it('skips games with no spread or no value', () => {
    expect(shouldLockSpread(undefined)).toBe(false);
    expect(shouldLockSpread({ spread: undefined })).toBe(false);
    expect(shouldLockSpread({ spread: {} as any })).toBe(false);
    expect(shouldLockSpread({ spread: { value: null } as any })).toBe(false);
  });
});
