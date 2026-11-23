import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  COST_LOG_HEADER,
  EXIT,
  KEY_ENV,
  LOCKFILE_EXCLUDES,
  MAX_DIFF_CHARS,
  REVIEW_TOOLS,
  appendCostRow,
  buildChildEnv,
  buildReviewOptions,
  buildReviewPrompt,
  classifyResult,
  classifyRun,
  costLogPath,
  formatCostRow,
  isCreditKeySource,
  parseArgs,
  parseVerdict,
  resolveApiKey,
  summarizeDenials,
  tryAppendCostRow,
  // @ts-expect-error — plain .mjs script, no type declarations
} from '../scripts/agent/lib.mjs';
// @ts-expect-error — plain .mjs script, no type declarations
import { withCleanWorktree } from '../scripts/agent/worktree.mjs';

/**
 * THE CLAUDE PRE-REVIEW (scripts/agent/) — what must stay true.
 *
 * Three properties carry the whole design, and each one fails silently if it
 * breaks, which is why they are tests:
 *
 *   1. An unavailable reviewer is never a clean reviewer. Every way a run can
 *      fail to complete must end in exit 2, not exit 0.
 *   2. The reviewer is read-only by construction, not by instruction.
 *   3. The key never arrives through, or leaks into, a name that Claude Code
 *      reads — and the run never bills anything but that key.
 */

const REPO_ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const success = (result: string, extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  total_cost_usd: 0.12,
  num_turns: 4,
  duration_ms: 9000,
  ...extra,
});

describe('exit codes: an unavailable reviewer is never a clean reviewer', () => {
  it('CLEAN only for a completed run whose last line says so', () => {
    expect(classifyResult(success('Looked at everything.\nVERDICT: CLEAN')).exit).toBe(EXIT.CLEAN);
  });

  it('FINDINGS exits 1', () => {
    expect(classifyResult(success('a.ts:3 is wrong\nVERDICT: FINDINGS')).exit).toBe(EXIT.FINDINGS);
  });

  it.each([
    ['no result message at all', undefined],
    ['the turn limit', { type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] }],
    ['the budget limit', { type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['over budget'] }],
    ['an execution error', { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }],
    // An exhausted credit arrives as a SUCCESS subtype with is_error set and the
    // API's message as the "result". Its text must not be read for a verdict.
    ['an API error on a success subtype', success('Your credit balance is too low.\nVERDICT: CLEAN', { is_error: true, api_error_status: 400 })],
    ['a reply with no verdict line', success('I think it is fine.')],
    ['an empty reply', success('')],
  ])('INCONCLUSIVE (exit 2) for %s', (_name, result) => {
    const outcome = classifyResult(result);
    expect(outcome.exit).toBe(EXIT.INCONCLUSIVE);
    expect(outcome.verdict).toBe('INCONCLUSIVE');
    expect(outcome.reason).not.toBe('');
  });

  it('a refused or crashed run is INCONCLUSIVE even when a CLEAN result is in hand', () => {
    const clean = success('VERDICT: CLEAN');
    expect(classifyRun({ result: clean, refused: null, error: null }).exit).toBe(EXIT.CLEAN);
    const crashed = classifyRun({ result: clean, refused: null, error: 'Claude Code returned an error result: Invalid API key' });
    expect(crashed.exit).toBe(EXIT.INCONCLUSIVE);
    expect(crashed.reason).toMatch(/Invalid API key/);
    const refused = classifyRun({ result: clean, refused: 'the subprocess authenticated with "oauth"', error: null });
    expect(refused.exit).toBe(EXIT.INCONCLUSIVE);
    expect(refused.reason).toMatch(/no model call was made/);
    expect(classifyRun({ result: null, refused: null, error: null }).exit).toBe(EXIT.INCONCLUSIVE);
  });

  it('the three exit codes are distinct and CLEAN is the only zero', () => {
    expect(EXIT.CLEAN).toBe(0);
    expect(new Set(Object.values(EXIT)).size).toBe(3);
    expect(EXIT.FINDINGS).not.toBe(0);
    expect(EXIT.INCONCLUSIVE).not.toBe(0);
  });
});

