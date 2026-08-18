import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { helpRegistry, normalizePath } from '../src/help/registry';
import { WIZARD_FIELD_ALLOWLIST } from '../src/help/coverage-allowlist';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';

/**
 * UI coverage — PLAN-HELP-SYSTEM.md §3 D5, ticket T1 (the wizard half).
 *
 * THE PRIMARY GUARD. `help-schema-audit.test.ts` proves a setting in the
 * contract is accounted for; it cannot prove a rendered control has a `?`
 * beside it. This reads the wizard's own sources and answers that: every form
 * path a commissioner meets either resolves to a `HelpTopic` or sits in
 * `WIZARD_FIELD_ALLOWLIST` with the ticket that will write its copy.
 *
 * It matters because `HelpTip` returns null on an unknown id rather than
 * throwing — deliberately, so content can land ticket by ticket without
 * breaking the wizard in between. That choice is only safe with this test: it
 * is what stops "no help here" from being indistinguishable from "help here,
 * silently broken".
 *
 * T4–T7 add the hand-rolled-label half (zero raw `<label` in the named manager
 * files); this file covers `src/components/wizard/**` only.
 */

const WIZARD_DIR = resolve(__dirname, '../src/components/wizard');

/**
 * Source with comments removed.
 *
 * Comments in this codebase QUOTE the things this file greps for — the note in
 * `fields.tsx` explaining why `hint=` is gone says the words `hint=` and
 * `register()`. Scanning them found four bindings that do not exist and one
 * `hint=` that had already been deleted. A guard that reports prose as code
 * gets switched off, so the prose is removed first.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(full);
    return e.isFile() && e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [full] : [];
  });
}

/**
 * A form path as the registry would see it.
 *
 * `${...}` becomes `*` for the same reason a numeric index does: the repeated
 * row is one control with one explanation. `props.questions.${i}.text` and
 * `props.questions.3.text` are the same field.
 */
export function normalizeSource(path: string): string {
  return normalizePath(path.replace(/\$\{[^}]*\}/g, '*'));
}

/**
 * Every form path the wizard binds a control to, with the file it is in.
 *
 * Five shapes, matching the five ways this wizard names a field:
 *   name="literal"   name={`template`}   register('…')   register(`…`)
 *   feeField="…" / payoutsField="…"      (paths passed between steps)
 *
 * Anything shaped like a binding but unreadable — `name={someVariable}` — is
 * returned in `unreadable` rather than dropped. A binding the scanner cannot
 * see is indistinguishable from a binding that does not exist, and this whole
 * test would pass vacuously the day someone introduced one.
 */
export function scanBindings(source: string): { paths: string[]; unreadable: string[] } {
  const paths: string[] = [];
  const unreadable: string[] = [];

  const quoted = /\b(?:name|feeField|payoutsField)=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\}|\{"([^"]*)"\})/g;
  for (const m of source.matchAll(quoted)) {
    paths.push(normalizeSource(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]));
  }

  // A JSX binding whose value is neither a string nor a template — a variable,
  // a call, a conditional. `{feeField}` style props are covered by the quoted
  // form at the call site that passes them, so this is genuinely unread.
  const braced = /\b(?:name|feeField|payoutsField)=\{(?![`'"])([^}]*)\}/g;
  for (const m of source.matchAll(braced)) unreadable.push(m[1].trim());

  const registered = /\bregister\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
  for (const m of source.matchAll(registered)) {
    paths.push(normalizeSource(m[1] ?? m[2] ?? m[3]));
  }

  const registeredOther = /\bregister\(\s*(?!['"`])([^,)]*)/g;
  for (const m of source.matchAll(registeredOther)) unreadable.push(`register(${m[1].trim()})`);

  return { paths: [...new Set(paths)], unreadable };
}

/** Every `helpId="literal"` written in the sources. */
export function scanHelpIds(source: string): string[] {
  return [...source.matchAll(/\bhelpId="([^"]*)"/g)].map((m) => m[1]);
}


const FILES = tsxFiles(WIZARD_DIR);
const SOURCES = FILES.map((file) => ({ file, source: stripComments(readFileSync(file, 'utf8')) }));

/**
 * Bindings whose path is supplied by a prop, not written at the site.
 *
 * Each one is READ at the call site that passes the literal in — every
 * `feeField=`/`payoutsField=` value and every `<TextField name="…">` is
 * scanned — so the field is covered; the indirection is only invisible here.
 * Listed explicitly rather than pattern-matched on the identifier, so a NEW
 * dynamic binding fails this file instead of joining a category.
 */
const INDIRECT_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  'fields.tsx': ['register(name)'],
  'StepFeeAndPayment.tsx': ['feeField'],
  'StepPayouts.tsx': ['payoutsField'],
};

