import { describe, it, expect } from 'vitest';
import { isPlaceholderName, pickNameOnSync, pickPreferredName } from '@shared/displayName';

describe('pickNameOnSync — registration flips the order once', () => {
  it('at registration the typed name beats a server-pre-created email prefix (codex r2 P1)', () => {
    expect(pickNameOnSync('ron.johnson', 'Ron Johnson', true)).toBe('Ron Johnson');
  });
  it('on an ordinary sign-in the stored name beats Auth', () => {
    expect(pickNameOnSync('Ron Johnson', 'ron.johnson', false)).toBe('Ron Johnson');
    expect(pickNameOnSync('Ron Johnson', 'Old Auth Name', false)).toBe('Ron Johnson');
  });
  it('a placeholder on either side still yields to the real name', () => {
    expect(pickNameOnSync('New User', 'Ron Johnson', false)).toBe('Ron Johnson');
    expect(pickNameOnSync('Ron Johnson', 'Unknown', true)).toBe('Ron Johnson');
  });
});

/**
 * The client's login-time rule (src/services/authService.ts,
 * `syncUserToFirestore` existing-user branch): the STORED profile name is
 * primary, Auth's `displayName` secondary. Before 2026-09-10 every sign-in
 * wrote Auth's name over the profile, so a name fixed on /profile or by a
 * super admin reverted the next time the person logged in.
 */
describe('pickPreferredName — stored profile name vs Auth displayName at sign-in', () => {
  it('keeps a real stored name even when Auth still carries the old one', () => {
    expect(pickPreferredName('Ron Johnson', 'ron.johnson')).toBe('Ron Johnson');
    expect(pickPreferredName('Ron Johnson', 'Old Name')).toBe('Ron Johnson');
  });

  it('lets Auth fill a missing or placeholder stored name', () => {
    expect(pickPreferredName(undefined, 'Ron Johnson')).toBe('Ron Johnson');
    expect(pickPreferredName('New User', 'Ron Johnson')).toBe('Ron Johnson');
    expect(pickPreferredName('Unknown', 'Ron Johnson')).toBe('Ron Johnson');
  });

  it('with two placeholders keeps the stored one; with nothing returns undefined', () => {
    expect(pickPreferredName('New User', 'Unknown User')).toBe('New User');
    expect(pickPreferredName('', '')).toBeUndefined();
    expect(pickPreferredName(null, undefined)).toBeUndefined();
  });

  it('isPlaceholderName covers only what a writer puts on a PROFILE', () => {
    for (const n of ['New User', 'Unknown', 'Unknown User']) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
    expect(isPlaceholderName('Kevin Struck')).toBe(false);
    // Pool-copy fallbacks are legitimate profile names (qodo #690 finding 11).
    for (const n of ['Host', 'Member', 'Participant', 'Player']) {
      expect(isPlaceholderName(n), n).toBe(false);
    }
  });
});
