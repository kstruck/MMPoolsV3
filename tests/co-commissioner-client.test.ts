/**
 * PLAN-CO-COMMISSIONERS T5 / D3 — the CLIENT half of "one definition per layer".
 *
 * 1. `isNFLPoolCommissioner` admits a named co-manager on the three NFL types
 *    ONLY, and the strict helpers (`isPoolOwner` / `isPoolManager` /
 *    `canManageEntries`) do NOT — Bracket/Playoff/Squares surfaces read them.
 * 2. The Commissioner Hub query shape is load-bearing (D7, measured on #446):
 *    a LIST rule is proved from the QUERY, so `array-contains` alone is denied.
 *    Pin that `dbService` sends the type filter alongside it.
 * 3. `PoolRoute` widens `isManager` ONLY on the NFL branch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isNFLPoolCommissioner, isNamedNFLCoCommissioner, isPoolOwner, isPoolManager, canManageEntries, poolCoManagers } from '../src/utils/auth';
import type { User } from '../src/types';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const owner = { id: 'owner', role: 'COMMISSIONER' } as User;
const co = { id: 'co', role: 'MEMBER' } as User;
const other = { id: 'other', role: 'MEMBER' } as User;
const sa = { id: 'sa', role: 'SUPER_ADMIN' } as User;

const nfl = { ownerId: 'owner', managerUid: 'owner', type: 'NFL_PICKEM', coManagers: ['co'] };

describe('isNFLPoolCommissioner (D3 — the ONE widened client predicate)', () => {
  it('admits owner, manager, super admin and a named co-manager on an NFL pool', () => {
    expect(isNFLPoolCommissioner(owner, nfl)).toBe(true);
    expect(isNFLPoolCommissioner(sa, nfl)).toBe(true);
    expect(isNFLPoolCommissioner(co, nfl)).toBe(true);
    expect(isNFLPoolCommissioner(other, nfl)).toBe(false);
    expect(isNFLPoolCommissioner(null, nfl)).toBe(false);
  });

  it.each(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])('admits a co-manager on %s', (type) => {
    expect(isNFLPoolCommissioner(co, { ...nfl, type })).toBe(true);
  });

  it.each(['SQUARES', 'BRACKET', 'NFL_PLAYOFFS', 'PROPS', undefined])('refuses the same uid in coManagers on %s (C13)', (type) => {
    expect(isNFLPoolCommissioner(co, { ...nfl, type })).toBe(false);
  });

  it('tolerates a missing or malformed coManagers field (it was client-writable before the lock)', () => {
    expect(isNFLPoolCommissioner(co, { ...nfl, coManagers: undefined })).toBe(false);
    expect(isNFLPoolCommissioner(co, { ...nfl, coManagers: 'co' as unknown as string[] })).toBe(false);
    expect(poolCoManagers({ coManagers: ['a', 7, null, 'b'] })).toEqual(['a', 'b']);
    expect(poolCoManagers(null)).toEqual([]);
  });

  it('isNamedNFLCoCommissioner is membership in coManagers ONLY — no owner, manager or SUPER_ADMIN implication (the Hub keys on it)', () => {
    expect(isNamedNFLCoCommissioner(co, nfl)).toBe(true);
    expect(isNamedNFLCoCommissioner(owner, nfl)).toBe(false);
    expect(isNamedNFLCoCommissioner(sa, nfl)).toBe(false);
    expect(isNamedNFLCoCommissioner(co, { ...nfl, type: 'SQUARES' })).toBe(false);
  });

  it('the Hub filters on owner OR named co-commissioner, never the SUPER_ADMIN-admitting helper', () => {
    const src = read('src/components/ParticipantDashboard.tsx');
    expect(src).not.toMatch(/isNFLPoolCommissioner/);
    expect((src.match(/isPoolOwner\(user, p\) \|\| isNamedNFLCoCommissioner\(user, p\)/g) ?? []).length).toBe(3);
  });

  it('leaves the strict helpers strict — a co-manager is NOT an owner/manager/entry-manager', () => {
    expect(isPoolOwner(co, nfl)).toBe(false);
    expect(isPoolManager(co, nfl)).toBe(false);
    expect(canManageEntries(co, nfl)).toBe(false);
  });
});

describe('source pins', () => {
  it('the Hub query carries the NFL type filter next to array-contains (D7 — array-contains alone is DENIED by rules)', () => {
    const src = read('src/services/dbService.ts');
    const i = src.indexOf('subscribeToCoCommissionedPools');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 900);
    expect(body).toMatch(/where\("coManagers",\s*"array-contains",\s*userId\)/);
    expect(body).toMatch(/where\("type",\s*"in",\s*\["NFL_PICKEM",\s*"NFL_SURVIVOR",\s*"NFL_MARGIN"\]\)/);
  });

  it('the Hub feed has its composite index (array-contains + type) — this repo has shipped two silently missing indexes', () => {
    const idx = JSON.parse(read('firestore.indexes.json')).indexes as { collectionGroup: string; queryScope: string; fields: { fieldPath: string; arrayConfig?: string; order?: string }[] }[];
    const hit = idx.find(i => i.collectionGroup === 'pools' && i.queryScope === 'COLLECTION'
      && i.fields[0]?.fieldPath === 'coManagers' && i.fields[0]?.arrayConfig === 'CONTAINS'
      && i.fields[1]?.fieldPath === 'type');
    expect(hit).toBeTruthy();
  });

  it('PoolRoute widens isManager on the NFL branch only', () => {
    const src = read('src/components/routes/PoolRoute.tsx');
    const nflStart = src.indexOf("if (pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {");
    expect(nflStart).toBeGreaterThan(-1);
    const before = src.slice(0, nflStart);
    const nflBranch = src.slice(nflStart, src.indexOf('<NFLPoolDashboard') + 400);
    // Every JSX use before the NFL branch is the strict value; the NFL branch uses the widened one.
    expect(before).not.toMatch(/isManager=\{nflIsManager\}/);
    expect((nflBranch.match(/isManager=\{nflIsManager\}/g) ?? []).length).toBe(2);
    expect(nflBranch).not.toMatch(/isManager=\{isManager\}/);
  });

  it('the members-tab toggle is gated on STRICT isPoolManager (owner/managerUid/SA, never coManagers) and sends ONE uid per call (D6/C10)', () => {
    const src = read('src/components/NFLPoolDashboard/NFLManagerView.tsx');
    expect(src).toMatch(/const viewerIsOwner = isPoolManager\(user, pool\)/);
    expect(src).not.toMatch(/const viewerIsOwner = isNFLPoolCommissioner/);
    expect(src).toMatch(/dbService\.setPoolCoCommissioner\(/);
    expect(src).not.toMatch(/coManagers:\s*\[/); // never a full-array write from the client
  });
});