/**
 * A path a reader gets an explanation for.
 *
 * Either a topic resolves from the id itself, or a topic CLAIMS the path in
 * its `fields[]` — five payment-handle controls share one topic and carry an
 * explicit `helpId` to it, because voice rule 10 says the sentence explaining
 * a setting exists once.
 */
const CLAIMED_FIELDS = new Set(
  helpRegistry.topics.flatMap((t) => (t.fields ?? []).map(normalizePath)),
);
const ALL_BINDINGS = SOURCES.flatMap(({ file, source }) =>
  scanBindings(source).paths.map((path) => ({ file, path })),
);

/**
 * Which pool types actually render a given wizard file.
 *
 * THE FIRST VERSION OF THIS FILE ASKED THE WRONG QUESTION. It accepted an id
 * that resolved under ANY pool type, which is not the question — `HelpTip`
 * resolves under the scope `WizardShell` publishes, one concrete type. A topic
 * scoped to Survivor would have satisfied coverage for a control that only
 * ever renders in the Bracket wizard, where the tooltip shows nothing. A guard
 * that passes on a control with no help is worse than no guard, and this repo
 * has holed three of them the same way. (qodo #15 on PR #475.)
 *
 * The mapping is derived, not written down: each `Create*Pool.tsx` declares its
 * type on `<WizardShell poolType="…">`, and the files it reaches through
 * relative imports are the ones it renders. So a shared step is checked against
 * every type that uses it, and a type-specific file against its own.
 */
function importsWithin(file: string, source: string): string[] {
  const dir = dirname(file);
  return [...source.matchAll(/from\s+'(\.[^']*)'/g)].flatMap((m) => {
    const base = resolve(dir, m[1]);
    return ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => base + ext).filter(existsSync);
  });
}

const SOURCE_BY_FILE = new Map(SOURCES.map(({ file, source }) => [file, source]));

/** Every wizard file a create wizard reaches, itself included. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length) {
    const current = queue.pop()!;
    const source = SOURCE_BY_FILE.get(current) ?? (existsSync(current) ? readFileSync(current, 'utf8') : '');
    for (const next of importsWithin(current, source)) {
      if (next.startsWith(WIZARD_DIR) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

const CREATE_WIZARDS = SOURCES.flatMap(({ file, source }) => {
  const declared = source.match(/<WizardShell[\s\S]{0,400}?poolType="([A-Z_]+)"/);
  return declared ? [{ file, poolType: declared[1] as PoolType, reaches: reachableFrom(file) }] : [];
});

/**
 * The pool types whose wizard renders this file.
 *
 * A file no create wizard reaches is checked against EVERY type — the strictest
 * reading, because an unreachable file's scope is unknown rather than empty.
 */
function typesRendering(file: string): PoolType[] {
  const owners = CREATE_WIZARDS.filter((w) => w.reaches.has(file)).map((w) => w.poolType);
  return owners.length ? owners : [...POOL_TYPES];
}

/** Does this id resolve under the scope every wizard that renders `file` publishes? */
function resolvesForFile(id: string, file: string): boolean {
  return typesRendering(file).every(
    (poolType) => helpRegistry.resolveTopic({ poolType, audience: 'commissioner' }, id) !== undefined,
  );
}

function explains(path: string, file: string): boolean {
  return resolvesForFile(path, file) || CLAIMED_FIELDS.has(path);
}

describe('scanBindings — the scanner itself', () => {
  it('reads a quoted name', () => {
    expect(scanBindings('<TextField name="settings.entryFee" />').paths).toEqual(['settings.entryFee']);
  });

  it('collapses a template segment and an array index the same way', () => {
    expect(scanBindings('<Controller name={`props.questions.${i}.options`} />').paths).toEqual([
      'props.questions.*.options',
    ]);
    expect(scanBindings("register('props.questions.0.text')").paths).toEqual(['props.questions.*.text']);
  });

  it('reads the fee and payouts path props', () => {
    expect(scanBindings('<StepFeeAndPayment feeField="costPerSquare" />').paths).toEqual(['costPerSquare']);
    expect(scanBindings('<StepPayouts payoutsField="settings.payouts" />').paths).toEqual(['settings.payouts']);
  });

  it('reads a backtick register call', () => {
    expect(scanBindings('register(`${p}.places.${i}.rank`, { valueAsNumber: true })').paths).toEqual([
      '*.places.*.rank',
    ]);
  });

  /**
   * The one that keeps this file honest. A binding the scanner cannot read
   * would otherwise vanish, and every assertion below would pass on a shorter
   * and shorter list without anybody noticing.
   */
  it('reports a binding it cannot read rather than dropping it', () => {
    const out = scanBindings('<TextField name={fieldName} />');
    expect(out.paths).toEqual([]);
    expect(out.unreadable).toEqual(['fieldName']);
  });

  it('reports a register call it cannot read', () => {
    expect(scanBindings('register(dynamicPath)').unreadable).toEqual(['register(dynamicPath)']);
  });
});

