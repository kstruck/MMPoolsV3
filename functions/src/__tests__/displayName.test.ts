import { describe, it, expect } from 'vitest';
import { isPlaceholderName, pickSubjectName, userNameChanged } from '../lib/displayName';

/**
 * The pure half of display-name ownership (lib/displayName.ts). The Firestore
 * half — propagation, create-if-missing — is in
 * __tests__/emulator/userNameSync.emulator.test.ts.
 */
describe('isPlaceholderName', () => {
  it('treats every server/client fallback as a placeholder, case-insensitively', () => {
    for (const n of ['New User', 'new user', 'Unknown', 'Unknown User', 'Member', 'Participant', 'Host', 'Player', 'Anonymous', '', '   ']) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(isPlaceholderName(42)).toBe(true);
  });

  it('accepts a real name', () => {
    expect(isPlaceholderName('Zach Even')).toBe(false);
    expect(isPlaceholderName('kevin')).toBe(false);
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
  it('ignores creates and deletes — no pool copies can exist / deletion has its own path', () => {
    expect(userNameChanged(undefined, { name: 'Ron Johnson' })).toBeNull();
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
