# MORNING 2026-08-17 — takeover: LEDGER UX FIX (PR #460) + what comes next

> **Continues `MORNING-2026-08-17-LEDGER.md`** (the six-PR stack — ALL MERGED AND
> DEPLOYED 2026-08-16 late, per Kevin) and supersedes `MORNING-2026-08-17.md`.
> This is the live one. Nothing merged, nothing deployed, no prod data touched
> by this session.

## 1. What is waiting for you

| PR | Branch | What | Deploy | codex | qodo |
|---|---|---|---|---|---|
| https://github.com/kstruck/MMPoolsV3/pull/460 | `claude/ledger-ux-fix-d68bd0` | **Ledger UX** — ONE Payment Ledger spreadsheet on Manager → Members & Payments (Member \| Entry fee \| Fee paid ☐ \| HOF/W1/W2… \| Season $ \| totals); roster card = picks/remind/co-comm only; member Payments tab "Payment History" + "Open Payment Ledger" deep-link (`?tab=manager&section=members`); Overview "Open Payment Ledger" → same card; Advanced Payment Ledger modal removed, its method/date/note editor folded into the ledger's fee cell; empty state names the rescore | **Coolify only** (`src/` + `tests/`) | 9 rounds (r5 clean, r9 clean on final diff) | first review: 9 findings — 2 absorbed, 1 already fixed, 6 rejected with evidence (verdict comment on the PR); re-review after toggle: see the PR |

### 1b. ALSO waiting: PR #464 — WEEKLY-PRIZES step 3 (opened after #460 merged + verified)

| PR | Branch | What | Deploy | codex | qodo |
|---|---|---|---|---|---|
| https://github.com/kstruck/MMPoolsV3/pull/464 | `claude/weekly-prizes-step3` | **Season-tie cascade** (Pick'em Σ correct → share; Margin negativeBurden → positiveWeeks → bestWeek → share) · **`pool.seasonPlaces` + `pool.seasonPrize`** published at finalization (fenced, in-tx, fail-closed `seasonPlacesError`; absent payoutMode = one season pot) · `recordPoolPayouts` **binds season PLACE awards** to that list at `season-{entryId}-p{place}` (idempotent, K12 re-record via `staleAwardId`, reversal to $0, chain must stay in scope) · rules: the three fields server-owned · **ledger Season $ column live** · rules-page Season Tie copy | **functions (LIVE finalize path) → rules → Coolify** | 6 rounds (r6 clean) | see the PR (GitHub GraphQL was 503 when the toggle was tried; REST fine) |

#460 was **verified end to end** on the HYBRID test pool `0ybpLzY7fJ3NJbDj0j1l` (recap prizes HOF $15 / P1 $7+$7, ledger ticks write `wk1-…-p1`, un-tick/re-tick, Payments deep-link) — after fixing the pool's HYBRID split (was 0/0) and deleting the sticky `weeklyPrize: null` on `week_1`/`week_2`, then rescoring. **Ticket:** a commissioner-facing "re-price this week" for that sticky null.

## 2. Merge + deploy (PowerShell 5.1 — one command per block)

**Where:** `D:\march-melee-pools` (MAIN checkout).

Step 1 — CI green:
```powershell
gh pr checks 460
```
Expect every row `pass`. If any `fail`, stop and open the run link.

Step 2 — merge (single PR, squash is fine — NOT stacked):
```powershell
gh pr merge 460 --squash --delete-branch
```
Expect `✓ Squashed and merged pull request #460`.

