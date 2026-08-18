# MORNING 2026-08-18 (help system) — T0 merged, T1 is next

This file continues `MORNING-2026-08-18.md` for a different effort and supersedes nothing in it.

That doc remains the entry point for the PLAN-PAYMENT-LEDGER T2 work; this one
covers only `PLAN-HELP-SYSTEM.md`. Read whichever matches what you are doing.

**One PR merged overnight: #472 (T0). Nothing deployed. No Coolify redeploy is
owed by this work.** Everything below is detail.

---

## 1. The headline

Kevin's instruction was "start building" with §6 taken as recommended. So:

- **`PLAN-HELP-SYSTEM.md` §6 is signed.** K1–K13 are adopted **exactly as each
  Recommendation column reads**, recorded as *"K1–K13 taken as recommended,
  Kevin 2026-08-17 'start building'"* in the PR body.
- The board memo's *"build none during the live weeks"* is **overridden** by
  that instruction. The memo stays on file as the dissent.
- **T0 is merged** (`0090af09`, squash of PR #472).

## 2. What T0 actually shipped

The content model, and the guards that keep it honest. **No component reads it
yet** — nothing is on screen, and nothing is in the shipped bundle.

| File | What |
|---|---|
| `docs/help-voice.md` | K8. Ten rules, three worked examples, the length budget. |
| `src/help/types.ts` | `HelpTopic` / `HelpPlacement` / `HelpPage` / `GlossaryTerm` / `HelpScope`. |
| `src/help/registry.ts` | `buildRegistry()` validates, deep-freezes and throws on bad content; `resolveTopic`, `search`, `placementsForPage`, `normalizePath`, `baseTopicId`. |
| `src/help/glossary.ts` | K1. 38 member-voiced mirrors of `CONTEXT.md` + 18 allowlisted with reasons. |
| `src/help/voice.ts` | The mechanically checkable half of the voice guide. |
| `src/help/pages.ts` | Empty by design. |
| `src/help/coverage-allowlist.ts` | All 87 schema leaf paths + all 39 `App.tsx` routes, each `PERMANENT` or ticketed. |
| `tests/help-registry-invariants.test.ts` | Registry mechanism over fixtures + route coverage + voice rules. |
| `tests/help-glossary-invariants.test.ts` | The K1 invariant against `CONTEXT.md`. |
| `tests/help-schema-audit.test.ts` | Every create-input schema walked to leaves, audited **per pool type**. |

**The one decision worth knowing:** there is no `text` override anywhere in the
model. The Spectrum implementation this ports from has one, and 191 of its 213
tooltip call sites use it — its "one source" is decorative. A `HelpTip` here
will take an id and nothing else.

**Why the allowlists are full and that is not the guard being off:** a row must
say `PERMANENT` or name a ticket; a row for something that no longer exists
fails; anything new is in neither list and fails. The content tickets empty
these lists, and that emptying is their "done when".

## 3. Review — what it cost and what it caught

| Reviewer | Rounds | Findings | Rejected |
|---|---|---|---|
| codex | 11 | 11 | 0 |
| qodo | 1 (reported, settled) | 10 | 4 |
| my own read | — | 4 | 0 |

Rounds 1–3 found defects in the code; 5–11 found them in the fixes, twice in a
guard that forbade the very thing it was written to protect. Codex round 4 came
back clean and my own read did not. The three highest-value findings of the
night were:

- **qodo #11 (High)** — `resolveTopic` ignored audience and honoured a
  qualified id regardless of pool type. That is the tooltip's only path, with
  no filter after it, so a member could have been shown commissioner copy.
- **codex R7** — a qualified topic declared `poolTypes: 'all'` would have been
  credited as coverage for six pool types it never resolves for, which is the
  one way an allowlist row could vanish while its option stayed unexplained.
- **my own read** — three `PERMANENT` allowlist rows asserted a control does
  not exist. Three do (`settings.maxEntriesTotal`, `settings.customScoring`,
  `branding.backgroundColor`). A `PERMANENT` row never comes back for review,
  so those would have buried three real options for good.

## 4. Two things I want you to look at

**(a) The codex cap versus §2b — a real rule conflict, your call.**

`CLAUDE.md` §2c caps codex at **10 rounds per artifact, ask before more**. §2b
says any code written to close a **qodo** finding **earns its own codex round**.
Those collide once a PR reaches ten rounds and then gets a qodo report, which is
exactly what happened here — round 11 was mandated by §2b and put me one past
the cap.

I ran round 11 (it found two real defects) and then **stopped**. The final
commit after it is a **three-line copy change to two glossary strings**, checked
clause by clause against the `CONTEXT.md` entries they mirror, no logic. I
merged with that stated plainly in the PR body, which `mmp-qodo-cycle` §5
explicitly permits.

**Question:** when §2b forces a round past the §2c cap, which wins? A one-line
ruling in `CLAUDE.md` §2c would settle it permanently. If you would rather I had
bought round 12, say so and I will run it retroactively against `main`.

**(b) A gap in the K1 guard, found by three separate findings.**

`tests/help-glossary-invariants.test.ts` proves every `CONTEXT.md` term *has* a
mirror and that the mirror points at a real heading. It does **not** prove the
mirror says everything the source says. Three findings across two reviewers were
exactly that:

- Paid status — dropped "(or Super Admin)"
- Pool credit — dropped that staff can grant and revoke one
- Unlimited pass — dropped that staff can end it early

All three are fixed. No mechanical check catches the class, and I do not trust
any I can think of (diffing prose for dropped clauses). It is a reviewer's job
and is now written down as one in the PR body. **Flagging it because the same
gap will apply to every content ticket T9–T13.**

## 5. Deploy state — nothing owed

**No Coolify redeploy is needed for #472.** Nothing imports `src/help/` yet, so
the shipped bundle is byte-identical; the build confirms it. No `functions/`,
no `firestore.rules`, no indexes, no prod data — the whole ticket is
documentation, a frozen data table, and tests.

The first redeploy this feature needs is **after T1**, which is the first thing
that puts a tooltip on screen.

Everything else on the deploy queue is unchanged from `MORNING-2026-08-18.md`.

## 6. What is NOT done

- **T1–T16 are all unstarted.** T0 is the only merged ticket.
- Nothing is on screen. No tooltip, no panel, no `?` shortcut.
- `src/help/pages.ts` is empty and every route is allowlisted.
- No topics exist, so every schema path is allowlisted.

I stopped after T0 rather than starting T1 half-built. T1 is the largest ticket
in the plan — two new components, a context, a `fields.tsx` change that touches
every wizard step, the first content file, a new UI coverage guard and component
tests — and starting it without room to finish would have left a branch that is
harder to pick up than a clean start.

## 7. Runbook — do these in order

Nothing here is urgent and nothing is blocking a live pool.

1. **Read the two questions in §4 and answer (a).** It is the only thing that
   needs you specifically. One line in `CLAUDE.md` §2c.

2. **Confirm T0 looks right to you.** In the main checkout:

   ```bash
   git -C D:/march-melee-pools pull
   ```

   Then read `docs/help-voice.md` end to end — it is the style every piece of
   help copy in the app will be written against, and it is much cheaper to
   change now than after T9–T13 have written to it. Skim
   `src/help/glossary.ts` for anything that reads wrong to you; that copy is
   member-facing and ships as written.

3. **If you want the twelfth codex round**, say so and I will run it against
   `main` and report. Otherwise nothing to do.

4. **Next session picks up T1**, per `PLAN-HELP-SYSTEM.md` §7. Order is fixed:
   **T0 → T1 → T2 strictly**, then T9 (NFL Pick'em content, because this week's
   invites are Pick'em), then T4, T3, T10/T11.

5. **Nothing to deploy.** Do not trigger a Coolify redeploy for this work.

## 8. Worktrees

- `.claude/worktrees/help-t0-registry` — T0 branch, merged; now holds
  `claude/help-morning-doc`. Removable once this doc is merged.
- `.claude/worktrees/help-system-impl-4ebe5f` — the session worktree, untouched
  (no commits).
