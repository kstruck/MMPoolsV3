# ADR 0007: `coManagers` is server-owned; co-commissioners are an NFL-only, per-pool grant

Date: 2026-08-15
Status: Accepted (PLAN-CO-COMMISSIONERS §6 signed 2026-08-15)

## Context

`pools/{id}.coManagers` existed as a field before it meant anything: functions
read it in five ad-hoc shapes, rules never did, the client never wrote it, and
until 2026-08-15 any pool owner could write it directly. That is an
authorization input under the control of the party it authorizes — the same
class of gap #432 closed for `participantIds`.

Kevin asked for co-commissioners: a member the owner names to share the
day-to-day running of an NFL pool.

## Decision

- **Reuse `coManagers` (array of uids), do not invent a second field** — but make
  it **server-owned**: `firestore.rules` `protectedFieldsUnchanged()` refuses
  every client write to `coManagers` and `coManagersRevision`, and the ONLY
  writer is the `setPoolCoCommissioner` callable (strict owner or SUPER_ADMIN,
  one uid per call, in a transaction, `assertNotBannedLive`, target must hold a
  canonical Member Record, cap 3, pool audit event).
- **Revision fence.** `add` presents the `coManagersRevision` the caller saw
  (absent = 0) and fails if it moved; `remove` presents nothing and always wins,
  so a stale tab cannot re-add what a concurrent remove took out.
- **ONE definition per layer, and they agree:** rules `isNFLCoManagerOf(pool)`
  (type-guarded to `NFL_PICKEM`/`NFL_SURVIVOR`/`NFL_MARGIN`); functions
  `isPoolCommissioner(pool, uid)`; client `isNFLPoolCommissioner(user, pool)`.
  Owner-only actions (cancel/close/delete, billing, naming co-commissioners) are
  gated on helpers that say *owner* by name (`assertPoolOwnerOrManagerNoCo`;
  on the client the strict `isPoolManager`, which admits SUPER_ADMIN exactly as
  the callable does and never reads `coManagers`), never on "the helper that happens not to know about
  `coManagers`".
- **Deploy order was the control:** functions went blind to the field first
  (#444), the rules lock landed and every legacy array was audited and cleared
  to zero, and only then did the readers return (#446) and the UI ship. No
  client read was revoked at any step.
- **Client:** the widened predicate is applied ONLY where `PoolRoute` computes
  `isManager` for the three NFL dashboards and where the Commissioner Hub
  decides what to list; `isPoolOwner` / `isPoolManager` / `canManageEntries`
  stay strict because Bracket, Playoff and Squares surfaces read them.
- **The Hub feed has a composite index** (`coManagers` CONTAINS + `type` ASC in
  `firestore.indexes.json`) — Firestore can merge single-field indexes for this
  shape, but the docs recommend the index for `array-contains` + other clauses
  and this repo has twice shipped a query whose index was silently missing.
- **The Hub query shape is load-bearing:** a Firestore LIST rule is proved from
  the query, so `where('coManagers','array-contains',uid)` alone is denied; the
  client also pins `where('type','in', <the three NFL types>)`.

## Consequences

- A co-commissioner can edit settings, lock, extend a deadline, proxy-pick,
  score a week, send invites/reminders, mark members paid, record payouts and
  see pre-lock pick counts. They cannot cancel/close/delete, touch billing, read
  Squares PII, or name other co-commissioners. Non-NFL formats are unchanged.
- Every membership-removal path `arrayRemove`s the uid from `coManagers`, so a
  departed member never keeps the callables.
- The Squares/Bracket/Props manager gates were deliberately NOT swapped to the
  widened helper (PLAN-CO-COMMISSIONERS D3, C13).
