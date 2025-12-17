"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillPools = exports.createPool = exports.syncParticipantIndices = exports.claimByCode = exports.claimMySquares = exports.createClaimCode = exports.createParticipantProfile = exports.recalculateGlobalStats = exports.onPoolLocked = exports.onWinnerComputed = exports.runReminders = exports.syncAllUsers = exports.onUserCreated = exports.onAIRequest = exports.onWinnerUpdate = exports.fixPoolScores = exports.syncGameStatus = exports.reserveSquare = exports.lockPool = void 0;
const admin = require("firebase-admin");
if (!admin.apps.length) {
    admin.initializeApp();
}
// Exported Cloud Functions
var poolParams_1 = require("./poolParams");
Object.defineProperty(exports, "lockPool", { enumerable: true, get: function () { return poolParams_1.lockPool; } });
var squares_1 = require("./squares");
Object.defineProperty(exports, "reserveSquare", { enumerable: true, get: function () { return squares_1.reserveSquare; } });
var scoreUpdates_1 = require("./scoreUpdates");
Object.defineProperty(exports, "syncGameStatus", { enumerable: true, get: function () { return scoreUpdates_1.syncGameStatus; } });
Object.defineProperty(exports, "fixPoolScores", { enumerable: true, get: function () { return scoreUpdates_1.fixPoolScores; } });
var aiCommissioner_1 = require("./aiCommissioner");
Object.defineProperty(exports, "onWinnerUpdate", { enumerable: true, get: function () { return aiCommissioner_1.onWinnerUpdate; } });
Object.defineProperty(exports, "onAIRequest", { enumerable: true, get: function () { return aiCommissioner_1.onAIRequest; } });
var userSync_1 = require("./userSync");
Object.defineProperty(exports, "onUserCreated", { enumerable: true, get: function () { return userSync_1.onUserCreated; } });
Object.defineProperty(exports, "syncAllUsers", { enumerable: true, get: function () { return userSync_1.syncAllUsers; } });
var reminders_1 = require("./reminders");
Object.defineProperty(exports, "runReminders", { enumerable: true, get: function () { return reminders_1.runReminders; } });
Object.defineProperty(exports, "onWinnerComputed", { enumerable: true, get: function () { return reminders_1.onWinnerComputed; } });
var statsTrigger_1 = require("./statsTrigger");
Object.defineProperty(exports, "onPoolLocked", { enumerable: true, get: function () { return statsTrigger_1.onPoolLocked; } });
Object.defineProperty(exports, "recalculateGlobalStats", { enumerable: true, get: function () { return statsTrigger_1.recalculateGlobalStats; } });
var participant_1 = require("./participant");
Object.defineProperty(exports, "createParticipantProfile", { enumerable: true, get: function () { return participant_1.onUserCreated; } });
Object.defineProperty(exports, "createClaimCode", { enumerable: true, get: function () { return participant_1.createClaimCode; } });
Object.defineProperty(exports, "claimMySquares", { enumerable: true, get: function () { return participant_1.claimMySquares; } });
Object.defineProperty(exports, "claimByCode", { enumerable: true, get: function () { return participant_1.claimByCode; } });
Object.defineProperty(exports, "syncParticipantIndices", { enumerable: true, get: function () { return participant_1.syncParticipantIndices; } });
var poolOps_1 = require("./poolOps");
Object.defineProperty(exports, "createPool", { enumerable: true, get: function () { return poolOps_1.createPool; } });
var backfill_1 = require("./backfill");
Object.defineProperty(exports, "backfillPools", { enumerable: true, get: function () { return backfill_1.backfillPools; } });
//# sourceMappingURL=index.js.map