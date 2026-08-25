import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    ATTEMPT_MAX_FAILURES,
    ATTEMPT_WINDOW_MS,
    MAX_POOL_PASSWORD_LENGTH,
    attemptKey,
    evaluateAttempt,
    hasSecret,
    hashPoolPassword,
    isPbkdf2,
    safeEqual,
    verifyPoolPassword,
} from '../lib/poolPassword';
import { legacyHashOf, legacyPlaintextOf, publishPasswordPlan } from '../lib/poolAccess';
import { planForPool } from '../migrations/migratePoolPasswords';
import { createPoolPermissiveSchema, updatePoolSettingsSchema, stripPoolPasswordFields } from '../schemas/poolCore';
import { setPoolPasswordSchema, migratePoolPasswordsSchema, verifyPoolAccessSchema } from '../schemas/poolPassword';

/**
 * PLAN-AUDIT-AUTH-HARDENING Phase B (NEXT-SESSION-AUDIT-FIXES items 1, 13a-c).
 *
 * The invariant the whole phase rests on: a pool password is never READABLE
 * from anything a client can fetch. These tests cover the half that is pure
 * logic — the crypto, the legacy-format acceptance, the throttle, the create
 * choke point and the migration planner. The rules half (that
 * `pools/{id}/private/access` is closed and the public fields cannot be written)
 * is `functions/scripts/poolPrivateAccess.rules.test.mjs`, because only the
 * emulator can answer it.
 */

describe('pool password hashing', () => {
    it('round-trips a PBKDF2 record', () => {
        const stored = hashPoolPassword('hunter2');
        expect(isPbkdf2(stored)).toBe(true);
        expect(verifyPoolPassword('hunter2', { hash: stored })).toEqual({
            ok: true, matched: 'pbkdf2', needsRehash: false,
        });
        expect(verifyPoolPassword('hunter3', { hash: stored }).ok).toBe(false);
    });

    it('salts, so the same password hashes differently every time', () => {
        expect(hashPoolPassword('same')).not.toBe(hashPoolPassword('same'));
    });

    it('is format-compatible with the pre-existing publishBracketPool hashes', () => {
        // The exact derivation bracketPools.ts used before this phase. Existing
        // `passwordHash` values are MOVED, not re-derived, so if these
        // parameters ever drift every legacy bracket pool locks its members out.
        const salt = crypto.randomBytes(16).toString('hex');
        const legacy = `${salt}:${crypto.pbkdf2Sync('legacy-pw', salt, 10000, 64, 'sha512').toString('hex')}`;
        expect(verifyPoolPassword('legacy-pw', { hash: legacy })).toEqual({
            ok: true, matched: 'pbkdf2', needsRehash: false,
        });
    });

    it('refuses to hash an empty or oversize password', () => {
        expect(() => hashPoolPassword('')).toThrow();
        expect(() => hashPoolPassword('x'.repeat(MAX_POOL_PASSWORD_LENGTH + 1))).toThrow();
    });

    it('safeEqual does not throw on a length mismatch', () => {
        // crypto.timingSafeEqual throws when the buffers differ in length; an
        // escaping throw would be a length oracle AND a 500.
        expect(() => safeEqual('a', 'abcdef')).not.toThrow();
        expect(safeEqual('a', 'abcdef')).toBe(false);
        expect(safeEqual('abc', 'abc')).toBe(true);
    });

    it('rejects an oversize candidate BEFORE doing any KDF work', () => {
        const stored = hashPoolPassword('short');
        const started = Date.now();
        expect(verifyPoolPassword('x'.repeat(50_000), { hash: stored }).ok).toBe(false);
        // Not a timing assertion, just proof the early return exists: 10k
        // PBKDF2-SHA512 rounds over a 50KB input is not a sub-second operation.
        expect(Date.now() - started).toBeLessThan(1000);
    });
});

