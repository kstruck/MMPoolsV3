import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolType } from '../shared/poolTypes';
import { baseTopicId, helpRegistry, normalizePath, staticCopy } from '../src/help/registry';
import type { HelpTopic } from '../src/help/types';
import {
  MANAGER_LABEL_ALLOWLIST,
  SCHEMA_PATH_ALLOWLIST,
  WIZARD_FIELD_ALLOWLIST,
} from '../src/help/coverage-allowlist';
import {
  NFL_MARGIN_PLACEMENTS,
  NFL_MARGIN_TOPICS,
  PAYOUT_MODE_TYPES,
} from '../src/help/content/nfl-margin';
import { stripComments } from './help-ui-coverage.test';
import { hybridSplitProblem } from '../shared/hybridSplit';
import { perWeekPrizePot, potBreakdown, weeklyPlacesFor } from '../shared/prizePot';
import { computeSeasonPrizeSnapshot } from '../shared/seasonPrizes';
import { computeWeeklyPrizeSnapshot } from '../shared/weeklyPrizes';
import { marginCreateInputSchema, pickemCreateInputSchema } from '../shared/schemas/nfl';
import { payoutsSchema } from '../shared/schemas/common';
import { buildNFLPayload } from '../src/components/wizard/create/buildNFLPayload';

/**
 * T11 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * T11 is the payout method and the hybrid entry-fee split: eleven allowlist
 * rows across three lists, and ALL of it money copy. The generic guards prove
 * the content is well-formed and that no row was left behind; this file proves
 * the four things specific to T11 that nothing else can see.
 *
 *  1. **Every path it claims really resolves to a topic a reader can see.**
 *     A row can be deleted from `SCHEMA_PATH_ALLOWLIST` by a topic that is
 *     scoped so narrowly nobody meets it — the schema audit credits a topic's
 *     DECLARED scope, so it would report coverage the panel never shows.
 *
 *  2. **The scope is exactly the two types that carry these settings.** Only
 *     Pick'em and Margin have `payoutMode`, `hybridSplit` and `weeklyPayouts`
 *     (`shared/schemas/nfl.ts`); Survivor has none of them, and `pool.nfl.*`
 *     is ONE set of pages shared by all three.
 *
 *  3. **Voice rule 8**: no "revenue", and the peer-to-peer statement present in
 *     every topic — written ONCE and shared, not three near-copies.
 *
 *  4. **Every behaviour and every default the copy names is true of the code.**
 *     This is the rule that has broken most often in this effort, and money
 *     copy that disagrees with money enforcement is the worst version of it.
 *     So each claim is pinned to the function that implements it: flip the
 *     behaviour and this file fails, which is the only place the drift would
 *     otherwise be invisible.
 *
 * Nothing here asserts that a sentence exists by matching prose for its own
 * sake. Where a string IS asserted it is because the string is the claim under
 * test (the named default, the peer-to-peer statement), and the code that makes
 * it true is asserted beside it.
 */

const root = resolve(__dirname, '..');
const MANAGER_FILE = 'src/components/NFLPoolDashboard/NFLManagerView.tsx';
const codeOf = (file: string) => stripComments(readFileSync(resolve(root, file), 'utf8'));

const HOST = { audience: 'commissioner' } as const;

/** The five schema paths this ticket took out of `SCHEMA_PATH_ALLOWLIST`. */
const T11_SCHEMA_PATHS = [
  'settings.payoutMode',
  'settings.hybridSplit.weeklyPerEntry',
  'settings.hybridSplit.seasonPerEntry',
  'settings.weeklyPayouts.places.*.rank',
  'settings.weeklyPayouts.places.*.percentage',
] as const;

/** The three wizard bindings it took out of `WIZARD_FIELD_ALLOWLIST`. */
const T11_WIZARD_FIELDS = [
  'settings.payoutMode',
  'settings.hybridSplit.weeklyPerEntry',
  'settings.hybridSplit.seasonPerEntry',
] as const;

/**
 * The three manager labels it took out of `MANAGER_LABEL_ALLOWLIST`, with the
 * topic each one must now point at. Each renders TWICE — once on the Pick'em
 * branch of the settings form and once on the Margin branch — and the list is
 * keyed by label TEXT, so one row covered both and one `helpId` would not.
 */
