import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Loop-engineering invariants — mechanical guards for the five failure modes
 * found in the 2026-09-19 review of this repo's autonomous-loop setup.
 *
 * Each `describe` below corresponds to something that was ALREADY WRONG when
 * this file was written, not to a hypothetical. In order:
 *
 *  1. THE RATCHET HAD NO PAWL. `npm run lint` is `eslint .` — exit 0 at 1855
 *     warnings, exit 0 at 2400. The warning floor was defended by a manual
 *     procedure written in CLAUDE.md §2e, and the proof nobody ran it is that
 *     the number recorded there (1881) was 26 above the measured count on
 *     `37ac1aa` (1855). A floor that drifts unobserved is not a floor.
 *
 *  2. THE RATCHET COULD EXIST AND NOT BE WIRED. Adding `lint:ratchet` to
 *     package.json does nothing if CI keeps running bare `lint` — a guard that
 *     looks like it guards, which is this repo's signature defect (§2c).
 *
 *  3. PLAN-LOOPS.md DID NOT EXIST IN GIT. All five `mmp-loop-*` skills cited it
 *     for their build order and activation state; `git log --all` had never seen
 *     it, and HANDOFF listed it as an untracked stray on one Windows checkout.
 *     Five loops' approval state lived somewhere no subagent could read.
 *
 *  4. THE LOGS WERE PROMISED AND NEVER CREATED. Three skills each promised their
 *     own log file. None of the three existed, which is how we know no loop had
 *     ever run. One typed, shape-checked log replaces them.
 *
 *  5. THE CHECKER COULD EDIT THE GRADER. Nothing structural stopped the agent
 *     that writes code from editing the tests that grade it.
 *
 * These are cheap file-shape assertions on purpose. They are not a substitute
 * for the gate list; they exist so the gate list cannot be quietly widened.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const claudeMd = read('CLAUDE.md');

const SKILLS_DIR = path.join(REPO_ROOT, '.claude', 'skills');
const loopSkills = readdirSync(SKILLS_DIR).filter((d) => d.startsWith('mmp-loop-'));

describe('lint ratchet', () => {
    it('defines a lint:ratchet script that pins --max-warnings', () => {
        expect(pkg.scripts['lint:ratchet']).toBeDefined();
        expect(pkg.scripts['lint:ratchet']).toMatch(/--max-warnings\s+\d+/);
    });

    /**
     * The two numbers that must never disagree: the one the machine enforces and
     * the one a human reads in CLAUDE.md §2e. They disagreed by 26 before this
     * test existed, and the doc was the wrong one — which is the ordinary
     * direction for a hand-maintained number.
     */
    it('enforces the same baseline that CLAUDE.md §2e documents', () => {
        const enforced = pkg.scripts['lint:ratchet'].match(/--max-warnings\s+(\d+)/);
        expect(enforced, 'lint:ratchet must pin an explicit --max-warnings').not.toBeNull();
        const baseline = Number(enforced![1]);

        const documented = claudeMd.match(/lint baseline is (\d+) warnings/);
        expect(documented, 'CLAUDE.md §2e must state "The lint baseline is N warnings"').not.toBeNull();
        expect(Number(documented![1])).toBe(baseline);

        // Every --max-warnings CLAUDE.md quotes, including the gate-list line,
        // must be the same number. A stale second copy is how §2e drifted.
        const quoted = [...claudeMd.matchAll(/--max-warnings\s+(\d+)/g)].map((m) => Number(m[1]));
        expect(quoted.length, 'CLAUDE.md should quote the ratchet command').toBeGreaterThan(0);
        for (const n of quoted) expect(n).toBe(baseline);
    });

    /**
     * Ratchets only move one way. Raising the cap is a deliberate act that needs
     * a PR reviewer to see it; this test cannot tell intent, but it can make the
     * number impossible to change in only one of the two places.
     */
    it('keeps bare `lint` available for local use without a cap', () => {
        expect(pkg.scripts.lint).toBe('eslint .');
    });
});

