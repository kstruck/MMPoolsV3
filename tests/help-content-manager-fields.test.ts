import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { baseTopicId, helpRegistry, resolveCopy, staticCopy } from '../src/help/registry';
import { isEntryVisible } from '../src/help/visibility';
import type { HelpPage, HelpTopic } from '../src/help/types';
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
 *  1. **Every pool type that carries one of the three paths is accounted for**,
 *     either by a topic that resolves for it or by a written allowlist row —
 *     and the two sets do not overlap and do not leave a gap. A topic scoped to
 *     Squares alone would otherwise leave the four NFL and playoff types
 *     explaining nothing while the guard reported coverage. Each check is
 *     paired with a planted counter-example, so a scope that stopped
 *     discriminating fails here rather than going quietly green.
 *
 *  1b. **No topic here claims a pool type its placements cannot serve** — the
 *     defect class codex found on round 1, twice. See its own describe block.
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

/**
 * The three paths these tickets cover.
 *
 * `explained` is the set of types that resolve one of this file's topics;
 * `allowlisted` is what is LEFT — types whose create contract carries the path
 * with no control and no reader, held by a written PERMANENT row. Together they
 * must be exactly `carriers`, the types whose schema has the leaf at all.
 *
 * The split is codex r1's doing. The first draft made `explained` equal
 * `carriers` so that every row could be deleted, which produced a topic that
 * resolved for four types whose surfaces show nothing — see the reachability
 * block below for what that broke.
 */
