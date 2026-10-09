// CI gate for `npm audit`: fails on any high/critical advisory UNLESS it is on
// the dated allow-list (.github/audit-allowlist.json).
//
// Why this exists: `npm audit --audit-level=high` cannot ignore an advisory, and
// two advisories had NO patched release anywhere on the registry (2026-10-09:
// braces <=3.0.3 and node-forge <=1.4.0 were already the latest versions), so the
// required `security-audit` check went red on every PR with nothing to upgrade.
// Kevin chose a dated allow-list over bypassing the check (2026-10-09).
//
// Every entry MUST carry an expiry. An expired entry fails the gate again, so an
// exception can never become permanent by being forgotten.
//
// Usage (CI, from the root or from functions/):
//   node scripts/auditGate.mjs          (functions/: node ../scripts/auditGate.mjs)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
/** Longest an exception may run, measured from the CI run date. */
export const MAX_EXCEPTION_DAYS = 45;

/** GHSA id from an advisory URL, or the URL itself when it is not a GHSA link. */
function advisoryId(url) {
  const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(url ?? ''));
  return m ? m[0] : String(url ?? '');
}

/**
 * An exception is for ONE advisory in ONE package. The same GHSA can be reported
 * against more than one package, and a waiver for the first must not wave the
 * second through (qodo #2 on #717).
 */
const exceptionKey = (id, pkg) => `${id}|${pkg}`;

/** Every distinct (advisory, package) high/critical pair in an `npm audit --json` report. */
export function collectAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !via || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via.url);
      const key = exceptionKey(id, via.name);
      if (!found.has(key)) found.set(key, { id, key, name: via.name, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

/**
 * Pure decision. `now` is injected so tests are deterministic.
 * Returns { failures, allowed, unusedEntries } — the gate passes iff failures is empty.
 */
export function evaluateAudit(report, allowlist, now = new Date()) {
  const entries = new Map();
  for (const e of allowlist?.entries ?? []) entries.set(exceptionKey(advisoryId(e.ghsa), e.package), e);

  const failures = [];
  const allowed = [];
  const seen = new Set();
  for (const adv of collectAdvisories(report)) {
    seen.add(adv.key);
    const entry = entries.get(adv.key);
    if (!entry) {
      failures.push({ ...adv, reason: 'not on the allow-list' });
      continue;
    }
    const expires = Date.parse(entry.expires);
    if (!entry.reason || Number.isNaN(expires)) {
      failures.push({ ...adv, reason: 'allow-list entry needs a reason and a valid expires date' });
    } else if (expires < now.getTime()) {
      failures.push({ ...adv, reason: `allow-list entry expired ${entry.expires}` });
    } else if (expires > now.getTime() + MAX_EXCEPTION_DAYS * 86_400_000) {
      // A 2099 date would make the exception permanent, which is what the
      // expiry exists to prevent (codex P1 on the PR).
      failures.push({ ...adv, reason: `allow-list expires ${entry.expires} is more than ${MAX_EXCEPTION_DAYS} days away` });
    } else {
      allowed.push({ ...adv, expires: entry.expires });
    }
  }
  const unusedEntries = [...entries.keys()].filter((id) => !seen.has(id));
  return { failures, allowed, unusedEntries };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const allowlist = JSON.parse(readFileSync(path.join(here, '..', '.github', 'audit-allowlist.json'), 'utf8'));

  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.log(run.stdout, run.stderr);
    console.log('audit endpoint returned an error: npm audit did not produce JSON');
    process.exit(1);
  }
  // The workflow retries ONLY when this exact phrase appears, so a real advisory
  // can never be retried into a pass.
  if (report.error) {
    console.log(JSON.stringify(report.error));
    console.log('audit endpoint returned an error');
    process.exit(1);
  }

  const { failures, allowed, unusedEntries } = evaluateAudit(report, allowlist);
  for (const a of allowed) console.log(`ALLOWED until ${a.expires}: ${a.name} ${a.id} (${a.severity}) — ${a.title}`);
  for (const id of unusedEntries) console.log(`note: allow-list entry ${id} is not reported in this tree (fine in the other tree; delete it when neither reports it)`);
  for (const f of failures) console.log(`FAIL: ${f.name} ${f.id} (${f.severity}) — ${f.title} [${f.reason}]`);
  if (failures.length) {
    console.log(`${failures.length} blocking advisory/advisories. Fix them, or add a dated entry to .github/audit-allowlist.json ONLY if no patched release exists.`);
    process.exit(1);
  }
  console.log('npm audit gate passed (no high/critical advisory outside the allow-list).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
