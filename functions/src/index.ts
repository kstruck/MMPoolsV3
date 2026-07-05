import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

// Exported Cloud Functions
export { lockPool } from "./poolParams";
export { reserveSquare, markSquaresPaid, updatePlayer, releaseSquares } from './squares';
export { confirmPayment } from './confirmPayment';
export { purchasePropCard, gradeProp, updatePropCard } from './propBets';
export { syncGameStatus, fixPoolScores, simulateGameUpdate } from "./scoreUpdates";
export { onWinnerUpdate, onAIRequest, onWeeklyRecapCreated } from "./aiCommissioner";
export { onUserCreated, syncAllUsers } from "./userSync";
export { deleteUserAccount, sendAdminPasswordReset, sendSecuritySMSAlert, testSmsHttp } from "./userManagement";
export { runReminders, onWinnerComputed } from "./reminders";
export { autoLockPools } from "./autoLock"; // NEW: Dedicated 1-minute auto-lock scheduler
export { onPoolLocked, recalculateGlobalStats } from "./statsTrigger";
export { onUserCreated as createParticipantProfile, createClaimCode, claimMySquares, claimByCode, syncParticipantIndices } from "./participant";
export { createPool, updatePoolSettings, recalculatePoolWinners, toggleWinnerPaid, fixParticipantIds } from "./poolOps";
export { backfillPools } from "./backfill";
export { createBracketPool, publishBracketPool, joinBracketPool } from "./bracketPools";
export { createBracketEntry, updateBracketEntry, submitBracketEntry, deleteBracketEntry } from "./bracketEntries";
export { markEntryPaidStatus, updateTournamentData } from "./bracketOps";
export { adminInitTournament, syncBracketTournament, scheduledBracketSync, importTournamentFromESPN, importConferenceTournamentFromESPN } from "./espnBracket";
export { onGameComplete } from "./postGameEmail";
export { onAnnouncementCreated } from "./announcements";
export { submitPlayoffPicks, calculatePlayoffScores, updateGlobalPlayoffResults, checkPlayoffScores, onPlayoffConfigUpdate, syncPlayoffPools, managePlayoffEntry } from "./playoffPools";
export { joinWaitlist, onSquareReleased } from "./waitlist";
export { generateTestScenario, validateTestResults, generateTestReport } from "./aiTesting";
export { setUserRole, setSuperAdminClaim, syncMyClaims } from "./adminClaims";
export { logAdminAction } from "./adminOps";
export { initializeBigEastTournamentHttp, initializeBig12TournamentHttp } from "./conferenceTournaments";
export { scoreBracketEntries, finalizeTournamentPayouts } from "./bracketScoring";

// --- NFL POOLS FUNCTIONS ---
export { syncNFLScoresJob, importNFLSchedule } from "./nflSchedule";
export { createNFLPool, joinNFLPool, submitNFLPicks, executeSurvivorRebuy, scoreNFLWeek } from "./nflPools";
export { sendManualReminder } from "./manualReminders";

// --- BILLING & MONETIZATION ---
export { enforceBillingStatus, validateBillingAccess, redeemCoupon, onPoolParticipantChange } from "./billing";

// --- STRIPE PAYMENTS ---
export { createCheckoutSession, handleStripeWebhook } from "./stripe";

// --- SOCIAL LINK PREVIEWS (per-pool OG tags for /join/:id shares) ---
export { joinPreview } from "./joinPreview";

// --- REFERRAL SYSTEM ---
export { creditReferralOnPayment, generateReferralToken, resolveReferralToken } from "./referral";

// --- SERVER TIME (client clock-drift correction for countdown/lock UI) ---
export { getServerTime } from "./serverTime";

// --- ADMIN HEALTH (real Super-Admin Overview vitals; replaces fake status card) ---
export { getAdminHealthSnapshot } from "./adminHealth";

// --- REVENUE AGGREGATES (platform revenue from billingCharges → admin_stats/revenue) ---
export { aggregateRevenueDaily, recomputeRevenue } from "./revenueAggregates";

// --- EMAIL PREFERENCES (unsubscribe compliance + category preferences) ---
export { emailUnsubscribe } from "./emailUnsubscribeHttp";
export { manageEmailPrefs } from "./emailPrefsPage";

// --- COMMISSIONER EXCEPTION TOOLS (audited mid-season corrections) ---
export { extendWeekDeadline, proxyPick, cancelPool } from "./poolExceptions";

// --- POOL INVITES (bulk email invites) ---
export { sendPoolInvites } from "./invites";

