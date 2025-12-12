"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveSquare = exports.lockPool = exports.db = void 0;
const admin = require("firebase-admin");
admin.initializeApp();
exports.db = admin.firestore();
// Exported Cloud Functions
var poolParams_1 = require("./poolParams");
Object.defineProperty(exports, "lockPool", { enumerable: true, get: function () { return poolParams_1.lockPool; } });
var squares_1 = require("./squares");
Object.defineProperty(exports, "reserveSquare", { enumerable: true, get: function () { return squares_1.reserveSquare; } });
//# sourceMappingURL=index.js.map