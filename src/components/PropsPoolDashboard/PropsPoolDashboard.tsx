import React, { useState, useEffect } from 'react';
import { BillingGate } from '../billing';
import type { PropsPool, PropCard } from '../../types';
import { PropCardForm } from '../Props/PropCardForm'; // Reusing this for "My Cards"
import { AICommissioner } from '../AICommissioner';

import { PropGradingDashboard } from '../Props/PropGradingDashboard';
import { PropLeaderboard } from '../Props/PropLeaderboard';
import { PropStats } from '../Props/PropStats';
import { GameScoreboard } from '../GameScoreboard';
import { StatusCard } from '../StatusCard';
import { PayoutSummaryCard } from '../PayoutSummaryCard';

import { Share2, Grid3X3, Trophy, ChevronLeft, Shield, BarChart2, Check, Lock, Bot, Dices } from 'lucide-react';
import { PropsWizard as PropWizard } from '../PropsWizard/PropsWizard';
import { dbService } from '../../services/dbService';
import { ShareModal } from '../modals/ShareModal';
import { useToast } from '../ui/Toast';
import { HelpRoutePublisher } from '../../help/publish';
import { useUrlTab } from '../help/useUrlTab';

/**
 * The tab ids, as one list. `useUrlTab` needs it to reject a stale `?tab=`
 * value, and `src/help/content/pool-pages.ts` names the same ids — a tab
 * renamed here without its help page fails `help-registry-invariants`.
 */
const PROPS_TABS = ['cards', 'leaderboard', 'stats', 'admin', 'grading', 'ai'] as const;
export type PropsTab = (typeof PROPS_TABS)[number];
import { getUserMessage } from '../../utils/errorMessages';
import { Badge, Button, Tag } from '../ui';
import { resolveLogoUrl } from '../../utils/logoUrl';

interface PropsPoolDashboardProps {
    pool: PropsPool;
    user: any;
    isManager?: boolean;
    isAdmin?: boolean;
    onBack: () => void;
    initialTab?: PropsTab;
    onOpenAuth?: () => void;
}

