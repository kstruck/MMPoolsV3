import { describe, it, expect } from 'vitest';
import { isPlaceholderName, pickPreferredName } from '@shared/displayName';

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

  it('isPlaceholderName covers the fallbacks each writer uses', () => {
    for (const n of ['New User', 'Unknown', 'Unknown User', 'Member', 'Participant', 'Host', 'Player', 'Anonymous']) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
    expect(isPlaceholderName('Kevin Struck')).toBe(false);
  });
});
