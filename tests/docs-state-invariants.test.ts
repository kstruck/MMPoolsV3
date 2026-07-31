import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * Docs state invariants — mechanical guards for the failure mode that keeps
 * recurring in this repo's operator docs.
 *
 * WHY THIS EXISTS. "Which SHA is actually deployed" has been wrong three times:
 *   1. HANDOFF said "prod matches main / backlog CLEARED" while PICKUP listed a
 *      non-empty deploy queue. An operator following PICKUP's own instruction to
 *      go read HANDOFF gets false confidence and SKIPS THE DEPLOY.
 *   2. The fix for (1) itself shipped with two different prod SHAs in PICKUP —
 *      one in §2, a stale one in §4.
 *   3. The Coolify deploy-model contradiction (auto-deploy vs manual trigger) is
 *      still open in two files.
 *
 * Prose rules did not stop any of these; the second was introduced by the same
 * session that fixed the first. A test does, which is the whole point: a rule
 * that only lives in a paragraph does not gate anything.
 *
 * DESIGN NOTE — why this matches broadly and exempts explicitly.
 *
 * The first version of this file matched only the exact phrase
 * "prod matches `main` @ `<sha>`". A cross-model review pointed out that the
 * docs ALREADY state current deploy state in other wordings — "`main` @ `<sha>`
 * = prod", "`main` @ `<sha>`, deployed" — so the guard would have passed while
 * those drifted. A guard that looks like it guards but does not is the exact
 * class of bug this file exists to stop, so it is now the other way round:
 *
 *   EVERY "`main` @ `<sha>`" is treated as a claim about what is deployed,
 *   and anything that is NOT such a claim must say so explicitly.
 *
 * Fail-safe by default. Adding a new SHA mention cannot silently escape the
 * check; it fails until the author either fixes it or annotates it.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * The operator entry points. Each MUST state a deploy SHA, so neither can quietly
 * drop out of the agreement check by rewording its way out.
 */
const AUTHORITATIVE_DOCS = ['HANDOFF.md', 'PICKUP-PRESEASON-PILOT.md'];

/**
 * KNOWN LIMIT, stated rather than papered over.
 *
 * This file compares SHAs. It does NOT compare deploy-QUEUE prose — two docs can
 * agree on the SHA while one says "queue EMPTY" and the other lists work
 * awaiting deploy, which is the original incident. That was considered and
 * deliberately not automated: queue state is free text with no canonical form,
 * and a fuzzy matcher would produce false failures. An invariant that cries wolf
 * gets ignored, and then the real one is missed — the same reasoning as the
 * heartbeat tolerance multiplier.
 *
 * The SHA check is the mechanical half. The queue half stays a human review
 * item; keeping both docs' queue statements in one place is the mitigation.
 */

/**
 * Any "`main` @ `<sha>`" construction, whatever prose surrounds it.
 *
 * Whitespace-tolerant, not a literal space — the docs already wrap this across
 * a line break ("...landed on `main`" / newline / "@ `84e080c`"), and a
 * line-based scan silently missed it. Scanned over the whole file, with the
 * line number derived from the match offset.
 */
