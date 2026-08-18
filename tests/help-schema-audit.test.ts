import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { getCreateInputSchema } from '../shared/schemas/index';
import { baseTopicId, helpRegistry, normalizePath } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST } from '../src/help/coverage-allowlist';
import type { HelpTopic } from '../src/help/types';

/**
 * Schema coverage audit — PLAN-HELP-SYSTEM.md §3 D5, ticket T0.
 *
 * Answers one question: is there a setting a pool can be created with that no
 * help topic explains and nobody has decided to leave unexplained?
 *
 * This is the SUPPLEMENTAL guard, not the primary one. It proves a setting
 * exists in the contract and is accounted for; it cannot prove a rendered
 * control has a tooltip beside it — `help-ui-coverage.test.ts` (T1) does that
 * by reading the components. Both are needed: a field can be in the schema and
 * on no screen, or on a screen and (for the raw `register()` call sites) in no
 * typed field component.
 *
 * WHY PER POOL TYPE. Checking the UNION of all seven schemas against the union
 * of all topics passes as soon as ONE type explains a shared field. A
 * Survivor-only topic for `settings.entryFee` would then let the allowlist row
 * be deleted while Pick'em, Margin, Bracket, Playoff, Props and Squares still
 * explain nothing — the guard would report full coverage at the exact moment
 * six of seven types lost theirs. Each type is therefore audited against the
 * topics VISIBLE to that type.
 *
 * WHY LEAVES ONLY. The walk emits leaf paths — `settings.payouts.places.*.rank`
 * but not `settings.payouts` or `settings`. A container is not something a
 * reader sets, so demanding a topic for one would buy twenty allowlist rows
 * reading "container" and weaken the signal from the rows that mean something.
 */

