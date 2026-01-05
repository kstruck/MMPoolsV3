import React from 'react';
import type { PlayoffTeam } from '../../types';

import { getTeamLogo } from '../../constants';

interface ScheduleDisplayProps {
    teams: PlayoffTeam[];
}

interface Matchup {
    away: string; // Team IDs or references
    home: string;
    awayScore?: number;
    homeScore?: number;
    time: string;
    day: string;
}

// Hardcoded for Demo/Request (Wild Card Weekend 2024-25 projection or User Scenario)
// Based on User Screenshot:
// Rams @ Panthers
// Packers @ Bears
// Bills @ Jaguars
// 49ers @ Eagles
// Chargers @ Patriots
// Texans @ Steelers
const DEMO_SCHEDULE: Matchup[] = [
    { away: 'lar', home: 'car', time: '4:30 PM ET', day: 'Saturday' },
    { away: 'gb', home: 'chi', time: '8:15 PM ET', day: 'Saturday' },
    { away: 'buf', home: 'jax', time: '1:00 PM ET', day: 'Sunday' },
    { away: 'sf', home: 'phi', time: '4:30 PM ET', day: 'Sunday' },
    { away: 'lac', home: 'ne', time: '8:15 PM ET', day: 'Sunday' },
    { away: 'hou', home: 'pit', time: '8:15 PM ET', day: 'Monday' },
];

const BYE_TEAMS = ['den', 'sea'];

export const ScheduleDisplay: React.FC<ScheduleDisplayProps> = ({ teams }) => {

    const resolveTeam = (idOrName: string) => {
        // Try to find in pool teams first
        const poolTeam = teams.find(t => t.id === idOrName || t.name.toLowerCase().includes(idOrName.toLowerCase()));
        if (poolTeam) return poolTeam;

        // Fallback mock
        return {
            id: idOrName,
            name: idOrName.toUpperCase(),
            seed: 0,
            conference: 'NFC'
        } as PlayoffTeam;
    };

    return (
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm text-slate-800">
            <h3 className="font-bold text-center text-lg mb-6 border-b border-slate-200 pb-2">Post Season Week 1 schedule</h3>

            <div className="space-y-6">
                {DEMO_SCHEDULE.map((game, idx) => {
                    const awayTeam = resolveTeam(game.away);
                    const homeTeam = resolveTeam(game.home);
                    const awayLogo = getTeamLogo(awayTeam.name) || getTeamLogo(awayTeam.id);
                    const homeLogo = getTeamLogo(homeTeam.name) || getTeamLogo(homeTeam.id);

                    return (
                        <div key={idx} className="flex items-center justify-between gap-4">
                            {/* Away */}
                            <div className="flex-1 flex flex-col items-end text-right">
                                <span className="font-bold text-sm md:text-base leading-tight">{awayTeam.name}</span>
                                <span className="text-xs text-slate-500">({awayTeam.seed ? `${awayTeam.seed} Seed` : '12-5'})</span>
                            </div>

                            {/* Center */}
                            <div className="flex items-center gap-3 shrink-0">
                                {awayLogo && <img src={awayLogo} alt={awayTeam.name} className="w-8 h-8 md:w-10 md:h-10 object-contain" />}
                                <span className="font-bold text-slate-400 text-sm">at</span>
                                {homeLogo && <img src={homeLogo} alt={homeTeam.name} className="w-8 h-8 md:w-10 md:h-10 object-contain" />}
                            </div>

                            {/* Home */}
                            <div className="flex-1 flex flex-col items-start text-left">
                                <span className="font-bold text-sm md:text-base leading-tight">{homeTeam.name}</span>
                                <span className="text-xs text-slate-500">({homeTeam.seed ? `${homeTeam.seed} Seed` : '11-6'})</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Byes */}
            <div className="mt-8 pt-4 border-t border-slate-200">
                <h4 className="font-bold text-sm mb-2">Teams with Byes:</h4>
                <div className="flex flex-col gap-1">
                    {BYE_TEAMS.map(teamId => {
                        const team = resolveTeam(teamId);
                        return (
                            <div key={teamId} className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
                                {team.name}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
