/**
 * Input schemas for the squares.ts SWEEP-LATER callables: updatePlayer,
 * releaseSquares. PURE: zod only, no firebase imports.
 */

import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

/**
 * updatePlayer — { poolId, originalName, details }.
 *
 * The detail fields are all OPTIONAL and may be EMPTY strings: AdminPanel sends
 * the full { name, email, phone, notes } object every time, and clearing a
 * field in that form sends "". The handler reads them as optional
 * (`details.name?.trim() || originalName`), so a .min(1) here would reject a
 * legitimate "clear my phone number" edit.
 */
export const updatePlayerSchema = z.strictObject({
    poolId,
    // NOT trimmed: this is a LOOKUP KEY, matched with === against the stored
    // squares[].owner string. reserveSquare accepts pickedAsName /
    // customerDetails.name without trimming, so an owner can legitimately be
    // stored as " Alice ". Trimming the lookup key here would make that player
    // permanently un-editable ("Player not found"). See releaseSquares below.
    originalName: z.string().min(1).max(200),
    details: z.strictObject({
        name: z.string().max(200).optional(),
        email: z.string().max(320).optional(),
        phone: z.string().max(50).optional(),
        notes: z.string().max(2000).optional(),
    }),
});

/**
 * releaseSquares — { poolId, squareIds? , ownerName? } with a cross-field rule:
 * the handler throws invalid-argument unless squareIds is an ARRAY or ownerName
 * is truthy. Note an EMPTY squareIds array counts as provided (the handler
 * treats it as "release nothing" and returns []), so the refine checks for the
 * array's presence, not its length — matching the hand check exactly.
 */
export const releaseSquaresSchema = z
    .strictObject({
        poolId,
        squareIds: z.array(z.number().int()).max(100).optional(),
        // NOT trimmed — same lookup-key reasoning as updatePlayer.originalName.
        // A trimmed key here fails silently: the handler releases nothing and
        // still returns success.
        ownerName: z.string().min(1).max(200).optional(),
    })
    .refine((d) => Array.isArray(d.squareIds) || !!d.ownerName, {
        message: "Provide squareIds or ownerName.",
    });

export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type ReleaseSquaresInput = z.infer<typeof releaseSquaresSchema>;
