import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { helpRegistry, normalizePath } from '../src/help/registry';
import type { TopicScope } from '../src/help/registry';
import { WIZARD_FIELD_ALLOWLIST } from '../src/help/coverage-allowlist';
import { POOL_TYPES } from '../shared/poolTypes';

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

/**
 * Whether ANY pool type's reader can resolve this id.
 *
 * Per-type resolution is not asserted here on purpose: a wizard file is
 * type-specific, and mapping file → pool type by name would be a second,
 * weaker copy of the step lists. The registry invariants already refuse a
 * topic scoped to a type it is not placed for; this asks the question this
 * test exists for — does a reader ever see help for this control.
 */
function resolvableAnywhere(id: string): boolean {
  const scopes: TopicScope[] = [
    { audience: 'commissioner' },
    ...POOL_TYPES.map((poolType) => ({ poolType, audience: 'commissioner' as const })),
  ];
  return scopes.some((scope) => helpRegistry.resolveTopic(scope, id) !== undefined);
}

function explains(path: string): boolean {
  return resolvableAnywhere(path) || CLAIMED_FIELDS.has(path);
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
      ({ path }) => !explains(path) && !(path in WIZARD_FIELD_ALLOWLIST),
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
        .filter((id) => !resolvableAnywhere(id))
        .map((id) => `${file.split(/[\\/]/).pop()}: helpId="${id}"`),
    );
    expect(problems).toEqual([]);
  });

  it('no allowlist row names a field the wizard no longer binds', () => {
    const bound = new Set(ALL_BINDINGS.map((b) => b.path));
    const stale = Object.keys(WIZARD_FIELD_ALLOWLIST).filter((p) => !bound.has(p)).sort();
    expect(stale).toEqual([]);
  });

  it('no allowlist row survives once its field is explained', () => {
    const dead = Object.keys(WIZARD_FIELD_ALLOWLIST).filter(
      (path) => explains(path) && !WIZARD_FIELD_ALLOWLIST[path].startsWith('PERMANENT'),
    );
    expect(dead).toEqual([]);
  });

  it('every allowlist row carries a reason naming a ticket or PERMANENT', () => {
    const vague = Object.entries(WIZARD_FIELD_ALLOWLIST)
      .filter(([, reason]) => !/^(PERMANENT|T\d+)\b/.test(reason.trim()))
      .map(([path]) => path);
    expect(vague).toEqual([]);
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
