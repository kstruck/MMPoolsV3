import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PLAN-API-TRUST-BOUNDARY-REMEDIATION Phase 2 — the raw-callable exception
 * guard. Every callable is expected to go through `validated()`; the ones
 * below are REVIEWED exceptions, each with the reason it stays raw. A new
 * `export const X = onCall(` anywhere in functions/src fails this test until
 * it is either wrapped in validated() or reviewed onto this list (with its
 * reason) in a plan-gated change.
 *
 * Source-text scan over comment-blanked files — the same proven harness as
 * callableExportSurface.test.ts (prose cannot invent or hide a callable).
 */

const SRC = path.resolve(__dirname, '..');

/** file (posix, relative to src) -> callable -> why it may stay raw. */
const REVIEWED_RAW_CALLABLES: Record<string, Record<string, string>> = {
    'aiTesting.ts': {
        generateTestScenario: 'claim+doc assertCallerRole + named schema parse; gate order (role before schema) is deliberate',
        validateTestResults: 'same',
        generateTestReport: 'same',
    },
    'bracketPools.ts': {
        createBracketPool: 'shape guard + shared bracketCreateInputSchema via validateCreateInput; maintenance-gate error must precede schema error, and the permissive top level is ADR-0001 design',
    },
    'expertProfiles.ts': {
        refreshExpertProfiles: 'claim+doc assertCallerRole + named schema parse',
    },
    'logClientError.ts': {
        logClientError: 'deliberately pre-auth (global ErrorBoundary), hand allowlist + size caps',
    },
    'payoutRecords.ts': {
        recordPoolPayouts: 'ownership-based auth (confirmedAdminClaim-hardened) + hand cross-field money validation',
        setPayoutSettled: 'same authorizer; hand-typed input checks are null-safe',
    },
    'scoreUpdates.ts': {
        simulateGameUpdate: 'ownership-based auth with hoisted claim+doc check (pinned outside the transaction) + named schema parse; unauthenticated error code is pinned behavior',
    },
    'securityNotices.ts': {
        notifyPasswordReset: 'public by design; constant response, bounded input, rate-limited',
    },
    'serverTime.ts': {
        getServerTime: 'no auth, no input, no data',
    },
    'simHarness.ts': {
        simStartRun: 'claim+doc assertSuperAdmin + validRunId + namespace anchors',
        simWriteEntries: 'claim+doc assertSuperAdmin + simRunId pool anchor',
        simUpdatePool: 'same',
        simSeedNFLGames: 'claim+doc + server-forced sim doc ids + caps',
        cleanupSimPool: 'claim+doc + simRunId anchor',
        sweepSimRuns: 'claim+doc + dry-by-default + grace window',
        simJoinMembers: 'claim+doc + simRunId anchor',
        simSubmitPicks: 'same',
        simExecuteRebuy: 'same',
        simReportRun: 'claim+doc + validRunId + payload caps',
        simFinalizePool: 'claim+doc + simRunId anchor',
    },
    'simLegacy.ts': {
        simSetTournament: 'claim+doc role check + typed hand checks',
        simDeleteTournament: 'same',
        simFillSquares: 'ownership path + claim+doc admin hint + typed hand checks',
    },
    'siteAverages.ts': {
        refreshSiteAverages: 'claim+doc assertCallerRole; consumes no input',
    },
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'shared' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
    }
    return acc;
}

function blankComments(s: string): string {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
        .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

// Raw declarations only: validated( is the sanctioned path and not matched.
const RAW_CALLABLE_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:onCall|functions\.https\.onCall)\s*\(/g;

function rawCallables(): Array<{ name: string; file: string }> {
    const found: Array<{ name: string; file: string }> = [];
    for (const file of sourceFiles(SRC)) {
        if (path.basename(file) === 'validated.ts') continue; // the wrapper's own onCall
        const text = blankComments(fs.readFileSync(file, 'utf8'));
        for (const m of text.matchAll(RAW_CALLABLE_RE)) {
            found.push({ name: m[1], file: path.relative(SRC, file).replace(/\\/g, '/') });
        }
    }
    return found;
}

describe('raw-callable exception guard', () => {
    const found = rawCallables();

    it('the scan still matches the expected population (not vacuous)', () => {
        expect(found.length).toBeGreaterThanOrEqual(20);
    });

    it('every raw onCall export is on the reviewed exception list', () => {
        const unlisted = found
            .filter(({ name, file }) => !REVIEWED_RAW_CALLABLES[file]?.[name])
            .map(({ name, file }) => `${name} (${file})`)
            .sort();
        expect(unlisted, [
            'These raw onCall exports are NOT on the reviewed exception list.',
            'A new callable must use validated() (auth -> role -> strict schema).',
            'If it genuinely cannot, review it onto REVIEWED_RAW_CALLABLES with',
            'the reason, in a plan-gated change (mmp-change-control Rule 3).',
        ].join('\n')).toEqual([]);
    });

    it('the list carries no stale entries (removed/migrated callables leave it)', () => {
        const foundSet = new Set(found.map(({ name, file }) => `${file}::${name}`));
        const stale: string[] = [];
        for (const [file, names] of Object.entries(REVIEWED_RAW_CALLABLES)) {
            for (const name of Object.keys(names)) {
                if (!foundSet.has(`${file}::${name}`)) stale.push(`${name} (${file})`);
            }
        }
        expect(stale, 'stale allowlist rows — the callable moved to validated() or was deleted; drop the row').toEqual([]);
    });
});
