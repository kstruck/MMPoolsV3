import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { getCreateInputSchema } from '../shared/schemas/index';
import { helpRegistry, normalizePath } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST } from '../src/help/coverage-allowlist';

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

const leavesByType = new Map<PoolType, Set<string>>(POOL_TYPES.map((t) => [t, leavesFor(t)]));
const allLeaves = new Set<string>([...leavesByType.values()].flatMap((s) => [...s]));

/** Paths a help topic claims to explain. */
const explained = new Set(
  [...helpRegistry.topics.values()].flatMap((t) => (t.fields ?? [t.id]).map(normalizePath)),
);

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

describe('every schema path is explained or allowlisted', () => {
  it('no create-input field is unaccounted for', () => {
    const uncovered = [...allLeaves].filter((p) => !explained.has(p) && !(p in SCHEMA_PATH_ALLOWLIST)).sort();
    expect(uncovered).toEqual([]);
  });

  it('no allowlist row names a path that no schema has', () => {
    const stale = Object.keys(SCHEMA_PATH_ALLOWLIST).filter((p) => !allLeaves.has(p)).sort();
    expect(stale).toEqual([]);
  });

  it('no path is both explained and allowlisted', () => {
    const both = [...explained].filter((p) => p in SCHEMA_PATH_ALLOWLIST).sort();
    expect(both).toEqual([]);
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
    expect(explained.size).toBe(0);
    expect(Object.keys(SCHEMA_PATH_ALLOWLIST).length).toBe(allLeaves.size);
  });
});