describe('legacy formats (item 13c)', () => {
    it('accepts a legacy unsalted SHA-256 hash and asks for a rehash', () => {
        const legacy = crypto.createHash('sha256').update('old').digest('hex');
        expect(verifyPoolPassword('old', { hash: legacy })).toEqual({
            ok: true, matched: 'sha256', needsRehash: true,
        });
        expect(verifyPoolPassword('nope', { hash: legacy }).ok).toBe(false);
    });

    it('accepts legacy PLAINTEXT still sitting on the public doc, and asks for a rehash', () => {
        expect(verifyPoolPassword('plain', { plaintext: 'plain' })).toEqual({
            ok: true, matched: 'plaintext', needsRehash: true,
        });
        expect(verifyPoolPassword('other', { plaintext: 'plain' }).ok).toBe(false);
    });

    it('PREFERS the private hash over stale plaintext left on the public doc', () => {
        // A pool mid-migration holds both. Honouring the plaintext would keep
        // accepting a password the commissioner has already changed.
        const stored = { hash: hashPoolPassword('new-password'), plaintext: 'old-password' };
        expect(verifyPoolPassword('new-password', stored).ok).toBe(true);
        expect(verifyPoolPassword('old-password', stored).ok).toBe(false);
    });

    it('reads the legacy fields off a pool document in the documented order', () => {
        expect(legacyPlaintextOf({ gridPassword: 'g' })).toBe('g');
        expect(legacyPlaintextOf({ accessControl: { password: 'a' } })).toBe('a');
        expect(legacyPlaintextOf({ gridPassword: 'g', accessControl: { password: 'a' } })).toBe('g');
        expect(legacyPlaintextOf({ gridPassword: '' })).toBeNull();
        expect(legacyPlaintextOf({})).toBeNull();
        expect(legacyPlaintextOf(undefined)).toBeNull();
        expect(legacyHashOf({ passwordHash: 'h' })).toBe('h');
        expect(legacyHashOf({})).toBeNull();
    });

    it('an empty stored secret never verifies, whatever is supplied', () => {
        expect(hasSecret({})).toBe(false);
        expect(hasSecret({ hash: '', plaintext: '' })).toBe(false);
        expect(hasSecret({ plaintext: 'x' })).toBe(true);
        expect(verifyPoolPassword('', { hash: hashPoolPassword('x') }).ok).toBe(false);
        expect(verifyPoolPassword('anything', {}).ok).toBe(false);
        expect(verifyPoolPassword('anything', null).ok).toBe(false);
    });
});

describe('verify throttle', () => {
    const now = 1_700_000_000_000;

    it('allows the first attempt and starts a window', () => {
        const d = evaluateAttempt(null, now);
        expect(d.allowed).toBe(true);
        expect(d.next).toEqual({ failures: 1, windowStartedAt: now });
    });

    it('counts up to the cap, then refuses', () => {
        const at = (failures: number) => evaluateAttempt({ failures, windowStartedAt: now }, now + 1000);
        expect(at(ATTEMPT_MAX_FAILURES - 1).allowed).toBe(true);
        expect(at(ATTEMPT_MAX_FAILURES).allowed).toBe(false);
        expect(at(ATTEMPT_MAX_FAILURES).retryAfterMs).toBeGreaterThan(0);
    });

    it('rolls the window over instead of banning permanently', () => {
        const stale = { failures: 99, windowStartedAt: now };
        const d = evaluateAttempt(stale, now + ATTEMPT_WINDOW_MS + 1);
        expect(d.allowed).toBe(true);
        expect(d.next).toEqual({ failures: 1, windowStartedAt: now + ATTEMPT_WINDOW_MS + 1 });
    });

    it('keys per (pool, principal) so one attacker cannot lock a pool for everyone', () => {
        expect(attemptKey('poolA', 'uid1')).not.toBe(attemptKey('poolA', 'uid2'));
        expect(attemptKey('poolA', 'uid1')).not.toBe(attemptKey('poolB', 'uid1'));
        expect(attemptKey('poolA', 'uid1')).toBe(attemptKey('poolA', 'uid1'));
        // No raw uid / IP in the document id.
        expect(attemptKey('poolA', '203.0.113.7')).not.toContain('203.0.113.7');
    });

    it('does not collide when a pool id contains the separator character', () => {
        // A Firestore document id MAY contain a space, so a space separator
        // would put ("pool a", "b") and ("pool", "a b") in the same throttle
        // bucket — two principals sharing one cap. The key uses NUL, which an id
        // cannot contain.
        expect(attemptKey('pool a', 'b')).not.toBe(attemptKey('pool', 'a b'));
        expect(attemptKey('a', 'b c')).not.toBe(attemptKey('a b', 'c'));
    });
});

