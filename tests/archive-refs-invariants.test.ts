/**
 * Runs scripts/verifyArchiveRefs.mjs as part of the suite.
 *
 * WHY A TEST AND NOT A README LINE. The verifier was added by PR #653 to prove
 * the docs-cleanup criterion: no markdown link to an archived doc that fails to
 * resolve, no reference anywhere to a deleted one, and every deletion recorded
 * in docs/archive/deleted-docs.txt. Documented-only, it protects nothing — a
 * later PR can break an archive link or re-cite a deleted doc and pass every
 * required check. `build-and-test` is a required check, so putting it here is
 * what makes the guard enforced rather than advisory.
 *
 * BASE REF. The verifier compares against `origin/main` and FAILS CLOSED when
 * that ref is unreadable, so this test does too: it requires a real base rather
 * than falling back to HEAD. A HEAD base makes the diff empty, which would
 * quietly switch off invariant 3 — a deletion missing from the manifest would
 * pass while the test still reported success, which is the precise failure this
 * guard exists to prevent.
 *
 * That is safe here rather than brittle: `build-and-test` checks out with
 * `fetch-depth: 0`, which fetches every branch, and the same job already runs
 * `docs-state-invariants.test.ts`, which resolves SHAs against `origin/main`
 * and (per the workflow's own comment) "fails loudly rather than skipping".
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join('scripts', 'verifyArchiveRefs.mjs');

function refExists(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const BASE_CANDIDATES = ['origin/main', 'main'] as const;

/**
 * A real base to diff against. Deliberately NOT falling back to HEAD — see the
 * BASE REF note above; an empty diff disables invariant 3 silently.
 */
function resolveBase(): string | null {
  return BASE_CANDIDATES.find(refExists) ?? null;
}

function runVerifier(base: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--base', base], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('docs/archive citation graph', () => {
  it('is closed — no unresolved archive links, no references to deleted docs', () => {
    const base = resolveBase();
    expect(
      base,
      `no base ref among ${BASE_CANDIDATES.join(', ')} — the deletion invariant cannot ` +
        `be checked against an empty diff, so this fails rather than passing vacuously. ` +
        `Ensure the checkout fetches branches (actions/checkout with fetch-depth: 0).`,
    ).not.toBeNull();

    const { status, output } = runVerifier(base as string);
    expect(output, `verifyArchiveRefs.mjs failed:\n${output}`).not.toMatch(
      /UNRESOLVED|DANGLING|^FAIL:/m,
    );
    expect(status, `verifyArchiveRefs.mjs exited ${status}:\n${output}`).toBe(0);
  });

  it('fails closed on an unreadable base ref rather than reporting success', () => {
    // The guard's own contract. If this ever passes, the verifier has started
    // treating "cannot check" as "checked and fine", and every green run above
    // stops meaning anything.
    const { status, output } = runVerifier('definitely/not/a/ref');
    expect(status).toBe(1);
    expect(output).toContain('cannot read base ref');
  });
});