const MAIN_SHA = /`main`\s*@\s*`([^`]+)`/gi;

/** What a usable abbreviated commit id looks like. */
const VALID_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * A mention is exempt ONLY when this marker sits IMMEDIATELY before it, with
 * nothing but whitespace in between:
 *
 *     Baselines on <!-- deploy-state:ignore --> `main` @ `16746b8`
 *
 * Note the position: the marker goes between the prose and the construction,
 * NOT at the start of the sentence. Prose in between breaks the binding.
 *
 * EXACT ADJACENCY, DELIBERATELY. Four softer rules were tried and review holed
 * every one, because they all guessed at which mention a nearby keyword meant:
 * whole-line (one baseline mention exempted a live claim sharing its line), a
 * proximity window (a marker on unrelated earlier prose leaked forward; a
 * marker written after the claim was invisible), clause-scoped (same leak
 * inside one sentence), and clause-scoped-plus-single-mention (still exempted
 * a live claim sitting in a clause whose marker annotated other prose).
 *
 * There is no proximity rule that resolves "which mention does this word mean"
 * from prose, so the contract changed instead: an exempt mention is TAGGED, and
 * the tag can only bind to the thing it touches. Costs one visible marker per
 * exempt line; buys a rule with no interpretation left in it. The old magic
 * word "baseline" is gone too — it silently exempted any sentence that happened
 * to contain it.
 */
const EXEMPT_MARKER = /<!--\s*deploy-state:ignore\s*-->\s*$/i;

/**
 * The LIVE claim in each authoritative doc must carry this tag, in the same
 * immediately-before position:
 *
 *     prod matches <!-- deploy-state:current --> `main` @ `a28030d`
 *
 * Without it, "this doc still states a deploy SHA" was satisfied by ANY mention
 * anywhere in the file — including a dated or historical one. Rewording the
 * live banner ("Production commit: ...") would then drop the real claim out of
 * the comparison while old mentions kept the check green, and the two entry
 * points could name different commits with nothing failing. That is the exact
 * contradiction this file exists to catch, so the live claim is now named
 * rather than inferred from position or phrasing.
 */
const CURRENT_MARKER = /<!--\s*deploy-state:current\s*-->\s*$/i;

/** Root docs plus nested runbooks — a stale SHA is no less wrong under docs/. */
function operatorMarkdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) walk(full, depth - 1);
      } else if (e.name.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  // Root .md files, plus docs/ one level deep (docs/adr/*.md included).
  for (const e of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) out.push(path.join(REPO_ROOT, e.name));
  }
  const docsDir = path.join(REPO_ROOT, 'docs');
  if (fs.existsSync(docsDir)) walk(docsDir, 2);
  return out;
}

interface Claim {
  file: string;
  sha: string;
  line: number;
  /** Byte offset of the match — the only per-mention identity that is exact. */
  start: number;
  /** Tagged <!-- deploy-state:current -->, i.e. THE live claim for its file. */
  current: boolean;
  /** Did the matched text span a line break? Pins newline tolerance honestly. */
  wrapped: boolean;
  /** False when the token is not a usable commit id (e.g. a non-hex typo). */
  valid: boolean;
}

/**
 * Collect claims from one document's text. Exported shape so the scanner can be
 * exercised against FIXTURES rather than only against the live docs — a guard
 * whose only test subject is the very file it guards can only be proven by
 * editing that file, which is how the previous version ended up asserting
 * against a SHA that did not exist.
 */
export function collectClaimsFromText(text: string, fileLabel: string): Claim[] {
  const claims: Claim[] = [];
  const NL = String.fromCharCode(10);
  for (const m of text.matchAll(MAIN_SHA)) {
    const start = m.index!;
    const line = text.slice(0, start).split(NL).length;

    // The marker must TOUCH this mention: everything before it on this line,
    // ending in the tag and optional whitespace. No proximity, no guessing.
    // Prose between the tag and the claim breaks the binding, which is the
    // point — a tag can then only ever exempt the mention it was written for.
    const lineStart = text.slice(0, start).lastIndexOf(NL) + 1;
    if (EXEMPT_MARKER.test(text.slice(lineStart, start))) continue;

    const token = m[1].trim();
    claims.push({
      file: fileLabel,
      sha: token.toLowerCase(),
      line,
      start,
      current: CURRENT_MARKER.test(text.slice(lineStart, start)),
      wrapped: m[0].includes(NL),
      valid: VALID_SHA.test(token),
    });
  }
  return claims;
}

function collectDeployShaClaims(): Claim[] {
  const claims: Claim[] = [];
  for (const file of operatorMarkdownFiles()) {
    claims.push(...collectClaimsFromText(
      fs.readFileSync(file, 'utf8'),
      path.relative(REPO_ROOT, file).split(path.sep).join('/'),
    ));
  }
  return claims;
}

/**
 * NO PREFIX MATCHING. An earlier draft treated any lexical prefix as the same
 * commit, which silently accepted a typo after the seventh character —
 * `84e080cf` would have merged with `84e080c`. Cross-model review caught it,
 * AND caught that the fixture "proving" it worked used a SHA I had invented
 * (`84e080c436d...`); the real object is `84e080cec109...`. A guard whose proof
 * is fabricated is worse than no guard.
 *
 * So: exact string equality. If one doc abbreviates and another does not, that
 * is reported as an inconsistency to fix rather than quietly merged — which is
 * the correct outcome, since a single canonical abbreviation is what makes the
 * docs greppable in the first place.
 */

describe('operator docs agree on what is deployed', () => {
  const claims = collectDeployShaClaims();

  // Guards the regex itself. If the wording is changed everywhere, this test
  // would otherwise pass vacuously forever while protecting nothing.
  it('finds at least one deploy-state SHA claim', () => {
    expect(
      claims.length,
      'no operator doc states "`main` @ `<sha>`" — either the deploy-state marker ' +
        'was removed, or the wording drifted and this guard is now inert',
    ).toBeGreaterThan(0);
  });

  // Per-file, not just globally. A global count stays positive when ONE doc
  // drops its marker, so that file silently leaves the comparison and can then
  // say anything at all — which is the original failure: two entry-point docs
  // disagreeing. Both must keep participating.
  it('requires every authoritative doc to TAG exactly one live deploy SHA', () => {
    // Counted on TAGGED claims only. Accepting any mention anywhere let a
    // historical or dated one stand in for the live banner, so rewording the
    // banner out of the pattern would drop the real claim from the comparison
    // while the check stayed green.
    const wrong = AUTHORITATIVE_DOCS
      .map((doc) => [doc, claims.filter((c) => c.file === doc && c.current).length] as const)
      .filter(([, n]) => n !== 1)
      .map(([doc, n]) => `${doc}: ${n} tagged live claim(s), expected exactly 1`);
    expect(
      wrong,
      'each operator entry point must mark its CURRENT deploy claim with ' +
        '<!-- deploy-state:current --> immediately before the `main` @ `sha` ' +
        'construction. Without it the doc can drift out of the agreement check ' +
        'while stale mentions keep this green',
    ).toEqual([]);
  });

  it('the tagged live claims agree with each other', () => {
    // The narrowest statement of the original incident: the two entry points
    // naming different deployed commits.
    const live = claims.filter((c) => c.current);
    expect(
      [...new Set(live.map((c) => c.sha))].length,
      'the operator entry points TAG different deploy SHAs: ' +
        live.map((c) => `${c.file}:${c.line} -> ${c.sha}`).join(', '),
    ).toBe(1);
  });

  // A non-hex typo (`84e080g`) used to produce NO match at all, so the doc's
  // deploy state simply vanished from the check while the other docs still
  // agreed and the suite stayed green — the guard silently accepting exactly
  // the mistake it exists to catch. Malformed tokens now fail loudly.
  it('rejects a malformed commit id instead of ignoring it', () => {
    const bad = claims.filter((c) => !c.valid);
    expect(
      bad.map((c) => `${c.file}:${c.line} -> ${c.sha}`),
      'a "`main` @ `...`" claim is not a usable commit id (7-40 hex chars)',
    ).toEqual([]);
  });

  // A hex-shaped typo copied into BOTH docs passes every check above: the format
  // test calls it valid and the agreement test sees one distinct value. The docs
  // would then agree on a commit that does not exist. Only git can tell.
  it('every claimed SHA is a real commit ON origin/main', () => {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }).trim();
    // Stated, not skipped silently. CI checks out with fetch-depth: 0 for this
    // job precisely so this runs there; if that regresses, this says so.
    expect(shallow, 'shallow clone — this check cannot run; set fetch-depth: 0').toBe('false');

    // ANCESTOR OF origin/main, not merely "an object that exists". A SHA taken
    // from an unmerged branch resolves fine — the checkout holds those objects
    // — so existence alone would let both docs agree on a commit that is not on
    // main at all, while the claim says it is.
    const git = (args: string[]) => execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' });
    let hasOriginMain = true;
    try { git(['rev-parse', '--verify', 'origin/main']); } catch { hasOriginMain = false; }
    expect(hasOriginMain, 'origin/main is not available — this check cannot run').toBe(true);

    const unresolved = claims.filter((c) => {
      try {
        git(['merge-base', '--is-ancestor', `${c.sha}^{commit}`, 'origin/main']);
        return false;
      } catch {
        return true;
      }
    });
    expect(
      unresolved.map((c) => `${c.file}:${c.line} -> ${c.sha}`),
      'a deploy-state SHA is not a commit on origin/main — either a typo that ' +
        'is still valid hex, or a SHA taken from an unmerged branch. Both make ' +
        'the docs agree on something that was never deployed',
    ).toEqual([]);
  });

  it('never states two different deployed SHAs', () => {
    const distinct = [...new Set(claims.map((c) => c.sha))];
    const where = claims.map((c) => `${c.file}:${c.line} -> ${c.sha}`).sort();

    expect(
      distinct.length,
      'operator docs disagree about what is deployed. An operator reading the ' +
        'wrong one skips or repeats a deploy.\n' +
        'Fix the SHA, or — if a mention is historical or a test baseline — put ' +
        '<!-- deploy-state:ignore --> IMMEDIATELY before its `main` @ `sha` ' +
        'construction (prose in between breaks the binding, deliberately), so ' +
        'it is excluded on purpose rather than by accident.\n  ' +
        where.join('\n  '),
    ).toBe(1);
  });
});

describe('the scanner sees what the docs actually contain', () => {
  it('finds the claim that wraps across a line break', () => {
    // Exercised on a FIXTURE, not on the live docs. PICKUP happens to wrap a
    // claim across a line break today, but reflowing that paragraph onto one
    // line is a semantics-preserving edit that would fail this test while
    // nothing was actually broken — a guard that fires on correct changes gets
    // deleted, and then the real regression ships. What must be pinned is the
    // SCANNER's newline tolerance, which a fixture pins exactly.
    const NL = String.fromCharCode(10);
    const wrapped = collectClaimsFromText(
      `...landed on \`main\`${NL}@ \`abc1234\`.`, 'fixture.md',
    );
    expect(
      wrapped.map((c) => c.wrapped),
      'a deploy claim split across a line break was not matched — the scanner ' +
        'has lost its newline tolerance, and PICKUP already writes one this way',
    ).toEqual([true]);
  });

  it('excludes test-baseline lines, which are not deploy claims', () => {
    // A baseline line records where TEST COUNTS were measured, not what is in
    // production, and must not trip the guard.
    //
    // Checked BY LOCATION, not by SHA value. An earlier version asserted that
    // the baseline's SHA was absent from the claim list — which fails on
    // perfectly correct docs the moment the baseline happens to be measured on
    // the commit that is also deployed, since the legitimate deploy claim
    // carries the same value. Same class as the prefix-matching bug below:
    // treating a SHA VALUE as an identity for a specific mention.
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'PICKUP-PRESEASON-PILOT.md'),
      'utf8',
    );
    // Identified by the MATCH OFFSET of the baseline mention itself. Neither a
    // SHA value nor a line number is a per-mention identity: the value collides
    // whenever a baseline is measured on the deployed commit, and the line
    // collides whenever a baseline and a live claim legitimately share one.
    const baselineMention = new RegExp(
      'Baselines[^.;' + String.fromCharCode(10) + ']*?`main`\\s*@\\s*`[^`]+`', 'i',
    ).exec(src);

    expect(
      baselineMention,
      'no "Baselines on `main` @ `<sha>`" mention found — this exemption test ' +
        'can no longer prove anything; re-point it at a real baseline line',
    ).not.toBeNull();

    // Where the `main` @ `sha` construction starts inside that mention.
    const shaOffset = baselineMention!.index +
      baselineMention![0].search(/`main`\s*@/i);

    const claims = collectDeployShaClaims();
    expect(
      claims.some((c) => c.file === 'PICKUP-PRESEASON-PILOT.md' && c.start === shaOffset),
      `the baseline mention at PICKUP-PRESEASON-PILOT.md offset ${shaOffset} produced a ` +
        'deploy-state claim — the exemption rule is no longer suppressing baseline mentions',
    ).toBe(false);
  });

  // The scanner run against FIXTURES rather than the live docs. These pin the
  // two behaviours that cannot be demonstrated against the real files without
  // editing them — which is exactly how an earlier version of this guard ended
  // up "proven" by a SHA that did not exist.
  describe('scanner behaviour, on fixtures', () => {
    const TAG = '<!-- deploy-state:ignore -->';

    it('exempts ONLY the tagged mention when a line carries two', () => {
      const claims = collectClaimsFromText(
        `Baselines on ${TAG} \`main\` @ \`aaaaaaa\`; prod is \`main\` @ \`bbbbbbb\`.`,
        'f.md',
      );
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
    });

    it('exempts a tagged mention', () => {
      expect(collectClaimsFromText(`Baselines on ${TAG} \`main\` @ \`aaaaaaa\`.`, 'f.md')).toEqual([]);
    });

    it('does NOT exempt an UNTAGGED baseline line — "baseline" is no longer magic', () => {
      // The old rule exempted any sentence containing the word. A guard that
      // keys on prose exempts prose it was never meant to.
      expect(collectClaimsFromText('Baselines on `main` @ `aaaaaaa`.', 'f.md'))
        .toHaveLength(1);
    });

    it('does NOT let a tag on unrelated prose exempt a live claim', () => {
      // The exact hole every proximity rule had: the tag annotates other text,
      // and prose between it and the claim breaks the binding.
      const claims = collectClaimsFromText(
        `Old build abc ${TAG}, while prod is \`main\` @ \`bbbbbbb\`.`, 'f.md',
      );
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
    });

    it('does NOT exempt when a tag trails the claim — a tag binds forward only', () => {
      // One direction, not two. "Immediately before" is checkable with no
      // interpretation; "somewhere after" reopens the guessing.
      expect(
        collectClaimsFromText(`prod was \`main\` @ \`aaaaaaa\` ${TAG}`, 'f.md'),
      ).toHaveLength(1);
    });

    it('does not let a tag leak across a line break', () => {
      const NL = String.fromCharCode(10);
      const claims = collectClaimsFromText(
        `Baselines on ${TAG} \`main\` @ \`aaaaaaa\`.${NL}Prod is \`main\` @ \`bbbbbbb\`.`,
        'f.md',
      );
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
      expect(claims[0].line).toBe(2);
    });

    it('collects an ordinary deploy claim', () => {
      const claims = collectClaimsFromText('prod = `main` @ `abc1234`', 'f.md');
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ sha: 'abc1234', valid: true, line: 1 });
    });

    it('flags a non-hex token as an invalid SHA rather than silently accepting it', () => {
      expect(collectClaimsFromText('prod = `main` @ `not-a-sha`', 'f.md')[0].valid).toBe(false);
    });
  });
});

