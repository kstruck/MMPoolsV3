import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PLAN-COST-CONTROLS Phase 1 EXIT GATE, as an executable guard:
 * "every external paid call produces an attributable usage event."
 *
 * Prose in a plan does not fail a build. This does. It is the same shape as the
 * Phase 7.2 sweep — match the PROVIDER ENDPOINTS and SDK entry points, not just
 * the wrapper function names, because `sendOpsSMS` already proves a call site
 * can reach a paid provider without going through the wrapper
 * (`lib/opsAlertDispatcher.ts` fetches api.courier.com itself).
 *
 * ⚠️ This guard reads SOURCE, so it is only as good as its scoping. An earlier
 * version of a structural guard in this repo searched a whole file and matched
 * a line belonging to a DIFFERENT function — passing while the bug it existed
 * to catch was live (#516 review, round 6). Each check below therefore names
 * the exact file and the exact construct.
 */

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Strip comments so prose mentioning an endpoint cannot satisfy or trip a check. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Phase 1 exit gate — every paid provider call is attributed', () => {
  it('the ONLY files reaching a paid provider endpoint are the known wrappers', () => {
    // If this list grows, the new file either needs to route through a wrapper
    // or to be added here WITH its own usage-event recording. Silence is what
    // this test exists to prevent.
    const ALLOWED = new Set([
      'gemini.ts',                    // Gemini wrapper — records usage events
      'notifications/smsService.ts',  // Courier member/security/test wrapper — records
      'lib/opsAlertDispatcher.ts',    // ops paging, D4-exempt, separate Courier path
    ]);

    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const c = code(fs.readFileSync(file, 'utf8'));
      const hitsProvider =
        c.includes('generativelanguage.googleapis.com') ||
        c.includes('api.courier.com') ||
        /new\s+GoogleGenAI\s*\(/.test(c);
      if (hitsProvider && !ALLOWED.has(rel)) offenders.push(rel);
    }
    expect(offenders, 'new paid-provider call site outside the wrappers').toEqual([]);
  });

  it('every generateAIResponse call site passes an attribution context', () => {
    // The context is the 3rd positional argument. A call site that omits it is
    // a TypeScript error today — this guard is what keeps that true if the
    // parameter is ever made optional "for convenience".
    const callers: { rel: string; call: string }[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel === 'gemini.ts') continue; // the definition, not a call
      const c = code(fs.readFileSync(file, 'utf8'));
      // Match each invocation and its argument list, across newlines.
      for (const m of c.matchAll(/generateAIResponse\s*\(([\s\S]*?)\)\s*;/g)) {
        callers.push({ rel, call: m[1] });
      }
    }
    expect(callers.length, 'expected the known AI call sites to be found').toBeGreaterThanOrEqual(6);
    for (const { rel, call } of callers) {
      expect(call, `${rel}: generateAIResponse call without a feature label`).toMatch(/feature\s*:/);
    }
  });

  it('gemini.ts records an event on BOTH the success and the failure path', () => {
    const c = code(read('gemini.ts'));
    expect((c.match(/recordUsageEvent\s*\(/g) || []).length,
      'expected one recordUsageEvent on success and one on error').toBeGreaterThanOrEqual(2);
    expect(c).toMatch(/outcome:\s*"success"/);
    expect(c).toMatch(/outcome:\s*"error"/);
  });

  it('sendCourierSMS records an event on EVERY return path', () => {
    // Scope to the function body only — matching the whole file is how a
    // structural guard ends up asserting against unrelated code.
    const c = code(read('notifications/smsService.ts'));
    const start = c.indexOf('export async function sendCourierSMS');
    expect(start, 'sendCourierSMS not found').toBeGreaterThan(-1);
    const body = c.slice(start);

    const returns = (body.match(/return\s+'(skipped|failed|queued)'/g) || []).length;
    const records = (body.match(/recordUsageEvent\s*\(/g) || []).length;
    expect(returns, 'expected the known return paths').toBeGreaterThanOrEqual(5);
    expect(records,
      `sendCourierSMS has ${returns} outcome returns but only ${records} usage events`
    ).toBe(returns);
  });
});
