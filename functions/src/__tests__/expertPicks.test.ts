import { describe, it, expect } from 'vitest';
import { vegasPickFromSpread, parseFpiPredictor } from '../expertPicks';

// Real shape captured from ESPN's FPI predictor endpoint (2024 wk1 DAL@PHI):
// homeTeam = Eagles (id 21), awayTeam = Cowboys (id 6).
const FIXTURE = {
  homeTeam: {
    team: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/21?lang=en' },
    statistics: [
      { name: 'gameProjection', displayValue: '67.5' },
      { name: 'teamPredPtDiff', displayValue: '7.6' },
    ],
  },
  awayTeam: {
    team: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/6?lang=en' },
    statistics: [
      { name: 'gameProjection', displayValue: '32.3' },
      { name: 'teamPredPtDiff', displayValue: '-7.6' },
    ],
  },
};

describe('vegasPickFromSpread', () => {
  it('negative spread => HOME favored', () => {
    expect(vegasPickFromSpread(-3.5)).toEqual({ pick: 'HOME', spread: -3.5 });
  });
  it('positive spread => AWAY favored', () => {
    expect(vegasPickFromSpread(3)).toEqual({ pick: 'AWAY', spread: 3 });
  });
  it('zero => EVEN (pick\'em)', () => {
    expect(vegasPickFromSpread(0)).toEqual({ pick: 'EVEN', spread: 0 });
  });
  it('no line => null', () => {
    expect(vegasPickFromSpread(null)).toBeNull();
    expect(vegasPickFromSpread(undefined)).toBeNull();
    expect(vegasPickFromSpread(NaN)).toBeNull();
  });
});

describe('parseFpiPredictor', () => {
  it('orients to our home team and picks the favorite', () => {
    // Eagles (21) are our home
    expect(parseFpiPredictor(FIXTURE, '21', '6')).toEqual({
      pick: 'HOME', homeWinPct: 68, awayWinPct: 32, predMargin: 7.6,
    });
  });

  it('re-orients when our home is the endpoint\'s away side', () => {
    // Pretend Cowboys (6) are our home — must flip so home reflects Cowboys' projection
    expect(parseFpiPredictor(FIXTURE, '6', '21')).toEqual({
      pick: 'AWAY', homeWinPct: 32, awayWinPct: 68, predMargin: -7.6,
    });
  });

  it('falls back to endpoint ordering when team ids are unknown', () => {
    expect(parseFpiPredictor(FIXTURE)).toEqual({
      pick: 'HOME', homeWinPct: 68, awayWinPct: 32, predMargin: 7.6,
    });
  });

  it('returns null when no projection is present', () => {
    const empty = { homeTeam: { team: { $ref: '/teams/21' }, statistics: [] }, awayTeam: { team: { $ref: '/teams/6' }, statistics: [] } };
    expect(parseFpiPredictor(empty, '21', '6')).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(parseFpiPredictor({}, '21', '6')).toBeNull();
    expect(parseFpiPredictor(null as any)).toBeNull();
  });
});
