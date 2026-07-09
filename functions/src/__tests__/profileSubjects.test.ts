import { describe, it, expect } from 'vitest';
import {
  EXPERT_SUBJECT_PREFIX,
  EXPERT_SUBJECT_IDS,
  isExpertSubjectId,
  isReservedSubjectId,
  PROFILE_SCHEMA_VERSION,
  TEAM_RANK_MIN_PICKS,
  PICK_HISTORY_CAP,
} from '../shared/profile';
import { ACHIEVEMENT_SCHEMA_VERSION, type Achievement } from '../shared/achievements';

// Phase 1 acceptance (PLAN-PLAYER-PROFILES.md): prove the reserved expert-id namespace cannot
// collide with a Firebase Auth uid. Standard signup auto-generates 28-char alphanumeric uids;
// this repo never mints custom uids via the Admin SDK. The separator '_' is outside the
// auto-uid alphabet, so `expert_*` can never equal an auto-generated uid.
const FIREBASE_AUTO_UID = /^[A-Za-z0-9]{28}$/;

describe('expert subject ids (ADR 0005)', () => {
  it('every reserved expert id starts with the expert prefix', () => {
    for (const id of Object.values(EXPERT_SUBJECT_IDS)) {
      expect(id.startsWith(EXPERT_SUBJECT_PREFIX)).toBe(true);
      expect(isExpertSubjectId(id)).toBe(true);
      expect(isReservedSubjectId(id)).toBe(true);
    }
  });

  it('the prefix contains a character outside the Firebase auto-uid alphabet', () => {
    // The collision proof: auto uids match /^[A-Za-z0-9]{28}$/, so any id containing '_'
    // cannot be one. If the prefix ever loses its '_', this test fails and the namespace
    // must be re-proven.
    expect(EXPERT_SUBJECT_PREFIX).toContain('_');
    for (const id of Object.values(EXPERT_SUBJECT_IDS)) {
      expect(FIREBASE_AUTO_UID.test(id)).toBe(false);
    }
  });

  it('a realistic auto-generated uid is never classified as reserved', () => {
    const sampleAutoUids = [
      'Kx9mTqA3vLpRz2WdY8cN4bJfH6gE', // shape of a real auto uid
      'a'.repeat(28),
      'A1b2C3d4E5f6G7h8I9j0K1l2M3n4',
    ];
    for (const uid of sampleAutoUids) {
      expect(FIREBASE_AUTO_UID.test(uid)).toBe(true);
      expect(isReservedSubjectId(uid)).toBe(false);
    }
  });

  it('exports stable contract constants', () => {
    expect(PROFILE_SCHEMA_VERSION).toBe(1);
    expect(TEAM_RANK_MIN_PICKS).toBe(3);
    expect(PICK_HISTORY_CAP).toBe(200);
    expect(ACHIEVEMENT_SCHEMA_VERSION).toBe(1);
  });
});

describe('achievement contract leak rule (ADR 0005 decision 5)', () => {
  it('the Achievement shape carries no pool identifier fields', () => {
    // Compile-time: `poolId` is not part of the Achievement type (a cast would be needed).
    // Runtime guard for reviewers: a well-formed sample has no pool-identifying keys.
    const sample: Achievement = {
      code: 'PERFECT_WEEK',
      title: 'Perfect Week',
      description: 'Went 16-0 in a scored week',
      iconKey: 'trophy',
      tier: 'GOLD',
      earnedAt: 1_760_000_000_000,
      season: '2026',
      meta: { week: 7 },
      schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    };
    const forbidden = ['poolId', 'poolName', 'slug'];
    for (const key of forbidden) {
      expect(Object.keys(sample)).not.toContain(key);
      expect(Object.keys(sample.meta ?? {})).not.toContain(key);
    }
  });
});
