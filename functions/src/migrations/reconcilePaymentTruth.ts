// PLAN-PAYMENT-TRUTH P2 (Q5, Kevin 2026-07-26): the one-off reconciliation for
// pools whose two payment stores already disagree. D13's fix (P1) is
// FORWARD-only and the D25 backfill SKIPS members already present — so a member
// who had a Member Record and was then marked paid through the pre-P1 Bento
// panel (which wrote only the display-legacy entry doc) stays wrong after both:
// PAID on the entry, UNPAID on the record, and their dues permanently missing
// from the pot. Nothing else repairs them; this does.
//
// Direction rules, and why they differ per case:
//   entry PAID + member UNPAID  → PROMOTE the member (+ append the missing
//     payments-ledger row). The Member Record is normally authoritative, but for
//     exactly this population the historical write went to the entry BECAUSE
//     setPaidStatus was unusable (it throws on missing/legacy rosters, and the
//     Bento only offered the entry path) — the entry carries the commissioner's
//     real action. This is the direction the plan names (§4).
//   member PAID + entry UNPAID  → MIRROR the entry (display only, NO ledger
//     row: the truth store is already right, the display projection is what
//     never got written pre-P1). This is what makes the Bento table stop
//     showing UNPAID for members the roster — and the pot — already count.
//   Net effect: paid-on-either-store converges to paid-on-both, which is the
//   same invariant P1 now maintains transactionally going forward.
//
// Scope: NFL SEASON pools only (PICKEM / SURVIVOR / MARGIN) — the types whose
// payment truth is the Member Record. BRACKET/PLAYOFFS/SQUARES/PROPS store
// payment on the entry/card itself (calculatePoolPot reads it there), so there
// is no second store to reconcile. Sim pools and hand-flagged isTestPool pools
// are skipped unconditionally, same contract as backfillMemberRecords.
//
// Dry-run by default AT THE SCHEMA LAYER (house Rule 1, the #183 lesson). The
// dry run IS the divergence count (Q5) and also lists the planned fixes
// (capped) so the operator can eyeball WHO before going live. Idempotent — a
// second live run finds nothing to do. Restart-safe: an aborted run can simply
// be re-run from page 1, every fix it already made reads back as consistent.
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { recomputeRosterSummary } from "../lib/rosterSummary";
import { recomputeCommissionerAggregate, ownerOf } from "../lib/commissionerAggregate";
import { isSimPool, isExplicitlyMarkedTestPool } from "../shared/testPool";
import { validated } from "../lib/validated";
import { reconcilePaymentTruthSchema } from "../schemas/migrations";
import { readPoolDues, writePoolDues, DUES_PREFIX, DUES_PREFIX_END, type PaidEntryMap } from "../lib/poolDues";
import { entryHasPick } from "../lib/multiEntry";
import { derivePaidStatus, isPaidRow, liableEntryIds, type MemberRecord } from "../shared/memberRecord";

/** The pool types whose authoritative payment store is the Member Record. */
const NFL_SEASON_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

/** Cap on the per-fix detail list — the Run Log renders a truncated JSON string,
 *  so an unbounded list would push the counters out of view, and the counters
 *  are the evidence. 50 covers the realistic divergence population several
 *  times over (the whole platform has ~150 member records). */
const PLANNED_FIX_CAP = 50;

