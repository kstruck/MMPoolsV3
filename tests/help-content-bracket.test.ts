import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry, resolveCopy, staticCopy, normalizePath, baseTopicId } from '../src/help/registry';
import {
  SCHEMA_PATH_ALLOWLIST,
  WIZARD_FIELD_ALLOWLIST,
} from '../src/help/coverage-allowlist';
import { BRACKET_PLACEMENTS, BRACKET_TOPICS } from '../src/help/content/bracket';
import { SCORING_SYSTEM_LABELS } from '../src/components/BracketPoolDashboard/bracketScoring';
import { BANNED_IMPLEMENTATION_WORDS, BANNED_SELLING_WORDS, COPY_LIMITS, findBannedWords } from '../src/help/voice';
import type { HelpTopic } from '../src/help/types';

/**
 * T12 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * The generic registry guards prove the content is well-formed and the schema
 * audit proves nothing is unaccounted for. This file proves the things that are
 * specific to T12 and that nothing else can see:
 *
 *  1. **Every one of the twelve paths this ticket owns resolves to copy a
 *     reader of that pool type would actually be shown** — not merely to a
 *     topic that exists somewhere in the registry.
 *  2. **The defaults named in the copy are the defaults the code applies.**
 *     Each claim is pinned to the line that makes it true, the way
 *     `help-ui-coverage.test.ts` pins the wizard's. Change the code and the
 *     copy fails here, which is the only place that drift is visible.
 *  3. **The scoring-system names are not a second copy.** The help topic and
 *     the member-facing rules panel read one definition, and this asserts they
 *     agree for every system that has one.
 *  4. **Bracket copy and playoff copy do not leak into each other**, or into
 *     the NFL season pools that share `/pool/:id`.
 *
 * Every check that could pass by emptiness is paired with one proving the
 * thing it measures is really there.
 */

const root = resolve(__dirname, '..');
const sourceOf = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const CREATE_BRACKET = 'src/components/wizard/create/CreateBracketPool.tsx';
const CREATE_PLAYOFF = 'src/components/wizard/create/CreatePlayoffPool.tsx';
const BRACKET_MANAGER = 'src/components/BracketPoolDashboard/BracketPoolDashboard.tsx';
const CREATE_BRACKET_FN = 'functions/src/bracketPools.ts';
const BRACKET_ENTRIES_FN = 'functions/src/bracketEntries.ts';
const RULES_PANEL = 'src/components/BracketPoolDashboard/BracketRulesPanel.tsx';

/** The topic a reader of `poolType` would be shown for `id`, if any. */
function topicFor(id: string, poolType: PoolType, audience: 'member' | 'commissioner' = 'commissioner') {
  return helpRegistry.resolveTopic({ poolType, audience }, id);
}

/** Schema paths a topic visible to `poolType` explains, `fields[]` or its own id. */
function explainedFor(poolType: PoolType): Set<string> {
  return new Set(
    helpRegistry.topics
      .filter((t) => t.poolTypes === 'all' || t.poolTypes.includes(poolType))
      .flatMap((t) => (t.fields ?? [baseTopicId(t.id)]).map(normalizePath)),
  );
}

/** All the copy of one topic, as a reader with no pool in scope sees it. */
function allCopy(t: HelpTopic): string {
  return [t.title, staticCopy(t.short), staticCopy(t.long), ...(t.tips ?? [])].join('\n');
}

const byId = new Map(BRACKET_TOPICS.map((t) => [t.id, t]));
const topic = (id: string): HelpTopic => {
  const found = byId.get(id);
  if (!found) throw new Error(`T12 topic "${id}" is missing from content/bracket.ts`);
  return found;
};

