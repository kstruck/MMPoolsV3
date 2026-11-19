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

/** The last cell of a markdown ledger row: the authoritative State column. */
export function ledgerStateCell(row: string): string {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    return cells[cells.length - 1] ?? '';
}

/**
 * The State a ledger row declares, or `null` when it declares neither or both.
 *
 * ⚠️ READ THE State CELL, AND REQUIRE IT TO NAME A STATE. The first version of
 * this guard tested the WHOLE ROW for /ACTIVE/ and fell through to PARKED on
 * anything else, so an emptied, misspelled or garbage State cell read as
 * "parked" and passed — the ledger could lose its authoritative state with the
 * guard still green, which is the drift this file exists to catch. A stray
 * "ACTIVE" in any other cell also decided the answer. Found by codex on the PR
 * that added this file, which is round 2 of the same hole: see the comment on
 * `charterState` for round 1.
 */
export function ledgerRowState(row: string): 'ACTIVE' | 'PARKED' | null {
    const cell = ledgerStateCell(row);
    const saysActive = /\bACTIVE\b/i.test(cell);
    const saysParked = /\bPARKED\b/i.test(cell);
    if (saysActive === saysParked) return null;
    return saysActive ? 'ACTIVE' : 'PARKED';
}

/** The body of a `## ` section of a markdown file, or '' when it is absent. */
export function section(body: string, heading: string): string {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start === -1) return '';
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^## /.test(l));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** The section that has to carry the verifier's no-write rule. */
export const BAN_SECTION = 'The rule that makes you worth invoking';

/**
 * Why the verifier's shell ban is not operative, or [] when it is.
 *
 * ⚠️ READ THE OPERATIVE SECTION, NOT THE WHOLE FILE. The first version asserted
 * the backticked command names appeared ANYWHERE in `verifier.md` — and the
 * explanatory "know the limit of your own cage" paragraph added in the SAME
 * commit also says `sed -i`. So deleting the actual prohibition left the names
 * behind in prose and the assertion stayed green while a shell-equipped checker
 * had no no-write instruction at all. Found by qodo on #699; it is the third
 * time this one assertion has been holed, each time one level further out
 * (bare substrings → backticked substrings → whole-file scope).
 */
export function shellBanErrors(body: string): string[] {
    const ban = section(body, BAN_SECTION);
    if (ban.trim() === '') return [`the "${BAN_SECTION}" section is missing`];

    const errors: string[] = [];
    if (!/you may not edit anything/i.test(ban)) {
        errors.push(`the "${BAN_SECTION}" section must state that the verifier may not edit anything`);
    }
    for (const cmd of ['`sed -i`', '`tee`', '`git apply`', '`patch`']) {
        if (!ban.includes(cmd)) {
            errors.push(`the ban must name ${cmd} among the writes the shell may not run`);
        }
    }
    return errors;
}

/** One CI step, with the two fields that decide whether it can run at all. */
export type CiStep = { run: string; dir: string; cond: string; continueOnError: string };

/** Parse a job block's steps. */
export function parseSteps(job: string): CiStep[] {
    return job.split(/^ {6}- /m).slice(1).map((chunk) => ({
        run: chunk.match(/run:\s*(.+)/)?.[1].trim() ?? '',
        dir: chunk.match(/working-directory:\s*(.+)/)?.[1].trim() ?? '.',
        cond: chunk.match(/^\s*if:\s*(.+)$/m)?.[1].trim() ?? '',
        continueOnError: chunk.match(/^\s*continue-on-error:\s*(.+)$/m)?.[1].trim() ?? '',
    }));
}

/**
 * The steps that actually gate: no `if:` and no `continue-on-error: true`.
 *
 * ⚠️ THE PARSER USED TO READ ONLY `run` AND `working-directory`, so a step's
 * ABILITY TO RUN was invisible to every assertion built on it. Adding
 * `if: false` to the ratchet step or the functions-build step left both
 * invariants green while the required gate never executed — a guard that looks
 * like it guards, in the file whose subject is that. Found by qodo on #699.
 *
 * ANY `if:` disqualifies the step, not just a falsy-looking one: the condition's
 * runtime value is not knowable from the YAML, so `if: ${{ env.SKIP != '1' }}`
 * is indistinguishable here from `if: false`. A required gate that runs
 * conditionally is not required. If one of these steps ever genuinely needs a
 * condition, that is a deliberate change to this test — which is the point.
 */
export function runnableSteps(all: CiStep[]): CiStep[] {
    return all.filter((s) => s.cond === '' && !masksFailure(s.continueOnError));
}

