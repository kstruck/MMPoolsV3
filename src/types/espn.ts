export interface ESPNTeam {
    id: string;
    uid: string;
    slug: string;
    abbreviation: string;
    displayName: string;
    shortDisplayName: string;
    name: string;
    nickname: string;
    location: string;
    color: string;
    alternateColor: string;
    isActive: boolean;
    venue: { id: string };
    logo: string;
}

export interface ESPNCompetitor {
    id: string;
    uid: string;
    type: string;
    order: number;
    homeAway: string;
    winner: boolean;
    team: ESPNTeam;
    score: string;
    linescores: { value: number }[];
    statistics: any[];
    leaders: any[];
    records: { name: string; abbreviation: string; type: string; summary: string }[];
}

export interface ESPNCompetition {
    id: string;
    uid: string;
    date: string;
    attendance: number;
    type: { id: string; abbreviation: string };
    timeValid: boolean;
    neutralSite: boolean;
    conferenceCompetition: boolean;
    playByPlayAvailable: boolean;
    recent: boolean;
    venue: { id: string; fullName: string; address: { city: string; state: string } };
    competitors: ESPNCompetitor[];
    notes: any[];
    status: {
        clock: number;
        displayClock: string;
        period: number;
        type: {
            id: string;
            name: string;
            state: string;
            completed: boolean;
            description: string;
            detail: string;
            shortDetail: string;
        }
    };
    broadcasts: any[];
    geoBroadcasts: any[];
    headlines: any[];
}

export interface ESPNGame {
    id: string;
    uid: string;
    date: string;
    name: string;
    shortName: string;
    season: { year: number; type: number; slug: string };
    competitions: ESPNCompetition[];
    links: { language: string; rel: string[]; href: string; text: string; shortText: string; isExternal: boolean; isPremium: boolean }[];
    status: {
        clock: number;
        displayClock: string;
        period: number;
        type: {
            id: string;
            name: string;
            state: string;
            completed: boolean;
            description: string;
            detail: string;
            shortDetail: string;
        }
    };
}
