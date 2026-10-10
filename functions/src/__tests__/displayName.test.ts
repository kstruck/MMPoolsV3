import { describe, it, expect } from 'vitest';
import { isPlaceholderName, pickSubjectName, stalePlayoffEntryIds, userNameChanged } from '../lib/displayName';

/**
 * The pure half of display-name ownership (lib/displayName.ts). The Firestore
 * half — propagation, create-if-missing — is in
 * __tests__/emulator/userNameSync.emulator.test.ts.
 */
describe('isPlaceholderName', () => {
  it('treats every value a writer puts on users/{uid}.name as a placeholder, case-insensitively', () => {
    for (const n of ['New User', 'new user', 'Unknown', 'Unknown User', '', '   ']) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(isPlaceholderName(42)).toBe(true);
  });

  it('accepts a real name — including ones that happen to equal a POOL-COPY fallback (qodo #690 finding 11)', () => {
    expect(isPlaceholderName('Zach Even')).toBe(false);
    expect(isPlaceholderName('kevin')).toBe(false);
    // "Host" / "Member" / "Participant" / "Player" are stamped on pool copies,
    // never on a profile, so a person actually named one of them keeps it.
    for (const n of ['Host', 'Member', 'Participant', 'Player', 'Anonymous']) {
      expect(isPlaceholderName(n), n).toBe(false);
    }
  });
});

describe('pickSubjectName — profile first, token second', () => {
  it('a real profile name wins over a real token name', () => {
    expect(pickSubjectName('Fixed Name', 'Old Token Name')).toBe('Fixed Name');
  });
  it('a placeholder profile yields to a real token name', () => {
    expect(pickSubjectName('New User', 'Typed Name')).toBe('Typed Name');
    expect(pickSubjectName(undefined, 'Typed Name')).toBe('Typed Name');
  });
  it('two placeholders return the profile one (non-empty first)', () => {
    expect(pickSubjectName('New User', 'Unknown')).toBe('New User');
    expect(pickSubjectName('', 'Unknown')).toBe('Unknown');
  });
  it('nothing usable returns undefined so a caller keeps the stored name', () => {
    expect(pickSubjectName(undefined, undefined)).toBeUndefined();
    expect(pickSubjectName('  ', null)).toBeUndefined();
  });
  it('trims', () => {
    expect(pickSubjectName('  Bri Johnson ', undefined)).toBe('Bri Johnson');
  });
});

describe('userNameChanged — the users/{uid} trigger gate', () => {
  it('returns the new name when name changed on an update', () => {
    expect(userNameChanged({ name: 'New User' }, { name: 'Ron Johnson' })).toBe('Ron Johnson');
  });
  it('a CREATE propagates — a recreated profile may already have pool copies (qodo #690 finding 9)', () => {
    expect(userNameChanged(undefined, { name: 'Ron Johnson' })).toBe('Ron Johnson');
    expect(userNameChanged(undefined, { name: '' })).toBeNull();
    expect(userNameChanged(undefined, {})).toBeNull();
  });
  it('ignores deletes — account deletion has its own path', () => {
    expect(userNameChanged({ name: 'Ron Johnson' }, undefined)).toBeNull();
  });
  it('ignores writes that did not touch the name (lastLogin stamps on every sign-in)', () => {
    expect(userNameChanged({ name: 'Ron', lastLogin: 1 }, { name: 'Ron', lastLogin: 2 })).toBeNull();
    expect(userNameChanged({ name: ' Ron ' }, { name: 'Ron' })).toBeNull();
  });
  it('ignores a change to an empty name', () => {
    expect(userNameChanged({ name: 'Ron' }, { name: '' })).toBeNull();
    expect(userNameChanged({ name: 'Ron' }, {})).toBeNull();
  });
  it('a change TO a placeholder still propagates — the copies must equal the profile', () => {
    expect(userNameChanged({ name: 'Ron' }, { name: 'Unknown' })).toBe('Unknown');
  });
});

describe('stalePlayoffEntryIds — the NFL-playoff entries MAP on the pool document (qodo #690 finding 1)', () => {
  const pool = {
    name: 'Playoffs', type: 'NFL_PLAYOFF', participantIds: ['u1', 'u2'],
    entries: {
      'u1_1': { id: 'u1_1', userId: 'u1', userName: 'New User', entryName: 'New User', totalScore: 7 },
      'u1_2': { id: 'u1_2', userId: 'u1', userName: 'Ron Johnson', entryName: 'Already right' },
      'u1_3': { id: 'u1_3', userId: 'u1', entryName: 'No userName at all' },
      'u2_1': { id: 'u2_1', userId: 'u2', userName: 'New User' },
      'junk': 'not an entry',
      'nul': null,
    },
  };

  it('returns only this uid’s entries whose userName is a string that differs', () => {
    expect(stalePlayoffEntryIds(pool, 'u1', 'Ron Johnson')).toEqual(['u1_1']);
    expect(stalePlayoffEntryIds(pool, 'u2', 'Ron Johnson')).toEqual(['u2_1']);
  });

  it('is empty when every copy already matches, or the uid owns nothing here', () => {
    expect(stalePlayoffEntryIds(pool, 'u2', 'New User')).toEqual([]);
    expect(stalePlayoffEntryIds(pool, 'u3', 'Anyone')).toEqual([]);
  });

  it('is empty for a pool with no map, a non-object map, an array, or no data at all', () => {
    expect(stalePlayoffEntryIds({ type: 'NFL_PICKEM' }, 'u1', 'Ron Johnson')).toEqual([]);
    expect(stalePlayoffEntryIds({ entries: 'oops' }, 'u1', 'Ron Johnson')).toEqual([]);
    expect(stalePlayoffEntryIds({ entries: [{ userId: 'u1', userName: 'x' }] }, 'u1', 'Ron Johnson')).toEqual([]);
    expect(stalePlayoffEntryIds(undefined, 'u1', 'Ron Johnson')).toEqual([]);
    expect(stalePlayoffEntryIds(null, 'u1', 'Ron Johnson')).toEqual([]);
  });

  it('keeps the entry id verbatim — ids are caller-supplied and may contain dots', () => {
    expect(stalePlayoffEntryIds({ entries: { 'my.entry': { userId: 'u1', userName: 'Old' } } }, 'u1', 'New')).toEqual(['my.entry']);
  });
});
