import React from 'react';
import { Activity, ArrowDown, Bot, Copy, Heart, KeyRound, Mail, Megaphone, Plus, Search, Settings, Shield, Ticket, Trash2, Trophy, Users, Wrench, X } from 'lucide-react';
import type { GameState, LoyaltyTier, Pool, User } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { CANONICAL_ROLES, normalizeRole, roleBadge } from '../../utils/roles';
import { formatPoolMatchup, getPoolEntrySummary } from '../../utils/poolSport';
import type { EntryCountable } from '../../utils/poolSport';
import { OverlayRoot } from '../ui/OverlayRoot';
import type { useToast } from '../ui/Toast';

/**
 * Members tab — one of the eight canonical Super-Admin tabs (Overview, Pools,
 * Members, Operations, Test Suite, Monetization, Themes, System). Its Users,
 * Referrals and Loyalty sub-tabs are lifted verbatim out of SuperAdmin.tsx here,
 * along with the two member modals that belong to them.
 *
 * PHASE 1 OF THE SuperAdmin.tsx SPLIT — a MECHANICAL extraction with ZERO
 * behaviour change. Only JSX moved: every piece of state, every handler and
 * every derived value still lives in SuperAdmin.tsx and arrives here as a prop.
 * Nothing was renamed, reordered, deduplicated or "improved" on the way across;
 * the panels below are byte-for-byte the markup that used to be inline, and the
 * call sites in SuperAdmin.tsx sit exactly where the old blocks did so the
 * rendered DOM order is unchanged.
 *
 * The one-line `PoolLike` alias is duplicated from SuperAdmin.tsx on purpose:
 * importing it back would make the two modules mutually dependent for a type
 * that is erased at build time anyway.
 */
type PoolLike = { [key: string]: unknown };

type ToastApi = ReturnType<typeof useToast>;
type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export interface MembersUsersPanelProps {
    users: User[];
    visibleMembers: User[];
    emailSearch: string;
    setEmailSearch: SetState<string>;
    emailSearchResults: User[] | null;
    setEmailSearchResults: SetState<User[] | null>;
    emailSearching: boolean;
    runEmailSearch: () => Promise<void>;
    memberSearch: string;
    setMemberSearch: SetState<string>;
    memberRoleFilter: string;
    setMemberRoleFilter: SetState<string>;
    memberMethodFilter: 'ALL' | 'google' | 'email';
    setMemberMethodFilter: SetState<'ALL' | 'google' | 'email'>;
    memberSort: 'created_desc' | 'created_asc' | 'name';
    setMemberSort: SetState<'created_desc' | 'created_asc' | 'name'>;
    setRoleChange: SetState<{ user: User; role: string } | null>;
    fetchUsers: () => void;
    handleExportEmails: () => Promise<void>;
    handleBackfillRoles: () => Promise<void>;
    handleDeleteUser: (user: User) => Promise<void>;
    handleResetPassword: (user: User) => Promise<void>;
    handleEmailUser: (user: User) => Promise<void>;
    handleEditUser: (user: User) => void;
    handleViewUser: (user: User) => void;
    toast: ToastApi;
}

