# Security: `guestDeviceKey` is a bearer token stored in a public document

**Status: open, unfixed. Not preseason-blocking** — this is the Squares path,
not the NFL pilot. It should be fixed before Squares pools carry real entry
money again, which in practice means before the football season proper.

**This needs a decision from Kevin, not a drive-by fix.** The correct repair
touches the reserve path, two claim callables, and requires a data migration on
live pool documents. Doing that unsupervised, at night, on the money-adjacent
squares path, is a worse risk than the hole itself for the next few weeks.

---

## The finding

`guestDeviceKey` is a random identifier the browser generates so a guest can
reserve squares without an account. It is written **onto each square**, and
squares live in the `pools/{poolId}` document, which is **publicly readable** —
that is how the share link works.

So the key is simultaneously:

- **secret-shaped** — possessing it is treated as proof you are that guest, and
- **published** — anyone who can open the pool page can read it.

`functions/src/participant.ts:114`:

```ts
const isGuestKeyMatch = guestDeviceKey && s.guestDeviceKey === guestDeviceKey;
```

That is the entire ownership check in `claimMySquares`.

## The attack

1. Open any pool's share link. No account needed to read the pool document.
2. Read `squares[].guestDeviceKey` for squares reserved by guests.
3. Sign in as any account (registration is open).
4. Call `claimMySquares({ poolId, guestDeviceKey })` with the harvested key.

Every unclaimed guest square bearing that key is now transferred to the
attacker's `uid`.

**What limits it:** the loop skips squares where `reservedByUid` is already set
to someone else (`participant.ts:118`), so it cannot steal squares from
registered users. It takes only **guest** squares — but those are precisely the
ones with no account behind them to notice or dispute, and in a paid pool a
square is a claim on the pot.

`claimByCode` (`participant.ts:194`) has the same comparison but is **not**
vulnerable: it reaches the key via a random `claimCode` in `poolClaims`, which
is not publicly readable. The claim-code flow is fine. The bug is specific to
`claimMySquares` accepting a raw key that is published.

---

## Why a Firestore rules change does not fix it

Rules cannot project fields out of a document on read — you either get the pool
doc or you do not, and the app needs it. Hiding the field means **not storing
the secret there**, which is an application change.

## Recommended fix — store a hash, not the key

Keep the same UX. Change what is written to the document.

- On reserve, write `guestKeyHash = sha256(guestDeviceKey + serverPepper)` onto
  the square. Stop writing `guestDeviceKey`.
- `claimMySquares` receives the raw key from the device that generated it,
  hashes it server-side, compares against `guestKeyHash`.
- The pool document now publishes only the hash. Harvesting a hash is useless:
  claiming requires the preimage, which never leaves the guest's own browser.
- `claimByCode` stores the same hash in `poolClaims` and compares identically.

This closes it without a rules change, without a new collection, and without
touching the share-link read path.

**The pepper matters.** A bare `sha256(key)` is reversible by anyone who can
guess the key's generation scheme — and the scheme is in the client bundle. The
pepper must be a functions secret, not a constant in the repo.

### What makes it multi-file

1. The reserve/write path in `squares.ts` — where `guestDeviceKey` first lands
   on a square.
2. `claimMySquares` and `claimByCode` in `participant.ts`.
3. A **backfill migration** over existing pools: hash each square's stored
   `guestDeviceKey`, write `guestKeyHash`, then clear the raw field. Every
   existing guest square is exposed until this runs, so the fix is not complete
   without it.
4. Any client code reading `square.guestDeviceKey` to decide "is this mine".

Step 3 is the reason this is a planned change and not a patch: it mutates live
pool documents, which is a Kevin gate on its own.

## Alternative considered and rejected

**Delete `claimMySquares`, force everything through `claimByCode`.** One-line
change, closes the hole completely. Rejected because it breaks the ordinary
same-device path — a guest who reserves squares and then signs up on that same
browser would have to generate and type a code to reclaim squares they never
lost. That converts a security fix into a conversion-funnel regression on the
exact moment a guest becomes a user.

Worth revisiting only if the hash migration turns out to be more work than it
looks.

## Interim mitigation available today

None that is both cheap and correct. The honest options are: accept the risk
for the pilot (Squares pools are not part of it), or disable guest square
reservation on paid pools until the fix ships.

**Recommendation:** accept it through the preseason pilot, fix before the
regular season, and do the hash migration as a supervised, single-purpose PR
with the backfill run as its own step.

---

## Noted while reading, not acted on

`participant.ts:45–88` (`createClaimCode`) contains unresolved design questions
left in as comments — `"Or generate a new stable ID?"`, `"Wait, the prompt
says…"`. The code works, but it reads as unfinished, and this is the file that
holds the ownership check. Worth a cleanup pass alongside the fix so the next
reader can tell intent from indecision.
