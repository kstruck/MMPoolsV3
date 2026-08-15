# PLAN-MULTI-ENTRY — adversarial review log

Act 1 (grill-with-docs) ran overnight 2026-08-15 **without Kevin** — the questions
it would have asked him are the plan's §6, each with a recommendation. Act 2 is
codex (`codex exec -s read-only`, fresh session per round, stdin closed).
MAX_ROUNDS=5.

## Round 1 — codex (14 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | Profile/finalize not end-to-end — `userProfile.ts` reads only `entries/{uid}` and `seasonHistory/{poolId}`; naive multi-history double-counts the member fee | **ACCEPTED** | D9 + T3: per-member aggregation across owned entries, fee charged ONCE (`feeOwed` is already the sum) |
| 2 | Critical | Entry-fee edit cascade (`poolOps.ts:541-558`) stamps one fee per record | **ACCEPTED** | D2 + T2: `newFee × playableEntryCount`; test 25→30 with two entries → 60 |
| 3 | High | Paid-status mirror + ledger amount unresolved | **ACCEPTED** | D2 + T2: mirror to every owned entry in the transaction; `MARKED_PAID` amount = `feeOwed` |
| 4 | High | proxyPick not entry-addressable; manager UI omitted | **ACCEPTED** | T2: schema + `NFLManagerView` entry selector; test entry 2 leaves entry 1 untouched |
| 5 | High | `pickedWeeksByEntry` on a participant-readable Member Record leaks per-entry pre-reveal completeness | **ACCEPTED — the best finding of the round** | D2: dropped. `pickedWeeks` stays per member; per-entry completeness only via reveal-gated `getPoolPicks.counts` |
| 6 | High | D5's `entries` map lets participants enumerate another member's entries pre-reveal | **ACCEPTED** | D5: gated exactly like `counts` (commissioner always, participant once `weekRevealed`) |
| 7 | High | Unscored second entry of ANOTHER member has no standings row | **ACCEPTED** | D2/D6: Member Record `entries: Record<entryId,{name}>` (existence + name, no picks) is the row source; R8 accepts the disclosure per CONTEXT.md §Pick Reveal D8 |
| 8 | High | Entry names have no write path | **ACCEPTED** | D7: optional `entryName` on `submitNFLPicks`, uniqueness in the transaction |
| 9 | High | `{poolId}_{n}` seasonHistory id can collide with a pool id ending `_2` | **ACCEPTED** (auto ids never contain `_`, but the fix is free) | D9: `${poolId}__e${n}` + stored `poolId`/`entryId` fields, readers query by field |
| 10 | Medium | Cap semantics not atomic under retries/concurrency; legacy records lack the counter | **ACCEPTED** | D2: count derived from entry existence in the transaction; legacy default `hasPlayableEntry ? 1 : 0`; T2 concurrency test |
| 11 | Medium | Entry-count consumers missed (billing/BillingGate/poolSport count members; pot needs entries) | **ACCEPTED** | D8: two named counts; NFL `pool.entryCount` server-maintained; R9 + sweeps S5 |
| 12 | Medium | Types/contracts incompletely scoped | **ACCEPTED** | D8: client settings interfaces, payload builder, prefill, `?? 1` default |
| 13 | Medium | §0b is prose, not a gate; misses non-dashboard consumers | **ACCEPTED** | 0b.6 + **T0**: flip the three S1c lookups and add a source-grep invariant, shipped BEFORE any Wave 2/3 PR (ordinary — no money/auth/data/scoring) |
| 14 | Medium | Test evidence too narrow | **ACCEPTED** | T2/T3 evidence columns rewritten (concurrency, mirror, cascade, proxy, pre-reveal non-disclosure, profile, history ids) |

14/14 accepted. Round 2 requested.

## Round 2 — codex (8 findings) — VERDICT: REVISE