/** The twelve schema paths T12 owns, and the pool type that carries each. */
const OWNED: { path: string; type: PoolType }[] = [
  { path: 'seasonYear', type: 'BRACKET' },
  { path: 'gender', type: 'BRACKET' },
  { path: 'tournamentType', type: 'BRACKET' },
  { path: 'settings.scoringSystem', type: 'BRACKET' },
  { path: 'settings.customScoring', type: 'BRACKET' },
  { path: 'settings.maxEntriesTotal', type: 'BRACKET' },
  { path: 'settings.tieBreakers.closestAbsolute', type: 'BRACKET' },
  { path: 'settings.tieBreakers.closestUnder', type: 'BRACKET' },
  { path: 'settings.scoring.roundMultipliers.WILD_CARD', type: 'NFL_PLAYOFFS' },
  { path: 'settings.scoring.roundMultipliers.DIVISIONAL', type: 'NFL_PLAYOFFS' },
  { path: 'settings.scoring.roundMultipliers.CONF_CHAMP', type: 'NFL_PLAYOFFS' },
  { path: 'settings.scoring.roundMultipliers.SUPER_BOWL', type: 'NFL_PLAYOFFS' },
];

describe('T12 — every path this ticket owns is explained for the type that carries it', () => {
  it.each(OWNED)('$path is explained for $type', ({ path, type }) => {
    expect(explainedFor(type).has(path)).toBe(true);
  });

  it('the eleven rows T12 closed are gone from both allowlists', () => {
    const closed = [
      'seasonYear',
      'gender',
      'tournamentType',
      'settings.scoringSystem',
      'settings.customScoring',
      'settings.tieBreakers.closestAbsolute',
      'settings.tieBreakers.closestUnder',
      'settings.scoring.roundMultipliers.WILD_CARD',
      'settings.scoring.roundMultipliers.DIVISIONAL',
      'settings.scoring.roundMultipliers.CONF_CHAMP',
      'settings.scoring.roundMultipliers.SUPER_BOWL',
    ];
    expect(closed.filter((p) => p in SCHEMA_PATH_ALLOWLIST)).toEqual([]);
    // The ten wizard-bound ones (customScoring has no create control) are gone
    // from the wizard allowlist too.
    expect(closed.filter((p) => p !== 'settings.customScoring' && p in WIZARD_FIELD_ALLOWLIST)).toEqual([]);
  });

  /**
   * THE ONE ROW T12 COULD NOT DELETE, asserted so that it cannot quietly
   * become a pending row again.
   *
   * `settings.maxEntriesTotal` is in the playoff create input and nothing
   * reads it there: no wizard control binds it, `submitPlayoffPicks` caps on
   * `maxEntriesPerUser`, the free-plan ten and the paid ceiling but never on
   * this, and `getPoolEntrySummary` returns a null capacity for a playoff pool
   * deliberately. So it is explained for BRACKET and PERMANENTLY allowlisted
   * for NFL_PLAYOFFS.
   */
  it('settings.maxEntriesTotal is explained for BRACKET and permanently allowlisted for the playoff pool', () => {
    expect(explainedFor('BRACKET').has('settings.maxEntriesTotal')).toBe(true);
    expect(explainedFor('NFL_PLAYOFFS').has('settings.maxEntriesTotal')).toBe(false);
    expect(SCHEMA_PATH_ALLOWLIST['settings.maxEntriesTotal']).toMatch(/^PERMANENT for NFL_PLAYOFFS/);
  });

  it('the playoff pool really still carries the field — the row is not describing a path that is gone', () => {
    // Without this, the row above could outlive the schema field and the
    // assertion would keep passing on a fiction. (The generic
    // "no allowlist row names a path that no schema has" guard covers the
    // union; this names the file.)
    expect(sourceOf('shared/schemas/playoff.ts')).toMatch(/maxEntriesTotal:\s*z\.number\(\)\.int\(\)\.optional\(\)/);
  });

  it('every T12 placement names a page that already exists', () => {
    const pageIds = new Set(helpRegistry.pages.map((p) => p.id));
    expect(BRACKET_PLACEMENTS.filter((p) => !pageIds.has(p.page)).map((p) => p.page)).toEqual([]);
  });

  it('every T12 topic is placed at least once', () => {
    const placed = new Set(BRACKET_PLACEMENTS.map((p) => p.topic));
    expect(BRACKET_TOPICS.filter((t) => !placed.has(t.id)).map((t) => t.id)).toEqual([]);
  });
});