/**
 * The Hall of Fame game is 2026-08-06, and every operator doc said 2026-08-07.
 *
 * WHY. ESPN reports its kickoff as `2026-08-07T00:00Z` — 8:00pm ET is midnight
 * UTC the following day — and that UTC date was copied down as if it were the
 * calendar date, into HANDOFF, PICKUP, the pilot plan and two morning notes.
 * Kevin caught it on 2026-07-21.
 *
 * A prose fix alone would rot, because the wrong date is *derivable* from a
 * correct feed value: the next person to read `2026-08-07T00:00Z` in the
 * fixture can reintroduce it in good faith. Hence one check.
 *
 * DELIBERATELY ONLY ONE. An earlier version of this PR also tagged every live
 * deadline and compared them across documents. It was three tag types and three
 * scanners guarding a five-line prose fix, and successive review rounds kept
 * finding holes in that machinery rather than in the thing it protected. The
 * guard should not be larger than the bug.
 *
 * KNOWN LIMIT, chosen rather than overlooked: this catches the WRONG DATE. It
 * does not verify the two entry points still agree on the deadline, so moving
 * the target in one file and not the other fails nothing here. That was the
 * apparatus just deleted; if that failure ever actually happens, this is the
 * note that says it was a known trade.
 */
export const HOF_GAME_ET = '2026-08-06';