/** Array indices are already `*` in a JSON Schema walk; this is belt and braces. */
function flattenLeaves(node: unknown, prefix: string, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;

  // A union contributes every branch's paths — an optional field is
  // `anyOf: [T, undefined]`, and a `z.union` genuinely has two shapes.
  const branches = (n.anyOf ?? n.oneOf ?? n.allOf) as unknown[] | undefined;
  if (Array.isArray(branches)) {
    for (const branch of branches) flattenLeaves(branch, prefix, out);
    return;
  }

  if (n.type === 'array' || n.items) {
    flattenLeaves(n.items, prefix ? `${prefix}.*` : '*', out);
    return;
  }

  if (n.properties) {
    for (const [key, child] of Object.entries(n.properties as Record<string, unknown>)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }

  if (prefix) out.add(prefix);
}

/** Every leaf path of one pool type's create-input schema. */
function leavesFor(type: PoolType): Set<string> {
  const schema = getCreateInputSchema(type);
  if (!schema) throw new Error(`no create-input schema for ${type}`);
  // `io: 'input'` is what the wizard actually submits (before coercion), and
  // `unrepresentable: 'any'` keeps the preprocessed fields (optionalText,
  // optionalDateMillis) from throwing instead of yielding their path.
  const json = z.toJSONSchema(schema as never, { unrepresentable: 'any', io: 'input' } as never);
  const out = new Set<string>();
  flattenLeaves(json, '', out);
  return out;
}

/**
 * The schema paths a viewer of `type` would find explained.
 *
 * A topic's `fields[]` is the explicit list; failing that, its own id is taken
 * as the path — through `baseTopicId`, so a scoped variant
 * (`NFL_SURVIVOR:settings.entryFee`) claims `settings.entryFee` rather than a
 * path no schema has.
 */
function explainedPathsFor(type: PoolType, topics: readonly HelpTopic[]): Set<string> {
  return new Set(
    topics
      .filter((t) => t.poolTypes === 'all' || t.poolTypes.includes(type))
      .flatMap((t) => (t.fields ?? [baseTopicId(t.id)]).map(normalizePath)),
  );
}

/** Leaves of `type` that neither a visible topic nor the allowlist accounts for. */
function uncoveredFor(
  type: PoolType,
  leaves: ReadonlySet<string>,
  topics: readonly HelpTopic[],
  allowlist: Readonly<Record<string, string>>,
): string[] {
  const explained = explainedPathsFor(type, topics);
  return [...leaves].filter((p) => !explained.has(p) && !(p in allowlist)).sort();
}

const leavesByType = new Map<PoolType, Set<string>>(POOL_TYPES.map((t) => [t, leavesFor(t)]));
const allLeaves = new Set<string>([...leavesByType.values()].flatMap((s) => [...s]));
const realTopics = [...helpRegistry.topics.values()];

describe('the schema walk itself', () => {
  it('reaches every pool type', () => {
    for (const type of POOL_TYPES) {
      expect(leavesByType.get(type)!.size, `${type} produced no paths`).toBeGreaterThan(10);
    }
  });

  it('reaches nested and array paths, not only top-level keys', () => {
    // If the walk silently stopped at depth 1, every deep field would look
    // "not in the schema" and this audit would pass while covering nothing.
    expect(allLeaves).toContain('settings.payouts.places.*.rank');
    expect(allLeaves).toContain('settings.scoring.roundMultipliers.SUPER_BOWL');
    expect(allLeaves).toContain('props.questions.*.text');
    expect(allLeaves).toContain('paymentHandles.venmo');
  });

  it('emits leaves, not containers', () => {
    for (const container of ['settings', 'branding', 'props', 'settings.payouts', 'paymentHandles']) {
      expect(allLeaves.has(container), `${container} should not be a leaf`).toBe(false);
    }
  });
});

/**
 * The per-type rule, tested on fixtures. Without these the rule itself is
 * unguarded while T0's real topic list is empty — and this is precisely the
 * hole a cross-model review found in the first draft of this file.
 */
describe('coverage is judged per pool type, not across the union', () => {
  const topic = (over: Partial<HelpTopic>): HelpTopic => ({
    id: 'settings.entryFee',
    title: 'Entry fee',
    short: 'What each player pays.',
    long: 'Long form.',
    poolTypes: 'all',
    audience: ['member'],
    ...over,
  });
  const leaves = new Set(['settings.entryFee']);

  it('a Survivor-only topic does not cover Pick’em', () => {
    const topics = [topic({ poolTypes: ['NFL_SURVIVOR'] })];
    expect(uncoveredFor('NFL_SURVIVOR', leaves, topics, {})).toEqual([]);
    expect(uncoveredFor('NFL_PICKEM', leaves, topics, {})).toEqual(['settings.entryFee']);
  });

  it('an all-types topic covers every type', () => {
    const topics = [topic({ poolTypes: 'all' })];
    for (const type of POOL_TYPES) {
      expect(uncoveredFor(type, leaves, topics, {})).toEqual([]);
    }
  });

  it('a pool-type-qualified id claims the unqualified schema path', () => {
    const topics = [topic({ id: 'NFL_SURVIVOR:settings.entryFee', poolTypes: ['NFL_SURVIVOR'] })];
    expect(uncoveredFor('NFL_SURVIVOR', leaves, topics, {})).toEqual([]);
  });

  it('an explicit fields[] list overrides the id', () => {
    const topics = [topic({ id: 'fee-explainer', fields: ['settings.entryFee'] })];
    expect(uncoveredFor('NFL_PICKEM', leaves, topics, {})).toEqual([]);
  });

  it('normalises array indices on both sides', () => {
    const topics = [topic({ id: 'rows', fields: ['a.0.b'] })];
    expect(uncoveredFor('SQUARES', new Set(['a.*.b']), topics, {})).toEqual([]);
  });

  it('an allowlist row covers a path for every type', () => {
    expect(uncoveredFor('BRACKET', leaves, [], { 'settings.entryFee': 'PERMANENT: test' })).toEqual([]);
  });
});

describe('every schema path is explained or allowlisted', () => {
  it('no create-input field is unaccounted for, for any pool type', () => {
    const problems = POOL_TYPES.flatMap((type) =>
      uncoveredFor(type, leavesByType.get(type)!, realTopics, SCHEMA_PATH_ALLOWLIST).map(
        (p) => `${type}: ${p}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('no allowlist row names a path that no schema has', () => {
    const stale = Object.keys(SCHEMA_PATH_ALLOWLIST).filter((p) => !allLeaves.has(p)).sort();
    expect(stale).toEqual([]);
  });

  /**
   * A path may legitimately be explained for one type and still allowlisted
   * while the other types that carry it wait for their content ticket. The
   * contradiction is a path allowlisted after EVERY type that carries it
   * explains it — then the row is dead and its ticket is done.
   */
  it('no allowlist row survives once every type carrying that path explains it', () => {
    const dead = Object.keys(SCHEMA_PATH_ALLOWLIST).filter((path) => {
      const carriers = POOL_TYPES.filter((type) => leavesByType.get(type)!.has(path));
      return (
        carriers.length > 0 &&
        carriers.every((type) => explainedPathsFor(type, realTopics).has(path))
      );
    });
    expect(dead).toEqual([]);
  });

  it('every allowlist row carries a reason naming a ticket or PERMANENT', () => {
    const vague = Object.entries(SCHEMA_PATH_ALLOWLIST)
      .filter(([, reason]) => !/^(PERMANENT|T\d+)\b/.test(reason.trim()))
      .map(([path]) => path);
    expect(vague).toEqual([]);
  });

  // T0's state, asserted rather than assumed: the allowlist is the whole
  // schema. When T9–T13 write the copy, these rows come out and this number
  // falls — and if a ticket claims to be done while its rows remain, the count
  // says otherwise.
  it('T0 state: every path is pending or permanent, none explained yet', () => {
    expect(realTopics).toEqual([]);
    expect(Object.keys(SCHEMA_PATH_ALLOWLIST).length).toBe(allLeaves.size);
  });
});
