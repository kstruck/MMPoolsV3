// The mechanically checkable half of `docs/help-voice.md` (K8).
//
// The guide is the authority; this file is the part a test can enforce. It
// lives beside the content rather than inside one test file because BOTH the
// registry invariants and the glossary invariants check the same rules, and a
// second copy of the list would drift — which is the failure mode this whole
// feature exists to prevent.

/** Voice rule 9: no selling, no minimising the reader's problem. */
export const BANNED_SELLING_WORDS: readonly string[] = [
  'simply',
  'just',
  'easily',
  'powerful',
  'seamless',
  'effortless',
];

/**
 * Voice rule 7: no implementation. The reader does not have a database.
 * CONTEXT.md is where this vocabulary belongs.
 */
export const BANNED_IMPLEMENTATION_WORDS: readonly string[] = [
  'firestore',
  'callable',
  'server-side',
  'subcollection',
  'uid',
  'schema',
  'endpoint',
];

/** The length budget table in `docs/help-voice.md`. */
export const COPY_LIMITS = {
  topicTitle: 40,
  topicShort: 160,
  glossaryTerm: 40,
  glossaryShort: 160,
  pageSummary: 280,
} as const;

/**
 * Words found in `text`, matched whole-word and case-insensitively.
 * Returns every hit so a failure message can name all of them at once.
 */
export function findBannedWords(text: string, banned: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return banned.filter((word) => new RegExp(`\\b${word}\\b`).test(lower));
}