/**
 * `2026-08-07` in any form EXCEPT the feed's midnight-UTC kickoff instant.
 *
 * The lookahead is the whole guard, and its width is the whole argument.
 * Matching unconditionally would ban the correct `2026-08-07T00:00Z` and force
 * authors to stop explaining the bug, which trains people to work around a
 * guard instead of with it. But exempting "followed by a time" was too wide:
 * `2026-08-07T20:00:00-04:00` states the WRONG ET date in timestamp clothing.
 *
 * So the exemption is the midnight-UTC instant specifically. Seconds and
 * fractional seconds are allowed because `T00:00:00Z` and `T00:00:00.000Z`
 * denote the same instant and flagging them would cry wolf. Any other offset or
 * time-of-day is not the feed value and is flagged.
 */
const BARE_WRONG_HOF_DATE = /2026-08-07(?!T00:00(:00(\.\d+)?)?Z)/g;

/**
 * Escape hatch for an honest, unrelated 2026-08-07.
 *
 * The date is a real calendar day and these docs are full of dated notes. A
 * "MORNING 2026-08-07" written the day after the game is correct, and failing
 * CI on it would tell the author to change a right date to a wrong one — the
 * cry-wolf failure that gets an invariant ignored, and then the real one is
 * missed.
 *
 * Scoping to "near the words Hall of Fame" was the alternative and is rejected
 * for the reason the deploy-SHA guard above already documents: no proximity
 * rule resolves which mention a phrase refers to. So this reuses that guard's
 * contract — an exempt mention is TAGGED, and the tag binds only to what it
 * touches, same line, immediately before:
 *
 *     Deployed <!-- hof-date:ignore --> 2026-08-07, the morning after.
 *
 * Markdown emphasis (`*` or `_`) and backticks may sit between the tag and the
 * date; prose may not. Underscores are there because the comment used to
 * promise "Markdown emphasis" while the class held only `*`, so reformatting a
 * tagged date to `__2026-08-07__` made the tag stop binding — a cosmetic edit
 * turning CI red and pointing the author at the wrong problem. Horizontal
 * whitespace only, so a dangling tag cannot vouch for a date further down.
 */