describe('CI wiring', () => {
    const ci = read('.github/workflows/ci.yml');

    /** Extract one top-level job block by name, without a YAML dependency. */
    function jobBlock(name: string): string {
        const lines = ci.split('\n');
        const start = lines.findIndex((l) => l === `  ${name}:`);
        expect(start, `CI must define a top-level job "${name}"`).toBeGreaterThan(-1);
        const rest = lines.slice(start + 1);
        const end = rest.findIndex((l) => /^ {2}\S/.test(l));
        return (end === -1 ? rest : rest.slice(0, end)).join('\n');
    }

    /**
     * The `lint` JOB NAME is the required status check in the repository
     * ruleset, so it must keep that name — what changes is the command inside.
     */
    it('runs the ratchet, not bare eslint, in the required lint job', () => {
        const lint = jobBlock('lint');
        expect(lint).toContain('npm run lint:ratchet');
        expect(
            /run:\s*npm run lint\s*$/m.test(lint),
            'the lint job must not fall back to uncapped `npm run lint`',
        ).toBe(false);
    });

    /**
     * A step's command AND the directory it runs in, as one unit.
     *
     * ⚠️ The first version of this asserted `job.toContain('npm run build')`,
     * which is worthless here: the root build step runs `npm run build:static`,
     * and `npm run build` is a substring of it. The assertion passed with the
     * functions build step deleted — a guard that looked like it guarded, in a
     * file whose entire purpose is stopping that. Caught by self-review of this
     * diff, which is what CLAUDE.md §2c says self-review is for.
     */
    function steps(job: string): { run: string; dir: string }[] {
        return job.split(/^ {6}- /m).slice(1).map((chunk) => ({
            run: chunk.match(/run:\s*(.+)/)?.[1].trim() ?? '',
            dir: chunk.match(/working-directory:\s*(.+)/)?.[1].trim() ?? '.',
        }));
    }

    /**
     * CLAUDE.md §2e lists seven gates. `npm --prefix functions run build` was on
     * that list and in no automated gate anywhere until 2026-09-19, so the emit
     * that `firebase deploy` performs was exercised only by a deploy.
     */
    it('runs the functions deploy build, not just the typecheck', () => {
        const inFunctions = steps(jobBlock('build-and-test')).filter((s) => s.dir === 'functions');
        const commands = inFunctions.map((s) => s.run);

        expect(commands, 'functions typecheck must run in CI').toContain('npm run typecheck');
        // Exact equality, never toContain: `npm run build:static` would satisfy
        // a substring match while emitting nothing from functions/.
        expect(commands, 'the functions deploy build must run in CI').toContain('npm run build');
    });
});

describe('loop charter', () => {
    const CHARTER = 'docs/plans/PLAN-LOOPS.md';

    it('exists in the repository, not only on one checkout', () => {
        expect(existsSync(path.join(REPO_ROOT, CHARTER))).toBe(true);
    });

    it('finds at least the five loop skills it is meant to govern', () => {
        expect(loopSkills.length).toBeGreaterThanOrEqual(5);
    });

    /**
     * Fail-safe by default: a NEW mmp-loop-* skill must point at the charter and
     * must appear in it. Adding a sixth loop that documents its activation state
     * only in its own prose is exactly how the first five ended up unreadable.
     */
    it.each(loopSkills)('%s cites the charter by its tracked path', (skill) => {
        const body = read(path.join('.claude', 'skills', skill, 'SKILL.md'));
        expect(body).toContain(CHARTER);
    });

    it.each(loopSkills)('%s is listed in the charter ledger', (skill) => {
        expect(read(CHARTER)).toContain(skill);
    });

    /**
     * Every loop must declare an activation state using one of the three tokens
     * the charter defines. Case-sensitive and anchored to the token, because the
     * loose version (`/ACTIVE|.../i`) also matched the word "inactive" and any
     * prose that happened to say "active".
     */
    const STATE_TOKENS = ['**ACTIVE', '**Still parked**', 'proceed-gate'];

    it.each(loopSkills)('%s declares one of the charter activation states', (skill) => {
        const body = read(path.join('.claude', 'skills', skill, 'SKILL.md'));
        const declared = STATE_TOKENS.filter((t) => body.includes(t));
        expect(declared, `${skill} must declare one of ${STATE_TOKENS.join(' / ')}`).not.toHaveLength(0);
    });
});

const LOG_HEADER = ['date', 'loop', 'commit', 'verdict', 'metric', 'idea', 'lesson'] as const;

