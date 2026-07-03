import React, { useEffect, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, Medal } from 'lucide-react';
import type { BracketPool, BracketEntry, Tournament } from '../../types';

interface ChampionBannerProps {
    pool: BracketPool;
    entries: BracketEntry[];
    tournament: Tournament | null;
    currentUserId?: string;
}

/**
 * The champion moment (UX overhaul Phase 4.1).
 *
 * Renders ONLY once the season is actually decided:
 *   - pool.status === 'COMPLETED', or
 *   - tournament.isFinalized / tournament.status === 'COMPLETED', or
 *   - the championship game (highest round) is FINAL with a winner.
 *
 * Everyone sees the banner; only the champion gets confetti — fired once
 * per browser per pool (localStorage key `championConfetti:{poolId}`).
 */
export const ChampionBanner: React.FC<ChampionBannerProps> = ({ pool, entries, tournament, currentUserId }) => {
    const isFinal = useMemo(() => {
        if (pool.status === 'COMPLETED') return true;
        if (!tournament) return false;
        if (tournament.isFinalized || tournament.status === 'COMPLETED') return true;
        const games = Object.values(tournament.games || {});
        if (games.length === 0) return false;
        const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
        if (maxRound < 1) return false;
        const finalGames = games.filter(g => g.round === maxRound);
        return finalGames.length > 0 && finalGames.every(g => g.status === 'FINAL' && !!g.winnerTeamId);
    }, [pool.status, tournament]);

    // Rank entries: stored rank first (set by the scoring function with full
    // tiebreaker logic), score desc as fallback.
    const ranked = useMemo(() => {
        return [...entries]
            .filter(e => e.status === 'SUBMITTED' || e.rank !== undefined)
            .sort((a, b) => {
                const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
                const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
                if (ra !== rb) return ra - rb;
                return (b.score || 0) - (a.score || 0);
            });
    }, [entries]);

    const champions = useMemo(() => {
        if (ranked.length === 0) return [];
        const top = ranked[0];
        if (top.rank !== undefined) return ranked.filter(e => e.rank === top.rank);
        // No stored ranks: fall back to highest score (ties share the crown)
        const topScore = top.score || 0;
        return ranked.filter(e => (e.score || 0) === topScore);
    }, [ranked]);

    const podium = ranked.slice(0, 3);

    // Confetti: once per browser per pool, and ONLY for the champion themselves.
    useEffect(() => {
        if (!isFinal || champions.length === 0 || !currentUserId) return;
        if (!champions.some(c => c.ownerUid === currentUserId)) return;

        const guardKey = `championConfetti:${pool.id}`;
        try {
            if (localStorage.getItem(guardKey)) return;
            localStorage.setItem(guardKey, String(Date.now()));
        } catch {
            return; // localStorage unavailable — skip rather than risk repeat fire
        }

        const fire = (particleRatio: number, opts: confetti.Options) => {
            confetti({
                origin: { y: 0.6 },
                colors: ['#f59e0b', '#fbbf24', '#fde68a', '#ffffff', '#6366f1'],
                ...opts,
                particleCount: Math.floor(200 * particleRatio),
            });
        };
        fire(0.25, { spread: 26, startVelocity: 55 });
        fire(0.2, { spread: 60 });
        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
        fire(0.1, { spread: 120, startVelocity: 45 });
    }, [isFinal, champions, currentUserId, pool.id]);

    if (!isFinal || champions.length === 0) return null;

    const championNames = champions.map(c => c.name).join(' & ');
    const medalStyles = [
        'text-amber-300 border-amber-500/40 bg-amber-500/10',
        'text-slate-300 border-slate-500/40 bg-slate-500/10',
        'text-orange-400 border-orange-500/40 bg-orange-500/10',
    ];
    const medalLabels = ['1st', '2nd', '3rd'];

    return (
        <div className="relative overflow-hidden w-full rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-slate-900 to-amber-500/15 p-6 mb-6 shadow-xl shadow-amber-500/10 animate-in fade-in slide-in-from-top-2">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                {/* Champion */}
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-full bg-amber-500/20 border border-amber-500/40 shrink-0">
                        <Trophy size={32} className="text-amber-400" />
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-1">
                            🏆 Champion{champions.length > 1 ? 's' : ''}
                        </p>
                        <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                            {championNames}
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">
                            {champions[0].score || 0} points · {pool.name}
                        </p>
                    </div>
                </div>

                {/* Podium (top 3) */}
                <div className="flex gap-3 flex-wrap">
                    {podium.map((entry, idx) => (
                        <div
                            key={entry.id}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${medalStyles[idx] || medalStyles[2]}`}
                        >
                            <Medal size={16} />
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                                    {medalLabels[idx] || `${idx + 1}th`}
                                </p>
                                <p className="text-sm font-bold leading-tight">{entry.name}</p>
                                <p className="text-xs opacity-80">{entry.score || 0} pts</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
