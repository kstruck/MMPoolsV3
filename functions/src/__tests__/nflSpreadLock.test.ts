import { describe, it, expect } from 'vitest';
import { readJobGate } from '../nflSchedule';

// PLAN-NFL-PRESEASON-PILOT A2: lockNFLSpreadsJob gained the house kill-switch +
// dry-run gate (system/config.nflSpreadLock) before being exported from index.ts.
// The gate outlived the job body: PLAN-NFL-SPREAD-FREEZE replaced the flag-flip
// with a fetch-and-freeze pass, which reads the SAME config key so the armed
// production config carries over. `shouldLockSpread` went with the old body and
// its cases moved to `spreadFreeze.test.ts` (`planFreeze`), which is where the
// "does this game have a usable line" decision now lives.

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
