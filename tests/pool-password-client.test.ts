import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { splitPoolPassword } from '../src/services/poolPasswordPayload';

/**
 * Client half of PLAN-AUDIT-AUTH-HARDENING Phase B (audit items 1 and 13a).
 *
 * Two things are pinned here:
 *
 *   1. `splitPoolPassword` — the single seam that lifts a pool password out of
 *      a create/update payload so it can go through the hashing callable
 *      instead of onto the document. Its EMPTY-IS-NOT-A-CLEAR rule is the one
 *      that keeps a routine settings save from silently un-gating a pool.
 *
 *   2. Source invariants — that the two client-side leaks the audit named are
 *      actually gone, rather than merely intended to be. Both were live code:
 *      `BracketPoolDashboard` wrote `accessControl.password` in the clear with
 *      a raw `updateDoc`, and `PoolRoute` decided access with
 *      `enteredPassword === squaresPool.gridPassword` in the browser.
 *
 * The server-side crypto and the migration planner are covered in
 * `functions/src/__tests__/poolPassword.test.ts`; the rules are covered in
 * `functions/scripts/poolPrivateAccess.rules.test.mjs`.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
/** Blank comments so the prose ABOVE a fix cannot vouch for the fix. */
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

describe('splitPoolPassword', () => {
  it('lifts gridPassword out of a create payload', () => {
    const { payload, password } = splitPoolPassword({ name: 'P', gridPassword: 'secret' });
    expect(password).toBe('secret');
    expect(payload).toEqual({ name: 'P' });
  });

  it('lifts accessControl.password in both the nested and the dotted form', () => {
    expect(splitPoolPassword({ accessControl: { password: 'a', requireEmail: true } }))
      .toEqual({ payload: { accessControl: { requireEmail: true } }, password: 'a' });
    expect(splitPoolPassword({ 'accessControl.password': 'b' }))
      .toEqual({ payload: {}, password: 'b' });
  });

  it('treats an EMPTY value as "leave it alone", never as "clear it"', () => {
    // src/constants.ts ships `gridPassword: ''`, and once the field is off the
    // document the wizard reloads it empty — so an empty value arrives on every
    // ordinary settings save. Reading that as a clear would un-gate the pool.
    for (const empty of ['', null, undefined]) {
      const out = splitPoolPassword({ name: 'P', gridPassword: empty });
      expect(out.password).toBeUndefined();
      expect(out.payload).toEqual({ name: 'P' });
    }
  });

  it('never lets a client-chosen hash or marker through', () => {
    const { payload } = splitPoolPassword({ passwordHash: 'attacker:chosen', hasPoolPassword: true, name: 'P' });
    expect(payload).toEqual({ name: 'P' });
  });

  it('does not mutate its input', () => {
    const input: Record<string, unknown> = { gridPassword: 'x', accessControl: { password: 'y' } };
    splitPoolPassword(input);
    expect(input.gridPassword).toBe('x');
    expect((input.accessControl as Record<string, unknown>).password).toBe('y');
  });

  it('leaves a payload with no password fields byte-identical', () => {
    const input = { name: 'P', settings: { entryFee: 10 } };
    expect(splitPoolPassword(input).payload).toEqual(input);
  });

  it('survives an accessControl that is not an object', () => {
    expect(splitPoolPassword({ accessControl: null }).payload).toEqual({ accessControl: null });
    expect(splitPoolPassword({ accessControl: 'x' }).payload).toEqual({ accessControl: 'x' });
  });
});

describe('client source invariants', () => {
  it('PoolRoute no longer compares the password in the browser (item 1)', () => {
    const src = strip(read('src/components/routes/PoolRoute.tsx'));
    expect(src).not.toMatch(/enteredPassword\s*===/);
    expect(src).not.toMatch(/===\s*squaresPool\.gridPassword/);
    // …and it asks the server instead.
    expect(src).toMatch(/dbService\.verifyPoolAccess\(/);
  });

  it('the bracket dashboard no longer writes accessControl.password (item 13a)', () => {
    const src = strip(read('src/components/BracketPoolDashboard/BracketPoolDashboard.tsx'));
    expect(src).not.toMatch(/['"]accessControl\.password['"]\s*:/);
    // The input must not be seeded from the stored value either — that read is
    // what made the plaintext round-trip through the UI in the first place.
    expect(src).not.toMatch(/useState\(pool\.accessControl\?\.password/);
    expect(src).toMatch(/dbService\.setPoolPassword\(/);
  });

  it('dbService routes every password write through the callable', () => {
    const src = strip(read('src/services/dbService.ts'));
    // The three payload-carrying wrappers all split first. The window runs to
    // the NEXT wrapper declaration rather than a fixed character count —
    // comments are blanked to spaces above, and a fixed window stops short of
    // the code whenever a doc comment grows.
    const NEXT_WRAPPER = /\n {4}[A-Za-z][A-Za-z0-9_]*: (?:async |<)/;
    for (const fn of ['createPool', 'updatePool', 'updateBracketPool']) {
      const idx = src.indexOf(`${fn}: async`);
      expect(idx, `${fn} wrapper not found`).toBeGreaterThan(-1);
      const after = src.slice(idx);
      const nextAt = after.slice(1).search(NEXT_WRAPPER);
      // ⚠️ THE BOUND IS THE GUARD. If the window ran to end-of-file, this
      // assertion would be satisfied by ANY later wrapper's call and would
      // vouch for code it never looked at.
      expect(nextAt, `${fn}: could not bound the wrapper body`).toBeGreaterThan(0);
      const body = after.slice(0, nextAt + 1);
      expect(body.length).toBeLessThan(src.length / 4);
      expect(body, `${fn} does not call splitPoolPassword`).toMatch(/splitPoolPassword\(/);
    }
    expect(src).toMatch(/httpsCallable[^(]*\(\s*functions,\s*'setPoolPassword'/);
    expect(src).toMatch(/httpsCallable[^(]*\(\s*functions,\s*'verifyPoolAccess'/);
  });

  it('no client file writes a pool password field to Firestore', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = strip(fs.readFileSync(full, 'utf8'));
        // An assignment INTO a Firestore payload, not the wizard's own local
        // state (`updateConfig({ gridPassword: … })` is in-memory and fine —
        // dbService strips it on the way out).
        if (/['"]accessControl\.password['"]\s*:/.test(text) || /\bpasswordHash\s*:/.test(text)) {
          offenders.push(path.relative(REPO_ROOT, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
