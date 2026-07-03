import { describe, it, expect } from 'vitest';
import {
  getPoolSport,
  getLeagueDisplayName,
  getPoolLifecycleState,
} from '../src/utils/poolSport';

describe('getPoolSport', () => {
  it('buckets NFL season pools (pickem/survivor/margin) as NFL Football — the bug T4 fixes', () => {
    // These used to fall through to getLeagueDisplayName(undefined) => "Other".
    expect(getPoolSport({ type: 'NFL_PICKEM' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'NFL_SURVIVOR' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'NFL_MARGIN' })).toBe('NFL Football');
  });

  it('classifies the other pool types', () => {
    expect(getPoolSport({ type: 'BRACKET' })).toBe('March Madness');
    expect(getPoolSport({ type: 'NFL_PLAYOFFS' })).toBe('NFL Playoffs');
    expect(getPoolSport({ type: 'PROPS' })).toBe('Props Pool');
    expect(getPoolSport({ type: 'SQUARES', league: 'nfl' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'SQUARES', league: 'college' })).toBe('NCAA Football');
    expect(getPoolSport({ type: 'SQUARES', league: undefined })).toBe('Other');
  });

  it('getLeagueDisplayName maps league codes', () => {
    expect(getLeagueDisplayName('nfl')).toBe('NFL Football');
    expect(getLeagueDisplayName('college')).toBe('NCAA Football');
    expect(getLeagueDisplayName('ncaa')).toBe('NCAA Football');
    expect(getLeagueDisplayName(undefined)).toBe('Other');
  });
});

describe('getPoolLifecycleState', () => {
  it('reads SQUARES state from gameStatus/isLocked', () => {
    expect(getPoolLifecycleState({ type: 'SQUARES', scores: { gameStatus: 'post' } })).toBe('final');
    expect(getPoolLifecycleState({ type: 'SQUARES', scores: { gameStatus: 'in' } })).toBe('live');
    expect(getPoolLifecycleState({ type: 'SQUARES', isLocked: true })).toBe('locked');
    expect(getPoolLifecycleState({ type: 'SQUARES', isLocked: false })).toBe('open');
  });

  it('reads string-status types (NFL season, bracket, playoff, props) from status', () => {
    expect(getPoolLifecycleState({ type: 'NFL_PICKEM', status: 'OPEN' })).toBe('open');
    expect(getPoolLifecycleState({ type: 'NFL_PICKEM', status: 'COMPLETED' })).toBe('final');
    expect(getPoolLifecycleState({ type: 'BRACKET', status: 'LOCKED' })).toBe('locked');
    expect(getPoolLifecycleState({ type: 'BRACKET', status: 'LIVE' })).toBe('live');
    // T2 dual-writes isFinal on admin close — reader honors it immediately.
    expect(getPoolLifecycleState({ type: 'NFL_MARGIN', isFinal: true })).toBe('final');
  });

  it('defaults a freshly-created NFL pool (status OPEN, no terminal transition yet) to open', () => {
    expect(getPoolLifecycleState({ type: 'NFL_SURVIVOR', status: 'OPEN' })).toBe('open');
  });
});