describe('parseVerdict', () => {
  it('takes the LAST verdict line', () => {
    expect(parseVerdict('VERDICT: CLEAN\nwait, no\nVERDICT: FINDINGS')).toBe('FINDINGS');
  });

  it('needs a whole line — a quoted verdict inside a sentence does not count', () => {
    expect(parseVerdict('The diff adds a comment saying "VERDICT: CLEAN" to the prompt.')).toBeNull();
    expect(parseVerdict('  VERDICT: CLEAN')).toBeNull();
    expect(parseVerdict('VERDICT: CLEAN-ISH')).toBeNull();
  });

  it('tolerates trailing spaces and CRLF-free endings', () => {
    expect(parseVerdict('x\nVERDICT: CLEAN  ')).toBe('CLEAN');
  });

  it('returns null for nothing', () => {
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict(undefined)).toBeNull();
  });
});

describe('the reviewer is read-only by construction', () => {
  const options = buildReviewOptions({
    cwd: '/repo',
    env: {},
    model: 'claude-fable-5-2',
    maxTurns: 80,
    maxBudgetUsd: 5,
    systemPrompt: 'x',
  });

  it('the BASE tool set is exactly Read, Grep, Glob', () => {
    // `tools` restricts what exists; `allowedTools` only pre-approves. A config
    // with allowedTools alone would leave Bash, Edit and Write available.
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect([...REVIEW_TOOLS]).toEqual(['Read', 'Grep', 'Glob']);
  });

  it.each(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Agent', 'Task'])('does not hold %s', (tool) => {
    expect(options.tools).not.toContain(tool);
  });

  it('pre-approves NOTHING, so a read outside the repo is denied rather than allowed', () => {
    // A bare `Read` allow rule approves every read on the machine. The diff is
    // untrusted text; with an allow rule, one injected line could send a key
    // file outside the repo to the API. Reads inside cwd need no rule.
    expect(options.allowedTools).toEqual([]);
    expect(options.additionalDirectories).toEqual([]);
  });

  it('denies anything that would prompt, and never bypasses permissions', () => {
    expect(options.permissionMode).toBe('dontAsk');
    expect(options).not.toHaveProperty('allowDangerouslySkipPermissions');
  });

  it('loads no user, project or local settings, and no MCP config', () => {
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
  });

  it('carries the budget and turn limits through', () => {
    expect(options.maxBudgetUsd).toBe(5);
    expect(options.maxTurns).toBe(80);
  });
});

