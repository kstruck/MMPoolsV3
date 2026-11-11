# PLAN — how to charge for a squares pool (K10)

> **STATUS: RESEARCH + RECOMMENDATION. Nothing here is built or changed.**
> Kevin, 2026-11-11: *"For the pricing tiers, research and determine best
> options."* This answers that. Any change it recommends touches **money**, so
> it goes through the plan gate (`mmp-change-control` §1) before it is built.
>
> Code facts below were read on `origin/main` at `980efc94`. Production
> config values (`settings/billing_config`) **could not be read from here** —
> where this says "the default", it means the default in code, and the live
> numbers may differ. **UNVERIFIED** is marked where it matters.

## 1. What a squares pool costs today, and why nobody ever pays it

**The price list (code default, `SuperAdminBillingPanel.tsx`, `PricingPage.tsx`):**

| Expected players | Squares | (NFL season, for comparison) |
|---|---|---|
| 1–10 | free | free |
| 11–25 | $9 | $29 |
| 26–50 | $19 | $59 |
| 51–100 | $29 | $99 |
| 101+ | $39 | $149 |

**How it is applied.** At launch the commissioner types "Expected number of
players". At or under `freePlayerThreshold` (10) the pool launches `free`;
above it, `trial` (`computeLaunchMode`, `functions/src/poolOps.ts:232`). A
trial pool is moved to `grace_period` after `trialDays` (default 14) and to
`locked` after `gracePeriodDays` more (default 7) by the billing job
(`functions/src/billing.ts:127-195`). The only thing `locked` stops in a
squares pool is reserving squares (`checkBillingAccess`,
`functions/src/squares.ts:64` on `main`).

**Three holes, any one of which makes the price optional:**

1. **The trial outlives the pool.** A squares pool is one game. Created a
   week before Thanksgiving, it is scored and finished on day 7–8; it would
   not be locked until day 21. Nothing in between asks for payment. *(With
   the code defaults — UNVERIFIED that production uses 14 + 7.)*
2. **The free limit is not enforced on squares.** Every other pool type
   refuses the 11th participant on a free pool; `reserveSquare` does
   not, and neither does `reserveSquares`, the batch call #758 adds (plan K2, backlog S3). A commissioner who enters
   "10" launches free and can sell all 100 squares to 100 people.
3. **"Players" is a guess, and the wrong unit.** The number priced is what
   the commissioner typed, not what happened. And a grid is always 100
   squares — 10 people buying 10 each and 100 people buying one each are the
   same product and the same cost to host.

So today squares is **effectively free**, whatever the tiers say. That is not
a bug anyone has hit — creation has been closed since 2026-08-28 — but it is
what reopens on Thanksgiving.

## 2. What other sites charge (searched 2026-11-11)

Vendor pages, not dated; treat as indicative.

