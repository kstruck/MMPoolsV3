import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * NEXT-SESSION-AUDIT-FIXES item 14 / PLAN-AUDIT-BACKEND-RESIDUE §1.
 *
 * A scheduled function with no `timeoutSeconds` runs on the Gen-2 default of 60
 * SECONDS. That is not a theoretical ceiling: `runReminders` scans a bounded
 * pool union and then SENDS email and SMS per pool, so the wall lands mid-send
 * — some members notified, some not, and the timeout says nothing about the
 * half-delivery.
 *
 * Source-text scan, not an import of the modules: importing them pulls in the
 * whole function graph (Admin SDK, Stripe, secrets) to answer a question about
 * text. Same approach as maxInstancesInvariants.test.ts and heartbeat.test.ts.
 */

const SRC = join(__dirname, "..");

/** The three jobs item 14 names. Each must declare BOTH knobs explicitly. */
const REQUIRED = ["syncNFLScoresJob", "runReminders", "nflDeepScoreSweepJob"] as const;

/**
 * Scheduled jobs that still run on the defaults. Item 14 scoped itself to the
 * three above; these eleven live in files other concurrent workstreams own, so
 * they were deliberately not touched.
 *
 * THIS LIST MAY ONLY SHRINK. A new scheduled job shipped without explicit sizing
 * shows up here as an unexpected entry and fails the assertion below — which is
 * the whole reason the gap is pinned rather than merely written down in a doc.
 * When you size one of these, DELETE it from this list; do not add to it.
 */
const KNOWN_UNSIZED = [
    "checkPlayoffScores",
    "consensusRefreshJob",
    "enforceBillingStatus",
    "gradeExpertProfilesJob",
    "lockNFLSpreadsJob",
    "scheduledBracketSync",
    "scheduledHealthCheck",
    "siteAveragesJob",
    "syncExpertPicksJob",
    "syncWinProbabilityJob",
    "webhookDurabilitySweep",
] as const;

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "shared" || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) acc.push(full);
    }
    return acc;
}

/** Blank comments so PROSE cannot invent a job (this repo names onSchedule in doc comments). */
function blankComments(s: string): string {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
        .replace(/(?<!:)\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * The options object literal starting at or after `from`, brace-matched.
 *
 * A naive slice-to-the-first-`}` under-reads any multi-line or nested options
 * object (nflLockWatchJob's spans several lines), which would report a SIZED job
 * as unsized — a guard that cries wolf gets an allowlist entry added to shut it
 * up, and then it guards nothing.
 */
function firstObjectLiteral(text: string, from: number): string {
    const open = text.indexOf("{", from);
    if (open < 0) return "";
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
    }
    return "";
}

interface Job { name: string; file: string; sized: boolean }

function scheduledJobs(): Job[] {
    const found: Job[] = [];
    const re = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:functions\.scheduler\.)?onSchedule\s*\(/g;
    for (const file of sourceFiles(SRC)) {
        const text = blankComments(readFileSync(file, "utf8"));
        for (const m of text.matchAll(re)) {
            const opts = firstObjectLiteral(text, m.index + m[0].length);
            found.push({
                name: m[1],
                file: relative(SRC, file).replace(/\\/g, "/"),
                sized: /\btimeoutSeconds\s*:/.test(opts) && /\bmemory\s*:/.test(opts),
            });
        }
    }
    return found;
}

describe("scheduled job sizing (item 14)", () => {
    const jobs = scheduledJobs();

    it("finds the scheduled jobs (guards against the regex silently matching nothing)", () => {
        // 24 as of 2026-08-24. Floored below that so ordinary churn does not trip
        // it, but a regex that stops matching cannot make the assertions vacuous.
        expect(jobs.length).toBeGreaterThanOrEqual(20);
    });

    it.each(REQUIRED)("%s declares an explicit timeoutSeconds AND memory", (name) => {
        const job = jobs.find((j) => j.name === name);
        expect(job, `${name} is not declared as \`export const ${name} = onSchedule(\` any more`).toBeDefined();
        expect(
            job!.sized,
            `${name} (${job!.file}) has no explicit timeoutSeconds/memory, so it runs on the ` +
            "Gen-2 default 60s/256MiB. See PLAN-AUDIT-BACKEND-RESIDUE §1 for the peer-matched values.",
        ).toBe(true);
    });

    it("the three sized jobs stay under their cadence so two runs cannot overlap", () => {
        // nflAutoScore.ts's invariant, applied to the jobs this change sized:
        // timeoutSeconds MUST be less than the gap between runs.
        const cadenceSeconds: Record<string, number> = {
            syncNFLScoresJob: 300, // */5 * * * *
            runReminders: 900, // every 15 minutes
            nflDeepScoreSweepJob: 86_400, // 30 11 * * *
        };
        for (const name of REQUIRED) {
            const file = jobs.find((j) => j.name === name)!.file;
            const text = blankComments(readFileSync(join(SRC, file), "utf8"));
            const at = text.search(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(?:functions\\.scheduler\\.)?onSchedule\\s*\\(`));
            // -1 would make firstObjectLiteral read the FILE'S FIRST object literal
            // and quietly assert about the wrong thing — the exact shape of a guard
            // that looks like it guards and does not.
            expect(at, `${name}: declaration not found in ${file}`).toBeGreaterThanOrEqual(0);
            const opts = firstObjectLiteral(text, at);
            const timeout = Number(opts.match(/timeoutSeconds\s*:\s*(\d+)/)?.[1]);
            expect(timeout, `${name}: could not read timeoutSeconds`).toBeGreaterThan(0);
            expect(
                timeout,
                `${name}: timeoutSeconds ${timeout} >= its ${cadenceSeconds[name]}s cadence — two runs can overlap.`,
            ).toBeLessThan(cadenceSeconds[name]);
        }
    });

    it("no NEW scheduled job ships without explicit sizing", () => {
        const unsized = jobs.filter((j) => !j.sized).map((j) => j.name).sort();
        expect(
            unsized,
            [
                "The set of scheduled jobs running on the Gen-2 defaults (60s/256MiB) changed.",
                "If you SIZED one: delete it from KNOWN_UNSIZED above.",
                "If you ADDED one: give it explicit timeoutSeconds + memory. Peer values are in",
                "PLAN-AUDIT-BACKEND-RESIDUE §1 — do not extend KNOWN_UNSIZED to make this pass.",
            ].join("\n"),
        ).toEqual([...KNOWN_UNSIZED].sort());
    });

    it("KNOWN_UNSIZED names only jobs that actually exist", () => {
        // Otherwise a renamed/deleted job leaves a stale entry that quietly makes
        // room for a NEW unsized job of the same count to slip past the check above.
        const names = new Set(jobs.map((j) => j.name));
        expect(KNOWN_UNSIZED.filter((n) => !names.has(n))).toEqual([]);
    });

    it("sizing an inherited job does not undo the #548 maxInstances cap", () => {
        // setGlobalOptions({ maxInstances: 10 }) merges with per-function options;
        // ONLY a key named inline overrides it. None of the three names maxInstances.
        for (const name of REQUIRED) {
            const file = jobs.find((j) => j.name === name)!.file;
            const text = blankComments(readFileSync(join(SRC, file), "utf8"));
            const at = text.search(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(?:functions\\.scheduler\\.)?onSchedule\\s*\\(`));
            expect(at, `${name}: declaration not found in ${file}`).toBeGreaterThanOrEqual(0);
            const opts = firstObjectLiteral(text, at);
            expect(opts, `${name} names maxInstances inline, overriding the global cap`).not.toMatch(/maxInstances/);
        }
    });
});
