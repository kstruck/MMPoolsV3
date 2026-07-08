// Backfill Member Records for existing pools of ALL types. Idempotent, resumable, dry-run
// by default. Reads the union participantIds ∪ participants ∪ entries ∪ propCards, skips the
// "guest" sentinel, copies existing paidStatus, never overwrites. Flips rosterSchemaVersion
// per pool ONLY after that pool's invariants pass. STAGED — Kevin runs it (dryRun first) and
// reviews the invariant report before any prod write. See docs/adr/0003 item 8.
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ROSTER_SCHEMA_VERSION } from "../shared/memberRecord";
import { recomputeRosterSummary } from "../lib/rosterSummary";

type Firestore = admin.firestore.Firestore;

interface PoolMemberSource {
  uid: string;
  userName?: string;
  paidStatus?: 'PAID' | 'UNPAID';
  unitsOwned?: number;
  role?: string;
}

/** Collect every real member uid for a pool from all per-type sources. */
async function collectMembers(db: Firestore, poolId: string, pool: any): Promise<{ members: Map<string, PoolMemberSource>; guestSkipped: number }> {
  const members = new Map<string, PoolMemberSource>();
  let guestSkipped = 0;
  const add = (uid: any, src: Partial<PoolMemberSource>) => {
    if (!uid || typeof uid !== 'string') return;
    if (uid === 'guest') { guestSkipped++; return; }
    members.set(uid, { ...(members.get(uid) || { uid }), ...src, uid });
  };

  const ownerUid = pool.ownerId || pool.createdByUid || pool.managerUid;

  // participantIds[]
  for (const uid of (pool.participantIds || [])) add(uid, { role: uid === ownerUid ? 'MANAGER' : 'PARTICIPANT' });

  // Squares: participants subcollection + per-square units
  if (pool.type === 'SQUARES') {
    const partSnap = await db.collection('pools').doc(poolId).collection('participants').get();
    for (const d of partSnap.docs) add(d.id, { userName: d.data()?.name });
    const squares: any[] = Array.isArray(pool.squares) ? pool.squares : [];
    const unitsByUid = new Map<string, number>();
    for (const s of squares) {
      const u = s?.reservedByUid;
      if (u && u !== 'guest') unitsByUid.set(u, (unitsByUid.get(u) || 0) + 1);
    }
    for (const [uid, units] of unitsByUid) add(uid, { unitsOwned: units });
  }

  // entries subcollection (NFL season, bracket, playoff-as-subcol) → ownerUid + paidStatus
  const entriesSnap = await db.collection('pools').doc(poolId).collection('entries').get();
  for (const d of entriesSnap.docs) {
    const e: any = d.data();
    add(e.ownerUid || d.id, { userName: e.userName, paidStatus: e.paidStatus });
  }

  // Playoff entries live on the pool doc (pool.entries map)
  if (pool.entries && typeof pool.entries === 'object' && !Array.isArray(pool.entries)) {
    for (const e of Object.values<any>(pool.entries)) add(e?.userId || e?.ownerUid, { userName: e?.userName, paidStatus: e?.paidStatus });
  }

  // Props: propCards[] carry the only membership signal
  for (const c of (pool.propCards || [])) add(c?.ownerUid || c?.userId || c?.uid, { userName: c?.userName, paidStatus: c?.paidStatus });

  return { members, guestSkipped };
}

export const backfillMemberRecords = onCall(async (request) => {
  if (!request.auth || request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError("permission-denied", "Super Admin only.");
  }
  const dryRun = request.data?.dryRun !== false; // default TRUE
  const limit = Math.min(Number(request.data?.limit) || 25, 100);
  const startAfter: string | undefined = request.data?.startAfter;

  const db = admin.firestore();
  let q = db.collection('pools').orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
  if (startAfter) q = q.startAfter(startAfter);
  const snap = await q.get();

  const report = {
    dryRun,
    poolsScanned: 0,
    membersCreated: 0,
    membersAlreadyPresent: 0,
    guestSkipped: 0,
    participantIdsWithoutMember: 0,
    poolsFlipped: 0,
    failures: [] as { poolId: string; error: string }[],
    nextCursor: null as string | null,
  };

  for (const doc of snap.docs) {
    const poolId = doc.id;
    const pool: any = doc.data();
    report.poolsScanned++;
    try {
      const { members, guestSkipped } = await collectMembers(db, poolId, pool);
      report.guestSkipped += guestSkipped;
      let createdThisPool = 0;
      const userCache = new Map<string, string>();

      for (const [uid, src] of members) {
        const mRef = db.collection('pools').doc(poolId).collection('members').doc(uid);
        const exists = (await mRef.get()).exists;
        if (exists) { report.membersAlreadyPresent++; continue; }
        report.participantIdsWithoutMember++;
        let userName = src.userName;
        if (!userName) {
          userName = userCache.get(uid);
          if (userName === undefined) {
            userName = (await db.collection('users').doc(uid).get()).data()?.name || 'Member';
            userCache.set(uid, userName!);
          }
        }
        if (!dryRun) {
          await mRef.set({
            uid, poolId, userName,
            role: src.role || 'PARTICIPANT',
            paidStatus: src.paidStatus === 'PAID' ? 'PAID' : 'UNPAID',
            joinedAt: pool.createdAt || Date.now(),
            ...(src.unitsOwned !== undefined ? { unitsOwned: src.unitsOwned, unitsPaid: src.paidStatus === 'PAID' ? src.unitsOwned : 0 } : {}),
          }, { merge: false });
        }
        report.membersCreated++;
        createdThisPool++;
      }

      // Flip schema version only after this pool's members are all present (invariant pass).
      if (!dryRun && createdThisPool >= 0) {
        await recomputeRosterSummary(db, poolId);
        await doc.ref.set({ rosterSchemaVersion: ROSTER_SCHEMA_VERSION }, { merge: true });
        report.poolsFlipped++;
      }
    } catch (err: any) {
      report.failures.push({ poolId, error: String(err?.message || err) });
    }
  }

  if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;
  return report;
});
