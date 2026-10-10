# Board memo — 2026-08-16 — which of PLAN-COMMISSIONER-TRANSFER / PLAN-POOL-TYPE-ICONS / PLAN-HELP-SYSTEM to build first

> **SIMULATED ADVISORY BOARD.** Produced by the `ask-the-board` skill
> (`C:\Users\kevin\.claude\skills\ask-the-board`). Six seats plus the Chair were
> consulted independently, in parallel, each from its own advisor file and the
> shared facts block in §9. Nothing here is a statement by the real people named,
> and no quote is genuine. Kevin decides; this memo makes the tradeoff legible.
> Kevin was not available during the run — no seat's question was answered by him.

## 1. Decision

**As framed for the board:** for a solo dev with 10–20 h/week, in the 2026 NFL
season's first live weeks (the NFL auto-scorer is LIVE every 5 minutes), which of
three unsigned plans should be BUILT FIRST, which of each plan's §6
recommendation rows should be overturned, and what is the cheapest experiment
that would disprove the ordering?

**Options put to the seats:**
- **A** — TRANSFER first, then ICONS, then HELP
- **B** — ICONS first
- **C** — HELP first (or its T0–T2 skeleton first)
- **D** — build none of the three plans now: spend the hours on already-open work
  (multi-entry T3–T5, live-scorer watch) and ship only the small measured defects
  as standalone fixes outside the three plans (the two card mislabels from ICONS
  §1.3; the `createCheckoutSession` ownership gate from TRANSFER K17); re-open a
  plan on a named trigger. (D was restated as an affirmative choice after the
  Chair's pre-flight — see §9.)
- "reject the framing" was allowed.

**Reversibility:** ICONS and HELP are client-only presentational (two-way doors).
TRANSFER is an authorization + money-adjacent server change (callable, rules,
Stripe webhook path) deployed into a live scorer — reversible by redeploy, but a
defect could move a real pool's ownership / payment handles / billing wrongly
mid-season (closer to a one-way door for the affected pool).

## 2. Board verdict

| Seat | Modeled on | Lens | Verdict | Confidence |
|---|---|---|---|---|
| `theo-browne` (**raw-sources seat** — read the plan files, no router summary) | Theo Browne | Engineering skepticism / stack judgment | **D** | medium |
| `ras-mic` | Michael Shimeles | Solo shipping / throughput | **D** | medium |
| `simon-willison` | Simon Willison | Security / trust boundaries (partial scope — see §7) | **D** | medium |
| `annie-duke` | Annie Duke | Decision quality / reversibility / sunk cost | **D** | medium |
| `mark-cuban` | Mark Cuban | Product / who pays (heavily discounted — see §7) | **D** | medium |
| `sayash-kapoor` (**ballast**, convened because the five above were unanimous) | Sayash Kapoor (+Narayanan) | Capability realism / simple baselines | **D** | medium |

**Unanimous on D, 6/6, all at medium confidence — including the ballast seat and
the seat that never saw the facts block.** Per the skill's rule 5 this is a
signal, not a comfort: either the question was too easy, or the real
disagreement lies underneath. It does — see §3. The Chair's post-hoc reading
(§6) is that five of six seated advisors are dispositionally anti-build or
velocity-restricting, so a unanimous D from this room should be weighed as
**one strong vote, not six**, and read as "measure first", not "these ideas are
bad".

Raw verdict blocks (unedited) are preserved in the run's scratchpad and
summarised faithfully in §3 and §4; the Chair did not edit them.

## 3. Where the board splits (the real disagreement under the unanimous D)

Three splits, each with the single fact that would resolve it:

**Split 1 — what to build first IF a trigger fires.**
Theo, Ras Mic and Duke lean **ICONS** (the only plan that *deletes* code — three
duplicate label maps and two defect ternaries collapse into one module; lowest
six-month maintenance; two-way door). Willison, Cuban and Kapoor lean
**TRANSFER-with-K14-flipped** (it is the only plan that protects a hosting-fee
sale or closes a trust-boundary gap). *Resolving fact:* **which category of
inbound request appears first** — a hand-over the co-commissioner path cannot
satisfy (→ TRANSFER), or members mis-joining / confusing pool types beyond the
two known mislabels (→ ICONS).

**Split 2 — what to do about K18 (late Stripe webhook can activate a released
reservation after transfer).**
Willison and Duke: do **not** ship the transfer callable while K18 is open — land
the webhook stale-reservation guard first as its own reviewed money change.
Theo, Ras Mic and Kapoor: **drop T2c** from v1 and take the plan's own
alternative — refuse the transfer whenever *any* `pendingSessionId` exists,
expired or not — i.e. remove the race by construction rather than adding a
webhook/refund path for a race nobody has measured; Kapoor adds "instrument the
released-then-activated path first, build the guard only if it fires".
*Resolving fact:* **whether the released-reservation-then-`checkout.session.completed`
sequence has ever occurred in prod** (a log/`checkoutSessions` query — the T5(c)
census shape already lists stale markers).

**Split 3 — the K1 SUPER_ADMIN path.** Willison alone would ship **owner path
only** in v1 and build the SA path when an abandoned-owner case is actually
observed; every other seat left K1 standing (or out of scope). *Resolving fact:*
one abandoned-pool support case in prod.

**Not a split, but note:** whether the `createCheckoutSession` gate may ship
"outside any plan" is a repo change-control question the seats explicitly
declared out of scope. `mmp-change-control` §1 classifies it as authorization +
money → it needs its **own short plan**, not TRANSFER's. The board's D means
"decoupled from the transfer plan", not "un-planned". Verified while writing
this memo: `functions/src/stripe.ts` lines 188–193 check that the pool *exists*
and nothing else; `isPoolOwnerOrManager` does not appear in that file. The
pre-read gate is one line; TRANSFER T2 correctly says it must also be re-checked
inside both of that callable's transactions, so "one line" is the plan's own
shorthand, not a measured LOC.

## 4. The reframe

No seat rejected the framing outright, but **every seat pushed the same
reframe** and so did the Chair's pre-flight: *"which first" is a proxy for "should
any of these three claim Kevin's scarce live-season hours at all, ahead of the
half-shipped multi-entry T3–T5 and the live scorer".* Individual reframes:

- Theo: which of these plans removes anything from the codebase — and why is the
  process producing ~2000 lines of unsigned plans plus 15 paid review rounds for
  unmeasured demand while the one live-money system runs every five minutes?
  Also: "mimic Spectrum exactly in kind" is a constraint inherited from a
  different product; a right-side search panel is not obviously better than good
  tooltips for a member on a phone on game day.
- Ras Mic: what is the smallest thing a real commissioner touches this week? —
  multi-entry T3–T5, half-shipped behind a false flag.
- Willison: what can an attacker holding one commissioner's session do to a live
  pool before vs after this callable exists; is "the owner asked" a sufficient
  authorization signal to move money-routing identity to a third party who never
  agreed?
- Duke: not "which first" but "what is the honest probability of the good version
  for each" — would you write any of these three plans today if the 15 rounds
  were unspent and a live scorer had been running for a week?
- Cuban: do you know your numbers — how many commissioners pay, what one is worth
  over three seasons, and which plan, if it existed today, would make the NEXT
  commissioner pay or the current one renew?
- Kapoor: are you blocked on invention or diffusion? Multi-entry is invented and
  undiffused; each plan has already cost more reviewer rounds than its code
  would have cost users in requests — where is the cost axis on the planning
  process itself?

## 5. What to do

**Recommendation: D.** Do not open T1 of any of the three plans now. This week:

1. Ship the two ICONS §1.3 mislabels (`JoinPool.tsx:197-199` ternary that calls
   Bracket/Playoff/Props "Squares"; `ManagerDashboard.tsx:725` ternary that calls
   NFL season pools "Squares Pool") as an ordinary one-file-each fix — no
   taxonomy, no component.
2. Close the `createCheckoutSession` ownership gap (TRANSFER K17 / R11) as its
   **own** short plan-gated PR (authorization + billing), decoupled from the
   transfer callable — the same gate the TRANSFER plan's T2 specifies (pre-read +
   in-transaction re-check on both the $0 and paid paths), nothing else from
   that plan.