Step 3 — frontend only: Coolify dashboard → March Melee Pools app → **Redeploy**. Wait for the build; hard-refresh the site. No functions/rules/indexes deploy for this PR. **(#460 — DONE 2026-08-17 by Kevin.)**

### 2b. #464 (step 3) — merge + deploy: functions FIRST, then rules, then Coolify

Step A — CI green:
```powershell
gh pr checks 464
```
Step B — merge:
```powershell
gh pr merge 464 --squash --delete-branch
```
Step C — main checkout up to date:
```powershell
git checkout main
```
```powershell
git pull
```
Step D — functions deps (`ci`, never `install`):
```powershell
npm --prefix functions ci
```
Step E — deploy functions (LIVE finalize path: `nflFinalizeSweepJob`, `nflAutoScoreJob`, `scoreNFLWeek`, `recordPoolPayouts` show `Updated`):
```powershell
npx firebase deploy --only functions
```
Step F — deploy rules (`seasonPlaces`/`seasonPrize`/`seasonPlacesError` become server-owned):
```powershell
npx firebase deploy --only firestore:rules
```
Step G — Coolify → March Melee Pools → **Redeploy**; hard-refresh.
Step H — verify: on a FINALIZED pool (or after your test pool finalizes), Firestore `pools/{id}` carries `seasonPlaces` (rows with `rank`, `prize` on paid ranks) + `seasonPrize`; Manager → Members & Payments → **Season $** column shows `$N ☐`; tick → `payoutRecords/season-<entryId>-p<place>`. Rules & Rulesets shows the "Season Tie" line. Nothing to verify before a finalization happens — the finalize sweep publishes it.

## 3. Verify end to end on your HYBRID test pool (10 min)

Step 4 — Manager → Scoring → **Score Week** for HOF, then again for Wk1 (they were scored before weekly prizes existed, so they have no `weeklyPlaces` until rescored). Expect no error toast.
Step 5 — Recaps tab: each rescored week now shows the **Weekly Winners List** (Place / Player / Score / Tie Break Diff / Prize). If a recap shows `weeklyPlacesError` or the Prize column is blank on a HYBRID pool: check Settings → `hybridSplit` is set, `entryFee > 0`, and Firestore `pools/{id}.weeksInSeason` exists — tell the next session before touching code.
Step 6 — Manager → Members & Payments: the **Payment Ledger** card has a HOF and a W1 column; winners' cells show `$N ☐`; the "scored before weekly prizes existed" note is gone.
Step 7 — Tick one prize ☐ → Firestore `pools/{id}/payoutRecords/wk<N>-<entryId>-p<place>` appears and `payoutRecordsPrivate/<same id>.settled: true`. Un-tick → `settled: false`. Tick again → same doc, no new one.
Step 8 — Tick a **Fee paid ☐** → the Member Record flips PAID and the member's Payments tab **Payment History** gets a line. Click **add details** under it → method/date/note save; the line under the box shows them.
Step 9 — Member view (any member): Payments tab → **Open Payment Ledger** lands on Manager → Members & Payments (not Overview). Overview → **Open Payment Ledger** does the same.

## 4. Decisions / deviations this session

1. **Advanced Payment Ledger modal removed** (it was the third "ledger"). Its method/date/note editor is now `add details` / `edit details` under the Fee paid box (same `setPaidStatus` callable, details ride only with PAID). Codex insisted twice (r2, r6); folding it in beat rejecting.
2. Fee fallback for an unstamped Member Record = `entryFee × own entries` (codex r3); ledger rows come from the Member Record `entries` map ∪ entry docs (codex r4) so extra entries show even when the parent passes the per-owner standings fold.
3. Prize totals show `—` until recaps + records (+ private settlement) have loaded (qodo #1); unpublished week cells say `unpublished` (qodo #4).
4. `nflWeekChip` labels: `HOF`, `P1`… preseason; `W1`… regular. Kevin wrote "Wk1" — chip labels are what the rest of the app uses; say if you want `Wk`.

## 5. Next, one PR at a time (unchanged order)

1. ~~WEEKLY-PRIZES step 3~~ — **in PR #464** (§1b).
2. PLAN-PAYMENT-LEDGER T6 — member "My prizes" in PaymentsPanel (own rows only, K7).
3. T7 — CONTEXT.md Weekly Prize / Season Prize glossary, Payout Record "may name a week", ADR "displayed until recorded", fold Record Payouts card into the ledger.
4. T0/T1/T2 — `settings.weeklyPayouts` schema + validator + rules key + wizard second editor on HYBRID + HybridSplitFields under Entry Fee (K9 duplicate-rank census first).
Deferred: multi-entry T3.

## 6. Kevin's open calls (ask once, don't block)

- PLAN-WEEKLY-PRIZES codex r11 (past cap; §9 unreviewed as text) — yes/no?
- §6 on the three new plans (#457): board memo says build none during live weeks; ship the two ICONS card mislabels + `createCheckoutSession` ownership gate standalone — go?
- SUPER_ADMIN stale-claim gate ticket — open it?
- Co-commissioner `members` read for legacy rosters (codex r10 / qodo #11 on #456) — next after step 3, or now?