/**
 * Whether a `continue-on-error:` value can stop the job from failing.
 *
 * ⚠️ `!== 'true'` IS NOT ENOUGH. GitHub Actions accepts an expression here, and
 * `continue-on-error: ${{ true }}` makes the step non-blocking while reading as
 * anything but the literal string `true`. Found by codex on #699, reviewing the
 * fix for the `if:`-blindness qodo found — the same hole one syntax layer down.
 *
 * Only the two literals that definitely do NOT mask a failure are allowed
 * through. Anything else — an expression, a YAML-truthy spelling (`yes`, `on`,
 * `True`), an unknown value — counts as masking, because a value this test
 * cannot evaluate must not be assumed harmless on a required gate.
 */
export function masksFailure(continueOnError: string): boolean {
    const v = continueOnError.trim();
    if (v === '') return false;
    return !['false', 'False'].includes(v);
}

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
     * A step's command AND the directory it runs in, as one unit.
     *
     * ⚠️ The first version of this asserted `job.toContain('npm run build')`,
     * which is worthless here: the root build step runs `npm run build:static`,
     * and `npm run build` is a substring of it. The assertion passed with the
     * functions build step deleted — a guard that looked like it guarded, in a
     * file whose entire purpose is stopping that. Caught by self-review of this
     * diff, which is what CLAUDE.md §2c says self-review is for.
     */
    /**
     * A required command only gates if the step carrying it CAN RUN.
     * `runnableSteps` drops the ones that cannot; the assertions below look for
     * the commands among those, never among all steps.
     */
    function runnable(job: string): CiStep[] {
        return runnableSteps(parseSteps(job));
    }

    /**
     * The `lint` JOB NAME is the required status check in the repository
     * ruleset, so it must keep that name — what changes is the command inside.
     *
     * ⚠️ Exact equality, and `continue-on-error` checked explicitly. The first
     * version used `toContain('npm run lint:ratchet')`, which
     * `npm run lint:ratchet || true` satisfies — a required check that always
     * passes. The functions-build assertion below had already been fixed for
     * exactly this and the fix was not carried across; a review caught it.
     */
    it('runs the ratchet, not bare eslint, in the required lint job', () => {
        const lint = jobBlock('lint');
        const commands = runnable(lint).map((s) => s.run);

        expect(
            commands,
            'the lint job must run the capped ratchet in a step that can actually run',
        ).toContain('npm run lint:ratchet');
        expect(
            commands,
            'the lint job must not fall back to uncapped `npm run lint`',
        ).not.toContain('npm run lint');
        expect(
            /continue-on-error:\s*true/.test(lint),
            'continue-on-error would make the required lint check unable to fail',
        ).toBe(false);
    });

    /**
     * CLAUDE.md §2e lists seven gates. `npm --prefix functions run build` was on
     * that list and in no automated gate anywhere until 2026-09-19, so the emit
     * that `firebase deploy` performs was exercised only by a deploy.
     */
    it('runs the functions deploy build, not just the typecheck', () => {
        const inFunctions = runnable(jobBlock('build-and-test')).filter((s) => s.dir === 'functions');
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
     * The charter is the ledger, so the skill must AGREE WITH IT — not merely
     * say something state-shaped.
     *
     * ⚠️ The first version accepted any token from a list and never looked at
     * the charter at all: flipping audit-sweep to "Still parked" while the
     * ledger still read ACTIVE passed. An activation ledger that no test
     * compares against is the same unreadable-state problem this PR is fixing,
     * one level up. Found by a review.
     *
     * The ledger row is the authority; a skill declaring both tokens, or the
     * wrong one, fails.
     */
    function charterState(skill: string): 'ACTIVE' | 'PARKED' {
        const row = read(CHARTER)
            .split('\n')
            .find((l) => l.startsWith('|') && l.includes(skill));
        expect(row, `${skill} must have a row in the charter ledger`).toBeDefined();
        const state = ledgerRowState(row!);
        expect(
            state,
            `${skill}'s State cell in the charter ledger must say exactly one of ACTIVE / Parked — got "${ledgerStateCell(row!)}"`,
        ).not.toBeNull();
        return state!;
    }

    it.each(loopSkills)('%s declares the same state the charter ledger gives it', (skill) => {
        const body = read(path.join('.claude', 'skills', skill, 'SKILL.md'));
        const saysActive = body.includes('**ACTIVE');
        const saysParked = body.includes('**Still parked**');

        expect(
            saysActive !== saysParked,
            `${skill} must declare exactly one of **ACTIVE / **Still parked** (active=${saysActive}, parked=${saysParked})`,
        ).toBe(true);
        expect(saysActive ? 'ACTIVE' : 'PARKED', `${skill} contradicts the charter ledger`).toBe(
            charterState(skill),
        );
    });
});