/**
 * Voice rule 5, pinned. Each claim names the line that makes it true, so
 * changing the default fails on the COPY rather than shipping a help topic that
 * describes a value the code stopped applying.
 */
describe('T12 — the defaults named in the copy are the defaults the code applies', () => {
  it('the entry limit copy says -1 means no limit, and -1 is what the code means', () => {
    const copy = allCopy(topic('settings.maxEntriesTotal'));
    // The sentence the reader needs. Written twice on purpose — the short is
    // the tooltip and the long is the panel, and a reader may see either alone.
    expect(staticCopy(topic('settings.maxEntriesTotal').short)).toContain('-1 means no limit');
    expect(copy).toContain('-1');

    // …and the three places that make it true.
    expect(sourceOf(CREATE_BRACKET_FN)).toMatch(/maxEntriesTotal:\s*settings\?\.maxEntriesTotal\s*\?\?\s*-1/);
    expect(sourceOf(BRACKET_ENTRIES_FN)).toMatch(/const maxTotal = poolData\.settings\.maxEntriesTotal;[\s\S]{0,80}if \(maxTotal > 0\)/);
    expect(sourceOf(BRACKET_MANAGER)).toContain('-1 = unlimited');
  });

  it('the custom-scoring copy names the numbers the boxes start on', () => {
    const copy = allCopy(topic('settings.customScoring'));
    expect(copy).toContain('1, 2, 4, 8, 16 and 32');
    expect(sourceOf(BRACKET_MANAGER)).toMatch(/customScoring \|\| \[1, 2, 4, 8, 16, 32\]/);
  });

  it('the custom-scoring copy is only claimed for the CUSTOM system, as both engines read it', () => {
    expect(allCopy(topic('settings.customScoring'))).toContain('only while the scoring system is');
    expect(sourceOf(CREATE_BRACKET_FN)).toMatch(/settings\?\.scoringSystem === 'CUSTOM' \? \(settings\.customScoring \|\| null\) : null/);
    expect(sourceOf('functions/src/bracketScoring.ts')).toMatch(/system === 'CUSTOM' && settings\.customScoring/);
  });

  it('the tournament-year copy names the year the wizard pre-fills', () => {
    const year = sourceOf(CREATE_BRACKET).match(/seasonYear:\s*(\d{4})/)?.[1];
    expect(year, 'CreateBracketPool.tsx no longer pre-fills a seasonYear').toBeDefined();
    expect(allCopy(topic('seasonYear'))).toContain(year!);
  });

  it("the bracket copy says men's is the default, and both the wizard and the server agree", () => {
    expect(staticCopy(topic('gender').short)).toContain('Men’s is what a new pool starts on');
    expect(sourceOf(CREATE_BRACKET)).toMatch(/gender:\s*'mens'/);
    expect(sourceOf(CREATE_BRACKET_FN)).toMatch(/gender:\s*gender \|\| 'mens'/);
  });

  it('the tournament copy says NCAA is the default, and names the three the wizard offers', () => {
    const copy = allCopy(topic('tournamentType'));
    expect(staticCopy(topic('tournamentType').short)).toContain('NCAA is what a new pool starts on');
    expect(sourceOf(CREATE_BRACKET)).toMatch(/tournamentType:\s*'ncaa'/);
    for (const label of ['NCAA', 'Big East', 'Big 12']) {
      expect(sourceOf(CREATE_BRACKET), `${label} is no longer offered`).toContain(`label: '${label}'`);
      expect(copy, `${label} is offered but the copy does not name it`).toContain(label);
    }
  });

  it("the men's/women's copy says the conference brackets ignore it, as the id resolver does", () => {
    expect(allCopy(topic('gender'))).toMatch(/Big East or Big 12 pool has one bracket/);
    // The conference branches never interpolate gender; only the NCAA one does.
    const fn = sourceOf(CREATE_BRACKET_FN);
    expect(fn).toMatch(/resolvedTournamentId = `bigeast-\$\{seasonYear\}`/);
    expect(fn).toMatch(/resolvedTournamentId = `big12-\$\{seasonYear\}`/);
    expect(fn).toMatch(/resolvedTournamentId = `\$\{gender \|\| 'mens'\}-\$\{seasonYear\}`/);
  });

  it('the scoring copy says Classic is the default, and both sides apply it', () => {
    expect(staticCopy(topic('settings.scoringSystem').short)).toContain('Classic is what a new pool starts on');
    expect(sourceOf(CREATE_BRACKET)).toMatch(/scoringSystem:\s*'CLASSIC'/);
    expect(sourceOf(CREATE_BRACKET_FN)).toMatch(/scoringSystem:\s*settings\?\.scoringSystem \?\? "CLASSIC"/);
  });

  it('the tie-break copy says closest-without-going-over is off by default', () => {
    expect(staticCopy(topic('bracket.tieBreak').short)).toContain('off unless you turn it on');
    expect(sourceOf(CREATE_BRACKET)).toMatch(/tieBreakers:\s*\{\s*closestAbsolute: true,\s*closestUnder: false\s*\}/);
    expect(sourceOf(CREATE_BRACKET_FN)).toMatch(/closestAbsolute: true,\s*closestUnder: false,/);
  });

  /**
   * The drift this topic is written around: `closestAbsolute` is written by
   * both surfaces and read by none. The copy therefore refuses to describe it
   * as a switch, and this asserts the code has not started reading it — if it
   * ever does, the copy is wrong and has to change.
   */
  it('closest-either-way is still not a switch anything reads', () => {
    const readers = [
      'functions/src/bracketScoring.ts',
      'src/components/BracketPoolDashboard/StandingsTable.tsx',
      'src/components/BracketPoolDashboard/ExportControls.tsx',
      RULES_PANEL,
    ];
    const reads = readers.filter((f) => /closestAbsolute/.test(sourceOf(f)));
    expect(reads, 'closestAbsolute is now read somewhere; bracket.tieBreak copy must be rewritten').toEqual([]);
    // And the guard is live: closestUnder IS read in every one of them.
    expect(readers.filter((f) => !/closestUnder/.test(sourceOf(f)))).toEqual([]);
    expect(allCopy(topic('bracket.tieBreak'))).toContain('not a second switch');
  });

  it('the round-multiplier copy names the four numbers the playoff wizard pre-fills', () => {
    const wizard = sourceOf(CREATE_PLAYOFF);
    expect(wizard).toMatch(
      /roundMultipliers:\s*\{\s*WILD_CARD:\s*1,\s*DIVISIONAL:\s*2,\s*CONF_CHAMP:\s*3,\s*SUPER_BOWL:\s*4\s*\}/,
    );
    const copy = allCopy(topic('playoff.roundMultipliers'));
    expect(copy).toContain('1 for the Wild Card round, 2 for the Divisional round, 3 for the Conference Championships and 4 for the Super Bowl');
    // The rank×multiplier rule the copy describes.
    expect(sourceOf('functions/src/playoffPools.ts')).toMatch(
      /score \+= \(entry\.rankings\[teamId\] \|\| 0\) \* MULTIPLIERS\.WILD_CARD/,
    );
  });

  /**
   * `PlayoffDashboard.tsx:72` reads a multiplier as `... || 1`, so a stored 0
   * would score 0 on the server and 1 on that screen. The copy says NOTHING
   * about setting a round to zero for exactly that reason, and this holds it to
   * that until the two agree.
   */
  it('the round-multiplier copy makes no claim about a zero, while the two sides disagree about one', () => {
    expect(sourceOf('src/components/PlayoffPool/PlayoffDashboard.tsx')).toMatch(
      /roundMultipliers\?\.\[roundKey\] \|\| 1/,
    );
    expect(allCopy(topic('playoff.roundMultipliers')).toLowerCase()).not.toContain('zero');
  });
});