/**
 * The verdict vocabulary is closed on purpose. INCONCLUSIVE is the one that
 * earns its keep: a loop that could not evaluate its verifier must have
 * somewhere honest to land, or it will land on CLEAN.
 */
const VERDICTS = new Set(['CLEAN', 'FINDING', 'INCONCLUSIVE', 'BLOCKED', 'ERROR']);

/** Every reason a row is malformed, or [] if it is fine. */
export function loopLogRowErrors(row: string): string[] {
    const fields = row.split('\t');
    if (fields.length !== LOG_HEADER.length) {
        return [`expected ${LOG_HEADER.length} tab-separated fields, got ${fields.length}`];
    }
    const [date, loop, , verdict, metric] = fields;
    const errors: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`date "${date}" is not UTC YYYY-MM-DD`);
    if (loop.trim().length === 0) errors.push('loop is empty');
    if (!VERDICTS.has(verdict)) errors.push(`verdict "${verdict}" is outside the closed vocabulary`);
    // A verdict with no metric is a claim with no evidence.
    if (metric.trim().length === 0) errors.push('metric is empty — use "-" if there is genuinely no number');
    return errors;
}

describe('LOOP-LOG.tsv', () => {
    const rows = read('LOOP-LOG.tsv').split('\n').filter((l) => l.length > 0);

    it('carries exactly the documented header', () => {
        expect(rows[0].split('\t')).toEqual([...LOG_HEADER]);
    });

    it('has no malformed row', () => {
        rows.slice(1).forEach((row, i) => {
            expect(loopLogRowErrors(row), `row ${i + 2}: ${row}`).toEqual([]);
        });
    });

    /**
     * ⚠️ The file is header-only until a loop runs, so the check above iterates
     * NOTHING and passes vacuously — a validator nobody has ever seen reject
     * anything. These fixtures are what make it a real guard today rather than
     * a promise about the future.
     */
    describe('the validator itself rejects what it is supposed to', () => {
        const good = '2026-09-19\taudit-sweep\t37ac1aa\tCLEAN\t0 gaps\tweekly sweep\t-';

        it('accepts a well-formed row', () => {
            expect(loopLogRowErrors(good)).toEqual([]);
        });

        it.each([
            ['too few fields', '2026-09-19\taudit-sweep\tCLEAN'],
            ['too many fields', `${good}\textra`],
            ['a US-style date', '09/19/2026\taudit-sweep\t37ac1aa\tCLEAN\t0 gaps\tx\t-'],
            ['an invented verdict', '2026-09-19\taudit-sweep\t37ac1aa\tOK\t0 gaps\tx\t-'],
            ['lowercase verdict', '2026-09-19\taudit-sweep\t37ac1aa\tclean\t0 gaps\tx\t-'],
            ['an empty metric', '2026-09-19\taudit-sweep\t37ac1aa\tCLEAN\t\tx\t-'],
            ['a whitespace-only metric', '2026-09-19\taudit-sweep\t37ac1aa\tCLEAN\t   \tx\t-'],
            ['an unnamed loop', '2026-09-19\t\t37ac1aa\tCLEAN\t0 gaps\tx\t-'],
        ])('rejects %s', (_label, row) => {
            expect(loopLogRowErrors(row).length).toBeGreaterThan(0);
        });
    });
});

describe('maker/checker separation', () => {
    const AGENT = '.claude/agents/verifier.md';

    it('defines a verifier agent', () => {
        expect(existsSync(path.join(REPO_ROOT, AGENT))).toBe(true);
    });

    /**
     * The whole value of the checker is that it CANNOT edit what grades the
     * work. If Edit/Write ever appear in its tool list it becomes a second maker
     * wearing a reviewer's name, which is worse than having no reviewer — it
     * produces a verdict people trust.
     */
    it('grants the verifier no write tools', () => {
        const frontmatter = read(AGENT).split('---')[1] ?? '';
        const tools = (frontmatter.match(/^tools:\s*(.+)$/m)?.[1] ?? '')
            .split(',')
            .map((t) => t.trim());

        expect(tools.length, 'the verifier must declare an explicit tool list').toBeGreaterThan(0);
        for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
            expect(tools, `verifier must not hold ${forbidden}`).not.toContain(forbidden);
        }
    });
});
