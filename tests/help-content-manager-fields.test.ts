import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry, resolveCopy, staticCopy } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST } from '../src/help/coverage-allowlist';
import {
  MANAGER_FIELD_PLACEMENTS,
  MANAGER_FIELD_TOPICS,
} from '../src/help/content/manager-fields';
import {
  BANNED_IMPLEMENTATION_WORDS,
  BANNED_SELLING_WORDS,
  COPY_LIMITS,
  findBannedWords,
} from '../src/help/voice';

/**
 * T5 + T6 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * The generic guards prove the content is well-formed and that no schema path
 * is left unaccounted for. This file proves the things specific to these two
 * tickets, which nothing else can see:
 *
 *  1. **The three allowlist rows are really closed.** A row may only be deleted
 *     when EVERY pool type whose create contract carries that path resolves a
 *     topic for it — a topic scoped to Squares alone would leave the four NFL
 *     and playoff types explaining nothing while the guard reported coverage.
 *     Each check is paired with a planted counter-example, so a scope that
 *     stopped discriminating fails here rather than going quietly green.
 *
 *  2. **The named default is the one the code uses.** Voice rule 5 says name
 *     the default exactly, and no test can catch copy that names it wrongly —
 *     so the literal is read back out of the two components that render the
 *     colour picker and compared against the shipped sentence. Copy drift is
 *     the failure mode this whole registry exists to prevent, and this is the
 *     one field where the default is a value rather than a behaviour.
 *
 *  3. **The bonus copy is money copy (voice rule 8).** It has to say what the
 *     share is a share OF and that no balance is held here, and it must never
 *     say "revenue".
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MEMBER = { audience: 'member' } as const;
const HOST = { audience: 'commissioner' } as const;

/** The three paths these tickets closed, with the types whose contract carries each. */
const CLOSED: readonly { path: string; carriers: readonly PoolType[] }[] = [
  {
    // `brandingSchema` is on every create input but Bracket's.
    path: 'branding.backgroundColor',
    carriers: ['SQUARES', 'PROPS', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
  },
  {
    // `payoutsSchema` — Squares splits by quarter, Props has a legacy array.
    path: 'settings.payouts.bonuses.*.name',
    carriers: ['BRACKET', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
  },
  {
    path: 'settings.payouts.bonuses.*.percentage',
    carriers: ['BRACKET', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
  },
];

/** Which pool types resolve a topic for `path`, asking as both audiences. */
function typesExplaining(path: string): PoolType[] {
  return POOL_TYPES.filter((poolType) =>
    [MEMBER, HOST].some((aud) => helpRegistry.resolveTopic({ poolType, ...aud }, path) !== undefined),
  );
}

describe('T5 + T6 — the three allowlist rows are closed, not merely deleted', () => {
  it('no longer names any of the three paths', () => {
    for (const { path } of CLOSED) {
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} should no longer be allowlisted`).toBe(false);
    }
  });

  it.each(CLOSED)('$path resolves a topic for every pool type that carries it', ({ path, carriers }) => {
    expect(typesExplaining(path).sort()).toEqual([...carriers].sort());
  });

  it('and the topic it resolves to is the one authored here', () => {
    // Otherwise the assertion above could be satisfied by somebody else's
    // topic claiming the path, and these tickets would be done by accident.
    const authored = new Set(MANAGER_FIELD_TOPICS.map((t) => t.id));
    for (const { path, carriers } of CLOSED) {
      const topic = helpRegistry.resolveTopic({ poolType: carriers[0], ...HOST }, path);
      expect(authored.has(topic!.id), `${path} resolved to ${topic?.id}`).toBe(true);
    }
  });

  it('the pool-type filter discriminates — a non-carrier gets nothing', () => {
    // The counter-example. If these topics were widened to `poolTypes: 'all'`
    // the coverage assertion above would still pass, so this is what proves the
    // scopes are doing work: Bracket has no branding block, and Squares and
    // Props have no bonus list.
    expect(helpRegistry.resolveTopic({ poolType: 'BRACKET', ...HOST }, 'branding.backgroundColor')).toBeUndefined();
    for (const path of ['settings.payouts.bonuses.*.name', 'settings.payouts.bonuses.*.percentage']) {
      expect(helpRegistry.resolveTopic({ poolType: 'SQUARES', ...HOST }, path)).toBeUndefined();
      expect(helpRegistry.resolveTopic({ poolType: 'PROPS', ...HOST }, path)).toBeUndefined();
    }
  });
});

describe('T5 + T6 — the copy is placed where the control is', () => {
  it('every placement names a page that exists', () => {
    const pageIds = new Set(helpRegistry.pages.map((p) => p.id));
    const missing = MANAGER_FIELD_PLACEMENTS.filter((p) => !pageIds.has(p.page)).map((p) => p.page);
    expect(missing).toEqual([]);
  });

  const visibleOn = (pageId: string, poolType: PoolType, audience: 'member' | 'commissioner') =>
    helpRegistry
      .placementsForPage(pageId, { poolType, audience })
      .flatMap((s) => s.topics)
      .map((t) => t.id);

  it('a squares commissioner reads the background colour on the Setup Wizard tab', () => {
    expect(visibleOn('admin.squares.settings', 'SQUARES', 'commissioner')).toContain('branding.backgroundColor');
  });

  it('a props commissioner reads it on the Manage tab', () => {
    expect(visibleOn('pool.props.admin', 'PROPS', 'commissioner')).toContain('branding.backgroundColor');
  });

  it('branding stays on the commissioner side — a member never meets that control', () => {
    for (const [page, type] of [
      ['admin.squares.settings', 'SQUARES'],
      ['pool.props.admin', 'PROPS'],
    ] as const) {
      expect(visibleOn(page, type, 'member')).not.toContain('branding.backgroundColor');
    }
  });

  it('the bonus rows are on the bracket editor and on both rules surfaces that render them', () => {
    const onEditor = visibleOn('pool.bracket.manager', 'BRACKET', 'commissioner');
    expect(onEditor).toContain('settings.payouts.bonuses.*.name');
    expect(onEditor).toContain('settings.payouts.bonuses.*.percentage');
    // Members read a bonus on the rules pages, so the copy has to reach them.
    for (const [page, type] of [
      ['pool.bracket.rules', 'BRACKET'],
      ['pool.nfl.rules', 'NFL_PICKEM'],
      ['pool.nfl.rules', 'NFL_SURVIVOR'],
      ['pool.nfl.rules', 'NFL_MARGIN'],
    ] as const) {
      expect(visibleOn(page, type, 'member')).toContain('settings.payouts.bonuses.*.percentage');
    }
  });
});

describe('T5 — the named default is the default the code uses', () => {
  /**
   * The fallback both branding steps render, read back out of their sources.
   *
   * `WizardStepBranding.tsx` is the props edit wizard's step and
   * `admin/WizardStepBrandingAdmin.tsx` is the squares manager's; both spell
   * the colour picker's value, its readout and its Reset button against the
   * same literal. If they ever disagree, the help copy cannot name "the"
   * default and this test says so rather than letting one sentence be wrong on
   * one of the two screens.
   */
  const defaults = new Set(
    [
      'src/components/WizardStepBranding.tsx',
      'src/components/admin/WizardStepBrandingAdmin.tsx',
    ].flatMap((file) => [
      ...read(file).matchAll(/backgroundColor[^\n]*?'(#[0-9a-fA-F]{3,8})'/g),
    ].map((m) => m[1].toLowerCase())),
  );

  it('reads a single default out of both branding steps', () => {
    // A regex that matched nothing would make the assertion below vacuous.
    expect(defaults.size).toBe(1);
  });

  const background = () => helpRegistry.getTopic('branding.backgroundColor')!;

  it('the topic names it exactly', () => {
    const [hex] = [...defaults];
    expect(staticCopy(background().short)).toContain(hex);
    expect(staticCopy(background().long)).toContain(hex);
  });

  it('and hedges nothing — voice rule 5 refuses a softened default', () => {
    const copy = `${staticCopy(background().short)}\n${staticCopy(background().long)}`.toLowerCase();
    for (const hedge of ['usually', 'typically', 'normally', 'in most cases']) {
      expect(copy, `hedged with "${hedge}"`).not.toContain(hedge);
    }
  });
});

describe('T6 — the bonus percentage is money copy (voice rule 8)', () => {
  const percentage = () => helpRegistry.getTopic('settings.payouts.bonuses.*.percentage')!;

  it('says what the share is a share of, in the tooltip and not only the panel', () => {
    // The tooltip is where most readers stop, so "the pot" and what the pot is
    // both have to survive into `short`.
    const short = staticCopy(percentage().short).toLowerCase();
    expect(short).toContain('pot');
    expect(short).toContain('collect');
  });

  it('says plainly that no balance is held here', () => {
    expect(staticCopy(percentage().long).toLowerCase()).toContain('nothing is held here');
  });

  it('never says "revenue" — the word voice rule 8 bans outright', () => {
    for (const t of MANAGER_FIELD_TOPICS) {
      const copy = `${t.title}\n${staticCopy(t.short)}\n${staticCopy(t.long)}`.toLowerCase();
      expect(copy, `${t.id} says revenue`).not.toContain('revenue');
    }
  });
});

describe('T5 + T6 — the copy obeys the mechanical voice rules', () => {
  // The registry invariants already sweep every topic. These repeat the sweep
  // over just this file's topics so a failure names the ticket that owns it,
  // and so the rules are asserted even if the content ever moves out of the
  // live registry.
  it('fits the length budget', () => {
    const over = MANAGER_FIELD_TOPICS.flatMap((t) => [
      ...(t.title.length > COPY_LIMITS.topicTitle ? [`${t.id}: title ${t.title.length}`] : []),
      ...(staticCopy(t.short).length > COPY_LIMITS.topicShort
        ? [`${t.id}: short ${staticCopy(t.short).length}`]
        : []),
    ]);
    expect(over).toEqual([]);
  });

  it('uses no banned word', () => {
    const violations = MANAGER_FIELD_TOPICS.flatMap((t) => {
      const copy = [t.title, staticCopy(t.short), staticCopy(t.long), ...(t.tips ?? [])].join('\n');
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      return hits.length ? [`${t.id}: ${hits.join(', ')}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it('bolts no second thought onto a `short` with a semicolon — voice rule 3', () => {
    const bolted = MANAGER_FIELD_TOPICS.filter((t) => staticCopy(t.short).includes(';')).map((t) => t.id);
    expect(bolted).toEqual([]);
  });

  it('no copy is a template, so the static text above is the text a reader sees', () => {
    // If one of these ever grows a `template`, `staticCopy` stops being what
    // the reader gets and every assertion in this file quietly narrows to the
    // fallback — the exact hole the registry invariants document.
    for (const t of MANAGER_FIELD_TOPICS) {
      expect(typeof t.short, `${t.id}.short`).toBe('string');
      expect(typeof t.long, `${t.id}.long`).toBe('string');
      expect(resolveCopy(t.short, { settings: {} })).toBe(staticCopy(t.short));
    }
  });
});