3. Spend the remaining hours on multi-entry T3–T5 and the live-scorer watch.
4. Start the measurement in the experiment below — it is the trigger for
   re-opening any of the three plans.

**§6 rows the board would overturn** (a row is listed when ≥2 seats overturned
it, or when one seat did with reasoning the Chair carried; single-seat
overturns are marked):

| Plan | Row | Current recommendation | Board | Who |
|---|---|---|---|---|
| TRANSFER | **K14** | Immediate hand-over (plan recommends AGAINST codex, which rated missing target consent HIGH) | **Overturn → invite → accept.** Target consent is a capability restriction (architecture, not detection); it converts a one-way door into a two-way one (a decline is a free undo); the plan overrode a HIGH reviewer finding with no new evidence; a member who receives a pool plus billing responsibility without consenting is a churn/refund event | Willison, Duke, Cuban, Kapoor (Theo, Ras Mic: out of scope) |
| TRANSFER | **K17** | Close the checkout gap inside this plan as T2 | **Keep "yes", overturn "inside this plan"** — ship it now, decoupled, as its own small plan-gated PR; a live authorization hole should not wait on 17 other rows being signed | all six seats |
| TRANSFER | **K18** | Yes — T2c webhook stale-reservation guard (a money change) in this plan | **Overturn "T2c in this plan"** — the board splits on the replacement (§3 Split 2) but no seat would ship T2c as written under an unreviewed round; the majority takes the plan's own alternative (refuse on ANY `pendingSessionId`) and instruments first | all six seats (replacement contested) |
| TRANSFER | K1 | Owner AND SUPER_ADMIN via the same callable | Overturn → owner path only in v1; SA path when an abandoned-owner case is observed | Willison only |
| ICONS | **K8** | Super-admin tables get the badge | Overturn → No in v1 — adds render sites without deleting anything | Theo, Ras Mic |
| ICONS | K10 | HowItWorks + CreatePoolSelection read the glyph map in the same PR | Overturn → No in v1 — consistency polish, not the mislabel fix | Theo only |
| ICONS | K4 | Sport tag on every card | Overturn → not before the two mislabels ship; polish | Cuban only |
| ICONS | K1 | Variation tags always visible on `sm` cards | Defer — decide only if members demonstrably confuse variants | Kapoor only |
| HELP | **K4** | v1 scope (ii): pool surfaces + wizards + account + super-admin summaries | **Overturn → smaller.** Seats disagree on the shape (Ras Mic: unified-wizard tooltips only, T0–T1; Duke: T0–T2 skeleton + ONE pool type with a pre-committed kill point; Theo: (i) not (ii) — admin content rots fastest; Cuban: only the wizard fields commissioners actually ask about; Kapoor: glossary panel + page summaries, no tooltips, and measure opens) — but five seats say (ii) is too big for a live season with "writing is the long pole" | Theo, Ras Mic, Duke, Cuban, Kapoor |
| HELP | **K12** | Legacy wizards get tooltips too | Overturn → No — delete/deprecate first (`WizardStepDetails`/`WizardStepSquaresDetails` already have no importers), then cover what survives | Theo, Ras Mic |
| HELP | K13 | Adopt `?tab=` URLs for in-memory tabs inside this plan | Overturn → scope creep; its own tiny PR if wanted | Ras Mic only |

