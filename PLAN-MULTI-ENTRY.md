# PLAN — multiple entries per player (NFL Pick'em / Survivor / Margin)

> **STATUS: PLAN ONLY, AWAITING KEVIN'S SIGN-OFF ON §6. No code has been written.**
> This is a **MONEY + SCORING** change (`mmp-change-control` Rule 3): dues become
> a multiple of the entry fee, and every scoring, standings, reveal and finalize
> path re-keys from a uid to an entry. Plan → adversarial review log
> (`PLAN-MULTI-ENTRY-REVIEW-LOG.md`) → sweeps (`PLAN-MULTI-ENTRY-SWEEPS.md`) →
> Kevin's sign-off → code.
>
> **Provenance:** overnight brief 2026-08-14/15, item 3 — *"Multiple entries per
> player. Commissioner sets a max in the setup wizard as a Yes/No toggle plus a
> max number when Yes. Wire it end to end: submit path, standings, scoring,
> Survivor used-teams, Member Records, dues, and every grid built in #430/#432."*
>
> ⚠️ **This plan also governs work that ships BEFORE it** — §0b is the rule every
> Wave 2/3 UI PR from the same brief must follow so they do not need redoing.
>
> Written overnight without Kevin in the room. Every question the grill would
> have asked him is in §6 with a recommendation; **nothing in §6 has been
> answered.** Codex Act 2 rounds are in the review log.

---

## 0. What Kevin asked for, and what that means precisely

One player, N playable entries in one NFL pool, each with its own picks, its
own row, its own score, its own Survivor life, its own dues. The commissioner
turns it on per pool and sets N.

### 0a. 🛑 The single most important line in this document

**Today an NFL entry's identity IS the uid — `entries/{uid}` — and every
consumer in the stack keys on that.** `functions/src/nflPools.ts:473`
(`poolRef.collection('entries').doc(uid)`) is the load-bearing line; six
places downstream silently OVERWRITE if two entries ever share a uid (sweeps
S1). Multi-entry is therefore not "add a field": it is **changing the identity
of a row from `uid` to `entryId`** everywhere, while keeping every existing
pool byte-for-byte unchanged.

The design in §4 does that with **zero migration**: the first entry keeps
`entryId === uid`, extra entries get `entryId = e${n}:${uid}` (index PREFIX,
`:` separator — a uid can contain `_`, and sim/test uids do, e.g. `mr_boss`,
so a `${uid}_${n}` suffix collides: user `a` entry 2 vs user `a_2` entry 1;
codex r2). Readers never parse the id — every entry doc carries `ownerUid` and
`entryIndex` fields. **And the id is a convenience, not an invariant:** the
create transaction reads the target doc first and, if it exists with a
different `ownerUid` (a uid that literally is `e2:alice` — impossible for a
Firebase Auth uid, not impossible for a hand-made one), falls back to an
auto-generated id for that entry (codex r4). Nothing downstream cares, because
nothing parses ids. Every existing pool, fixture, reveal and standings doc is
already in the new shape.

### 0b. 🛑 The rule for Wave 2/3 UI work shipping BEFORE this plan

Every new or touched surface that renders "one row per player" must be written
as **one row per ENTRY**, today, even though every pool still has one entry
per player. Concretely:

1. **Row key and reveal lookup = `row.id`** (the entry id), never
   `row.ownerUid`. `getPoolPicks` maps (`picks`, `counts`, `confidence`,
   `tiebreakers`) will be keyed by entry id (T3); today entry id === uid, so
   `reveal.picks[row.id]` returns exactly what `reveal.picks[row.ownerUid]`
   does. Write the former.
