import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Scores } from '../../types';
import { Badge } from '../ui';

/**
 * The squares pool page, BOARD FIRST (Kevin, 2026-11-16, option B).
 *
 * The page used to open with Pool Details, Payout Structure, a full scoreboard
 * table, the sign-in card and Payment Status — on a phone the board was several
 * screens down. These are the pieces that let the board sit near the top:
 *
 *   - `SquaresScoreStrip`: the scoreboard as ONE line, quarters on a tap.
 *   - `SquaresFactChips`:  price, squares left, lock time, pot — one line.
 *   - `SquaresInfoTabs`:   Payouts / Rules / Payment, moved below the board.
 *   - `aiCommissionerView`: whether the AI Commissioner shows at all.
 */

/** One team's points IN each quarter, or '-' where the quarter has not started. */
export type QuarterPoints = [number | '-', number | '-', number | '-', number | '-'];

/**
 * Points scored IN each quarter, for one side. Moved here unchanged from the
 * inline table on `PoolRoute`: a finished quarter is the difference between two
 * recorded snapshots, and the quarter in play is the live score minus the last
 * snapshot. Q1 has no live fallback — that is how the table always read.
 */
export function quarterPoints(scores: Scores | null | undefined, side: 'home' | 'away'): QuarterPoints {
    if (!scores) return ['-', '-', '-', '-'];
    const { q1, half, q3, final, current } = scores;
    const period = scores.period ?? 0;
    const live = current?.[side] ?? 0;
    const q1Pts: number | '-' = q1 ? q1[side] : '-';
    const q2Pts: number | '-' = half && q1 ? half[side] - q1[side] : (period >= 2 && q1 ? live - q1[side] : '-');
    const q3Pts: number | '-' = q3 && half ? q3[side] - half[side] : (period >= 3 && half ? live - half[side] : '-');
    const q4Pts: number | '-' = final && q3 ? final[side] - q3[side] : (period >= 4 && q3 ? live - q3[side] : '-');
    return [q1Pts, q2Pts, q3Pts, q4Pts];
}

/** The status word the strip shows beside the score. */
export function gameStatusLabel(status: Scores['gameStatus']): 'LIVE' | 'FINAL' | 'PENDING' {
    if (status === 'in') return 'LIVE';
    if (status === 'post') return 'FINAL';
    return 'PENDING';
}

/** Short team label for a narrow screen: the last word ("Bills"), never cut mid-word. */
export function shortTeamName(team: string): string {
    const words = team.trim().split(/\s+/);
    return words[words.length - 1] || team;
}

const TeamMark: React.FC<{ logo?: string | null; team: string; ring: 'gold' | 'red' }> = ({ logo, team, ring }) => (
    <span className={`w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0 border-2 ${ring === 'gold' ? 'border-gold-500' : 'border-brandred-500'}`}>
        {logo
            ? <img src={logo} alt="" className="w-5 h-5 object-contain" />
            : <span className={`text-[9px] font-display font-bold ${ring === 'gold' ? 'text-gold-600' : 'text-brandred-500'}`}>{team.substring(0, 2).toUpperCase()}</span>}
    </span>
);