export const PropsPoolDashboard: React.FC<PropsPoolDashboardProps> = ({ pool, user, isManager, isAdmin, onBack, initialTab = 'cards', onOpenAuth }) => {
    const toast = useToast();

    // T2 / K13: the tab moved into `?tab=`, the convention NFL and Bracket
    // already use — so a help search result can link to it and Back works.
    //
    // ⚠️ THE VALID SET IS THE OFFERED SET, NOT THE STATIC LIST (codex R4, P1).
    // These tabs were held in memory, so `admin`, `grading` and `stats` were
    // unreachable to anyone the tab strip did not show a button to. Validating a
    // URL against the full list would have made `/pool/<id>?tab=admin` render the
    // commissioner panel — pool locking and grading controls — for any member,
    // because the render branches below gate on the BUTTON being hidden and not
    // on the permission. Computed once, above the hook, and reused as the list
    // Help may link to; one source for "which tabs exist right now".
    const canManage = !!isManager || !!isAdmin;
    const aiUnlocked = !!(pool as any).billing?.featuresUnlocked?.aiCommissioner;
    const showStats = !!pool.isLocked || canManage;
    const offeredTabs = PROPS_TABS.filter((t) =>
        (t !== 'ai' || aiUnlocked)
        && (t !== 'stats' || showStats)
        && ((t !== 'admin' && t !== 'grading') || canManage)
    );
    const [activeTab, setActiveTab] = useUrlTab(
        'tab',
        offeredTabs,
        offeredTabs.includes(initialTab) ? initialTab : 'cards',
    );
    const [allCards, setAllCards] = useState<PropCard[]>([]);
    const [showShareModal, setShowShareModal] = useState(false);

    useEffect(() => {
        if (!pool.id) return;
        const unsub = dbService.subscribeToPropCards(pool.id, (cards) => {
            setAllCards(cards);
        });
        return () => unsub();
    }, [pool.id]);


    const [locking, setLocking] = useState(false); // Add state

    return (
        <BillingGate pool={pool as any} isCommissioner={!!isManager}>
        {/* T2: the same offered list that gates the URL, so Help lists only what
            this pool actually renders. One source, two readers. */}
        <HelpRoutePublisher tab={activeTab} isManager={!!isManager} offeredTabs={offeredTabs} />
        <div
            className="min-h-screen bg-page text-[color:var(--text)] font-body pb-20 transition-colors duration-500"
            style={{ backgroundColor: pool.branding?.backgroundColor || undefined }}
        >
            {/* Header */}
            <header className="bg-surface backdrop-blur-md relative border-b border-line">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-page rounded-lg text-muted hover:text-[color:var(--text)] transition-colors duration-150">
                            <ChevronLeft size={20} />
                        </button>
                        <div className="flex items-center gap-3">
                            {pool.branding?.logoUrl ? (
                                <div className="w-10 h-10 bg-card rounded-lg flex items-center justify-center border border-line p-1 shadow-card">
                                    <img src={resolveLogoUrl(pool.branding.logoUrl)} alt={pool.name} className="max-w-full max-h-full object-contain" />
                                </div>
                            ) : (
                                <div className="w-10 h-10 bg-gold-foil text-navy-900 rounded-lg flex items-center justify-center shadow-card">
                                    <Dices size={22} />
                                </div>
                            )}
                            <div>
                                <h1 className="font-display font-bold uppercase text-lg leading-tight text-[color:var(--text)]">{pool.name}</h1>
                                <div className="flex items-center gap-2 text-xs text-muted">
                                    <Tag sport="props" className="text-[10px] px-2 py-[3px]">Props Pool</Tag>
                                    <span>•</span>
                                    <Badge status={pool.isLocked ? 'locked' : 'open'} className="text-[10px] px-2 py-[3px]">
                                        {pool.isLocked ? 'LOCKED' : 'OPEN FOR PICKS'}
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowShareModal(true)}
                            className="p-2 hover:bg-page rounded-lg text-navy-700 dark:text-gold-400 hover:text-[color:var(--text)] transition-colors duration-150"
                        >
                            <Share2 size={20} />
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="max-w-7xl mx-auto px-4 flex gap-6 overflow-x-auto hide-scrollbar">
                    <button
                        onClick={() => setActiveTab('cards')}
                        className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'cards' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                    >
                        <Grid3X3 size={16} /> Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'leaderboard' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                    >
                        <Trophy size={16} /> Leaderboard
                    </button>

                    {(pool as any).billing?.featuresUnlocked?.aiCommissioner && (
                        <button
                            onClick={() => setActiveTab('ai')}
                            className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'ai' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                        >
                            <Bot size={16} /> AI Insights
                        </button>
                    )}

                    {showStats && (
                        <button
                            onClick={() => setActiveTab('stats')}
                            className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'stats' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                        >
                            <BarChart2 size={16} /> Stats
                        </button>
                    )}

                    {(isManager || isAdmin) && (
                        <>
                            <button
                                onClick={() => setActiveTab('admin')}
                                className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'admin' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                            >
                                <Shield size={16} /> Pool Admin
                            </button>
                            <button
                                onClick={() => setActiveTab('grading')}
                                className={`pb-3 border-b-2 font-display font-bold uppercase tracking-[0.08em] text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${activeTab === 'grading' ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
                            >
                                <Check size={16} /> Grading
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 py-8">
                {activeTab === 'cards' && (
                    <div className="max-w-6xl mx-auto space-y-8">
                        {/* Scoreboard */}
                        <GameScoreboard
                            gameState={pool as any}
                            onRepair={(isManager || isAdmin) ? async () => {
                                const ok = await toast.confirm({ title: 'Repair Scoreboard?', message: 'Repair/Re-sync Scoreboard from ESPN?', confirmLabel: 'Repair' });
                                if (!ok) return;
                                try {
                                    const res = await dbService.fixPoolScores(pool.id);
                                    if (res.success) {
                                        toast.success("Repair Successful. Reloading...");
                                        window.location.reload();
                                    } else {
                                        toast.error("Repair Failed: " + res.message);
                                    }
                                } catch (e: any) {
                                    toast.error(getUserMessage(e, 'Repair failed. Please try again.'));
                                }
                            } : undefined}
                        />

                        {/* Status Grid */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <StatusCard
                                gameState={pool as any}
                                mode="props"
                                totalEntries={allCards.length}
                            />
                            <PayoutSummaryCard
                                gameState={pool as any}
                                winners={[]} // Prop winners are handled differently or TBD
                                mode="props"
                                totalEntries={allCards.length}
                            />
                        </div>

                        <div className="grid lg:grid-cols-2 gap-8 items-start">
                            {/* Entry Form */}
                            <div className="order-2 lg:order-1">
                                <PropCardForm
                                    poolId={pool.id}
                                    config={pool.props}
                                    isLocked={pool.isLocked}
                                    currentUser={user}
                                    userCards={allCards.filter(c => c.userId === user?.id)}
                                    onOpenAuth={onOpenAuth}
                                />
                            </div>

                            {/* Leaderboard Condensed */}
                            <div className="order-1 lg:order-2 space-y-8">
                                <PropLeaderboard
                                    gameState={pool as any}
                                    currentUser={user}
                                    cards={allCards}
                                    isManager={false} // Read only view here
                                    isAdmin={false} // Read only view here
                                />
                                {(pool as any).billing?.featuresUnlocked?.aiCommissioner && (
                                    <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'leaderboard' && (
                    <div className="max-w-4xl mx-auto">
                        <PropLeaderboard
                            gameState={pool as any}
                            currentUser={user}
                            cards={allCards}
                            isManager={isManager}
                            isAdmin={isAdmin}
                        />
                    </div>
                )}

                {activeTab === 'ai' && (
                    <div className="max-w-4xl mx-auto">
                        <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                    </div>
                )}

                {activeTab === 'stats' && (
                    <div className="max-w-4xl mx-auto">
                        <PropStats questions={pool.props.questions} cards={allCards} />
                    </div>
                )}

                {activeTab === 'admin' && (
                    <div className="max-w-4xl mx-auto space-y-6">

                        {/* Manual Lock Control */}
                        {!pool.isLocked && (
                            <div className="bg-card border border-line rounded-xl shadow-card p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div>
                                    <h3 className="text-[color:var(--text)] font-display font-bold uppercase text-lg flex items-center gap-2">
                                        <Lock className="text-brandred-500" size={20} /> Lock Pool
                                    </h3>
                                    <p className="text-muted text-sm mt-1">
                                        Manually lock the pool to prevent further entries.
                                        <br />
                                        <span className="text-gold-600 dark:text-gold-400 text-xs">Note: This cannot be undone from this dashboard.</span>
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={async () => {
                                        const ok = await toast.confirm({ title: 'Lock this pool?', message: 'Are you sure you want to LOCK this pool? No more entries will be allowed.', confirmLabel: 'Lock Pool', danger: true });
                                        if (!ok) return;
                                        setLocking(true);
                                        try {
                                            await dbService.lockPool(pool.id);
                                            toast.success("Pool Locked Successfully!");
                                            window.location.reload();
                                        } catch (e: any) {
                                            toast.error(getUserMessage(e, 'Failed to lock the pool. Please try again.'));
                                        } finally {
                                            setLocking(false);
                                        }
                                    }}
                                    disabled={locking}
                                >
                                    {locking ? 'Locking...' : 'Lock Pool Now'}
                                </Button>
                            </div>
                        )}

                        {/* Fix Sync Tool */}
                        <div className="bg-card border border-line rounded-xl shadow-card p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div>
                                <h3 className="text-[color:var(--text)] font-display font-bold uppercase text-lg flex items-center gap-2">
                                    <Shield className="text-gold-500" size={20} /> Score Sync Repair
                                </h3>
                                <p className="text-muted text-sm mt-1">If the scoreboard is missing updated scores or events, use this tool to force a re-sync from ESPN.</p>
                            </div>
                            <button
                                onClick={async () => {
                                    const ok = await toast.confirm({ title: 'Force Re-sync?', message: 'This will force a full re-sync of scores from ESPN. Continue?', confirmLabel: 'Re-sync' });
                                    if (!ok) return;
                                    const btn = document.getElementById('btn-fix-sync');
                                    if (btn) btn.innerText = 'Repairing...';
                                    try {
                                        const res = await dbService.fixPoolScores(pool.id);
                                        if (res.success) {
                                            toast.success('Success! Reloading page...');
                                            window.location.reload();
                                        } else {
                                            toast.error('Failed: ' + res.message);
                                        }
                                    } catch (e: any) {
                                        toast.error(getUserMessage(e, 'Re-sync failed. Please try again.'));
                                    }
                                    if (btn) btn.innerText = 'Run Repair';
                                }}
                                id="btn-fix-sync"
                                className="bg-gold-foil text-navy-900 hover:brightness-105 px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-all duration-150 hover:-translate-y-px"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V7.86c0-.55-.45-1-1-1H16.4c-.84 0-1.65-.33-2.25-.93L12.9 4.68" /><path d="M16.25 16.25 9 9" /></svg>
                                Run Repair
                            </button>
                        </div>

                        <div className="bg-card border border-line rounded-xl shadow-card p-6">
                            <PropWizard
                                user={user}
                                onCancel={() => setActiveTab('cards')} // Or handle otherwise
                                onComplete={() => {
                                    // Refresh or notify? The wizard handles actual update.
                                    // Just force a reload or maybe we need to reload pool data?
                                    window.location.reload();
                                }}
                                initialData={pool as any}
                                embedded={true}
                            />
                        </div>
                    </div>
                )}

                {activeTab === 'grading' && (
                    <div className="max-w-4xl mx-auto">
                        <PropGradingDashboard gameState={pool as any} />
                    </div>
                )}
            </main>

            {/* Share Modal */}
            <ShareModal
                isOpen={showShareModal}
                onClose={() => setShowShareModal(false)}
                shareUrl={`${window.location.origin}/#pool/${pool.id}`}
                poolId={(isManager || isAdmin) ? pool.id : undefined}
            />
        </div>
        </BillingGate>
    );
};
