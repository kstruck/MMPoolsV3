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

/**
 * Flatten a JSON Schema to the dotted paths of its LEAVES.
 *
 * `root` is the whole generated document, so a local `$ref` can be resolved:
 * zod emits `$ref` into `$defs` when a sub-schema is reused, and every pool
 * type's payout place list is a reuse candidate. Treating a `$ref` node as a
 * leaf (its own shape has no `properties`, `items` or `anyOf`) would credit
 * `settings.payouts.places.*` as one audited path and silently stop auditing
 * `rank` and `percentage` underneath it — coverage would appear complete at
 * the moment it was lost.
 *
 * Anything this walker does not understand is REPORTED in `unhandled`, never
 * absorbed as a leaf, so a future schema construct fails loudly here instead
 * of quietly shrinking the audit.
 */
export function flattenLeaves(
  node: unknown,
  prefix: string,
  out: Set<string>,
  root: unknown,
  unhandled: string[] = [],
  seen: ReadonlySet<string> = new Set(),
): string[] {
  if (!node || typeof node !== 'object') return unhandled;
  const n = node as Record<string, unknown>;

  // Local $ref, resolved against the document root.
  if (typeof n.$ref === 'string') {
    const ref = n.$ref;
    if (!ref.startsWith('#/')) {
      unhandled.push(`${prefix || '<root>'}: external $ref ${ref}`);
      return unhandled;
    }
    // A self-referential schema would otherwise recurse forever.
    if (seen.has(ref)) return unhandled;
    let target: unknown = root;
    for (const segment of ref.slice(2).split('/')) {
      target = target && typeof target === 'object'
        ? (target as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
        : undefined;
    }
    if (target === undefined) {
      unhandled.push(`${prefix || '<root>'}: unresolvable $ref ${ref}`);
      return unhandled;
    }
    return flattenLeaves(target, prefix, out, root, unhandled, new Set([...seen, ref]));
  }

  // A union contributes every branch's paths — an optional field is
  // `anyOf: [T, undefined]`, and a `z.union` genuinely has two shapes.
  const branches = (n.anyOf ?? n.oneOf ?? n.allOf) as unknown[] | undefined;
  if (Array.isArray(branches)) {
    for (const branch of branches) flattenLeaves(branch, prefix, out, root, unhandled, seen);
    return unhandled;
  }

  if (n.type === 'array' || n.items) {
    flattenLeaves(n.items, prefix ? `${prefix}.*` : '*', out, root, unhandled, seen);
    return unhandled;
  }

  if (n.properties) {
    for (const [key, child] of Object.entries(n.properties as Record<string, unknown>)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, out, root, unhandled, seen);
    }
    // A record — `additionalProperties` as a schema — has open-ended keys, so
    // its VALUE shape is audited under a `*` segment, the same convention
    // arrays use.
    if (n.additionalProperties && typeof n.additionalProperties === 'object') {
      flattenLeaves(n.additionalProperties, prefix ? `${prefix}.*` : '*', out, root, unhandled, seen);
    }
    return unhandled;
  }

  // A bare record with no declared properties.
  if (n.additionalProperties && typeof n.additionalProperties === 'object') {
    flattenLeaves(n.additionalProperties, prefix ? `${prefix}.*` : '*', out, root, unhandled, seen);
    return unhandled;
  }

  if (prefix) out.add(prefix);
  return unhandled;
}

