# PLAN-REALTIME-SCORING — adversarial review log

Companion to [PLAN-REALTIME-SCORING.md](PLAN-REALTIME-SCORING.md). The full,
finding-by-finding trail lives in the git history of that file — one commit per
codex round, `docs(plan): absorb codex rN …`, each naming what was absorbed. This
log is the index; §9 of the plan carries the stop rationale.

## Reviewer

`codex exec review --base origin/main` (OpenAI, gpt-5.6-terra), the required
cross-model gate (CLAUDE.md §2c). qodo is billing-blocked (§2b) and did not run.

## Rounds (31 — loop capped by Kevin at ~10, actual 31)

| Round | Findings | Theme (all absorbed with written evidence) |
|---|---|---|
| r1 | 4 | candidate match on `(season,seasonType)` not week; defer missing-pick penalties; terminal-game fingerprint; pool has no `week` field |
| r2 | 4 | effective-lock gates (not kickoff/terminal); full-slate terminality; dry-run keeps fingerprint unset; `spread.value` in fingerprint |
| r3 | 3 | equality-only candidate query (inequality omits new pools); lock-eligibility bit in fingerprint; reconciliation tier for late corrections |
| r4 | 5 | `provisional` flag gates penalties+finalization+markers; actor threading; `isFinal`-only prefilter; `extendWeekDeadline` publish guard |
| r5 | 4 | suppress recap/`SCORE_FINALIZED` on provisional; terminal-lifecycle prefilter; immutable `publishedWeeks`; survivor forward-replay on correction |
| r6 | 6 | fix inverted early-out; 24h HOF lookback; explicit terminal predicate (not `normalizePhase`); `seasonType` superset; survivor reset-replay; transactional publish guard |
| r7 | 4 | stamp `publishedWeeks` on all passes; exclude archived; `lockRevision` optimistic concurrency; enqueue late FINAL transitions |
| r8 | 6 | provisional summary reveal-safety (pick-count leak); heartbeat registration; `lockRevision` before entry writes; override-edge + finalized-pool reconciliation; `scoredWeeks` consistency |
| r9 | 4 | defer entries with pending selected game; scorer lease for whole-pass; reconciliation keeps voided-pool exclusion; settings in fingerprint |
| r10 | 3 | full-slate survivor exemption; enqueue CANCELLED transitions; lease as cross-scorer mutex |
| r11 | 3 | Survivor/Margin score complete-pass only (mutable weekly pick); callable derives `provisional`; declare `publishedWeeks`/`lockRevision` contract |
| r12 | 2 | protect `weekLockOverrides` across all settings writers; type-specific reconciliation (exclude Survivor until reset-replay) |
| r13 | 2 | all scorer-owned fields server-only; deny client-direct `settings` writes (`affectedKeys` sees only top level) |
| r14 | 3 | fencing token on lease; `updatePoolSettings` merge-preserve; submission watermark; reframe PR-B′ as non-trivial |
| r15 | 3 | general sync principle (all lifecycle+entry writers); surface S/M live-scoring as explicit Kevin decision; stop overclaiming PR-B |
| r16 | 4 | one fenced lease record; fence every side-effect; entry mutators conflict on lease; durable enqueue ships in PR-B |
| r17 | 3 | in-transaction lease validation; per-entry (not pool-wide) watermark; enqueue-reason so delayed Survivor finals score |
| r18 | 4 | export from `index.ts`; lease owner+unexpired+revision in-txn; monotone watermark (not `max`); durable >24h finalize observation |
| r19 | 2 | fix leftover `max` aggregate; ESPN re-fetch for >24h finalize (a Firestore query alone can't observe it) |
| — | — | **Kevin ruling 2026-07-25: Survivor + Margin weekly hard lock (60/30/5). Design simplified — all 3 types live-scorable; PR-0 added; provisional reduced to finalization-completeness; PR-B′ reveal race narrowed to Pick'em.** |
| r20 | 3 | PR-0 must server-enforce `WEEKLY` (a manager save omits `lockMode` → reverts to per-game); disallow overrides on S/M (Math.max/positive-only makes "move-earlier" unworkable); arm deep-sweep-with-writes as prerequisite for >24h finalize |
| r21 | 3 | doc consistency — update morning takeover to the ruling; unconditional S/M override rejection; record r20 in this log |
| r22 | 4 | gate S/M no-pick penalty on `effectiveWeekLockAt` (active window precedes the lock); keep `gameLockClosed` in provisional completion (Pick'em overrides); sum-only watermark (count also stalls); unconditional override reject |
| r23 | 3 | include a weekly-lock-passed bit in the fingerprint (else at-lock penalty waits for a game to finalize); migration must CLEAR existing overrides on S/M; backfill `publishedWeeks` for pre-rollout scored weeks |
| r24 | 3 | move S/M lock-field write-lockdown into PR-0 (a client save reverts it before PR-B′); fence `nflFinalizeSweepJob` with the scoring lease; update this log through r24 |
| r25 | 2 | PR-0 also freezes per-week deadline + protects `lockBufferMinutes` (a save omitting it reverts to 5min); lossless rescore-queue drain (append-only / versioned ack) |
| r26 | 2 (P3) | doc consistency only — stale "2h" live-window boundary → 24h; record r25 here |
| r27 | 3 | enqueue manual spread edits for ATS rescore; `gameLockClosed` in §3b formula; retry finalize on complete-but-unfinalized pool |
| r28 | 2 | pending-state for locked-but-unfinished S/M made picks (engine writes survived/0 otherwise); add `FINAL` to terminal pool-status predicate |
| r29 | 3 | server-validate buffer to {60,30,5}; deep-sweep lookback is bounded (7–30d) so needs uncapped re-fetch; override guard is a *current* concern (submissions honor overrides today) |
| r30 | 3 | dry-run reads queue read-only (no ack); enqueue failed finalization beyond 24h window; correct morning-doc K2 deep-sweep note |
| r31 | 2 | protect the server-only set-once `frozenWeekLockAt.{week}`; update the review trail |

## Verdict

**31 rounds, 99 findings, 0 rejected** — all valid against source (each
load-bearing claim verified against the cited files before absorbing, per
CLAUDE.md). Rounds 1–11 found genuine defects in the core scoring/reveal/lifecycle
design; 12–19 refined the flagged PR-B′ concurrency/authorization protocol and the
>24h observation edge; then **Kevin's 2026-07-25 weekly-hard-lock ruling simplified
the design** (all three pool types live-scorable, PR-0 added), and r20–31 hardened
and reconciled that ruling (penalty-at-lock timing, made-pick pending state, pool
migration, cold-start markers, dry-run/queue interaction, and the frozen deadline).

**The loop was STOPPED at Kevin's direction (cap ~10 reviews) — not because a round
returned clean.** Severity had trended down (P3-only at r26) but P1/P2 edge findings
kept surfacing on the concurrency + arming interactions, which is expected for a
prose spec of a distributed scoring protocol. The core scoring/reveal/lock design is
settled and thoroughly evidenced; the residual is implementation-level specification
of PR-B′ (fenced mutex) and the arming/queue mechanics, which carry into those
sub-PRs' own code review, where codex runs on a diff and can converge to clean.
