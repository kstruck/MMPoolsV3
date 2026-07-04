import React, { useEffect, useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface AdminAuditEntry {
  id: string;
  actorUid?: string;
  actorEmail?: string | null;
  action?: string;
  targetType?: string | null;
  targetId?: string | null;
  status?: string;
  error?: string | null;
  at?: { toDate?: () => Date } | number;
}

function toTime(at: AdminAuditEntry['at']): string {
  if (!at) return '';
  if (typeof at === 'number') return new Date(at).toLocaleString();
  if (typeof at.toDate === 'function') return at.toDate().toLocaleString();
  return '';
}

/**
 * Reader for the admin_audit trail (T7). Live view of who did what.
 */
export const AdminAuditViewer: React.FC = () => {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = dbService.subscribeToAdminAudit(
      (rows) => setEntries(rows as unknown as AdminAuditEntry[]),
      (e) => setError(e.message)
    );
    return unsub;
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><ShieldAlert size={22} /></div>
        <div>
          <h3 className="text-lg font-bold text-white">Admin Audit Log</h3>
          <p className="text-xs text-slate-500">Every administrative action, most recent first.</p>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No admin actions recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Target</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-800/50 text-slate-300">
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-400">{toTime(e.at)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.actorEmail || e.actorUid || '—'}</td>
                  <td className="py-2 pr-4 font-bold text-white">{e.action}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.targetType}{e.targetId ? `:${e.targetId}` : ''}</td>
                  <td className="py-2">
                    {e.status === 'error' ? (
                      <span className="inline-flex items-center gap-1 text-rose-400"><XCircle size={13} /> error</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={13} /> ok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
