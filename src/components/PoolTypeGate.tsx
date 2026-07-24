import React from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Lock } from 'lucide-react';
import type { PoolType } from '../types';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

/**
 * Route-level feature-flag gate for pool-creation wizards (T5). If the pool
 * type is disabled in system/config, renders a "temporarily unavailable"
 * screen instead of the wizard. UX only — the create callable is the
 * authoritative guard. `type` may be given directly or read from the
 * `?type=` query param (the shared /nfl-wizard route).
 */
export const PoolTypeGate: React.FC<{ type?: PoolType; children: React.ReactNode }> = ({ type, children }) => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { poolTypeFlags, loading } = useFeatureFlags();

  const resolved = (type ?? (params.get('type') as PoolType | null)) ?? undefined;

  // Unknown/absent type or still loading flags: don't block (fail open).
  if (loading || !resolved || poolTypeFlags[resolved] !== false) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-8 text-center">
      <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700 mb-6 text-slate-400">
        <Lock size={40} />
      </div>
      <h1 className="text-2xl font-black text-white mb-2">This pool type is temporarily unavailable</h1>
      <p className="text-slate-400 max-w-md mb-8">
        The site administrator has paused new {resolved.replace(/_/g, ' ')} pools. Please check back soon.
      </p>
      <button
        onClick={() => navigate('/create-pool')}
        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors"
      >
        Back to pool types
      </button>
    </div>
  );
};
