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
export { deleteUserAccount, sendAdminPasswordReset, sendSecuritySMSAlert, testSmsHttp, searchUsersByEmail, sendUserEmail } from "./userManagement";
export { runReminders, onWinnerComputed } from "./reminders";
export { autoLockPools } from "./autoLock"; // NEW: Dedicated 1-minute auto-lock scheduler
export { autoClosePools } from "./autoClosePools"; // T2: daily stuck-pool close sweep (dry-run + kill-switch)
export { onPoolLocked, recalculateGlobalStats, recomputeGlobalStatsDaily } from "./statsTrigger";
export { onUserCreated as createParticipantProfile, createClaimCode, claimMySquares, claimByCode, syncParticipantIndices } from "./participant";
export { createPool, updatePoolSettings, recalculatePoolWinners, toggleWinnerPaid, fixParticipantIds } from "./poolOps";
export { backfillPools } from "./backfill";
export { createBracketPool, publishBracketPool, joinBracketPool } from "./bracketPools";
export { createBracketEntry, updateBracketEntry, submitBracketEntry, deleteBracketEntry, updateEntryPayment, adminUpdateEntryOverrides, adminDeleteEntry } from "./bracketEntries";
export { markEntryPaidStatus, updateTournamentData } from "./bracketOps";
export { adminInitTournament, syncBracketTournament, scheduledBracketSync, importTournamentFromESPN, importConferenceTournamentFromESPN, syncPlayInPicks } from "./espnBracket";
export { onGameComplete } from "./postGameEmail";
export { onAnnouncementCreated } from "./announcements";
export { submitPlayoffPicks, calculatePlayoffScores, updateGlobalPlayoffResults, checkPlayoffScores, onPlayoffConfigUpdate, syncPlayoffPools, managePlayoffEntry } from "./playoffPools";
export { joinWaitlist, onSquareReleased } from "./waitlist";
export { generateTestScenario, validateTestResults, generateTestReport } from "./aiTesting";
export { setUserRole, setSuperAdminClaim, syncMyClaims, backfillUserRoles } from "./adminClaims";
export { logAdminAction } from "./adminOps";
export { adminSaveBillingConfig, adminManageCoupon, adminUpdatePoolBilling, adminAdjustUserCredits } from "./adminBillingOps";
// Canonical entitlements (Bundles + Pool Credits) — PLAN Phase 4 #14-17.
export { adminGrantEntitlement, adminRevokeEntitlement, redeemPoolCredit } from "./entitlements";
// Monetization tab — accounting alerts + coupon templates (PLAN Phase 6 #22-23).
export { monetizationAlerts } from "./monetizationAlerts"; // scheduled ~6h abuse/housekeeping alert sweep (dry-run + kill-switch)
export {
    createCouponTemplate,
    updateCouponTemplate,
    deleteCouponTemplate,
    mintCouponFromTemplate,
    acknowledgeMonetizationAlert,
} from "./couponTemplates";
export { initializeBigEastTournamentHttp, initializeBig12TournamentHttp } from "./conferenceTournaments";
export { scoreBracketEntries, finalizeTournamentPayouts } from "./bracketScoring";

// --- NFL POOLS FUNCTIONS ---
export { syncNFLScoresJob, importNFLSchedule, lockNFLSpreadsJob, nflDeepScoreSweepJob } from "./nflSchedule";
export { createNFLPool, joinNFLPool, submitNFLPicks, executeSurvivorRebuy, scoreNFLWeek } from "./nflPools";
// Operator loop (PLAN-NFL-PRESEASON-PILOT A3a): hourly pre-kickoff tripwire that
// pages ops when a week's spreads aren't all locked. Kill-switch + dry-run gated.
export { nflLockWatchJob } from "./nflLockWatch";
// Real-time scoring LIVE tier (PLAN-REALTIME-SCORING §5, G1 PR-B1): 10-minute
// provisional scorer. Kill-switch + dry-run gated; ships OFF.
export { nflAutoScoreJob } from "./nflAutoScore";
export { sendManualReminder } from "./manualReminders";
// Sim harness (PLAN-TEST-SUITE 8e/8f): SUPER_ADMIN-only, simRunId-scoped Test
// Suite mutations + cleanup. See functions/src/simHarness.ts.
export { simStartRun, simWriteEntries, simUpdatePool, simSeedNFLGames, cleanupSimPool, sweepSimRuns, simJoinMembers, simSubmitPicks, simExecuteRebuy, simFinalizePool, simReportRun } from "./simHarness";
// Legacy-simulator migration (PLAN-NFL-SIM-HARNESS Phase 5): tournament test
// infra + squares grid fill off raw client writes. See functions/src/simLegacy.ts.
export { simSetTournament, simDeleteTournament, simFillSquares } from "./simLegacy";

