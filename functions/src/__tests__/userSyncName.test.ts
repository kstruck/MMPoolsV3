import { describe, it, expect } from 'vitest';
import { newUserProfileFields, syncedUserFields } from '../userSync';

/**
 * codex r1 P1 on the display-name PR: with `onUserNameChanged` pushing profile
 * names into every pool, any writer that puts Auth's name back onto the
 * profile would revert a fix site-wide. `syncAllUsers` was that writer.
 */
describe('syncedUserFields — syncAllUsers keeps a real stored name', () => {
  const auth = (over: Record<string, unknown> = {}) => ({
    uid: 'u1', email: 'ron.johnson@example.com', displayName: 'ron.johnson', photoURL: undefined,
    providerData: [{ providerId: 'password' }],
    ...over,
  }) as never;

  it('a real stored name survives; searchName follows it', () => {
    const f = syncedUserFields({ name: 'Ron Johnson' }, auth());
    expect(f.name).toBe('Ron Johnson');
    expect(f.searchName).toBe('ron johnson');
  });

  it('Auth fills a missing or placeholder stored name', () => {
    expect(syncedUserFields(undefined, auth({ displayName: 'Ron Johnson' })).name).toBe('Ron Johnson');
    expect(syncedUserFields({ name: 'New User' }, auth({ displayName: 'Ron Johnson' })).name).toBe('Ron Johnson');
  });

  it('falls back to the email prefix, then "Unknown"', () => {
    expect(syncedUserFields(undefined, auth({ displayName: undefined })).name).toBe('ron.johnson');
    expect(syncedUserFields(undefined, auth({ displayName: undefined, email: undefined })).name).toBe('Unknown');
  });

  it('still carries the other synced fields', () => {
    const f = syncedUserFields({ name: 'Ron Johnson' }, auth());
    expect(f).toMatchObject({ id: 'u1', email: 'ron.johnson@example.com', searchEmail: 'ron.johnson@example.com', registrationMethod: 'email', picture: null });
  });
});

describe('newUserProfileFields — the ONE schema a server-created profile has (2026-09-11 consolidation)', () => {
  const auth = (over: Record<string, unknown> = {}) => ({
    uid: 'u1', email: 'Ron.Johnson@example.com', displayName: undefined, photoURL: undefined,
    providerData: [{ providerId: 'password' }],
    ...over,
  }) as never;

  it('is the userSync shape: id, name, email, search indexes, picture, registrationMethod, provider, role', () => {
    expect(newUserProfileFields(auth())).toEqual({
      id: 'u1',
      name: 'Ron.Johnson',
      email: 'Ron.Johnson@example.com',
      searchEmail: 'ron.johnson@example.com',
      searchName: 'ron.johnson',
      picture: null,
      registrationMethod: 'email',
      provider: 'password',
      role: 'MEMBER',
    });
  });

  it('carries the retired participant.ts fields only where the client reads them (provider), never photoURL', () => {
    const f = newUserProfileFields(auth({ displayName: 'Ron Johnson', photoURL: 'https://x/y.png', providerData: [{ providerId: 'google.com' }] }));
    expect(f.provider).toBe('google.com');
    expect(f.registrationMethod).toBe('google');
    expect(f.picture).toBe('https://x/y.png');
    expect('photoURL' in f).toBe(false);
    expect(f.name).toBe('Ron Johnson');
    expect(f.searchName).toBe('ron johnson');
  });

  it('never writes a "New User" placeholder — email prefix, then "Unknown"', () => {
    expect(newUserProfileFields(auth()).name).toBe('Ron.Johnson');
    expect(newUserProfileFields(auth({ email: undefined })).name).toBe('Unknown');
    expect(newUserProfileFields(auth({ providerData: [] })).provider).toBe('unknown');
  });
});
