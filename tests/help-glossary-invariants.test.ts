import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLOSSARY, GLOSSARY_ALLOWLIST } from '../src/help/glossary';
import { BANNED_IMPLEMENTATION_WORDS, BANNED_SELLING_WORDS, COPY_LIMITS, findBannedWords } from '../src/help/voice';

/**
 * Glossary ↔ CONTEXT.md invariants — PLAN-HELP-SYSTEM.md §3 D4, decision K1.
 *
 * WHY A MIRROR RATHER THAN A GENERATOR. The obvious design is to parse
 * CONTEXT.md at build time and ship it. It was rejected because CONTEXT.md is
 * written for engineers — "Stored as a uid in the SERVER-OWNED
 * `pools/{id}.coManagers` array (max 3), written only by the
 * `setPoolCoCommissioner` callable" — and that is the wrong copy to put in
 * front of a member. Adding member-facing wording to CONTEXT.md was rejected
 * too: it is a glossary, not a content file.
 *
 * So the copy is hand-written for the reader, and THIS TEST is what keeps
 * CONTEXT.md authoritative. It fails when CONTEXT.md gains a term nothing
 * mirrors, when a mirror names a heading that has been renamed or deleted,
 * and when an allowlist row outlives the heading it excused. A hand-mirror
 * with no such test is just two documents drifting.
 */

const root = resolve(__dirname, '..');
const CONTEXT = readFileSync(resolve(root, 'CONTEXT.md'), 'utf8');

/** Every `### ` heading under the Glossary section of CONTEXT.md. */
function contextHeadings(): string[] {
  return [...CONTEXT.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
}

describe('CONTEXT.md parsing', () => {
  const headings = contextHeadings();

  // Guards the regex. Every assertion below is vacuous on an empty list, and a
  // guard that passes because it found nothing is the exact failure mode the
  // repo's other invariant tests were written to stop.
  it('finds the glossary headings', () => {
    expect(headings.length).toBeGreaterThan(40);
    expect(headings).toContain('Entry Fee');
    expect(headings).toContain('Payout Record');
  });

  it('has no duplicate headings that would make a mirror ambiguous', () => {
    const seen = new Set<string>();
    const dupes = headings.filter((h) => (seen.has(h) ? true : (seen.add(h), false)));
    expect(dupes).toEqual([]);
  });
});

describe('every CONTEXT.md term is mirrored or allowlisted', () => {
  const headings = contextHeadings();
  const mirrored = new Set(GLOSSARY.map((t) => t.contextHeading));
  const allowlisted = new Set(Object.keys(GLOSSARY_ALLOWLIST));

  it('no CONTEXT.md term is unaccounted for', () => {
    const missing = headings.filter((h) => !mirrored.has(h) && !allowlisted.has(h));
    expect(missing).toEqual([]);
  });

  it('no mirror names a heading CONTEXT.md does not have', () => {
    const stale = GLOSSARY.filter((t) => !headings.includes(t.contextHeading)).map(
      (t) => `${t.id} → "${t.contextHeading}"`,
    );
    expect(stale).toEqual([]);
  });

  it('no allowlist row names a heading CONTEXT.md does not have', () => {
    const stale = [...allowlisted].filter((h) => !headings.includes(h));
    expect(stale).toEqual([]);
  });

  it('no term is both mirrored and allowlisted', () => {
    const both = [...mirrored].filter((h) => allowlisted.has(h));
    expect(both).toEqual([]);
  });

  it('every allowlist row gives a reason', () => {
    const thin = Object.entries(GLOSSARY_ALLOWLIST)
      .filter(([, reason]) => reason.trim().length < 25)
      .map(([heading]) => heading);
    expect(thin).toEqual([]);
  });

  it('two mirrors never claim the same CONTEXT.md heading', () => {
    expect(mirrored.size).toBe(GLOSSARY.length);
  });
});

describe('glossary entries are well formed', () => {
  it('ids are unique', () => {
    expect(new Set(GLOSSARY.map((t) => t.id)).size).toBe(GLOSSARY.length);
  });

  it('ids are kebab-case, so they are stable in a ?help= link', () => {
    const bad = GLOSSARY.filter((t) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)).map((t) => t.id);
    expect(bad).toEqual([]);
  });

  it('every related id resolves to another term', () => {
    const ids = new Set(GLOSSARY.map((t) => t.id));
    const broken = GLOSSARY.flatMap((t) =>
      (t.related ?? []).filter((r) => !ids.has(r)).map((r) => `${t.id} → ${r}`),
    );
    expect(broken).toEqual([]);
  });

  it('no term lists itself as related', () => {
    const selfish = GLOSSARY.filter((t) => (t.related ?? []).includes(t.id)).map((t) => t.id);
    expect(selfish).toEqual([]);
  });

  it('every term names at least one audience', () => {
    expect(GLOSSARY.filter((t) => t.audience.length === 0).map((t) => t.id)).toEqual([]);
  });

  it('every term has both a short and a long form', () => {
    const thin = GLOSSARY.filter((t) => !t.short.trim() || !t.long.trim()).map((t) => t.id);
    expect(thin).toEqual([]);
  });
});

describe('glossary copy obeys docs/help-voice.md', () => {
  it('stays inside the length budget', () => {
    const over = GLOSSARY.flatMap((t) => [
      ...(t.term.length > COPY_LIMITS.glossaryTerm ? [`${t.id}: term ${t.term.length} chars`] : []),
      ...(t.short.length > COPY_LIMITS.glossaryShort ? [`${t.id}: short ${t.short.length} chars`] : []),
    ]);
    expect(over).toEqual([]);
  });

  it('sells nothing and leaks no implementation', () => {
    const violations = GLOSSARY.flatMap((t) => {
      const copy = `${t.term}\n${t.short}\n${t.long}`;
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      return hits.length ? [`${t.id}: ${hits.join(', ')}`] : [];
    });
    expect(violations).toEqual([]);
  });

  // Voice rule 1. CONTEXT.md says "A User with Role MEMBER"; the mirror has to
  // be talking to somebody, so at least one of the two copy fields addresses
  // the reader or names a person plainly.
  it('addresses the reader rather than describing a record', () => {
    const impersonal = GLOSSARY.filter((t) => {
      const copy = `${t.short} ${t.long}`.toLowerCase();
      return !/\b(you|your|yours|anyone|somebody|nobody|each player|a member|a commissioner|players|members)\b/.test(copy);
    }).map((t) => t.id);
    expect(impersonal).toEqual([]);
  });
});