describe('charter ledger State cell', () => {
    const row = (state: string) =>
        `| 1 | Audit-trail integrity sweep | \`mmp-loop-audit-sweep\` | No | some verifier | Windows box | ${state} |`;

    it('reads the two states the ledger actually uses', () => {
        expect(ledgerRowState(row('🟢 **ACTIVE 2026-09-19**'))).toBe('ACTIVE');
        expect(ledgerRowState(row('⚪ Parked'))).toBe('PARKED');
        expect(ledgerRowState(row('⚪ Parked. Auto-merge is a **second, separate** approval'))).toBe('PARKED');
    });

    /** The hole: anything unrecognised used to read as PARKED and pass. */
    it.each(['', '   ', '⚪', 'PARKEDD', 'Paused', 'TBD', '🟢 **ACTIV 2026-09-19**'])(
        'refuses to guess a state from %p',
        (state) => {
            expect(ledgerRowState(row(state))).toBeNull();
        },
    );

    it('refuses a cell that claims both states', () => {
        expect(ledgerRowState(row('ACTIVE, but Parked until approved'))).toBeNull();
    });

    /** A stray token in another column must not decide the answer. */
    it('ignores ACTIVE outside the State cell', () => {
        const misleading =
            '| 2 | Stale PR pruner | `mmp-loop-pr-pruner` | ACTIVE closes PRs | verifier | Cloud | ⚪ Parked |';
        expect(ledgerRowState(misleading)).toBe('PARKED');
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
        const declared = frontmatter.match(/^tools:\s*(.+)$/m)?.[1] ?? '';
        const tools = declared.split(',').map((t) => t.trim()).filter((t) => t.length > 0);

        /**
         * ⚠️ THE STRONGER ATTACK IS DELETION, NOT ADDITION. An agent with NO
         * `tools:` line inherits the full default set — Edit and Write included
         * — so a missing list is the permissive case, not the restrictive one.
         * The first version split the empty string, got `['']`, and passed a
         * length check with the line deleted: it caught `tools: ..., Edit` and
         * missed the thing that actually hands the checker a pen. Found by a
         * review; it is the defect class this whole file exists to stop,
         * sitting in the assertion meant to stop it.
         */
        expect(
            tools,
            'the verifier must declare an explicit tool list — no list means it inherits Edit and Write',
        ).not.toHaveLength(0);
        for (const required of ['Read', 'Bash']) {
            expect(tools, `verifier needs ${required} to review anything`).toContain(required);
        }
        for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
            expect(tools, `verifier must not hold ${forbidden}`).not.toContain(forbidden);
        }
    });

    /**
     * ⚠️ WITHHOLDING Edit/Write DOES NOT MAKE THE CHECKER UNABLE TO WRITE. It
     * holds `Bash`, and a shell writes through `sed -i`, `tee`, `>`,
     * `git apply`, `patch`. Agent frontmatter has no read-only-filesystem
     * switch, so the shell half of the boundary is an instruction, and the
     * assertion above enforces only the named-tool half. That gap is fine; a
     * DESCRIPTION CLAIMING THE GAP SHUT IS NOT — it is this repo's signature
     * defect (a guard that looks like it guards) aimed at the one agent whose
     * verdict people would trust. Found by codex round 2 on this PR.
     *
     * So: while the verifier holds a shell, its prompt must ban writing through
     * it by name, and must not promise it cannot edit at all.
     */
    it('does not promise more separation than it enforces', () => {
        const body = read(AGENT);
        const frontmatter = body.split('---')[1] ?? '';
        const tools = (frontmatter.match(/^tools:\s*(.+)$/m)?.[1] ?? '')
            .split(',')
            .map((t) => t.trim());
        if (!tools.includes('Bash')) return; // no shell, no gap to disclose

        // Scoped to the OPERATIVE section and backticked, so neither explanatory
        // prose elsewhere in the file nor a bare word inside another word
        // ("guarantee" for 'tee', "dispatch" for 'patch') can satisfy it.
        expect(
            shellBanErrors(body),
            'verifier holds Bash, so its no-write rule must be operative',
        ).toEqual([]);

        // The overclaim the description used to make, in the forms it could take.
        for (const overclaim of [
            'cannot edit any file',
            'can not edit any file',
            'unable to edit any file',
        ]) {
            expect(
                body.toLowerCase(),
                `verifier holds Bash, so it must not claim it "${overclaim}"`,
            ).not.toContain(overclaim);
        }
    });
});

