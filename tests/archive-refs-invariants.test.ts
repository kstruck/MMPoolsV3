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
 * BASE REF. The verifier compares against `origin/main` by default and FAILS
 * CLOSED when that ref is unreadable. A CI checkout does not always carry a
 * remote-tracking `origin/main`, so this test resolves a base that exists and
 * passes it explicitly. Falling back to HEAD narrows the deleted-doc set to the
 * manifest — it does not disable the check: invariant 1 still runs in full, and
 * invariant 2 still runs against every manifest-recorded deletion, which is the
 * half that is supposed to outlive the branch anyway.
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

/** The first ref that actually exists here. HEAD always does. */
function resolveBase(): string {
  return ['origin/main', 'main', 'HEAD'].find(refExists) ?? 'HEAD';
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
    const { status, output } = runVerifier(resolveBase());
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
