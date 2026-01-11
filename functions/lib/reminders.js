"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onWinnerComputed = exports.runReminders = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const audit_1 = require("./audit");
const emailStyles_1 = require("./emailStyles");
// --- HELPERS ---
/**
 * Sends an email by writing to the /mail collection (triggered by EmailJS or other service).
 */
async function sendEmail(to, subject, html, context) {
    const db = admin.firestore();
    if (!to || !to.includes('@')) {
        console.warn(`Skipping email to invalid address: ${to}`);
        return;
    }
    try {
        await db.collection("mail").add(Object.assign(Object.assign({ to, message: {
                subject,
                html,
            } }, context), { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`Email queued for ${to}: ${subject}`);
    }
    catch (error) {
        console.error("Error queuing email:", error);
    }
}
/**
 * Idempotency check: Creates a notification log if it doesn't exist.
 * Returns true if created (should send), false if already exists (skip).
 */
async function createNotificationOnce(dedupeKey, logData) {
    const db = admin.firestore();
    const ref = db.collection("notifications").doc(dedupeKey);
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (doc.exists) {
                throw new Error("ALREADY_SENT");
            }
            t.set(ref, Object.assign(Object.assign({}, logData), { id: dedupeKey }));
        });
        return true;
    }
    catch (e) {
        if (e.message === "ALREADY_SENT") {
            return false;
        }
        throw e;
    }
}
async function logAudit(poolId, message, type, payload) {
    const db = admin.firestore();
    const auditRef = db.collection("pools").doc(poolId).collection("audit").doc();
    const event = {
        id: auditRef.id,
        poolId,
        timestamp: Date.now(),
        type: "POOL_STATUS_CHANGED", // Reusing generic type or add NOTIFICATION_SENT
        message,
        severity: "INFO",
        actor: { uid: "SYSTEM", role: "SYSTEM", label: "SmartReminders" },
        payload,
        dedupeKey: payload === null || payload === void 0 ? void 0 : payload.dedupeKey
    };
    await auditRef.set(event);
}
// --- SCHEDULED REMINDER LOGIC ---
exports.runReminders = functions.scheduler.onSchedule("every 15 minutes", async (event) => {
    var _a, _b;
    const db = admin.firestore();
    const now = Date.now();
    console.log(`[runReminders] Starting reminder check at ${new Date(now).toISOString()}`);
    const poolsSnapshot = await db.collection("pools").get();
    console.log(`[runReminders] Found ${poolsSnapshot.size} pools to check`);
    for (const doc of poolsSnapshot.docs) {
        try {
            const poolData = doc.data();
            const pool = Object.assign({ id: doc.id }, poolData); // Loose type to handle unions
            // --- TYPE: SQUARES or PROPS --- 
            if (pool.type === 'SQUARES' || pool.type === 'PROPS' || !pool.type) {
                if (!pool.reminders)
                    continue;
                if ((_a = pool.reminders.payment) === null || _a === void 0 ? void 0 : _a.enabled)
                    await checkPaymentReminders(pool, now);
                if ((_b = pool.reminders.lock) === null || _b === void 0 ? void 0 : _b.enabled)
                    await checkLockReminders(pool, now);
            }
            // --- TYPE: NFL PLAYOFFS ---
            else if (pool.type === 'NFL_PLAYOFFS') {
                await checkPlayoffReminders(pool, now);
            }
        }
        catch (poolError) {
            console.error(`[runReminders] Error processing pool ${doc.id}:`, poolError);
        }
    }
    console.log(`[runReminders] Completed reminder check`);
});
// --- PLAYOFF REMINDER LOGIC ---
async function checkPlayoffReminders(pool, now) {
    var _a, _b;
    // 1. Check if locking soon (Start of Wild Card is traditionally the lock)
    // Using `lockDate` or `lockAt` if available.
    const lockTime = pool.lockDate || pool.lockAt;
    if (!lockTime)
        return;
    // Time Check: Is it within 2 hours of lock?
    const msUntilLock = lockTime - now;
    const hoursUntilLock = msUntilLock / (1000 * 60 * 60);
    // Only send if between 0 and 2 hours
    if (hoursUntilLock > 2 || hoursUntilLock <= 0)
        return;
    // 2. Find Unpaid Entries that haven't been reminded
    const entries = pool.entries || {};
    const updates = {};
    const emailsToSend = [];
    for (const [entryId, entry] of Object.entries(entries)) {
        if (!entry.paid && !entry.paymentReminderSent) {
            // Need user email. PlayoffEntry stores userId.
            // Ideally we'd have it denormalized, but let's try to fetch or skip if missing.
            // Optimization: Maybe we fetched all users? No, too expensive.
            // Only fetch if we are going to send.
            // Wait - we can't fetch individual users inside this loop efficiently if there are many.
            // But usually pools are small (10-50 ppl).
            if (entry.userId) {
                const db = admin.firestore();
                const userSnap = await db.collection('users').doc(entry.userId).get();
                if (userSnap.exists) {
                    const email = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.email;
                    if (email) {
                        emailsToSend.push({ email, name: entry.userName, entryName: entry.entryName });
                        // Mark as sent immediately in memory updates
                        updates[`entries.${entryId}.paymentReminderSent`] = true;
                    }
                }
            }
        }
    }
    if (emailsToSend.length > 0) {
        console.log(`[PlayoffReminders] Sending ${emailsToSend.length} payment reminders for pool ${pool.id}`);
        // Send Emails
        for (const recipient of emailsToSend) {
            const subject = `Action Required: Payment Due for ${pool.name}`;
            const body = `
                <p>Hi ${recipient.name},</p>
                <p>The pool <strong>${pool.name}</strong> locks in less than 2 hours!</p>
                <p>Your entry "<strong>${recipient.entryName}</strong>" is currently marked as <strong>Unpaid</strong>.</p>
                
                <div style="background-color: #fff1f2; border: 1px solid #e11d48; border-radius: 8px; padding: 15px; margin: 20px 0; color: #9f1239;">
                    <p style="margin: 0; font-weight: bold;">⚠️ Payment Needed</p>
                    <p style="margin: 5px 0 0 0;">Please pay the pool manager to secure your spot.</p>
                </div>

                ${((_b = pool.settings) === null || _b === void 0 ? void 0 : _b.paymentInstructions) ? `<p><strong>Instructions:</strong> ${pool.settings.paymentInstructions}</p>` : ''}
            `;
            const html = (0, emailStyles_1.renderEmailHtml)('Payment Reminder', body, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'View Pool');
            // Queue Email
            const db = admin.firestore();
            await db.collection("mail").add({
                to: recipient.email,
                message: { subject, html }
            });
        }
        // Apply Updates (mark as sent)
        const db = admin.firestore();
        await db.collection('pools').doc(pool.id).update(updates);
    }
}
async function checkPaymentReminders(pool, now) {
    const settings = pool.reminders.payment;
    const bucketSizeMs = settings.repeatEveryHours * 60 * 60 * 1000;
    const timeBucket = Math.floor(now / bucketSizeMs);
    // Identify unpaid squares past grace period
    const unpaidSquares = pool.squares.filter(s => {
        if (s.isPaid || !s.owner)
            return false;
        // Assumption: 'reservedAt' is tracked. If not, we might need to rely on other signals or assume creation.
        // For MVP, if we don't store reservedAt on square, we skip time check or assume always eligible if unpaid.
        // Let's assume we proceed if it's reserved and not paid.
        return true;
    });
    if (unpaidSquares.length === 0)
        return;
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
        const html = (0, emailStyles_1.renderEmailHtml)(`Action Needed: Unpaid Squares`, emailBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'Manage Pool');
        await sendEmail(pool.contactEmail, `Action Needed: ${unpaidSquares.length} Unpaid Squares`, html);
        await logAudit(pool.id, `Sent payment reminder to host (${unpaidSquares.length} unpaid)`, 'NOTIFICATION_SENT', { dedupeKey: hostKey });
    }
    // USER REMINDERS (Optional)
    if (settings.notifyUsers) {
        const squaresByOwner = unpaidSquares.reduce((acc, s) => {
            var _a;
            if ((_a = s.playerDetails) === null || _a === void 0 ? void 0 : _a.email) {
                if (!acc[s.playerDetails.email])
                    acc[s.playerDetails.email] = [];
                acc[s.playerDetails.email].push(s);
            }
            return acc;
        }, {});
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
                    const html = (0, emailStyles_1.renderEmailHtml)(`Payment Reminder`, emailBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'View Pool');
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
            if (s.isPaid || !s.owner)
                return false;
            if (!s.reservedAt)
                return false; // Can't auto-release without reservedAt timestamp
            return (now - s.reservedAt) > releaseThresholdMs;
        });
        if (squaresToRelease.length > 0) {
            const db = admin.firestore();
            const poolRef = db.collection("pools").doc(pool.id);
            try {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(poolRef);
                    if (!doc.exists)
                        return;
                    const currentPool = doc.data();
                    const updatedSquares = currentPool.squares.map(s => {
                        const shouldRelease = squaresToRelease.some(r => r.id === s.id);
                        if (shouldRelease) {
                            return Object.assign(Object.assign({}, s), { owner: null, playerDetails: undefined, guestDeviceKey: null, guestClaimId: null, reservedAt: null, reservedByUid: null });
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
                const html = (0, emailStyles_1.renderEmailHtml)(`Squares Auto-Released`, emailBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'View Pool');
                await sendEmail(pool.contactEmail, `${squaresToRelease.length} Squares Auto-Released: ${pool.name}`, html);
                console.log(`[AutoRelease] Released ${squaresToRelease.length} squares from pool ${pool.id}`);
            }
            catch (e) {
                console.error(`[AutoRelease] Error releasing squares for pool ${pool.id}:`, e);
            }
        }
    }
}
// --- WAITLIST NOTIFICATION ---
async function notifyWaitlist(pool, releasedCount) {
    if (!pool.waitlist || pool.waitlist.length === 0)
        return;
    const emailSubject = `Squares Available: ${pool.name}`;
    const emailBody = `
        <p>Good news! <strong>${releasedCount} squares</strong> have just become available in ${pool.name}.</p>
        <p>First come, first served! Click below to claim your squares now.</p>
    `;
    const html = (0, emailStyles_1.renderEmailHtml)(`Squares Available!`, emailBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'Claim Squares Now');
    for (const entry of pool.waitlist) {
        await sendEmail(entry.email, emailSubject, html);
    }
    await logAudit(pool.id, `Notified ${pool.waitlist.length} waitlisted users about ${releasedCount} released squares`, 'NOTIFICATION_SENT', {
        waitlistCount: pool.waitlist.length,
        releasedCount
    });
}
async function checkLockReminders(pool, now) {
    var _a, _b;
    const settings = pool.reminders.lock;
    if (!settings.lockAt)
        return;
    // Robust handling of lockAt (could be number or Timestamp)
    const lockAtNum = typeof settings.lockAt === 'number'
        ? settings.lockAt
        : ((_b = (_a = settings.lockAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date(settings.lockAt).getTime();
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
                const hostHtml = (0, emailStyles_1.renderEmailHtml)(`Pool Locking Soon`, hostBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'Manage Pool');
                await sendEmail(pool.contactEmail, `Pool Locking in ${Math.round(minutesUntilLock / 60)} Hours`, hostHtml);
                // Start: Email all participants if needed (expensive for free tier, maybe limit or skip for MVP if list huge)
                // For MVP, let's just email the host to trigger their manual blast if they want.
                // Or iterate unique emails from squares.
                const uniqueEmails = Array.from(new Set(pool.squares.map(s => { var _a; return (_a = s.playerDetails) === null || _a === void 0 ? void 0 : _a.email; }).filter(Boolean)));
                for (const email of uniqueEmails) {
                    const userBody = `<p>The pool locks in approximately ${Math.round(minutesUntilLock / 60)} hours.</p>`;
                    const userHtml = (0, emailStyles_1.renderEmailHtml)(`Grid Locking Soon: ${pool.name}`, userBody, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'Check Your Squares');
                    await sendEmail(email, `Grid Locking Soon: ${pool.name}`, userHtml);
                }
                await logAudit(pool.id, `Sent lock reminder (${scheduleMin} min warning)`, 'NOTIFICATION_SENT', { dedupeKey: key });
            }
        }
    }
}
// --- WINNER ANNOUNCEMENT TRIGGER ---
exports.onWinnerComputed = functions.firestore.onDocumentCreated("pools/{poolId}/winners/{period}", async (event) => {
    var _a, _b;
    const db = admin.firestore();
    const snapshot = event.data;
    if (!snapshot)
        return;
    const poolId = event.params.poolId;
    const winnerData = snapshot.data();
    const period = event.params.period;
    const poolDoc = await db.collection("pools").doc(poolId).get();
    const pool = poolDoc.data();
    if (!((_b = (_a = pool.reminders) === null || _a === void 0 ? void 0 : _a.winner) === null || _b === void 0 ? void 0 : _b.enabled))
        return;
    const settings = pool.reminders.winner;
    if (!settings.channels.includes("email"))
        return;
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
        const uniqueEmails = Array.from(new Set(pool.squares.map(s => { var _a; return (_a = s.playerDetails) === null || _a === void 0 ? void 0 : _a.email; }).filter(Boolean)));
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
        const html = (0, emailStyles_1.renderEmailHtml)(`${pool.name} Winner Alert`, bodyContent, `${emailStyles_1.BASE_URL}/#pool/${pool.id}`, 'View Full Grid');
        // Batch send (naive loop for MVP)
        for (const email of uniqueEmails) {
            await sendEmail(email, subject, html);
        }
        await logAudit(pool.id, `Sent winner announcement for ${period}`, 'NOTIFICATION_SENT', { dedupeKey: key });
    }
});
// --- AUTO LOCK LOGIC ---
// --- HELPER: GENERATE DIGITS ---
function generateDigits() {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
}
// --- EXECUTE AUTO LOCK ---
async function executeAutoLock(pool) {
    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(pool.id);
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists)
                return; // Deleted?
            const currentPool = doc.data();
            if (currentPool.isLocked) {
                console.log(`[AutoLock] Skipped - already locked: ${pool.id}`);
                return;
            }
            // Generate Digits
            const axisNumbers = {
                home: generateDigits(),
                away: generateDigits(),
            };
            let updates = {
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
            // CRITICAL FIX: Skip dedupe to avoid read-after-write transaction errors
            // Audit Logs
            await (0, audit_1.writeAuditEvent)({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
                // NO dedupeKey - auto-lock should only happen once anyway
            }, t);
            const digitsHash = (0, audit_1.computeDigitsHash)({ home: axisNumbers.home, away: axisNumbers.away, poolId: pool.id, period: 'q1' });
            await (0, audit_1.writeAuditEvent)({
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
    }
    catch (e) {
        console.error(`[AutoLock] Failed to lock pool ${pool.id}:`, e);
    }
}
//# sourceMappingURL=reminders.js.map