describe('the wizard sources', () => {
  it('finds the wizard files at all', () => {
    // Without this, a moved directory would empty every list below and the
    // whole guard would report success.
    expect(FILES.length).toBeGreaterThan(15);
    expect(ALL_BINDINGS.length).toBeGreaterThan(40);
  });

  it('reads every binding in every wizard file, or names it as an indirection', () => {
    const problems = SOURCES.flatMap(({ file, source }) => {
      const name = file.split(/[\\/]/).pop()!;
      const allowed = INDIRECT_BINDINGS[name] ?? [];
      return scanBindings(source)
        .unreadable.filter((u) => !allowed.includes(u))
        .map((u) => `${name}: ${u}`);
    });
    expect(problems).toEqual([]);
  });

  /**
   * And the other direction: an indirection row for a binding that no longer
   * exists would quietly permit a future dynamic binding of the same shape.
   */
  it('no indirection row survives the binding it describes', () => {
    const stale = Object.entries(INDIRECT_BINDINGS).flatMap(([name, expressions]) => {
      const entry = SOURCES.find((s) => s.file.endsWith(name));
      if (!entry) return [`${name}: file is gone`];
      const unreadable = scanBindings(entry.source).unreadable;
      return expressions.filter((e) => !unreadable.includes(e)).map((e) => `${name}: ${e}`);
    });
    expect(stale).toEqual([]);
  });
});

describe('every wizard control has help or a written reason', () => {
  it('no bound field is both unexplained and unaccounted for', () => {
    const problems = ALL_BINDINGS.filter(
      ({ file, path }) => !explains(path, file) && !(path in WIZARD_FIELD_ALLOWLIST),
    ).map(({ file, path }) => `${file.split(/[\\/]/).pop()}: ${path}`);
    expect(problems).toEqual([]);
  });

  /**
   * An explicit `helpId` has NO allowlist escape. A path may legitimately have
   * no copy yet; an id someone typed by hand and got wrong is a broken tooltip
   * that renders nothing and looks exactly like a field with no help.
   */
  it('every explicit helpId resolves to a topic', () => {
    const problems = SOURCES.flatMap(({ file, source }) =>
      scanHelpIds(source)
        .filter((id) => !resolvesForFile(id, file))
        .map((id) => `${file.split(/[\\/]/).pop()}: helpId="${id}"`),
    );
    expect(problems).toEqual([]);
  });

  it('every create wizard declares a pool type the scan can read', () => {
    // Without this the mapping silently empties, `typesRendering` falls back to
    // every type for every file, and the per-wizard claim below goes vacuous.
    expect(CREATE_WIZARDS.map((w) => w.poolType).sort()).toEqual([...POOL_TYPES].sort());
  });

  it('a shared step is attributed to every wizard that renders it', () => {
    const feeStep = FILES.find((f) => f.endsWith('StepFeeAndPayment.tsx'))!;
    expect(typesRendering(feeStep).sort()).toEqual([...POOL_TYPES].sort());
    const props = FILES.find((f) => f.endsWith('CreatePropsPool.tsx'))!;
    expect(typesRendering(props)).toEqual(['PROPS']);
  });

  it('a topic scoped to another pool type does not satisfy coverage', () => {
    // `costPerSquare` is SQUARES-only. It resolves for the squares wizard and
    // must NOT for the props one — which is exactly the pair the first version
    // of this file could not tell apart.
    const squares = FILES.find((f) => f.endsWith('CreateSquaresPool.tsx'))!;
    const props = FILES.find((f) => f.endsWith('CreatePropsPool.tsx'))!;
    expect(resolvesForFile('costPerSquare', squares)).toBe(true);
    expect(resolvesForFile('costPerSquare', props)).toBe(false);
  });

  it('no allowlist row names a field the wizard no longer binds', () => {
    const bound = new Set(ALL_BINDINGS.map((b) => b.path));
    const stale = Object.keys(WIZARD_FIELD_ALLOWLIST).filter((p) => !bound.has(p)).sort();
    expect(stale).toEqual([]);
  });

  it('no allowlist row survives once its field is explained', () => {
    const boundIn = new Map(ALL_BINDINGS.map((b) => [b.path, b.file]));
    const dead = Object.keys(WIZARD_FIELD_ALLOWLIST).filter((path) => {
      const file = boundIn.get(path);
      return file !== undefined
        && explains(path, file)
        && !WIZARD_FIELD_ALLOWLIST[path].startsWith('PERMANENT');
    });
    expect(dead).toEqual([]);
  });

  it('every allowlist row carries a reason naming a ticket or PERMANENT', () => {
    const vague = Object.entries(WIZARD_FIELD_ALLOWLIST)
      .filter(([, reason]) => !/^(PERMANENT|T\d+)\b/.test(reason.trim()))
      .map(([path]) => path);
    expect(vague).toEqual([]);
  });
});