Rows **not** overturned by any seat: TRANSFER K2–K13, K15, K16 (Willison
explicitly keeps K16 callable-only-for-everyone); ICONS K2, K3, K5–K7, K9,
K11–K13; HELP K1–K3, K5–K11.

**The cheapest experiment that would prove D wrong** (converged across seats;
costs a spreadsheet and one message, no code):

- For the next 3–4 live weeks (through regular-season kickoff 2026-09-10 and the
  first two weeks after), tag every inbound commissioner/member contact by
  category: (a) "hand my pool to someone" — and whether the co-commissioner path
  could satisfy it; (b) "what does this option/setting mean"; (c) "which pool is
  this" / wrong-pool-type join. Zero counters today; the plans measured none.
- Cuban's addition: message every current paying commissioner (Kevin knows the
  count; the plans do not) with two questions — *have you ever needed to hand a
  pool to someone else, and what did you do?* and *which setting did you have to
  guess at when creating your pool?*
- Willison's addition: run TRANSFER T5's census now, read-only (pools where
  `managerUid ≠ ownerId`; pools with no `ownerId`; stale `pendingSessionId`
  markers) — it is the plan's own pre-deploy step and it costs nothing to run
  early.
- **Triggers:** one hand-over the co-commissioner path cannot satisfy → TRANSFER
  starts (with K14 flipped and K18 resolved before the callable ships) — D was
  wrong for that plan. Counter (b) above zero → HELP T0–T2 (small shape) moves
  ahead of ICONS. Counter (c) dominates → ICONS T1–T3.

**Kill criteria Duke would pre-commit** (recorded verbatim in intent):
(1) one real hand-over ask → TRANSFER starts immediately, but only with K14
flipped to invite→accept and K18 reviewed clean first; (2) multi-entry T3–T5 not
merged by 2026-09-10 → capacity is the binding constraint and no plan opens
before it lands regardless of requests; (3) by 2026-10-01, D held with zero
logged requests in any category → **archive the three plans** rather than leave
them "pending" — a decision you keep re-encountering is one you have already
made.