// --- BILLING & MONETIZATION ---
export { enforceBillingStatus, validateBillingAccess, redeemCoupon, onPoolParticipantChange, getPoolQuote } from "./billing";

// --- STRIPE PAYMENTS ---
// releaseStaleCouponReservations: 30-min sweep releasing stale coupon holds (ADR-0002; dry-run + kill-switch)
export { createCheckoutSession, handleStripeWebhook, releaseStaleCouponReservations } from "./stripe";

// --- SOCIAL LINK PREVIEWS (per-pool OG tags for /join/:id shares) ---
export { joinPreview } from "./joinPreview";

// --- REFERRAL SYSTEM ---
export { creditReferralOnPayment, generateReferralToken, resolveReferralToken } from "./referral";

// --- SERVER TIME (client clock-drift correction for countdown/lock UI) ---
export { getServerTime } from "./serverTime";

// --- CLIENT ERROR TELEMETRY (App-Check-gated sink; system_logs is functions-only) ---
export { logClientError } from "./logClientError";

// --- ADMIN HEALTH (real Super-Admin Overview vitals; replaces fake status card) ---
export { getAdminHealthSnapshot, scheduledHealthCheck } from "./adminHealth";
export { readiness } from "./readiness";
export { getOpsHealthSummary } from "./opsHealth";
export { webhookDurabilitySweep } from "./webhookDurabilitySweep";

// --- REVENUE AGGREGATES (platform revenue from billingCharges → admin_stats/revenue) ---
export { aggregateRevenueDaily, recomputeRevenue } from "./revenueAggregates";

// --- EMAIL PREFERENCES (unsubscribe compliance + category preferences) ---
export { emailUnsubscribe } from "./emailUnsubscribeHttp";
export { manageEmailPrefs } from "./emailPrefsPage";

// --- COMMISSIONER EXCEPTION TOOLS (audited mid-season corrections) ---
export { extendWeekDeadline, proxyPick, cancelPool, closePool } from "./poolExceptions";

// --- POOL INVITES (bulk email invites) ---
export { sendPoolInvites } from "./invites";

// --- MEMBER RECORD ROSTER (ADR 0003) — additive; writer wiring lands separately ---
export { setPaidStatus } from "./setPaidStatus";
export { onMemberRecordWrite, onWinnerWrite, onPoolRosterFieldsChange } from "./rosterAggregate";
export { backfillMemberRecords } from "./migrations/backfillMemberRecords";
export { backfillProfileData } from "./migrations/backfillProfileData";
export { backfillPublishedWeeks } from "./migrations/backfillPublishedWeeks";

// --- CONSENSUS + LIVE WIN PROBABILITY (ADR 0004) ---
export { consensusRefreshJob, recomputeConsensus } from "./consensus";
export { syncWinProbabilityJob } from "./winProbability";
export { syncExpertPicksJob, refreshExpertPicks } from "./expertPicks";

// --- PLAYER PROFILES (ADR 0004) ---
export { onEntryChangedRecomputeProfile, recomputeMyProfile, getProfilePoolDetail } from "./userProfile";

// --- SEASON FINALIZATION (ADR 0005 Phase 3) — kill-switched, dry-run-default sweep ---
export { nflFinalizeSweepJob } from "./nflFinalize";

// --- FEED REPLAY (A5 part 2) — rebuild a week from a stored ESPN snapshot ---
export { replayFeedSnapshot } from "./feedReplay";

// --- PAYOUT RECORDS (ADR 0005 Phase 4) — commissioner-recorded prize truth ---
export { recordPoolPayouts } from "./payoutRecords";

// --- SITE AVERAGES — real league-average line for the profile Performance Chart ---
export { siteAveragesJob, refreshSiteAverages } from "./siteAverages";

// --- EXPERT PROFILES (ADR 0005 Phase 6) — experts rendered through the same projection ---
export { gradeExpertProfilesJob, refreshExpertProfiles } from "./expertProfiles";

