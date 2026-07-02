import * as admin from "firebase-admin";
import { PlayerDetails } from "./types";

// Player PII lives OUTSIDE the public pool doc (audit finding H1).
// Firestore rules can't hide fields on read and the pool doc needs a broad
// `get` for guest-link joins, so contact info is stored in this restricted
// subcollection instead: /pools/{poolId}/squarePrivate/{squareId}
export const SQUARE_PRIVATE = "squarePrivate";

export interface SquarePrivate extends PlayerDetails {
    squareId: number;
    updatedAt?: admin.firestore.Timestamp;
}

// Strip undefined/null/empty fields so we don't write junk into Firestore.
export function buildSquarePrivate(squareId: number, details: PlayerDetails = {}): SquarePrivate {
    const clean: Record<string, unknown> = { squareId };
    for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null && value !== "") clean[key] = value;
    }
    clean.updatedAt = admin.firestore.Timestamp.now();
    return clean as unknown as SquarePrivate;
}

// squareId -> private details for one pool.
export async function getSquarePrivateMap(
    db: admin.firestore.Firestore,
    poolId: string,
): Promise<Map<number, SquarePrivate>> {
    const snap = await db.collection("pools").doc(poolId).collection(SQUARE_PRIVATE).get();
    const map = new Map<number, SquarePrivate>();
    snap.forEach((d) => {
        const data = d.data() as SquarePrivate;
        const id = typeof data.squareId === "number" ? data.squareId : Number(d.id);
        if (!Number.isNaN(id)) map.set(id, data);
    });
    return map;
}

// Unique, valid emails across a pool's squarePrivate docs.
export async function getSquareEmails(
    db: admin.firestore.Firestore,
    poolId: string,
): Promise<string[]> {
    const map = await getSquarePrivateMap(db, poolId);
    const emails = new Set<string>();
    for (const v of map.values()) {
        if (v.email && v.email.includes("@")) emails.add(v.email);
    }
    return Array.from(emails);
}
