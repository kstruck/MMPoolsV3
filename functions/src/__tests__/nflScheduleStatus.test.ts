import { describe, it, expect } from 'vitest';
import { mapEspnGameStatus } from '../nflSchedule';

describe('mapEspnGameStatus', () => {
  it('maps pre/in/post states', () => {
    expect(mapEspnGameStatus('pre', 'STATUS_SCHEDULED')).toBe('SCHEDULED');
    expect(mapEspnGameStatus('in', 'STATUS_IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(mapEspnGameStatus('post', 'STATUS_FINAL')).toBe('FINAL');
  });

  it('maps canceled/forfeit to CANCELLED even when ESPN state is post (would score 0-0)', () => {
    expect(mapEspnGameStatus('post', 'STATUS_CANCELED')).toBe('CANCELLED');
    expect(mapEspnGameStatus('pre', 'STATUS_CANCELLED')).toBe('CANCELLED');
    expect(mapEspnGameStatus('post', 'STATUS_FORFEIT')).toBe('CANCELLED');
  });

  it('keeps postponed/suspended/delayed as SCHEDULED so they do not score', () => {
    expect(mapEspnGameStatus('pre', 'STATUS_POSTPONED')).toBe('SCHEDULED');
    expect(mapEspnGameStatus('in', 'STATUS_SUSPENDED')).toBe('SCHEDULED');
    expect(mapEspnGameStatus('pre', 'STATUS_DELAYED')).toBe('SCHEDULED');
  });

  it('defaults unknown to SCHEDULED', () => {
    expect(mapEspnGameStatus(undefined, undefined)).toBe('SCHEDULED');
    expect(mapEspnGameStatus('weird', 'STATUS_UNKNOWN')).toBe('SCHEDULED');
  });
});
