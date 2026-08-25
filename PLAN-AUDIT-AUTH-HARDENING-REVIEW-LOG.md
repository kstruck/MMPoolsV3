# Review log — PLAN-AUDIT-AUTH-HARDENING (Phase A)

Reviewer: `codex exec review --base origin/main` (plan + implementation in one
diff). CLAUDE.md §2c; qodo DORMANT — stopping rule is a clean round + own read.

## Round 1 — 2026-08-24

VERDICT: REVISE. 1 finding (P1), accepted:
1. (P1) The reset notice used `sendEmail` without `transactional: true`, so
   users who opted out of marketing email — exactly the privacy-conscious ones
   — silently got no takeover warning. Fixed; pinned by a test.

## Round 2

VERDICT: REVISE. 2 findings (P2), both accepted:
1. (P2) Public mail endpoint needed abuse controls beyond the per-email
   cooldown. Added: global hourly cap (20/hr) + uniform transaction work for
   existing and missing accounts (blunts the timing oracle). App Check enforce
   noted as the stronger gate, BLOCKED repo-wide (2026-07-30 outage).
2. (P2) The cooldown was consumed before the send; a transient queue failure
   suppressed the next genuine notice for an hour. Fixed: per-email
   reservation released when the outcome is not `queued`.

## Round 3

VERDICT: REVISE. 2 P1, 1 P2:
1. (P1) 20 made-up addresses could exhaust the global cap → DoS of the
   control. Accepted: global slot now charged only for existing accounts;
   per-email reservation still burns for any address.
2. (P1) The notice is a client callback, not an audit hook — an attacker
   redeeming the oobCode via the raw Auth REST API never calls it.
   **Partially accepted**: limitation now documented loudly in the code and
   plan; the real fix (Identity Platform blocking functions) is on Kevin's
   decision list. Removal REJECTED: the notice covers the common cooperative
   path, mirrors the existing client-initiated email-change alert, and
   best-effort beats nothing while the upgrade is undecided.
3. (P2) Outer-strict settings still persisted unknown NESTED keys (stripping
   z.objects + handler consuming the raw payload). Accepted: handler now
   consumes the zod parse OUTPUT — stripping is recursive in output.

## Round 4

VERDICT: REVISE. 2 P2:
1. (P2) Anyone can trigger a false "your password was just reset" email for a
   registered account (1/email/hr, 20/hr global). **Partially accepted**:
   copy re-hedged so a spoofed trigger asserts no false fact ("completed a
   reset, or received a report of one"), and the induced action (reset your
   password) is protective either way. Removal / server-proof requirement
   REJECTED for the round-3 reasons — no server-verifiable reset event exists
   without the platform upgrade, which is exactly the listed decision.
2. (P2) The r3 re-parse ran BEFORE validateCreateInput, so malformed settings
   surfaced as raw ZodError (`internal`) instead of the gate's
   `invalid-argument`. Accepted: parse moved after the gate.

## Round 5 — final

VERDICT: CLEAN. "The changes correctly apply the stricter role checks and
bracket-settings handling, and the password-reset notification flow is
internally consistent with its documented best-effort limitations."

RESOLUTION: CONVERGED. 5 rounds, 8 findings — 6 accepted and fixed, 2
partially accepted (limitation documented + copy hedged; removal rejected
with reasoning in rounds 3-4), 0 carried. Own read of the final diff agrees.
The canonical statement of the residual limits lives at the top of
`functions/src/securityNotices.ts`.

---

# Review log — PLAN-AUDIT-AUTH-HARDENING (Phase B: pool passwords)

Reviewer: `codex exec review --base origin/main`. CLAUDE.md §2c; qodo DORMANT —
the stopping rule is TWO conditions, a clean codex round AND my own read of the
diff agreeing.

## Round 1 — 2026-08-25

VERDICT: CLEAN. *"No discrete, actionable regressions were identified in the
changes relative to the specified merge base."*

Not treated as the review (§2c: round 1 finds defects in the code, rounds 2+
find defects in the fixes, and a clean round 1 is not a stopping condition on
its own). Own read of the diff found four things:

1. **A literal NUL byte had shipped in `poolPassword.ts`** — the `attemptKey`
   separator. Functionally correct and it type-checked, but a raw NUL makes git
   and most diff/grep tooling treat the file as binary. Now written as an escape,
   with the reason recorded. It surfaced from codex's own hexdump of the file,
   not from any assertion — worth noting, because nothing in the gate set would
   have caught it.
2. **That separator was load-bearing, not cosmetic.** A Firestore document id
   may contain a space, so the space separator I had intended put
   `("pool a","b")` and `("pool","a b")` in the SAME throttle bucket — two
   principals sharing one cap. NUL is the one byte an id cannot contain. Pinned
   by a test.
