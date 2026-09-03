import { OverlayRoot } from '../ui/OverlayRoot';
import React, { useState, useEffect, useMemo } from 'react';
import type { BracketPool, BracketEntry, User } from '../../types';
import { dbService } from '../../services/dbService';
import { Search, Check, X, AlertCircle, DollarSign, Download, CreditCard, Mail, Trash2, Save } from 'lucide-react';

interface PaymentLedgerProps {
    pool: BracketPool;
    entries: BracketEntry[];
}

export const PaymentLedger: React.FC<PaymentLedgerProps> = ({ pool, entries }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deletingType, setDeletingType] = useState<'ENTRY' | 'USER' | null>(null);
    const [users, setUsers] = useState<Record<string, User>>({});
    const [selectedMethods, setSelectedMethods] = useState<Record<string, 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other'>>({});
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const allUsers = await dbService.getAllUsers();
                const userMap = allUsers.reduce((acc, user) => {
                    acc[user.id] = user;
                    return acc;
                }, {} as Record<string, User>);
                setUsers(userMap);
            } catch (error) {
                console.error("Failed to fetch users:", error);
            }
        };
        fetchUsers();
    }, []);

    const costPerEntry = pool.settings?.entryFee ?? 0;

    const filteredEntries = entries.filter(entry => {
        const matchesSearch = entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (entry.ownerUid && entry.ownerUid.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesFilter = filterStatus === 'ALL' || entry.paidStatus === filterStatus;

        return matchesSearch && matchesFilter;
    });

    const groupedEntries = useMemo(() => {
        const grouped = filteredEntries.reduce((acc, entry) => {
            const uid = entry.ownerUid;
            if (!acc[uid]) {
                acc[uid] = {
                    user: users[uid],
                    entries: []
                };
            }
            acc[uid].entries.push(entry);
            return acc;
        }, {} as Record<string, { user?: User; entries: BracketEntry[] }>);
        return Object.values(grouped).sort((a, b) => {
            const nameA = a.user?.name || a.entries[0].ownerUid;
            const nameB = b.user?.name || b.entries[0].ownerUid;
            return nameA.localeCompare(nameB);
        });
    }, [filteredEntries, users]);

    const totalPaid = entries.filter(e => e.paidStatus === 'PAID').length * costPerEntry;
    const totalExpected = entries.length * costPerEntry;

    // Calculate totals per payment method
    const totalsByMethod = useMemo(() => {
        return entries.filter(e => e.paidStatus === 'PAID').reduce((acc, entry) => {
            const method = (entry.paymentMethod as string) || 'Unspecified';
            acc[method] = (acc[method] || 0) + costPerEntry;
            return acc;
        }, {} as Record<string, number>);
    }, [entries, costPerEntry]);

    const handleTogglePayment = async (entryId: string, currentStatus: 'PAID' | 'UNPAID', method?: 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other') => {
        setUpdatingId(entryId);
        try {
            const newStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
            await dbService.updateBracketEntryPayment(pool.id, entryId, newStatus, method);
            setMessage({ text: `Entry marked as ${newStatus}`, type: 'success' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ text: 'Failed to update payment status', type: 'error' });
            setTimeout(() => setMessage(null), 3000);
            console.error(error);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleMarkAllPaid = async (uid: string) => {
        setUpdatingId(uid);
        try {
            const userEntries = entries.filter(e => e.ownerUid === uid && e.paidStatus === 'UNPAID');
            if (userEntries.length === 0) {
                setMessage({ text: 'All entries are already paid.', type: 'success' });
                setTimeout(() => setMessage(null), 3000);
                setUpdatingId(null);
                return;
            }
            await Promise.all(userEntries.map(e => dbService.updateBracketEntryPayment(pool.id, e.id, 'PAID')));
            setMessage({ text: `Successfully marked ${userEntries.length} entries as PAID.`, type: 'success' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ text: 'Failed to update payment status for user entries', type: 'error' });
            setTimeout(() => setMessage(null), 3000);
            console.error(error);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleUpdateMethod = async (entryId: string, method: 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other') => {
        setUpdatingId(entryId);
        try {
            await dbService.updateBracketEntryPayment(pool.id, entryId, 'PAID', method);
            setMessage({ text: 'Payment method updated', type: 'success' });
            setSelectedMethods(prev => {
                const next = { ...prev };
                delete next[entryId];
                return next;
            });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ text: 'Failed to update payment method', type: 'error' });
            setTimeout(() => setMessage(null), 3000);
            console.error(error);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleDeleteUser = (uid: string) => {
        setDeletingId(uid);
        setDeletingType('USER');
    };

    const confirmDeleteUser = async (uid: string) => {
        setUpdatingId(uid);
        try {
            const userEntries = entries.filter(e => e.ownerUid === uid);
            await Promise.all(userEntries.map(e => dbService.deleteBracketEntry(pool.id, e.id)));
            setMessage({ text: `Successfully deleted user and ${userEntries.length} entries.`, type: 'success' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ text: 'Failed to delete user entries', type: 'error' });
            setTimeout(() => setMessage(null), 3000);
            console.error(error);
        } finally {
            setUpdatingId(null);
            setDeletingId(null);
            setDeletingType(null);
        }
    };

    const handleDeleteEntry = (entryId: string) => {
        setDeletingId(entryId);
        setDeletingType('ENTRY');
    };

    const confirmDeleteEntry = async (entryId: string) => {
        setUpdatingId(entryId);
        try {
            await dbService.deleteBracketEntry(pool.id, entryId);
            setMessage({ text: 'Entry properly deleted', type: 'success' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ text: 'Failed to delete entry', type: 'error' });
            setTimeout(() => setMessage(null), 3000);
            console.error(error);
        } finally {
            setUpdatingId(null);
            setDeletingId(null);
            setDeletingType(null);
        }
    };

    const handleExportCSV = () => {
        const headers = ['Entry Name', 'Owner Email', 'Owner Name', 'Status', 'Paid Status', 'Payment Method', 'Amount Due', 'Date Created'];
        const csvContent = [
            headers.join(','),
            ...filteredEntries.map(e => [
                `"${e.name.replace(/"/g, '""')}"`,
                users[e.ownerUid]?.email || 'N/A',
                `"${(users[e.ownerUid]?.name || 'N/A').replace(/"/g, '""')}"`,
                e.status,
                e.paidStatus,
                e.paymentMethod || 'N/A',
                `$${costPerEntry}`,
                new Date(e.createdAt).toLocaleDateString()
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${pool.name.replace(/\s+/g, '_')}_Ledger.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-6">
            {deletingId && (
                <OverlayRoot id="ledger-delete-confirm" label="Confirm deletion" onEscape={() => { if (updatingId === null) { setDeletingId(null); setDeletingType(null); } }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-line rounded-2xl max-w-md w-full p-6 shadow-card-hover animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-4 text-brandred-600 mb-4">
                            <div className="w-12 h-12 rounded-full bg-brandred-600/10 flex items-center justify-center">
                                <AlertCircle size={24} />
                            </div>
                            <h3 className="text-xl font-display font-bold uppercase">Confirm Deletion</h3>
                        </div>
                        <p className="text-muted font-body mb-6">
                            {deletingType === 'USER'
                                ? 'Are you sure you want to delete this user and ALL of their entries from the pool? This cannot be undone.'
                                : 'Are you sure you want to delete this entry? This cannot be undone.'}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setDeletingId(null); setDeletingType(null); }}
                                className="px-5 py-2.5 rounded-xl font-display font-bold uppercase tracking-[0.05em] text-muted hover:text-[color:var(--text)] hover:bg-surface transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (deletingType === 'USER') {
                                        confirmDeleteUser(deletingId);
                                    } else {
                                        confirmDeleteEntry(deletingId);
                                    }
                                }}
                                disabled={updatingId !== null}
                                className="px-5 py-2.5 rounded-xl font-display font-bold uppercase tracking-[0.05em] bg-brandred-600 hover:bg-brandred-500 text-white transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={18} />
                                {updatingId ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </OverlayRoot>
            )}
            {message && (
                <div className={`px-4 py-3 rounded-xl mb-4 text-sm flex items-center justify-between border animate-in fade-in slide-in-from-bottom-4 ${message.type === 'success' ? 'bg-[#E4F5EC] border-[#BEE7D0] text-[#0F7B4A]' : 'bg-brandred-600/10 border-brandred-600/30 text-brandred-600'}`}>
                    <span>{message.text}</span>
                    <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 transition-opacity"><X size={16} /></button>
                </div>
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <DollarSign className="text-[#0F7B4A]" />
                        Payment Ledger
                    </h2>
                    <p className="text-muted font-body text-sm">Manage entry fees and track payments for your pool.</p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 px-3 py-2 bg-navy-800 hover:bg-navy-700 text-white rounded-lg transition-colors text-sm font-display font-bold uppercase tracking-[0.05em]"
                    >
                        <Download size={16} />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Commissioner Settings Section */}
            <div className="bg-card border border-line rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition hover:border-gold-500/40 shadow-card">
                <div className="flex items-start gap-3">
                    <div className="p-3 bg-gold-500/10 rounded-xl text-gold-600 mt-0.5 animate-pulse">
                        <AlertCircle size={22} />
                    </div>
                    <div>
                        <h3 className="font-display font-bold uppercase text-[color:var(--text)] text-base">Lock Unpaid Entries</h3>
                        <p className="text-muted font-body text-sm max-w-xl">
                            When enabled, members will be blocked from submitting or updating their picks until their entry is marked as <span className="text-[#0F7B4A] font-semibold">Paid</span>.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                    <span className="text-sm font-display font-bold uppercase tracking-[0.08em] text-muted">
                        {pool.settings?.lockUnpaid ? 'Active' : 'Disabled'}
                    </span>
                    <button
                        onClick={async () => {
                            try {
                                const currentLock = !!pool.settings?.lockUnpaid;
                                await dbService.updateBracketPool(pool.id, {
                                    'settings.lockUnpaid': !currentLock
                                });
                                setMessage({ text: `Payment lock is now ${!currentLock ? 'enabled' : 'disabled'}.`, type: 'success' });
                                setTimeout(() => setMessage(null), 3000);
                            } catch (err) {
                                setMessage({ text: 'Failed to update payment lock status.', type: 'error' });
                                setTimeout(() => setMessage(null), 3000);
                            }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                            pool.settings?.lockUnpaid ? 'bg-gold-500' : 'bg-line'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                                pool.settings?.lockUnpaid ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card border border-line rounded-xl p-4 flex items-center gap-4 shadow-card">
                    <div className="w-12 h-12 rounded-full bg-[#E4F5EC] flex items-center justify-center text-[#0F7B4A]">
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <p className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-muted">Total Collected</p>
                        <p className="text-2xl font-display font-bold num text-[color:var(--text)]">${totalPaid}</p>
                    </div>
                </div>
                <div className="bg-card border border-line rounded-xl p-4 flex items-center gap-4 shadow-card">
                    <div className="w-12 h-12 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-600">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <p className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-muted">Outstanding</p>
                        <p className="text-2xl font-display font-bold num text-[color:var(--text)]">${totalExpected - totalPaid}</p>
                    </div>
                </div>
                <div className="bg-card border border-line rounded-xl p-4 flex flex-col justify-center shadow-card">
                    <p className="text-xs font-display text-muted font-bold uppercase tracking-[0.08em] mb-2">Collected By Method</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(totalsByMethod).length > 0 ? (
                            Object.entries(totalsByMethod).map(([method, amount]) => (
                                <div key={method} className="flex justify-between items-center text-sm">
                                    <span className="text-muted">{method}</span>
                                    <span className="text-[color:var(--text)] num">${amount}</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-sm text-faint col-span-2">No payments received yet.</div>
                        )}
                    </div>
                </div>
                <div className="bg-card border border-line rounded-xl p-4 flex items-center gap-4 shadow-card">
                    <div className="w-12 h-12 rounded-full bg-navy-600/15 flex items-center justify-center text-navy-700 dark:text-gold-300">
                        <CreditCard size={24} />
                    </div>
                    <div>
                        <p className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-muted">Total Entries</p>
                        <p className="text-2xl font-display font-bold num text-[color:var(--text)]">{entries.length}</p>
                    </div>
                </div>
            </div>

            <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
                <div className="p-4 border-b border-line flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={18} />
                        <input
                            type="text"
                            placeholder="Search entries..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-surface border border-line rounded-lg font-body text-[color:var(--text)] placeholder:text-faint focus:outline-none focus:border-gold-500"
                        />
                    </div>
                    <div className="flex bg-surface p-1 rounded-lg border border-line">
                        {(['ALL', 'PAID', 'UNPAID'] as const).map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-1.5 rounded-md text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors ${filterStatus === status
                                    ? 'bg-navy-800 text-white'
                                    : 'text-faint hover:text-muted'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-body">
                        <thead>
                            <tr className="bg-surface border-b border-line font-display font-bold text-[12px] text-muted uppercase tracking-[0.08em]">
                                <th className="p-4 font-medium">Entry Name</th>
                                <th className="p-4 font-medium text-center">Status</th>
                                <th className="p-4 font-medium text-right">Fee</th>
                                <th className="p-4 font-medium text-center">Payment</th>
                                <th className="p-4 font-medium text-center">Method</th>
                                <th className="p-4 font-medium text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {groupedEntries.map((group) => (
                                <React.Fragment key={group.entries[0].ownerUid}>
                                    <tr className="bg-surface">
                                        <td colSpan={6} className="p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center text-white font-display font-bold">
                                                        {group.user?.name?.charAt(0)?.toUpperCase() || '?'}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-[color:var(--text)] text-sm">
                                                            {group.user?.name || 'Unknown User'}
                                                        </p>
                                                        <div className="flex items-center gap-3 text-xs text-muted">
                                                            <span className="flex items-center gap-1">
                                                                <Mail size={12} /> {group.user?.email || 'No email'}
                                                            </span>
                                                            {group.user?.email && (
                                                                <a href={`mailto:${group.user.email}`} className="text-gold-600 hover:text-gold-500 transition-colors">
                                                                    Contact
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 text-sm">
                                                    <div className="text-muted">
                                                        Entries: <span className="text-[color:var(--text)] font-bold num">{group.entries.length}</span>
                                                    </div>
                                                    <div className="text-muted">
                                                        Total Due: <span className="text-[color:var(--text)] font-bold num">${group.entries.length * costPerEntry}</span>
                                                    </div>
                                                    {group.entries.some(e => e.paidStatus === 'UNPAID') && (
                                                        <button
                                                            onClick={() => handleMarkAllPaid(group.entries[0].ownerUid)}
                                                            disabled={updatingId === group.entries[0].ownerUid}
                                                            className="text-xs px-2 py-1 rounded bg-[#0F7B4A] hover:bg-[#0d6b40] text-white font-display font-bold uppercase tracking-[0.05em] transition-colors disabled:opacity-50"
                                                        >
                                                            {updatingId === group.entries[0].ownerUid ? 'Updating...' : 'Mark All Paid'}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleDeleteUser(group.entries[0].ownerUid)}
                                                        disabled={updatingId === group.entries[0].ownerUid}
                                                        className="text-brandred-600 hover:text-brandred-500 hover:bg-brandred-600/10 p-1 rounded transition-colors"
                                                        title="Delete user and all their entries"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                    {group.entries.map((entry) => {
                                        const hasMethodChanged = selectedMethods[entry.id] && selectedMethods[entry.id] !== entry.paymentMethod;
                                        return (
                                            <tr key={entry.id} className="hover:bg-[color:var(--page)] transition-colors">
                                                <td className="p-4 pl-10">
                                                    <div className="font-bold text-[color:var(--text)]">{entry.name}</div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.05em] ${entry.status === 'SUBMITTED' ? 'bg-[#E5EDF6] text-[#142A4C] border border-[#CBDCEC]' : 'bg-cream text-muted border border-line'
                                                        }`}>
                                                        {entry.status}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="text-[color:var(--text)] num">${costPerEntry}</span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    {entry.paidStatus === 'PAID' ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0] text-xs font-display font-bold uppercase tracking-[0.05em]">
                                                                <Check size={12} /> Paid
                                                            </span>
                                                            {entry.paymentMethod && <span className="text-[10px] text-faint">{entry.paymentMethod}</span>}
                                                        </div>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#FBEEDD] text-[#B4530A] border border-[#F2D6B0] text-xs font-display font-bold uppercase tracking-[0.05em]">
                                                            <X size={12} /> Unpaid
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <select
                                                        value={selectedMethods[entry.id] || entry.paymentMethod || ''}
                                                        onChange={(e) => setSelectedMethods(prev => ({ ...prev, [entry.id]: e.target.value as 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other' }))}
                                                        className="bg-surface border border-line text-[color:var(--text)] text-xs rounded-lg px-2 py-1 focus:ring-gold-500 focus:border-gold-500 block w-full"
                                                        disabled={updatingId === entry.id}
                                                    >
                                                        <option value="" disabled>Select Method</option>
                                                        <option value="Cash">Cash</option>
                                                        <option value="Check">Check</option>
                                                        <option value="Venmo">Venmo</option>
                                                        <option value="Google Pay">Google Pay</option>
                                                        <option value="Cash.me">Cash.me</option>
                                                        <option value="Other">Other</option>
                                                    </select>
                                                </td>
                                                <td className="p-4 text-right flex justify-end gap-2 items-center">
                                                    {entry.paidStatus === 'PAID' && hasMethodChanged ? (
                                                        <button
                                                            onClick={() => handleUpdateMethod(entry.id, selectedMethods[entry.id])}
                                                            disabled={updatingId === entry.id}
                                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors disabled:opacity-50 bg-navy-700 hover:bg-navy-600 text-white"
                                                            title="Save edited payment method"
                                                        >
                                                            {updatingId === entry.id ? 'Saving...' : <><Save size={14} /> Save</>}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleTogglePayment(entry.id, entry.paidStatus, (selectedMethods[entry.id] || entry.paymentMethod) as 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other' | undefined)}
                                                            disabled={updatingId === entry.id}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors disabled:opacity-50 ${entry.paidStatus === 'PAID'
                                                                ? 'bg-surface hover:bg-page text-muted border border-line'
                                                                : 'bg-[#0F7B4A] hover:bg-[#0d6b40] text-white'
                                                                }`}
                                                        >
                                                            {updatingId === entry.id ? 'Updating...' : (entry.paidStatus === 'PAID' ? 'Mark Unpaid' : 'Mark Paid')}
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => handleDeleteEntry(entry.id)}
                                                        disabled={updatingId === entry.id}
                                                        className="text-brandred-600 hover:text-brandred-500 hover:bg-brandred-600/10 p-1.5 rounded transition-colors"
                                                        title="Delete entry"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </React.Fragment>
                            ))}

                            {filteredEntries.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-faint">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={24} className="opacity-20" />
                                            <p>No entries found matching your filters.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