/**
 * The guards on the guards. Both assertions above were holed by a reviewer who
 * noticed they inspected the wrong thing — `shellBanErrors` searched the whole
 * file, `parseSteps` could not see whether a step runs. Mutating the real files
 * proves a fix once, by hand; these fixtures prove it on every CI run, which is
 * the difference between a ratchet and a ritual.
 */
describe('the guards hold under mutation', () => {
    describe('shellBanErrors', () => {
        const OPERATIVE = [
            '# verifier',
            '',
            '## The rule that makes you worth invoking',
            '',
            '**You may not edit anything.** No `Edit`, no `Write` — and you never run',
            '`sed -i`, `tee`, `>` redirection, `git apply`, `patch`, or any other write.',
            '',
            '## What to check, in order',
            '',
            'Nothing here matters to the ban.',
        ].join('\n');

        it('accepts a prompt whose ban names every shell write', () => {
            expect(shellBanErrors(OPERATIVE)).toEqual([]);
        });

        /**
         * THE EXACT HOLE qodo FOUND. The prohibition is gone; the explanatory
         * paragraph still mentions the same backticked commands. A whole-file
         * search passes this and a scoped one does not.
         */
        it('rejects a prompt where only explanatory prose mentions the commands', () => {
            const holed = [
                '# verifier',
                '',
                '## What to check, in order',
                '',
                'Know the limit of your own cage: nothing stops a `sed -i`, a `tee`, a',
                '`git apply` or a `patch` but you.',
            ].join('\n');

            expect(shellBanErrors(holed)).toContain(
                `the "${BAN_SECTION}" section is missing`,
            );
        });

        it('rejects a ban that drops one of the commands', () => {
            expect(shellBanErrors(OPERATIVE.replace('`tee`, ', ''))).toEqual([
                'the ban must name `tee` among the writes the shell may not run',
            ]);
        });

        it('rejects a section that lists commands but never forbids editing', () => {
            const noRule = OPERATIVE.replace('**You may not edit anything.**', 'Some other text.');
            expect(shellBanErrors(noRule)).toContain(
                `the "${BAN_SECTION}" section must state that the verifier may not edit anything`,
            );
        });
    });

    describe('runnableSteps', () => {
        const job = (extra = '') =>
            [
                '    steps:',
                '      - uses: actions/checkout@v4',
                '      - name: Lint',
                `        run: npm run lint:ratchet${extra ? '\n' + extra : ''}`,
            ].join('\n');

        it('keeps an unconditional step', () => {
            expect(runnableSteps(parseSteps(job())).map((s) => s.run)).toContain(
                'npm run lint:ratchet',
            );
        });

        /** THE HOLE qodo FOUND: `if: false` left the invariant green. */
        it.each(['        if: false', "        if: ${{ env.SKIP_LINT != '1' }}", '        if: always()'])(
            'drops a step carrying %p, because a conditional gate is not a gate',
            (cond) => {
                expect(runnableSteps(parseSteps(job(cond))).map((s) => s.run)).not.toContain(
                    'npm run lint:ratchet',
                );
            },
        );

        it('drops a step that cannot fail the job', () => {
            expect(
                runnableSteps(parseSteps(job('        continue-on-error: true'))).map((s) => s.run),
            ).not.toContain('npm run lint:ratchet');
        });

        it('keeps a step that explicitly does not continue on error', () => {
            expect(
                runnableSteps(parseSteps(job('        continue-on-error: false'))).map((s) => s.run),
            ).toContain('npm run lint:ratchet');
        });

        /** codex's follow-up: the literal `true` was never the only spelling. */
        it.each([
            '        continue-on-error: ${{ true }}',
            '        continue-on-error: ${{ github.event_name == \'push\' }}',
            '        continue-on-error: yes',
            '        continue-on-error: True',
        ])('drops a step whose failure masking is spelled %p', (masked) => {
            expect(runnableSteps(parseSteps(job(masked))).map((s) => s.run)).not.toContain(
                'npm run lint:ratchet',
            );
        });

        it('treats only the unambiguous negatives as non-masking', () => {
            expect(masksFailure('')).toBe(false);
            expect(masksFailure('false')).toBe(false);
            expect(masksFailure('true')).toBe(true);
            expect(masksFailure('${{ inputs.lenient }}')).toBe(true);
        });
    });
});
