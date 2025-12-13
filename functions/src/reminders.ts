
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { GameState, ReminderSettings, NotificationLog, Square, AuditLogEvent } from "./types";

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
    const poolsSnapshot = await db.collection("pools").get();

    for (const doc of poolsSnapshot.docs) {
        const pool = doc.data() as GameState;
        if (!pool.reminders) continue; // Skip if not configured

        // 1. PAYMENT REMINDERS
        if (pool.reminders.payment?.enabled) {
            await checkPaymentReminders(pool, now);
        }

        // 2. LOCK REMINDERS
        if (pool.reminders.lock?.enabled) {
            await checkLockReminders(pool, now);
        }
    }
});

async function checkPaymentReminders(pool: GameState, now: number) {
    const settings = pool.reminders!.payment;
    const graceMs = settings.graceMinutes * 60 * 1000;
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
        await sendEmail(
            pool.contactEmail,
            `Action Needed: ${unpaidSquares.length} Unpaid Squares`,
            `<p>Hi ${pool.managerName},</p>
             <p>You have ${unpaidSquares.length} squares that are reserved but unpaid.</p>
             <p><a href="https://marchmeleepools.com/#pool/${pool.id}">Manage Pool</a></p>`
        );
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
                await sendEmail(
                    email,
                    `Reminder: ${squares.length} Squares Pending Payment`,
                    `<p>You have ${squares.length} squares pending payment in <strong>${pool.name}</strong>.</p>
                     <p>Please pay the host: ${pool.paymentInstructions || 'See pool details'}</p>
                     <p><a href="https://marchmeleepools.com/#pool/${pool.id}">View Pool</a></p>`
                );
            }
        }
    }
}

async function checkLockReminders(pool: GameState, now: number) {
    const settings = pool.reminders!.lock;
    if (!settings.lockAt) return;

    const msUntilLock = settings.lockAt - now;
    const minutesUntilLock = msUntilLock / 1000 / 60;

    if (minutesUntilLock <= 0) return; // Already passed logic

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
                await sendEmail(
                    pool.contactEmail,
                    `Pool Locking in ${Math.round(minutesUntilLock / 60)} Hours`,
                    `<p>Your pool <strong>${pool.name}</strong> locks soon.</p>`
                );

                // Start: Email all participants if needed (expensive for free tier, maybe limit or skip for MVP if list huge)
                // For MVP, let's just email the host to trigger their manual blast if they want.
                // Or iterate unique emails from squares.
                const uniqueEmails = Array.from(new Set(pool.squares.map(s => s.playerDetails?.email).filter(Boolean))) as string[];
                for (const email of uniqueEmails) {
                    await sendEmail(
                        email,
                        `Grid Locking Soon: ${pool.name}`,
                        `<p>The pool locks in approximately ${Math.round(minutesUntilLock / 60)} hours.</p>
                         <p><a href="https://marchmeleepools.com/#pool/${pool.id}">Check your squares</a></p>`
                    );
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
        const body = `
            <h2>${pool.name} Winner Alert from March Melee Pools</h2>
            <p><strong>${period.toUpperCase()} Winner:</strong> ${winnerData.owner}</p>
            <p><strong>Square:</strong> ${Math.floor(winnerData.squareId / 10)} - ${winnerData.squareId % 10}</p>
            <p><strong>Amount:</strong> $${winnerData.amount}</p>
            ${settings.includeDigits ? `<p><strong>Winning Digits:</strong> Home ${winnerData.homeDigit} - Away ${winnerData.awayDigit}</p>` : ''}
            <p><a href="https://marchmeleepools.com/#pool/${pool.id}">View Full Grid</a></p>
        `;

        // Batch send (naive loop for MVP)
        for (const email of uniqueEmails) {
            await sendEmail(email, subject, body);
        }

        await logAudit(pool.id, `Sent winner announcement for ${period}`, 'NOTIFICATION_SENT', { dedupeKey: key });
    }
});
