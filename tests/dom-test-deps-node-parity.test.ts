import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The DOM test dependencies must run on the Node version CI uses — T2.
 *
 * WHY THIS EXISTS, MEASURED. T2 added `jsdom` for the Help panel's keyboard and
 * focus tests. `npm install jsdom` took the latest major (30), which declares
 * `engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`. Every suite passed locally on
 * Node 24 and `build-and-test` — which runs on **Node 20** — died with
 * `TypeError: webidl.util.markAsUncloneable is not a function` from jsdom's
 * bundled undici, as an UNHANDLED pool error rather than a failed assertion. So
 * the failure named a symbol, not a version, and nothing in the repo said which
 * Node the tests are expected to run on.
 *
 * `engines` in `package.json` says `>=20` and CI's lowest job says 20, so 20 is
 * the contract. This asserts the DOM dependencies honour it.
 *
 * SCOPED TO THE DOM TEST DEPENDENCIES on purpose. A guard over every direct
 * dependency would be a different, larger claim about the whole tree, and this
 * ticket has evidence for exactly these two.
 */

const REPO_ROOT = resolve(__dirname, '..');
const CI_YML = resolve(REPO_ROOT, '.github/workflows/ci.yml');

/** The DOM stack, and the file that opts into it. */
const DOM_DEPS = ['jsdom', '@testing-library/react'];

/**
 * The lowest major a `engines.node` range accepts.
 *
 * Deliberately a small parser rather than `semver`: the only `semver` in this
 * tree is a hoisted transitive dependency, and a guard that stops working when
 * somebody else's lockfile moves is not a guard. It reads the shapes npm
 * actually publishes — `>=18`, `^20.19.0 || ^22.12.0 || >=24.0.0` — by taking
 * the smallest major mentioned anywhere in the range, which is the lowest
 * version any clause can admit.
 */
export function lowestMajor(range: string): number {
  const majors = [...range.matchAll(/(\d+)\s*\.\s*\d+\s*\.\s*\d+|(?:^|[^.\d])(\d+)(?![.\d])/g)]
    .map((m) => Number(m[1] ?? m[2]))
    .filter((n) => Number.isFinite(n));
  expect(majors.length, `no version found in engines range "${range}"`).toBeGreaterThan(0);
  return Math.min(...majors);
}

/** Every `node-version:` in the CI workflow, as majors. */
function ciNodeMajors(): number[] {
  const yml = readFileSync(CI_YML, 'utf8');
  const found = [...yml.matchAll(/node-version:\s*'?"?(\d+)/g)].map((m) => Number(m[1]));
  return found;
}

describe('the DOM test dependencies run on the Node version CI uses', () => {
  it('reads a plausible node-version list out of ci.yml', () => {
    // Guards the regex: without this, a workflow rewrite would make every
    // assertion below pass on an empty list.
    const majors = ciNodeMajors();
    expect(majors.length).toBeGreaterThan(0);
    expect(Math.min(...majors)).toBeGreaterThanOrEqual(18);
  });

  it.each(DOM_DEPS)('%s accepts the lowest Node major any CI job runs', (dep) => {
    const pkgPath = resolve(REPO_ROOT, 'node_modules', dep, 'package.json');
    if (!existsSync(pkgPath)) {
      // Not installed in this environment. Reported, not silently skipped — an
      // absent dependency is a different problem from a compatible one.
      throw new Error(`${dep} is a devDependency of the DOM tests but is not installed at ${pkgPath}`);
    }
    const engines = (JSON.parse(readFileSync(pkgPath, 'utf8')).engines ?? {}).node as string | undefined;
    if (!engines) return; // declares no constraint, so it cannot break one
    expect(lowestMajor(engines), `${dep} engines.node = "${engines}"`).toBeLessThanOrEqual(
      Math.min(...ciNodeMajors()),
    );
  });

  it('the parser discriminates — it would catch the version that actually broke CI', () => {
    // The fixture the guard needs. jsdom 30's real range, against CI's real
    // lowest job, is the failure this file was written after.
    expect(lowestMajor('^22.22.2 || ^24.15.0 || >=26.0.0')).toBe(22);
    expect(lowestMajor('>=18')).toBe(18);
    expect(lowestMajor('^20.19.0 || ^22.12.0 || >=24.0.0')).toBe(20);
    expect(22).toBeGreaterThan(Math.min(...ciNodeMajors()));
  });
});