2. **`ownerUid` is for two things only**: the profile link, and "is this me"
   highlighting (`row.ownerUid === viewerUid` — which correctly lights up ALL of
   the viewer's entries).
3. **Never `entries.find(e => e.ownerUid === user.id)`** in new code — that is
   the singular `myEntry` assumption. Use `.filter(...)`; where a single entry
   is genuinely needed (the CTA), take the *active* one (T5) and say so.
4. **Display name = `row.entryName ?? row.userName`.** `entryName` is already
   in the standings projection allowlist (`nflScoringEngine.ts:833-839`) and
   already on the entry types (`nflPoolTypes.ts:207-231`); it is unused by NFL
   today.
5. **Sort/aggregate per row, not per uid** — a week-score sort (item 12) or a
   week-score column (item 11) reads `row.weeklyPoints[week]`, per row.
6. **The rule is a TEST, not prose** (codex r1/r2). Ticket **T0** — ordinary,
   no plan gate (no money, authorization, production data or scoring): flip
   the three existing reveal lookups in sweeps S1c (`NFLPicksGrid.tsx:117`,
   `NFLWeeklyPicksGrid.tsx:73`, `NFLStandings.tsx:305-306`) from
   `ownerUid ?? id` to `row.id`, and add a source invariant to
   `tests/nfl-surface-invariants.test.ts` over `src/components/NFLPoolDashboard/**`
   AND `src/utils/memberStandings.ts`, `src/utils/poolRoster.ts`,
   `src/components/PaymentsPanel.tsx` that forbids, outside an explicit
   allow-list of files this plan's T4/T5 will rewrite: `ownerUid ?? ` /
   `ownerUid || ` used as an index key; `const uidOf`; `reveal.picks[`,
   `.counts[`, `.confidence[`, `.tiebreakers[`, `pickCounts[` indexed by
   anything named `ownerUid`/`uid`; and `entries.find(` whose predicate names
   `ownerUid`. Behaviour-preserving today (id === uid); it ships FIRST so every
   later Wave 2/3 PR fails CI if it re-derives the uid key. It is a regex
   guard, not an AST one — and the allow-list is **per symbol, not per file**
   (codex r4): `myEntry` in `NFLPoolDashboard.tsx` / `NFLUserBentoDashboard.tsx`
   / `PaymentsPanel.tsx`, and `uidOf` + `scoredByUid` in `memberStandings.ts`,
   each named in the test with the ticket (T4/T5) that removes it; the file
   otherwise remains under the rule. Alias dataflow (`const key = row.ownerUid`)
   is out of a regex's reach; the compensating check is a **behaviour test on
   `buildMemberStandings`** — two rows sharing an `ownerUid` — that is added
   red-then-green with T4, and until then is the honest gap the morning doc
   names.

Any Wave 2/3 PR that violates 1–6 will be reworked when this ships. The
morning doc names this as the ordering risk the brief called out.

---

## 1. What is true today — measured, not remembered

Full file:line inventory in the sweeps doc. The load-bearing facts:

| Area | Today | Multi-entry breaks it because |
|---|---|---|
| **Entry doc** | `pools/{id}/entries/{uid}` (`nflPools.ts:473`, `:832` rebuy, `poolExceptions.ts:456` proxyPick); `simHarness.ts:160-198` **forces** `docId === ownerUid` and calls it a "rank write-back invariant" | second entry has nowhere to live |
| **Submit** | `submitNFLPicksSchema` (`schemas/poolCore.ts:28-40`, `strictObject`) has **no entry selector**; identity is `ctx.subjectUid` (`:369`); resubmit guard `lastRequestId` per entry doc (`:493-495`) | cannot say which entry |
| **Member Record** | one per uid per pool (`shared/memberRecord.ts:4`), `feeOwed` (single number), `hasPlayableEntry` (one-way boolean latch), `pickedWeeks` (one set) — `lib/memberRecord.ts:52-147` | dues and "has picked" are per entry |
| **Scoring** | `scoreNFLWeek` iterates entry docs (`:1191`, `:1278`) — already per doc ✅ — but winner/sharp candidates keyed `entry.ownerUid` (`:1319,:1327,:1351,:1492-1506`) and **Margin rank write-back goes to `entries/{r.ownerUid}`** (`:1518-1531`) | second Margin entry's rank lands on the first |
| **Standings projection** | `buildStandingsRows` (`nflScoringEngine.ts:828-871`) one row per entry doc ✅, carries `id`, `ownerUid`, `entryName?` ✅ | fine — this is why the client rule 0b.4 costs nothing |
| **Client fold** | `buildMemberStandings` (`utils/memberStandings.ts:80-236`): `scoredByUid` Map (`:86-90`) and a `seen` Set (`:93,110-114`) that **drops any second row with the same uid** | the hardest client blocker |
| **Reveal** | `getPoolPicks` five maps `Record<uid, …>` keyed `entry.ownerUid \|\| doc.id` (`nflPickReveal.ts:292`) | second entry overwrites the first |
| **Finalize** | `users/{ownerUid}/seasonHistory/{poolId}` (`nflFinalize.ts:304-323`) | doc id collides |
| **Paid mirror** | `setPaidStatus` mirrors onto `entries/{memberUid}` (`:200-204`) | mirrors onto entry 1 only |
| **Reminders** | dedupe by uid, comment "Entry doc id == owner uid" (`lib/reminderTargets.ts:139-152`); the ONLY existing multi-entry-aware test (`manualReminderTargets.test.ts:91`) | mostly fine; "missing picks" must mean "any entry missing" |
| **Grids / tables** | `NFLPicksGrid.tsx:117,177`, `NFLWeeklyPicksGrid.tsx:73,118`, `NFLStandings.tsx:236,268`, `NFLResults.tsx:101-117,218`: `key={row.id}` ✅ but `uidOf = row.ownerUid ?? row.id` for reveal lookup ❌ | 0b.1 |
| **My Entry** | `myEntry = ownEntry \|\| entries.find(e => e.ownerUid === user.id)` (`NFLPoolDashboard.tsx:485-490`), `ownEntry` singular (`:185`, `subscribeToMyNFLEntry`), CTA `weekPicksComplete` (`NFLUserBentoDashboard.tsx:287-293`) | one tab, one entry |
| **Wizard/schema** | no `maxEntries*` on any NFL schema (`shared/schemas/nfl.ts`); the schemas are `z.object` and **silently strip** unknown keys (`:42-46`); Bracket/Playoff already have `maxEntriesPerUser` (`functions/src/types.ts:471,587`) | the setting must be added to the shared contract or the wizard's value is dropped |
| **Rules** | `entries/{entryId}` read is `resource.data.ownerUid == uid` (`firestore.rules:456-484`) ✅ — **no rule asserts `entryId == uid`**; `members/{memberUid}` IS uid-keyed ✅ (stays) | rules need **no change** for entries |
| **Precedent** | Bracket: auto-id entries + `maxEntriesPerUser` count-in-transaction (`bracketEntries.ts:63-108`), client `activeEntryId` switcher (`BracketPoolDashboard.tsx:82,484,519-592`); Playoff: composite `${uid}_${Date.now()}` (`playoffPools.ts:179`) | reuse the switcher pattern and the setting name |
| **CONTEXT.md** | §Entry (:122): *"some types allow more than one Entry per Member (Bracket, Playoff)"*; §Member Record (:120): one per Member per Pool, *"does not vary in cardinality"* | glossary already permits it; NFL joins the list |

---

## 2. Goal

A commissioner switches "Allow multiple entries per player" on and sets a max
(2–10) in the wizard or, while the pool is still accepting entries, in
settings. A member then holds up to that many entries; each is a separate row
everywhere a row exists (My Entry, Current Picks, Standings, Results, Recaps'
weekly winner, Payments), is scored separately, lives or dies separately in
Survivor, and owes the entry fee separately. Pools that never turn it on are
unchanged, byte for byte.

---

## 3. Key decisions and tradeoffs

### D1 — Entry identity: `entryId`, where entry #1 keeps `entryId === uid`

Extra entries are `e${n}:${uid}` for `n` in `2..max`, deterministic (prefix
form — see §0a for why not a `_` suffix). Chosen over Bracket's auto-ids
because:

- **zero migration** — every existing NFL entry, standings row, reveal map,
  fixture and seasonHistory doc is already in the new shape;
- the client never has to "create" an entry before submitting — the callable
  takes `entryIndex` (default 1) and derives the id, so the resubmit guard,
  proxyPick and rebuy all address an entry with `{uid, entryIndex}`;
- the id is not forgeable: the server builds it from `ctx.subjectUid`, the
  client only sends a small integer.

Rejected: auto-id (Bracket) — needs a create step, a migration of
`entries/{uid}` to carry an explicit id, and a fixture rewrite; composite with
timestamp (Playoff) — the 1 MB doc-bomb debt in `mmp-debugging-playbook`.

### D2 — 🛑 Money: dues are per entry, Paid Status stays per Member

`feeOwed` on the ONE Member Record becomes **`entryFee × max(joinLiability,
playableEntryCount)`**, where `joinLiability` is what today's contract already
stamps: **1** for an ordinary member (charged at join, `feeOwedSource: 'LIVE'`,
never inferred from entry existence — `shared/memberRecord.ts:25-30`) and **0**
for the seeded commissioner until their first playable entry (codex r3 — the
first draft's bare `fee × count` would have made a joined-but-unpicked member
owe $0, silently changing the join contract). Additional-entry liability
begins when that entry's first pick commits — **and when it does, the Member
Record's `paidStatus` (and every entry mirror) is reset to `UNPAID` in the same
transaction if it was `PAID`** (codex r4: a member paid at $25 who adds a
second entry now owes $50, and `memberDues()` would otherwise report $50
collected). A `MARKED_UNPAID` ledger event with the new `feeOwed` is appended
so the commissioner sees why. K11 puts this to Kevin. The Member
Record gains `playableEntryCount` (int) and `entries: Record<entryId, {name}>`
(existence + display name — **no picks, no per-entry weeks**); `hasPlayableEntry`
stays as `count > 0` so every existing reader is unchanged. `pickedWeeks` stays
**per member** (the union) — a per-entry map on a participant-readable record
would tell the pool which specific entry has a pick for an unrevealed week,
which is the pre-reveal completeness CONTEXT.md §Pick Reveal reserves for the
commissioner (codex r1). Per-entry completeness travels only in
`getPoolPicks.counts`, which is already reveal-gated. `paidStatus` remains one
flag per member (paid in full or not) — partial payment is the payment-ledger
plan's problem, not this one's; until then a member with 3 entries is UNPAID
until all 3 are paid.

Three money paths this multiplies, all in T2 (codex r1):
- the **entry-fee edit cascade** (`poolOps.ts:541-558`) stamps
  `newFee × playableEntryCount` per liable record, not `newFee`;
- `setPaidStatus`'s **`MARKED_PAID` ledger amount** becomes the record's
  `feeOwed` (the multiplied figure), not `settings.entryFee`;
- `setPaidStatus`'s **entry mirror** (`:200-204`) writes `paidStatus` onto
  EVERY entry the member owns (`where('ownerUid','==',uid)` inside the same
  transaction) — retiring it is the ledger plan's call, not this one's.

`planMembershipWrite`'s one-way latch becomes a one-way **counter**, derived
transactionally from **entry existence** (count the owner's entry docs in the
transaction, never trust a stored counter under retries) with a legacy default
of `playableEntryCount = hasPlayableEntry ? 1 : 0` when the field is absent;
the count never decreases (deleting an entry is out of scope — K7). The seeded
commissioner's `feeOwed: 0` rule is unchanged: 0 until their first playable
entry, then `fee × count`. ⚠️ `PLAN-EMPTY-SUBMISSION-FEE.md`'s open bug
(`hasPlayableEntry: true` passed unconditionally at `nflPools.ts:750`) is
**inherited and multiplied** — under multi-entry an empty submit on entry #3
would charge a third fee. Its one-line fix (`committedPickForWeek`) is folded
into T2 as a precondition, and the PR says so.

### D3 — Survivor: each entry is its own life

`usedTeams`, `strikes`, `eliminatedWeek`, rebuys — all already on the entry doc.
Two entries of one player may pick the same team the same week (they are
independent contestants); the reuse guard is per entry doc, so this falls out.
Rebuy (`executeSurvivorRebuyInternal`, `:832`) takes `entryIndex`; `rebuyOwed`
on the Member Record becomes the sum across entries — and `setPaidStatus`'s
legacy fallback that derives missing `rebuyOwed` from `entries/{uid}` reads ALL
the owner's entries (codex r2).

### D4 — Scoring: iterate entry docs (already), key candidates by `entryId`

`scoreNFLWeek` already loops docs. Change: `winnerCandidates`, `sharpUser`,
`closestTie` keyed by `doc.id`; **every per-entry ordering breaks its final tie
on `entry.id`, not `ownerUid`** — `sortMarginLeaderboard` ties on `ownerUid`
today, so two entries of one owner would compare equal and take Firestore
iteration order for distinct ranks (codex r2); **Margin rank write-back to
`doc(r.id)`**, and
`simHarness.ts:161`'s invariant is rewritten from "docId === ownerUid" to
"docId is the entry id, which for entry #1 is the uid". `WeeklyWinner` gains
`entryId` and `entryName` (additive on the recap; `userId` stays as the payee).
A player with two entries can take 1st and 2nd in a week (K8) — the recap lists
both rows.

### D5 — Reveal: `getPoolPicks` maps keyed by entry id, plus an owners map

`picks/counts/confidence/tiebreakers` become `Record<entryId, …>`; response
gains `entries: Record<entryId, { ownerUid, entryName? }>` (additive) — **gated
exactly like `counts`**: always for the commissioner/SUPER_ADMIN, for a
participant only once `weekRevealed`, so nobody enumerates another member's
entries before the reveal (codex r1). The client already has entry existence
and names from the Member Record `entries` map (D2), so nothing renders blank
pre-reveal. Departed-member filter and the participant `counts` gate operate on
`ownerUid`. The
reveal BOUNDARY (`weekRevealFor`) is untouched — this plan changes what a key
means, never when a value appears. The `nfl-surface-invariants` guard on the
grid (no `startTime <`, `lockBufferMinutes`, `serverNow`) is extended to
`NFLWeeklyPicksGrid.tsx` (it covers only `NFLPicksGrid.tsx` today).

### D6 — Client: `buildMemberStandings` folds per entry; a pick-less member still gets one row

`scoredByUid`/`seen` become entry-keyed. The "one row per proven Member Record"
pass (`memberStandings.ts:137-167`) becomes: for each member, one row per
entry id in the Member Record's `entries` map (D2 — the authorization-safe
roster of entries, readable by participants and carrying no picks), grafted
with the scored projection row when one exists; a member with an empty map gets
one placeholder row with `id = uid` (exactly today's shape). **A legacy Member
Record has no `entries` map**: the first submit that touches an owner under
multi-entry (entry 1 resubmit OR entry 2 create) rebuilds the owner's complete
map from their existing entry docs before applying the change, in the same
transaction, so entry 1 is never absent from other members' pre-score rows
(codex r4; T2 tests enable-on-legacy then entry 2 before any scoring). This is how a
newly-created, unscored second entry of ANOTHER member gets its row (codex
r1). `ownEntry` becomes
`ownEntries[]` (`subscribeToMyNFLEntries`: `where('ownerUid','==',uid)` — the
rules read is already `ownerUid`-based, so no rules change).

### D7 — My Entry: an entry switcher, Bracket's `activeEntryId` pattern

Tabs "Entry 1 / Kevin #2 / + Add entry" above the existing pick-entry
component; `PickemPickEntry`/`SurvivorPickEntry`/`MarginPickEntry` receive the
active entry and pass `entryIndex` to `submitNFLPicks`. The pool-home CTA (item
8) derives from the ACTIVE entry and reads "Make Picks (Entry 2)" when the
active one is empty. `entryName` is settable on the My Entry tab, defaulting to
`"${userName} #n"` (K5), unique per member (Bracket precedent) — via an
optional `entryName` on `submitNFLPicks` (≤ 30 chars, trimmed, uniqueness
enforced in the same transaction against the Member Record `entries` map;
raw entry writes stay denied). No separate rename callable (codex r1).

### D8 — Setting: `settings.maxEntriesPerUser`, callable-only after create

Reuse the Bracket/Playoff name. `shared/schemas/nfl.ts`: `maxEntriesPerUser:
z.number().int().min(1).max(10).default(1)` on all three NFL create schemas
(z.object strips unknown keys, so this is where it must be declared).
`firestore.rules` `callableOnlySettingsUnchanged()` gains it (a client cannot
lower it under a member who already holds 3); `updatePoolSettings` enforces
**raise-only, and only while the pool accepts entries** (same predicate as
join). Wizard: a Yes/No toggle on the rules step; the number field appears on
Yes. `nfl-settings-lockdown.test.ts` gains the key. Client settings interfaces
(`src/types/nflPoolTypes.ts` ×3), the create payload builder and the wizard
prefill all carry `maxEntriesPerUser?: number` with a `?? 1` default for every
existing pool doc (codex r1).

**Two counts, named (codex r1).** *Members* (`participantIds`) is what billing
tiers, `BillingGate`, `poolSport.ts` and the global dashboard count — the
player cap — and stays so. *Entries* is what the pot, prizes and hybrid split
multiply (K10). NFL pools gain a server-maintained **`entryCount`** on the pool
doc (already in `PRIVILEGED_POOL_FIELDS`, already Bracket's shape), incremented
in the submit transaction on first creation — **and, when the field is ABSENT
on an existing pool, derived in that same transaction from a count of the
existing entry docs before the increment** (codex r2: legacy pools have no
`entryCount`, and a from-zero increment would make the pot denominator 1) —
and `PayoutsPanel`/`NFLPoolRules` read it for the gross pot instead of
counting rows. **`entryCount` counts LIABLE entries, not entry docs** — it is incremented
when an ordinary member joins (their `joinLiability` of 1), when the seeded
commissioner's first entry commits a pick, and on each additional entry's
first committed pick; so a two-member no-pick pool shows a $50 pot and $50
expected dues, never $0 vs $50 (codex r4). **`updatePoolSettings`, when it
first sets or raises `maxEntriesPerUser` on a pool with no `entryCount`,
initialises it from the Member Records' liabilities in that same
transaction** (codex r3 — otherwise the pot
is unknown until somebody submits again). T2 tests enabling multi-entry on a
populated legacy pool with no follow-up submit.

### D9 — Finalize + profile: one seasonHistory doc per entry

`users/{uid}/seasonHistory/{poolId}` for entry #1 (unchanged),
`${poolId}__e${n}` for extras (auto-generated pool ids never contain `_`, and
the doc stores `poolId` + `entryId` fields so readers query by field, not by
parsing the id — codex r1 pointed out a bare `_` join can collide with a pool
whose id happens to end in `_2`). **`userProfile.ts:24` (`gatherPoolInput`) reads
`entries.doc(uid)` and `seasonHistory.doc(poolId)` today, and powers BOTH the
public-profile recompute and the `getProfilePoolDetail` callable** — T3
rewrites it to `where('ownerUid','==',uid)` across all owned entries, per
member per pool: the aggregate carries one participation per pool with the fee
charged ONCE (Profit's fee side reads `feeOwed`, already the sum, D2) and
prizes from Payout Records keyed by uid (+ optional `entryId`, already in the
contract at `shared/payoutRecords.ts:19`); `getProfilePoolDetail`'s response
gains an **`entries[]` array** (one weekly-record/history block per entry,
`entryName`, additive — the existing top-level fields become entry #1's for
back-compat) and its test covers two entries + one fee (codex r3).

---

## 4. Risks

| R | Risk | Mitigation |
|---|---|---|
| R1 | Any consumer still keyed by uid silently merges two entries — the failure is invisible, not loud | Sweeps S1 is the complete list of `ownerUid ?? id` / `Record<uid` sites; every one is a ticket line; a new emulator scenario with a two-entry player asserts distinct rows in standings, reveal, recap and seasonHistory |
| R2 | The 45-fixture matrix addresses entries by `userName` (`assertionRunner.ts:123`) | Additive `entryName` selector in assertions; existing fixtures untouched; one new fixture per pool type with a two-entry player |
| R3 | `nfl-surface-invariants` greps source verbatim (`ownEntry` deps, `myEntry`, `setReveal({poolId, uid,…})`) | Each changed line is named in the PR body as a deliberate test change |
| R4 | Dues error under the empty-submit bug is multiplied | T2 precondition (D2) |
| R5 | A member's second entry submitted after week N has no picks for weeks < N | Same as a late joiner today; the grid shows `—`; nothing special |
| R6 | Reminder emails per uid vs per entry — spam risk | One email per member listing which entries are missing picks (T8) |
| R7 | The projection doc grows with rows; single doc, 500-entry shard note at `nflPools.ts:1566` | max 10 × members; note the shard threshold in the PR |
| R8 | Entry existence + name on a participant-readable Member Record is a disclosure | Accepted, same as CONTEXT.md §Pick Reveal D8 accepted entry existence — it says "Kevin has 3 entries", never what they picked |
| R9 | Two counts (members vs entries) diverge silently in a consumer nobody re-read | D8 names both; sweeps S5 lists every consumer of `participantIds.length` / `entryCount` and classifies it |

---

## 5. Out of scope

- Deleting/withdrawing an entry (K7).
- Partial payment per entry (payment-ledger plan).
- Squares/Bracket/Playoff/Props — untouched.
- Any change to WHEN a pick reveals.
- Autopick, missed-pick penalties (their own plans).

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

| # | Question | Recommendation |
|---|---|---|
| **K1** | Entry identity scheme: **`e${n}:${uid}` with entry #1 = `uid`** (zero migration; index PREFIX so a uid containing `_` cannot collide) vs Bracket-style auto-ids (migration + create step)? | **`e${n}:${uid}`.** |
| **K2** | Upper bound on the wizard's max? | **10.** |
| **K3** | Dues: `feeOwed = fee × playable entries`, ONE Paid Status per member (all-or-nothing) until the ledger plan lands? | **Yes.** |
| **K4** | Survivor: two entries of the same player MAY pick the same team the same week? | **Yes** — independent contestants; simplest and what other sites do. |
| **K5** | Entry names: default `"Name #2"`, member-editable on My Entry, unique per member? | **Yes.** |
| **K6** | Can a commissioner turn multi-entry ON (or raise the max) on an existing pool? | **Yes while the pool accepts entries; raise-only; never lower.** |
| **K7** | Can a member delete an entry they created (before it has picks)? | **No, v1.** Commissioner asks Kevin. Keeps dues monotone. |
| **K8** | Can one player win two weekly places (1st and 2nd) with two entries? | **Yes.** Rows are contestants; the recap shows both. |
| **K9** | Ship the `PLAN-EMPTY-SUBMISSION-FEE` one-liner (`hasPlayableEntry: committedPickForWeek`) as T2's precondition inside this plan, or separately first? | **Separately first, as its own tiny plan-gated PR** — it is live money today, independent of this. |
| **K10** | Second entries count as separate "entries" for the pot maths (`grossPot = entryFee × entries`) and the hybrid split? | **Yes** — an entry is an entry. |
| **K11** | A PAID member who adds an entry flips back to UNPAID (with a ledger line) because their `feeOwed` just rose — until the ledger plan brings partial payment? | **Yes.** The alternative — reporting the new fee as collected — is a money lie. |

---

## 7. Implementation tickets — NOT STARTED, gated on §6

Order matters: T1–T3 are server and ship together (functions deploy **into a
LIVE scorer** — say so); T4–T7 client; T8–T10 cross-cutting.

| T | What | Files | Evidence required |
|---|---|---|---|
| **T1** | Setting: `maxEntriesPerUser` in the three shared create schemas + rules `callableOnlySettingsUnchanged` + `updatePoolSettings` raise-only guard + wizard toggle | `shared/schemas/nfl.ts`, `firestore.rules`, `functions/src/poolOps.ts`, wizard `Create*Pool.tsx` + `StepPickemRules`-equivalents | schema test; `nfl-settings-lockdown.test.ts` gains the key; a rules test case (client cannot write it) |
| **T2** | Submit path: `entryIndex?` (1..max, default 1) + `entryName?` in `submitNFLPicksSchema`; entry id derivation; cap from entry existence in the transaction; Member Record `playableEntryCount` + `entries` map; `feeOwed = fee × count`; **fee-edit cascade × count; `setPaidStatus` mirror to all owned entries + ledger amount = `feeOwed`**; `pool.entryCount`; proxyPick + rebuy take `entryIndex` (proxyPick's schema + `NFLManagerView` gain an entry selector). **Precondition: K9 shipped.** | `nflPools.ts`, `schemas/poolCore.ts`, `schemas/poolExceptions.ts`, `lib/memberRecord.ts`, `shared/memberRecord.ts`, `poolExceptions.ts`, `poolOps.ts:541-558`, `setPaidStatus.ts`, `NFLManagerView.tsx` | emulator: entry 2 lands at `e2:${uid}`; entry max+1 refused; **two concurrent first-submits of entry 2 and 3 → count 3, never 4**; `feeOwed` 25 → 50; fee edit 25→30 with two entries → 60; paid mark mirrors onto both entries and ledgers 60; proxyPick on entry 2 leaves entry 1 untouched; a duplicate `entryName` for the same owner refused; existing single-entry tests unchanged |
| **T3** | Scoring + reveal + finalize + profile keyed by entry id (D4, D5, D9); `simHarness` invariant reworded; `userProfile.ts` per-member aggregation across owned entries | `nflPools.ts` (score), `nflScoringEngine.ts` (WeeklyWinner), `nflPickReveal.ts`, `nflFinalize.ts`, `userProfile.ts`, `lib/profileBuild.ts`, `simHarness.ts` | emulator: two-entry Margin player gets two distinct ranks; reveal maps hold both and **a participant sees no `entries` metadata pre-reveal**; recap lists both; two seasonHistory docs with distinct ids and stored `entryId`; profile shows both histories and ONE fee |
| **T4** | `buildMemberStandings` per entry (D6); `ownEntries` subscription | `utils/memberStandings.ts` (+test), `NFLPoolDashboard.tsx`, `dbService.ts` | `memberStandings.test.ts`: two rows for one uid; placeholder row for a pick-less member; invariant test lines named in PR |
| **T5** | My Entry switcher + `entryName` + CTA from active entry (D7) | `NFLPoolDashboard.tsx`, `NFLUserBentoDashboard.tsx`, the three `*PickEntry.tsx` | manual + invariant tests |
| **T0** | 🛑 **SHIPS FIRST, before any Wave 2/3 UI PR — ordinary, no plan gate.** The three S1c reveal lookups flip to `row.id`; the source invariant **exactly as 0b.6 specifies** — file set `src/components/NFLPoolDashboard/**` + `memberStandings.ts` + `poolRoster.ts` + `PaymentsPanel.tsx`, the five forbidden shapes, and an explicit allow-list naming the files T4/T5 will rewrite (`memberStandings.ts`, `NFLPoolDashboard.tsx`, `NFLUserBentoDashboard.tsx`, `PaymentsPanel.tsx`) so the residue is visible in the test, not hidden by scope (codex r3) | `NFLPicksGrid.tsx`, `NFLWeeklyPicksGrid.tsx`, `NFLStandings.tsx`, `tests/nfl-surface-invariants.test.ts` | the invariant, green, with the allow-list asserted to be exactly those four files; existing grid/standings tests unchanged (id === uid today) |
| **T6** | Grids/Standings/Results/Payments read `entryName ?? userName` for display, `PayoutsPanel`/`NFLPoolRules` read `pool.entryCount` for the pot (0b, D8); **`RecordPayoutsCard` keys its rows by entry id, submits `entryId`, and shows `entryName ?? userName`** (codex r2 — until the ledger plan replaces it) — **the reveal-key half is already done by T0; this ticket is the audit** | `NFLPicksGrid.tsx`, `NFLWeeklyPicksGrid.tsx`, `NFLStandings.tsx`, `NFLResults.tsx`, `PaymentsPanel.tsx`, `PayoutsPanel.tsx`, `NFLPoolRules.tsx`, `RecordPayoutsCard.tsx`, `poolRoster.ts` | grep in sweeps S1 returns zero uid-keyed reveal lookups; pot on a two-entry pool = fee × 2 |
| **T7** | Guard: extend the "no reveal rule of its own" test to `NFLWeeklyPicksGrid.tsx` | `tests/nfl-surface-invariants.test.ts` | test |
| **T8** | Reminders: "missing picks" = any entry missing; one email per member | `lib/reminderTargets.ts` | `manualReminderTargets.test.ts` |
| **T9** | Fixtures: additive `entryName` selector; one multi-entry scenario per NFL type | `src/utils/testing/scenarios/*`, `assertionRunner.ts`, `fixtureMatrix.emulator.test.ts` | matrix count ≥ 48 |
| **T10** | Docs: CONTEXT.md §Entry adds the NFL types + **Entry Index / Entry Name** terms (glossary only); **§Member Record's "does not vary in cardinality or shape by Pool type" gains the one stated exception — for multi-entry types it carries an entry-existence map (`entries`) and a playable-entry count, never picks** (codex r2); ADR for the identity scheme (hard to reverse, surprising, real trade-off — all three); pool Rules copy | `CONTEXT.md`, `docs/adr/0007-nfl-entry-identity.md`, `NFLPoolRules` | `docs-state-invariants` green |
| **T11** | Sweeps re-run after T6 | `PLAN-MULTI-ENTRY-SWEEPS.md` | zero remaining uid-keyed consumers |

---

## 8. What this plan does NOT do

- It does not migrate any existing document.
- It does not change `firestore.rules` for `entries` or `members` (only the
  settings key in T1).
- It does not touch `weekRevealFor` or the reveal timing.
- It does not change Paid Status semantics (one per member).
