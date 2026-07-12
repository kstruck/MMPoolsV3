/**
 * Input schemas for the squares/props TARGET-NOW callables (sweep #80, #81,
 * #85): reserveSquare, markSquaresPaid, purchasePropCard. PURE: zod only.
 *
 * reserveSquare and purchasePropCard are PUBLIC (guest flows) — the strict
 * shape is the primary gate; identity/permission logic stays in the handlers.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);

/**
 * Guest/customer contact details. STRIPPING object (not strict): unknown keys
 * are dropped before they can reach the squarePrivate PII doc — the old code
 * spread arbitrary client keys into it. Empty strings allowed (the
 * buildSquarePrivate cleaner drops them).
 */
const customerDetails = z.object({
    name: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
    phone: z.string().max(50).optional(),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    referral: z.string().max(200).optional(),
});

/** reserveSquare — PUBLIC: { poolId, squareId, customerDetails?, guestDeviceKey?, pickedAsName? }. */
export const reserveSquareSchema = z.strictObject({
    poolId,
    squareId: z.number().int().min(0).max(9999),
    customerDetails: nullish(customerDetails),
    guestDeviceKey: nullish(z.string().max(200)),
    pickedAsName: nullish(z.string().max(200)),
});

/** markSquaresPaid — { poolId, squareIds (<=100: full 10x10 board), isPaid }. */
export const markSquaresPaidSchema = z.strictObject({
    poolId,
    squareIds: z.array(z.number().int()).min(1).max(100),
    isPaid: z.boolean(),
});

/** purchasePropCard — PUBLIC: answers is qId → option index (Record<string, number>). */
export const purchasePropCardSchema = z.strictObject({
    poolId,
    answers: z
        .record(z.string().min(1).max(100), z.number().int().min(0).max(1000))
        .refine((o) => Object.keys(o).length <= 200, { message: "too many answers" }),
    tiebreakerVal: nullish(z.union([z.number().finite(), z.string().max(50)])),
    userName: nullish(z.string().max(200)),
    cardName: nullish(z.string().max(200)),
    email: nullish(z.string().max(320)),
});

export type ReserveSquareInput = z.infer<typeof reserveSquareSchema>;
export type MarkSquaresPaidInput = z.infer<typeof markSquaresPaidSchema>;
export type PurchasePropCardInput = z.infer<typeof purchasePropCardSchema>;