const HOF_DATE_EXEMPT =
  /<!--[^\S\n]*hof-date:ignore[^\S\n]*-->[^\S\n]*[*_`]*[^\S\n]*$/i;

/** Lines in one document where the wrong HOF date appears untagged. */
export function wrongHofDateMentions(text: string): number[] {
  const NL = String.fromCharCode(10);
  const lines: number[] = [];
  for (const m of text.matchAll(BARE_WRONG_HOF_DATE)) {
    const start = m.index!;
    const lineStart = text.slice(0, start).lastIndexOf(NL) + 1;
    if (HOF_DATE_EXEMPT.test(text.slice(lineStart, start))) continue;
    lines.push(text.slice(0, start).split(NL).length);
  }
  return lines;
}

describe('operator docs state the right Hall of Fame date', () => {
  it('no operator doc dates the HOF game 2026-08-07', () => {
    const offenders: string[] = [];
    for (const file of operatorMarkdownFiles()) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      for (const line of wrongHofDateMentions(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(
      offenders,
      `The Hall of Fame game is ${HOF_GAME_ET} (Thu, 8:00pm ET). A bare ` +
        "2026-08-07 is ESPN's UTC kickoff date mistaken for the calendar date. " +
        'Write 2026-08-06; or 2026-08-07T00:00Z if you mean the feed value; or ' +
        'tag the line <!-- hof-date:ignore --> if you genuinely mean that ' +
        'calendar day and it is not about the game.',
    ).toEqual([]);
  });

  describe('the date scanner sees what it claims to', () => {
    const HOF_TAG = '<!-- hof-date:ignore -->';

    it('flags a bare wrong date', () => {
      expect(wrongHofDateMentions('HOF game 2026-08-07.')).toEqual([1]);
    });

    it('does not flag the correct date', () => {
      expect(wrongHofDateMentions(`HOF game ${HOF_GAME_ET}.`)).toEqual([]);
    });

    it("does NOT flag the feed's UTC kickoff instant, in any precision", () => {
      expect(wrongHofDateMentions('ESPN says `2026-08-07T00:00Z`.')).toEqual([]);
      expect(wrongHofDateMentions('`2026-08-07T00:00:00Z`')).toEqual([]);
      expect(wrongHofDateMentions('`2026-08-07T00:00:00.000Z`')).toEqual([]);
    });

    it('DOES flag the wrong ET date dressed as a timestamp', () => {
      expect(wrongHofDateMentions('kickoff 2026-08-07T20:00:00-04:00')).toEqual([1]);
      expect(wrongHofDateMentions('2026-08-07T00:00-04:00')).toEqual([1]);
    });

    it('exempts a tagged unrelated mention', () => {
      expect(wrongHofDateMentions(`Deployed ${HOF_TAG} 2026-08-07.`)).toEqual([]);
    });

    it('exempts a tagged mention through emphasis of either flavour', () => {
      expect(wrongHofDateMentions(`${HOF_TAG} **2026-08-07**`)).toEqual([]);
      expect(wrongHofDateMentions(`${HOF_TAG} __2026-08-07__`)).toEqual([]);
      expect(wrongHofDateMentions(`${HOF_TAG} \`2026-08-07\``)).toEqual([]);
    });

    it('does NOT exempt when the tag trails the mention — it binds forward only', () => {
      expect(wrongHofDateMentions(`2026-08-07 ${HOF_TAG}`)).toEqual([1]);
    });

    it('does not let the tag leak across a line break', () => {
      const NL = String.fromCharCode(10);
      expect(wrongHofDateMentions(`${HOF_TAG} 2026-08-07${NL}HOF game 2026-08-07`))
        .toEqual([2]);
    });

    it('does not let the tag leak to a second mention on the same line', () => {
      // One tag, one exemption. Otherwise annotating a legitimate date would
      // silently vouch for a wrong one written after it.
      expect(wrongHofDateMentions(`${HOF_TAG} 2026-08-07 and HOF is 2026-08-07`))
        .toEqual([1]);
    });

    it('reports the line of every offender, not just the first', () => {
      const NL = String.fromCharCode(10);
      expect(wrongHofDateMentions(`a${NL}2026-08-07${NL}b${NL}c 2026-08-07`))
        .toEqual([2, 4]);
    });
  });
});

