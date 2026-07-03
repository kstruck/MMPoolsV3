import { describe, it, expect } from 'vitest';
import * as client from '../src/utils/roles';
import * as server from '../functions/src/lib/roles';

describe('role model parity (client mirror vs functions source of truth)', () => {
  it('CANONICAL_ROLES match', () => {
    expect([...client.CANONICAL_ROLES]).toEqual([...server.CANONICAL_ROLES]);
  });
  it('DEFAULT_ROLE match', () => {
    expect(client.DEFAULT_ROLE).toBe(server.DEFAULT_ROLE);
  });
});

describe('normalizeRole folds legacy values (shared behavior)', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['POOL_MANAGER', 'COMMISSIONER'],
    ['MANAGER', 'COMMISSIONER'],
    ['PARTICIPANT', 'MEMBER'],
    ['USER', 'MEMBER'],
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['MODERATOR', 'MODERATOR'],
    ['COMMISSIONER', 'COMMISSIONER'],
    ['MEMBER', 'MEMBER'],
    ['BANNED', 'BANNED'],
    [undefined, 'MEMBER'],
    [null, 'MEMBER'],
    ['garbage', 'MEMBER'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(client.normalizeRole(input)).toBe(expected);
      expect(server.normalizeRole(input)).toBe(expected);
    });
  }
});

describe('canCreatePools', () => {
  it('COMMISSIONER/MODERATOR/SUPER_ADMIN (and legacy POOL_MANAGER) can; MEMBER/BANNED cannot', () => {
    for (const r of ['COMMISSIONER', 'MODERATOR', 'SUPER_ADMIN', 'POOL_MANAGER']) {
      expect(client.canCreatePools(r)).toBe(true);
      expect(server.canCreatePools(r)).toBe(true);
    }
    for (const r of ['MEMBER', 'PARTICIPANT', 'BANNED', undefined]) {
      expect(client.canCreatePools(r)).toBe(false);
      expect(server.canCreatePools(r)).toBe(false);
    }
  });
});
