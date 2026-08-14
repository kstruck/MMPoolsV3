# PLAN — the hybrid entry-fee split, and the site that verifies it

**Status:** ✅ SIGNED OFF in chat — Kevin, 2026-08-13, chose "build the split"
over removing hybrid, live in session.
**Trigger:** Kevin, 2026-08-13, launch-blocker: a HYBRID pool needs the entry
fee broken down between the weekly prize pot and the season pot, manager-
determined, **site-verified**.
**Gate:** `mmp-change-control` §1 — **money** (it determines what commissioners
pay out). Plan + review log + sign-off; sign-off already given.

Kevin's example, which is the spec:

> $25 entry fee: $18 → weekly play ($1 per week per entry across an 18-week
> season), $7 → season-long winners pot. Percentages (1st 50%, 2nd 20%, 3rd
> 15%, 4th 10%, 5th 5%) apply to BOTH pots. Amounts rounded to whole dollars.

## 1. The design decision that everything else follows from

**The site verifies `weekly + season = entryFee`. It does NOT verify
"per-week × weeks", because no canonical weeks-per-season-type constant exists
anywhere in this codebase** (measured: no `REGULAR_SEASON_WEEKS`, nothing in
`shared/nflWeekLabel.ts`, season shape lives only in the imported schedule).
Inventing one now would be wrong for the preseason pilot pools (4 importer
weeks incl. HOF) and fragile for 2027.

So the manager enters **two whole-dollar amounts per entry** — weekly
allocation and season allocation — and the invariant is exact integer
arithmetic: `weeklyPerEntry + seasonPerEntry === entryFee`. The "$1/week"
figure is DISPLAY, derived from the schedule the client already holds, and is
allowed to be approximate ("≈ $1.00/week across 18 weeks"); the split itself
never is.

Rejected: a single per-week input with derived remainder. It needs the weeks
constant, and a preseason pool's "week" count is an importer artifact
(HOF = week 1) that no commissioner should have to know about.

## 2. Where it lives

`settings.hybridSplit: { weeklyPerEntry: number; seasonPerEntry: number }` —
**Pick'em and Margin** (the two types carrying `payoutMode`). Whole dollars,
both ≥ 0, integers.

- **Absent field = no split declared.** Existing HYBRID pools (and SEASON/
  WEEKLY pools, where a split is meaningless) carry nothing and behave exactly
  as today: the Payouts panel keeps saying "ask your commissioner". No
  migration, defaults at read sites, the #399 pattern.
- Meaningful ONLY under `payoutMode: 'HYBRID'`. Under SEASON or WEEKLY the
  whole fee is one pot and the field is refused (not silently ignored — a
  stored split on a non-hybrid pool is a lie waiting for a mode flip).
- One pure module, `shared/hybridSplit.ts`: the type, and
  `hybridSplitProblem(settings): string | null` — the single validation both
  the create schema and the update callable call. One definition, because a
  drift between create-time and edit-time money validation is how a pool ends
  up with a split its own editor would refuse.

## 3. Enforcement — two doors, same as every settings rule

1. **Create:** `superRefine` on the Pick'em and Margin create schemas
   (`shared/schemas/nfl.ts`). The wizard cannot mint an invalid split.
2. **Update:** `updatePoolSettings` (`poolOps.ts`) — validated inside the
   existing transactional gate whenever the patch touches `hybridSplit`,
   `payoutMode`, or `entryFee` (all three can break the invariant; checking
   only the split field misses an entryFee edit that unbalances a valid
   split). Pure helper, unit-tested, same shape as `weeklyTiebreakerGate`.
3. **Rules: `hybridSplit` joins `callableOnlySettingsUnchanged`.** The first
   draft of this section claimed no rules work was owed — *while citing the
   #421 lesson it was busy repeating*. A super-admin client does NOT go
   through the callable; `isSuperAdmin()` short-circuits the whole manager
   branch, so an SA could direct-write an invalid split, or move `entryFee` /
   `payoutMode` around a valid one, and the "site-verified" claim would be
   decorative for exactly the principal most likely to hand-fix money fields.
   (codex P1, round 1 on this plan.) One word in the rules list; **owes a
   rules deploy**, order functions → rules, no client-read impact.