/**
 * App Check must stay OFF, and the reason must stay written down.
 *
 * WHY THIS EXISTS. On 2026-07-30 someone set `VITE_RECAPTCHA_SITE_KEY` in the
 * Coolify environment to turn App Check on. Production rendered nothing —
 * permanent spinner, confirmed from two independent machines and networks —
 * until the variable was deleted and the site redeployed. The mechanism is
 * entirely client-side: the key flips `src/firebase.ts` onto the initialize
 * branch, `ReCaptchaEnterpriseProvider` loads a script that `nginx.conf`'s
 * `script-src` does not allow, the App Check token never resolves, and the
 * Firestore SDK — which blocks its first request on that token — goes offline.
 *
 * It looked safe because every callable runs App Check in `monitor` mode. That
 * is a TRUE fact supporting a FALSE conclusion: server-side leniency cannot
 * rescue a client that fails before it issues a request.
 *
 * Two things can quietly undo this, and each gets an assertion:
 *
 *   1. Somebody "cleans up" the conditional in `src/firebase.ts` so App Check
 *      initializes unconditionally. That reintroduces the outage in CODE, where
 *      no env var is needed to trigger it.
 *   2. Somebody trims the incident out of HANDOFF. The warning is the only
 *      defence against the env var being set again, because a Coolify variable
 *      is not something a test can reach.
 *
 * This is deliberately NOT a guard on `appCheck: "enforce"` in functions. Moving
 * callables to enforce is legitimate future work; setting the client site key
 * while the three faults stand is not.
 */
