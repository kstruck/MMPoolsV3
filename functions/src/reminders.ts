
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { GameState, NotificationLog, Square, AuditLogEvent } from "./types";
import { writeAuditEvent, computeDigitsHash } from "./audit";
import { renderEmailHtml, BASE_URL } from "./emailStyles";

const db = admin.firestore();

// --- HELPERS ---

/**
 * Sends an email by writing to the /mail collection (triggered by EmailJS or other service).
 */
async function sendEmail(to: string, subject: string, html: string, context?: any) {
    if (!to || !to.includes('@')) {
        console.warn(`Skipping email to invalid address: ${to}`);
        return;
    }

    try {
        await db.collection("mail").add({
            to,
            message: {
                subject,
                html,
            },
            ...context, // e.g. poolId, reason
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Email queued for ${to}: ${subject}`);
    } catch (error) {
        console.error("Error queuing email:", error);
    }
}

/**
 * Idempotency check: Creates a notification log if it doesn't exist.
 * Returns true if created (should send), false if already exists (skip).
 */
async function createNotificationOnce(dedupeKey: string, logData: Omit<NotificationLog, 'id'>): Promise<boolean> {
    const ref = db.collection("notifications").doc(dedupeKey);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (doc.exists) {
                throw new Error("ALREADY_SENT");
            }
            t.set(ref, { ...logData, id: dedupeKey });
        });
        return true;
    } catch (e: any) {
        if (e.message === "ALREADY_SENT") {
            return false;
        }
        throw e;
    }
}

async function logAudit(poolId: string, message: string, type: string, payload?: any) {
    const auditRef = db.collection("pools").doc(poolId).collection("audit").doc();
    const event: AuditLogEvent = {
        id: auditRef.id,
        poolId,
        timestamp: Date.now(),
        type: "POOL_STATUS_CHANGED" as any, // Reusing generic type or add NOTIFICATION_SENT
        message,
        severity: "INFO",
        actor: { uid: "SYSTEM", role: "SYSTEM", label: "SmartReminders" },
        payload,
        dedupeKey: payload?.dedupeKey
    };
    await auditRef.set(event);
}

// --- SCHEDULED REMINDER LOGIC ---

export const runReminders = functions.scheduler.onSchedule("every 15 minutes", async (event) => {
    const now = Date.now();
    console.log(`[runReminders] Starting reminder check at ${new Date(now).toISOString()}`);
    const poolsSnapshot = await db.collection("pools").get();
    console.log(`[runReminders] Found ${poolsSnapshot.size} pools to check`);

    for (const doc of poolsSnapshot.docs) {
        try {
            // CRITICAL FIX: doc.data() does NOT include the document ID!
            // We must add it manually for pool.id to work in downstream functions.
            const pool = { id: doc.id, ...doc.data() } as GameState;

            if (!pool.reminders) continue; // Skip if not configured

            // 1. PAYMENT REMINDERS
            if (pool.reminders.payment?.enabled) {
                await checkPaymentReminders(pool, now);
            }

            // 2. LOCK REMINDERS
            if (pool.reminders.lock?.enabled) {
                console.log(`[runReminders] Checking lock for pool ${pool.id}: lockAt=${pool.reminders.lock.lockAt}, isLocked=${pool.isLocked}`);
                await checkLockReminders(pool, now);
            }
        } catch (poolError: any) {
            console.error(`[runReminders] Error processing pool ${doc.id}:`, poolError);
        }
    }
    console.log(`[runReminders] Completed reminder check`);
});

async function checkPaymentReminders(pool: GameState, now: number) {
    const settings = pool.reminders!.payment;

    const bucketSizeMs = settings.repeatEveryHours * 60 * 60 * 1000;
    const timeBucket = Math.floor(now / bucketSizeMs);

    // Identify unpaid squares past grace period
    const unpaidSquares = pool.squares.filter(s => {
        if (s.isPaid || !s.owner) return false;
        // Assumption: 'reservedAt' is tracked. If not, we might need to rely on other signals or assume creation.
        // For MVP, if we don't store reservedAt on square, we skip time check or assume always eligible if unpaid.
        // Let's assume we proceed if it's reserved and not paid.
        return true;
    });

    if (unpaidSquares.length === 0) return;

    // HOST REMINDER
    const hostKey = `PAY_HOST:${pool.id}:${timeBucket}`;
    const hostSent = await createNotificationOnce(hostKey, {
        poolId: pool.id,
        type: 'PAYMENT_HOST',
        recipient: pool.contactEmail,
        sentAt: now,
        status: 'SENT',
        metadata: { count: unpaidSquares.length }
    });

    if (hostSent) {
        const emailBody = `
            <p>Hi ${pool.managerName},</p>
            <p>You have ${unpaidSquares.length} squares that are reserved but unpaid.</p>
        `;
        const html = renderEmailHtml(`Action Needed: Unpaid Squares`, emailBody, `${BASE_URL}/#pool/${pool.id}`, 'Manage Pool');
        await sendEmail(pool.contactEmail, `Action Needed: ${unpaidSquares.length} Unpaid Squares`, html);
        await logAudit(pool.id, `Sent payment reminder to host (${unpaidSquares.length} unpaid)`, 'NOTIFICATION_SENT', { dedupeKey: hostKey });
    }

    // USER REMINDERS (Optional)
    if (settings.notifyUsers) {
        const squaresByOwner = unpaidSquares.reduce((acc, s) => {
            if (s.playerDetails?.email) {
                if (!acc[s.playerDetails.email]) acc[s.playerDetails.email] = [];
                acc[s.playerDetails.email].push(s);
            }
            return acc;
        }, {} as Record<string, Square[]>);

        for (const [email, squares] of Object.entries(squaresByOwner)) {
            const userKey = `PAY_USER:${pool.id}:${email}:${timeBucket}`;
            const userSent = await createNotificationOnce(userKey, {
                poolId: pool.id,
                type: 'PAYMENT_USER',
                recipient: email,
                sentAt: now,
                status: 'SENT',
                metadata: { squares: squares.map(s => s.id) }
            });

            if (userSent) {
                if (userSent) {
                    const emailBody = `
                    <p>You have ${squares.length} squares pending payment in <strong>${pool.name}</strong>.</p>
                    <p>Please pay the host: ${pool.paymentInstructions || 'See pool details'}</p>
                `;
                    const html = renderEmailHtml(`Payment Reminder`, emailBody, `${BASE_URL}/#pool/${pool.id}`, 'View Pool');
                    await sendEmail(email, `Reminder: ${squares.length} Squares Pending Payment`, html);
                }
            }
        }
    }

    // AUTO-RELEASE LOGIC
    if (settings.autoRelease && settings.autoReleaseHours) {
        const releaseThresholdMs = settings.autoReleaseHours * 60 * 60 * 1000;

        // Find squares that have exceeded the auto-release threshold
        const squaresToRelease = pool.squares.filter(s => {
            if (s.isPaid || !s.owner) return false;
            if (!s.reservedAt) return false; // Can't auto-release without reservedAt timestamp
            return (now - s.reservedAt) > releaseThresholdMs;
        });

        if (squaresToRelease.length > 0) {
            const poolRef = db.collection("pools").doc(pool.id);

            try {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(poolRef);
                    if (!doc.exists) return;

                    const currentPool = doc.data() as GameState;
                    const updatedSquares = currentPool.squares.map(s => {
                        const shouldRelease = squaresToRelease.some(r => r.id === s.id);
                        if (shouldRelease) {
                            return {
                                ...s,
                                owner: null,
                                playerDetails: undefined,
                                guestDeviceKey: null,
                                guestClaimId: null,
                                reservedAt: null,
                                reservedByUid: null
                            };
                        }
                        return s;
                    });

                    t.update(poolRef, {
                        squares: updatedSquares,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });

                // Log audit event
                await logAudit(pool.id, `Auto-released ${squaresToRelease.length} unpaid squares after ${settings.autoReleaseHours} hours`, 'NOTIFICATION_SENT', {
                    releasedSquares: squaresToRelease.map(s => s.id),
                    autoReleaseHours: settings.autoReleaseHours
                });

                // Notify waitlist if any
                if (pool.waitlist && pool.waitlist.length > 0) {
                    await notifyWaitlist(pool, squaresToRelease.length);
                }

                // Notify host
                const emailBody = `
                    <p>Hi ${pool.managerName},</p>
                    <p><strong>${squaresToRelease.length} squares</strong> have been automatically released due to non-payment after ${settings.autoReleaseHours} hours.</p>
                    <p>Released squares: ${squaresToRelease.map(s => `#${s.id}`).join(', ')}</p>
                `;
                const html = renderEmailHtml(`Squares Auto-Released`, emailBody, `${BASE_URL}/#pool/${pool.id}`, 'View Pool');
                await sendEmail(pool.contactEmail, `${squaresToRelease.length} Squares Auto-Released: ${pool.name}`, html);

                console.log(`[AutoRelease] Released ${squaresToRelease.length} squares from pool ${pool.id}`);
            } catch (e) {
                console.error(`[AutoRelease] Error releasing squares for pool ${pool.id}:`, e);
            }
        }
    }
}

// --- WAITLIST NOTIFICATION ---
async function notifyWaitlist(pool: GameState, releasedCount: number) {
    if (!pool.waitlist || pool.waitlist.length === 0) return;

    const emailSubject = `Squares Available: ${pool.name}`;
    const emailBody = `
        <p>Good news! <strong>${releasedCount} squares</strong> have just become available in ${pool.name}.</p>
        <p>First come, first served! Click below to claim your squares now.</p>
    `;
    const html = renderEmailHtml(`Squares Available!`, emailBody, `${BASE_URL}/#pool/${pool.id}`, 'Claim Squares Now');

    for (const entry of pool.waitlist) {
        await sendEmail(entry.email, emailSubject, html);
    }

    await logAudit(pool.id, `Notified ${pool.waitlist.length} waitlisted users about ${releasedCount} released squares`, 'NOTIFICATION_SENT', {
        waitlistCount: pool.waitlist.length,
        releasedCount
    });
}

async function checkLockReminders(pool: GameState, now: number) {
    const settings = pool.reminders!.lock;
    if (!settings.lockAt) return;

    // Robust handling of lockAt (could be number or Timestamp)
    const lockAtNum = typeof settings.lockAt === 'number'
        ? settings.lockAt
        : (settings.lockAt as any)?.toMillis?.() || new Date(settings.lockAt as any).getTime();

    if (isNaN(lockAtNum)) {
        console.warn(`[checkLockReminders] Invalid lockAt for pool ${pool.id}:`, settings.lockAt);
        return;
    }

    const msUntilLock = lockAtNum - now;
    const minutesUntilLock = msUntilLock / 1000 / 60;

    if (minutesUntilLock <= 0) {
        // Time has passed: Execute Auto-Lock if not already locked
        if (!pool.isLocked) {
            await executeAutoLock(pool);
        }
        return;
    }

    for (const scheduleMin of settings.scheduleMinutes) {
        // Window: +/- 10 minutes
        const diff = Math.abs(minutesUntilLock - scheduleMin);
        if (diff <= 10) {
            const key = `LOCK:${pool.id}:${settings.lockAt}:${scheduleMin}`;
            const sent = await createNotificationOnce(key, {
                poolId: pool.id,
                type: 'LOCK_COUNTDOWN',
                recipient: 'ALL_PARTICIPANTS', // conceptual
                sentAt: now,
                status: 'SENT',
                metadata: { minutesLeft: scheduleMin }
            });

            if (sent) {
                // Email Host
                const hostBody = `<p>Your pool <strong>${pool.name}</strong> locks soon.</p>`;
                const hostHtml = renderEmailHtml(`Pool Locking Soon`, hostBody, `${BASE_URL}/#pool/${pool.id}`, 'Manage Pool');
                await sendEmail(pool.contactEmail, `Pool Locking in ${Math.round(minutesUntilLock / 60)} Hours`, hostHtml);

                // Start: Email all participants if needed (expensive for free tier, maybe limit or skip for MVP if list huge)
                // For MVP, let's just email the host to trigger their manual blast if they want.
                // Or iterate unique emails from squares.
                const uniqueEmails = Array.from(new Set(pool.squares.map(s => s.playerDetails?.email).filter(Boolean))) as string[];
                for (const email of uniqueEmails) {
                    const userBody = `<p>The pool locks in approximately ${Math.round(minutesUntilLock / 60)} hours.</p>`;
                    const userHtml = renderEmailHtml(`Grid Locking Soon: ${pool.name}`, userBody, `${BASE_URL}/#pool/${pool.id}`, 'Check Your Squares');
                    await sendEmail(email, `Grid Locking Soon: ${pool.name}`, userHtml);
                }

                await logAudit(pool.id, `Sent lock reminder (${scheduleMin} min warning)`, 'NOTIFICATION_SENT', { dedupeKey: key });
            }
        }
    }
}

// --- WINNER ANNOUNCEMENT TRIGGER ---

export const onWinnerComputed = functions.firestore.onDocumentCreated("pools/{poolId}/winners/{period}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const poolId = event.params.poolId;
    const winnerData = snapshot.data();
    const period = event.params.period;

    const poolDoc = await db.collection("pools").doc(poolId).get();
    const pool = poolDoc.data() as GameState;

    if (!pool.reminders?.winner?.enabled) return;

    const settings = pool.reminders.winner;
    if (!settings.channels.includes("email")) return;

    const key = `WIN:${pool.id}:${period}:${winnerData.squareId}`;

    // Check key manually since we are in a trigger, createNotificationOnce is safe
    const sent = await createNotificationOnce(key, {
        poolId: pool.id,
        type: 'WINNER_ANNOUNCEMENT',
        recipient: 'ALL',
        sentAt: Date.now(),
        status: 'SENT',
        metadata: { period, winner: winnerData.owner }
    });

    if (sent) {
        const uniqueEmails = Array.from(new Set(pool.squares.map(s => s.playerDetails?.email).filter(Boolean))) as string[];

        // Add Host
        if (pool.contactEmail && !uniqueEmails.includes(pool.contactEmail)) {
            uniqueEmails.push(pool.contactEmail);
        }

        const subject = `Winner Alert: ${period.toUpperCase()} - ${winnerData.owner}`;

        // Construct body content (no H2 needed, title handled by wrapper)
        const bodyContent = `
                <p><strong>${period.toUpperCase()} Winner:</strong> ${winnerData.owner}</p>
                <p><strong>Square:</strong> ${Math.floor(winnerData.squareId / 10)} - ${winnerData.squareId % 10}</p>
                <p><strong>Amount:</strong> $${winnerData.amount}</p>
                ${settings.includeDigits ? `<p><strong>Winning Digits:</strong> Home ${winnerData.homeDigit} - Away ${winnerData.awayDigit}</p>` : ''}
            `;

        const html = renderEmailHtml(`${pool.name} Winner Alert`, bodyContent, `${BASE_URL}/#pool/${pool.id}`, 'View Full Grid');

        // Batch send (naive loop for MVP)
        for (const email of uniqueEmails) {
            await sendEmail(email, subject, html);
        }

        await logAudit(pool.id, `Sent winner announcement for ${period}`, 'NOTIFICATION_SENT', { dedupeKey: key });
    }
});

// --- AUTO LOCK LOGIC ---

const generateDigits = () => {
    const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    // Fisher-Yates Shuffle
    for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
};

async function executeAutoLock(pool: GameState) {
    console.log(`[AutoLock] Executing for pool ${pool.id}`);
    const poolRef = db.collection("pools").doc(pool.id);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists) return; // Deleted?
            const currentPool = doc.data() as GameState;

            if (currentPool.isLocked) {
                console.log(`[AutoLock] Skipped - already locked: ${pool.id}`);
                return;
            }

            // Generate Digits
            const axisNumbers = {
                home: generateDigits(),
                away: generateDigits(),
            };

            let updates: any = {
                isLocked: true,
                lockGrid: true, // Legacy/UI sync
                axisNumbers,
                updatedAt: admin.firestore.Timestamp.now(),
            };

            // Handle 4-Set initialization
            if (currentPool.numberSets === 4) {
                updates.quarterlyNumbers = {
                    q1: axisNumbers
                };
            }

            t.update(poolRef, updates);

            // Audit Logs
            await writeAuditEvent({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
            }, t);

            const digitsHash = computeDigitsHash({ home: axisNumbers.home, away: axisNumbers.away, poolId: pool.id, period: 'q1' });
            await writeAuditEvent({
                poolId: pool.id,
                type: 'DIGITS_GENERATED',
                message: 'Auto-Generated Axis Numbers',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' },
                payload: { period: 'initial', commitHash: digitsHash, numberSets: currentPool.numberSets },
                dedupeKey: `DIGITS_GENERATED:${pool.id}:initial:${digitsHash}`
            }, t);
        });

        // Notify Host
        if (pool.contactEmail) {
            const emailBody = `<p>Your pool <strong>${pool.name}</strong> has been auto-locked and numbers have been generated.</p>`;
            const html = renderEmailHtml(`Pool Locked & Numbers Generated`, emailBody, `${BASE_URL}/#pool/${pool.id}`, 'View Pool');

            await sendEmail(
                pool.contactEmail,
                `Pool Locked & Numbers Generated: ${pool.name}`,
                html
            );
        }

    } catch (e) {
        console.error(`[AutoLock] Failed for ${pool.id}:`, e);
    }
}
