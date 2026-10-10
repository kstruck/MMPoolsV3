# MORNING — 2026-08-25, launch day: multi-entry is live

**Six PRs merged (#587–#592). Functions deployed from <!-- deploy-state:ignore --> `main` @ `809384d4` and
verified by name; the frontend rebuilt and verified by chunk content. The rules
deploy and the pool-password sweep are still owed.**

The mission was: make multi-entry playable end to end, flip it on, and merge the
Standings/Results tabs. Four of the five build tickets were built; the fifth
(T10) turned out to be already shipped. One extra ticket (T6a) was promoted into
scope because an external reviewer showed the flip would otherwise ship an
unusable feature.

---

## 1. What shipped

| PR | Ticket | What | Codex rounds |
|---|---|---|---|
| [#587](https://github.com/kstruck/MMPoolsV3/pull/587) | **T3** | scoring, reveal, finalize and profiles key by **entry id** | 2 |
| [#588](https://github.com/kstruck/MMPoolsV3/pull/588) | **T4** | `buildMemberStandings` renders one row per **entry**; plural own-entries subscription | 4 |
| [#589](https://github.com/kstruck/MMPoolsV3/pull/589) | **T5** | the "My Entries" switcher; all three pick sheets send `entryIndex` + `entryName` | 7 |
| [#590](https://github.com/kstruck/MMPoolsV3/pull/590) | **T6a** | every NFL row surface displays `entryName ?? userName` | 1 |
| [#591](https://github.com/kstruck/MMPoolsV3/pull/591) | **FLIP** | `MULTI_ENTRY_WIZARD_ENABLED = true`, on all three NFL types | 2 |

Every PR: all **9 checks green before merge**, verified explicitly. The main
ruleset's bypass means GitHub would not have stopped a red merge, so the check
was the enforcement rather than the ruleset (HANDOFF's 2026-08-25 governance
box).

### The shape of the change, in one paragraph

An NFL entry's identity used to BE the owner's uid — `entries/{uid}` — and every
consumer keyed on that. Multi-entry is not "add a field": it is changing the
identity of a row from a person to an entry, everywhere, while keeping every
existing pool byte-for-byte unchanged. That is possible because **entry #1's id
IS the uid** (D1), so each re-key returns the same string it returned before on a
single-entry pool. Extra entries are `e{n}:{uid}`. **Nothing migrates.**

---

## 2. What a member can now do

A commissioner ticks **"Allow more than one entry per player"** in the create
wizard (or raises the cap later from the manager settings) and sets a number up
to 10. Then, in the pool's Picks tab, a member sees a **My Entries** strip:

- one tab per entry they hold, plus **+ Add entry** while under the cap;
- naming a new entry, with the server enforcing uniqueness per owner;
- each entry is an **independent contestant** — its own picks, its own row, its
  own score, its own Survivor life, strikes and used-teams, its own
  season-history record, its own rank;
- dues are `entryFee × entries`, and a **PAID** member who adds an entry flips
  back to UNPAID with a `MARKED_UNPAID` ledger line saying why (K11, shipped in
  T2 back on 2026-08-17).

**An entry is created by its first submit, not by the strip.** There is no
"create entry" callable by design — `submitNFLPicks` derives the document id
from `entryIndex` — so "+ Add entry" opens a draft that exists only in the
browser, and the copy says outright that the entry does not exist, costs nothing
and is invisible to others until a pick is saved.

---

## 3. Deploy state, and what is still owed

✅ **Functions** — deployed from <!-- deploy-state:ignore --> `main` @ `809384d4`, verified by name (§4).
⚠️ **HISTORICAL as of 2026-08-26** — superseded by #597's deploy; the live
claim is `e6882d21` in HANDOFF's top box. Tagged `ignore` so this record does
not contradict it.

✅ **Frontend** — Coolify rebuilt 2026-08-25, bundle
`index-BRP5Lf-B.js` → **`index-CtqdBjX0.js`**, and **verified by CONTENT rather
than by the hash.** That distinction earned its keep immediately: this app
code-splits, so none of the multi-entry copy is in `index-*.js` at all. A
first-pass check against the entry chunk reported the wizard toggle "MISSING",
which would have been read as a failed build. Fetching all 109 referenced chunks
found every string:

| String | Chunk |
|---|---|
| `Allow more than one entry per player` | `buildNFLPayload-DbSxJbA6.js` |
| `Entry 1 is created when you save its first pick` | `PoolRoute-DJtanu6e.js` |
| `You already have an entry with that name` | `PoolRoute-DJtanu6e.js` |

**The lesson for the next rebuild:** a changed index hash proves a build ran, not
what it built, and the entry chunk is not where feature code lives. Check the
chunk that owns the string.

🛑 **STILL OWED, AND THEY ARE YOURS:**

1. **`npx firebase deploy --only firestore:rules`** — owed from #579, untouched
   by this session. Deliberately not run here: this session was scoped away from
   `firestore.rules`, and a rules deploy is its own decision.
2. **The pool-password migration sweep** — its precondition (the Coolify
   rebuild) is now satisfied.
3. **A SECOND Coolify rebuild after #529 merges.** `POOLS_OPEN` is a frontend
   flag; the rebuild above ran BEFORE that merge and does not carry it.

---

## 4. Deploy: done and verified

`git pull --ff-only origin main` → `npm --prefix functions ci` →
`npx firebase deploy --only functions`, from `D:\march-melee-pools` (CLAUDE.md
§3's ritual, step zero included — the checkout was at `efa30cd1` and had to be
pulled to `809384d4` first; deploying without it would have shipped nothing and
still said `Deploy complete!`).

**Verified by NAME, not by `Deploy complete!`** — the tell for a stale deploy is
an *absence*, which is easy to miss:

```
setPoolPassword  verifyPoolAccess  migratePoolPasswords  cspReport
authBackupJob    runAuthBackup     ← the six the 2026-08-25 audit box owed
scoreNFLWeek     getPoolPicks      submitNFLPicks
getProfilePoolDetail  recomputeMyProfile
nflAutoScoreJob  nflFinalizeSweepJob
```

**13 of 13 PRESENT.** This deploy therefore closes **step 1 of the audit box**
as well as this session's own changes — one deploy covered both, as planned.

🔴 **It went into a LIVE scorer.** `system/config.nflAutoScore` is
`{enabled: true, dryRun: false}` and `nflAutoScoreJob` runs `*/5`. #587 changed
`scoreNFLWeek`, `getPoolPicks`, `maybeFinalizeNFLPool` and the profile recompute
— all on paths that job executes. The safety argument is the id equality above
plus the full emulator suite (**524 passed / 2 expected fail / 10 skipped**) run
against the merged tree.

---

## 5. Findings absorbed — 16 across 5 PRs, 15 fixed, 1 rejected for scope

The cross-model gate earned its keep decisively this session. **Round 1 found
defects in the code; rounds 2+ found defects in the fixes** — exactly the pattern
CLAUDE.md §2c predicts.

### The three that would have corrupted data

1. **T5 r1 [P1] — the Pick'em draft key.** `pickem:{pool}:{week}` carried no
   entry. A local draft is restored INTO the sheet and then submitted under
   whatever `entryIndex` is active, so unsaved picks made on entry #1 were
   restored into entry #2's empty sheet and **saved there**. One entry's picks
   written onto another, arriving through localStorage.
2. **T5 r6 [P1] — the pre-snapshot fallback.** Before `subscribeToMyNFLEntries`
   delivered its first snapshot, `myEntry` fell back to the first *folded* row
   owned by the viewer. Those rows carry no `entryIndex` and the fold is ordered
   by the standings cascade — so on a two-entry member that row can be entry #2
   while `activeEntryIndex` is still 1. The sheet would **display entry #2's
   picks and submit them as entry #1.**
3. **T5 r3 [P2] — the stranded primary.** A member whom a commissioner
   proxy-created only an entry #2 for could create #3 and #4 but never their own
   #1, because the "next addable index" helper never returns 1. Entry #1 is now
   a real, selectable slot.

### The rest

| PR | Round | Finding | Verdict |
|---|---|---|---|
| T3 | r1/r2 | the client still folds by uid, so entry #2 gets no row | **carried by design** — that is T4, the very next PR; `MULTI_ENTRY_WIZARD_ENABLED` was `false`, so the affected set was empty in production |
| T4 | r1/r4 | the grids render only `userName`, so two entries are indistinguishable rows | **CORRECT → promoted to T6a (#590), shipped before the flip** |
| T4 | r2 | `where('ownerUid','==',uid)` cannot match an unstamped legacy `entries/{uid}` | fixed — probed only when entry #1 is missing from the result, so the common path pays no extra read |
| T4 | r3 | that probe fired only on an EMPTY query, so an unstamped #1 joined by a stamped #2 still vanished | fixed |
| T4 | r3 | unsubscribing did not invalidate an in-flight probe | fixed — the disposer bumps a sequence token |
| T5 | r1 | "Add entry" offered index 1 and invited a name the first save discards | fixed |
| T5 | r1 | the bento's rank found the first row owned by the viewer, not the active entry | fixed |
| T5 | r2 | the draft was never cleared once its submit created the entry | fixed — derived as over, not cleared in an effect |
| T5 | r3 | `''` and `'   '` as an entry name meant different things | fixed — both take the generated default |
| T5 | r4 | "Add entry" from nothing could manufacture an owner of #2 with no #1 | fixed |
| T5 | r4 | while drafting, the bento showed entry #1's record beside a CTA opening entry #2 | fixed — `pendingEntryLabel` |
| T5 | r5 | a supplied `activeEntryId` matching nothing fell back to the first row | fixed |
| T5 | r7 | *"the flag is still false — flip it"* | **REJECTED for scope** — that IS the next PR, and the plan's own rule is that the flip is gated on T3+T4+T5+T6a being merged |

**Found by self-review, not by codex:** the "saved just now" receipt in all
three pick sheets reset on `week` only, so switching entries carried it across
and told a member their brand-new entry was already saved.

⚠️ **Deviation from the mission's instructions, stated:**
`codex exec review -m gpt-5.3-codex` is refused by this account —
*"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT
account"*. Every round ran on the CLI default, `gpt-5.6-terra`. The
`codex login --with-api-key` step was also unnecessary and not run: the CLI is
already authenticated in ChatGPT mode and there is no `OPENAI_API_KEY` in this
environment. One round hit a usage limit mid-run and was re-run after the reset.

---

## 6. T10 was already done — verified, not assumed

The mission listed T10 (merge Standings + Results into one scoped tab) as work.
It shipped as **[#536](https://github.com/kstruck/MMPoolsV3/pull/536) on
2026-08-23**. Checked against the spec rather than taken on trust:

- `src/utils/nflStandingsScope.ts` exists and `resolveStandingsAlias` maps
  `results` → `{tab: 'standings', scope: 'week'}`;
- `NFLPoolDashboard.tsx:787` filters `results` out of `offeredTabs` while
  `VALID_TABS` still contains it, so shared links land on the week segment
  instead of falling back to the dashboard;
- `tests/nfl-standings-scope.test.ts` (17 cases) is green, and the help registry
  merged `pool.nfl.results` into `pool.nfl.standings`.

`PLAN-WIZARD-BUYFLOW-FIXES.md`, which the mission cited for the spec, only ever
existed on an unmerged branch (`claude/plan-t8`) — which is why it is not in the
tree. Its T10 section is recoverable with
`git show e50115f4:PLAN-WIZARD-BUYFLOW-FIXES.md`.

---

## 7. Still open, named rather than dropped

- **T6 remainder** — `RecordPayoutsCard` keys its rows by uid and submits a uid,
  so a commissioner recording a payout in a multi-entry pool cannot say WHICH
  entry won. Season-end machinery; not on the flip's critical path. The
  `poolRoster.ts` `uidOf` → `idOf` rename is the other half.
- **T7** — extend the "no reveal rule of its own" guard to `NFLWeeklyPicksGrid`.
- **T8** — reminders: "missing picks" = ANY entry missing, one email per member.
  The existing multi-entry case in `manualReminderTargets.test.ts` is green, so
  this is a widening rather than a break.
- **T9** — fixtures: the additive `entryName` selector plus one multi-entry
  scenario per NFL type (matrix ≥ 48).
- **T10 (docs)** — the ADR for the identity scheme
  (`docs/adr/0007-nfl-entry-identity.md`) is not written. CONTEXT.md's §Entry and
  §Member Record glossary entries are also still pre-multi-entry.
- **T11** — ✅ **DONE.** The sweeps re-run is in
  `PLAN-MULTI-ENTRY-SWEEPS.md` §Re-verification: zero uid-as-identity sites on
  the NFL scoring path, zero `ownerUid` in a sort comparator, and every
  remaining grep hit classified with the reason it is correct.

Both open T6 items still carry their `tests/nfl-surface-invariants.test.ts`
allow-list entries, and that suite **fails if an entry names residue that is
already gone** — so the guard keeps naming them until they land, and cannot rot
into a lie.

---

## 8. Turning it off

One line, and it is safe:

```ts
// shared/multiEntry.ts
export const MULTI_ENTRY_WIZARD_ENABLED = false;
```

It hides the **offer** (the wizard field and the manager raise control) without
stranding a pool that already took it — the manager control still renders when
`currentMaxEntries > 1`, and the server keeps honouring entries that already
exist. It needs a Coolify rebuild to take effect, like any frontend change.

Below the flag there are three further gates that need no action at all: no pool
carries `maxEntriesPerUser` (which reads as 1), `updatePoolSettings` is
raise-only and only while the pool accepts entries, and the server refuses
`entryIndex: 2` with `ENTRY_INDEX_EXCEEDS_MAX` on a max-1 pool.