export const reconcilePaymentTruth = validated(
    {
      schema: reconcilePaymentTruthSchema,
      label: "reconcilePaymentTruth",
      role: "SUPER_ADMIN",
      appCheck: "monitor",
      // Same batch-migration budget as backfillMemberRecords: per pool this does
      // two subcollection reads plus a handful of writes and a roster recompute,
      // serial. The v2 default 60s is not survivable on a populated page.
      options: { timeoutSeconds: 300, memory: "512MiB" },
    },
    async (input, request) => {
  if (!request.auth || request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError("permission-denied", "Super Admin only.");
  }
  const dryRun = input.dryRun; // default TRUE at the schema layer
  const limit = Math.min(input.limit ?? 25, 100);
  const startAfter: string | undefined = input.startAfter;
  const actorUid = request.auth.uid;

  const db = admin.firestore();
  let q = db.collection('pools').orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
  if (startAfter) q = q.startAfter(startAfter);
  const snap = await q.get();

  // KEY ORDER IS LOAD-BEARING (same contract as the backfill report): the Run
  // Log truncates, so the counters an operator must read come first and the
  // capped detail list comes last.
  const report = {
    ok: true,
    dryRun,
    poolsScanned: 0,
    /** entry PAID + member UNPAID → member promoted + ledger row appended. */
    membersPromoted: 0,
    /** member PAID + entry UNPAID → entry display mirrored. No ledger row. */
    entriesMirrored: 0,
    alreadyConsistent: 0,
    /** entry says PAID but NO Member Record exists. Post-backfill this should be
     *  ZERO — a nonzero value means the D25 backfill missed someone and must be
     *  re-run BEFORE this migration goes live. Report-only: creating records is
     *  the backfill's job, not this one's. */
    entriesPaidNoMember: 0,
    /** entry PAID + member UNPAID, but the member HAS payments-ledger history —
     *  meaning the authoritative setPaidStatus path was used on them at some
     *  point, and the UNPAID record may be a deliberate later un-mark that the
     *  (never-updated) entry simply predates. Promoting would resurrect a
     *  reversed payment and mint a ledger event for it, so these are REPORTED
     *  (plannedFixes: AMBIGUOUS_SKIPPED) for the operator to resolve by hand,
     *  never auto-promoted (codex r4). Only members with ZERO ledger history —
     *  whose only-ever write path was the Bento entry write — are promoted. */
    ambiguousSkipped: 0,
    /** Sim-harness pools + hand-flagged isTestPool pools. Unconditional. */
    testPoolsSkipped: 0,
    /** Pools whose type keeps payment on the entry itself — nothing to reconcile. */
    otherTypeSkipped: 0,
    failures: [] as { poolId: string; error: string }[],
    nextCursor: null as string | null,
    /** Capped list of the individual fixes (planned on dry, applied on live). */
    plannedFixes: [] as { poolId: string; uid: string; fix: 'PROMOTE_MEMBER' | 'MIRROR_ENTRY' | 'AMBIGUOUS_SKIPPED' }[],
    plannedFixesTruncated: false,
  };

  const notedFix = (poolId: string, uid: string, fix: 'PROMOTE_MEMBER' | 'MIRROR_ENTRY' | 'AMBIGUOUS_SKIPPED') => {
    if (report.plannedFixes.length < PLANNED_FIX_CAP) report.plannedFixes.push({ poolId, uid, fix });
    else report.plannedFixesTruncated = true;
  };

  /** Owners whose pools changed — one commissioner-aggregate recompute each, at the end. */
  const touchedOwners = new Set<string>();

  for (const doc of snap.docs) {
    const poolId = doc.id;
    const pool: any = doc.data();

    // Unconditional, same as the backfill: no input can aim this at test data.
    if (isSimPool(pool, poolId) || isExplicitlyMarkedTestPool(pool)) {
      report.testPoolsSkipped++;
      continue;
    }
    if (!NFL_SEASON_TYPES.includes(pool.type)) {
      report.otherTypeSkipped++;
      continue;
    }
    report.poolsScanned++;

    try {
      const entryFee: number | undefined = pool.settings?.entryFee;
      const [entriesSnap, membersSnap, paymentsSnap, duesSnap] = await Promise.all([
        doc.ref.collection('entries').get(),
        doc.ref.collection('members').get(),
        doc.ref.collection('payments').get(),
        // 🛑 THE PER-ENTRY MAP, READ FOR IDEMPOTENCE (codex r6, P2).
        //
        // Before P2-T7 this migration wrote a literal `PAID`, so a second run
        // saw `entry PAID + member PAID` and counted `alreadyConsistent`. T7
        // made it write the DERIVED summary, which for a member with one of two
        // liable entries paid is correctly `UNPAID` — so run 2 sees the same
        // `entry PAID + member UNPAID` shape it started with, AND now finds the
        // ledger row run 1 appended, and files the pair as AMBIGUOUS_SKIPPED.
        //
        // That is a false ambiguity this migration manufactured itself, and it
        // would land on the operator's desk for EVERY partial payment it
        // repaired. The map is the evidence that distinguishes the two cases:
        // an entry already recorded there was reconciled by a previous run.
        //
        // The id-range bound is the same lexical-successor trick `getPoolDues`
        // uses, and for the same reason — `private/` also holds the pool's
        // PBKDF2 password record, and `dues__` + U+F8FF is NOT a safe upper
        // bound (an id above that codepoint sorts past it and is skipped).
        doc.ref.collection('private')
          .orderBy(admin.firestore.FieldPath.documentId())
          .startAt(DUES_PREFIX)
          .endBefore(DUES_PREFIX_END)
          .get(),
      ]);
      /** uid → the entry ids already recorded as paid in that member's dues map. */
      const paidEntryIdsByUid = new Map<string, Set<string>>();
      for (const d of duesSnap.docs) {
        if (!d.id.startsWith(DUES_PREFIX)) continue;      // never `private/access`
        const duesUid = d.id.slice(DUES_PREFIX.length);
        if (!duesUid) continue;
        const map = d.get('paidEntries');                 // ONE field, named. Never spread.
        if (map && typeof map === 'object' && !Array.isArray(map)) {
          // 🛑 `isPaidRow`, NOT `Object.keys` (codex r7). A malformed row —
          // `{ [entryId]: null }`, a Timestamp, an array — is treated as UNPAID
          // by `derivePaidStatus`, so keying off mere PRESENCE would make this
          // gate and the derivation disagree about the same document. The gate
          // would then report `alreadyConsistent` for an entry that is PAID
          // while its member is UNPAID: the divergence this migration exists to
          // repair, silently skipped. Same predicate, so they cannot drift.
          paidEntryIdsByUid.set(duesUid,
            new Set(Object.keys(map).filter((id) => isPaidRow(map, id))));
        }
      }
      const membersById = new Map(membersSnap.docs.map((m) => [m.id, m.data() as any]));
      // Members with ANY MARKED_* ledger history were touched by the
      // authoritative setPaidStatus path at some point (it has always appended a
      // row per transition; the Bento entry path never wrote one). For them an
      // entry/member disagreement is not recoverable history — see
      // ambiguousSkipped above.
      const uidsWithLedgerHistory = new Set(
        paymentsSnap.docs
          .map((p) => p.data() as any)
          .filter((p) => p.type === 'MARKED_PAID' || p.type === 'MARKED_UNPAID')
          .map((p) => p.uid)
          .filter(Boolean),
      );
      let changedThisPool = 0;

      for (const entryDoc of entriesSnap.docs) {
        const entry: any = entryDoc.data();
        // NFL entry docs are keyed by uid; ownerUid is the defensive fallback the
        // rest of the codebase uses (Bento, backfill).
        const uid: string = entry.ownerUid || entryDoc.id;
        if (!uid || uid === 'guest') continue;

        const member = membersById.get(uid);
        const entryPaid = entry.paidStatus === 'PAID';
        const memberPaid = member?.paidStatus === 'PAID';

        if (!member) {
          if (entryPaid) report.entriesPaidNoMember++;
          continue;
        }

        if (entryPaid && !memberPaid) {
          // ⚠️ THIS TEST MUST COME BEFORE THE LEDGER-HISTORY TEST, because a
          // previous run of this migration wrote BOTH the dues row and a
          // MARKED_PAID ledger row. Checked second, the ledger row would win
          // and every partial payment this repaired would be re-reported as
          // ambiguous forever (codex r6).
          //
          // The per-entry map already records THIS entry as paid, so the pair
          // is reconciled: the member is UNPAID only because their OTHER liable
          // entries have not been paid, which is the correct derived answer and
          // not a disagreement to fix.
          if (paidEntryIdsByUid.get(uid)?.has(entryDoc.id)) {
            report.alreadyConsistent++;
            continue;
          }
          if (uidsWithLedgerHistory.has(uid)) {
            // A pre-P1 un-mark through the roster toggle leaves exactly this
            // shape (member UNPAID via setPaidStatus, entry never updated) —
            // the entry is STALE, not recoverable history. Operator's call.
            report.ambiguousSkipped++;
            notedFix(poolId, uid, 'AMBIGUOUS_SKIPPED');
            continue;
          }
          // The pre-P1 Bento write: commissioner marked paid, only the entry heard.
          notedFix(poolId, uid, 'PROMOTE_MEMBER');
          if (!dryRun) {
            // ONE transaction for the promotion + its ledger row (codex r1, P1
            // severity): written separately, a crash between the two leaves the
            // member PAID with the ledger row permanently missing — a re-run
            // reads the pair as consistent and never appends it. The tx also
            // RE-READS both docs, so a concurrent setPaidStatus between the
            // page read and this fix makes the tx a no-op instead of a
            // duplicate payment event.
            const mRef = doc.ref.collection('members').doc(uid);
            const ledgerRef = doc.ref.collection('payments').doc();
            const acted = await db.runTransaction(async (tx) => {
              // 🛑 THE OWNER'S WHOLE ENTRY SET IS READ, NOT JUST THE ONE THAT
              // TRIGGERED THIS (PLAN-MULTI-ENTRY-DUES D1a writer #5, P2-T7).
              //
              // This is the writer the plan named as "the one that will be
              // missed": it runs from the Operations panel, sits in no hot path,
              // and nothing exercises it in normal testing. Under per-entry dues
              // it cannot promote a member on the evidence of ONE entry —
              // `paidStatus` is now DERIVED from the per-entry map, so writing
              // the summary without the map means the next writer recomputes it
              // from a map that never heard about this payment and UN-PAYS what
              // this just paid.
              //
              // A single entry document also cannot answer "which entries is
              // this member liable for", which is what the derivation needs. So
              // the owner's entries come along, in the same transaction, before
              // any write.
              const ownedQuery = doc.ref.collection('entries').where('ownerUid', '==', uid);
              const [freshM, freshE, ownedSnap, storedDues] = await Promise.all([
                tx.get(mRef),
                tx.get(entryDoc.ref),
                tx.get(ownedQuery),
                readPoolDues(tx, doc.ref, uid),
              ]);
              const fm: any = freshM.data();
              const fe: any = freshE.data();
              if (!freshM.exists || fe?.paidStatus !== 'PAID' || fm?.paidStatus === 'PAID') return false;
              // 🛑 AND THE DUES ROW, RE-READ IN THIS TRANSACTION (codex r7, P1).
              //
              // The page-level gate above cannot see a commissioner who marks
              // THIS entry paid between the page read and this transaction.
              // Under per-entry dues that write leaves the member `UNPAID` —
              // correctly, because another entry is still unpaid — so every
              // check above still passes, and this would rewrite the row and
              // append a SECOND `MARKED_PAID` for one payment. A duplicated
              // money event in the participant-readable ledger is worse than
              // the divergence being repaired.
              //
              // Before T7 this race was unreachable: the concurrent write set
              // the member to `PAID`, and `fm?.paidStatus === 'PAID'` caught it.
              // Deriving the summary is what re-opened it.
              if (storedDues && isPaidRow(storedDues, entryDoc.id)) return false;

              // The entry that triggered this is marked paid; everything the
              // member already had is kept. The legacy shape (no dues document)
              // starts from empty — this member has no per-entry history, which
              // is exactly the pre-P1 world this migration exists to repair.
              const nextDues: PaidEntryMap = { ...(storedDues ?? {}) };
              nextDues[entryDoc.id] = {
                ...(typeof fe.paidAt === 'number' ? { paidAt: fe.paidAt } : {}),
                ...(typeof fe.paymentMethod === 'string' && fe.paymentMethod ? { method: fe.paymentMethod } : {}),
                ...(typeof fe.paymentNote === 'string' && fe.paymentNote ? { note: fe.paymentNote.slice(0, 500) } : {}),
              };
              // The owner's picked entries — the same input `ownerStateAfter`
              // hands the submit path, rebuilt here from the documents this
              // transaction just read. The legacy `entries/{uid}` doc can carry
              // no `ownerUid` and so miss the query; it IS this entry when the
              // ids match, so it is folded in.
              const pickedIds = ownedSnap.docs.filter(d => entryHasPick(d.data())).map(d => d.id);
              if (entryDoc.id === uid && !pickedIds.includes(uid) && entryHasPick(fe)) pickedIds.push(uid);
              const liable = liableEntryIds(fm as MemberRecord, uid, pickedIds);
              const derived = derivePaidStatus({ ...(fm as MemberRecord), paidEntries: nextDues }, liable);
              // Same field conventions as setPaidStatus's authoritative PAID write.
              const stampedPaidAt = typeof fe.paidAt === 'number' ? fe.paidAt : Date.now();
              // ⚠️ THE DERIVED SUMMARY, NOT A LITERAL `'PAID'`. Promoting a
              // member whose OTHER liable entries were never paid would be the
              // money lie per-entry dues exists to remove — the commissioner
              // marked ONE entry paid pre-P1, and that is all this knows. When
              // the member does turn out to be paid in full, `derived` is
              // `'PAID'` and the behaviour is unchanged from before this ticket.
              tx.set(mRef, {
                paidStatus: derived,
                paidAt: stampedPaidAt,
                paidBy: actorUid,
                ...(typeof fe.paymentMethod === 'string' && fe.paymentMethod
                  ? { paymentMethod: fe.paymentMethod }
                  : {}),
                ...(typeof fe.paymentNote === 'string' && fe.paymentNote
                  ? { paymentNote: fe.paymentNote.slice(0, 500) }
                  : {}),
              }, { merge: true });
              // The missing ledger row — the shared ledger's reader contract is
              // `note` (PaymentLedgerEvent / PaymentsPanel). The original
              // method/txn detail from the entry folds into it (codex r3) so
              // the audit history keeps what the commissioner recorded, and
              // every optional field uses a conditional spread — this project
              // deliberately does NOT set ignoreUndefinedProperties, so a
              // literal undefined ABORTS the whole transaction (codex r3;
              // nflPools.ts:482 records the same crash class).
              const entryName = fm?.userName ?? fe?.userName;
              const noteParts = [
                typeof fe.paymentMethod === 'string' && fe.paymentMethod ? fe.paymentMethod : undefined,
                typeof fe.paymentNote === 'string' && fe.paymentNote ? fe.paymentNote.slice(0, 500) : undefined,
                'reconciled — pre-P1 payment recorded on the entry doc only',
              ].filter(Boolean);
              tx.set(ledgerRef, {
                type: 'MARKED_PAID',
                uid,
                ...(entryName !== undefined ? { entryName } : {}),
                ...(typeof entryFee === 'number' ? { amount: entryFee } : {}),
                actorUid,
                at: Date.now(),
                createdAt: FieldValue.serverTimestamp(),
                note: noteParts.join(' — '),
              });
              writePoolDues(tx, doc.ref, poolId, uid, nextDues, Date.now());
              return true;
            });
            if (acted) { report.membersPromoted++; changedThisPool++; }
            else report.alreadyConsistent++; // raced with a live setPaidStatus
          } else {
            report.membersPromoted++;
            changedThisPool++;
          }
        } else if (memberPaid && !entryPaid) {
          // Truth store already right; the display projection never got written
          // pre-P1. Mirror with P1's field conventions.
          notedFix(poolId, uid, 'MIRROR_ENTRY');
          if (!dryRun) {
            // Transactional for the same reason as the promotion (codex r2): a
            // commissioner un-marking this member between the page read and
            // here commits BOTH docs UNPAID via setPaidStatus, and a blind
            // entry write would resurrect a stale PAID display that the next
            // reconciliation reads as a historical payment — promoting the
            // member back and minting a ledger event for money nobody marked.
            const mRef = doc.ref.collection('members').doc(uid);
            const acted = await db.runTransaction(async (tx) => {
              const [freshM, freshE] = await Promise.all([tx.get(mRef), tx.get(entryDoc.ref)]);
              const fm: any = freshM.data();
              const fe: any = freshE.data();
              if (!freshE.exists || fm?.paidStatus !== 'PAID' || fe?.paidStatus === 'PAID') return false;
              tx.update(entryDoc.ref, {
                paidStatus: 'PAID',
                paidAt: typeof fm.paidAt === 'number' ? fm.paidAt : null,
                ...(typeof fm.paymentMethod === 'string' && fm.paymentMethod
                  ? { paymentMethod: fm.paymentMethod }
                  : {}),
                // The note converges too (codex r4) — the entry-backed UI
                // renders it, and a mirror that drops it reports success while
                // the display still disagrees with the record.
                ...(typeof fm.paymentNote === 'string' && fm.paymentNote
                  ? { paymentNote: fm.paymentNote.slice(0, 500) }
                  : {}),
                updatedAt: Date.now(),
              });
              return true;
            });
            if (acted) { report.entriesMirrored++; changedThisPool++; }
            else report.alreadyConsistent++; // raced with a live setPaidStatus
          } else {
            report.entriesMirrored++;
            changedThisPool++;
          }
        } else {
          report.alreadyConsistent++;
        }
      }

      if (!dryRun && changedThisPool > 0) {
        await recomputeRosterSummary(db, poolId);
        const owner = ownerOf(pool);
        if (owner) touchedOwners.add(owner);
      }
    } catch (err: any) {
      report.ok = false;
      report.failures.push({ poolId, error: String(err?.message || err) });
    }
  }

  if (!dryRun) {
    for (const owner of touchedOwners) {
      try {
        await recomputeCommissionerAggregate(db, owner);
      } catch (err: any) {
        report.ok = false;
        report.failures.push({ poolId: `commissionerAggregate:${owner}`, error: String(err?.message || err) });
      }
    }
  }

  if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;
  return report;
});