/**
 * Voice rule 5 says to name the default exactly. Nothing checked that the name
 * was RIGHT — and the first draft of this content shipped "Off by default" for
 * a field the wizard defaults to `true`, and "defaults to Wild Card kickoff"
 * for an optional field with no default at all.
 *
 * So each claim is pinned to the line that makes it true. Flip a wizard default
 * and this fails on the copy, which is the only place the drift would otherwise
 * be invisible.
 */
describe('copy that names a default matches the wizard', () => {
  const CLAIMS: readonly { topic: string; file: string; defaultLine: RegExp; says: string }[] = [
    { topic: 'reminders.auto24h', file: 'create/CreatePlayoffPool.tsx', defaultLine: /auto24h:\s*true/, says: 'On by default' },
    { topic: 'reminders.auto1h', file: 'create/CreatePlayoffPool.tsx', defaultLine: /auto1h:\s*true/, says: 'On by default' },
    { topic: 'reminders.autoLock', file: 'create/CreatePlayoffPool.tsx', defaultLine: /autoLock:\s*true/, says: 'On by default' },
    { topic: 'reminders.announceWinner', file: 'create/CreatePlayoffPool.tsx', defaultLine: /announceWinner:\s*true/, says: 'On by default' },
    { topic: 'seasonType', file: 'create/CreateNFLPickemPool.tsx', defaultLine: /seasonType:\s*'2'/, says: 'Regular season is the default' },
    { topic: 'settings.pickMode', file: 'create/CreateNFLPickemPool.tsx', defaultLine: /pickMode:\s*'STRAIGHT'/, says: 'Straight up is the default' },
  ];

  // `isPublic` is set in all seven wizards, so its default is asserted where it
  // is DECLARED for every one of them rather than in one file.
  const ISPUBLIC_FILES = FILES.filter((f) => /Create\w+Pool\.tsx$/.test(f));

  it('the isPublic copy matches the default in every create wizard', () => {
    const wrong = ISPUBLIC_FILES.filter((f) => !/isPublic:\s*true/.test(readFileSync(f, 'utf8'))).map((f) =>
      f.split(/[\\/]/).pop(),
    );
    expect(ISPUBLIC_FILES.length).toBe(7);
    expect(wrong).toEqual([]);

    const topic = helpRegistry.topics.find((t) => t.id === 'isPublic')!;
    expect(typeof topic.short === 'string' ? topic.short : topic.short.fallback).toContain('On by default');
  });

  it.each(CLAIMS)('$topic — the wizard still makes "$says" true', ({ topic, file, defaultLine, says }) => {
    const source = readFileSync(join(WIZARD_DIR, file), 'utf8');
    expect(defaultLine.test(source), `${file} no longer matches ${defaultLine}`).toBe(true);

    const found = helpRegistry.topics.find((t) => t.id === topic);
    expect(found, `${topic} is missing from the registry`).toBeDefined();
    const short = typeof found!.short === 'string' ? found!.short : found!.short.fallback;
    expect(short).toContain(says);
  });

  it('no topic claims a default for lockDate, which has none', () => {
    const lock = helpRegistry.topics.find((t) => t.id === 'lockDate')!;
    const copy = [typeof lock.short === 'string' ? lock.short : lock.short.fallback,
      typeof lock.long === 'string' ? lock.long : lock.long.fallback].join('\n');
    expect(copy).not.toMatch(/by default|defaults to/i);
  });
});

describe('the hint prop is gone', () => {
  /**
   * T1's actual deliverable, as a grep. A `hint=` string is a second place to
   * write help copy — one the panel (T2) and the rules pages (T8) can never
   * read — and the 14 that existed are now topics. This is what stops the
   * fifteenth from being added.
   */
  it('no wizard file passes a hint= prop', () => {
    const offenders = SOURCES.filter(({ source }) => /\bhint=/.test(source)).map(({ file }) =>
      file.split(/[\\/]/).pop(),
    );
    expect(offenders).toEqual([]);
  });

  it('the field primitives declare no hint prop', () => {
    const fields = stripComments(readFileSync(join(WIZARD_DIR, 'fields.tsx'), 'utf8'));
    expect(fields).not.toMatch(/\bhint\s*\??:/);
  });
});
