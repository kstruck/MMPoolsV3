import React, { useState } from 'react';
import { Download, Printer, FileText, ChevronDown, Loader2 } from 'lucide-react';
import type { BracketEntry, BracketPool, Tournament } from '../../types';
import { calculateEntryMaxScore, getEliminatedTeams } from '../../utils/bracketScoring';

interface ExportControlsProps {
    pool: BracketPool;
    entries: BracketEntry[];
    tournament: Tournament | null;
}

export const ExportControls: React.FC<ExportControlsProps> = ({ pool, entries, tournament }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const handleExportCSV = async () => {
        setIsExporting(true);
        let exportsData: Record<string, string | number>[] = [];

        if (tournament) {
            const eliminatedTeams = getEliminatedTeams(tournament);
            const games = Object.values(tournament.games);
            const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
            const championshipGame = games.find(g => g.round === maxRound);
            const actualTotal = championshipGame?.status === 'FINAL' ? (championshipGame.homeScore || 0) + (championshipGame.awayScore || 0) : null;

            const entriesWithStats = entries.map(entry => {
                const max = calculateEntryMaxScore(entry, tournament, pool.settings, eliminatedTeams);
                return { ...entry, score: entry.score || 0, max: max || 0 };
            }).sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.max !== a.max) return b.max - a.max;
                if (actualTotal !== null && a.tieBreakerPrediction !== undefined && b.tieBreakerPrediction !== undefined) {
                    const diffA = a.tieBreakerPrediction - actualTotal;
                    const diffB = b.tieBreakerPrediction - actualTotal;
                    if (pool.settings.tieBreakers?.closestUnder) {
                        const aUnder = diffA <= 0;
                        const bUnder = diffB <= 0;
                        if (aUnder && !bUnder) return -1;
                        if (!aUnder && bUnder) return 1;
                        if (aUnder && bUnder) return Math.abs(diffA) - Math.abs(diffB);
                    }
                    return Math.abs(diffA) - Math.abs(diffB);
                }
                return 0;
            });

            exportsData = entriesWithStats.map((e, idx) => ({
                Rank: idx + 1,
                Name: e.name.replace(/"/g, '""'),
                OwnerId: e.ownerUid,
                Score: e.score || 0,
                MaxPossible: e.max || 0,
                Tiebreaker: e.tieBreakerPrediction || 'N/A',
                Status: e.status,
                PaidStatus: e.paidStatus
            }));
        } else {
            exportsData = entries.map(e => ({
                Name: e.name.replace(/"/g, '""'),
                OwnerId: e.ownerUid,
                Score: 0,
                Status: e.status,
                PaidStatus: e.paidStatus
            }));
        }

        const headers = Object.keys(exportsData[0] || {}).join(',');
        const rows = exportsData.map(obj => Object.values(obj).map(v => `"${v}"`).join(',')).join('\n');
        const csvContent = `${headers}\n${rows}`;

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${pool.name.replace(/\s+/g, '_')}_Standings.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setIsExporting(false);
        setIsOpen(false);
    };

    const handlePrintBrackets = () => {
        setIsOpen(false);
        // Dispatch custom event to trigger Master Bracket print in Dashboard
        window.dispatchEvent(new CustomEvent('print-master-bracket'));
        setTimeout(() => {
            window.print();
        }, 100);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-colors border border-slate-700"
            >
                <Download size={16} /> Export
                <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2">
                        <div className="p-2 space-y-1">
                            <button
                                onClick={handleExportCSV}
                                disabled={isExporting || entries.length === 0}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 disabled:opacity-50"
                            >
                                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                Export Standings (CSV)
                            </button>
                            <button
                                onClick={handlePrintBrackets}
                                disabled={!tournament}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 disabled:opacity-50"
                                title="Use browser print to save as PDF"
                            >
                                <Printer size={16} />
                                Print Master Bracket (PDF)
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
