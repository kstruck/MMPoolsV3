import { describe, it, expect } from 'vitest';
import { syncedUserFields } from '../userSync';
import { isMissingIndexError } from '../userNameSync';

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

describe('isMissingIndexError — the one failure the trigger must NOT retry', () => {
  it('matches gRPC FAILED_PRECONDITION and the "requires an index" message', () => {
    expect(isMissingIndexError({ code: 9, message: 'The query requires an index.' })).toBe(true);
    expect(isMissingIndexError({ message: 'FAILED_PRECONDITION: The query requires an index. You can create it here: https://...' })).toBe(true);
  });
  it('lets everything else through to the retry path', () => {
    expect(isMissingIndexError({ code: 14, message: 'UNAVAILABLE' })).toBe(false);
    expect(isMissingIndexError(new Error('socket hang up'))).toBe(false);
    expect(isMissingIndexError(null)).toBe(false);
  });
});