## 6. Chair's recommendation (Roger Martin seat — synthesis on completed verdicts only)

*Pre-flight (before the seats ran, recorded here because it changed the option
list):* the Chair called "which first" a proxy for where-to-play with the
season's hours; noted D was framed as a "hold" rather than an affirmative choice
and asked that it get the same WWHTBT test; asked the new-CEO question (someone
with no sunk cost in 15 paid rounds would ship the measured defects, finish
multi-entry, and not open any plan until a user asks); named the missing facts
(no demand signal, no hour estimates, multi-entry/scorer absent as competing
uses of the hours, no stated "win" for the season, whether the checkout gap can
close independently); and ruled the decision **not** small-and-reversible
because TRANSFER is money-adjacent authorization into a live scorer and the
hours cannot be replayed. The router amended D accordingly (§9).

*Synthesis (verbatim structure; the Chair could not see the verdict table until
it was complete and did not edit it):*

**RECOMMENDATION** — Option D as amended: build none of the three plans now; ship
the two card mislabels and the `createCheckoutSession` ownership gate as
standalone PRs this week; spend remaining hours on multi-entry T3–T5 and scorer
watch; re-open a plan only on a named trigger.

**WHY** — Six of six seats, including the raw-sources seat that never saw the
facts block, landed on D independently — the framing did not carry it. Kapoor
and Cuban carry the core logic: the cheapest existing baseline (co-commissioners
+ editable payment handles) was never measured against the transfer ask, and
Kevin's brief is the only demand signal for all three. Duke carries the
sunk-cost point: 15 paid rounds are spent either way and the plans survive as
documents. Willison carries the one non-deferrable item: the checkout gate is a
live hole today and does not need the transfer plan. Martin's WWHTBT framing
implies D wins because its barrier — "no user will ask" — is the only condition
that costs nothing to test.

**ALTERNATIVES AND WHY NOT** —
A (TRANSFER first): requires that a hand-over need exists that co-commissioners
cannot satisfy AND that K18 is closed AND that immediate hand-over without
target consent is safe. All three fail on the record: no request count, review
stopped with K18 open, four seats overturn K14 toward invite→accept.
B (ICONS first): requires that members measurably confuse pool types beyond the
two known mislabels. No seat found evidence; the mislabels ship without the
taxonomy. It is the only deleting plan (Theo) and lowest-maintenance (Ras Mic),
which is why it leads the queue if a trigger fires and TRANSFER's does not.
C (HELP first): requires that "what does this option mean" is a live support
load and that Kevin has writing hours during a live season. The plan itself
says writing is the long pole; no request count exists; Duke's pre-mortem
predicts a stalled skeleton.

**CONFIDENCE** —
KNOWN: the two mislabels and the checkout gap are measured defects; multi-entry
is shipped but undiffused; TRANSFER's review ended unconverged with a money
finding open.
UNKNOWN: any demand count for any plan; whether co-commissioners actually covers
"I'm out" when billing sits on the departing owner (Cuban and Kapoor both flag
this as the fact that would flip A ahead).
INCONCLUSIVE: what to build first IF a trigger fires, and how to treat K18 —
this is the real split under the unanimous D (§3).

**WHERE I'M REASONING PAST THE EVIDENCE** — That the checkout gate is genuinely
"one line" (the plan asserts it; no seat verified it against code — the router
did afterwards, see §3: pre-read is one line, in-transaction re-checks are
more). That multi-entry T3–T5 fits within the season's hours — no hour estimates
exist anywhere. That a hand-over ask will surface through support at all rather
than silently churn.

**WHAT WOULD CHANGE THIS** — One logged commissioner hand-over that
co-commissioners cannot resolve (billing or handles stuck on the departing
owner) → A immediately, with K14 flipped to invite→accept and K18 resolved before
the callable ships. Cheapest test: Cuban's — message every paying commissioner
this week with two questions; plus Willison's T5 census now.

