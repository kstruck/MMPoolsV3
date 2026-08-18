# Help voice — how to write March Melee Pools help copy

Kevin's decision **K8** (`PLAN-HELP-SYSTEM.md` §6, signed 2026-08-17): help
copy is **second person and plain**. This file is the rule set every
`HelpTopic` and `GlossaryTerm` is written against, and the reviewer's
checklist when a help PR is read.

It governs the copy in `src/help/content/**`, `src/help/glossary.ts`, and
`HelpPage.summary`. It does not govern error strings, button labels, or
marketing pages.

---

## The ten rules

1. **Write to the reader as "you".** Never "the user", never "the member",
   never the third person about the person reading. The one exception is
   copy a commissioner reads *about someone else* — then say "each player"
   or "a member", because "you" would be wrong.

2. **Say what the option does, not what it is called.** The label already
   says what it is called. A tooltip that repeats the label has said
   nothing.

3. **`short` answers one question: "what does this do to my pool?"**
   One sentence, 160 characters or fewer, no second thought bolted on with
   a semicolon. If it needs two sentences, the second one belongs in `long`.

4. **`long` answers three, in this order:** what it does, when you would
   change it, and what changes for your members. Short paragraphs, one idea
   each. No heading levels inside a topic.

5. **Name the default, and name it exactly.** "Straight up is the default"
   is help. "Usually straight up" is a guess the reader now has to verify.
   If you do not know the default, read the schema — do not soften it.

6. **No jargon without its meaning attached.** The reader has never read
   `CONTEXT.md`. Either use the plain word ("who has paid" over "Paid
   Status"), or use the term and link it through `terms[]` so the glossary
   card is one tap away.

7. **No implementation.** No collection names, no callable names, no field
   paths, no "server-side", no "written by a Cloud Function". The reader
   does not have a database. `CONTEXT.md` is where that lives.

8. **Money copy says where the money is.** Entry fees and prizes move
   between people, peer to peer — the platform never holds them. Any topic
   touching money says so plainly rather than implying a balance exists.
   Use **Dues Collected** and **Dues Expected**, never "revenue".

9. **Do not promise, warn, or sell.** No "simply", no "just", no "easily",
   no "powerful", no exclamation marks. If an option can lose data or
   cannot be undone, say that in a flat sentence and stop.

10. **Write it once.** If two screens need the same explanation, that is one
    `HelpTopic` placed twice — never a second copy with different wording.
    A sentence explaining what a setting means may exist in exactly one
    place in the codebase.

---

## Three examples

### Good — a setting

> **Lock mode**
>
> `short`: Choose whether each game locks at its own kickoff, or the whole
> week locks at the first kickoff.
>
> `long`: Per game is the default. Each pick stays editable until that
> game kicks off, so you can keep changing a Sunday-night pick all
> afternoon.
>
> Weekly locks every pick in the week at the first kickoff. Pick it when
> you want everyone playing the same slate with the same information.
>
> Members see the deadline on their pick sheet either way, and a locked
> pick cannot be changed by anyone — including you.

Why it passes: second person; names the default exactly (rule 5); says what
changes for members (rule 4); the last clause is a flat statement of a limit,
not a warning (rule 9).

### Bad — the same setting

> **Lock mode**
>
> Powerful lock control! Simply set `settings.lockMode` to `WEEKLY` and the
> system will automatically enforce the lock server-side for all
> participants at the first kickoff of the week.

Why it fails: `settings.lockMode` and "server-side" are implementation
(rule 7); "Powerful" and "Simply" are selling (rule 9); "participants" is
the third person (rule 1); the default is never named (rule 5); and it never
says what a member actually sees (rule 4).

### Good — a glossary term

> **Entry fee**
>
> `short`: What each player pays you to join. You collect it directly —
> the platform never touches it.
>
> `long`: You set the entry fee when you create the pool, and every player
> sees it before they join.
>
> The money moves between you and your players directly, through whatever
> app you both use. March Melee Pools records the amount and tracks who has
> paid, and nothing more — no balance is ever held here.
>
> This is separate from what you pay to run the pool, which is billing.

Why it passes: plain word order, no `CONTEXT.md` phrasing; rule 8 satisfied
in both `short` and `long`; the last line disambiguates a term the reader is
about to confuse without making them look it up.

---

## Length budget

| Field | Limit | Enforced by |
|---|---|---|
| `HelpTopic.title` | 40 chars | `tests/help-registry-invariants.test.ts` |
| `HelpTopic.short` | 160 chars | same |
| `GlossaryTerm.term` | 40 chars | `tests/help-glossary-invariants.test.ts` |
| `GlossaryTerm.short` | 160 chars | same |
| `HelpPage.summary` | 280 chars | `tests/help-registry-invariants.test.ts` |
| `long` | none | reviewer |

The banned-word list in rule 9 (`simply`, `just`, `easily`, `powerful`) and
the implementation words in rule 7 (`Firestore`, `callable`, `server-side`,
`uid`, `subcollection`) live in `src/help/voice.ts` and are checked
mechanically by **two** tests, each over the copy it owns:
`tests/help-registry-invariants.test.ts` for topic and page copy, and
`tests/help-glossary-invariants.test.ts` for glossary copy. Everything else on
this page is a reviewer's job.

---

## When the behaviour changes

A PR that changes what a setting *does* must change its `HelpTopic` in the
same PR. This is the drift failure mode the whole registry exists to
prevent, and no test can catch it — a topic whose copy is merely stale still
type-checks. The pull-request template carries the checklist line (T14).