export const MembersUsersPanel: React.FC<MembersUsersPanelProps> = ({
    users,
    visibleMembers,
    emailSearch,
    setEmailSearch,
    emailSearchResults,
    setEmailSearchResults,
    emailSearching,
    runEmailSearch,
    memberSearch,
    setMemberSearch,
    memberRoleFilter,
    setMemberRoleFilter,
    memberMethodFilter,
    setMemberMethodFilter,
    memberSort,
    setMemberSort,
    setRoleChange,
    fetchUsers,
    handleExportEmails,
    handleBackfillRoles,
    handleDeleteUser,
    handleResetPassword,
    handleEmailUser,
    handleEditUser,
    handleViewUser,
    toast,
}) => (
        <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card w-full">
            {/* Server-side email search (step 6b) — finds any user by email prefix without scanning the full list. */}
            <div className="p-4 border-b border-line bg-surface w-full">
                <div className="flex flex-wrap gap-2 items-center">
                    <input
                        value={emailSearch}
                        onChange={(e) => setEmailSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') runEmailSearch(); }}
                        placeholder="Find any user by name or email…"
                        className="flex-1 min-w-[200px] bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                    />
                    <button
                        onClick={runEmailSearch}
                        disabled={emailSearching}
                        className="text-xs bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-navy-900 px-4 py-2 rounded-lg transition-colors font-display font-bold uppercase tracking-[0.05em]"
                    >
                        {emailSearching ? 'Searching…' : 'Search'}
                    </button>
                    {emailSearchResults !== null && (
                        <button
                            onClick={() => { setEmailSearch(''); setEmailSearchResults(null); }}
                            className="text-xs bg-surface hover:bg-card border border-line text-muted px-3 py-2 rounded-lg transition-colors font-display font-bold uppercase tracking-[0.05em]"
                        >
                            Clear
                        </button>
                    )}
                </div>
                {emailSearchResults !== null && (
                    <div className="mt-3 space-y-1">
                        {emailSearchResults.length === 0 ? (
                            <p className="text-xs text-muted font-body">No users match “{emailSearch.trim()}”.</p>
                        ) : emailSearchResults.map(u => (
                            <button
                                key={u.id}
                                onClick={() => handleViewUser(u)}
                                className="w-full flex items-center justify-between gap-3 bg-card border border-line rounded-lg px-3 py-2 hover:border-gold-500/40 transition-colors text-left"
                            >
                                <span className="text-sm font-display font-bold text-[color:var(--text)] truncate">{u.name || 'Anonymous'}</span>
                                <span className="text-xs text-muted font-body truncate">{u.email}</span>
                                <span className={`shrink-0 text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${roleBadge(u.role).className}`}>{roleBadge(u.role).label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="p-4 border-b border-line bg-surface flex justify-between items-center w-full">
                <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em]">Registered Users</h2>
                <div className="flex gap-2">
                    <button
                        onClick={async () => {
                            const ok = await toast.confirm({
                                title: 'Force sync all users?',
                                message: 'Force sync all users from Auth to DB?',
                            });
                            if (ok) {
                                try {
                                    const res = await dbService.syncAllUsers();
                                    toast.success(`Synced ${res.count} users.`);
                                    fetchUsers();
                                } catch (e: unknown) {
                                    toast.error(getUserMessage(e, "Sync failed."));
                                }
                            }
                        }}
                        className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                    >
                        Force Sync
                    </button>
                    <button
                        onClick={handleBackfillRoles}
                        title="Migrate legacy roles (POOL_MANAGER/PARTICIPANT) to canonical (dry-run first)"
                        className="text-xs bg-surface hover:bg-card border border-line text-[color:var(--text)] px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                    >
                        Backfill Roles
                    </button>
                    {/* Admin Actions */}
                    <button
                        onClick={async () => {
                            const ok = await toast.confirm({
                                title: 'Recalculate GLOBAL PRIZE STATS?',
                                message: 'This will scan all locked pools and reset the total prize counter.',
                                danger: true,
                            });
                            if (ok) {
                                try {
                                    const res = await dbService.recalculateGlobalStats();
                                    dbService.logAdminAction({ action: 'RECALCULATE_GLOBAL_STATS', targetType: 'stats', status: 'success' });
                                    toast.success(res.message + " Total: $" + res.totalPrizes);
                                } catch (e) {
                                    dbService.logAdminAction({ action: 'RECALCULATE_GLOBAL_STATS', targetType: 'stats', status: 'error', error: getUserMessage(e, 'error') });
                                    toast.error(getUserMessage(e, "Failed to recalculate stats."));
                                }
                            }
                        }}
                        className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                    >
                        <Activity size={12} /> Recalculate Stats
                    </button>
                    <button
                        onClick={fetchUsers}
                        className="text-xs bg-surface hover:bg-card border border-line text-[color:var(--text)] px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                    >
                        <Activity size={12} /> Refresh List
                    </button>
                    <button
                        onClick={handleExportEmails}
                        className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                    >
                        <ArrowDown size={12} /> Export Emails
                    </button>
                </div>
            </div>
            {/* Client-side member filters — search by name OR email, filter by
                role / registration method, sort by created date or name. */}
            <div className="p-4 border-b border-line bg-surface flex flex-wrap gap-2 items-center w-full">
                <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Filter by name or email…"
                    className="flex-1 min-w-[200px] bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                />
                <select
                    aria-label="Filter by role"
                    value={memberRoleFilter}
                    onChange={(e) => setMemberRoleFilter(e.target.value)}
                    className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                >
                    <option value="ALL">All roles</option>
                    {CANONICAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select
                    aria-label="Filter by registration method"
                    value={memberMethodFilter}
                    onChange={(e) => setMemberMethodFilter(e.target.value as 'ALL' | 'google' | 'email')}
                    className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                >
                    <option value="ALL">All methods</option>
                    <option value="email">Email</option>
                    <option value="google">Google</option>
                </select>
                <select
                    aria-label="Sort members"
                    value={memberSort}
                    onChange={(e) => setMemberSort(e.target.value as 'created_desc' | 'created_asc' | 'name')}
                    className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                >
                    <option value="created_desc">Newest first</option>
                    <option value="created_asc">Oldest first</option>
                    <option value="name">Name A–Z</option>
                </select>
                <span className="text-xs text-muted font-body num whitespace-nowrap">{visibleMembers.length} of {users.length}</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                        <tr>
                            <th className="p-4 tracking-wider">Name</th>
                            <th className="p-4 tracking-wider">Email</th>
                            <th className="p-4 tracking-wider">Role</th>
                            <th className="p-4 tracking-wider">Method</th>
                            <th className="p-4 tracking-wider">Referrals</th>
                            <th className="p-4 tracking-wider">Created</th>
                            <th className="p-4 tracking-wider">ID</th>
                            <th className="p-4 tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {visibleMembers.map(u => (
                            <tr key={u.id} className="hover:bg-surface transition-colors">
                                <td className="p-4 font-medium">
                                    <button onClick={() => handleViewUser(u)} className="hover:text-gold-600 dark:hover:text-gold-400 hover:underline font-bold text-left">{u.name}</button>
                                </td>
                                <td className="p-4 text-muted font-body">{u.email}</td>
                                <td className="p-4">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${roleBadge(u.role).className}`}>
                                            {roleBadge(u.role).label}
                                        </span>
                                        <select
                                            aria-label={`Change role for ${u.email || u.id}`}
                                            value={normalizeRole(u.role)}
                                            onChange={(e) => setRoleChange({ user: u, role: e.target.value })}
                                            className="bg-surface border border-line rounded text-[10px] text-muted px-1 py-1 focus:outline-none focus:border-gold-500"
                                        >
                                            {CANONICAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>
                                </td>
                                <td className="p-4">
                                    <span className={`text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${u.registrationMethod === 'google' ? 'bg-gold-500/10 text-gold-700 dark:text-gold-400 border-gold-500/25' : 'bg-navy-600/10 text-navy-700 dark:text-gold-400 border-navy-600/25'}`}>
                                        {u.registrationMethod || 'EMAIL'}
                                    </span>
                                </td>
                                <td className="p-4 text-center">
                                    <span className="text-navy-700 dark:text-gold-400 font-display font-bold num">{u.referralCount || 0}</span>
                                </td>
                                <td className="p-4 text-faint text-xs num">
                                    {u.createdAt ? (() => {
                                        const d = new Date(u.createdAt);
                                        return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
                                    })() : '—'}
                                </td>
                                <td className="p-4 text-faint font-mono text-xs max-w-[100px] truncate" title={u.id}>{u.id}</td>
                                <td className="p-4 flex gap-2">
                                    <button
                                        onClick={() => handleResetPassword(u)}
                                        className="text-gold-700 dark:text-gold-400 hover:bg-gold-500/10 transition-colors border border-gold-500/40 px-2 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em]"
                                        title="Send Password Reset (Admin API)"
                                    >
                                        <div className="flex items-center gap-1">
                                            <Settings size={14} /> Reset
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => handleEmailUser(u)}
                                        title="Send a one-off email (logged to their activity + admin audit)"
                                        className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-navy-600/40 px-2 py-1 rounded transition-colors"
                                    >Email</button>
                                    <button onClick={() => handleEditUser(u)} className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-navy-600/40 px-2 py-1 rounded transition-colors">Edit</button>
                                    <button onClick={() => handleDeleteUser(u)} className="text-brandred-500 hover:bg-brandred-600/10 transition-colors border border-brandred-600/40 px-2 py-1 rounded"><Trash2 size={16} /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
);

export interface MembersReferralsComputedPanelProps {
    users: User[];
    getComputedReferrals: (userId: string) => number;
    handleViewUser: (user: User) => void;
}

/** Referrals sub-tab panel driven by the LOCALLY computed referral count. */
export const MembersReferralsComputedPanel: React.FC<MembersReferralsComputedPanelProps> = ({
    users,
    getComputedReferrals,
    handleViewUser,
}) => (
        <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
            <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"><Users className="text-gold-500" size={20} /> Referral Dashboard</h2>
                <span className="text-xs font-mono text-faint">Top Referrers & Referral Chain</span>
            </div>

            {/* Referral Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-line">
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-navy-800 dark:text-gold-400 num">{users.reduce((sum, u) => sum + (getComputedReferrals(u.id) || 0), 0)}</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Total Referrals</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => u.referredBy).length}</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referred Users</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">
                        {new Set(users.filter(u => u.referredBy).map(u => u.referredBy)).size}
                    </p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Active Referrers</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-[color:var(--text)] num">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referral Rate</p>
                </div>
            </div>

            {/* Top Referrers Leaderboard */}
            <div className="p-4">
                <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em] flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> Top Referrers</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                    {[...users]
                        .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                        .filter(u => u._computedCount > 0)
                        .sort((a, b) => b._computedCount - a._computedCount)
                        .slice(0, 3)
                        .map((u, i) => (
                            <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-gold-500/10 border-gold-500/40' : i === 1 ? 'bg-surface border-line' : 'bg-gold-700/10 border-gold-700/40'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`text-2xl font-display font-extrabold num ${i === 0 ? 'text-gold-500' : i === 1 ? 'text-muted' : 'text-gold-700'}`}>#{i + 1}</div>
                                    <div className="flex-1 min-w-0">
                                        <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] truncate hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                        <p className="text-xs text-muted truncate">{u.email}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">{u._computedCount}</p>
                                        <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">referrals</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    {users.every(u => getComputedReferrals(u.id) === 0) && (
                        <div className="col-span-3 text-center py-8 text-faint">No referrals yet</div>
                    )}
                </div>

                {/* Full Referral Table */}
                <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em]">All Users Referral Data</h3>
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left text-sm">
                        <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                            <tr>
                                <th className="p-3 font-bold">User</th>
                                <th className="p-3 font-bold">Referral Code</th>
                                <th className="p-3 font-bold text-center">Referrals Made</th>
                                <th className="p-3 font-bold">Referred By</th>
                                <th className="p-3 font-bold">Joined</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {[...users]
                                .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                .sort((a, b) => b._computedCount - a._computedCount)
                                .map(u => {
                                    const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                    return (
                                        <tr key={u.id} className="hover:bg-surface">
                                            <td className="p-3">
                                                <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                <p className="text-xs text-faint">{u.email}</p>
                                            </td>
                                            <td className="p-3">
                                                <code className="text-xs bg-surface border border-line px-2 py-1 rounded text-gold-700 dark:text-gold-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`font-bold num ${u._computedCount > 0 ? 'text-navy-700 dark:text-gold-400' : 'text-faint'} `}>{u._computedCount}</span>
                                            </td>
                                            <td className="p-3">
                                                {referrer ? (
                                                    <span className="text-gold-600 dark:text-gold-400 text-xs">{referrer.name}</span>
                                                ) : u.referredBy ? (
                                                    <span className="text-faint text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                ) : (
                                                    <span className="text-faint text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-xs text-faint">
                                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
);

export interface MembersLoyaltyPanelProps {
    users: User[];
    userPoolCounts: Record<string, number>;
    userTiers: { mapping: Record<string, string>; list: Record<string, User[]> };
    activeTiers: LoyaltyTier[];
    editingTiers: LoyaltyTier[];
    setEditingTiers: SetState<LoyaltyTier[]>;
    handleSaveTiers: () => Promise<void>;
    handleAddTierLocal: () => void;
    handleRemoveTierLocal: (id: string) => void;
    selectedMarketingTier: string;
    setSelectedMarketingTier: SetState<string>;
    marketingSearch: string;
    setMarketingSearch: SetState<string>;
    promoUser: User | null;
    setPromoUser: SetState<User | null>;
    promoBulkTier: string | null;
    setPromoBulkTier: SetState<string | null>;
    promoSubject: string;
    setPromoSubject: SetState<string>;
    promoMessage: string;
    setPromoMessage: SetState<string>;
    promoCoupon: string;
    setPromoCoupon: SetState<string>;
    promoType: 'coupon' | 'reminder';
    setPromoType: SetState<'coupon' | 'reminder'>;
    isSendingPromo: boolean;
    setIsSendingPromo: SetState<boolean>;
    handleViewUser: (user: User) => void;
    toast: ToastApi;
}

export const MembersLoyaltyPanel: React.FC<MembersLoyaltyPanelProps> = ({
    users,
    userPoolCounts,
    userTiers,
    activeTiers,
    editingTiers,
    setEditingTiers,
    handleSaveTiers,
    handleAddTierLocal,
    handleRemoveTierLocal,
    selectedMarketingTier,
    setSelectedMarketingTier,
    marketingSearch,
    setMarketingSearch,
    promoUser,
    setPromoUser,
    promoBulkTier,
    setPromoBulkTier,
    promoSubject,
    setPromoSubject,
    promoMessage,
    setPromoMessage,
    promoCoupon,
    setPromoCoupon,
    promoType,
    setPromoType,
    isSendingPromo,
    setIsSendingPromo,
    handleViewUser,
    toast,
}) => (
        <div className="space-y-8 animate-in fade-in duration-300">

            {/* TIER CONFIGURATION CONTROL CENTER */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                <div className="lg:col-span-3 bg-card border border-line rounded-3xl p-6 shadow-panel flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                            <Shield className="text-gold-500" /> Tiers Control Center
                        </h3>
                        <p className="text-muted text-xs mt-1">
                            Define loyalty tiers based on lifetime pool entries. Changes will apply immediately across all user dashboards.
                        </p>
                    </div>

                    <div className="space-y-4 mt-6">
                        {editingTiers?.map((tier, index) => (
                            <div key={tier.id} className="bg-surface border border-line rounded-2xl p-4 flex flex-col md:flex-row items-center gap-4 relative group">
                                <div className="flex-1 w-full space-y-3">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Tier Name</label>
                                            <input
                                                type="text"
                                                value={tier.name}
                                                onChange={(e) => {
                                                    const updated = [...(editingTiers || [])];
                                                    updated[index] = { ...tier, name: e.target.value };
                                                    setEditingTiers(updated);
                                                }}
                                                className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Min Pools</label>
                                            <input
                                                type="number"
                                                value={tier.minPools}
                                                onChange={(e) => {
                                                    const updated = [...(editingTiers || [])];
                                                    updated[index] = { ...tier, minPools: Math.max(0, parseInt(e.target.value) || 0) };
                                                    setEditingTiers(updated);
                                                }}
                                                className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Description</label>
                                        <input
                                            type="text"
                                            value={tier.description}
                                            onChange={(e) => {
                                                const updated = [...(editingTiers || [])];
                                                updated[index] = { ...tier, description: e.target.value };
                                                setEditingTiers(updated);
                                            }}
                                            className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRemoveTierLocal(tier.id)}
                                    className="p-2 border border-brandred-600/30 text-brandred-500 hover:bg-brandred-600/10 rounded-xl mt-3 md:mt-0 transition duration-200"
                                    title="Delete Tier"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-3 mt-6 pt-4 border-t border-line">
                        <button
                            onClick={handleAddTierLocal}
                            className="flex items-center gap-1 bg-surface hover:bg-card text-[color:var(--text)] px-4 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition border border-line"
                        >
                            <Plus size={14} /> Add New Tier
                        </button>
                        <button
                            onClick={handleSaveTiers}
                            className="bg-brandred-600 hover:bg-brandred-500 text-white px-5 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition ml-auto shadow-red-cta"
                        >
                            Save Tier Configuration
                        </button>
                    </div>
                </div>

                {/* TIER DISTRIBUTION GRAPH */}
                <div className="lg:col-span-2 bg-card border border-line rounded-3xl p-6 shadow-panel flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                            <Activity className="text-gold-500" /> Tier Distribution
                        </h3>
                        <p className="text-muted text-xs mt-1">
                            Active user split across loyalty thresholds.
                        </p>
                    </div>

                    <div className="space-y-6 mt-8 flex-1 flex flex-col justify-center">
                        {activeTiers.map((t: LoyaltyTier) => {
                            const count = userTiers.list[t.id]?.length || 0;
                            const pct = users.length > 0 ? (count / users.length) * 100 : 0;
                            return (
                                <div key={t.id} className="space-y-1.5">
                                    <div className="flex justify-between text-xs font-bold">
                                        <span className="text-[color:var(--text)] flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-full bg-gold-500"></span>
                                            {t.name}
                                        </span>
                                        <span className="text-muted font-mono num">{count} ({pct.toFixed(0)}%)</span>
                                    </div>
                                    <div className="h-3 w-full bg-surface rounded-full border border-line overflow-hidden">
                                        <div
                                            className="h-full w-full origin-left bg-gold-foil rounded-full transition-transform duration-300"
                                            style={{ transform: `scaleX(${pct / 100})` }}
                                        ></div>
                                    </div>
                                    <p className="text-[10px] text-faint">{t.description}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* TARGETED MARKETING HUB */}
            <div className="bg-card border border-line rounded-3xl p-6 shadow-panel">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-line">
                    <div>
                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                            <Users className="text-gold-500" /> Targeted Marketing Hub
                        </h3>
                        <p className="text-muted text-xs mt-0.5">
                            Filter and search users by tier, copy bulk emails, export CSV data, or send mock promos.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                            onClick={() => {
                                let list: User[] = [];
                                if (selectedMarketingTier === 'all') {
                                    list = users;
                                } else {
                                    list = userTiers.list[selectedMarketingTier] || [];
                                }
                                const emails = list.map((u: User) => u.email).join(', ');
                                navigator.clipboard.writeText(emails);
                                toast.success(`Copied ${list.length} emails to clipboard!`);
                            }}
                            className="text-xs bg-surface hover:bg-card text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl border border-line transition flex items-center gap-1.5"
                        >
                            <Copy size={13} /> Copy Group Emails
                        </button>

                        <button
                            onClick={() => {
                                let list: User[] = [];
                                if (selectedMarketingTier === 'all') {
                                    list = users;
                                } else {
                                    list = userTiers.list[selectedMarketingTier] || [];
                                }
                                const headers = ['UID', 'Name', 'Email', 'Phone', 'Pools Entered', 'Tier'];
                                const rows = list.map((u: User) => {
                                    const count = userPoolCounts[u.id] || 0;
                                    const tier = userTiers.mapping[u.id] || 'None';
                                    return `"${u.id}","${u.name}","${u.email}","${u.phone || ''}",${count},"${tier}"`;
                                });
                                const csvContent = [headers.join(','), ...rows].join('\n');
                                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.setAttribute('href', url);
                                const tierSuffix = selectedMarketingTier === 'all' ? 'all_users' : activeTiers.find((t: LoyaltyTier) => t.id === selectedMarketingTier)?.name.toLowerCase().replace(/\s+/g, '_') || 'tier';
                                link.setAttribute('download', `loyalty_${tierSuffix}_${new Date().toISOString().slice(0, 10)}.csv`);
                                link.style.visibility = 'hidden';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }}
                            className="text-xs bg-gold-500/10 hover:bg-gold-500/20 text-gold-700 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl border border-gold-500/30 transition flex items-center gap-1.5"
                        >
                            <ArrowDown size={13} /> Export CSV
                        </button>

                        <button
                            onClick={() => {
                                if (selectedMarketingTier === 'all') {
                                    toast.info('Please select a specific tier from the dropdown to run bulk promo actions.');
                                    return;
                                }
                                setPromoBulkTier(selectedMarketingTier);
                                setPromoSubject(`Special Offer for our ${activeTiers.find((t: LoyaltyTier) => t.id === selectedMarketingTier)?.name} Members!`);
                                setPromoMessage('Thank you for being such an active part of March Melee Pools!');
                                setPromoType('coupon');
                                setPromoCoupon('LOYALTY20');
                            }}
                            className="text-xs bg-gold-foil text-navy-900 hover:brightness-105 font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl transition shadow-card flex items-center gap-1.5"
                        >
                            <Plus size={13} /> Bulk Mock Promo
                        </button>
                    </div>
                </div>

                {/* FILTERS TOOLBAR */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6 items-center bg-surface p-3 rounded-2xl border border-line">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] shrink-0">Filter Tier:</span>
                        <select
                            value={selectedMarketingTier}
                            onChange={(e) => setSelectedMarketingTier(e.target.value)}
                            className="w-full bg-card border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-bold"
                        >
                            <option value="all">All Tiers (Show All Users)</option>
                            {activeTiers.map((t: LoyaltyTier) => (
                                <option key={t.id} value={t.id}>{t.name} ({userTiers.list[t.id]?.length || 0} users)</option>
                            ))}
                        </select>
                    </div>

                    <div className="relative w-full sm:flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                            type="text"
                            placeholder="Search roster by name, email, or phone..."
                            value={marketingSearch}
                            onChange={(e) => setMarketingSearch(e.target.value)}
                            className="w-full bg-card border border-line rounded-xl py-2 pl-9 pr-4 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold"
                        />
                    </div>
                </div>

                {/* ROSTER TABLE */}
                <div className="overflow-x-auto rounded-2xl border border-line">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-surface text-muted uppercase font-display font-black tracking-[0.08em] text-[10px]">
                            <tr>
                                <th className="p-4">Name</th>
                                <th className="p-4">Email</th>
                                <th className="p-4">Phone</th>
                                <th className="p-4 text-center">Pools Entered</th>
                                <th className="p-4">Current Loyalty Tier</th>
                                <th className="p-4">Marketing Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line font-body font-semibold text-muted text-[11px]">
                            {(() => {
                                let list: User[] = [];
                                if (selectedMarketingTier === 'all') {
                                    list = users;
                                } else {
                                    list = userTiers.list[selectedMarketingTier] || [];
                                }

                                if (marketingSearch) {
                                    const s = marketingSearch.toLowerCase();
                                    list = list.filter((u: User) => 
                                        u.name.toLowerCase().includes(s) || 
                                        u.email.toLowerCase().includes(s) || 
                                        (u.phone && u.phone.includes(s))
                                    );
                                }

                                if (list.length === 0) {
                                    return <tr><td colSpan={6} className="p-8 text-center text-faint font-display font-bold uppercase tracking-[0.08em] text-[10px]">No users match this filter</td></tr>;
                                }

                                return list.map((u: User) => {
                                    const count = userPoolCounts[u.id] || 0;
                                    const tier = userTiers.mapping[u.id] || 'None';
                                    return (
                                        <tr key={u.id} className="hover:bg-surface transition-colors">
                                            <td className="p-4 font-bold text-[color:var(--text)]">
                                                <button onClick={() => handleViewUser(u)} className="hover:text-gold-600 dark:hover:text-gold-400 hover:underline text-left">{u.name}</button>
                                            </td>
                                            <td className="p-4 text-muted">{u.email}</td>
                                            <td className="p-4 font-mono text-muted num">{u.phone || '—'}</td>
                                            <td className="p-4 text-center font-mono text-[color:var(--text)] font-bold num">{count}</td>
                                            <td className="p-4">
                                                <span className="text-[9px] uppercase font-display font-black tracking-widest px-2 py-0.5 rounded-full bg-gold-500/10 text-gold-700 dark:text-gold-400 border border-gold-500/30">
                                                    {tier}
                                                </span>
                                            </td>
                                            <td className="p-4 flex gap-2">
                                                <a
                                                    href={`mailto:${u.email}`}
                                                    className="text-xs bg-surface hover:bg-card text-[color:var(--text)] px-2.5 py-1 rounded-lg border border-line transition font-display font-bold uppercase tracking-[0.05em]"
                                                >
                                                    Email
                                                </a>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(u.email);
                                                        toast.success('Email copied to clipboard!');
                                                    }}
                                                    className="text-xs bg-surface hover:bg-card text-[color:var(--text)] px-2.5 py-1 rounded-lg border border-line transition"
                                                    title="Copy Email"
                                                >
                                                    <Copy size={12} />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setPromoUser(u);
                                                        setPromoSubject(`Special Direct Offer for ${u.name}!`);
                                                        setPromoMessage(`Hi ${u.name}, we have a special offer just for you!`);
                                                        setPromoType('coupon');
                                                        setPromoCoupon('DIRECT15');
                                                    }}
                                                    className="text-xs bg-navy-600/10 hover:bg-navy-600/20 text-navy-700 dark:text-gold-400 border border-navy-600/30 px-2.5 py-1 rounded-lg transition font-display font-black uppercase tracking-[0.05em]"
                                                >
                                                    Direct Mock Promo
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                });
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MOCK PROMO SENDER MODAL */}
            {(promoUser || promoBulkTier) && (
                <OverlayRoot id="sa-promo-campaign" label="Mock promo campaign creator" onEscape={() => { setPromoUser(null); setPromoBulkTier(null); }} className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-line rounded-3xl p-6 w-full max-w-lg shadow-panel flex flex-col justify-between relative">
                        <button
                            onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                            className="absolute top-4 right-4 p-1.5 border border-line text-muted hover:text-[color:var(--text)] rounded-xl bg-surface"
                        >
                            <X size={18} />
                        </button>

                        <div>
                            <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2 mb-1">
                                <Bot className="text-gold-500 animate-pulse" /> Mock Promo Campaign Creator
                            </h3>
                            <p className="text-muted text-xs font-body font-semibold">
                                {promoBulkTier
                                  ? `Broadcasting simulated campaign to all members of the ${activeTiers.find((t: LoyaltyTier) => t.id === promoBulkTier)?.name} loyalty tier.`
                                  : `Configuring mock coupon code/marketing email directly to ${promoUser?.name}.`
                                }
                            </p>
                        </div>

                        <div className="space-y-4 mt-6">
                            <div>
                                <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Marketing Action Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setPromoType('coupon')}
                                        className={`py-2 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-xl border transition flex items-center justify-center gap-1.5 ${promoType === 'coupon' ? 'bg-gold-500/10 border-gold-500/40 text-gold-700 dark:text-gold-400' : 'bg-surface border-line text-muted'}`}
                                    >
                                        <Ticket size={13} /> Discount Coupon
                                    </button>
                                    <button
                                        onClick={() => setPromoType('reminder')}
                                        className={`py-2 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-xl border transition flex items-center justify-center gap-1.5 ${promoType === 'reminder' ? 'bg-navy-600/10 border-navy-600/40 text-navy-700 dark:text-gold-400' : 'bg-surface border-line text-muted'}`}
                                    >
                                        <Megaphone size={13} /> Text Reminder/Promo
                                    </button>
                                </div>
                            </div>

                            {promoType === 'coupon' && (
                                <div>
                                    <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Coupon Code</label>
                                    <input
                                        type="text"
                                        value={promoCoupon}
                                        onChange={(e) => setPromoCoupon(e.target.value.toUpperCase())}
                                        className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-[color:var(--text)] focus:outline-none focus:border-gold-500 font-mono font-bold"
                                        placeholder="e.g. LOYALTY50"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Subject / Header</label>
                                <input
                                    type="text"
                                    value={promoSubject}
                                    onChange={(e) => setPromoSubject(e.target.value)}
                                    className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold"
                                    placeholder="Subject of marketing email"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Message Content</label>
                                <textarea
                                    value={promoMessage}
                                    onChange={(e) => setPromoMessage(e.target.value)}
                                    rows={3}
                                    className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold resize-none"
                                    placeholder="Tell them about the coupon/remind them to lock in their picks..."
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6 pt-4 border-t border-line">
                            <button
                                onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                                className="bg-surface hover:bg-card text-[color:var(--text)] px-4 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition border border-line"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    if (!promoSubject || !promoMessage || (promoType === 'coupon' && !promoCoupon)) {
                                        toast.info('Please fill out all promo fields.');
                                        return;
                                    }
                                    setIsSendingPromo(true);
                                    // Simulate API delay
                                    await new Promise(r => setTimeout(r, 1200));
                                    setIsSendingPromo(false);
                                    toast.success(`Campaign successfully simulated! Target: ${promoBulkTier ? activeTiers.find((t: LoyaltyTier) => t.id === promoBulkTier)?.name + ' Tier' : promoUser?.name} - Type: ${promoType.toUpperCase()} - Code: ${promoType === 'coupon' ? promoCoupon : 'N/A'} - Message: ${promoMessage}`);
                                    setPromoUser(null);
                                    setPromoBulkTier(null);
                                }}
                                disabled={isSendingPromo}
                                className="bg-brandred-600 hover:bg-brandred-500 text-white px-5 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition ml-auto shadow-red-cta disabled:opacity-50"
                            >
                                {isSendingPromo ? 'Sending Simulation...' : 'Execute Mock Campaign'}
                            </button>
                        </div>
                    </div>
                </OverlayRoot>
            )}
        </div>
);

export interface MembersReferralsStoredPanelProps {
    users: User[];
    handleViewUser: (user: User) => void;
}

/**
 * Second Referrals panel, driven by the STORED `referralCount` field.
 *
 * It renders alongside MembersReferralsComputedPanel — both blocks were guarded
 * by `activeTab === 'referrals'` in SuperAdmin.tsx, so the sub-tab has always
 * shown two Referral Dashboards stacked. That duplication is PRE-EXISTING and is
 * deliberately preserved here: this extraction changes no behaviour. See the PR
 * that introduced this file for the follow-up.
 */
export const MembersReferralsStoredPanel: React.FC<MembersReferralsStoredPanelProps> = ({
    users,
    handleViewUser,
}) => (
        <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
            <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"><Users className="text-gold-500" size={20} /> Referral Dashboard</h2>
                <span className="text-xs font-mono text-faint">Top Referrers & Referral Chain</span>
            </div>

            {/* Referral Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-line">
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-navy-800 dark:text-gold-400 num">{users.reduce((sum, u) => sum + (u.referralCount || 0), 0)}</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Total Referrals</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => u.referredBy).length}</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referred Users</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => (u.referralCount || 0) > 0).length}</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Active Referrers</p>
                </div>
                <div className="bg-surface border border-line p-4 rounded-lg text-center">
                    <p className="text-3xl font-display font-bold text-[color:var(--text)] num">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                    <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referral Rate</p>
                </div>
            </div>

            {/* Top Referrers Leaderboard */}
            <div className="p-4">
                <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em] flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> Top Referrers</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                    {[...users]
                        .filter(u => (u.referralCount || 0) > 0)
                        .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                        .slice(0, 3)
                        .map((u, i) => (
                            <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-gold-500/10 border-gold-500/40' : i === 1 ? 'bg-surface border-line' : 'bg-gold-700/10 border-gold-700/40'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`text-2xl font-display font-extrabold num ${i === 0 ? 'text-gold-500' : i === 1 ? 'text-muted' : 'text-gold-700'}`}>#{i + 1}</div>
                                    <div className="flex-1 min-w-0">
                                        <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] truncate hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                        <p className="text-xs text-muted truncate">{u.email}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">{u.referralCount || 0}</p>
                                        <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">referrals</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    {users.filter(u => (u.referralCount || 0) > 0).length === 0 && (
                        <div className="col-span-3 text-center py-8 text-faint">No referrals yet</div>
                    )}
                </div>

                {/* Full Referral Table */}
                <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em]">All Users Referral Data</h3>
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left text-sm">
                        <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                            <tr>
                                <th className="p-3 font-bold">User</th>
                                <th className="p-3 font-bold">Referral Code</th>
                                <th className="p-3 font-bold text-center">Referrals Made</th>
                                <th className="p-3 font-bold">Referred By</th>
                                <th className="p-3 font-bold">Joined</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {[...users]
                                .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                .map(u => {
                                    const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                    return (
                                        <tr key={u.id} className="hover:bg-surface">
                                            <td className="p-3">
                                                <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                <p className="text-xs text-faint">{u.email}</p>
                                            </td>
                                            <td className="p-3">
                                                <code className="text-xs bg-surface border border-line px-2 py-1 rounded text-gold-700 dark:text-gold-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`font-bold num ${(u.referralCount || 0) > 0 ? 'text-navy-700 dark:text-gold-400' : 'text-faint'} `}>{u.referralCount || 0}</span>
                                            </td>
                                            <td className="p-3">
                                                {referrer ? (
                                                    <span className="text-gold-600 dark:text-gold-400 text-xs">{referrer.name}</span>
                                                ) : u.referredBy ? (
                                                    <span className="text-faint text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                ) : (
                                                    <span className="text-faint text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-xs text-faint">
                                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
);

export interface MembersEditUserModalProps {
    editName: string;
    setEditName: SetState<string>;
    editEmail: string;
    setEditEmail: SetState<string>;
    setEditingUser: SetState<User | null>;
    saveUserChanges: () => Promise<void>;
}

export const MembersEditUserModal: React.FC<MembersEditUserModalProps> = ({
    editName,
    setEditName,
    editEmail,
    setEditEmail,
    setEditingUser,
    saveUserChanges,
}) => (
        <OverlayRoot id="sa-edit-user" label="Edit user" onEscape={() => setEditingUser(null)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card p-6 rounded-xl border border-line w-full max-w-md shadow-panel">
                <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Edit User</h3>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1">Name</label>
                        <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-surface border border-line rounded p-2 font-body text-[color:var(--text)]" />
                    </div>
                    <div>
                        <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1">Email</label>
                        <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full bg-surface border border-line rounded p-2 font-body text-[color:var(--text)]" />
                    </div>
                </div>
                <div className="flex justify-end gap-3">
                    <button onClick={() => setEditingUser(null)} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] text-sm">Cancel</button>
                    <button onClick={saveUserChanges} className="bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm shadow-red-cta">Save Changes</button>
                </div>
            </div>
        </OverlayRoot>
);

export interface MembersViewUserModalProps {
    viewingUser: User;
    setViewingUser: SetState<User | null>;
    pools: Pool[];
    activeTiers: LoyaltyTier[];
    getComputedReferrals: (userId: string) => number;
    handleEditUser: (user: User) => void;
    handleResetPassword: (user: User) => Promise<void>;
    handleEmailUser: (user: User) => Promise<void>;
}

export const MembersViewUserModal: React.FC<MembersViewUserModalProps> = ({
    viewingUser,
    setViewingUser,
    pools,
    activeTiers,
    getComputedReferrals,
    handleEditUser,
    handleResetPassword,
    handleEmailUser,
}) => (
        <OverlayRoot id="sa-view-user" label="User details" onEscape={() => setViewingUser(null)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-line rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-panel flex flex-col">
                <div className="p-6 border-b border-line flex justify-between items-start bg-surface rounded-t-2xl">
                    <div>
                        <h2 className="text-3xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-1">{viewingUser.name}</h2>
                        <p className="text-muted font-body flex items-center gap-2 text-sm">
                            <span className="bg-card px-2 py-0.5 rounded text-[color:var(--text)] border border-line">ID: {viewingUser.id}</span>
                            <span className="text-faint">•</span>
                            <span>{viewingUser.email}</span>
                        </p>
                    </div>
                    <button onClick={() => setViewingUser(null)} className="p-2 hover:bg-surface rounded-lg text-muted hover:text-[color:var(--text)] transition-colors">
                        <span className="sr-only">Close</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                <div className="p-6">
                    {/* Member actions — reuse the row handlers so every user action
                        is reachable from the detail popup, not just the table row. */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        <button
                            onClick={() => handleEmailUser(viewingUser)}
                            className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                        >
                            <Mail size={14} /> Email User
                        </button>
                        <button
                            onClick={() => handleResetPassword(viewingUser)}
                            className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                        >
                            <KeyRound size={14} /> Reset Password
                        </button>
                        <button
                            onClick={() => { const u = viewingUser; setViewingUser(null); handleEditUser(u); }}
                            className="text-xs bg-gold-500 hover:bg-gold-400 text-navy-900 px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                        >
                            <Wrench size={14} /> Edit User
                        </button>
                    </div>
                    {/* Unified profile facts (T6): role + referrals + loyalty + account in one place. */}
                    {(() => {
                        const ownedCount = pools.filter(p => {
                            const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                            return owner === viewingUser.id;
                        }).length;
                        const tier = [...activeTiers].reverse().find(t => ownedCount >= (t.minPools || 0));
                        const facts = [
                            { label: 'Role', value: roleBadge(viewingUser.role).label },
                            { label: 'Referrals', value: String(getComputedReferrals(viewingUser.id)) },
                            { label: 'Loyalty Tier', value: tier?.name || '—' },
                            { label: 'Method', value: (viewingUser.registrationMethod || 'email').toUpperCase() },
                            { label: 'Pools Owned', value: String(ownedCount) },
                        ];
                        return (
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                                {facts.map(f => (
                                    <div key={f.label} className="bg-surface border border-line rounded-xl p-3">
                                        <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-display font-bold mb-1">{f.label}</p>
                                        <p className="text-sm font-display font-bold text-[color:var(--text)] truncate">{f.value}</p>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}

                    <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                        <Activity size={20} className="text-gold-500" /> Pools Managed by {viewingUser.name.split(' ')[0]}
                    </h3>

                    {pools.filter(p => {
                        const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                        return owner === viewingUser.id;
                    }).length === 0 ? (
                        <div className="p-8 text-center bg-surface rounded-xl border border-dashed border-line">
                            <p className="text-faint font-medium">No pools found for this user.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {pools.filter(p => {
                                const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                return owner === viewingUser.id;
                            }).map(pool => {
                                const isBracket = pool.type === 'BRACKET';
                                return (
                                    <div key={pool.id} className="bg-card border border-line rounded-xl p-5 hover:border-gold-500/50 hover:-translate-y-1 hover:shadow-card-hover transition duration-150 group">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-lg group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">{pool.name}</h4>
                                                <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em] mt-1">
                                                    {formatPoolMatchup(pool as unknown as { type?: string; awayTeam?: string; homeTeam?: string })}
                                                </p>
                                            </div>
                                            {!isBracket && (pool as GameState).charity?.enabled && <Heart size={16} className="text-brandred-500 fill-brandred-500" />}
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-sm text-muted mb-4 bg-surface border border-line p-3 rounded-lg">
                                            {/* Counted through getPoolEntrySummary so this card can't repeat the
                                                pool-list bug where NFL season pools read an `entryCount` no server
                                                path maintains and always showed 0. */}
                                            {(() => {
                                                const summary = getPoolEntrySummary(pool as unknown as EntryCountable);
                                                const label = summary.unit.charAt(0).toUpperCase() + summary.unit.slice(1);
                                                return (
                                                    <div>{label}: <span className="text-[color:var(--text)] font-mono num">{summary.capacity ? `${summary.count}/${summary.capacity}` : summary.count}</span></div>
                                                );
                                            })()}
                                            {isBracket ? (
                                                <div>Status: <span className={(pool as unknown as PoolLike).status === 'LOCKED' ? "text-brandred-500 font-bold" : "text-gold-600 dark:text-gold-400 font-bold"}>{(pool as unknown as PoolLike).status as string || 'OPEN'}</span></div>
                                            ) : (
                                                <div>Status: <span className={(pool as GameState).isLocked ? "text-brandred-500 font-bold" : "text-gold-600 dark:text-gold-400 font-bold"}>{(pool as GameState).isLocked ? 'LOCKED' : 'OPEN'}</span></div>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    window.location.href = `/admin/${pool.id}`;
                                                    setViewingUser(null);
                                                }}
                                                className="flex-1 bg-brandred-600 hover:bg-brandred-500 text-white py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors text-center"
                                            >
                                                Manage Pool
                                            </button>
                                            <a
                                                href={`#pool/${pool.id}`}
                                                target="_blank"
                                                className="flex-1 bg-navy-800 hover:bg-navy-700 text-white py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors text-center"
                                            >
                                                {isBracket ? 'View Bracket' : 'View Grid'}
                                            </a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </OverlayRoot>
);