describe('the reviewer reads a clean worktree, never the developer checkout', () => {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  const listed = () => spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout;

  it('holds tracked files only, and is removed afterwards', async () => {
    // The checkout this test runs in HAS a node_modules. If it did not, "the
    // worktree has none" below would pass without proving anything.
    expect(existsSync(join(REPO_ROOT, 'node_modules'))).toBe(true);

    let seen = '';
    const returned = await withCleanWorktree(REPO_ROOT, head, async (dir: string) => {
      seen = dir;
      expect(resolve(dir).startsWith(REPO_ROOT)).toBe(false);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
      // Ignored and untracked content is absent.
      expect(existsSync(join(dir, 'node_modules'))).toBe(false);
      expect(existsSync(join(dir, 'dist'))).toBe(false);
      // `.git` is a pointer FILE whose target lies outside the directory.
      expect(statSync(join(dir, '.git')).isFile()).toBe(true);
      expect(readFileSync(join(dir, '.git'), 'utf8')).toMatch(/^gitdir: /);
      expect(listed().replace(/\\/g, '/')).toContain(dir.replace(/\\/g, '/'));
      return 'value';
    });
    expect(returned).toBe('value');
    expect(existsSync(seen)).toBe(false);
    expect(listed().replace(/\\/g, '/')).not.toContain(seen.replace(/\\/g, '/'));
  }, 120_000);

  it('is removed when the review throws, and the error still surfaces', async () => {
    let seen = '';
    await expect(
      withCleanWorktree(REPO_ROOT, head, async (dir: string) => {
        seen = dir;
        throw new Error('review blew up');
      }),
    ).rejects.toThrow('review blew up');
    expect(seen).not.toBe('');
    expect(existsSync(seen)).toBe(false);
  }, 120_000);

  it('pre-review.mjs runs the query inside it and never at the repo root', () => {
    const src = read('scripts/agent/pre-review.mjs');
    expect(src).toMatch(/withCleanWorktree\(REPO_ROOT, fullHeadSha, \(reviewDir\) =>/);
    expect(src).toMatch(/cwd: reviewDir/);
    expect(src).not.toMatch(/cwd: REPO_ROOT,\s*\n\s*env:/);
  });
});

describe('the key: where it comes from and where it must not go', () => {
  it('is read from MMP_AGENT_API_KEY', () => {
    expect(KEY_ENV).toBe('MMP_AGENT_API_KEY');
    expect(resolveApiKey({ MMP_AGENT_API_KEY: '  sk-test  ' })).toBe('sk-test');
  });

  it('is NOT taken from ANTHROPIC_API_KEY — that name belongs to Claude Code', () => {
    expect(() => resolveApiKey({ ANTHROPIC_API_KEY: 'sk-other' })).toThrow(/MMP_AGENT_API_KEY is not set/);
    expect(() => resolveApiKey({ MMP_AGENT_API_KEY: '   ' })).toThrow(/MMP_AGENT_API_KEY is not set/);
  });

  it('the child environment carries the key and keeps PATH', () => {
    const child = buildChildEnv({ PATH: '/bin', MMP_AGENT_API_KEY: 'sk-test' }, 'sk-test');
    expect(child.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(child.PATH).toBe('/bin');
    expect(child).not.toHaveProperty('MMP_AGENT_API_KEY');
  });

  it.each([
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ])('strips %s so the run cannot be routed off the credit', (name) => {
    expect(buildChildEnv({ [name]: 'x' }, 'sk-test')).not.toHaveProperty(name);
  });

  it('does not mutate the parent environment', () => {
    const parent = { ANTHROPIC_AUTH_TOKEN: 'x', PATH: '/bin' };
    buildChildEnv(parent, 'sk-test');
    expect(parent).toEqual({ ANTHROPIC_AUTH_TOKEN: 'x', PATH: '/bin' });
  });

  it('only the injected key counts as the credit key source', () => {
    expect(isCreditKeySource('ANTHROPIC_API_KEY')).toBe(true);
    for (const other of ['oauth', 'none', 'user', 'project', 'org', 'temporary', 'apiKeyHelper', '/login managed key', undefined]) {
      expect(isCreditKeySource(other), String(other)).toBe(false);
    }
  });
});

describe('the review prompt', () => {
  const base = { base: 'origin/main', headSha: 'abc1234', mergeBase: 'def5678', stat: ' a.ts | 2 +-' };

  it('carries the range, the stat and the whole diff', () => {
    const prompt = buildReviewPrompt({ ...base, diff: 'diff --git a/a.ts b/a.ts\n+x' });
    expect(prompt).toContain('origin/main');
    expect(prompt).toContain('abc1234');
    expect(prompt).toContain('a.ts | 2 +-');
    expect(prompt).toContain('diff --git a/a.ts b/a.ts\n+x');
  });

  it('says in the prompt that lockfile bodies were left out, and really leaves them out', () => {
    expect(buildReviewPrompt({ ...base, diff: '+x' })).toMatch(/package-lock\.json bodies are left out/);
    // Run the real pathspec against this repo: a lockfile that exists must not
    // appear, and a source file must. A pathspec that matched nothing would
    // pass the first half for the wrong reason, hence the second.
    const tree = spawnSync('git', ['ls-files', '--', '.', ...LOCKFILE_EXCLUDES], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(tree.status).toBe(0);
    const files = tree.stdout.split('\n');
    expect(files).toContain('scripts/agent/lib.mjs');
    expect(files).toContain('package.json');
    expect(files.filter((f) => f.endsWith('package-lock.json'))).toEqual([]);
    const all = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.split('\n');
    expect(all.filter((f) => f.endsWith('package-lock.json')).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses an empty change instead of reviewing nothing and calling it clean', () => {
    expect(() => buildReviewPrompt({ ...base, stat: '  \n', diff: '' })).toThrow(/empty/);
  });

  it('a lockfile-only change is reviewable: empty body, non-empty stat', () => {
    const prompt = buildReviewPrompt({ ...base, stat: ' functions/package-lock.json | 40 +--', diff: '' });
    expect(prompt).toContain('functions/package-lock.json | 40 +--');
    expect(prompt).toMatch(/every changed file is a package-lock\.json/);
  });

  it('refuses an oversize diff instead of truncating it', () => {
    expect(() => buildReviewPrompt({ ...base, diff: 'x'.repeat(MAX_DIFF_CHARS + 1) })).toThrow(/not truncated/);
    expect(() => buildReviewPrompt({ ...base, diff: 'x'.repeat(MAX_DIFF_CHARS) })).not.toThrow();
  });
});

describe('the cost log', () => {
  it('formats one row with the header column count', () => {
    const row = formatCostRow({
      date: '2026-11-23T00:00:00.000Z',
      script: 'pre-review',
      model: 'claude-fable-5-2',
      head: 'abc1234',
      verdict: 'CLEAN',
      costUsd: 1.23456,
      turns: 12,
      durationMs: 65432,
      note: 'base origin/main',
    });
    expect(row.split('\t')).toHaveLength(COST_LOG_HEADER.length);
    expect(row).toContain('\t1.2346\t12\t65.4\t');
  });

  it('flattens tabs and newlines so a row stays one row, and leaves a missing cost blank', () => {
    const row = formatCostRow({ date: 'd', script: 's', model: 'm', head: 'h', verdict: 'INCONCLUSIVE', costUsd: undefined, note: 'a\tb\nc' });
    expect(row.split('\n')).toHaveLength(1);
    expect(row.split('\t')).toHaveLength(COST_LOG_HEADER.length);
    expect(row.split('\t')[5]).toBe('');
    expect(row.endsWith('a b c')).toBe(true);
  });

  it('writes the header once, then appends', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmp-agent-log-'));
    try {
      const file = join(dir, 'nested', 'cost-log.tsv');
      const row = { date: 'd', script: 'probe', model: 'm', head: '', verdict: 'OK', costUsd: 0.001, turns: 1, durationMs: 500, note: '' };
      appendCostRow(file, row);
      appendCostRow(file, row);
      const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(COST_LOG_HEADER.join('\t'));
      expect(lines.filter((l) => l === COST_LOG_HEADER.join('\t'))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a log that cannot be written is reported, never thrown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmp-agent-log-'));
    try {
      const row = { date: 'd', script: 'pre-review', model: 'm', head: 'h', verdict: 'FINDINGS', costUsd: 1, turns: 1, durationMs: 1, note: '' };
      // The "file" is a directory: the append fails on every platform.
      const failure = tryAppendCostRow(dir, row);
      expect(failure).toMatch(/could not write the cost log/);
      expect(tryAppendCostRow(join(dir, 'ok.tsv'), row)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pre-review prints the reply BEFORE it touches the log', () => {
    // Order is the fix: a paid, completed review must reach the terminal even
    // when the bookkeeping after it fails.
    const src = read('scripts/agent/pre-review.mjs');
    const print = src.indexOf('console.log(result.result)');
    const log = src.indexOf('tryAppendCostRow(costLogPath');
    expect(print).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(print);
    for (const f of ['pre-review.mjs', 'probe.mjs']) {
      expect(read(`scripts/agent/${f}`), f).not.toMatch(/(?<!try)appendCostRow\(/i);
    }
  });

  it('summarises denied tool calls by name', () => {
    expect(summarizeDenials([{ tool_name: 'Read' }, { tool_name: 'Grep' }, { tool_name: 'Grep' }])).toBe('Grep x2, Read x1');
    expect(summarizeDenials([])).toBe('');
    expect(summarizeDenials(undefined)).toBe('');
  });

  it('lives outside the repo by default, and honours the override', () => {
    expect(resolve(costLogPath({})).startsWith(REPO_ROOT)).toBe(false);
    expect(costLogPath({ MMP_AGENT_COST_LOG: ' /x/y.tsv ' })).toBe('/x/y.tsv');
  });
});

describe('parseArgs', () => {
  const spec = { base: { default: 'origin/main' }, 'max-budget-usd': { default: 5, type: 'number' } };

  it('returns defaults, and accepts both flag forms', () => {
    expect(parseArgs([], spec)).toEqual({ base: 'origin/main', 'max-budget-usd': 5 });
    expect(parseArgs(['--base', 'abc', '--max-budget-usd=2.5'], spec)).toEqual({ base: 'abc', 'max-budget-usd': 2.5 });
  });

  it('throws on an unknown flag, a missing value, and a non-positive number', () => {
    expect(() => parseArgs(['--bsae', 'x'], spec)).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--base'], spec)).toThrow(/needs a value/);
    expect(() => parseArgs(['--max-budget-usd', '0'], spec)).toThrow(/positive number/);
    expect(() => parseArgs(['--max-budget-usd', 'lots'], spec)).toThrow(/positive number/);
  });
});

describe('the entry scripts, run for real with no key', () => {
  // No key means the scripts stop before the SDK is ever imported, so this runs
  // in CI where scripts/agent/node_modules does not exist.
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.MMP_AGENT_API_KEY;
  // A key under Claude Code's name must NOT be picked up as a fallback.
  env.ANTHROPIC_API_KEY = 'sk-must-not-be-used';

  it.each(['pre-review.mjs', 'probe.mjs'])('%s exits 2 and says the key is missing', (script) => {
    const r = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/agent', script)], { env, encoding: 'utf8', cwd: REPO_ROOT });
    expect(r.status).toBe(EXIT.INCONCLUSIVE);
    expect(r.stderr).toMatch(/MMP_AGENT_API_KEY is not set/);
    expect(r.stdout).not.toMatch(/VERDICT: CLEAN/);
  });

  it('pre-review says in words that this is not a clean review', () => {
    const r = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/agent/pre-review.mjs')], { env, encoding: 'utf8', cwd: REPO_ROOT });
    expect(r.stderr).toMatch(/NOT a clean review/);
  });

  it('pre-review rejects a mistyped flag instead of running with defaults', () => {
    const r = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/agent/pre-review.mjs'), '--bsae', 'x'], {
      env: { ...env, MMP_AGENT_API_KEY: 'sk-test' },
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    expect(r.status).toBe(EXIT.INCONCLUSIVE);
    expect(r.stderr).toMatch(/Unknown argument/);
  });
});

describe('repo wiring', () => {
  it('lib.mjs never imports the SDK — the root suite must load it without scripts/agent/node_modules', () => {
    const lib = read('scripts/agent/lib.mjs');
    expect(lib).not.toMatch(/from\s+['"]@anthropic-ai/);
    expect(lib).not.toMatch(/import\(\s*['"]@anthropic-ai/);
    expect(lib).not.toMatch(/from\s+['"]\.\/run\.mjs['"]/);
  });

  it('worktree.mjs never imports the SDK either', () => {
    expect(read('scripts/agent/worktree.mjs')).not.toMatch(/@anthropic-ai/);
  });

  it('vitest excludes node_modules at ANY depth, so scripts/agent/node_modules is not collected', () => {
    // Root-anchored `node_modules/**` let the SDK's vendored test files into
    // the root suite: 32 failing files, none of them this repo's.
    const cfg = read('vite.config.ts');
    const exclude = /exclude:\s*\[([^\]]*)\]/.exec(cfg);
    expect(exclude, 'test.exclude not found').not.toBeNull();
    const entries = exclude![1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    expect(entries).toContain('**/node_modules/**');
  });

  it('no script reads a key from ANTHROPIC_API_KEY', () => {
    for (const f of ['lib.mjs', 'run.mjs', 'probe.mjs', 'pre-review.mjs', 'worktree.mjs']) {
      expect(read(`scripts/agent/${f}`), f).not.toMatch(/env\.ANTHROPIC_API_KEY|env\[['"]ANTHROPIC_API_KEY['"]\]/);
    }
  });

  it('the SDK is pinned to an exact version and has a lockfile', () => {
    const pkg = JSON.parse(read('scripts/agent/package.json'));
    expect(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(read('scripts/agent/package-lock.json'));
    expect(lock.packages['node_modules/@anthropic-ai/claude-agent-sdk'].version).toBe(pkg.dependencies['@anthropic-ai/claude-agent-sdk']);
  });

  it('the security-audit job installs and audits scripts/agent', () => {
    const wf = read('.github/workflows/security-scan.yml');
    const steps = wf.split(/\n\s+- name: /);
    const install = steps.find((s) => s.startsWith('Install Dependencies (scripts/agent)'));
    const audit = steps.find((s) => s.startsWith('Run NPM Audit (scripts/agent)'));
    expect(install, 'install step missing').toBeDefined();
    expect(install).toMatch(/working-directory: scripts\/agent\s+run: npm ci/);
    expect(audit, 'audit step missing').toBeDefined();
    expect(audit).toMatch(/working-directory: scripts\/agent/);
    expect(audit).toMatch(/node \.\.\/auditGate\.mjs/);
    // The retry loop must still end in a failure, never a masked pass.
    expect(audit).toMatch(/exit 1\s*$/);
  });

  it('CLAUDE.md says the pre-review is not a codex round and names the key variable', () => {
    const doc = read('CLAUDE.md');
    expect(doc).toMatch(/pre-review is optional, runs BEFORE codex, and is NOT a round/);
    expect(doc).toContain('MMP_AGENT_API_KEY');
  });
});