3. **The gate blamed the wrong subsystem.** A caller who was rate-limited or
   offline was told "Incorrect password." `verifyPoolAccess` now returns a
   reason and PoolRoute renders three distinct messages (with `role="alert"`);
   an empty box no longer costs an attempt. This is the exact failure §2c cites
   from #322.
4. **`createNFLPool` did not split the payload.** Not a live leak — NFL pools
   have no password UI — but both create wrappers hand the WHOLE payload to
   `handleError` as context, and both ride the same permissive envelope.
   Splitting one and not the other is how the next password-bearing pool type
   ends up in `system_logs`.

Also added an emulator assertion for a question I had been ANSWERING FROM
BELIEF: that `scrubPatch`'s dotted delete of `accessControl.password` applies
cleanly to a pool with no `accessControl` map. `publishBracketPool` applies that
patch inside the slug transaction, so a rejection there would have broken
publishing outright. Measured now, not assumed.

## Round 2

VERDICT: REVISE. 1 finding (P1), ACCEPTED in full:

1. **(P1) Publishing a draft could silently delete its password.**
   `publishBracketPool` wrote `passwordHash: passwordHash || FieldValue.delete()`.
   That was harmless while publish was the ONLY writer — a DRAFT could not hold
   a stored hash. Phase B adds `setPoolPassword`, which a commissioner CAN call
   on a draft, so publishing with the field blank would have deleted the secret
   and cleared the marker: the pool opens, silently, in the fail-OPEN direction
   this whole phase exists to close.

   I had looked at this line during my own round-1 read and talked myself out of
   it — "it matches the prior behaviour" — which was true of the LINE and false
   of the SITUATION. That is precisely the blind spot §2c says self-review does
   not catch.

   Fix: an omitted `password` now means LEAVE IT ALONE, the same
   empty-is-not-a-clear rule the client seam, the schema and the rules predicate
   already follow. The decision moved into a pure `publishPasswordPlan()` with
   five unit tests, including the legacy branches — a pre-Phase-B draft carrying
   a plaintext `accessControl.password` is now ADOPTED on publish rather than
   destroyed by the scrub. Removing a password is one explicit act:
   `setPoolPassword(poolId, null)`.

   Codex also reported `tsc -p functions/tsconfig.test.json` failing with
   `TS5107 moduleResolution=node10 deprecated`. NOT a finding on this diff — it
   is what the raw invocation does; the repo's own `npm --prefix functions run
   typecheck` passes. No action.

## Round 3

VERDICT: REVISE. 1 finding (P1), ACCEPTED in full:

1. **(P1) The dotted key bypassed the choke point.** `stripPoolPasswordFields`
   removed the NESTED `accessControl.password` and the top-level `gridPassword`,
   but not a key literally named `"accessControl.password"`. The create handlers
   SPREAD the parsed payload into the pool document with `set()`, and `set()`
   treats an object key as a literal field name — dots and all. So
   `createPool({"accessControl.password": "secret"})` wrote the plaintext onto
   the world-readable document as a top-level field with a dot in its name,
   straight past the choke point this phase is built on.

   It is worse than a curiosity for two reasons. It is the exact form the old
   bracket dashboard used (`updateDoc(ref, {'accessControl.password': …})`), so
   it is the first thing anyone reading that code would try. And
   `legacyPlaintextOf` did not recognise it either, so the migration would have
   walked past such a pool and left the plaintext there permanently.

   Fix, three layers: the transform deletes the dotted key (stops new ones);
   `legacyPlaintextOf` reads it, ranked below the two normal shapes (so an
   existing one still verifies and IS counted by the planner); and the migration
   deletes it through a `FieldPath` — an `update()` object key with a dot is
   parsed as a PATH into the nested map and would miss the field entirely, which
   is why `scrubPatch` cannot do this one and it gets its own call and its own
   `dottedFieldsRemoved` counter. Four new assertions.

   NOTE ON REACH: no shipped client has ever sent that key, so a pool carrying
   one could only come from a hand-crafted callable payload. The fix is still
   worth its size — the choke point's whole claim is that no wizard, present or
   future, can persist a password, and a claim with a documented hole in it is
   the thing §2c exists to catch.

   Codex's run also emitted `vitest --runInBand` and a vite `EPERM` from its own
   sandbox. Environment noise, not findings.

## Round 4

VERDICT: REVISE. 3 findings (1 P1, 2 P2), ALL ACCEPTED:

1. **(P1) The secret and its marker were written sequentially.**
   `writePoolSecret` wrote the private hash, then updated the public document,
   with a comment of mine claiming a partial failure was "no worse than before".
   It was not. On a pool with no legacy plaintext, the private hash landing while
   `hasPoolPassword` stayed false leaves a pool that HAS a password and renders
   UNGATED — the squares route decides from the marker alone. Fixed with a
   `WriteBatch`: hash, legacy scrub and marker commit together or not at all.
   Pinned by a test that also refuses any un-batched write inside that function.

   Worth naming the pattern: this is the SECOND finding in this phase where a
   comment of mine asserted a safety property instead of establishing one
   (round 2 was the other). Both were in the fail-OPEN direction.

2. **(P2) `joinBracketPool` bypassed the new throttle.** It requires auth — but
   "authenticated" is a free account, so it was the same unbounded online
   guessing oracle as the public gate, against the same private secret, with a
   PBKDF2 derivation per guess (a CPU amplifier as well). Moving the hash off
   the public document buys nothing if either endpoint grades unlimited guesses.
   The throttle moved into `lib/poolAttempts.ts` and BOTH endpoints now charge
   and refund through it; a test asserts both files do.

3. **(P2) The disarmed migration path wrote no audit row.** The module header
   promises an `admin_audit` row on every run, and the arming checklist's step 1
   is deliberately a DISARMED call whose whole purpose is to watch the gate
   refuse — evidence that lives only in a returned object nobody kept is not
   evidence. Row now written before the early return. Pinned by a test.

## Round 5

VERDICT: REVISE. 2 findings (both P1), BOTH ACCEPTED. Both are in
`firestore.rules`, i.e. in the guard written to close round 3's finding — the
rounds-2+-find-defects-in-the-fixes pattern §2c predicts, twice over.

1. **(P1) The predicate allowed CLEARING a legacy password.** It refused only a
   NON-EMPTY value, on the reasoning that a full-object wizard save legitimately
   carries `gridPassword: ''`. But for a pre-migration pool, that plaintext is
   the ONLY thing that makes `PoolRoute` render the gate — so an owner
   submitting `''` deleted the gate and opened the pool. I wrote
   "empty-is-not-a-clear" into four other layers and then encoded the opposite
   here. Fixed: the test is now EQUALITY, with absent/`null`/`''` treated as one
   value. Setting, changing and clearing are all denied; a same-value carry-through
   still passes, which is what keeps ordinary settings saves working. Six new
   emulator assertions, including the one that proves a sibling edit to
   `accessControl` still succeeds when the password rides along unchanged.

2. **(P1) The rules missed the literal dotted field.** Same bypass class as
   round 3, one layer over. `updateDoc(ref, {'accessControl.password': v})` is
   parsed by the SDK into the nested path and was caught; but
   `updateDoc(ref, new FieldPath('accessControl.password'), v)` writes a genuine
   TOP-LEVEL field whose name contains a dot, `affectedKeys()` reports that
   literal key, and no clause looked at it. Denied explicitly now, and proved in
   the emulator for both the owner and a super-admin.

   Fixing this class at the schema (r3) and not at the rules (r5) is precisely
   the "guard that looks like it guards" shape — the create path was closed while
   the direct-write path stayed open, and the two are alternatives, not layers.

## Round 6

VERDICT: REVISE. 3 findings (all P1), ALL ACCEPTED. All three are the same
structural mistake wearing three hats, and it is worth naming.

Rounds 3 and 5 closed the dotted-field bypass on the create schema and on the
rules. The fix for the *runtime* half (r3) was an OPT-IN second helper —
`scrubDottedLegacyField()` — that only the migration called. So the codebase had
TWO scrub shapes, one complete and one partial, and three of the four writers
used the partial one:

1. **(P1) `publishBracketPool` left the literal dotted plaintext public.**
   `publishPasswordPlan` would ADOPT it (r2's fix) and hash it into the private
   doc — then publish the pool with the plaintext still readable.
2. **(P1) `writePoolSecret` left it too**, so every password change and every
   legacy rehash carried the leak forward.
3. **(P1) The migration repeated r4's non-atomicity.** It committed the private
   hash and the public scrub as two writes; a failure between them leaves a pool
   that HAS a password and renders UNGATED. Exactly the defect r4 found in
   `writePoolSecret`, in the code right next to it.

Fix: ONE shape. `scrubPatch()` and `scrubDottedLegacyField()` are deleted and
replaced by `scrubUpdateArgs()`, which returns a single `update()` VARARGS
argument list — the only form that can express both targets, because a
`FieldPath` cannot be an object key and a string key with a dot is always parsed
as a path. All three writers use it, the migration now commits in one batch, and
a test asserts that no file resurrects either old name.

The lesson recorded, because it generalises: **a partial fix that most callers
apply is worse than no fix, because it reads as complete.** The right response
to r3 was to make the complete scrub the ONLY scrub, not to add a second helper
beside it.

Also added the assertion the whole saga should have started from: an emulator
test that mints a literal dotted field with `setDoc`, then proves one
`update()` removes BOTH it and the nested one without the two targets
colliding. That behaviour had been reasoned about across four rounds and never
measured.
