import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Trophy, ShieldAlert, Coins, Users, ArrowRight, LogIn, Mail, Phone, Check } from 'lucide-react';
import { dbService } from '../services/dbService';
import { logger } from '../utils/logger';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User, Pool } from '../types';
import { PayoutsPanel } from './PayoutsPanel';
import { Button } from './ui';

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
  const toast = useToast();
  const autoJoinFiredRef = useRef(false);
  const castPool = pool as any;

  const pendingJoinKey = `pendingJoin:${poolId}`;

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

  const handleJoin = useCallback(async () => {
    if (!user) {
      // Remember the intent so signing in/up completes the join automatically
      try { sessionStorage.setItem(pendingJoinKey, '1'); } catch { /* storage unavailable */ }
      onOpenAuth();
      return;
    }
    if (!poolId) return;

    setIsJoining(true);
    try {
      // Execute transaction via our secure backend
      await dbService.joinNFLPool(poolId);
      logger.log(`Successfully joined pool ${poolId}`);
      toast.success(`You're in! Welcome to ${pool?.name ?? 'the pool'}.`);
      navigate(`/pool/${poolId}`);
    } catch (err: any) {
      logger.error('Failed to join pool:', err);
      toast.error(getUserMessage(err, 'Failed to join the pool. Please try again or contact the commissioner.'));
    } finally {
      setIsJoining(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, poolId, pool?.name, navigate, onOpenAuth]);

  const isAlreadyMember = user && pool?.participantIds?.includes(user.id);

  // Invite-link intent survives the auth modal: once the user is signed in,
  // finish the join they already asked for instead of making them click again
  useEffect(() => {
    if (!user || !pool || isAlreadyMember || autoJoinFiredRef.current) return;
    let pending = false;
    try { pending = sessionStorage.getItem(pendingJoinKey) === '1'; } catch { /* storage unavailable */ }
    if (!pending) return;
    autoJoinFiredRef.current = true;
    try { sessionStorage.removeItem(pendingJoinKey); } catch { /* storage unavailable */ }
    void handleJoin();
  }, [user, pool, isAlreadyMember, pendingJoinKey, handleJoin]);

  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] font-body flex flex-col">
      <Header
        user={user}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
        onCreatePool={onCreatePool}
      />

      <main className="flex-grow flex items-center justify-center py-16 px-4">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin text-gold-500 w-12 h-12 border-4 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted font-display font-bold uppercase tracking-[0.05em]">Retrieving pool invitation details...</p>
          </div>
        ) : castPool?.status === 'CANCELED' ? (
          <div className="max-w-md w-full bg-slate-950 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
            <ShieldAlert className="text-amber-500 w-16 h-16 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-white mb-2">Pool Canceled</h2>
            <p className="text-slate-400 text-sm mb-6">
              This pool was canceled by the commissioner and is no longer accepting members.
              {castPool.cancelReason ? ` Reason: ${castPool.cancelReason}` : ''} Contact {castPool?.managerName || 'the host'} with any questions about dues already paid.
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all"
            >
              Back to Home
            </button>
          </div>
        ) : !pool ? (
          <div className="max-w-md w-full bg-card border border-line rounded-3xl p-8 text-center shadow-panel">
            <ShieldAlert className="text-brandred-600 w-16 h-16 mx-auto mb-4" />
            <h2 className="font-display font-extrabold uppercase text-[28px] leading-none text-[color:var(--text)] mb-2">Invitation Expired</h2>
            <p className="text-muted text-sm mb-6 font-body">
              This pool invitation link is invalid, expired, or has been deleted by the host. Please contact the commissioner.
            </p>
            <Button
              variant="secondary"
              onClick={() => navigate('/')}
              className="w-full"
            >
              Back to Home
            </Button>
          </div>
        ) : (
          <div className="max-w-xl w-full bg-card border border-line rounded-3xl p-6 md:p-10 shadow-panel">
            <div className="text-center mb-8">
              <span className="bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 text-xs font-display font-bold px-3 py-1 rounded-full uppercase tracking-[0.08em] inline-block mb-3">
                Pool Invitation
              </span>
              <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.9] text-[color:var(--text)] mb-2">
                {pool.name}
              </h2>
              <p className="text-muted text-sm flex items-center justify-center gap-1.5 flex-wrap font-body">
                <span>Hosted by <span className="text-[color:var(--text)] font-bold">{pool.managerName || 'Pool Host'}</span></span>
                {castPool.contactMethod !== 'none' && (
                  <span className="flex items-center gap-1.5 ml-1 inline-flex">
                    {(castPool.contactMethod === 'email' || castPool.contactMethod === 'both' || !castPool.contactMethod) && pool.contactEmail && (
                      <a
                        href={`mailto:${pool.contactEmail}`}
                        className="p-1 bg-navy-600/10 hover:bg-navy-600/20 text-navy-700 dark:text-[#9FB0CC] border border-navy-600/20 rounded-md transition-all hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Email Host: ${pool.contactEmail}`}
                      >
                        <Mail size={12} />
                      </a>
                    )}
                    {(castPool.contactMethod === 'phone' || castPool.contactMethod === 'both') && castPool.contactPhone && (
                      <a
                        href={`tel:${castPool.contactPhone}`}
                        className="p-1 bg-gold-500/10 hover:bg-gold-500/20 text-gold-700 dark:text-gold-400 border border-gold-500/30 rounded-md transition-all hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Call/SMS Host: ${castPool.contactPhone}`}
                      >
                        <Phone size={12} />
                      </a>
                    )}
                  </span>
                )}
              </p>
            </div>

            {/* Quick Stats overview */}
            <div className="grid grid-cols-3 gap-4 mb-8 bg-surface p-4 border border-line rounded-2xl text-center">
              <div>
                <Coins className="text-gold-600 dark:text-gold-400 w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] block">Entry Fee</span>
                <span className="text-[color:var(--text)] font-display font-bold text-lg num">${castPool?.settings?.entryFee ?? 0}</span>
              </div>
              <div>
                <Users className="text-navy-700 dark:text-[#9FB0CC] w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] block">Members</span>
                <span className="text-[color:var(--text)] font-display font-bold text-lg num">{pool.participantIds?.length ?? 0}</span>
              </div>
              <div>
                <Trophy className="text-gold-600 dark:text-gold-400 w-6 h-6 mx-auto mb-1" />
                <span className="text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] block">Pool Format</span>
                <span className="text-[color:var(--text)] font-display font-bold uppercase text-sm block mt-1 truncate">
                  {pool.type === 'NFL_PICKEM' ? 'Pick\'em' :
                   pool.type === 'NFL_SURVIVOR' ? 'Survivor' :
                   pool.type === 'NFL_MARGIN' ? 'Margin' : 'Squares'}
                </span>
              </div>
            </div>

            {/* Prize summary — what winning actually pays, before you commit */}
            {((castPool?.settings?.entryFee ?? 0) > 0 ||
              (castPool?.settings?.payouts?.places?.length ?? 0) > 0 ||
              (pool.type === 'SQUARES' && (castPool?.costPerSquare ?? 0) > 0)) && (
              <div className="mb-8 bg-surface p-4 border border-line rounded-2xl">
                <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] mb-3">Prizes</h4>
                <PayoutsPanel pool={pool} compact />
              </div>
            )}

            {/* Rules preview list */}
            <div className="space-y-4 mb-8 border-b border-line pb-8">
              <h4 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] mb-2">Pool Rules Configuration</h4>

              {pool.type === 'NFL_PICKEM' && (() => {
                const s = castPool?.settings || {};
                const isConfidence = !!s.confidenceMode;
                const ptsPerPick = s.pointsPerPick ?? 1;
                const primetime = s.primetimeBonus || {};
                const lockMode = s.lockMode ?? 'PER_GAME';
                const hasPrimetime = primetime.thursday || primetime.sundayNight || primetime.monday;
                return (
                  <ul className="text-sm text-[color:var(--text)] space-y-2.5 font-body">
                    <li className="flex items-start gap-2">
                      <Check size={14} className="text-gold-600 dark:text-gold-400 mt-0.5 shrink-0" />
                      {isConfidence
                        ? 'Confidence ranking mode — rank each game 1 to N, higher rank earns more points on a correct pick'
                        : 'Straight winner predictions — pick the outright winner of each game'}
                    </li>
                    <li className="flex items-start gap-2">
                      <Check size={14} className="text-gold-600 dark:text-gold-400 mt-0.5 shrink-0" />
                      {isConfidence
                        ? 'Confidence points scale from 1 to N (number of games in week) — most confident game gets the highest rank'
                        : `Base scoring: ${ptsPerPick} point${ptsPerPick !== 1 ? 's' : ''} per correct pick`}
                    </li>
                    {hasPrimetime && (
                      <li className="flex items-start gap-2">
                        <Check size={14} className="text-gold-600 dark:text-gold-400 mt-0.5 shrink-0" />
                        <span>
                          Primetime bonus points:{' '}
                          {[
                            primetime.thursday  && `TNF +${primetime.thursday}`,
                            primetime.sundayNight && `SNF +${primetime.sundayNight}`,
                            primetime.monday    && `MNF +${primetime.monday}`,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <Check size={14} className="text-gold-600 dark:text-gold-400 mt-0.5 shrink-0" />
                      Lock Mode:{' '}
                      <strong className="text-[color:var(--text)] font-bold ml-1">
                        {isConfidence
                          ? 'Weekly (required by Confidence Mode)'
                          : lockMode === 'PER_GAME'
                            ? 'Per-Game (each game locks at kickoff)'
                            : 'Weekly (all picks lock at first kickoff)'}
                      </strong>
                    </li>
                  </ul>
                );
              })()}

              {pool.type === 'NFL_SURVIVOR' && (
                <ul className="text-sm text-[color:var(--text)] space-y-2.5 font-body">
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Mulligans: <strong className="text-[color:var(--text)] font-bold">{castPool?.settings?.maxStrikes} strikes before elimination</strong>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" />
                    {castPool?.settings?.maxRebuys > 0
                      ? `${castPool?.settings.maxRebuys} rebuys permitted up to week ${castPool?.settings.rebuyDeadlineWeek}`
                      : 'No rebuys/buy-backs allowed'}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" />
                    {castPool?.settings?.pickLosersMode
                      ? 'Pick-Loser Mode: Pick team to LOSE weekly'
                      : 'Pick-Winner Mode: Pick team to WIN weekly'}
                  </li>
                </ul>
              )}

              {pool.type === 'NFL_MARGIN' && (
                <ul className="text-sm text-[color:var(--text)] space-y-2.5 font-body">
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Pick 1 team weekly (no reuse)
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Weekly margin score differential counts for/against total
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> 5-step sorting tiebreaker cascade enforced at season-end
                  </li>
                </ul>
              )}
            </div>

            {/* Actions */}
            {isAlreadyMember ? (
              <Button
                variant="premium"
                size="lg"
                onClick={() => navigate(`/pool/${poolId}`)}
                className="w-full"
              >
                Enter Pool Dashboard <ArrowRight size={18} />
              </Button>
            ) : !user ? (
              <Button
                variant="secondary"
                size="lg"
                onClick={handleJoin}
                className="w-full"
              >
                <LogIn size={18} /> Sign In to Join Pool
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={handleJoin}
                disabled={isJoining}
                className="w-full"
              >
                {isJoining ? 'Joining Pool...' : (
                  <>
                    Accept Invitation &amp; Join <ArrowRight size={18} />
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};
