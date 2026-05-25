import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Trophy, ShieldAlert, Sparkles, Coins, Users, ArrowRight, LogIn } from 'lucide-react';
import { dbService } from '../services/dbService';
import { logger } from '../utils/logger';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User, Pool } from '../types';

interface JoinPoolProps {
  user: User | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onCreatePool: () => void;
}

export const JoinPool: React.FC<JoinPoolProps> = ({ user, onOpenAuth, onLogout, onCreatePool }) => {
  const { poolId } = useParams<{ poolId: string }>();
  const navigate = useNavigate();

  const [pool, setPool] = useState<Pool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);

  // Subscribe to pool configurations
  useEffect(() => {
    if (!poolId) return;
    setIsLoading(true);

    const unsub = dbService.subscribeToPool(poolId, (updatedPool) => {
      setPool(updatedPool);
      setIsLoading(false);
    }, (err) => {
      logger.error('Failed to subscribe to join pool:', err);
      setIsLoading(false);
    });

    return () => unsub();
  }, [poolId]);

  const handleJoin = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!poolId) return;

    setIsJoining(true);
    try {
      // Execute transaction via our secure backend
      await dbService.joinNFLPool(poolId);
      logger.log(`Successfully joined pool ${poolId}`);
      navigate(`/pool/${poolId}`);
    } catch (err: any) {
      logger.error('Failed to join pool:', err);
      alert(`Failed to join pool: ${err.message || 'Unknown error'}`);
    } finally {
      setIsJoining(false);
    }
  };

  const isAlreadyMember = user && pool?.participantIds?.includes(user.id);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
      <Header
        user={user}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
        onCreatePool={onCreatePool}
      />

      <main className="flex-grow flex items-center justify-center py-16 px-4">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin text-blue-500 w-12 h-12 border-4 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-400 font-bold">Retrieving pool invitation details...</p>
          </div>
        ) : !pool ? (
          <div className="max-w-md w-full bg-slate-950 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
            <ShieldAlert className="text-red-500 w-16 h-16 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-white mb-2">Invitation Expired</h2>
            <p className="text-slate-400 text-sm mb-6">
              This pool invitation link is invalid, expired, or has been deleted by the host. Please contact the commissioner.
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all"
            >
              Back to Home
            </button>
          </div>
        ) : (
          <div className="max-w-xl w-full bg-slate-950/80 border border-slate-800 rounded-3xl p-6 md:p-10 shadow-2xl backdrop-blur-sm">
            <div className="text-center mb-8">
              <span className="bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider inline-block mb-3">
                Pool Invitation
              </span>
              <h2 className="text-3xl font-black text-white leading-tight mb-2">
                {pool.name}
              </h2>
              <p className="text-slate-400 text-sm">
                Hosted by <span className="text-slate-300 font-bold">{pool.managerName || 'Pool Host'}</span>
              </p>
            </div>

            {/* Quick Stats overview */}
            <div className="grid grid-cols-3 gap-4 mb-8 bg-slate-900/50 p-4 border border-slate-800 rounded-2xl text-center">
              <div>
                <Coins className="text-emerald-400 w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Entry Fee</span>
                <span className="text-white font-black text-lg">${pool.settings?.entryFee ?? 0}</span>
              </div>
              <div>
                <Users className="text-blue-400 w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Members</span>
                <span className="text-white font-black text-lg">{pool.participantIds?.length ?? 0}</span>
              </div>
              <div>
                <Trophy className="text-orange-400 w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Pool Format</span>
                <span className="text-white font-extrabold text-sm block mt-1 truncate">
                  {pool.type === 'NFL_PICKEM' ? 'Pick\'em' :
                   pool.type === 'NFL_SURVIVOR' ? 'Survivor' :
                   pool.type === 'NFL_MARGIN' ? 'Margin' : 'Squares'}
                </span>
              </div>
            </div>

            {/* Rules preview list */}
            <div className="space-y-4 mb-8 border-b border-slate-900 pb-8">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Pool Rules Configuration</h4>
              
              {pool.type === 'NFL_PICKEM' && (
                <ul className="text-sm text-slate-300 space-y-2.5">
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> Standard Straight winner predictions
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> 
                    {pool.settings?.confidenceMode 
                      ? 'Confidence rankings enabled (points scaled 1 to N)' 
                      : 'Standard scoring (1 point per correct pick)'}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> Kickoff Lock Mode: <strong className="text-white font-bold">{pool.settings?.lockMode}</strong>
                  </li>
                </ul>
              )}

              {pool.type === 'NFL_SURVIVOR' && (
                <ul className="text-sm text-slate-300 space-y-2.5">
                  <li className="flex items-center gap-2">
                    <span className="text-red-400">✓</span> Mulligans: <strong className="text-white font-bold">{pool.settings?.maxStrikes} strikes before elimination</strong>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-red-400">✓</span> 
                    {pool.settings?.maxRebuys > 0 
                      ? `${pool.settings.maxRebuys} rebuys permitted up to week ${pool.settings.rebuyDeadlineWeek}` 
                      : 'No rebuys/buy-backs allowed'}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-red-400">✓</span> 
                    {pool.settings?.pickLosersMode 
                      ? 'Pick-Loser Mode: Pick team to LOSE weekly' 
                      : 'Pick-Winner Mode: Pick team to WIN weekly'}
                  </li>
                </ul>
              )}

              {pool.type === 'NFL_MARGIN' && (
                <ul className="text-sm text-slate-300 space-y-2.5">
                  <li className="flex items-center gap-2">
                    <span className="text-teal-400">✓</span> Pick 1 team weekly (no reuse)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-teal-400">✓</span> Weekly margin score differential counts for/against total
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-teal-400">✓</span> 5-step sorting tiebreaker cascade enforced at season-end
                  </li>
                </ul>
              )}
            </div>

            {/* Actions */}
            {isAlreadyMember ? (
              <button
                onClick={() => navigate(`/pool/${poolId}`)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
              >
                Enter Pool Dashboard <ArrowRight size={18} />
              </button>
            ) : !user ? (
              <button
                onClick={onOpenAuth}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-extrabold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-xl border border-slate-700 transition-all hover:scale-[1.02]"
              >
                <LogIn size={18} /> Sign In to Join Pool
              </button>
            ) : (
              <button
                onClick={handleJoin}
                disabled={isJoining}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-extrabold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02]"
              >
                {isJoining ? 'Joining Pool...' : (
                  <>
                    Accept Invitation & Join <ArrowRight size={18} />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};
