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

/**
 * The manager surfaces this guard covers, WITH THE SCOPE EACH ONE IS READ IN.
 *
 * It was a bare string list while T4 owned the only file. T5's first file broke
 * two assumptions that list had baked in, so it is a descriptor now:
 *
 *   `poolTypes` — the helpId-resolution test used to hardcode the three NFL
 *   types. `WizardStepBasics` is the SQUARES commissioner panel, and a topic
 *   like `costPerSquare` resolves for SQUARES and not for NFL — so a single
 *   hardcoded scope would have let a real typo through on one file while
 *   failing a correct id on the other.
 *
 *   `minLabels` — the "the grep is live" floor was a flat 20, which is right
 *   for a 33-label form and would fail a 7-label wizard step for no reason.
 *   Per-file, it still catches the failure it exists for: deleting every label
 *   in a file would otherwise pass the zero-raw-label assertion.
 *
 * T6–T7 add theirs the same way.
 */
interface ManagerSurface {
  file: string;
  /** Pool types a commissioner could be in when this file renders. */
  poolTypes: readonly string[];
  /** Floor for the live-grep check — a little under the real count. */
  minLabels: number;
}

const MANAGER_SURFACES: readonly ManagerSurface[] = [
  {
    file: 'src/components/NFLPoolDashboard/NFLManagerView.tsx',
    poolTypes: ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    minLabels: 20,
  },
  {
    // T5, first slice: the legacy squares admin wizard's Basics step, reached
    // from AdminPanel's Settings tab (`activeTab === 'settings'`, wizard step 1).
    file: 'src/components/admin/WizardStepBasics.tsx',
    poolTypes: ['SQUARES'],
    minLabels: 6,
  },
];

const MANAGER_FILES = MANAGER_SURFACES.map((s) => s.file);

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

  it.each(MANAGER_SURFACES.map((s) => [s.file, s.minLabels] as const))(
    '%s renders at least %d FieldLabels — the grep is live',
    (file, minLabels) => {
      // Without this, deleting every label in the file would pass the test above.
      expect(fieldLabels(codeOf(file)).length).toBeGreaterThanOrEqual(minLabels);
    },
  );

  it.each(MANAGER_FILES)('every FieldLabel in %s has a topic or a written reason', file => {
    const unaccounted = fieldLabels(codeOf(file))
      .filter((l) => !l.helpId)
      .filter((l) => MANAGER_LABEL_ALLOWLIST[l.text] === undefined)
      .map((l) => l.text);
    expect(unaccounted).toEqual([]);
  });

  it('every helpId on a manager label resolves to a real topic IN ITS OWN SCOPE', () => {
    // `HelpTip` returns null on an unknown id rather than throwing — so content
    // can land ticket by ticket — which is exactly why a typo would otherwise
    // be invisible. `resolveTopic` filters by pool type and audience, so an id
    // is "real" here only if it resolves for a commissioner of a pool type THIS
    // FILE actually renders for. Checking against a single hardcoded scope would
    // pass a squares id on the NFL form and vice versa.
    const missing = MANAGER_SURFACES.flatMap((surface) =>
      fieldLabels(codeOf(surface.file))
        .map((l) => l.helpId)
        .filter((id): id is string => !!id)
        .filter(
          (id) =>
            !POOL_TYPES.filter((t) => surface.poolTypes.includes(t)).some((poolType) =>
              helpRegistry.resolveTopic({ poolType, audience: 'commissioner' }, id),
            ),
        )
        .map((id) => `${surface.file}: ${id}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every surface names pool types that exist', () => {
    // A typo in `poolTypes` would silently empty the filter above, and an empty
    // `.some()` is false for every id — so the resolution test would fail with a
    // confusing message, or worse, a future `.every()` rewrite would pass
    // vacuously. Pin the descriptor itself.
    for (const surface of MANAGER_SURFACES) {
      const unknown = surface.poolTypes.filter((t) => !POOL_TYPES.includes(t as never));
      expect(unknown, `${surface.file} names pool types that do not exist`).toEqual([]);
    }
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