Codex confirmed round 1's fourteen changes landed, then:

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | `${uid}_${n}` collides when a uid contains `_` (sim/test uids do, e.g. `mr_boss`) | **ACCEPTED — the best finding of the round.** Real Firebase uids never contain `_`, but the harness's do, and the harness is the eval | Identity is now `e${n}:${uid}` (index prefix); docs carry `ownerUid` + `entryIndex`; readers never parse the id |
| 2 | High | `entryCount` absent on legacy pools; from-zero increment breaks the pot | **ACCEPTED** | D8: derive from existing entry docs in the same transaction when absent; T2 legacy-pool test |
| 3 | High | `RecordPayoutsCard` stays uid-keyed | **ACCEPTED** | T6: entry-id rows, `entryId` submitted, `entryName ?? userName` |
| 4 | High | `sortMarginLeaderboard` ties on `ownerUid` → same-owner entries take Firestore order | **ACCEPTED** | D4 + sweeps S6: every per-entry ordering breaks its last tie on `entry.id`; rescore test |
| 5 | Medium | T0's grep guard too narrow (one directory, two forms) | **ACCEPTED in the regex form; AST rejected as disproportionate** | 0b.6: broader file set, five forbidden shapes, explicit allow-list of files T4/T5 rewrite |
| 6 | Medium | Sweeps S5 (count consumers) was asserted but absent | **ACCEPTED — the plan cited evidence that did not exist** | S5 added with the command and the two buckets; the line list is pasted before T2 |
| 7 | Medium | Contradicts CONTEXT.md §Member Record "does not vary in shape by Pool type" | **ACCEPTED** | T10: the glossary entry gains the one stated exception (existence map + count, never picks) |
| 8 | Medium | Legacy rebuy fallback in `setPaidStatus` reads only `entries/{uid}` | **ACCEPTED** | D3: reads all owner entries |

8/8 accepted (one in a narrower form than asked). Round 3 requested.

## Round 3 — codex (5 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | K1 and T2's test still said `${uid}_2` after round 2 moved to `e2:${uid}` | **ACCEPTED — my inconsistency** | K1 + T2 evidence updated |
| 2 | High | Legacy pool has no `entryCount` until someone submits; the pot is unknown after enabling | **ACCEPTED** | D8: `updatePoolSettings` initialises it in the enable/raise transaction; T2 test |
| 3 | High | `fee × count` silently made a joined-but-unpicked member owe $0 — contradicts the Member Record contract | **ACCEPTED — the best finding of the round** | D2: `fee × max(joinLiability, playableEntryCount)`, joinLiability 1 for members / 0 for the seeded commissioner, exactly today's contract |
| 4 | High | `getProfilePoolDetail` unspecified; naive query still flattens one entry | **ACCEPTED** | D9: additive `entries[]` on the detail response, top-level = entry #1 for back-compat; test |
| 5 | Medium | T0's text narrower than 0b.6 | **ACCEPTED — my inconsistency** | T0 restated to 0b.6's exact scope + allow-list |

5/5 accepted. Round 4 requested (cap 5).

## Round 4 — codex (5 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | PAID member adds an entry → `feeOwed` 25→50 but stays PAID → `memberDues` reports $50 collected | **ACCEPTED — the best finding of the round, and a money lie the plan would have shipped** | D2: reset to UNPAID + mirrors + `MARKED_UNPAID` ledger line in the same transaction; K11 |
| 2 | High | `entryCount` (docs) disagrees with dues (liability) before picks | **ACCEPTED** | D8: `entryCount` counts liable entries; incremented on join / first play; enable-time init from Member Records |
| 3 | High | Legacy Member Records have no `entries` map → entry 1 vanishes from other members' rows | **ACCEPTED** | D6: rebuild the owner's map from entry docs on first touch, same transaction; T2 test |
| 4 | High | `e${n}:${uid}` collides if a uid IS `e2:alice` | **ACCEPTED in the cheap form** (Firebase uids cannot contain `:`; hand-made ones could) | §0a: create reads the target first; different `ownerUid` → auto-id fallback; nothing parses ids |
| 5 | Medium | 0b's regex gate exempts whole files; alias dataflow escapes it | **ACCEPTED in part** — per-symbol allow-list; the alias gap is named as an honest gap closed by T4's behaviour test, not papered over | 0b.6 |

5/5 accepted (one in narrower form).

### Resolution — STOPPED AT ROUND 4 (32 findings, 32 accepted, 0 rejected), NOT APPROVED

Trajectory 14 → 8 → 5 → 5. Every round found something real; round 4's #1
was a genuine money defect. **Claude's position:** the plan's DESIGN (identity
scheme, per-entry rows, reveal gating, dues rule) has been stable since round
2 and the findings are now about the seams between it and existing contracts
— which is exactly what the tickets' evidence columns are for. The next paid
round belongs on T2's code, not on this prose. Handed to Kevin without faking
convergence, with the honest gap (0b.6 alias dataflow, closed by T4) named.
