import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { helpRegistry } from '../src/help/registry';
import { MANAGER_LABEL_ALLOWLIST } from '../src/help/coverage-allowlist';
import { POOL_TYPES } from '../shared/poolTypes';
import { stripComments } from './help-ui-coverage.test';

/**
 * MANAGER-FORM COVERAGE — PLAN-HELP-SYSTEM.md §3 D5, ticket T4.
 *
 * `help-ui-coverage.test.ts` covers `src/components/wizard/**` and says so in
 * its own header: *"T4–T7 add the hand-rolled-label half (zero raw `<label` in
 * the named manager files)"*. This is that half, for T4's file.
 *
 * WHY IT IS A SEPARATE FILE. The wizard's controls are react-hook-form
 * BINDINGS — the guard there greps `name=`, `register(...)`, `feeField=` and
 * resolves each as a schema path. A manager form has none of that: its inputs
 * are plain `useState` with a label above them, so the only thing that
 * identifies a control is the label text a person reads. Two different
 * questions, two different greps.
 *
 * The rule, in one line: **no raw `<label` in these files, and every
 * `FieldLabel` either carries a `helpId` that resolves, or has a row in
 * `MANAGER_LABEL_ALLOWLIST` naming the ticket that will write its copy.**
 */

const root = resolve(__dirname, '..');

/** The files T4 owns. T5–T7 add theirs to this list as they land. */
const MANAGER_FILES = ['src/components/NFLPoolDashboard/NFLManagerView.tsx'];

const codeOf = (file: string) => stripComments(readFileSync(resolve(root, file), 'utf8'));

/**
 * Every `<FieldLabel …>text</FieldLabel>` in a file, as `{ helpId, text }`.
 *
 * Non-greedy to the first `</FieldLabel>`, because these never nest.
 */
function fieldLabels(code: string): { helpId?: string; text: string }[] {
  const out: { helpId?: string; text: string }[] = [];
  const re = /<FieldLabel\b([^>]*)>([\s\S]*?)<\/FieldLabel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const attrs = m[1];
    const helpId = /helpId="([^"]+)"/.exec(attrs)?.[1];
    out.push({ helpId, text: m[2].trim() });
  }
  return out;
}

describe('T4 — the NFL manager form has no un-helped label', () => {
  it.each(MANAGER_FILES)('%s renders no raw <label', file => {
    // THE HEADLINE ASSERTION. A raw `<label` is a control with no route to a
    // help topic AND, on this form, a label with no `htmlFor` — which announces
    // to a screen reader as a stray string. `FieldLabel` fixes both.
    expect(codeOf(file).match(/<label\b/g) ?? []).toEqual([]);
  });

  it.each(MANAGER_FILES)('%s renders at least one FieldLabel — the grep is live', file => {
    // Without this, deleting every label in the file would pass the test above.
    expect(fieldLabels(codeOf(file)).length).toBeGreaterThan(20);
  });

  it.each(MANAGER_FILES)('every FieldLabel in %s has a topic or a written reason', file => {
    const unaccounted = fieldLabels(codeOf(file))
      .filter((l) => !l.helpId)
      .filter((l) => MANAGER_LABEL_ALLOWLIST[l.text] === undefined)
      .map((l) => l.text);
    expect(unaccounted).toEqual([]);
  });

  it('every helpId on a manager label resolves to a real topic', () => {
    // `HelpTip` returns null on an unknown id rather than throwing — so content
    // can land ticket by ticket — which is exactly why a typo would otherwise
    // be invisible. `resolveTopic` filters by pool type and audience, so an id
    // is "real" here if it resolves for SOME NFL commissioner scope.
    const NFL: readonly string[] = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
    const missing = MANAGER_FILES.flatMap((file) =>
      fieldLabels(codeOf(file))
        .map((l) => l.helpId)
        .filter((id): id is string => !!id)
        .filter(
          (id) =>
            !POOL_TYPES.filter((t) => NFL.includes(t)).some((poolType) =>
              helpRegistry.resolveTopic({ poolType, audience: 'commissioner' }, id),
            ),
        ),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it('no allowlist row is stale', () => {
    // A row nothing references is an exemption nobody reviewed. It is also how
    // a ticket looks finished when it is not: T10 removing a control without
    // removing its row would leave the count of "still to write" wrong.
    const rendered = new Set(
      MANAGER_FILES.flatMap((file) => fieldLabels(codeOf(file)).filter((l) => !l.helpId).map((l) => l.text)),
    );
    const stale = Object.keys(MANAGER_LABEL_ALLOWLIST).filter((text) => !rendered.has(text));
    expect(stale).toEqual([]);
  });

  it('every allowlist reason names a ticket or PERMANENT', () => {
    // Same rule the schema allowlist carries. "TODO" is not a reason.
    const vague = Object.entries(MANAGER_LABEL_ALLOWLIST)
      .filter(([, reason]) => !/^(PERMANENT|T\d+)\b/.test(reason.trim()))
      .map(([text]) => text);
    expect(vague).toEqual([]);
  });

  it('the greps discriminate — they catch the shapes T4 removed', () => {
    // A guard that matches nothing looks identical to a guard that passes.
    // These are the exact forms this ticket converted, verbatim.
    const raw = '<label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Pool Name</label>';
    expect(stripComments(raw).match(/<label\b/g)).toHaveLength(1);
    expect(fieldLabels(stripComments(raw))).toEqual([]);

    const helped = '<FieldLabel tone="muted" helpId="name">Pool Name</FieldLabel>';
    expect(stripComments(helped).match(/<label\b/g)).toBeNull();
    expect(fieldLabels(stripComments(helped))).toEqual([{ helpId: 'name', text: 'Pool Name' }]);

    const bare = '<FieldLabel tone="muted">Strikes Limit</FieldLabel>';
    expect(fieldLabels(stripComments(bare))).toEqual([{ helpId: undefined, text: 'Strikes Limit' }]);

    // A comment MENTIONING a raw label must not trip the headline assertion —
    // this file's own explanations of what was removed say the word.
    expect(stripComments('// replaced the raw <label> with FieldLabel\n').match(/<label\b/g)).toBeNull();
  });
});

/**
 * The tab strip's hover text is the help page's own summary, not a fifth copy
 * of it. The four `COMMISH_TABS` rows carried their own `hint` string until T4.
 */
describe('T4 — the commissioner tab strip reads its hover text from the registry', () => {
  const code = codeOf(MANAGER_FILES[0]);

  it('reads the page summary and keeps no literal hint', () => {
    expect(code).toMatch(/helpRegistry\.getPage\(`pool\.nfl\.manager\.\$\{tab\}`\)\?\.summary/);
    expect(code).not.toMatch(/hint:\s*'/);
  });

  it('every tab it renders has a page to read', () => {
    // The reader returns `undefined` for a missing page and the button simply
    // has no `title` — quiet, and therefore worth asserting rather than
    // trusting. `buildRegistry` cannot catch this: nothing places a topic on a
    // page just because a tab exists.
    for (const tab of ['overview', 'members', 'scoring', 'settings']) {
      const page = helpRegistry.getPage(`pool.nfl.manager.${tab}`);
      expect(page, `pool.nfl.manager.${tab} should exist`).toBeTruthy();
      expect(page!.summary.length).toBeGreaterThan(0);
    }
  });
});
