import * as fs from 'fs';

const g = {
    id: "R2-CONF-1",
    homeTeamId: "CINC",
    awayTeamId: ""
};

const f = ["R1-CONF-1"]; // one feeder

const picks: any = {};

const resolveWinner = (sourceGameId?: string): string | undefined => {
    if (!sourceGameId) return undefined;
    return picks[sourceGameId];
};

let homeOverride: string | undefined;
let awayOverride: string | undefined;

const isHomeEmpty = !g.homeTeamId || g.homeTeamId.startsWith('SEED_');
const isAwayEmpty = !g.awayTeamId || g.awayTeamId.startsWith('SEED_');

console.log("Before pick:", { isHomeEmpty, isAwayEmpty });

if (isAwayEmpty && !isHomeEmpty) {
    awayOverride = resolveWinner(f[0]);
    homeOverride = g.homeTeamId;
} else if (isHomeEmpty && !isAwayEmpty) {
    homeOverride = resolveWinner(f[0]);
    awayOverride = g.awayTeamId;
} else {
    awayOverride = resolveWinner(f[0]);
    if (!isHomeEmpty) {
        homeOverride = g.homeTeamId;
    }
}

console.log("Overrides before pick:", { homeOverride, awayOverride });

picks["R1-CONF-1"] = "KSU";

if (isAwayEmpty && !isHomeEmpty) {
    awayOverride = resolveWinner(f[0]);
    homeOverride = g.homeTeamId;
} else if (isHomeEmpty && !isAwayEmpty) {
    homeOverride = resolveWinner(f[0]);
    awayOverride = g.awayTeamId;
} else {
    awayOverride = resolveWinner(f[0]);
    if (!isHomeEmpty) {
        homeOverride = g.homeTeamId;
    }
}

console.log("Overrides AFTER pick:", { homeOverride, awayOverride });

const hasDynamicParticipants = Boolean(homeOverride !== undefined || awayOverride !== undefined);
console.log("hasDynamicParticipants AFTER pick:", hasDynamicParticipants);

const displayHomeId = hasDynamicParticipants ? homeOverride : (homeOverride ?? g.homeTeamId);
const displayAwayId = hasDynamicParticipants ? awayOverride : (awayOverride ?? g.awayTeamId);

console.log("display AFTER pick:", { displayHomeId, displayAwayId });
