
import * as functions from "firebase-functions/v2";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
// Fixed imports
import { GameState, NotificationLog, Square, AuditLogEvent, Pool, PlayoffPool, PropsPool, AuditEventType, PlayoffEntry, BracketPool, User, BracketEntry, NFLGame, NFLPickemPool, NFLSurvivorPool, NFLMarginPool, NFLPickemEntry, SurvivorEntry, MarginEntry } from "./types";
import { writeAuditEvent, computeDigitsHash } from "./audit";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { isOptedOut, buildUnsubUrl, getPrefs, EmailCategory } from "./emailPrefs";
import { sendCourierSMS } from "./notifications/smsService";
import { getSquarePrivateMap, getSquareEmails } from "./squarePrivate";



// --- HELPERS ---

/**
 * Sends an email by writing to the /mail collection (triggered by EmailJS or other service).
 * Honors unsubscribe opt-outs and injects the per-recipient unsubscribe link
 * (templates carry a {{UNSUB_URL}} placeholder in the footer).
 */
export async function sendEmail(db: admin.firestore.Firestore, to: string, subject: string, html: string, context?: Record<string, unknown>) {
    if (!to || !to.includes('@')) {
        console.warn(`Skipping email to invalid address: ${to}`);
        return;
    }

    try {
        // Opt-out check + unsubscribe link. Fail-open: if this infra is ever
        // unavailable, deadline/payment emails still go out — a broken
        // unsubscribe store must never silently suppress critical mail.
        let unsubUrl: string | null = null;
        try {
            // Transactional mail (password resets, payment receipts) is exempt from
            // marketing opt-out — flag via context.transactional
            if (!context?.transactional && await isOptedOut(db, to)) {
                console.log(`Skipping email to ${to}: recipient has unsubscribed`);
                return;
            }
            // Per-category opt-out (senders tag mail via context.category).
            const category = context?.category as EmailCategory | undefined;
            if (!context?.transactional && category) {
                const prefs = await getPrefs(db, to);
                if (prefs.categories[category] === false) {
                    console.log(`Skipping email to ${to}: opted out of '${category}' emails`);
                    return;
                }
            }
            unsubUrl = await buildUnsubUrl(db, to);
        } catch (prefError) {
            console.warn("Unsubscribe infra unavailable — sending without opt-out check:", prefError);
        }
        const finalHtml = unsubUrl ? html.replace(/\{\{UNSUB_URL\}\}/g, unsubUrl) : html;

        await db.collection("mail").add({
            to,
            message: {
                subject,
                html: finalHtml,
            },
            ...context, // e.g. poolId, reason
            createdAt: FieldValue.serverTimestamp(),
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
async function createNotificationOnce(db: admin.firestore.Firestore, dedupeKey: string, logData: Omit<NotificationLog, 'id'>): Promise<boolean> {
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
    } catch (e: unknown) {
        const error = e as Error;
        if (error.message === "ALREADY_SENT") {
            return false;
        }
        throw e;
    }
}

async function logAudit(db: admin.firestore.Firestore, poolId: string, message: string, type: AuditEventType, payload?: Record<string, unknown>) {
    const auditRef = db.collection("pools").doc(poolId).collection("audit").doc();
    const event: AuditLogEvent = {
        id: auditRef.id,
        poolId,
        timestamp: Date.now(),
        type,
        message,
        severity: "INFO",
        actor: { uid: "SYSTEM", role: "SYSTEM", label: "SmartReminders" },
        payload,
        dedupeKey: payload?.dedupeKey as string | undefined
    };
    await auditRef.set(event);
}

// --- SCHEDULED REMINDER LOGIC ---

export const runReminders = functions.scheduler.onSchedule("every 5 minutes", async () => {
    const db = admin.firestore();
    const now = Date.now();
    console.log(`[runReminders] Starting reminder check at ${new Date(now).toISOString()}`);
    const poolsSnapshot = await db.collection("pools").get();
    console.log(`[runReminders] Found ${poolsSnapshot.size} pools to check`);

    for (const doc of poolsSnapshot.docs) {
        try {
            const poolData = doc.data();
            const pool = { id: doc.id, ...poolData } as unknown as Pool; // Better type casting

            // --- TYPE: SQUARES or PROPS --- 
            if (pool.type === 'SQUARES' || pool.type === 'PROPS' || !pool.type) {
                if (!pool.reminders) continue;
                if (pool.reminders.payment?.enabled && pool.type === 'SQUARES') await checkPaymentReminders(db, pool as GameState, now);
                if (pool.reminders.lock?.enabled && (pool.type === 'SQUARES' || !pool.type)) await checkLockReminders(db, pool as GameState, now);
            }

            // --- TYPE: NFL PLAYOFFS ---
            else if (pool.type === 'NFL_PLAYOFFS') {
                await checkPlayoffReminders(db, pool, now);
            }

            // --- TYPE: BRACKET ---
            else if (pool.type === 'BRACKET') {
                await checkBracketReminders(db, pool as BracketPool, now);
            }

            // --- TYPE: NFL SEASON POOLS (Pick'em / Survivor / Margin) ---
            else if (pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {
                await checkNFLNonPickerReminders(db, pool as NFLSeasonPool, now);
            }

        } catch (poolError: unknown) {
            console.error(`[runReminders] Error processing pool ${doc.id}:`, poolError);
        }
    }
    console.log(`[runReminders] Completed reminder check`);
});

// --- PLAYOFF REMINDER LOGIC ---
async function checkPlayoffReminders(db: admin.firestore.Firestore, pool: PlayoffPool, now: number) {
    // 1. Check if locking soon (Start of Wild Card is traditionally the lock)
    // Using `lockDate` or `lockAt` if available.
    const lockTime = pool.lockDate;
    if (!lockTime) return;

    // Time Check: Is it within 2 hours of lock?
    const msUntilLock = lockTime - now;
    const hoursUntilLock = msUntilLock / (1000 * 60 * 60);

    // Only send if between 0 and 2 hours
    if (hoursUntilLock > 2 || hoursUntilLock <= 0) return;

    // 2. Find Unpaid Entries that haven't been reminded
    const entries = pool.entries || {};
    const updates: Record<string, unknown> = {};
    const emailsToSend: { email: string, name: string, entryName: string, phone?: string, smsOptIn?: boolean }[] = [];

    for (const [entryId, entry] of Object.entries(entries) as [string, PlayoffEntry][]) {
        if (!entry.paid && !entry.paymentReminderSent) {
            // Need user email. PlayoffEntry stores userId.
            // Ideally we'd have it denormalized, but let's try to fetch or skip if missing.
            // Optimization: Maybe we fetched all users? No, too expensive.
            // Only fetch if we are going to send.

            // Wait - we can't fetch individual users inside this loop efficiently if there are many.
            // But usually pools are small (10-50 ppl).
            if (entry.userId) {
                const userSnap = await db.collection('users').doc(entry.userId).get();
                if (userSnap.exists) {
                    const userData = userSnap.data();
                    const email = userData?.email;
                    if (email) {
                        emailsToSend.push({
                            email,
                            name: entry.userName,
                            entryName: entry.entryName || 'Entry',
                            phone: userData?.phone,
                            smsOptIn: userData?.smsOptIn
                        });
                        // Mark as sent immediately in memory updates
                        updates[`entries.${entryId}.paymentReminderSent`] = true;
                    }
                }
            }
        }
    }

    if (emailsToSend.length > 0) {
        console.log(`[PlayoffReminders] Sending ${emailsToSend.length} payment reminders for pool ${pool.id}`);

        // Send Emails and SMS
        for (const recipient of emailsToSend) {
            const subject = `Action Required: Payment Due for ${pool.name}`;
            const body = `
                <p>Hi ${escapeHtml(recipient.name)},</p>
                <p>The pool <strong>${escapeHtml(pool.name)}</strong> locks in less than 2 hours!</p>
                <p>Your entry "<strong>${escapeHtml(recipient.entryName)}</strong>" is currently marked as <strong>Unpaid</strong>.</p>
                
                <div style="background-color: #fff1f2; border: 1px solid #e11d48; border-radius: 8px; padding: 15px; margin: 20px 0; color: #9f1239;">
                    <p style="margin: 0; font-weight: bold;">⚠️ Payment Needed</p>
                    <p style="margin: 5px 0 0 0;">Please pay the pool manager to secure your spot.</p>
                </div>

                ${pool.settings?.paymentInstructions ? `<p><strong>Instructions:</strong> ${escapeHtml(pool.settings.paymentInstructions)}</p>` : ''}
            `;
            const html = renderEmailHtml('Payment Reminder', body, `${BASE_URL}/pool/${pool.id}`, 'View Pool');

            // Queue Email
            await sendEmail(db, recipient.email, subject, html, { category: 'reminders' });

            // Send SMS if opted in and pool enables SMS
            if (pool.reminders?.smsEnabled && recipient.smsOptIn && recipient.phone) {
                const smsMessage = `Hi ${recipient.name}, your entry "${recipient.entryName}" in ${pool.name} is Unpaid. Pool locks in < 2 hours!`;
                await sendCourierSMS(recipient.phone, smsMessage);
            }
        }

        // Apply Updates (mark as sent)
        await db.collection('pools').doc(pool.id).update(updates);
    }
}

export async function checkPaymentReminders(db: admin.firestore.Firestore, pool: GameState, now: number) {
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
    const hostSent = await createNotificationOnce(db, hostKey, {
        poolId: pool.id,
        type: 'PAYMENT_HOST',
        recipient: pool.contactEmail,
        sentAt: now,
        status: 'SENT',
        metadata: { count: unpaidSquares.length }
    });

    if (hostSent) {
        const emailBody = `
            <p>Hi ${escapeHtml(pool.managerName)},</p>
            <p>You have ${unpaidSquares.length} squares that are reserved but unpaid.</p>
        `;
        const html = renderEmailHtml(`Action Needed: Unpaid Squares`, emailBody, `${BASE_URL}/pool/${pool.id}`, 'Manage Pool');
        await sendEmail(db, pool.contactEmail, `Action Needed: ${unpaidSquares.length} Unpaid Squares`, html, { category: 'reminders' });
        await logAudit(db, pool.id, `Sent payment reminder to host (${unpaidSquares.length} unpaid)`, 'NOTIFICATION_SENT', { dedupeKey: hostKey });
    }

    // USER REMINDERS (Optional)
    if (settings.notifyUsers) {
        // Emails live in the restricted squarePrivate subcollection, keyed by squareId.
        const privateMap = await getSquarePrivateMap(db, pool.id);
        const squaresByOwner = unpaidSquares.reduce((acc, s) => {
            const email = privateMap.get(s.id)?.email;
            if (email) {
                if (!acc[email]) acc[email] = [];
                acc[email].push(s);
            }
            return acc;
        }, {} as Record<string, Square[]>);

        for (const [email, squares] of Object.entries(squaresByOwner)) {
            const userKey = `PAY_USER:${pool.id}:${email}:${timeBucket}`;
            const userSent = await createNotificationOnce(db, userKey, {
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
                    <p>You have ${squares.length} squares pending payment in <strong>${escapeHtml(pool.name)}</strong>.</p>
                    <p>Please pay the host: ${escapeHtml(pool.paymentInstructions || 'See pool details')}</p>
                `;
                    const html = renderEmailHtml(`Payment Reminder`, emailBody, `${BASE_URL}/pool/${pool.id}`, 'View Pool');
                    await sendEmail(db, email, `Reminder: ${squares.length} Squares Pending Payment`, html, { category: 'reminders' });
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
                            // PII cleanup for released squares is handled by onSquareReleased.
                            return {
                                ...s,
                                owner: null,
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
                        updatedAt: FieldValue.serverTimestamp()
                    });
                });

                // Log audit event
                await logAudit(db, pool.id, `Auto-released ${squaresToRelease.length} unpaid squares after ${settings.autoReleaseHours} hours`, 'NOTIFICATION_SENT', {
                    releasedSquares: squaresToRelease.map(s => s.id),
                    autoReleaseHours: settings.autoReleaseHours
                });

                // Notify waitlist if any
                if (pool.waitlist && pool.waitlist.length > 0) {
                    // Waitlist notification is now handled by the onSquareReleased trigger.
                }

                // Notify host
                const emailBody = `
                    <p>Hi ${escapeHtml(pool.managerName)},</p>
                    <p><strong>${squaresToRelease.length} squares</strong> have been automatically released due to non-payment after ${settings.autoReleaseHours} hours.</p>
                    <p>Released squares: ${squaresToRelease.map(s => `#${s.id}`).join(', ')}</p>
                `;
                const html = renderEmailHtml(`Squares Auto-Released`, emailBody, `${BASE_URL}/pool/${pool.id}`, 'View Pool');
                await sendEmail(db, pool.contactEmail, `${squaresToRelease.length} Squares Auto-Released: ${pool.name}`, html);

                console.log(`[AutoRelease] Released ${squaresToRelease.length} squares from pool ${pool.id}`);
            } catch (e) {
                console.error(`[AutoRelease] Error releasing squares for pool ${pool.id}:`, e);
            }
        }
    }
}

// --- WAITLIST NOTIFICATION ---
export async function notifyWaitlist(db: admin.firestore.Firestore, pool: GameState, releasedCount: number) {
    if (!pool.waitlist || pool.waitlist.length === 0) return;

    const emailSubject = `Squares Available: ${pool.name}`;
    const emailBody = `
        <p>Good news! <strong>${releasedCount} squares</strong> have just become available in ${escapeHtml(pool.name)}.</p>
        <p>First come, first served! Click below to claim your squares now.</p>
    `;
    const html = renderEmailHtml(`Squares Available!`, emailBody, `${BASE_URL}/pool/${pool.id}`, 'Claim Squares Now');

    for (const entry of pool.waitlist) {
        await sendEmail(db, entry.email, emailSubject, html, { category: 'announcements' });
    }

    await logAudit(db, pool.id, `Notified ${pool.waitlist.length} waitlisted users about ${releasedCount} released squares`, 'NOTIFICATION_SENT', {
        waitlistCount: pool.waitlist.length,
        releasedCount
    });
}

// Removed duplicate import

async function checkLockReminders(db: admin.firestore.Firestore, pool: GameState | PropsPool, now: number) {
    const settings = pool.reminders!.lock;
    if (!settings.lockAt) return;

    // Robust handling of lockAt (could be number or Timestamp)
    const lockAtNum = typeof settings.lockAt === 'number'
        ? settings.lockAt
        : (settings.lockAt as admin.firestore.Timestamp)?.toMillis?.() || new Date(settings.lockAt as number | string | Date).getTime();

    if (isNaN(lockAtNum)) {
        console.warn(`[checkLockReminders] Invalid lockAt for pool ${pool.id}:`, settings.lockAt);
        return;
    }

    const msUntilLock = lockAtNum - now;
    const minutesUntilLock = msUntilLock / 1000 / 60;

    if (minutesUntilLock <= 0) {
        // Time has passed: Execute Auto-Lock if not already locked
        if (!pool.isLocked) {
            if (pool.type === 'SQUARES' || !pool.type) {
                await executeAutoLock(db, pool as GameState);
            } else {
                // TODO: Implement auto-lock for Props
                console.log(`[AutoLock] Props pool auto-lock not implemented yet: ${pool.id}`);
            }
        }
        return;
    }

    for (const scheduleMin of settings.scheduleMinutes) {
        // Window: +/- 10 minutes
        const diff = Math.abs(minutesUntilLock - scheduleMin);
        if (diff <= 10) {
            const key = `LOCK:${pool.id}:${settings.lockAt}:${scheduleMin}`;
            const sent = await createNotificationOnce(db, key, {
                poolId: pool.id,
                type: 'LOCK_COUNTDOWN',
                recipient: 'ALL_PARTICIPANTS', // conceptual
                sentAt: now,
                status: 'SENT',
                metadata: { minutesLeft: scheduleMin }
            });

            if (sent) {
                // Email Host
                const contactEmail = pool.contactEmail;
                if (contactEmail) {
                    const hostBody = `<p>Your pool <strong>${escapeHtml(pool.name)}</strong> locks soon.</p>`;
                    const hostHtml = renderEmailHtml(`Pool Locking Soon`, hostBody, `${BASE_URL}/pool/${pool.id}`, 'Manage Pool');
                    await sendEmail(db, contactEmail, `Pool Locking in ${Math.round(minutesUntilLock / 60)} Hours`, hostHtml, { category: 'reminders' });
                }

                if (pool.type === 'SQUARES' || !pool.type) {
                    const uniqueEmails = await getSquareEmails(db, pool.id);
                    for (const email of uniqueEmails) {
                        const userBody = `<p>The pool locks in approximately ${Math.round(minutesUntilLock / 60)} hours.</p>`;
                        const userHtml = renderEmailHtml(`Grid Locking Soon: ${pool.name}`, userBody, `${BASE_URL}/pool/${pool.id}`, 'Check Your Squares');
                        await sendEmail(db, email, `Grid Locking Soon: ${pool.name}`, userHtml, { category: 'reminders' });
                    }
                }

                await logAudit(db, pool.id, `Sent lock reminder (${scheduleMin} min warning)`, 'NOTIFICATION_SENT', { dedupeKey: key });
            }
        }
    }
}

// --- WINNER ANNOUNCEMENT TRIGGER ---

export const onWinnerComputed = functions.firestore.onDocumentCreated("pools/{poolId}/winners/{period}", async (event) => {
    const db = admin.firestore();
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
    const sent = await createNotificationOnce(db, key, {
        poolId: pool.id,
        type: 'WINNER_ANNOUNCEMENT',
        recipient: 'ALL',
        sentAt: Date.now(),
        status: 'SENT',
        metadata: { period, winner: winnerData.owner }
    });

    if (sent) {
        const uniqueEmails = await getSquareEmails(db, pool.id);

        // Add Host
        if (pool.contactEmail && !uniqueEmails.includes(pool.contactEmail)) {
            uniqueEmails.push(pool.contactEmail);
        }

        const subject = `Winner Alert: ${period.toUpperCase()} - ${winnerData.owner}`;

        // Construct body content (no H2 needed, title handled by wrapper)
        const bodyContent = `
                <p><strong>${period.toUpperCase()} Winner:</strong> ${escapeHtml(winnerData.owner)}</p>
                <p><strong>Square:</strong> ${Math.floor(winnerData.squareId / 10)} - ${winnerData.squareId % 10}</p>
                <p><strong>Amount:</strong> $${winnerData.amount}</p>
                ${settings.includeDigits ? `<p><strong>Winning Digits:</strong> Home ${winnerData.homeDigit} - Away ${winnerData.awayDigit}</p>` : ''}
            `;

        const html = renderEmailHtml(`${pool.name} Winner Alert`, bodyContent, `${BASE_URL}/pool/${pool.id}`, 'View Full Grid');

        // Batch send (naive loop for MVP)
        for (const email of uniqueEmails) {
            await sendEmail(db, email, subject, html, { category: 'results' });
        }

        await logAudit(db, pool.id, `Sent winner announcement for ${period}`, 'NOTIFICATION_SENT', { dedupeKey: key });
    }
});

// --- AUTO LOCK LOGIC ---

// --- HELPER: GENERATE DIGITS ---
function generateDigits(): number[] {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
}

// --- EXECUTE AUTO LOCK ---
async function executeAutoLock(db: admin.firestore.Firestore, pool: GameState) {
    const poolRef = db.collection('pools').doc(pool.id);

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

            const updates: Record<string, unknown> = {
                isLocked: true,
                lockGrid: true, // Legacy/UI sync
                axisNumbers,
                updatedAt: Timestamp.now(),
            };

            // Handle 4-Set initialization
            if (currentPool.numberSets === 4) {
                updates.quarterlyNumbers = {
                    q1: axisNumbers
                };
            }

            t.update(poolRef, updates);

            // CRITICAL FIX: Skip dedupe to avoid read-after-write transaction errors
            // Audit Logs
            await writeAuditEvent({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
                // NO dedupeKey - auto-lock should only happen once anyway
            }, t);

            const digitsHash = computeDigitsHash({ home: axisNumbers.home, away: axisNumbers.away, poolId: pool.id, period: 'q1' });
            await writeAuditEvent({
                poolId: pool.id,
                type: 'DIGITS_GENERATED',
                message: 'Auto-Generated Axis Numbers upon Auto-Lock',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' },
                payload: { period: 'initial', commitHash: digitsHash, numberSets: currentPool.numberSets }
                // NO dedupeKey - prevent read-after-write error
            }, t);
        });

        console.log(`[AutoLock] SUCCESSFULLY LOCKED: ${pool.id}`);
    } catch (e) {
        console.error(`[AutoLock] Failed to lock pool ${pool.id}:`, e);
    }
}

// --- BRACKET REMINDER LOGIC ---
async function checkBracketReminders(db: admin.firestore.Firestore, pool: BracketPool, now: number) {
    if (!pool.lockAt) return;

    const msUntilLock = pool.lockAt - now;
    const hoursUntilLock = msUntilLock / (1000 * 60 * 60);

    const is24h = hoursUntilLock <= 24 && hoursUntilLock > 23.8;
    const is1h = hoursUntilLock <= 1 && hoursUntilLock > 0.8;
    const isLockMsg = hoursUntilLock <= 0 && hoursUntilLock > -0.2;

    let trigger = '';
    let emailSubject = '';
    let emailBody = '';
    let smsBody = '';

    if (is24h && pool.reminders?.auto24h) {
        trigger = '24h';
        emailSubject = `24 Hours to Lock: ${pool.name}`;
        emailBody = `<p>Your bracket pool <strong>${escapeHtml(pool.name)}</strong> locks in exactly 24 hours. Make sure your entries are filled out and paid.</p>`;
        smsBody = `Pool ${pool.name} locks in 24 hours! Get your bracket in.`;
    } else if (is1h && pool.reminders?.auto1h) {
        trigger = '1h';
        emailSubject = `1 Hour WARNING: ${pool.name}`;
        emailBody = `<p>Your bracket pool <strong>${escapeHtml(pool.name)}</strong> is locking in 1 HOUR! Finalize your entries now.</p>`;
        smsBody = `1 HOUR WARNING! Pool ${pool.name} locks soon.`;
    } else if (isLockMsg) {
        trigger = 'locked';
        emailSubject = `Pool Locked: ${pool.name}`;
        emailBody = `<p>Your bracket pool <strong>${escapeHtml(pool.name)}</strong> is now locked. Good luck!</p>`;
        smsBody = `Pool ${pool.name} is now locked! Good luck.`;
    } else {
        return;
    }

    const key = `BRACKET_REMINDER:${pool.id}:${trigger}`;
    const sent = await createNotificationOnce(db, key, {
        poolId: pool.id,
        type: 'LOCK_COUNTDOWN',
        recipient: 'ALL_PARTICIPANTS',
        sentAt: now,
        status: 'SENT',
        metadata: { trigger }
    });

    if (sent) {
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        const uids = entriesSnap.docs.map(doc => (doc.data() as BracketEntry).ownerUid).filter(Boolean); // using BracketEntry for typings
        const uniqueUids = Array.from(new Set(uids)) as string[];

        let smsSentCount = 0;
        let emailsSentCount = 0;

        for (const uid of uniqueUids) {
            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) continue;
            const userData = userDoc.data() as User;

            if (userData.email) {
                const html = renderEmailHtml(emailSubject, emailBody, `${BASE_URL}/pool/${pool.id}`, 'View Pool');
                await sendEmail(db, userData.email, emailSubject, html, { category: 'reminders' });
                emailsSentCount++;
            }

            if (pool.reminders?.smsEnabled && userData.smsOptIn && userData.phone) {
                await sendCourierSMS(userData.phone, smsBody);
                smsSentCount++;
            }
        }

        await logAudit(db, pool.id, `Sent ${trigger} bracket reminder (${emailsSentCount} emails, ${smsSentCount} SMS)`, 'NOTIFICATION_SENT', { dedupeKey: key });
    }
}

// --- NFL SEASON POOL NON-PICKER REMINDERS ---

type NFLSeasonPool = NFLPickemPool | NFLSurvivorPool | NFLMarginPool;

/**
 * Targeted reminders for members who haven't completed their picks for the
 * upcoming NFL week. Two tiers: T-36h (30h-36h before the week lock) and
 * T-4h (0-4h before). Unlike the generic lock reminders, this only emails
 * the members who still have picks outstanding.
 *
 * Default ON: pools without a reminders config still get these; commissioners
 * opt out via pool.reminders.lock.enabled === false.
 */
export async function checkNFLNonPickerReminders(db: admin.firestore.Firestore, pool: NFLSeasonPool, now: number) {
    try {
        // Off switch (default ON when the reminders config is absent — NFL pools
        // predate per-pool reminder settings).
        const reminders = (pool as unknown as { reminders?: { lock?: { enabled?: boolean } } }).reminders;
        if (reminders?.lock?.enabled === false) return;
        if (!pool.season || pool.status === 'archived') return;

        // --- 1. Determine the current week (cheap bail-out path) ---
        // One query on the existing (season, startTime) composite index.
        // seasonType is filtered in memory: an equality filter on it would
        // require a (season, seasonType, startTime) index that doesn't exist.
        const seasonType = Number((pool as unknown as { seasonType?: string | number }).seasonType || 2);
        const futureSnap = await db.collection('nfl_games')
            .where('season', '==', pool.season)
            .where('startTime', '>', now)
            .get();

        const futureGames = futureSnap.docs
            .map(d => d.data() as NFLGame)
            .filter(g => Number(g.seasonType) === seasonType);
        if (futureGames.length === 0) return; // Season over (or not ingested yet)

        const week = Math.min(...futureGames.map(g => g.week));

        // Fetch the FULL week (equality-only query, mirrors nflPools.ts — no
        // composite index needed) so the lock reflects the week's true earliest
        // kickoff even after the first game has started, and so pick'em
        // completeness covers every game of the week.
        const weekSnap = await db.collection('nfl_games')
            .where('season', '==', pool.season)
            .where('seasonType', '==', seasonType)
            .where('week', '==', week)
            .get();
        const weekGames = weekSnap.docs.map(d => d.data() as NFLGame);
        if (weekGames.length === 0) return;

        // --- 2. Effective week lock (mirrors nflPools.ts submitNFLPicks) ---
        const settings = (pool.settings ?? {}) as { lockBufferMinutes?: number; weekLockOverrides?: Record<number, number> };
        const lockBufferMs = (settings.lockBufferMinutes ?? 5) * 60 * 1000;
        const weekLockOverride: number | undefined = settings.weekLockOverrides?.[week];
        const computedLock = Math.min(...weekGames.map(g => g.startTime)) - lockBufferMs;
        // Commissioner deadline extensions act as a floor on the computed lock
        const effectiveLock = weekLockOverride !== undefined ? Math.max(weekLockOverride, computedLock) : computedLock;

        // --- 3. Send windows: bail fast before touching entries ---
        const hoursUntilLock = (effectiveLock - now) / (1000 * 60 * 60);
        let tier: '36H' | '4H' | null = null;
        if (hoursUntilLock <= 36 && hoursUntilLock > 30) tier = '36H';
        else if (hoursUntilLock <= 4 && hoursUntilLock > 0) tier = '4H';
        if (!tier) return;

        // --- 4. Find non-pickers ---
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        if (entriesSnap.empty) return;

        const weekGameIds = weekGames.map(g => g.id);
        const nonPickerUids = new Set<string>();
        for (const entryDoc of entriesSnap.docs) {
            const entry = entryDoc.data() as NFLPickemEntry | SurvivorEntry | MarginEntry;
            if (!entry.ownerUid) continue;

            let hasPicked: boolean;
            if (pool.type === 'NFL_PICKEM') {
                const picks = (entry as NFLPickemEntry).picks || {};
                hasPicked = weekGameIds.every(id => !!picks[id]);
            } else {
                if (pool.type === 'NFL_SURVIVOR' && (entry as SurvivorEntry).status === 'ELIMINATED') continue;
                hasPicked = !!(entry as SurvivorEntry | MarginEntry).picks?.[week];
            }
            if (!hasPicked) nonPickerUids.add(entry.ownerUid);
        }
        if (nonPickerUids.size === 0) return;

        const lockDateStr = new Date(effectiveLock).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
        }) + ' ET';
        const hoursLeft = Math.max(1, Math.round(hoursUntilLock));
        const picksWord = pool.type === 'NFL_PICKEM' ? 'picks' : 'pick';

        const subject = tier === '36H'
            ? `You haven't picked yet — Week ${week} locks in ~${hoursLeft} hours`
            : `Last call: Week ${week} locks soon — ${pool.name}`;
        const title = tier === '36H' ? `Week ${week} Pick Reminder` : `Last Call: Week ${week}`;

        let sentCount = 0;
        for (const uid of nonPickerUids) {
            // One send per tier per week per user
            const key = `NFL_NONPICK_${tier}:${pool.id}:${uid}:${week}`;
            const shouldSend = await createNotificationOnce(db, key, {
                poolId: pool.id,
                type: 'LOCK_COUNTDOWN',
                recipient: uid,
                sentAt: now,
                status: 'SENT',
                metadata: { tier, week, effectiveLock }
            });
            if (!shouldSend) continue;

            const userSnap = await db.collection('users').doc(uid).get();
            const email = userSnap.exists ? (userSnap.data() as User)?.email : undefined;
            if (!email) continue;

            const body = `
                <p>You haven't made your Week ${week} ${picksWord} in <strong>${escapeHtml(pool.name)}</strong> yet.</p>
                <p><strong>Week ${week} locks:</strong> ${lockDateStr}</p>
                <p>Don't get caught with an empty slate — lock in your ${picksWord} now.</p>
            `;
            const html = renderEmailHtml(title, body, `${BASE_URL}/pool/${pool.id}`, 'Make Your Picks');
            await sendEmail(db, email, subject, html, { poolId: pool.id, category: 'reminders' });
            sentCount++;
        }

        if (sentCount > 0) {
            await logAudit(db, pool.id, `Sent T-${tier} non-picker reminders for Week ${week} (${sentCount} emails)`, 'NOTIFICATION_SENT', { tier, week, sentCount });
        }
    } catch (e) {
        // Tolerate transient/mocked db failures — never break the scheduler loop
        console.error(`[NFLNonPickerReminders] Error for pool ${pool.id}:`, e);
    }
}