describe('App Check stays off, and the outage stays documented', () => {
  /** Phrasings that count as "this doc tells you not to set the key". */
  const DO_NOT_SET_PHRASES = [
    'DO NOT SET',
    'do not set',
    'Do not set',
    'MUST STAY absent',
    'must stay absent',
    'took production down',
    'took prod down',
  ];

  /**
   * Which of the two required signals a doc is missing. Returns [] when the doc
   * both names the variable AND says not to set it — a doc that names it with
   * no warning is worse than one that never mentions it, because a reader
   * searching for the variable finds a neutral hit.
   */
  function appCheckWarningGapsIn(text: string): string[] {
    const gaps: string[] = [];
    if (!text.includes('VITE_RECAPTCHA_SITE_KEY')) gaps.push('names-the-variable');
    if (!DO_NOT_SET_PHRASES.some((p) => text.includes(p))) gaps.push('says-do-not-set');
    return gaps;
  }

  describe('the real files', () => {
    it('src/firebase.ts initializes App Check ONLY behind the site-key conditional', () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'firebase.ts'), 'utf8');

      // Exactly one call site. Two would mean one of them escaped the guard.
      const callSites = src.split('initializeAppCheck(').length - 1;
      expect(callSites).toBe(1);

      // The guard itself must still be there...
      const guardAt = src.indexOf('if (recaptchaSiteKey)');
      expect(guardAt).toBeGreaterThan(-1);

      // ...and the call must come after it, not before.
      expect(src.indexOf('initializeAppCheck(')).toBeGreaterThan(guardAt);

      // And the non-DEV branch must still warn rather than fall silent, because
      // that warning is how an operator confirms the SAFE state is in effect.
      expect(src).toContain('App Check is NOT active');
    });

    it('HANDOFF.md carries the do-not-set warning', () => {
      const handoff = fs.readFileSync(path.join(REPO_ROOT, 'HANDOFF.md'), 'utf8');
      expect(appCheckWarningGapsIn(handoff)).toEqual([]);
    });
  });

  /**
   * Guard the guard. A matcher that cannot report a gap is not a matcher, and
   * this repo has shipped three assertions that passed with the defect present.
   */
  describe('the gap detector actually detects gaps', () => {
    it('flags a doc that mentions neither', () => {
      expect(appCheckWarningGapsIn('nothing about attestation here'))
        .toEqual(['names-the-variable', 'says-do-not-set']);
    });

    it('flags a doc that names the variable with NO warning — the dangerous case', () => {
      expect(appCheckWarningGapsIn('Supply VITE_RECAPTCHA_SITE_KEY for prod-like builds.'))
        .toEqual(['says-do-not-set']);
    });

    it('flags a warning that never names the variable', () => {
      expect(appCheckWarningGapsIn('Do not set the App Check key.'))
        .toEqual(['names-the-variable']);
    });

    it('accepts a doc carrying both', () => {
      expect(appCheckWarningGapsIn('⛔ DO NOT SET VITE_RECAPTCHA_SITE_KEY in prod.'))
        .toEqual([]);
    });

    it('accepts every phrasing in the allow-list, so a reword does not silently pass', () => {
      for (const phrase of DO_NOT_SET_PHRASES) {
        expect(appCheckWarningGapsIn(`VITE_RECAPTCHA_SITE_KEY — ${phrase}`)).toEqual([]);
      }
    });
  });
});
