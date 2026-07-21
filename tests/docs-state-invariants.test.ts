import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
 * A line is exempt only if it says so. Two forms:
 *  - it is about TEST BASELINES, not deployment ("Baselines on `main` @ ...")
 *  - it carries an explicit <!-- historical --> annotation
 * Anything else counts as a live deploy-state claim.
 */
const EXEMPT_LINE = /baseline|<!--\s*historical\s*-->/i;

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
    const end = start + m[0].length;
    const line = text.slice(0, start).split(NL).length;

    // AN EXEMPTION APPLIES TO ITS OWN CLAUSE, and nothing else.
    //
    // Two weaker rules were tried and both were holed by review. Exempting the
    // whole LINE let one baseline mention exempt a live claim sharing that
    // line. Exempting a proximity WINDOW (line start, or the previous match,
    // through this match) was still a guess in both directions: a marker
    // attached to earlier prose that is not itself a claim leaked forward onto
    // the live one, and a marker written AFTER the claim it annotates was
    // invisible because the window stopped at the match.
    //
    // A clause is unambiguous, needs no proximity guess, and reads the way the
    // prose is actually written: "Baselines on `main` @ `x`; prod is `main` @
    // `y`" exempts the first and collects the second, and a trailing
    // `<!-- historical -->` still annotates the claim before it. Splitting too
    // FINELY can only detach a marker from its claim, which fails loudly rather
    // than passing silently — the safe direction for a guard to be wrong in.
    if (EXEMPT_LINE.test(clauseAround(text, start, end))) continue;

    const token = m[1].trim();
    claims.push({
      file: fileLabel,
      sha: token.toLowerCase(),
      line,
      start,
      wrapped: m[0].includes(NL),
      valid: VALID_SHA.test(token),
    });
  }
  return claims;
}

/** The clause containing [start, end): bounded by `.`, `;`, or a line break. */
function clauseAround(text: string, start: number, end: number): string {
  const BOUNDARY = /[.;\n]/;
  let from = start;
  while (from > 0 && !BOUNDARY.test(text[from - 1])) from--;
  let to = end;
  while (to < text.length && !BOUNDARY.test(text[to])) to++;
  return text.slice(from, to);
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
  it('requires every authoritative doc to state its deploy SHA', () => {
    const silent = AUTHORITATIVE_DOCS.filter(
      (doc) => !claims.some((c) => c.file === doc),
    );
    expect(
      silent,
      'these docs are the operator entry points but no longer state ' +
        '"`main` @ `<sha>`", so they have dropped out of the agreement check ' +
        'and can drift unnoticed',
    ).toEqual([]);
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

  it('never states two different deployed SHAs', () => {
    const distinct = [...new Set(claims.map((c) => c.sha))];
    const where = claims.map((c) => `${c.file}:${c.line} -> ${c.sha}`).sort();

    expect(
      distinct.length,
      'operator docs disagree about what is deployed. An operator reading the ' +
        'wrong one skips or repeats a deploy.\n' +
        'Fix the SHA, or — if a mention is historical or a test baseline — mark ' +
        'the line with <!-- historical --> so it is excluded deliberately ' +
        'rather than by accident.\n  ' +
        where.join('\n  '),
    ).toBe(1);
  });
});

describe('the scanner sees what the docs actually contain', () => {
  it('finds the claim that wraps across a line break', () => {
    // PICKUP wraps a live claim across a line break. A line-based scan missed
    // it entirely, so changing that SHA left the guard green while the docs
    // disagreed. Caught by cross-model review, not by me.
    // Asserts a claim whose MATCHED TEXT actually spans a newline. Counting
    // claims-per-file was the wrong assertion and was itself vacuous: PICKUP
    // already has two non-wrapped claims, so the count stayed above 1 even if
    // newline matching regressed. Caught by cross-model review.
    const claims = collectDeployShaClaims();
    expect(
      claims.filter((c) => c.wrapped).map((c) => `${c.file}:${c.line}`),
      'no deploy claim matched across a line break — the scanner has lost its ' +
        'newline tolerance and wrapped claims are now invisible',
    ).not.toEqual([]);
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
    it('exempts ONLY the baseline mention when a line carries both', () => {
      // The bug: a whole-line exemption let a live claim ride along beside a
      // baseline mention, so the doc could contradict production silently.
      const line = 'Baselines on `main` @ `aaaaaaa`; prod is `main` @ `bbbbbbb`.';
      const claims = collectClaimsFromText(line, 'fixture.md');
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
    });

    it('still exempts a plain baseline line', () => {
      expect(collectClaimsFromText('Baselines on `main` @ `aaaaaaa`.', 'f.md')).toEqual([]);
    });

    it('still exempts an explicitly historical line', () => {
      expect(
        collectClaimsFromText('<!-- historical --> prod was `main` @ `aaaaaaa`.', 'f.md'),
      ).toEqual([]);
    });

    it('collects an ordinary deploy claim', () => {
      const claims = collectClaimsFromText('prod = `main` @ `abc1234`', 'f.md');
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ sha: 'abc1234', valid: true, line: 1 });
    });

    it('does not let an exemption leak from one LINE into the next', () => {
      const NL = String.fromCharCode(10);
      const text = `Baselines on \`main\` @ \`aaaaaaa\`.${NL}Prod is \`main\` @ \`bbbbbbb\`.`;
      const claims = collectClaimsFromText(text, 'f.md');
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
      expect(claims[0].line).toBe(2);
    });

    it('does NOT let a marker on unrelated earlier prose exempt a live claim', () => {
      // The marker annotates "Old build abc", which is not a claim at all. A
      // proximity window would have handed its exemption to the live claim.
      const claims = collectClaimsFromText(
        'Old build abc <!-- historical -->; prod is `main` @ `bbbbbbb`.', 'f.md',
      );
      expect(claims.map((c) => c.sha)).toEqual(['bbbbbbb']);
    });

    it('honours a marker written AFTER the claim it annotates', () => {
      // A window ending at the match could not see a trailing annotation.
      expect(
        collectClaimsFromText('prod was `main` @ `aaaaaaa` <!-- historical -->', 'f.md'),
      ).toEqual([]);
    });

    it('flags a non-hex token as an invalid SHA rather than silently accepting it', () => {
      expect(collectClaimsFromText('prod = `main` @ `not-a-sha`', 'f.md')[0].valid).toBe(false);
    });
  });
});