const COVERED: readonly {
  path: string;
  carriers: readonly PoolType[];
  explained: readonly PoolType[];
  allowlisted: readonly PoolType[];
}[] = [
  {
    // `brandingSchema` is on every create input but Bracket's.
    path: 'branding.backgroundColor',
    carriers: ['SQUARES', 'PROPS', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    explained: ['SQUARES', 'PROPS'],
    allowlisted: ['NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
  },
  {
    // `payoutsSchema` — Squares splits by quarter, Props has a legacy array.
    path: 'settings.payouts.bonuses.*.name',
    carriers: ['BRACKET', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    explained: ['BRACKET', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    allowlisted: ['NFL_PLAYOFFS'],
  },
  {
    path: 'settings.payouts.bonuses.*.percentage',
    carriers: ['BRACKET', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    explained: ['BRACKET', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'],
    allowlisted: ['NFL_PLAYOFFS'],
  },
];

/** Which pool types resolve a topic for `path`, asking as both audiences. */
function typesExplaining(path: string): PoolType[] {
  return POOL_TYPES.filter((poolType) =>
    [MEMBER, HOST].some((aud) => helpRegistry.resolveTopic({ poolType, ...aud }, path) !== undefined),
  );
}

describe('T5 + T6 — every carrier of the three paths is accounted for', () => {
  it('the table itself is consistent: explained + allowlisted, no overlap, no gap', () => {
    // Guards the guard. If a future edit moved a type from one column to the
    // other and forgot `carriers`, every assertion below would still pass while
    // a pool type quietly went missing from both halves.
    for (const { path, carriers, explained, allowlisted } of COVERED) {
      expect([...explained, ...allowlisted].sort(), path).toEqual([...carriers].sort());
      expect(explained.filter((t) => allowlisted.includes(t)), path).toEqual([]);
    }
  });

  it.each(COVERED)('$path resolves a topic for exactly the types that render it', ({ path, explained }) => {
    expect(typesExplaining(path).sort()).toEqual([...explained].sort());
  });

  it.each(COVERED)('$path is allowlisted exactly while some carrier is unexplained', ({ path, allowlisted }) => {
    expect(path in SCHEMA_PATH_ALLOWLIST, `${path} allowlist row`).toBe(allowlisted.length > 0);
  });

  it.each(COVERED)('$path — the row NAMES the types it is still covering', ({ path, allowlisted }) => {
    // A reason that does not name them rots the moment the topic's scope moves:
    // the row would keep suppressing the audit for types the topic had grown to
    // cover, which is how an allowlist becomes a list of things that used to be
    // true. Skipped where there is no row.
    if (allowlisted.length === 0) return;
    // `?? ''` so a DELETED row fails as "these types are unnamed" rather than
    // as a TypeError — the row above already says the row must exist, and a
    // stack trace there would bury which of the two rules broke.
    const reason = SCHEMA_PATH_ALLOWLIST[path] ?? '';
    expect(allowlisted.filter((t) => !reason.includes(t)), `${path}: ${reason}`).toEqual([]);
  });

  it('and the topic it resolves to is the one authored here', () => {
    // Otherwise the assertion above could be satisfied by somebody else's
    // topic claiming the path, and these tickets would be done by accident.
    const authored = new Set(MANAGER_FIELD_TOPICS.map((t) => t.id));
    for (const { path, explained } of COVERED) {
      const topic = helpRegistry.resolveTopic({ poolType: explained[0], ...HOST }, path);
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

/**
 * THE DEFECT CLASS, not the two cases — codex r1 raised it twice on this file
 * and the guard is written for the shape rather than for either instance.
 *
 * A topic scoped to a pool type that NO placement page serves is a search
 * result the panel cannot open. `Registry.search` picks a hit's page with
 * `pageForResult`, which keeps only placements on a page THIS reader may see;
 * with none it returns `pageId: undefined`, `useHelpPanel.pageForTopic` falls
 * back to `placements[0].page`, and `canOpenPage` then refuses it because that
 * page belongs to another pool type or another audience. The reader gets a row
 * they can click and nothing happens.
 *
 * It type-checks, `buildRegistry` accepts it, the schema audit REWARDS it — a
 * wider `poolTypes` is what lets an allowlist row be deleted — so nothing else
 * in the suite can see it. That is why it is worth more than the two fixes.
 */
describe('T5 + T6 — no topic claims a reader its placements cannot serve (codex r1)', () => {
  /**
   * The two readers a pool surface ever has. `admin` is left out on purpose:
   * `AUDIENCE_SEES.admin` is everything, and the only surface that publishes it
   * (`SuperAdmin.tsx:1235`) has no pool type in scope, so a type-scoped topic is
   * never visible there. Including it would demand an admin-visible pool page
   * for every topic in the registry — pages T14 has not written.
   */
  const VIEWERS = ['member', 'commissioner'] as const;

  /** The pages this topic is placed on, resolved through the live registry. */
  const pagesFor = (topic: HelpTopic): HelpPage[] => {
    const base = baseTopicId(topic.id);
    return helpRegistry.placements
      .filter((p) => p.topic === base)
      .map((p) => helpRegistry.getPage(p.page))
      .filter((p): p is HelpPage => p !== undefined);
  };

  /**
   * Every `(pool type, audience)` that can SEE this topic and has no page to be
   * shown it on. Empty is the invariant.
   */
  function unreachableScopes(topic: HelpTopic): string[] {
    const pages = pagesFor(topic);
    const types: PoolType[] = topic.poolTypes === 'all' ? [...POOL_TYPES] : [...topic.poolTypes];
    const out: string[] = [];
    for (const poolType of types) {
      for (const audience of VIEWERS) {
        const scope = { poolType, audience };
        // Not visible to this reader — nothing to reach.
        if (!isEntryVisible(topic.poolTypes, topic.audience, scope)) continue;
        if (pages.some((page) => isEntryVisible(page.poolTypes, page.audience, scope))) continue;
        out.push(`${topic.id} @ ${poolType}/${audience}`);
      }
    }
    return out;
  }

  it.each(MANAGER_FIELD_TOPICS.map((t) => [t.id, t] as const))(
    '%s has a placement page for every reader who can find it',
    (_id, topic) => {
      expect(unreachableScopes(topic)).toEqual([]);
    },
  );

  it('the check is live — the exact scope codex found is reported', () => {
    // THE PLANTED COUNTER-EXAMPLE, and it is the shipped defect verbatim: the
    // first draft scoped the colour to all six branded types while placing it
    // only on the squares and props manager surfaces. Widen it back by one type
    // and the guard names that reader.
    const background = MANAGER_FIELD_TOPICS.find((t) => t.id === 'branding.backgroundColor')!;
    const widened: HelpTopic = {
      ...background,
      poolTypes: [...(background.poolTypes as readonly PoolType[]), 'NFL_PICKEM'],
    };
    expect(unreachableScopes(widened)).toEqual(['branding.backgroundColor @ NFL_PICKEM/commissioner']);
  });

  it('and the same for the bonus rows on a playoff pool', () => {
    const share = MANAGER_FIELD_TOPICS.find((t) => t.id === 'settings.payouts.bonuses.*.percentage')!;
    const widened: HelpTopic = {
      ...share,
      poolTypes: [...(share.poolTypes as readonly PoolType[]), 'NFL_PLAYOFFS'],
    };
    // Both audiences, because these topics are member-visible too — the bonus
    // list is on the rules page, and a playoff pool has neither.
    expect(unreachableScopes(widened)).toEqual([
      'settings.payouts.bonuses.*.percentage @ NFL_PLAYOFFS/member',
      'settings.payouts.bonuses.*.percentage @ NFL_PLAYOFFS/commissioner',
    ]);
  });

  it('END TO END: a real search hit for one of these topics always names a page the reader may see', () => {
    // The structural check above reasons about placements. This one drives the
    // code path the reader actually takes, so the two cannot agree while the
    // product misbehaves.
    const ours = new Set(MANAGER_FIELD_TOPICS.map((t) => t.id));
    const bad: string[] = [];
    let seen = 0;
    for (const poolType of POOL_TYPES) {
      for (const audience of VIEWERS) {
        for (const topic of MANAGER_FIELD_TOPICS) {
          for (const hit of helpRegistry.search(topic.title, { poolType, audience })) {
            if (hit.kind !== 'topic' || !ours.has(hit.id)) continue;
            seen++;
            const page = hit.pageId ? helpRegistry.getPage(hit.pageId) : undefined;
            if (!page || !isEntryVisible(page.poolTypes, page.audience, { poolType, audience })) {
              bad.push(`${hit.id} @ ${poolType}/${audience} → ${hit.pageId ?? 'NO PAGE'}`);
            }
          }
        }
      }
    }
    // Without this the loop could match nothing and pass on an empty list.
    expect(seen, 'search returned no hit for any of these topics').toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});

/**
 * THE CONTROL ITSELF — codex r1 [P1]. Registry content only populates the Help
 * panel; a commissioner standing in front of the colour picker or the bonus
 * rows meets a `?` only if the component renders one. These three files are the
 * whole surface area of both tickets, so the wiring is asserted here rather
 * than trusted.
 *
 * `HelpTip` returns null on an id that does not resolve rather than throwing —
 * that is what lets content land ticket by ticket — so a typo would be
 * invisible on the screen and in every other test. The second assertion is the
 * join that catches it.
 */
describe('T5 + T6 — the controls carry the `?` (codex r1 [P1])', () => {
  const WIRED: readonly { file: string; helpIds: readonly string[]; poolType: PoolType }[] = [
    {
      // The squares manager's Setup Wizard tab (AdminPanel.tsx:675, step 6).
      file: 'src/components/admin/WizardStepBrandingAdmin.tsx',
      helpIds: ['branding.backgroundColor'],
      poolType: 'SQUARES',
    },
    {
      // The props edit wizard inside the props Manage tab (PropsWizard.tsx step 1).
      file: 'src/components/WizardStepBranding.tsx',
      helpIds: ['branding.backgroundColor'],
      poolType: 'PROPS',
    },
    {
      // The only bonus-row editor in the app.
      file: 'src/components/BracketPoolDashboard/BracketPoolDashboard.tsx',
      helpIds: ['settings.payouts.bonuses.*.name', 'settings.payouts.bonuses.*.percentage'],
      poolType: 'BRACKET',
    },
  ];

  const renderedIds = (file: string): string[] =>
    [...read(file).matchAll(/<HelpTip\s+helpId="([^"]+)"/g)].map((m) => m[1]);

  it.each(WIRED)('$file renders a HelpTip for each topic it owns', ({ file, helpIds }) => {
    const rendered = renderedIds(file);
    for (const id of helpIds) {
      expect(rendered, `${file} renders no HelpTip for ${id}`).toContain(id);
    }
  });

  it.each(WIRED)('$file — every id it renders resolves for a $poolType commissioner', ({ file, poolType }) => {
    const unresolved = renderedIds(file).filter(
      (id) => helpRegistry.resolveTopic({ poolType, ...HOST }, id) === undefined,
    );
    expect(unresolved, `${file}`).toEqual([]);
  });

  it('the grep is live — it finds nothing in a file that renders no tip', () => {
    // Without this, a renamed component or a moved file would make every
    // assertion above vacuous rather than red.
    expect(renderedIds('src/components/wizard/steps/StepBranding.tsx')).toEqual([]);
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

  it('sends a member to the screen that CAN show them a bonus (codex r3)', () => {
    // The regression: the first draft said "the pool's rules and payment page".
    // `PayoutsPanel` renders the bonus list on the rules screen only, and BOTH
    // dashboards carry a separate payments screen (`pool.nfl.payments`,
    // `pool.bracket.ledger`) that shows the ledger and not this configuration —
    // so "payment page" pointed at the one screen with no bonus on it.
    const long = staticCopy(percentage().long);
    expect(long).toContain('Rules tab');
    for (const wrong of ['payment page', 'payments page', 'payment tab', 'payments tab']) {
      expect(long.toLowerCase(), `points at "${wrong}"`).not.toContain(wrong);
    }
  });

  it('does not claim one pot where the panel prices two (codex r4)', () => {
    // An NFL pool may run `payoutMode: 'HYBRID'`. Where it ALSO declares its own
    // weekly place list, `PayoutsPanel` prices a bonus off the season pot alone
    // and the weekly list separately — so "that one pot" and "95% for the
    // finishing places" were both false for that reader.
    const long = staticCopy(percentage().long);
    expect(long).toContain('weekly prizes');
    // The two lines the copy is written against, read back out of the panel, so
    // a change to either fails here instead of silently making the copy wrong.
    const panel = read('src/components/PayoutsPanel.tsx');
    expect(panel).toContain(
      "const separateWeekly = payoutMode === 'HYBRID' && Array.isArray(settings.weeklyPayouts?.places);",
    );
    expect(panel).toContain("separateWeekly ? 'the season pot' : 'the pot'");
  });

  it('and "Rules tab" is what those dashboards actually call it', () => {
    // Read back out of the tab bars, so a rename makes the copy fail here
    // rather than quietly misdirecting a member. The two labels differ, which
    // is why the copy names the shared word rather than either label in full.
    expect(read('src/components/BracketPoolDashboard/BracketPoolDashboard.tsx'))
      .toContain("{ id: 'rules' as DashboardTab, label: 'Rules'");
    expect(read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx'))
      .toMatch(/\{ tab: 'rules', label: 'Rules/);
  });

  it('never says "revenue" — the word voice rule 8 bans outright', () => {
    for (const t of MANAGER_FIELD_TOPICS) {
      const copy = `${t.title}\n${staticCopy(t.short)}\n${staticCopy(t.long)}`.toLowerCase();
      expect(copy, `${t.id} says revenue`).not.toContain('revenue');
    }
  });
});

/**
 * A COMMISSIONER CONTROL EXPLAINED TO A MEMBER MUST NOT SAY "YOU" — codex r6.
 *
 * The two bonus topics describe controls only a commissioner has, and their
 * audience is `EVERYONE` because the value lands on a member-facing rules page.
 * So every second-person verb in them was addressed to the commissioner and
 * read as a lie to the member who met them there: "you decide, and you pay
 * them", "add as many rows as you want", "remove one with the cross beside it".
 *
 * The registry cannot solve this with a variant — a variant keys on POOL TYPE,
 * and `buildRegistry` refuses one whose audience differs from its base — so a
 * single wording has to serve both readers, and the only wording that can is
 * one that names the actor instead of assuming it.
 *
 * The rule is scoped to THIS FILE deliberately. "You" is right in a topic about
 * something the member actually does; it is wrong only where the control
 * belongs to somebody else, which is what every topic here has in common.
 */
describe('T5 + T6 — a member-visible topic here never addresses the reader as the commissioner', () => {
  const SECOND_PERSON = /\b(you|your|yours|yourself)\b/i;

  const memberVisible = MANAGER_FIELD_TOPICS.filter((t) => t.audience.includes('member'));

  it('there IS such a topic — otherwise the rule below is vacuous', () => {
    expect(memberVisible.map((t) => t.id)).toEqual([
      'settings.payouts.bonuses.*.name',
      'settings.payouts.bonuses.*.percentage',
    ]);
  });

  it.each(memberVisible.map((t) => [t.id, t] as const))('%s uses no second person', (_id, topic) => {
    const offenders = [topic.title, staticCopy(topic.short), staticCopy(topic.long), ...(topic.tips ?? [])]
      .flatMap((block) => block.split(/(?<=[.!?])\s+/))
      .filter((sentence) => SECOND_PERSON.test(sentence));
    expect(offenders).toEqual([]);
  });

  it('the regex is live — it catches the exact sentences codex flagged', () => {
    // The shipped copy, verbatim. A rule that matched nothing would pass every
    // assertion above while the defect walked straight back in.
    for (const was of [
      'Nothing here works out who won it: you decide, and you pay them the same way you pay every other prize.',
      'Add as many rows as you want, and remove one with the cross beside it.',
      'The pot is the entry fees you collect.',
    ]) {
      expect(SECOND_PERSON.test(was), was).toBe(true);
    }
    // And it does not fire on an innocent word that merely contains "you".
    expect(SECOND_PERSON.test('The youngest entry still counts.')).toBe(false);
  });

  it('the HOST_ONLY topic is deliberately exempt, and still says "your"', () => {
    // Not an oversight worth silencing later: `branding.backgroundColor` has
    // exactly one reader, and second person is right for it.
    const background = helpRegistry.getTopic('branding.backgroundColor')!;
    expect(background.audience).toEqual(['commissioner']);
    expect(SECOND_PERSON.test(staticCopy(background.long))).toBe(true);
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