describe('create choke point (item 13b)', () => {
    it('strips every password field out of the permissive create envelope', () => {
        const parsed = createPoolPermissiveSchema.parse({
            name: 'My Pool',
            gridPassword: 'secret',
            passwordHash: 'attacker-chosen',
            hasPoolPassword: true,
            accessControl: { password: 'secret', requireEmail: true },
        });
        expect(parsed).toEqual({ name: 'My Pool', accessControl: { requireEmail: true } });
    });

    it('strips the DOTTED form too (codex r3 P1 — this was a live bypass)', () => {
        // The create handlers spread the parsed payload into the pool doc with
        // `set()`, and `set()` treats an object key as a LITERAL field name —
        // dots included. So this key landed on the world-readable document as a
        // top-level field named `accessControl.password`, past a strip that only
        // looked at the nested shape. It is also exactly the form the old
        // bracket dashboard used.
        expect(createPoolPermissiveSchema.parse({
            name: 'P', 'accessControl.password': 'secret',
        })).toEqual({ name: 'P' });
        expect(updatePoolSettingsSchema.parse({
            poolId: 'p1', updates: { 'accessControl.password': 'secret', name: 'P' },
        }).updates).toEqual({ name: 'P' });
    });

    it('a pool carrying the dotted field is still read, and still planned for', () => {
        // Belt and braces: the strip stops NEW ones, these two stop an existing
        // one being silently walked past.
        expect(legacyPlaintextOf({ 'accessControl.password': 'old' })).toBe('old');
        expect(planForPool('p1', { 'accessControl.password': 'old' }, false))
            .toEqual({ poolId: 'p1', action: 'hash-plaintext' });
        // …and it ranks BELOW the two normal shapes.
        expect(legacyPlaintextOf({ gridPassword: 'g', 'accessControl.password': 'd' })).toBe('g');
        expect(legacyPlaintextOf({ accessControl: { password: 'a' }, 'accessControl.password': 'd' })).toBe('a');
    });

    it('leaves a payload with no password fields untouched', () => {
        const input = { name: 'Plain', type: 'SQUARES', accessControl: { requireEmail: false } };
        expect(createPoolPermissiveSchema.parse(input)).toEqual(input);
    });

    it('strips the same fields from updatePoolSettings.updates', () => {
        const parsed = updatePoolSettingsSchema.parse({
            poolId: 'p1',
            updates: { gridPassword: 'secret', 'settings.entryFee': 20 },
        });
        expect(parsed.updates).toEqual({ 'settings.entryFee': 20 });
    });

    it('does not mutate its input', () => {
        const input: Record<string, unknown> = { gridPassword: 'secret', accessControl: { password: 'p' } };
        stripPoolPasswordFields(input);
        expect(input.gridPassword).toBe('secret');
        expect((input.accessControl as Record<string, unknown>).password).toBe('p');
    });

    it('survives an accessControl that is not an object', () => {
        expect(stripPoolPasswordFields({ accessControl: 'nope' })).toEqual({ accessControl: 'nope' });
        expect(stripPoolPasswordFields({ accessControl: null })).toEqual({ accessControl: null });
        expect(stripPoolPasswordFields({ accessControl: ['password'] })).toEqual({ accessControl: ['password'] });
    });
});