**POST-HOC CRITIQUE** — *Missed:* nobody asked what the plans cost to KEEP —
three unsigned documents with 18+13+13 open rows are a maintenance liability of
their own; Duke's 2026-10-01 archive criterion is the only nod. Nobody asked
whether Kevin wants to build these regardless of demand — for a solo owner,
motivation is a real input this room treats as noise. *Blind spots aligned:*
yes. Five of six seats are dispositionally anti-build or velocity-restricting,
and the Chair's own method lacks an exit primitive, so a unanimous D from this
room is expected, not informative — treat it as one strong vote, not six. The
one pro-build check was Kapoor's own caveat that Kevin's brief deserves more
weight than a benchmark skeptic gives it. Read D as "measure first", not "these
ideas are bad". *Not in the room:* anyone who has actually run a season-long
pool as a commissioner (the customer), and a Stripe/billing-ownership
practitioner who could say whether hosting-fee ownership can move at all
without a new checkout — that fact alone may decide whether TRANSFER is a
feature or a support runbook.

## 7. Seat bias (from each file's `## Blind spots`; load-bearing here)

- **The room is skewed toward D by disposition, not just evidence.** Duke's file
  says she is *systematically tilted toward quitting* (she flagged it herself
  and noted the discount applies to abandoning efforts under a year old, which
  these are not — they have not started). Theo is *contrarian by reflex* and
  frontend-centric. Kapoor's *AI Snake Oil* brand has gravity toward finding
  snake oil, and he studies deployments rather than running one. Ras Mic
  optimises for velocity and his evidence is small-N ("this worked on my apps").
  Willison optimises for capability restriction. Every one of those priors
  points at D. That is why §2 says: one strong vote.
- **Cuban is the most heavily discounted seat on the board** (survivorship,
  scale mismatch, "sales cures all" assumes an enterprise motion MMP does not
  have). His verdict was used only through the narrow transferable core his file
  allows — *be the one who talks to customers* — and his experiment (message the
  paying commissioners) is that core.
- **Willison's threat model only partly transfers**: the lethal trifecta and
  prompt-injection positions do not apply (no LLM, no untrusted content, no
  egress). Only trust-boundary / capability-restriction / attacker-moves-second /
  blast-radius reasoning was used, and the seat said so.
- **The Chair** has no probabilistic reasoning, no sunk-cost machinery and no exit
  primitive, and will frame any question as a cascade; the sunk-cost half of this
  decision was therefore carried by Duke, not the Chair. Scale risk applies: SCS
  presumes a leadership team to align — a solo operator gets the artifact
  without the alignment benefit.
- **Nobody in the room is pro-build by disposition.** Austin Marchese and Dex
  Horthy (harness/agent seats) were not routed because the question is a product
  ordering, not a harness question — but they are the two seats most likely to
  argue "the plans are the harness working as designed; build". Their absence is
  a routing choice, recorded here so it can be second-guessed.

## 8. Open vacancy

Two, both named by the Chair and neither on the roster:
1. **The customer** — someone who has run a season-long office pool as a
   commissioner. Every seat reasoned about demand from its absence; a
   commissioner would have said in one sentence whether "I can't run this
   anymore" happens and what they did about it. Not a public-figure seat; fill
   it with Cuban's experiment (ask the actual commissioners), not a simulation.
2. **Stripe / billing-ownership practitioner** — can hosting-fee "ownership" move
   between users at all without a new checkout, given the platform holds no
   Stripe customer object (TRANSFER S-f)? That fact decides whether TRANSFER is
   a feature or a support runbook, and no seat could answer it. Candidate is a
   Step-5 research task, not a name; do not seat a private individual.

## 9. Framing audit — the verbatim facts block the seats reasoned from

Which seat got raw sources: **`theo-browne`** — file paths to the three plans and
their review logs / sweeps, plus the one-paragraph context below, and NO summary.
The other five seats got the facts block as primary input and were permitted to
open the raw files to verify a claim. Theo's verdict (D) and his overturn set
(K17, K18, ICONS K8/K10, HELP K4/K12) matched or subset the summary seats', and
he independently surfaced the same three one-file fixes and the "which plan
deletes anything" observation — evidence the block did not swing the board.

Context line given to the raw-sources seat (verbatim): *"MMP = March Melee
Pools, a solo-dev sports-pool SaaS (Firebase + React/Vite/Tailwind, lucide
icons); Kevin has 10–20 h/week; house rule is one PR at a time with paid codex
review rounds + qodo + CI on each; today is 2026-08-16, the NFL auto-scorer is
LIVE in production every 5 minutes and this is the first live NFL season; every
functions deploy goes into that live scorer; multi-entry T3–T5 (member UI +
scoring for extra entries) is still open work. All three plans are unsigned; no
code exists."*

The facts block, verbatim as amended after the Chair's pre-flight (the
amendment is the D bullet and the parenthetical after it):

