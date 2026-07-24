# PLAN-REALTIME-SCORING — adversarial review log

Companion to [PLAN-REALTIME-SCORING.md](PLAN-REALTIME-SCORING.md). The full,
finding-by-finding trail lives in the git history of that file — one commit per
codex round, `docs(plan): absorb codex rN …`, each naming what was absorbed. This
log is the index; §9 of the plan carries the stop rationale.

## Reviewer

`codex exec review --base origin/main` (OpenAI, gpt-5.6-terra), the required
cross-model gate (CLAUDE.md §2c). qodo is billing-blocked (§2b) and did not run.

## Rounds (19)

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

## Verdict

**21 rounds, 77 findings, 0 rejected** — all valid against source (each
load-bearing claim verified against the cited files before absorbing, per
CLAUDE.md). Rounds 1–11 found genuine defects in the core scoring/reveal/lifecycle
design; 12–19 refined the flagged PR-B′ concurrency/authorization protocol and the
>24h observation edge; then **Kevin's 2026-07-25 weekly-hard-lock ruling simplified
the design** (all three pool types live-scorable, PR-0 added), and r20–21 hardened
and reconciled that ruling across the docs. PR-B′'s concurrency contract carries
into its own code review, where codex runs on a diff and can converge to clean.