/**
 * Voice rule 10, made mechanical. The scoring-system names live in ONE place
 * and two things read them; this asserts the help topic is genuinely one of the
 * readers rather than a second copy that happens to match today.
 */
describe('T12 — the scoring-system names have one definition', () => {
  it('the rules panel imports the labels rather than declaring them', () => {
    const panel = sourceOf(RULES_PANEL);
    expect(panel).toMatch(/import \{[^}]*SCORING_SYSTEM_LABELS[^}]*\} from '\.\/bracketScoring'/);
    expect(panel).not.toMatch(/const SCORING_SYSTEM_LABELS/);
  });

  it.each(Object.entries(SCORING_SYSTEM_LABELS))(
    'a pool scoring on %s is told so in the label the rules page prints',
    (system, label) => {
      const t = topic('settings.scoringSystem');
      const settings = { scoringSystem: system };
      expect(resolveCopy(t.short, { settings })).toContain(label);
      expect(resolveCopy(t.long, { settings })).toContain(label);
    },
  );

  it('every rendered branch still fits the tooltip budget', () => {
    const t = topic('settings.scoringSystem');
    for (const system of [...Object.keys(SCORING_SYSTEM_LABELS), 'UPSET']) {
      const short = resolveCopy(t.short, { settings: { scoringSystem: system } });
      expect(short.length, `${system}: ${short.length} chars`).toBeLessThanOrEqual(COPY_LIMITS.topicShort);
    }
  });

  /**
   * UPSET is offered by the create wizard and implemented by neither engine, so
   * it has no label. The topic must fall back to copy that names no system —
   * printing the raw token beside a control that calls it "Upset bonus" would
   * be the registry inventing a name for a broken value.
   */
  it('a pool stored as UPSET is not told it scores on "UPSET"', () => {
    const t = topic('settings.scoringSystem');
    const settings = { scoringSystem: 'UPSET' };
    expect(resolveCopy(t.short, { settings })).not.toContain('UPSET');
    expect(resolveCopy(t.long, { settings })).not.toContain('UPSET');
    // It renders the same words a reader outside a pool gets.
    expect(resolveCopy(t.short, { settings })).toBe(staticCopy(t.short));
    // And the value really is still reachable, or this test is theatre.
    expect(sourceOf(CREATE_BRACKET)).toMatch(/value: 'UPSET'/);
    expect(sourceOf('shared/schemas/bracket.ts')).toContain("'UPSET'");
  });

  it('a pool with no system stored gets the fallback, not an empty sentence', () => {
    const t = topic('settings.scoringSystem');
    expect(resolveCopy(t.short, { settings: {} })).toBe(staticCopy(t.short));
    expect(resolveCopy(t.long, { settings: {} })).toBe(staticCopy(t.long));
  });
});