export const SquaresScoreStrip: React.FC<{
    awayTeam: string;
    homeTeam: string;
    awayLogo?: string | null;
    homeLogo?: string | null;
    scores: Scores;
}> = ({ awayTeam, homeTeam, awayLogo, homeLogo, scores }) => {
    const [open, setOpen] = useState(false);
    const status = gameStatusLabel(scores.gameStatus);
    const away = quarterPoints(scores, 'away');
    const home = quarterPoints(scores, 'home');
    return (
        <section aria-label="Game score" data-testid="squares-score-strip" className="bg-navy-900 rounded-xl border border-[rgba(230,206,150,0.16)] shadow-panel overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls="squares-quarter-scores"
                className="w-full min-h-[44px] px-3 sm:px-5 py-2 flex items-center gap-2 sm:gap-4 text-white"
            >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                    <TeamMark logo={awayLogo} team={awayTeam} ring="gold" />
                    <span className="font-display font-bold uppercase text-sm sm:text-base truncate">
                        <span className="sm:hidden">{shortTeamName(awayTeam)}</span>
                        <span className="hidden sm:inline">{awayTeam}</span>
                    </span>
                    <span className="ml-auto font-display font-bold text-2xl text-gold-400 num">{scores.current?.away ?? 0}</span>
                </span>
                <span className="shrink-0 flex flex-col items-center">
                    {status === 'LIVE'
                        ? <Badge status="live" />
                        : <span className="text-[10px] text-[#9FB0CC] font-display font-bold uppercase tracking-[0.08em]">{status}</span>}
                    <span className="text-[10px] text-[#9FB0CC] flex items-center gap-0.5 font-body">
                        Quarters {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </span>
                </span>
                <span className="flex items-center gap-2 min-w-0 flex-1 flex-row-reverse">
                    <TeamMark logo={homeLogo} team={homeTeam} ring="red" />
                    <span className="font-display font-bold uppercase text-sm sm:text-base truncate text-right">
                        <span className="sm:hidden">{shortTeamName(homeTeam)}</span>
                        <span className="hidden sm:inline">{homeTeam}</span>
                    </span>
                    <span className="mr-auto font-display font-bold text-2xl text-brandred-500 num">{scores.current?.home ?? 0}</span>
                </span>
            </button>
            {open && (
                <div id="squares-quarter-scores" className="overflow-x-auto border-t border-[rgba(230,206,150,0.16)]">
                    <table className="w-full text-center text-sm">
                        <thead>
                            <tr className="bg-navy-950/50">
                                <th className="py-2 px-3 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em] text-left">Team</th>
                                {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <th key={q} className="py-2 px-3 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em]">{q}</th>)}
                                <th className="py-2 px-3 text-xs font-display font-bold text-white uppercase tracking-[0.08em] bg-navy-800">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgba(230,206,150,0.12)]">
                            {([[awayTeam, away, scores.current?.away ?? 0, 'text-gold-400'], [homeTeam, home, scores.current?.home ?? 0, 'text-brandred-500']] as const).map(([team, pts, total, color]) => (
                                <tr key={team}>
                                    <td className="py-2 px-3 font-bold text-white text-left font-body">{team}</td>
                                    {pts.map((p, i) => <td key={i} className="py-2 px-3 num text-[#9FB0CC]">{p}</td>)}
                                    <td className={`py-2 px-3 font-display font-bold text-lg bg-navy-950/50 num ${color}`}>{total}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

export const SquaresFactChips: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div data-testid="squares-fact-chips" className="flex flex-wrap items-center gap-2 text-xs font-body">
        {children}
    </div>
);

export const FactChip: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
    <span data-testid={testId} className="inline-flex items-center gap-1 bg-card border border-line rounded-full px-3 py-1 text-muted whitespace-nowrap">
        {children}
    </span>
);

export interface InfoTab {
    id: string;
    label: string;
    content: React.ReactNode;
}

/**
 * Payouts / Rules / Payment, below the board. A tab list, not three cards, so
 * the details people read once take one card's height instead of three.
 */
export const SquaresInfoTabs: React.FC<{ tabs: InfoTab[]; initial?: string }> = ({ tabs, initial }) => {
    const [active, setActive] = useState(initial ?? tabs[0]?.id);
    const current = tabs.find(t => t.id === active) ?? tabs[0];
    if (!current) return null;
    return (
        <section data-testid="squares-info-tabs" className="bg-card rounded-xl border border-line shadow-card overflow-hidden">
            <div role="tablist" aria-label="Pool details" className="flex border-b border-line">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        id={`squares-tab-${t.id}`}
                        aria-selected={t.id === current.id}
                        aria-controls={`squares-tabpanel-${t.id}`}
                        onClick={() => setActive(t.id)}
                        className={`flex-1 min-h-[44px] py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors duration-150 ${t.id === current.id ? 'bg-page text-[color:var(--text)] border-b-2 border-gold-500' : 'text-faint hover:text-muted hover:bg-page/50'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id={`squares-tabpanel-${current.id}`} aria-labelledby={`squares-tab-${current.id}`} className="p-4 sm:p-6">
                {current.content}
            </div>
        </section>
    );
};

/**
 * Whether the AI Commissioner shows on the squares page (Kevin, 2026-11-16):
 * players see it only when the pool has paid for it; the manager of a pool
 * that has not sees the upgrade button instead.
 *
 * The upgrade offer needs an ACTIVE pool, the same rule the Bracket page uses:
 * the server refuses an add-on checkout for a pool with no hosting purchase, so
 * a button there would only lead to an error.
 */
export function aiCommissionerView(
    billing: { status?: string; featuresUnlocked?: Record<string, boolean> } | null | undefined,
    isManager: boolean,
): 'show' | 'upsell' | 'none' {
    if (billing?.featuresUnlocked?.aiCommissioner === true) return 'show';
    if (isManager && billing?.status === 'active') return 'upsell';
    return 'none';
}
