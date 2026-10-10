# PLAN — show the picks grid's Set column to members during the week

**Status:** ✅ **SIGNED. Kevin ruled 2026-08-22: OPTION A.** His words:
*"show the count to members during the week… a count names nobody and reveals
nothing about content, which is why he chose it in Q1; K1 was about not
exposing who had picked, not a count."*

**Trigger:** `MORNING-2026-08-22-FIXES.md` §4, Issue 3 / Question 1.

**Gate:** `mmp-change-control` §1 — **authorization**. It moves a reveal
boundary and it **reverses a signed ruling (K1, 2026-08-14)**, which is the
strongest reason a plan is required here rather than a strong reason it is not.

**Deploys into `functions/`.** This lands merged and **undeployed**; the deploy
commands are on the morning list.

---

## 1. What is true today — measured, not remembered

Measured 2026-08-22 against `origin/main` @ `11545872`.

### 1a. The gate

`functions/src/nflPickReveal.ts`:

```ts
if (!isParticipant || reveal.weekRevealed) {
    counts[memberUid] = weekPickCount(pool.type, entry.picks, week, weekGameIds);
}
```

**⚠️ The line number moved.** It was `:319` when K1 was written and it is `:361`
now — #501 pushed it down. Locate it by the predicate, never by the number.

`counts` is the ONE field in `PoolPicksResponse` that is not otherwise gated:
`picks` and `confidence` are assembled by allowlist from `revealedGameIds`, and
`tiebreakers` is gated on `weekRevealed`.

### 1b. What a member sees today, and when

`weekRevealed` is true only once the **whole week** is revealed. On a `PER_GAME`
Pick'em pool — the wizard default — that is **the last kickoff of the week**.

So a member sees `—` in the Set column from Tuesday morning until Sunday
evening, and a real number only after every game has started. **That is the
entire window in which the count is useful**: it stops being interesting at
exactly the moment it appears.

Kevin answered Q1 with *"the Set column is enough"* — a statement that only
holds if members can see it.

### 1c. The aggregate half already ships, ungated

`PLAN-MEMBER-PICK-PROGRESS` shipped `progress: {complete, total}`, and
`pickProgressFor`'s own header says it is *"Ungated: `getPoolPicks` returns this
identically to a participant, a commissioner and a SUPER_ADMIN."* The grid
renders it as **"12 of 16 Players In"** to everyone.

This matters for §3: the pool-wide fraction is already public, so several
inferences this plan is accused of enabling are **already available**.

---

## 2. The change

Delete the condition. `counts` is populated for every principal:

```ts
counts[memberUid] = weekPickCount(pool.type, entry.picks, week, weekGameIds);
```

**That is the whole server change.** No client change is needed: `countFor`
already renders `wk?.counts?.[row.id]` and falls back to `—` when absent, and
the grid's legend already describes the column.

The legend's sentence *"Other players' counts are shown to the pool's
commissioner at any time"* becomes false and is rewritten.

---

## 3. What a member CAN and CANNOT infer — the required analysis

### CANNOT — and none of this moves

| Withheld | Still withheld by |
|---|---|
| **Which team** somebody picked | the `allowedKeys` allowlist over `revealedGameIds` |
| **Which game** a specific unrevealed pick is for | same — `counts` is a total, not a key set |
| **Confidence values** | same allowlist |
| **Tiebreaker predictions** | `reveal.weekRevealed` |
| A **departed** member's anything | the `stillAMember` filter (D7/K8) |

**Nothing about pick CONTENT becomes member-visible.** That is the hard line and
this plan does not go near it.

### CAN — state it plainly, because this is the reversal

A member learns, **per named player, live**:

1. **How many of this week's games that player has saved a pick for** — 0, 7, 16.
2. Therefore **whether that player has started, is part-way, or is finished.**
3. By watching, **that a player is actively working** — 14 ticking to 15 — which
   is the specific thing K1's comment named as *"nobody asked for that"*.

Point 3 is the reversal, and it should not be softened. Kevin has re-answered
the question knowing it: the count carries no content, and the value of knowing
who still owes a pick — in a pool where members chase each other, not only the
commissioner — is what he weighed it against.

### The 1-of-1 edge case, which the ticket asked about specifically

> *"a count of 1-of-1 in a single-game week does leak that one player's
> participation, and whether that matters."*

**It does leak it, and it does not matter — because the aggregate already leaks
it, and shipped that way in `PLAN-MEMBER-PICK-PROGRESS`.**

The demonstration: a 2-player pool, a 1-game week. The ungated **"1 of 2 Players
In"** chip is already on screen. A member knows their own status with certainty.
Subtract. **The other player's participation is already fully determined**, with
no Set column at all. The per-player count adds nothing in exactly the scenario
where it would be most exposing.

More generally, the aggregate determines every individual whenever it is 0 of N
or N of N, in any pool of any size, on any week. This plan widens the
*resolution* of participation information from the extremes to the middle; it
does not open a door that was closed.

Two further notes on the single-game week:

- On **Survivor and Margin** *every* week is effectively a 1-of-1 week —
  `weekPickCount` returns `p[String(week)] ? 1 : 0`. So for two of the three
  types this plan discloses precisely "has picked at all", which is the question
  `weekPickCount`'s own header calls *"safe to tell the whole pool"*.
- Participation is **not** content. "Robin has made a survivor pick" says
  nothing about which team, which is the thing that would let somebody play
  against them.

### What it does NOT enable, that a reviewer might assume it does

- It does not let a member enumerate WHICH games are picked. A count of 3 on a
  16-game week names no game.
- It does not interact with confidence mode: `weekPickCount` counts keys in
  `picks`, never `confidence`.
- It does not widen who may CALL `getPoolPicks`. `assertPickReader` is
  untouched — a caller still needs a canonical Member Record.

---

## 4. What is explicitly NOT changed

- **`assertPickReader`** — admission is untouched.
- **The allowlist** — `picks`, `confidence`, `tiebreakers` unchanged.
- **The `stillAMember` filter** — a departed member stays absent from every map,
  `counts` included. That filter runs BEFORE this line and must keep doing so:
  a departed player appearing in `counts` alone would still say "this person is
  playing".
- **`firestore.rules`** — nothing. The raw entry read is already closed; this
  callable is the only door.
- **`weekPickCount` itself** — the function is unchanged. Only who receives its
  result changes.

---

## 5. Rollback

Restore the condition and redeploy `getPoolPicks`. Nothing is persisted, no
schema moves, and the client already handles an absent count by rendering `—`,
so a rollback needs no frontend deploy to be safe.

---

## 6. Evidence required before this is called done

1. A test asserting a PARTICIPANT receives `counts` for every current member
   **mid-week, before any kickoff** — the window K1 closed.
2. A test asserting the same participant still receives **no pick content** on
   that call: `picks`, `confidence` and `tiebreakers` empty or allowlist-limited.
   This is the pair that matters; the first alone would pass on a change that
   opened everything.
3. A test asserting a **departed** member is still absent from `counts` — the
   filter that runs before the changed line.
4. The legend sentence no longer claims counts are commissioner-only.

---

## 7. Open

- **K1's other half stays closed.** K1 covered the per-member count only.
  Nothing else it withheld is reopened here, and this plan is not a precedent
  for reopening it.