/**
 * The tooltips a commissioner meets in the two wizards. `HelpTip` returns null
 * on an unknown id, so a mistyped `helpId` is a control with silently no help —
 * indistinguishable from one that never had any.
 */
describe('T12 — the shared-topic controls point at topics that resolve', () => {
  it('both bracket tie-break boxes name the one tie-break topic', () => {
    const source = sourceOf(CREATE_BRACKET);
    for (const path of ['settings.tieBreakers.closestAbsolute', 'settings.tieBreakers.closestUnder']) {
      expect(source).toMatch(new RegExp(`name="${path.replace(/\./g, '\\.')}" helpId="bracket\\.tieBreak"`));
    }
    expect(topicFor('bracket.tieBreak', 'BRACKET')).toBeDefined();
  });

  it('all four playoff multiplier boxes name the one multiplier topic', () => {
    const source = sourceOf(CREATE_PLAYOFF);
    for (const round of ['WILD_CARD', 'DIVISIONAL', 'CONF_CHAMP', 'SUPER_BOWL']) {
      expect(source).toMatch(
        new RegExp(`name="settings\\.scoring\\.roundMultipliers\\.${round}" helpId="playoff\\.roundMultipliers"`),
      );
    }
    expect(topicFor('playoff.roundMultipliers', 'NFL_PLAYOFFS')).toBeDefined();
  });
});