/** Every leaf path of one pool type's create-input schema, plus anything the walker could not read. */
function leavesFor(type: PoolType): { leaves: Set<string>; unhandled: string[] } {
  const schema = getCreateInputSchema(type);
  if (!schema) throw new Error(`no create-input schema for ${type}`);
  // `io: 'input'` is what the wizard actually submits (before coercion), and
  // `unrepresentable: 'any'` keeps the preprocessed fields (optionalText,
  // optionalDateMillis) from throwing instead of yielding their path.
  const json = z.toJSONSchema(schema as never, { unrepresentable: 'any', io: 'input' } as never);
  const leaves = new Set<string>();
  const unhandled = flattenLeaves(json, '', leaves, json);
  return { leaves, unhandled };
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

const walked = new Map(POOL_TYPES.map((t) => [t, leavesFor(t)] as const));
const leavesByType = new Map<PoolType, Set<string>>([...walked].map(([t, w]) => [t, w.leaves]));
const allLeaves = new Set<string>([...leavesByType.values()].flatMap((s) => [...s]));
const realTopics = [...helpRegistry.topics];

describe('flattenLeaves — the walker, on fixtures', () => {
  const walk = (doc: unknown) => {
    const out = new Set<string>();
    const unhandled = flattenLeaves(doc, '', out, doc);
    return { paths: [...out].sort(), unhandled };
  };

  it('follows a local $ref into $defs instead of counting it as a leaf', () => {
    const doc = {
      type: 'object',
      properties: { places: { type: 'array', items: { $ref: '#/$defs/place' } } },
      $defs: { place: { type: 'object', properties: { rank: { type: 'number' }, pct: { type: 'number' } } } },
    };
    expect(walk(doc).paths).toEqual(['places.*.pct', 'places.*.rank']);
  });

  it('audits record values under a * segment', () => {
    const doc = {
      type: 'object',
      properties: { handles: { type: 'object', additionalProperties: { type: 'object', properties: { tag: { type: 'string' } } } } },
    };
    expect(walk(doc).paths).toEqual(['handles.*.tag']);
  });

  it('reports an unresolvable $ref rather than swallowing it', () => {
    const out = walk({ type: 'object', properties: { a: { $ref: '#/$defs/missing' } } });
    expect(out.paths).toEqual([]);
    expect(out.unhandled).toHaveLength(1);
  });

  it('reports an external $ref', () => {
    const out = walk({ type: 'object', properties: { a: { $ref: 'https://example.com/s.json' } } });
    expect(out.unhandled).toHaveLength(1);
  });

  it('does not hang on a self-referential schema', () => {
    const doc = {
      type: 'object',
      properties: { node: { $ref: '#/$defs/node' } },
      $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' }, name: { type: 'string' } } } },
    };
    expect(walk(doc).paths).toContain('node.name');
  });
});

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

  /**
   * The walker reports what it cannot read rather than absorbing it as a leaf.
   * A `$ref` node has no properties, items or anyOf of its own, so the first
   * version added it as a leaf — crediting `settings.payouts.places.*` as one
   * audited path and silently dropping `rank` and `percentage` beneath it.
   * Coverage would have looked complete at the moment it was lost.
   */
  it('understands every node in every live schema', () => {
    const problems = [...walked].flatMap(([type, w]) => w.unhandled.map((u) => `${type}: ${u}`));
    expect(problems).toEqual([]);
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

  // T1's state, asserted rather than assumed. The allowlist started as the
  // whole schema; every ticket that writes copy takes rows out of it, so the
  // gap between the two numbers is the measure of what is covered. If a ticket
  // claims to be done while its rows remain, this says otherwise.
  it('T1 state: the shared wizard paths are explained and the rest are still pending', () => {
    const explained = new Set(POOL_TYPES.flatMap((t) => [...explainedPathsFor(t, realTopics)]));
    for (const path of [
      'name',
      'contactEmail',
      'settings.entryFee',
      'costPerSquare',
      'props.cost',
      'paymentHandles.venmo',
      'paymentHandles.googlePay',
      'settings.payouts.places.*.rank',
      'branding.logoUrl',
      'lockDate',
      'settings.weeklyTiebreaker',
    ]) {
      expect(explained.has(path), `${path} is T1 copy and should be explained`).toBe(true);
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} should no longer be allowlisted`).toBe(false);
    }
    expect(Object.keys(SCHEMA_PATH_ALLOWLIST).length).toBeLessThan(allLeaves.size);
    // T10 closed `settings.maxStrikes`, so it is no longer a witness here. The
    // three that remain belong to T11-T13 and go the same way; when the last of
    // them lands this loop empties out and stops asserting anything, which is
    // why the check below does not depend on it.
    for (const path of ['settings.scoringSystem', 'numberSets', 'settings.payoutMode']) {
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} is T11-T13 content and should still be pending`).toBe(true);
    }
    // The non-vacuous half: a path a ticket has CLOSED must be explained for
    // every pool type whose create contract carries it, and must be gone from
    // the allowlist. An empty `explained` set or a silently re-added row fails
    // here even after the loop above has nothing left to say.
    for (const path of ['settings.maxStrikes']) {
      expect(explained.has(path), `${path} is closed and must be explained`).toBe(true);
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} is closed and must not be allowlisted`).toBe(false);
    }
  });
});
