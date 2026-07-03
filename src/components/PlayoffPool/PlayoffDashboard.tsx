import React, { useState, useMemo } from 'react';
import { BillingGate } from '../billing';
import type { PlayoffPool, User } from '../../types';
import { isPoolManager } from '../../utils/auth';
import { dbService } from '../../services/dbService';
import { Trophy, ListOrdered, FileText, Settings, Plus, Edit2, Eye, X, Trash2, Share2, ExternalLink, Check, Copy, Bot } from 'lucide-react';
import { RankingForm } from './RankingForm';
import type { PlayoffEntry } from '../../types';
import { PlayoffPayoutCard } from './PlayoffPayoutCard'; // [NEW]
import { AnnouncementManager } from '../AnnouncementManager'; // [NEW]
import { AICommissioner } from '../AICommissioner';
import { useToast } from '../ui/Toast';
import { Badge, Button, RankChip, Tag, YouPill } from '../ui';

interface PlayoffDashboardProps {
    pool: PlayoffPool;
    user: User | null;
    onBack: () => void;
}

export const PlayoffDashboard: React.FC<PlayoffDashboardProps> = ({ pool, user, onBack }) => {
    const toast = useToast();
    const [activeTab, setActiveTab] = useState<'picks' | 'leaderboard' | 'rules' | 'commissioner' | 'ai'>('picks'); // [MODIFIED] Added 'commissioner'
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [viewingEntry, setViewingEntry] = useState<PlayoffEntry | null>(null);
    const [zelleCopied, setZelleCopied] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);
    // const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
    // const [isSettingsOpen, setIsSettingsOpen] = useState(false); // Deprecated

    const isManager = isPoolManager(user, pool);
    const canViewPicks = pool.isLocked || (pool.results && Object.values(pool.results).some(r => r && r.length > 0)) || isManager;

    // --- My Entries Logic ---
    const myEntries = useMemo(() => {
        if (!user || !pool.entries) return [];
        return Object.entries(pool.entries)
            .map(([id, entry]) => ({ ...entry, id }))
            .filter(e => e.userId === user.id);
    }, [pool.entries, user]);

    // [NEW] Calculate Paid Entries Count
    const paidEntriesCount = useMemo(() => {
        return Object.values(pool.entries || {}).filter(e => e.paid).length;
    }, [pool.entries]);

    // --- Score Calculation Logic ---
    const getRoundScore = (rankings: Record<string, number>, roundKey: 'WILD_CARD' | 'DIVISIONAL' | 'CONF_CHAMP' | 'SUPER_BOWL') => {
        const winners = pool.results?.[roundKey] || [];
        const multiplier = pool.settings?.scoring?.roundMultipliers?.[roundKey] || 1;

        let score = 0;
        winners.forEach(winnerId => {
            const rank = rankings[winnerId] || 0;
            score += (rank * multiplier);
        });
        return score;
    };

    const handleEditEntry = (entryId: string) => {
        setEditingEntryId(entryId);
        setIsAddingNew(false);
        setActiveTab('picks');
    };

    const handleAddNew = () => {
        setEditingEntryId(null);
        setIsAddingNew(true);
        setActiveTab('picks');
    };

    const handleCancelEdit = () => {
        setEditingEntryId(null);
        setIsAddingNew(false);
    };

    return (
        <BillingGate pool={pool as any} isCommissioner={isManager}>
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body pb-20 duration-300" style={{ backgroundColor: pool.branding?.bgColor || undefined }}>
            {/* Main Content */}
            <div className="max-w-6xl mx-auto p-4 md:p-6">
                {/* Pool Header */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                    <div className="flex items-center gap-4">
                        {pool.branding?.logoUrl && (
                        <div className="flex-shrink-0">
                            <img src={pool.branding.logoUrl} alt="Pool Logo" className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-lg" />
                        </div>
                    )}    <div>
                            <h1 className="text-3xl font-display font-extrabold uppercase leading-[0.95] text-[color:var(--text)] mb-2">{pool.name}</h1>
                            <div className="flex items-center gap-3 text-muted text-sm">
                                <Tag sport="nfl">
                                    {pool.type === 'NFL_PLAYOFFS' ? 'Playoff Challenge' : 'Pool'}
                                </Tag>
                                {pool.settings?.entryFee > 0 && (
                                    <span className="text-[color:var(--text)] font-display font-bold num bg-card px-2 py-1 rounded border border-line">
                                        ${pool.settings.entryFee} Entry
                                    </span>
                                )}
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(window.location.href);
                                        setShareCopied(true);
                                        setTimeout(() => setShareCopied(false), 2000);
                                    }}
                                    className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-[0.05em] text-white bg-navy-800 hover:bg-navy-700 transition-all duration-150 ml-2 px-3 py-1.5 rounded-lg hover:-translate-y-px"
                                >
                                    {shareCopied ? <><Check size={14} className="text-gold-400" /> Copied!</> : <><Share2 size={14} /> Share</>}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {isManager && (
                            <Button variant="ghost" size="sm" onClick={() => window.location.href = `/playoff-wizard/${pool.id}`}>
                                <Settings size={16} /> Manage Pool
                            </Button>
                        )}

                        <Button variant="ghost" size="sm" onClick={onBack}>
                            Back
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-line mb-6 overflow-x-auto">
                    <button
                        onClick={() => { setActiveTab('picks'); handleCancelEdit(); }}
                        className={`px-6 py-3 font-display font-bold text-sm uppercase tracking-[0.08em] border-b-2 transition-colors duration-150 flex items-center gap-2 whitespace-nowrap ${activeTab === 'picks' ? 'border-gold-500 text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                    >
                        <ListOrdered size={16} /> My Picks
                    </button>
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`px-6 py-3 font-display font-bold text-sm uppercase tracking-[0.08em] border-b-2 transition-colors duration-150 flex items-center gap-2 whitespace-nowrap ${activeTab === 'leaderboard' ? 'border-gold-500 text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                    >
                        <Trophy size={16} /> Leaderboard
                    </button>
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`px-6 py-3 font-display font-bold text-sm uppercase tracking-[0.08em] border-b-2 transition-colors duration-150 flex items-center gap-2 whitespace-nowrap ${activeTab === 'rules' ? 'border-gold-500 text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                    >
                        <FileText size={16} /> Rules & Payment Info
                    </button>
                    {(pool as any).billing?.featuresUnlocked?.aiCommissioner && (
                        <button
                            onClick={() => setActiveTab('ai')}
                            className={`px-6 py-3 font-display font-bold text-sm uppercase tracking-[0.08em] border-b-2 transition-colors duration-150 flex items-center gap-2 whitespace-nowrap ${activeTab === 'ai' ? 'border-gold-500 text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                        >
                            <Bot size={16} /> AI Insights
                        </button>
                    )}
                    {isManager && (
                        <button
                            onClick={() => setActiveTab('commissioner')}
                            className={`px-6 py-3 font-display font-bold text-sm uppercase tracking-[0.08em] border-b-2 transition-colors duration-150 flex items-center gap-2 whitespace-nowrap ${activeTab === 'commissioner' ? 'border-gold-500 text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                        >
                            <Settings size={16} /> Commissioner
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="min-h-[400px]">
                    {activeTab === 'picks' && (
                        <div className="bg-card rounded-xl border border-line shadow-card p-6 md:p-8">

                            {/* Render Form if Adding or Editing, OR if no entries exist yet (force first entry) */}
                            {(!user) ? (
                                <div className="text-center py-12">
                                    <h3 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] mb-4">Login Required</h3>
                                    <p className="text-muted mb-8 max-w-md mx-auto">
                                        You must be logged in to create an entry for the <span className="text-gold-600 dark:text-gold-400 font-bold">{pool.name}</span>.
                                    </p>
                                    <Button
                                        onClick={() => document.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }))}
                                        className="rounded-full px-8"
                                    >
                                        Login or Register to Play
                                    </Button>
                                </div>
                            ) : (isAddingNew || editingEntryId || myEntries.length === 0) ? (
                                <RankingForm
                                    key={editingEntryId || 'new'}
                                    pool={pool}
                                    user={user}
                                    entryId={editingEntryId || undefined}
                                    onSaved={() => {
                                        setEditingEntryId(null);
                                        setIsAddingNew(false);
                                        // Refresh is handled by snapshot
                                    }}
                                    onCancel={myEntries.length > 0 ? handleCancelEdit : undefined}
                                />
                            ) : (
                                /* List View of Entries */
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Your Entries</h3>
                                        {!pool.isLocked && (
                                            <Button size="sm" onClick={handleAddNew}>
                                                <Plus size={16} /> Add Entry
                                            </Button>
                                        )}
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        {myEntries.map((entry, idx) => (
                                            <div key={entry.id || idx} className="bg-surface border border-line rounded-lg p-4 hover:border-navy-600 transition-colors duration-150 group">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <h4 className="font-body font-bold text-[color:var(--text)] text-lg">{entry.entryName || `Entry #${idx + 1}`}</h4>
                                                        <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em] num">Tiebreaker: {entry.tiebreaker}</p>
                                                    </div>
                                                    {!pool.isLocked ? (
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleEditEntry(entry.id || '')}
                                                                className="text-muted hover:text-[color:var(--text)] bg-card hover:bg-page border border-line p-2 rounded-lg transition-colors duration-150"
                                                                title="Edit Entry"
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    const ok = await toast.confirm({ title: 'Delete Entry?', message: 'Delete this entry?', confirmLabel: 'Delete', danger: true });
                                                                    if (!ok) return;
                                                                    dbService.managePlayoffEntry(pool.id, entry.id!, 'delete');
                                                                }}
                                                                className="text-white bg-brandred-600 hover:bg-brandred-500 p-2 rounded-lg transition-colors duration-150"
                                                                title="Delete Entry"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => setViewingEntry(entry)}
                                                                className="text-muted hover:text-[color:var(--text)] bg-card hover:bg-page border border-line p-2 rounded-lg transition-colors duration-150"
                                                                title="View Picks"
                                                            >
                                                                <Eye size={16} />
                                                            </button>
                                                            <Badge status="locked" />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Preview top 3 picks? */}
                                                <div className="space-y-2">
                                                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Top Picks:</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {pool.teams
                                                            .map(t => ({ ...t, rank: entry.rankings[t.id] || 0 }))
                                                            .sort((a, b) => b.rank - a.rank)
                                                            .slice(0, 3)
                                                            .map(t => (
                                                                <span key={t.id} className={`border px-2 py-1 rounded text-xs font-display font-bold num ${t.eliminated
                                                                    ? 'bg-brandred-600/10 border-brandred-600/25 text-brandred-600 opacity-75'
                                                                    : 'bg-page border-line text-muted'
                                                                    }`}>
                                                                    #{t.seed} {t.name}
                                                                </span>
                                                            ))
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(pool as any).billing?.featuresUnlocked?.aiCommissioner && (
                                <div className="mt-8 pt-8 border-t border-line">
                                    <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'leaderboard' && (
                        <div className="flex flex-col gap-6">
                            {/* Top Section: Payouts */}
                            <div className="max-w-md">
                                <PlayoffPayoutCard pool={pool} paidEntriesCount={paidEntriesCount} />
                            </div>

                            {/* Bottom Section: Table */}
                            <div>
                                <div className="bg-card rounded-xl border border-line shadow-card overflow-hidden overflow-x-auto">
                                    <table className="w-full text-left border-collapse font-body text-[15px]">
                                        <thead>
                                            <tr className="border-b border-line bg-surface">
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] sticky left-0 bg-surface backdrop-blur z-10 w-12">#</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] sticky left-12 bg-surface backdrop-blur z-10 min-w-[180px]">Entry Name</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] bg-surface backdrop-blur z-10 min-w-[150px]">Player Name</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Wild Cards</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Divisional</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Conf Champ</th>
                                                <th className="p-4 text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Super Bowl</th>
                                                <th className="p-4 text-gold-600 dark:text-gold-400 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-right bg-gold-500/10 border-l border-gold-500/20">TOTAL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.values(pool.entries || {})
                                                .map(entry => {
                                                    // Calculate dynamic scores if not already persisted
                                                    const scoreWC = getRoundScore(entry.rankings, 'WILD_CARD');
                                                    const scoreDiv = getRoundScore(entry.rankings, 'DIVISIONAL');
                                                    const scoreConf = getRoundScore(entry.rankings, 'CONF_CHAMP');
                                                    const scoreSB = getRoundScore(entry.rankings, 'SUPER_BOWL');
                                                    const total = scoreWC + scoreDiv + scoreConf + scoreSB;

                                                    // Fallback to persisted totalScore if needed, but calculated is better for real-time
                                                    return { ...entry, scoreWC, scoreDiv, scoreConf, scoreSB, calculatedTotal: total };
                                                })
                                                .sort((a, b) => {
                                                    if (b.calculatedTotal !== a.calculatedTotal) return b.calculatedTotal - a.calculatedTotal;
                                                    // Secondary: Alphabetical by Entry Name
                                                    const nameA = a.entryName || a.userName || '';
                                                    const nameB = b.entryName || b.userName || '';
                                                    return nameA.localeCompare(nameB);
                                                })
                                                .map((entry, index) => {
                                                    const isMe = user?.id === entry.userId;
                                                    return (
                                                        <tr key={entry.id || entry.userId} className={`border-b border-line ${isMe ? 'bg-brandred-600/[0.07]' : 'hover:bg-[color:var(--page)]'}`}>
                                                            <td className="p-4 sticky left-0 bg-inherit border-r border-line">
                                                                <RankChip rank={index + 1} />
                                                            </td>
                                                            <td className="p-4 sticky left-12 bg-inherit border-r border-line">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="font-bold text-[color:var(--text)]">
                                                                        {entry.entryName || entry.userName}
                                                                    </div>
                                                                    {isMe && <YouPill />}
                                                                    {canViewPicks && (
                                                                        <button
                                                                            onClick={() => setViewingEntry(entry)}
                                                                            className="text-faint hover:text-gold-500 transition-colors duration-150"
                                                                            title="View Picks"
                                                                        >
                                                                            <Eye size={16} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {/* Status Indicators (Always Visible) */}
                                                                <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
                                                                    {canViewPicks && <span className="num">Tiebreaker: {entry.tiebreaker}</span>}
                                                                    {entry.paid && (
                                                                        <Badge status="paid" className="text-[10px] px-2 py-[3px]" />
                                                                    )}
                                                                    {!entry.paid && isManager && (
                                                                        <Badge status="unpaid" className="text-[10px] px-2 py-[3px]" />
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-muted border-r border-line">
                                                                <div className="flex justify-between items-center group/row">
                                                                    {entry.userName}
                                                                    {/* Manager Actions */}
                                                                    {isManager && (
                                                                        <div className="flex items-center gap-1">
                                                                            <button
                                                                                onClick={async (e) => {
                                                                                    e.stopPropagation();
                                                                                    const ok = await toast.confirm({ title: 'Update Payment?', message: `Mark ${entry.entryName} as ${entry.paid ? 'Unpaid' : 'Paid'}?` });
                                                                                    if (!ok) return;
                                                                                    try {
                                                                                        await dbService.managePlayoffEntry(pool.id, entry.id || '', 'togglePaid', !entry.paid);
                                                                                        // Optimistic update handled by Firestore sub
                                                                                    } catch (err) {
                                                                                        toast.error('Failed to update payment status');
                                                                                    }
                                                                                }}
                                                                                className={`p-1.5 rounded hover:bg-[color:var(--page)] transition-colors duration-150 ${entry.paid ? 'text-[#0F7B4A]' : 'text-faint'}`}
                                                                                title={entry.paid ? "Mark Unpaid" : "Mark Paid"}
                                                                            >
                                                                                <span className="font-display font-bold text-xs">$</span>
                                                                            </button>
                                                                            <button
                                                                                onClick={async (e) => {
                                                                                    e.stopPropagation();
                                                                                    const ok = await toast.confirm({ title: 'Delete Entry?', message: 'Are you sure you want to delete this entry?', confirmLabel: 'Delete', danger: true });
                                                                                    if (!ok) return;
                                                                                    // TODO: Implement delete
                                                                                    dbService.managePlayoffEntry(pool.id, entry.id!, 'delete');
                                                                                }}
                                                                                className="p-1.5 rounded hover:bg-brandred-600/10 text-faint hover:text-brandred-600 transition-colors duration-150"
                                                                                title="Delete Entry"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center num text-[color:var(--text)]">
                                                                {entry.scoreWC > 0 ? entry.scoreWC : '-'}
                                                            </td>
                                                            <td className="p-4 text-center num text-[color:var(--text)]">
                                                                {entry.scoreDiv > 0 ? entry.scoreDiv : '-'}
                                                            </td>
                                                            <td className="p-4 text-center num text-[color:var(--text)]">
                                                                {entry.scoreConf > 0 ? entry.scoreConf : '-'}
                                                            </td>
                                                            <td className="p-4 text-center num text-[color:var(--text)]">
                                                                {entry.scoreSB > 0 ? entry.scoreSB : '-'}
                                                            </td>
                                                            <td className="p-4 text-right font-display font-bold num text-gold-600 dark:text-gold-400 text-xl bg-gold-500/10 border-l border-gold-500/20">
                                                                {entry.calculatedTotal}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            {(!pool.entries || Object.keys(pool.entries).length === 0) && (
                                                <tr>
                                                    <td colSpan={8} className="p-8 text-center text-muted italic">No entries yet. Be the first!</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>
                    )}
                    {activeTab === 'rules' && (
                        <div className="bg-card rounded-xl border border-line shadow-card p-8 space-y-6">
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">How to Play</h3>
                            <ul className="list-disc pl-5 space-y-2 text-[color:var(--text)]">
                                <li>Rank all 14 playoff teams from 14 (Strongest) to 1 (Weakest).</li>
                                <li>Earn points equal to the assigned rank when a team wins.</li>
                                <li>
                                    Points are multiplied in each round:
                                    <ul className="list-none grid grid-cols-2 gap-2 mt-2 num text-sm text-gold-600 dark:text-gold-400">
                                        <li>Wild Card: {pool.settings?.scoring?.roundMultipliers?.WILD_CARD ?? 1}x</li>
                                        <li>Divisional: {pool.settings?.scoring?.roundMultipliers?.DIVISIONAL ?? 2}x</li>
                                        <li>Conference: {pool.settings?.scoring?.roundMultipliers?.CONF_CHAMP ?? 4}x</li>
                                        <li>Super Bowl: {pool.settings?.scoring?.roundMultipliers?.SUPER_BOWL ?? 8}x</li>
                                    </ul>
                                </li>
                                <li>Highest total score wins!</li>
                            </ul>

                            {pool.settings?.payouts && (
                                <>
                                    {/* [NEW] Use Payout Card */}
                                    <div className="max-w-md pt-4 border-t border-line">
                                        <PlayoffPayoutCard pool={pool} paidEntriesCount={paidEntriesCount} />
                                    </div>
                                    {/* Old list removed/replaced */}
                                </>
                            )}

                            {(pool.venmo || pool.zelle) && (
                                <>
                                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] pt-4 border-t border-line">Payment Options</h3>
                                    <div className="flex flex-col gap-2 max-w-sm">
                                        {pool.venmo && (
                                            <a href={`https://venmo.com/u/${pool.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-4 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 justify-center transition-colors duration-150 shadow-lg shadow-[#008CFF]/20">
                                                Venmo: {pool.venmo} <ExternalLink size={16} />
                                            </a>
                                        )}
                                        {pool.zelle && (
                                            <div className="bg-surface border border-line text-[color:var(--text)] px-4 py-3 rounded-lg font-bold flex items-center gap-2 justify-between group">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-muted text-xs uppercase font-display font-bold tracking-[0.08em] mr-1">Zelle:</span>
                                                    {pool.zelle}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(pool.zelle || '');
                                                        setZelleCopied(true);
                                                        setTimeout(() => setZelleCopied(false), 2000);
                                                    }}
                                                    className="bg-card border border-line hover:bg-page p-2 rounded transition-all duration-150 transform active:scale-95"
                                                    title="Copy Zelle Info"
                                                >
                                                    {zelleCopied ? <Check size={16} className="text-[#0F7B4A]" /> : <Copy size={16} className="text-muted group-hover:text-[color:var(--text)]" />}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {pool.settings?.paymentInstructions && (
                                <>
                                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] pt-4 border-t border-line">Payment Instructions</h3>
                                    <div className="bg-page border border-line p-4 rounded-lg text-[color:var(--text)] whitespace-pre-wrap">
                                        {pool.settings.paymentInstructions}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    {activeTab === 'ai' && (
                        <div className="bg-card rounded-xl border border-line shadow-card p-8 space-y-6">
                            <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                        </div>
                    )}
                    {/* [NEW] Commissioner Tab */}
                    {activeTab === 'commissioner' && isManager && user && (
                        <div className="bg-card rounded-xl border border-line shadow-card p-8 space-y-8">
                            <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] mb-6 flex items-center gap-2">
                                <Settings className="text-gold-500" /> Commissioner Tools
                            </h2>

                            {/* [NEW] Pool Status Control */}
                            <div className="bg-surface p-6 rounded-xl border border-line">
                                <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                                    Pool Status
                                    <Badge status={pool.isLocked ? 'locked' : 'open'} className="text-[11px] px-2 py-[3px]">
                                        {pool.isLocked ? 'Locked' : 'Open'}
                                    </Badge>
                                </h3>
                                <div className="flex items-center justify-between gap-4">
                                    <p className="text-sm text-muted">
                                        {pool.isLocked
                                            ? "Pool is locked. New entries cannot be added and picks are visible to everyone."
                                            : "Pool is open. Users can add/edit entries and picks are hidden."
                                        }
                                    </p>
                                    <Button
                                        variant={pool.isLocked ? 'secondary' : 'primary'}
                                        size="sm"
                                        onClick={async () => {
                                            const newStatus = !pool.isLocked;
                                            const ok = await toast.confirm({
                                                title: newStatus ? 'Lock Pool?' : 'Unlock Pool?',
                                                message: `Are you sure you want to ${newStatus ? 'LOCK' : 'UNLOCK'} the pool?`,
                                                confirmLabel: newStatus ? 'Lock Pool' : 'Unlock Pool',
                                                danger: newStatus
                                            });
                                            if (!ok) return;
                                            try {
                                                await dbService.updatePool(pool.id, { isLocked: newStatus });
                                            } catch (err) {
                                                toast.error('Failed to update pool status');
                                            }
                                        }}
                                    >
                                        {pool.isLocked ? 'Unlock Pool' : 'Lock Pool'}
                                    </Button>
                                </div>
                            </div>

                            <div className="max-w-2xl">
                                <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-4">Announcements</h3>
                                <AnnouncementManager pool={pool as any} currentUser={user} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {/* View Picks Modal */}
            {viewingEntry && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                    <div className="bg-card rounded-xl border border-line shadow-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                        <div className="p-6 border-b border-line flex justify-between items-center sticky top-0 bg-card z-10">
                            <div>
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">{viewingEntry.userName}'s Picks</h3>
                                <p className="text-sm text-muted num">Tiebreaker Prediction: {viewingEntry.tiebreaker}</p>
                            </div>
                            <button
                                onClick={() => setViewingEntry(null)}
                                className="bg-surface border border-line hover:bg-page text-muted hover:text-[color:var(--text)] p-2 rounded-lg transition-colors duration-150"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Render picks grouped by rank */}
                            <div className="space-y-4">
                                {pool.teams
                                    .map(t => ({ ...t, rank: viewingEntry.rankings[t.id] || 0 }))
                                    .sort((a, b) => b.rank - a.rank)
                                    .map((team, index) => (
                                        <div key={team.id} className={`flex items-center gap-4 bg-surface p-3 rounded-lg border border-line ${team.eliminated ? 'opacity-50 grayscale' : ''}`}>
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm num ${index < 3 ? 'bg-gold-foil text-navy-900' : 'bg-page border border-line text-muted'
                                                }`}>
                                                {team.rank}
                                            </div>
                                            <div className="flex-1">
                                                <div className="font-bold text-[color:var(--text)] flex items-center gap-2">
                                                    {team.name}
                                                    <span className="text-xs font-normal text-muted px-2 py-0.5 bg-page rounded border border-line num">
                                                        #{team.seed} {team.conference}
                                                    </span>
                                                    {team.eliminated && (
                                                        <span className="text-[10px] font-display font-bold text-brandred-600 uppercase tracking-[0.08em] border border-brandred-600/30 px-1.5 py-0.5 rounded bg-brandred-600/10">
                                                            Eliminated
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Show if they won any points yet */}
                                            <div className="text-right">
                                                {/* Logic for showing points could go here if we wanted detailed breakdown */}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        <div className="p-6 border-t border-line bg-surface">
                            <Button
                                variant="secondary"
                                onClick={() => setViewingEntry(null)}
                                className="w-full"
                            >
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div >
        </BillingGate>
    );
};
