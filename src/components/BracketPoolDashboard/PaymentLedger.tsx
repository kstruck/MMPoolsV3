import React, { useState } from 'react';
import type { BracketPool, BracketEntry } from '../../types';
import { dbService } from '../../services/dbService';
import { Search, Check, X, AlertCircle, DollarSign, Download, CreditCard, Mail } from 'lucide-react';

interface PaymentLedgerProps {
    pool: BracketPool;
    entries: BracketEntry[];
}

export const PaymentLedger: React.FC<PaymentLedgerProps> = ({ pool, entries }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const costPerEntry = pool.settings?.entryFee ?? 0;

    const filteredEntries = entries.filter(entry => {
        const matchesSearch = entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (entry.ownerUid && entry.ownerUid.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesFilter = filterStatus === 'ALL' || entry.paidStatus === filterStatus;

        return matchesSearch && matchesFilter;
    });

    const totalPaid = entries.filter(e => e.paidStatus === 'PAID').length * costPerEntry;
    const totalExpected = entries.length * costPerEntry;

    const handleTogglePayment = async (entryId: string, currentStatus: 'PAID' | 'UNPAID') => {
        setUpdatingId(entryId);
        try {
            const newStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
            await dbService.updateBracketEntryPayment(pool.id, entryId, newStatus);
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

    const handleExportCSV = () => {
        const headers = ['Entry Name', 'Status', 'Paid Status', 'Amount Due', 'Date Created'];
        const csvContent = [
            headers.join(','),
            ...filteredEntries.map(e => [
                `"${e.name.replace(/"/g, '""')}"`,
                e.status,
                e.paidStatus,
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
            {message && (
                <div className={`px-4 py-3 rounded-xl mb-4 text-sm flex items-center justify-between border animate-in fade-in slide-in-from-bottom-4 ${message.type === 'success' ? 'bg-emerald-900/40 border-emerald-800 text-emerald-300' : 'bg-red-900/40 border-red-800 text-red-300'}`}>
                    <span>{message.text}</span>
                    <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 transition-opacity"><X size={16} /></button>
                </div>
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <DollarSign className="text-emerald-400" />
                        Payment Ledger
                    </h2>
                    <p className="text-slate-400 text-sm">Manage entry fees and track payments for your pool.</p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm font-medium border border-slate-700"
                    >
                        <Download size={16} />
                        Export CSV
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-400">Total Collected</p>
                        <p className="text-2xl font-bold text-white">${totalPaid}</p>
                    </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-400">Outstanding</p>
                        <p className="text-2xl font-bold text-white">${totalExpected - totalPaid}</p>
                    </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                        <CreditCard size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-400">Total Entries</p>
                        <p className="text-2xl font-bold text-white">{entries.length}</p>
                    </div>
                </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                        <input
                            type="text"
                            placeholder="Search entries..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                    </div>
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {(['ALL', 'PAID', 'UNPAID'] as const).map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${filterStatus === status
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-950/50 border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wider">
                                <th className="p-4 font-medium">Entry Name</th>
                                <th className="p-4 font-medium text-center">Status</th>
                                <th className="p-4 font-medium text-right">Fee</th>
                                <th className="p-4 font-medium text-center">Payment</th>
                                <th className="p-4 font-medium text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {filteredEntries.map((entry) => (
                                <tr key={entry.id} className="hover:bg-slate-800/50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-bold text-white">{entry.name}</div>
                                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                            <Mail size={12} /> User ID: {entry.ownerUid.slice(0, 8)}...
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${entry.status === 'SUBMITTED' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'
                                            }`}>
                                            {entry.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <span className="text-white font-mono">${costPerEntry}</span>
                                    </td>
                                    <td className="p-4 text-center">
                                        {entry.paidStatus === 'PAID' ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                                                <Check size={12} /> Paid
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold">
                                                <X size={12} /> Unpaid
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button
                                            onClick={() => handleTogglePayment(entry.id, entry.paidStatus)}
                                            disabled={updatingId === entry.id}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${entry.paidStatus === 'PAID'
                                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                                }`}
                                        >
                                            {updatingId === entry.id ? 'Updating...' : (entry.paidStatus === 'PAID' ? 'Mark Unpaid' : 'Mark Paid')}
                                        </button>
                                    </td>
                                </tr>
                            ))}

                            {filteredEntries.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-500">
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