describe('callable schemas', () => {
    it('setPoolPassword takes a non-empty string or an explicit null, never an empty string', () => {
        expect(setPoolPasswordSchema.safeParse({ poolId: 'p', password: 'x' }).success).toBe(true);
        expect(setPoolPasswordSchema.safeParse({ poolId: 'p', password: null }).success).toBe(true);
        // The whole point: "" must not be a synonym for "clear it".
        expect(setPoolPasswordSchema.safeParse({ poolId: 'p', password: '' }).success).toBe(false);
        expect(setPoolPasswordSchema.safeParse({ poolId: 'p' }).success).toBe(false);
        expect(setPoolPasswordSchema.safeParse({ poolId: 'p', password: 'x', extra: 1 }).success).toBe(false);
    });

    it('verifyPoolAccess bounds the candidate length', () => {
        expect(verifyPoolAccessSchema.safeParse({ poolId: 'p', password: 'x' }).success).toBe(true);
        expect(verifyPoolAccessSchema.safeParse({
            poolId: 'p', password: 'x'.repeat(MAX_POOL_PASSWORD_LENGTH + 1),
        }).success).toBe(false);
    });

    it('the migration defaults to DRY RUN at the schema layer (Rule 1)', () => {
        expect(migratePoolPasswordsSchema.parse({}).dryRun).toBe(true);
        expect(migratePoolPasswordsSchema.parse({ dryRun: false }).dryRun).toBe(false);
    });
});

describe('publish password plan (codex r2 P1 — publish must never clear)', () => {
    it('uses the supplied password when publish sends one', () => {
        expect(publishPasswordPlan('pw', false, {})).toEqual({
            source: 'supplied', plaintext: 'pw', willBeProtected: true,
        });
        // …even when a secret already exists: this is a deliberate replace.
        expect(publishPasswordPlan('pw', true, {}).source).toBe('supplied');
    });

    it('KEEPS an existing private secret when publish omits the password', () => {
        // The regression codex caught: a commissioner sets a password on a DRAFT
        // through setPoolPassword, then publishes with the field blank. The old
        // `passwordHash || FieldValue.delete()` deleted it and opened the pool.
        for (const omitted of [undefined, null, '']) {
            expect(publishPasswordPlan(omitted, true, {})).toEqual({
                source: 'keep', willBeProtected: true,
            });
        }
    });

    it('adopts legacy material a pre-Phase-B draft is still carrying', () => {
        // The scrub deletes these fields on publish either way, so NOT adopting
        // them would destroy the commissioner's setting rather than migrate it.
        expect(publishPasswordPlan(undefined, false, { accessControl: { password: 'old' } }))
            .toEqual({ source: 'legacy-plaintext', plaintext: 'old', willBeProtected: true });
        expect(publishPasswordPlan(undefined, false, { passwordHash: 'salt:hash' }))
            .toEqual({ source: 'legacy-hash', hash: 'salt:hash', willBeProtected: true });
    });

    it('leaves an unprotected pool unprotected', () => {
        expect(publishPasswordPlan(undefined, false, {})).toEqual({
            source: 'keep', willBeProtected: false,
        });
    });

    it('prefers the PRIVATE secret over legacy public material', () => {
        expect(publishPasswordPlan(undefined, true, { gridPassword: 'stale' }))
            .toEqual({ source: 'keep', willBeProtected: true });
    });
});