```
# SHARED FACTS BLOCK — board run 2026-08-16 (transfer / icons / help ordering)

## The decision (one sentence)
For a solo dev with 10–20 h/week, in the 2026 NFL season's first live weeks (the NFL auto-scorer is LIVE in production), which of three unsigned PLAN-*.md documents should be BUILT FIRST — PLAN-COMMISSIONER-TRANSFER, PLAN-POOL-TYPE-ICONS, or PLAN-HELP-SYSTEM — which of each plan's §6 recommendations should be overturned, and what is the cheapest experiment that would disprove the chosen ordering?

## Options (pick one ordering, or reject the framing)
- A: TRANSFER first, then ICONS, then HELP
- B: ICONS first, then TRANSFER, then HELP
- C: HELP first (or HELP T0–T2 skeleton first), then the others
- D: Build none of the three plans now — spend the hours on the already-open work (multi-entry T3–T5, live-scorer watch) and ship ONLY the small measured defects as one-file fixes outside any plan (the two card mislabels from the ICONS plan §1.3; the createCheckoutSession ownership gate from the TRANSFER plan K17 — the plan itself calls that gate "one line" and it can be closed independently of a transfer callable); revisit the three plans when a user asks
- (Amended after Chair pre-flight: D restated as an affirmative choice, not a "hold". No hour estimates per plan or per ticket exist in any of the three documents — do not invent them; reason from ticket counts and classification.)
- "reject the framing" is a legitimate verdict — say what the real decision is

Reversibility: all three are code changes behind normal PR gates. ICONS and HELP are client-only presentational (two-way door). TRANSFER is an authorization + money-adjacent server change (callable + firestore.rules + Stripe webhook path) deployed into a live scorer — reversible by redeploy, but a defect could move a real pool's ownership/payment handles/billing wrongly during a live season (closer to a one-way door for the affected pool). What breaks if wrong: TRANSFER — a pool's commissioner capability or payment routing goes to the wrong person mid-season; ICONS — visual only; HELP — copy drift/wrong explanations, wasted hours.

## Context the advisors must have (all measured from repo docs; the plans were written 2026-08-16 without Kevin present)
- MMP = March Melee Pools: solo-dev seasonal sports-pool SaaS, Firebase (Firestore + Cloud Functions) + React/Vite/Tailwind, lucide icons. Revenue = commissioner hosting fees via Stripe; platform never touches participant entry money (P2P via commissioner "payment handles" like Venmo/Zelle shown on the pool).
- Kevin's capacity: 10–20 h/week outside a day job. House rule since 2026-07-21: ONE PR at a time; each PR goes through codex review rounds (paid) + qodo + CI. Every functions deploy right now goes into a LIVE NFL scorer (nflAutoScoreJob runs every 5 min in prod). This is the FIRST live NFL season for the NFL pool types (Pick'em / Survivor / Margin). Hall of Fame game was 2026-08-06; first full preseason slate 2026-08-13; regular season kicks off ~2026-09-10.
- Recent shipped work (all merged + deployed): co-commissioners (#446/#447), multi-entry T1/T2 (#449/#450), empty-submission fee fix (#445). Multi-entry T3–T5 (scoring/standings/member UI for entry #2) are still pending; the wizard flag for multi-entry stays false until they land.
- All three plans are UNSIGNED: every §6 row is a recommendation Kevin has not answered. No code exists for any of them.

## Plan 1 — PLAN-COMMISSIONER-TRANSFER (classification: AUTHORIZATION → plan-gated; money-adjacent)
- Ask (Kevin verbatim): the pool OWNER (not a co-commissioner) transfers commissioner status to another member when they can no longer manage the pool, with an explicit confirmation spelling out ramifications (owner control, billing/Stripe hosting-fee ownership, co-commissioner grants, audit trail).
- Key measured facts: every create path writes createdByUid = ownerId = managerUid (same uid). managerUid is a co-equal principal in 18 rules sites; createdByUid still OUTRANKS ownerId in 4 functions sites + 1 client site. The pool doc carries the commissioner's contactEmail/managerName/paymentHandles — if not rewritten, members keep paying the OLD owner. Nothing records a transfer today (no such op exists). Adjacent gap found: createCheckoutSession lets ANY signed-in user start a hosting checkout for any pool (no ownership check).
- Design: one callable transferPoolOwnership({poolId,newOwnerUid,confirmName}) in one Firestore transaction; moves ownerId+managerUid; rewrites contact identity + payment handles; filters coManagers; writes managedPools/participations indexes, pool audit, both users' Activity Logs, admin_audit if SUPER_ADMIN; post-commit aggregate recompute + 2 emails; rules gain ownershipFieldsUnchanged() outside the SA disjunction (no client, SA included, may write ownership fields); UI = danger-zone modal in NFLManagerView with R1–R8 checklist + typed pool name, server-checked.
- Tickets: T1 callable + emulator tests (~25 cases incl. race), T2 fix createdByUid-first sites + close createCheckoutSession gate (both transactions) + T2c webhook stale-reservation guard (money change), T3 rules + rules tests, T4 UI, T5 prod census (3 counts; Admin-SDK backfill if any pool lacks ownerId), T6 docs/ADR. Two stacked PRs (server+rules+census; client+docs). Deploy: census → functions → rules → Coolify — into the live scorer (T2 touches nflPools.ts assertNFLPickMembership and reminder targeting).
- Review status: 6 codex rounds (the cap), ALL REVISE (10→9→7→4→1→1); STOPPED WITH ONE FINDING OPEN (late Stripe webhook race, K18).
- §6 rows K1–K18 (recommendation in brackets): K1 who may transfer [owner AND SUPER_ADMIN via same callable]; K2 legacy managerUid≠ownerId [only ownerId may transfer; legacy manager dropped]; K3 eligible target [any canonical member, not BANNED, not caller]; K4 old owner afterwards [ordinary member; existing co-comms kept]; K5 rewrite contactEmail/managerName/paymentHandles [yes]; K6 billing [refuse while a LIVE checkout open; ALLOW a second active free-tier pool for the target]; K7 Member Record role/dues [unchanged — dues do not move]; K8 reversibility [no undo, transfer-back allowed, no cooling-off]; K9 audit rows [yes]; K10 emails [both owners only]; K11 confirmation [checklist R1–R8 + typed pool name, server-verified]; K12 statuses [refuse CANCELED/archived/closedVia; allow everything else incl. COMPLETED]; K13 UI scope [NFL only in v1]; K14 immediate hand-over vs invite→accept [IMMEDIATE — the plan explicitly recommends AGAINST codex, which rated missing target consent HIGH]; K15 ADR 0008 [yes]; K16 rules ownership fields callable-only for everyone incl. SA client [yes]; K17 close createCheckoutSession gap inside this plan [yes, T2]; K18 OPEN — webhook path should also refuse to activate on a released reservation (no-op + Sentry + manual refund) [yes, T2c — a money change to the webhook path].
- Plan's own alternatives rejected in D9: managerUid promotion; co-commissioner + step back; SA-only Operations action; invite→accept handshake (deferred to K14).

## Plan 2 — PLAN-POOL-TYPE-ICONS (classification: ORDINARY — no money/auth/data/scoring)
- Ask (Kevin verbatim): a distinct icon for every sport, every pool type, every variation (Pick'em ATS/straight-up/confidence; Survivor pick-losers; etc.); on every card in the pool list AND on the Pool home; plan the taxonomy + component first.
- Measured: 7 pool types (closed enum). Variation fields: Pick'em pickMode×confidenceMode (2×2), Survivor pickLosersMode, Bracket tournamentType+gender, Squares league; Margin/Playoff/Props have NO play-variation field. lucide 0.556 has no sport glyphs (no football/basketball) → sport is a text Tag; variations are 2–4 letter tags composed onto the type glyph. Today: 3 duplicate label maps, 2 of which are DEFECTS (JoinPool ternary calls Bracket/Playoff/Props "Squares"; ManagerDashboard calls NFL season pools "Squares Pool"); Bracket and Playoff share the Trophy glyph in 3 places.
- Design: pure module derivePoolTypeMeta() + one component PoolTypeIcon (glyph|badge|full variants, sm|md|lg); 8 card/list sites + 5 pool-home headers + 2 marketing/create pages; ~10 pure vitest tests incl. a call-site grep guard (no DOM test env exists). No server, no schema.
- Tickets: T1 meta module + tests, T2 component, T3 cards, T4 headers, T5 marketing sites + docs. Two PRs. Coolify only.
- Review status: 4 codex rounds (cap), 19 findings, 16 absorbed, 2 rejected with evidence, 1→K13; round 4 REVISE with 2 small absorptions unreviewed; not CONVERGED.
- §6 rows K1–K13 [rec]: K1 variation tags always visible on sm cards [always visible]; K2 tag the default variation? [non-default only]; K3 tag vs glyph swap [tag]; K4 sport tag on every card [every card]; K5 colour per sport [monochrome v1]; K6 Squares seasonType/numberSets tags [no]; K7 Bracket womens 'W' tag [yes]; K8 super-admin tables get badge [yes, showSport=false]; K9 Test Suite labels collapse [no]; K10 HowItWorks + CreatePoolSelection read the glyph map in same PR [yes]; K11 payout mode as tag [no]; K12 pool-home size lg inline vs 40px tile [lg inline]; K13 Bracket scoringSystem as tag [no].

## Plan 3 — PLAN-HELP-SYSTEM (classification: ORDINARY, LARGE)
- Ask (Kevin verbatim): port spectrum-price-intel's tooltip + right-side "Dashboard Help" panel: tooltips for EVERY option in EVERY pool type (wizard steps, manager settings, member controls) + a panel opened by '?' shortcut and a button, with search, page summary, "On this page" anchors, expandable sections, Key Concepts & Glossary, "All pages" list; content authored per page and per pool type; CONTEXT.md is the glossary source of truth; ONE content source feeds both.
- Measured: ~150 wizard/settings options × (short+long copy) + ~110 pages × summary + glossary. Six existing Escape-key listeners; ~35 overlay shells without role="dialog"; several dashboards keep tab identity in memory (no ?tab= URL). No existing tooltip infra to build on. No new dependency planned.
- Design: typed help registry (topics with short/long copy bound to setting paths, pages, glossary mirror of CONTEXT.md + invariant test), HelpTip component, HelpPanel + provider + '?' shortcut, coverage-guard tests with an allowlist so CI is green from day one, per-pool-type content tickets.
- Tickets: T0 voice guide + types + empty registry + allowlist; T1 HelpTip + FieldLabel + wire every unified-wizard field; T2 panel shell + ?tab= adoption + search + deep link; T3 site pages content; T4 NFL manager settings; T5 Squares manager + legacy wizards; T6 Bracket/Props/Playoff managers; T7 every remaining interactive surface; T8 rules pages read registry; T9–T13 CONTENT per pool type (the bulk — "writing is the long pole, not code"); T14 super-admin summaries + PR template line; T15 deploy + smoke; T16 overlay-stack a11y migration (35 files). Sequencing T0→T1→T2 strictly. 17 tickets, each its own PR.
- Review status: 5 codex rounds (cap), 34 findings, all absorbed, 0 rejected; round-5 fixes unreviewed; "cap reached, all findings resolved, not APPROVED".
- §6 rows K1–K13 [rec]: K1 glossary sync build-time import vs hand-mirrored + invariant test [hand-mirrored (b)]; K2 tooltip trigger [hover/focus = tooltip, click/tap = panel]; K3 '?' button location [Header, not FAB]; K4 v1 page scope [(ii) pool surfaces + wizards + account + super-admin page-level summaries]; K5 All-pages filtering [filter to current pool type inside a pool]; K6 panel title ["Help"]; K7 persist open state [no]; K8 copy voice [second person plain; docs/help-voice.md]; K9 one registry with audience[] vs two [one]; K10 rules pages read registry in v1 [yes, "what is it" sentence]; K11 deep link ?help= [yes]; K12 legacy wizards get tooltips [yes; delete two dead steps]; K13 adopt ?tab= URLs for in-memory tabs [yes for pool surfaces; super-admin unlinked].

## What no plan measured (state plainly if it drives your verdict)
- No usage data on how often a commissioner actually needs to hand a pool over mid-season, nor how many support requests ask "what does this option mean", nor whether members confuse pool types on cards. None of the three plans cites a user request count. Kevin's briefs are the only demand signal.
```

**Router-side correction found after the run:** Kapoor's "co-commissioners +
editable payment handles" baseline holds for the three **NFL** types only
(CONTEXT.md §Co-Commissioner: NFL Pick'em/Survivor/Margin; can edit settings;
cannot touch Billing; non-NFL formats have no Co-Commissioners). Squares /
Bracket / Playoff / Props have no such baseline. The facts block did not say
this; it weakens D slightly for non-NFL pools and does not change any verdict's
stated reasoning, since TRANSFER K13 scopes v1 UI to NFL anyway.

## 10. Track record

No prior board memo covers a related decision (this is the first memo written for
this repo; the skill's `board-memos/` folder did not exist before this run). When
Kevin reports back — a hand-over request, a "what does this mean" email, a
mis-join, or nothing by 2026-10-01 — append the outcome here.

---

> *Simulated advisory board. Positions are inferred from each advisor's published work and are not statements by the real people named. No quotes are genuine. Source material for each seat is listed in `board/<slug>.md`. This is decision support, not approval or authority.*