const T11_MANAGER_LABELS: Readonly<Record<string, string>> = {
  'Payout Method': 'settings.payoutMode',
  'Weekly pots ($/entry)': 'settings.hybridSplit.weeklyPerEntry',
  'Season pot ($/entry)': 'settings.hybridSplit.seasonPerEntry',
};

/**
 * Which topics CLAIM a schema path — judged exactly as `help-schema-audit`
 * judges it: an explicit `fields[]`, or the topic's own (unqualified,
 * index-normalised) id.
 */
function claimants(path: string): HelpTopic[] {
  return helpRegistry.topics.filter((t) =>
    (t.fields ?? [baseTopicId(t.id)]).map(normalizePath).includes(path),
  );
}

/** Every `<FieldLabel …>text</FieldLabel>` in a file, as the T4 guard reads them. */
function fieldLabels(code: string): { helpId?: string; text: string }[] {
  const out: { helpId?: string; text: string }[] = [];
  const re = /<FieldLabel\b([^>]*)>([\s\S]*?)<\/FieldLabel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push({ helpId: /helpId="([^"]+)"/.exec(m[1])?.[1], text: m[2].trim() });
  }
  return out;
}

/** The pages `content/pool-pages.ts` builds for the three NFL season formats. */
const NFL_PAGE_IDS = helpRegistry.pages
  .filter((p) => p.id === 'pool.nfl' || p.id.startsWith('pool.nfl.'))
  .map((p) => p.id);

/** Topic ids visible on a page to a reader in `poolType` with `audience`. */
function visibleOn(pageId: string, poolType: PoolType, audience: 'member' | 'commissioner'): string[] {
  return helpRegistry
    .placementsForPage(pageId, { poolType, audience })
    .flatMap((s) => s.topics)
    .map((t) => t.id);
}

const T11_TOPIC_IDS = new Set(NFL_MARGIN_TOPICS.map((t) => t.id));

describe('T11 — the eleven allowlist rows are closed, and closed by real copy', () => {
  it('the five schema rows are gone', () => {
    expect(T11_SCHEMA_PATHS.filter((p) => p in SCHEMA_PATH_ALLOWLIST)).toEqual([]);
  });

  it('the three wizard-field rows are gone', () => {
    expect(T11_WIZARD_FIELDS.filter((p) => p in WIZARD_FIELD_ALLOWLIST)).toEqual([]);
  });

  it('the three manager-label rows are gone', () => {
    expect(Object.keys(T11_MANAGER_LABELS).filter((t) => t in MANAGER_LABEL_ALLOWLIST)).toEqual([]);
  });

  /**
   * The half a deleted row does NOT prove. `help-schema-audit` credits coverage
   * from a topic's declared `poolTypes`, so a topic scoped to nobody — or to a
   * type that does not carry the setting — would empty the allowlist while the
   * panel showed nothing. Both types that carry the path have to resolve it.
   */
  it.each(T11_SCHEMA_PATHS)('%s resolves to a topic for a Pick’em AND a Margin reader', (path) => {
    const owners = claimants(path);
    expect(owners.map((t) => t.id)).not.toEqual([]);
    for (const poolType of PAYOUT_MODE_TYPES) {
      const reachable = owners.some(
        (t) => helpRegistry.resolveTopic({ poolType, ...HOST }, t.id) !== undefined,
      );
      expect(reachable, `${path} is claimed but unreachable for ${poolType}`).toBe(true);
    }
  });

  /**
   * The `fields[]` on the two split topics is not decoration.
   *
   * `help-ui-coverage.test.ts` asks whether a bound control is explained for
   * every pool type whose wizard renders its FILE, and `HybridSplitFields` is
   * reached from `StepFeeAndPayment` — which all seven wizards render. A topic
   * scoped to two types can never answer that by resolution, so the explicit
   * claim is what accounts for the control. Delete it and the wizard rows come
   * straight back.
   */
  it.each(['settings.hybridSplit.weeklyPerEntry', 'settings.hybridSplit.seasonPerEntry'])(
    '%s claims its own path explicitly',
    (id) => {
      expect(helpRegistry.getTopic(id)!.fields).toEqual([id]);
    },
  );

  /**
   * T11 is placed on every screen its three controls render on, and no others.
   *
   * NOT "the pages exist" — `buildRegistry` throws on an unknown page before
   * this file's first import completes, so an existence check here could never
   * go red and would be a guard that looks like one. What IS worth checking is
   * COVERAGE: a placement quietly dropped leaves a control with a tooltip and
   * no entry in the panel, and nothing else notices.
   */
  it('the payout method is placed on all five screens that show or set it', () => {
    const pages = NFL_MARGIN_PLACEMENTS.filter((p) => p.topic === 'settings.payoutMode')
      .map((p) => p.page)
      .sort();
    expect(pages).toEqual([
      'pool.nfl.manager.settings',
      'pool.nfl.payments',
      'pool.nfl.rules',
      'wizard.margin.rules',
      'wizard.pickem.rules',
    ]);
  });

  it.each(['settings.hybridSplit.weeklyPerEntry', 'settings.hybridSplit.seasonPerEntry'])(
    '%s is placed on the fee step of both wizards, the rules page and the settings tab',
    (topic) => {
      const pages = NFL_MARGIN_PLACEMENTS.filter((p) => p.topic === topic).map((p) => p.page).sort();
      expect(pages).toEqual([
        'pool.nfl.manager.settings',
        'pool.nfl.rules',
        'wizard.margin.fee',
        'wizard.pickem.fee',
      ]);
    },
  );
});