describe('migration planner', () => {
    it('plans a hash for a pool holding plaintext', () => {
        expect(planForPool('p1', { gridPassword: 'pw' }, false)).toEqual({ poolId: 'p1', action: 'hash-plaintext' });
        expect(planForPool('p1', { accessControl: { password: 'pw' } }, false))
            .toEqual({ poolId: 'p1', action: 'hash-plaintext' });
    });

    it('plans a verbatim move for a pool holding only a legacy hash', () => {
        expect(planForPool('p1', { passwordHash: 'salt:hash' }, false)).toEqual({ poolId: 'p1', action: 'move-hash' });
    });

    it('NEVER overwrites an existing private secret with stale public plaintext', () => {
        // A commissioner who changed the password after the code shipped has a
        // private hash; the public doc may still carry the OLD plaintext. A
        // re-run must scrub, not restore.
        expect(planForPool('p1', { gridPassword: 'stale' }, true)).toEqual({ poolId: 'p1', action: 'scrub-only' });
    });

    it('is a no-op for a pool with nothing to do', () => {
        expect(planForPool('p1', {}, false)).toBeNull();
        expect(planForPool('p1', { hasPoolPassword: true }, true)).toBeNull();
        expect(planForPool('p1', undefined, false)).toBeNull();
    });

    it('repairs a missing marker on a pool that already has a private secret', () => {
        expect(planForPool('p1', {}, true)).toEqual({ poolId: 'p1', action: 'scrub-only' });
    });
});

describe('source invariants', () => {
    const SRC = path.resolve(__dirname, '..');
    const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

    it('bracketPools no longer dumps the whole request payload to the logs (item 21d)', () => {
        // The dump carried the commissioner's contact email, payment handles and
        // (pre-Phase-B) the pool password into Cloud Logging on every create.
        expect(read('bracketPools.ts')).not.toMatch(/JSON\.stringify\(request\.data/);
    });

    /** Every .ts under functions/src except tests, generated shared/ and .d.ts. */
    function sourceFiles(dir = SRC, acc: string[] = []): string[] {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['__tests__', 'shared', 'node_modules'].includes(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) sourceFiles(full, acc);
            else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
        }
        return acc;
    }
    /** Blank comments so PROSE cannot trip (or satisfy) the scan. */
    const strip = (s: string) => s
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

    /** Files that ASSIGN `<field>: …` in an object literal. */
    function assignersOf(field: string): string[] {
        const re = new RegExp(`(^|[^.\\w])${field}\\s*:`);
        return sourceFiles()
            .filter((f) => strip(fs.readFileSync(f, 'utf8')).split('\n').some((l) => re.test(l)))
            .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
            .sort();
    }

    it('nothing server-side ever writes gridPassword', () => {
        // The field is READ (legacyPlaintextOf, the migration) and DELETED
        // (scrubPatch, via FieldValue.delete()) but never assigned a value.
        expect(assignersOf('gridPassword').filter((f) => f !== 'lib/poolAccess.ts')).toEqual([]);
    });

    it('only the access-doc writers assign passwordHash — this list is a ratchet', () => {
        // Exact equality, not a subset: a NEW file writing `passwordHash:` fails
        // here and has to justify itself, which is the whole point. Each of
        // these three writes `pools/{id}/private/access`, never `pools/{id}`.
        expect(assignersOf('passwordHash')).toEqual([
            'bracketPools.ts',                    // publish, inside the slug transaction
            'lib/poolAccess.ts',                  // writePoolSecret / rehashOnVerify
            'migrations/migratePoolPasswords.ts', // the evacuation sweep
        ]);
    });

    it("the pool document's password marker is a boolean, never the secret", () => {
        // `hasPoolPassword` is what the UI renders a lock from. If it ever
        // carried the value instead of a boolean the phase would be undone in
        // one line, so pin the type at its single writer.
        const src = strip(fs.readFileSync(path.join(SRC, 'lib/poolAccess.ts'), 'utf8'));
        expect(src).toMatch(/HAS_POOL_PASSWORD_FIELD\]:\s*hasPassword/);
        expect(src).toMatch(/gridPassword:\s*FieldValue\.delete\(\)/);
        expect(src).toMatch(/"accessControl\.password":\s*FieldValue\.delete\(\)/);
    });
});