describe('T12 — bracket copy and playoff copy stay in their own pool type', () => {
  const OTHERS: readonly PoolType[] = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'SQUARES', 'PROPS'];

  it('every T12 topic names exactly one pool type', () => {
    const wrong = BRACKET_TOPICS.filter((t) => t.poolTypes === 'all' || t.poolTypes.length !== 1).map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('a bracket topic never resolves for a playoff reader, and the reverse', () => {
    const leaks = BRACKET_TOPICS.flatMap((t) => {
      const own = (t.poolTypes as readonly PoolType[])[0];
      return ([...OTHERS, own === 'BRACKET' ? 'NFL_PLAYOFFS' : 'BRACKET'] as PoolType[])
        .filter((type) => type !== own)
        .flatMap((type) =>
          (['member', 'commissioner'] as const)
            .filter((aud) => topicFor(t.id, type, aud) !== undefined)
            .map((aud) => `${type}/${aud} resolves ${t.id}`),
        );
    });
    expect(leaks).toEqual([]);
  });

  it('…and it does resolve inside its own type, so the check above is not empty', () => {
    expect(topicFor('settings.scoringSystem', 'BRACKET', 'member')).toBeDefined();
    expect(topicFor('bracket.tieBreak', 'BRACKET', 'member')).toBeDefined();
    expect(topicFor('playoff.roundMultipliers', 'NFL_PLAYOFFS', 'member')).toBeDefined();
    expect(topicFor('settings.maxEntriesTotal', 'BRACKET', 'commissioner')).toBeDefined();
  });

  it('the commissioner-only topics are hidden from members', () => {
    for (const id of ['settings.maxEntriesTotal', 'settings.customScoring', 'seasonYear', 'gender', 'tournamentType']) {
      expect(topicFor(id, 'BRACKET', 'member'), `${id} is visible to a member`).toBeUndefined();
      expect(topicFor(id, 'BRACKET', 'commissioner'), `${id} is hidden from its own commissioner`).toBeDefined();
    }
  });
});

describe('T12 — the copy obeys the voice rules', () => {
  it('no topic uses a banned word, in any rendered branch', () => {
    const systems = [...Object.keys(SCORING_SYSTEM_LABELS), 'UPSET'];
    const violations = BRACKET_TOPICS.flatMap((t) => {
      const rendered = systems.map((scoringSystem) =>
        [resolveCopy(t.short, { settings: { scoringSystem } }), resolveCopy(t.long, { settings: { scoringSystem } })].join('\n'),
      );
      const copy = [allCopy(t), ...rendered].join('\n');
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      return hits.length ? [`${t.id}: ${hits.join(', ')}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it('every title and every short fits the budget', () => {
    const over = BRACKET_TOPICS.flatMap((t) => [
      ...(t.title.length > COPY_LIMITS.topicTitle ? [`${t.id}: title ${t.title.length}`] : []),
      ...(staticCopy(t.short).length > COPY_LIMITS.topicShort ? [`${t.id}: short ${staticCopy(t.short).length}`] : []),
    ]);
    expect(over).toEqual([]);
  });

  it('every short is one sentence, not two bolted together', () => {
    // Voice rule 3. Two sentences are allowed where the second is the default —
    // three is a paragraph and belongs in `long`.
    const tooMany = BRACKET_TOPICS.filter((t) => staticCopy(t.short).split(/[.!?]\s/).length > 2).map((t) => t.id);
    expect(tooMany).toEqual([]);
  });

  it('no topic writes a field path or a pool-type token at the reader', () => {
    // Voice rule 7. The reader has no settings object — `fields[]` may name a
    // path, the prose may not.
    const leaked = BRACKET_TOPICS.flatMap((t) => {
      const copy = allCopy(t);
      return ['settings.', 'roundMultipliers', 'closestUnder', 'closestAbsolute', 'NFL_PLAYOFFS', 'maxEntriesTotal']
        .filter((token) => copy.includes(token))
        .map((token) => `${t.id}: ${token}`);
    });
    expect(leaked).toEqual([]);
  });
});