describe('T11 — both render sites of every manager label carry the helpId', () => {
  const labels = fieldLabels(codeOf(MANAGER_FILE));

  it('the label scan is live', () => {
    // Without this, a moved or renamed form would make every check below pass
    // by finding nothing at all.
    expect(labels.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(T11_MANAGER_LABELS))(
    '"%s" renders twice and BOTH point at %s',
    (text, id) => {
      const rendered = labels.filter((l) => l.text === text);
      // TWO: the Pick'em branch of the settings form and the Margin branch.
      // The allowlist is keyed by label text, so one row covered both — and
      // helping only one site would leave the other bare with nothing to fail.
      expect(rendered).toHaveLength(2);
      expect(rendered.map((l) => l.helpId)).toEqual([id, id]);
    },
  );

  it.each(Object.entries(T11_MANAGER_LABELS))(
    'the topic %s points at resolves for a commissioner of both types',
    (_text, id) => {
      for (const poolType of PAYOUT_MODE_TYPES) {
        expect(helpRegistry.resolveTopic({ poolType, ...HOST }, id)?.id).toBe(id);
      }
    },
  );
});

describe('T11 — the copy is scoped to the two types that carry these settings', () => {
  it('every topic in nfl-margin.ts names exactly Pick’em and Margin', () => {
    const wrong = NFL_MARGIN_TOPICS.filter(
      (t) =>
        t.poolTypes === 'all' ||
        t.poolTypes.length !== 2 ||
        !PAYOUT_MODE_TYPES.every((p) => (t.poolTypes as readonly string[]).includes(p)),
    ).map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('a Survivor reader sees none of it, on any shared NFL page', () => {
    const leaked = NFL_PAGE_IDS.flatMap((page) =>
      (['member', 'commissioner'] as const).flatMap((aud) =>
        visibleOn(page, 'NFL_SURVIVOR', aud)
          .filter((id) => T11_TOPIC_IDS.has(id))
          .map((id) => `NFL_SURVIVOR/${aud} sees ${id} on ${page}`),
      ),
    );
    expect(leaked).toEqual([]);
  });

  it('a Pick’em and a Margin reader DO — the check above is not passing by emptiness', () => {
    for (const type of PAYOUT_MODE_TYPES) {
      expect(visibleOn('pool.nfl.rules', type, 'member')).toContain('settings.payoutMode');
      const settings = visibleOn('pool.nfl.manager.settings', type, 'commissioner');
      expect(settings).toContain('settings.hybridSplit.weeklyPerEntry');
      expect(settings).toContain('settings.hybridSplit.seasonPerEntry');
    }
  });

  it('and neither wizard step page is left empty of it', () => {
    expect(visibleOn('wizard.pickem.rules', 'NFL_PICKEM', 'commissioner')).toContain('settings.payoutMode');
    expect(visibleOn('wizard.margin.rules', 'NFL_MARGIN', 'commissioner')).toContain('settings.payoutMode');
    expect(visibleOn('wizard.margin.fee', 'NFL_MARGIN', 'commissioner')).toContain(
      'settings.hybridSplit.seasonPerEntry',
    );
  });

  it('the scope filter discriminates — a Survivor reader still sees the SHARED money copy', () => {
    // Otherwise "Survivor sees none of it" could be true because Survivor sees
    // nothing at all on these pages.
    expect(visibleOn('pool.nfl.rules', 'NFL_SURVIVOR', 'member')).toContain('settings.entryFee');
  });
});

describe('T11 — voice rule 8: money copy says where the money is', () => {
  const copyOf = (t: HelpTopic) => [staticCopy(t.short), staticCopy(t.long)].join('\n\n');

  it.each(NFL_MARGIN_TOPICS.map((t) => [t.id, t] as const))('%s never says "revenue"', (_id, topic) => {
    expect(copyOf(topic)).not.toMatch(/\brevenue\b/i);
  });

  it.each(NFL_MARGIN_TOPICS.map((t) => [t.id, t] as const))(
    '%s carries the peer-to-peer statement',
    (_id, topic) => {
      const copy = copyOf(topic);
      expect(copy).toMatch(/money moves between you and your players directly/i);
      expect(copy).toMatch(/Nothing is held here/i);
    },
  );

  it('that statement is ONE sentence shared, not three wordings of it (voice rule 10)', () => {
    const closing = NFL_MARGIN_TOPICS.map((t) => staticCopy(t.long).split('\n\n').at(-1));
    expect(new Set(closing).size).toBe(1);
  });
});

describe('T11 — the place list is explained once, for both pots (voice rule 10)', () => {
  it.each(['rank', 'percentage'])(
    'one topic claims both settings.payouts.places.*.%s and the weekly twin',
    (leaf) => {
      const season = claimants(`settings.payouts.places.*.${leaf}`).map((t) => t.id);
      const weekly = claimants(`settings.weeklyPayouts.places.*.${leaf}`).map((t) => t.id);
      expect(season).toHaveLength(1);
      expect(weekly).toEqual(season);
    },
  );

  it('no second topic was written under a weeklyPayouts id', () => {
    expect(helpRegistry.topics.filter((t) => t.id.includes('weeklyPayouts')).map((t) => t.id)).toEqual([]);
  });

  it('and the manager’s weekly editor points at those same topics', () => {
    // The manager-side twin of the wizard's second payouts editor. If it ever
    // pointed somewhere else, the "explained once" claim above would be true of
    // the content and false on the screen.
    const ids = new Set(fieldLabels(codeOf(MANAGER_FILE)).map((l) => l.helpId));
    expect(ids.has('settings.payouts.places.*.rank')).toBe(true);
    expect(ids.has('settings.payouts.places.*.percentage')).toBe(true);
  });
});

/**
 * Voice rule 5 — the default, named exactly, pinned to what makes it true.
 *
 * `payoutMode` is `.optional()` in both create schemas, so there is no
 * schema-level default to read: the default is what the wizard seeds and what
 * the manager form falls back to. All three are asserted, because the copy is
 * placed on all three screens.
 */
describe('T11 — "paying only on the final standings is the default" is still true', () => {
  it('the create schemas supply no payoutMode of their own', () => {
    const settings = { entryFee: 0, payouts: { places: [{ rank: 1, percentage: 100 }] } };
    const margin = marginCreateInputSchema.parse({ type: 'NFL_MARGIN', name: 'p', season: 2026, settings });
    const pickem = pickemCreateInputSchema.parse({ type: 'NFL_PICKEM', name: 'p', season: 2026, settings });
    expect(margin.settings.payoutMode).toBeUndefined();
    expect(pickem.settings.payoutMode).toBeUndefined();
  });

  it.each([
    'src/components/wizard/create/CreateNFLPickemPool.tsx',
    'src/components/wizard/create/CreateNFLMarginPool.tsx',
  ])('%s still seeds SEASON', (file) => {
    expect(/payoutMode:\s*'SEASON'/.test(readFileSync(resolve(root, file), 'utf8'))).toBe(true);
  });

  it('the manager form still falls back to SEASON on both branches', () => {
    expect(codeOf(MANAGER_FILE).match(/settings\.payoutMode \?\? 'SEASON'/g) ?? []).toHaveLength(2);
  });

  it('and the copy names that default rather than softening it', () => {
    const short = staticCopy(helpRegistry.getTopic('settings.payoutMode')!.short);
    expect(short).toContain('Paying only on the final standings is the default');
    expect(short).not.toMatch(/usually|normally|by default,? (it|the)/i);
  });
});

/**
 * Every behaviour claim in the payout copy, against the function that
 * implements it. Money copy that disagrees with money enforcement is how
 * commissioners stop trusting either.
 */
describe('T11 — the behaviour the copy describes is the behaviour the code has', () => {
  const PLACES = [{ rank: 1, percentage: 100 }];

  it('SEASON: the whole pot goes to the final standings, and a week carries no prize', () => {
    const settings = { payoutMode: 'SEASON' as const, entryFee: 20, payouts: { places: PLACES } };
    const pot = potBreakdown(settings, 5)!;
    expect(pot.seasonPot).toBe(pot.net);
    expect(pot.weeklySeasonAllocation).toBeUndefined();
    expect(weeklyPlacesFor(settings)).toEqual([]);
    expect(computeWeeklyPrizeSnapshot(settings, 5, 18, 0)).toBeUndefined();
  });

  it('WEEKLY: the whole pot goes into the weeks, and the final standings carry no prize', () => {
    const settings = { payoutMode: 'WEEKLY' as const, entryFee: 20, payouts: { places: PLACES } };
    const pot = potBreakdown(settings, 5)!;
    expect(pot.weeklySeasonAllocation).toBe(pot.net);
    expect(pot.seasonPot).toBeUndefined();
    expect(computeSeasonPrizeSnapshot(settings, 5, 0)).toBeUndefined();
  });

  it('HYBRID with a split: two pots, and one week is the weekly money over the weeks', () => {
    // Kevin's own example, $25 = $18 weekly + $7 season, over ten entries.
    const settings = {
      payoutMode: 'HYBRID' as const,
      entryFee: 25,
      hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 },
      payouts: { places: PLACES },
    };
    const pot = potBreakdown(settings, 10)!;
    expect(pot.weeklySeasonAllocation).toBe(180);
    expect(pot.seasonPot).toBe(70);
    // "divided by the number of weeks your pool covers" — a four-week preseason
    // pool really does pay more per week than a full season from the same money.
    expect(perWeekPrizePot(pot.weeklySeasonAllocation, 4)).toBe(45);
    expect(perWeekPrizePot(pot.weeklySeasonAllocation, 18)).toBe(10);
  });

  /**
   * THE CHARITY ORDER, PINNED TO THE COPY THAT DEPENDS ON IT (codex r1 [P2]).
   *
   * `potBreakdown` takes the charity cut off the GROSS and then scales the
   * weekly allocation by `charityFactor` (`prizePot.ts:61-72`), so the two
   * amounts a commissioner types are NOT what either pot holds on a pool that
   * gives a share away. That is why neither split topic promises a number of
   * dollars into a pot, and why the payout-method topic says the share comes
   * off first.
   *
   * Both halves are asserted in ONE test on purpose: move the deduction to
   * after the split and the arithmetic below goes red, which forces whoever
   * moved it to read the copy assertions sitting beside it. Behaviour and copy
   * drifting apart silently is the whole failure mode this file exists for.
   */
  it('HYBRID: charity comes off before either pot, and the copy says so', () => {
    const settings = {
      payoutMode: 'HYBRID' as const,
      entryFee: 25,
      hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 },
      charity: { enabled: true, percentage: 10 },
      payouts: { places: PLACES },
    };
    const pot = potBreakdown(settings, 10)!;
    // The case above, with a tenth given away: 180/70 becomes 162/63.
    expect(pot.charityCut).toBe(25);
    expect(pot.net).toBe(225);
    expect(pot.weeklySeasonAllocation).toBe(162);
    expect(pot.seasonPot).toBe(63);

    // THE CLAIM THE COPY MAKES, and the only one that holds: the two pots
    // divide `net` exactly. "Both pots hold less than you typed" does NOT hold
    // — the season pot is the REMAINDER, so rounding can push it above the
    // typed amount (codex r3 [P2]). One $25 entry, a $25/$0 split and 10%
    // charity is the counterexample, and it is a legal split
    // (`isHybridSplitShape` allows each half to be 0).
    expect(pot.weeklySeasonAllocation! + pot.seasonPot!).toBe(pot.net);
    const edge = potBreakdown(
      { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 25, seasonPerEntry: 0 }, charity: { enabled: true, percentage: 10 } },
      1,
    )!;
    expect(edge.net).toBe(23);
    expect(edge.weeklySeasonAllocation).toBe(22);
    expect(edge.seasonPot).toBe(1); // ...against a typed $0. ABOVE, not below.
    expect(edge.weeklySeasonAllocation! + edge.seasonPot!).toBe(edge.net);

    // Stated once, in the topic that owns the split as a whole (voice rule 10).
    const mode = staticCopy(helpRegistry.getTopic('settings.payoutMode')!.long);
    expect(mode).toMatch(/charity/i);
    expect(mode).toMatch(/before either pot is worked out/i);
    expect(mode).toMatch(/divide what is left/i);
    expect(mode, 'reinstates the claim the edge case above disproves').not.toMatch(/both pots hold less/i);

    // ...and not restated in the two field topics, which describe the DIVISION
    // they set. The two phrasings below are the ones that were false: both
    // promised the typed dollars arrive, which charity makes untrue.
    for (const id of ['settings.hybridSplit.weeklyPerEntry', 'settings.hybridSplit.seasonPerEntry']) {
      const topic = helpRegistry.getTopic(id)!;
      const copy = `${staticCopy(topic.short)} ${staticCopy(topic.long)}`;
      expect(copy, `${id} promises the typed dollars reach a pot`).not.toMatch(/this many dollars/i);
      expect(copy, `${id} promises the typed dollars reach a pot`).not.toMatch(/dollars of every entry fee go/i);
      expect(copy, `${id} restates the charity deduction (voice rule 10)`).not.toMatch(/charity/i);
    }
  });

  it('HYBRID with no split: neither figure is known — the "ask your commissioner" case', () => {
    const pot = potBreakdown({ payoutMode: 'HYBRID', entryFee: 25 }, 10)!;
    expect(pot.weeklySeasonAllocation).toBeUndefined();
    expect(pot.seasonPot).toBeUndefined();
  });

  it('an empty weekly list means the season places price both pots', () => {
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: PLACES } })).toBe(PLACES);
    const weekly = [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }];
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: PLACES }, weeklyPayouts: { places: weekly } })).toBe(weekly);
  });

  /**
   * SEASON does not promise that the places distribute the whole pot
   * (codex r2 [P2]). `payoutsSchema` accepts a place list totalling under
   * 100%, and bonuses take their share of the same 100% — a commissioner who
   * pays 60/25 and keeps the rest for a prize they award themselves is in a
   * VALID configuration, and `settings.payouts.places.*.percentage` already
   * tells the reader so. What SEASON decides is which pot holds the money.
   */
  it('SEASON: the copy claims an allocation, not a full distribution to places', () => {
    const under = payoutsSchema.safeParse({ places: [{ rank: 1, percentage: 60 }], bonuses: [] });
    expect(under.success).toBe(true);
    const withBonus = payoutsSchema.safeParse({
      places: [{ rank: 1, percentage: 60 }],
      bonuses: [{ name: 'Highest single week', percentage: 40 }],
    });
    expect(withBonus.success).toBe(true);

    const mode = staticCopy(helpRegistry.getTopic('settings.payoutMode')!.long);
    expect(mode, 'promises the places receive the whole pot').not.toMatch(/whole pot goes to the finishing places/i);
    // The positive half: the places are named as the list that DECIDES the
    // division, which is true at any total. Asserted rather than only banning
    // the old phrasing, because a blacklist of wordings is not a guard.
    expect(mode).toMatch(/season places decide how it divides/i);
    // The allocation claim that IS true, and the reason the sentence exists.
    expect(potBreakdown({ payoutMode: 'SEASON', entryFee: 20 }, 5)!.seasonPot).toBe(100);
  });

  /**
   * "WITH NO SEPARATE WEEKLY LIST" IS THE CONDITION, NOT "LEAVE IT EMPTY".
   *
   * The copy used to say "leave the weekly list empty and the season places
   * price both". Rejected at codex r2 on the grounds that neither authoring
   * surface can store `{ places: [] }` — which is TRUE (asserted below) and
   * beside the point, re-raised at r3 and absorbed. An empty ARRAY is truthy,
   * so `weeklyPlacesFor` returns it as itself and the weekly pot has no places
   * at all, and that state is deliberate and reachable through the update
   * callable: `normalizePayoutListsPatch` exists to turn `weeklyPayouts: {}`
   * into `{ places: [] }` precisely so it does NOT fall through
   * (`weeklyPayoutsGate.ts:110-116`), and the manager preserves it across
   * unrelated saves (`NFLManagerView.tsx:406-410`).
   *
   * So all three stored states are pinned here, and the copy is required to
   * name the condition the function tests rather than an instruction that is
   * true of two surfaces and false of that pool.
   */
  it('the weekly fallback is "no list", not "an empty list" — all three states', () => {
    // The reachable, deliberate one the copy must NOT claim falls back.
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: PLACES }, weeklyPayouts: { places: [] } })).toEqual([]);

    const mode = staticCopy(helpRegistry.getTopic('settings.payoutMode')!.long);
    expect(mode, 'tells a commissioner to leave the weekly list empty').not.toMatch(/weekly list empty/i);
    expect(mode).toMatch(/no separate weekly list/i);
  });

  it('...and the two states the authoring surfaces CAN produce do fall back', () => {
    const base = {
      type: 'NFL_PICKEM',
      name: 'p',
      season: 2026,
      settings: {
        entryFee: 10,
        payouts: { places: PLACES },
        payoutMode: 'HYBRID',
        hybridSplit: { weeklyPerEntry: 6, seasonPerEntry: 4 },
        weeklyPayouts: { places: [] },
      },
    } as Record<string, unknown>;
    const built = buildNFLPayload(base, 'NFL_PICKEM');
    expect((built.settings as { weeklyPayouts?: unknown }).weeklyPayouts).toBeUndefined();

    // ...and both of the values those surfaces CAN store fall back to the
    // season list, which is the sentence under test.
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: PLACES } })).toBe(PLACES);
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: PLACES }, weeklyPayouts: null })).toBe(PLACES);
  });

  it('the sum rule the copy names is the rule a save is refused on', () => {
    const ok = { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } };
    expect(hybridSplitProblem(ok)).toBeNull();
    expect(hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 6 } }))
      .toMatch(/must add up to the entry fee/);
    // "whole-dollar amounts" and "only a Hybrid pool has this", both refused.
    expect(hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: 17.5, seasonPerEntry: 7.5 } }))
      .toMatch(/whole-dollar/);
    expect(hybridSplitProblem({ ...ok, payoutMode: 'SEASON' })).toMatch(/only applies to the Hybrid/);
  });

  it('and the same rule is enforced by the create schema, not only by the helper', () => {
    const settings = {
      entryFee: 25,
      payouts: { places: PLACES },
      payoutMode: 'HYBRID' as const,
      hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 6 },
    };
    const bad = marginCreateInputSchema.safeParse({ type: 'NFL_MARGIN', name: 'p', season: 2026, settings });
    expect(bad.success).toBe(false);
    const good = marginCreateInputSchema.safeParse({
      type: 'NFL_MARGIN',
      name: 'p',
      season: 2026,
      settings: { ...settings, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } },
    });
    expect(good.success).toBe(true);
  });

  it('a weekly place list on a non-Hybrid pool is refused — "only a Hybrid pool has this"', () => {
    const stray = marginCreateInputSchema.safeParse({
      type: 'NFL_MARGIN',
      name: 'p',
      season: 2026,
      settings: { entryFee: 25, payouts: { places: PLACES }, payoutMode: 'SEASON', weeklyPayouts: { places: PLACES } },
    });
    expect(stray.success).toBe(false);
  });
});