4. **Mode-switch deletion semantics** (codex P2, round 1): the update path is
   a per-key merge, so switching HYBRID → SEASON would leave the stored split
   behind — and rule 2 would then refuse the save as "split on a non-hybrid
   pool", making the payout mode impossible to change. So: when a patch moves
   `payoutMode` away from HYBRID, the callable **deletes `settings.hybridSplit`
   in the same write** (the existing `clearLegacy`/FieldValue.delete
   mechanism), and the manager UI clears its local state. Switching back does
   not resurrect it; the manager re-enters the split.

**No freeze-after-submission.** Deliberate difference from the tiebreaker:
the split does not change the meaning of anything a member typed.

**DEFERRED, with reasoning: no freeze-after-recorded-payout either.** A first
draft proposed refusing split edits once `payoutRecords` was non-empty. Dropped
for launch: recorded awards are immutable superseding documents — a later split
change cannot rewrite them — the platform computes nobody's obligation, and the
check would add a transactional collection read to every settings save that
touches money fields. If a season of live use shows commissioners quietly
re-splitting after awarding, it comes back as its own PR.

## 4. What the member sees (PayoutsPanel)

Under HYBRID with a split present:

- Two pot lines: `Weekly pots: $18/entry → $X total` and
  `Season pot: $7/entry → $Y total` (totals only when the entry count is
  known — the panel already refuses to guess).
- Per-place dollars against **each** pot, same percentage table.
- Whole-dollar display via the existing rounding convention (`Math.floor` for
  charity is the precedent; payout display rounds to whole dollars and says
  "approx" — the commissioner settles actual cents, as today).
- The "Ask your commissioner how the split works" sentence **finally dies on
  pools that declare a split** — it stays for pools that do not.

Wizard (screen 2, under the Payout Method select, HYBRID only) and the
manager settings editor get the same two inputs plus a live check line:
`✓ $18 weekly + $7 season = $25 entry` / `✗ … ≠ $25`.

## 5. Out of scope, named

- The platform still moves no money and computes no one's obligation to pay.
- No per-week payout records; `RecordPayoutsCard` unchanged.
- No weeks constant anywhere.
- Survivor untouched (no payoutMode).

---

## Post-merge addendum (2026-08-13 evening) — the update gate's trigger changed in #424

Recorded here because the mechanics above are otherwise stale (qodo, on #424 —
its "missing plan update" finding, absorbed on exactly this ground: a plan that
describes superseded mechanics is a stale doc claim, not a historical record).

**What shipped in #423:** the transactional gate fired on the PRESENCE of any
trio key (`hybridSplit`/`payoutMode`/`entryFee`) in the patch. The manager UI
sends the complete settings object on every save, so every ordinary settings
edit paid for a transaction plus a scoring-lease check (qodo #12, post-merge).

**What #424 changed:** trio keys whose value equals the pre-transaction pool
read are **DELETED from the patch** before anything else looks at it —
`hybridNoOpKeys` in `functions/src/lib/hybridSplitGate.ts`. Presence over the
stripped patch is then the change test, so `touchesHybridSplitSettings` needed
no second predicate.

**Why deletion rather than skipping the transaction** (codex P1 on the first
draft of the fix): the update schema permits sparse patches, and a stale
`{entryFee: 25}` matching the pre-read could take the plain path and clobber a
concurrent `$30 = $20 + $10` commit into an invalid `25 ≠ 20 + 10`. A key that
is never written cannot clobber anything under any interleaving. The split
compares by its two named numeric fields, never by serialization — property
order must not reinstate the waste (codex P2).

**What did NOT change:** the refusal logic, the clearing rule, the create-path
validation, the rules guard. A patch that genuinely changes any trio value
still takes the transaction and is re-judged against the in-transaction read.