| Site | Squares pricing |
|---|---|
| [SimplySportsWare](https://www.simplysportsware.com/football-pool-squares) | Free to host |
| [PrintYourBrackets](https://www.printyourbrackets.com/) | Free, ad-supported |
| [EasyOfficePools](https://www.easyofficepools.com/football-squares/) | Free up to 4 entries; then **$5 per game** ($20 for 4–70 games) |
| [MySurvivorPool](https://mysurvivorpool.com/) | Free up to 10 entries; **$9 per game** for squares |
| [Premier Sports Pools](https://premiersportspools.com/signup-squares) | **$10 per pool** |
| [Play Squares](https://www.playsquaresgame.com/) | **$12.99 one game**; $29.99 for 30 days unlimited |
| [Sunday Squares](https://sundaysquares.com/) | **$4.99 per game** (credit), cheaper in bundles |
| Splash Sports (owns RunYourPool / OfficeFootballPool) | **$9.95–$24.95 per grid** depending on sport ([NCAAB](https://intercom.help/splashsports-helpcenter/en/articles/13747367-ncaab-entertainment-only-squares-grid-pricing-2026), [bowls](https://sm.app.splashsports.com/college-bowl-squares-pools.cfm)) |

**The pattern:** the market charges **per grid (per game)**, flat, roughly
**$5–$13**, usually with a small free tier, and sells **multi-game bundles**.
Nobody found prices squares by headcount. Our $9 entry tier is in the right
range; the size ladder above it is not how this product is sold.

## 3. Options

| | Option | What the commissioner pays | What has to be built | Fits the market? |
|---|---|---|---|---|
| **A** | **Leave it effectively free** (today) | Nothing | Nothing | Yes — SimplySportsWare, PrintYourBrackets do this |
| **B** | **Flat per grid, free up to 10 buyers, paid before the 11th** | $9.99 per grid; bundle of 3 for $19.99 | Enforcement (see §4). Price change is **config only** | Yes — matches MySurvivorPool / Splash |
| **C** | Keep the size tiers, enforce them on buyers | $9 / $19 / $29 / $39 by distinct buyers | Same enforcement as B, plus a paid ceiling per tier | No — nobody sells squares by size |
| **D** | Pay before the grid locks, whatever its size | $9.99 per grid, every grid | Lock refuses an unpaid grid | Partly — removes the free tier entirely |

## 4. Recommendation

**For Thanksgiving (now): Option A, said honestly — no code change.**
Squares launches free in practice anyway. Your own Thanksgiving pools are
unaffected either way. What to do is make sure nobody is *told* something
false: the launch step already hides the "player 11 cannot join" notice for
squares (`LaunchStep.tsx:270-277`). One check before reopening, unchanged from
plan K10: open **Super-Admin → Monetization** and confirm `squares` has tiers,
so a commissioner who types 11+ can launch rather than see "Unable to price
this pool format" (`quoteEngine.ts` throws `PRICING_NOT_CONFIGURED`).

**After Thanksgiving: Option B.**

- **Price — config only, nothing deploys.** In Super-Admin → Monetization set
  the squares tiers to ONE band: `{ min: 11, max: 9999, price: 9.99 }`. The
  schema accepts a single band and decimal prices (`billingConfig.ts`
  `pricingTierSchema`, `pricingTiersSchema`). Add a `CREDIT_BUNDLE` package
  (`packagesList`): 3 squares pools for $19.99 — the Thanksgiving triple-header
  and NFL playoff weekends are the obvious buyers.
- **Enforcement — code, plan-gated (money + authorization).** Count **distinct
  buyers** (account or guest identity — the same identity `reserveSquares`
  uses for the per-player cap once #758 is merged, plan D2) and refuse the 11th buyer on a
  free/trial pool with the shared `FREE_PLAN_FULL_MESSAGE`, exactly as the
  other four pool types do. Once paid, no ceiling: a grid cannot exceed 100
  squares. This closes holes 1 and 2 together without touching the billing
  job, and it is the fix plan K2 / backlog S3 describe.
- **Why not C:** it keeps the guess (hole 3) and charges a 100-person office
  grid four times what a 12-person family grid pays for the same hosting.
- **Why not D:** a free tier is what gets a first-time commissioner to try it;
  every comparable site with a paid squares product keeps one.

**Expected revenue, to size the decision:** unknown — there is no history,
because squares was free in practice and closed since August. At $9.99 a
grid, ten paying grids a playoff weekend is ~$100.

## 5. What Kevin is asked

1. **Thanksgiving: A** — launch free, no code change; confirm the squares
   tiers exist in Super-Admin → Monetization. *Recommended.*
2. **After Thanksgiving: B** — approve writing the plan and building the
   distinct-buyer limit, and setting the squares price to one $9.99 band plus
   a 3-for-$19.99 bundle. *Recommended.*

On "approve as recommended": nothing changes before Thanksgiving; after it, a
`PLAN-SQUARES-BUYER-LIMIT.md` with its review log comes first, then the PR.
