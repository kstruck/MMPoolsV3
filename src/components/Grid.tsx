import { OverlayRoot } from './ui/OverlayRoot';
import { logger } from '../utils/logger';
import { BillingGate } from './billing';
import React, { useState, useEffect } from 'react';
import type { GameState, Winner, PlayerDetails, User, PropCard } from '../types';
import { Lock, UserPlus, User as UserIcon, Trophy, Ban, Check, X, ArrowDown, ArrowRight, Info, Edit2, ChevronUp, AlertCircle, Shield, Loader, LogIn, Save, Smartphone, Link as LinkIcon, Zap, Printer, ZoomIn, ZoomOut, DollarSign } from 'lucide-react';
import { getTeamLogo } from '../constants';
import { PropCardForm } from './Props/PropCardForm';
import { PropLeaderboard } from './Props/PropLeaderboard';
import { dbService } from '../services/dbService';
import { StatusCard } from './StatusCard';
import { PayoutSummaryCard } from './PayoutSummaryCard';

interface GridProps {
   gameState: GameState;
   onClaimSquares: (ids: number[], name: string, details: PlayerDetails, guestKey?: string) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string };
   winners: Winner[];
   highlightHomeDigit?: number;
   highlightAwayDigit?: number;
   currentUser?: User | null;
   onLogin?: () => void;
   onCreateClaimCode?: (guestKey: string) => Promise<{ claimCode: string; claimId: string }>;
   onClaimByCode?: (code: string) => Promise<{ success: boolean; poolId: string }>;
   onJoinWaitlist?: (name: string, email: string) => Promise<{ success: boolean; message?: string }>;
   onConfirmPayment?: (squareIds: number[]) => Promise<{ success: boolean; squaresConfirmed: number }>;
}

export const Grid: React.FC<GridProps> = ({ gameState, onClaimSquares, winners, highlightHomeDigit, highlightAwayDigit, currentUser, onLogin, onCreateClaimCode, onClaimByCode, onJoinWaitlist, onConfirmPayment }) => {
   const [selectedSquares, setSelectedSquares] = useState<number[]>([]);
   const [guestKey, setGuestKey] = useState<string>('');

   // --- 4-SETS LOGIC (Hoisted) ---
   const [activeSet, setActiveSet] = useState<'q1' | 'q2' | 'q3' | 'final'>('q1');

   // Auto-switch active set based on game progress
   useEffect(() => {
      // Determine if we are in Multi-Set mode (4 Sets of numbers)
      const isMultiSetLocal = gameState.numberSets === 4;
      if (!isMultiSetLocal) return;

      // Guard: scores object may not exist for non-SQUARES pools (e.g., PROPS)
      if (!gameState.scores) return;

      const period = gameState.scores.period || 1;
      const status = gameState.scores.gameStatus;

      if (status === 'post' || gameState.scores.final) {
         setActiveSet('final');
         return;
      }

      if (period >= 4) setActiveSet('final');
      else if (period === 3) setActiveSet('q3');
      else if (period === 2) setActiveSet('q2');
      else setActiveSet('q1');
   }, [gameState.scores?.period, gameState.scores?.gameStatus, gameState.numberSets]);

   // --- Guest Key Init ---
   useEffect(() => {
      let key = localStorage.getItem('mmp_guest_key');
      if (!key) {
         key = crypto.randomUUID();
         localStorage.setItem('mmp_guest_key', key);
      }
      setGuestKey(key);
   }, []);

   // --- Player Identity State ---
   const [playerInfo, setPlayerInfo] = useState<{
      name: string;
      details: PlayerDetails;
   }>({
      name: '',
      details: { email: '', phone: '', address: '', notes: '', referral: '' }
   });

   const [isIdentitySet, setIsIdentitySet] = useState(false);
   const [isIdentityOpen, setIsIdentityOpen] = useState(true); // Is the form expanded?

   // Load from local storage on mount for seamless return
   useEffect(() => {
      const saved = localStorage.getItem('sbSquaresPlayer');
      if (saved) {
         try {
            const parsed = JSON.parse(saved);
            setPlayerInfo(parsed);
            if (parsed.name) {
               setIsIdentitySet(true);
               setIsIdentityOpen(false); // Auto-collapse if we know them
            }
         } catch (e) { }
      }
   }, []);

   const [isConfirming, setIsConfirming] = useState(false);
   const [errorMsg, setErrorMsg] = useState<string | null>(null);
   const [showGuestSync, setShowGuestSync] = useState(false); // Toggle for advanced guest features
   const [zoomLevel, setZoomLevel] = useState(1); // Grid zoom level for mobile
   const [showWaitlistModal, setShowWaitlistModal] = useState(false);
   const [waitlistName, setWaitlistName] = useState('');
   const [waitlistEmail, setWaitlistEmail] = useState('');
   const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
   const [waitlistMsg, setWaitlistMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

   // Pre-fill waitlist info if logged in
   useEffect(() => {
      if (currentUser) {
         setWaitlistName(currentUser.name);
         setWaitlistEmail(currentUser.email);
      }
   }, [currentUser, showWaitlistModal]);

   // Payment confirmation state
   const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
   const [paymentConfirmMsg, setPaymentConfirmMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

   const [showGuestModal, setShowGuestModal] = useState(false);

   // Auto-scroll to error when it appears
   useEffect(() => {
      if (errorMsg) {
         window.scrollTo({ top: 0, behavior: 'smooth' });
      }
   }, [errorMsg]);

   const [viewMode, setViewMode] = useState<'grid' | 'props'>('grid');
   const [allPropCards, setAllPropCards] = useState<PropCard[]>([]);

   // Subscribe to prop cards for stats when in props mode
   useEffect(() => {
      if (viewMode !== 'props' || !gameState.id) return;
      const unsub = dbService.subscribeToPropCards(gameState.id, (cards) => setAllPropCards(cards));
      return () => unsub();
   }, [viewMode, gameState.id]);

   const userPropCard = null; // We handle this inside PropCardForm now (or pass if needed)



   // Listen to view mode changes
   useEffect(() => {
      // Auto-switch to grid if props disabled
      if (!gameState.props?.enabled && viewMode === 'props') {
         setViewMode('grid');
      }
   }, [gameState.props?.enabled]);

   const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam);

   const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam);

   // Determine if we are in Multi-Set mode (4 Sets of numbers)
   const isMultiSet = gameState.numberSets === 4; // We show the layout regardless, if missing numbers we show '?'

   // --- Limit Calculation ---
   const maxPerPlayer = Number(gameState.maxSquaresPerPlayer) || 100;

   // Calculate how many squares the CURRENT user (if identified) already owns in the DB
   const squaresAlreadyOwned = React.useMemo(() => {
      if (!playerInfo.name) return 0;
      return gameState.squares.filter(s =>
         s.owner && s.owner.toLowerCase() === playerInfo.name.trim().toLowerCase()
      ).length;
   }, [gameState.squares, playerInfo.name]);

   const unpaidSquaresCount = React.useMemo(() => {
      if (!playerInfo.name) return 0;
      return gameState.squares.filter(s =>
         s.owner &&
         s.owner.toLowerCase() === playerInfo.name.trim().toLowerCase() &&
         !s.isPaid &&
         !s.paymentConfirmedAt
      ).length;
   }, [gameState.squares, playerInfo.name]);

   const pendingConfirmationCount = React.useMemo(() => {
      if (!playerInfo.name) return 0;
      return gameState.squares.filter(s =>
         s.owner &&
         s.owner.toLowerCase() === playerInfo.name.trim().toLowerCase() &&
         !s.isPaid &&
         s.paymentConfirmedAt
      ).length;
   }, [gameState.squares, playerInfo.name]);

   const currentTotal = squaresAlreadyOwned + selectedSquares.length;
   const remainingAllowance = maxPerPlayer - currentTotal;
   const isLimitReached = remainingAllowance <= 0;

   const handleSquareClick = (id: number) => {
      // If locked or owned, do nothing
      if (gameState.isLocked) return;
      if (gameState.squares[id].owner) return;

      // Toggle selection
      setSelectedSquares(prev => {
         if (prev.includes(id)) {
            return prev.filter(sid => sid !== id);
         } else {
            // Enforce Limit
            if (remainingAllowance <= 0) {
               setErrorMsg(`Limit Reached! You are allowed max ${maxPerPlayer} squares.`);
               return prev;
            }
            setErrorMsg(null);
            return [...prev, id];
         }
      });
   };

   const handleSetIdentity = () => {
      if (!playerInfo.name.trim()) {
         setErrorMsg("Name is required to start picking.");
         return;
      }
      // Basic email validation if provided
      if (playerInfo.details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerInfo.details.email || '')) {
         setErrorMsg("Please enter a valid email.");
         return;
      }

      setIsIdentitySet(true);
      setIsIdentityOpen(false);
      setErrorMsg(null);

      // Save to local storage
      localStorage.setItem('sbSquaresPlayer', JSON.stringify(playerInfo));
   };

   const handleJoinWaitlist = async () => {
      if (!waitlistName.trim() || !waitlistEmail.trim()) {
         setWaitlistMsg({ type: 'error', text: 'Name and email are required.' });
         return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
         setWaitlistMsg({ type: 'error', text: 'Please enter a valid email.' });
         return;
      }
      if (!onJoinWaitlist) return;

      setWaitlistSubmitting(true);
      setWaitlistMsg(null);
      try {
         const result = await onJoinWaitlist(waitlistName.trim(), waitlistEmail.trim());
         if (result.success) {
            setWaitlistMsg({ type: 'success', text: result.message || 'You have been added to the waitlist!' });
            setWaitlistName('');
            setWaitlistEmail('');
         } else {
            setWaitlistMsg({ type: 'error', text: result.message || 'Failed to join waitlist.' });
         }
      } catch (e) {
         setWaitlistMsg({ type: 'error', text: 'An error occurred. Please try again.' });
      } finally {
         setWaitlistSubmitting(false);
      }
   };

   // Compute whether the grid is full
   const squaresRemaining = 100 - gameState.squares.filter(s => s.owner).length;
   const isGridFull = squaresRemaining === 0;

   // Auto-fill name from Current User
   useEffect(() => {
      if (currentUser) {
         setPlayerInfo(prev => ({
            ...prev,
            name: currentUser.name || prev.name,
            details: {
               ...prev.details,
               email: currentUser.email || prev.details.email
            }
         }));
         setIsIdentitySet(true);
      }
   }, [currentUser]);

   const handleInitiateCheckout = () => {
      if (selectedSquares.length === 0) return;

      if (!isIdentitySet) {
         // Replaces scroll-to-top with Modal
         setShowGuestModal(true);
         return;
      }

      // Final check on limit before modal
      if (remainingAllowance < 0) {
         setErrorMsg(`Limit exceeded. Please deselect ${Math.abs(remainingAllowance)} squares.`);
         return;
      }

      setIsConfirming(true);
   };

   const [liabilityAccepted, setLiabilityAccepted] = useState(false);
   const [isSubmitting, setIsSubmitting] = useState(false);

   const handleFinalizePurchase = async () => {
      if (!liabilityAccepted) return;

      setIsSubmitting(true);
      try {
         const result = await onClaimSquares(selectedSquares, playerInfo.name, playerInfo.details, guestKey);
         if (result.success) {
            setSelectedSquares([]);
            setIsConfirming(false);
            setLiabilityAccepted(false);
            setErrorMsg(null);
         } else {
            setErrorMsg(result.message || 'Error processing request');
            setIsConfirming(false);
            setIsIdentityOpen(true);
         }
      } catch (e) {
         setErrorMsg('An unexpected error occurred.');
         setIsConfirming(false);
      } finally {
         setIsSubmitting(false);
      }
   };

   const handleConfirmPayment = async () => {
      if (!onConfirmPayment || !playerInfo.name) return;

      // Identify squares owned by this user
      const ownedSquareIds = gameState.squares
         .filter(s => s.owner && s.owner.toLowerCase() === playerInfo.name.trim().toLowerCase() && !s.isPaid && !s.paymentConfirmedAt)
         .map(s => s.id);

      if (ownedSquareIds.length === 0) {
         setPaymentConfirmMsg({ type: 'error', text: "No unpaid squares found to confirm." });
         return;
      }

      setIsConfirmingPayment(true);
      setPaymentConfirmMsg(null);

      try {
         const result = await onConfirmPayment(ownedSquareIds);
         if (result.success) {
            setPaymentConfirmMsg({ type: 'success', text: `Payment confirmed for ${result.squaresConfirmed} squares! The host has been notified.` });
         } else {
            setPaymentConfirmMsg({ type: 'error', text: "Failed to confirm payment. Please try again." });
         }
      } catch (e) {
         logger.error(e);
         setPaymentConfirmMsg({ type: 'error', text: "An error occurred. Please contact the host directly." });
      } finally {
         setIsConfirmingPayment(false);
      }
   };

   const updateDetail = (field: keyof PlayerDetails, value: string) => {
      setPlayerInfo(prev => ({
         ...prev,
         details: { ...prev.details, [field]: value }
      }));
   };

   // Filter winners based on active set (4-Sets Mode) to avoid confusion
   const visibleWinners = React.useMemo(() => {
      if (!isMultiSet) return winners;

      return winners.filter(w => {
         // CRITICAL FIX: Always include "Event" winners (Score Change payouts)
         if (w.period === 'Event' || w.period === 'Bonus') return true;

         // Map activeSet (q1, q2, q3, final) to Winner Period (q1, half, q3, final)
         const periodMap: Record<string, string> = {
            'q1': 'q1',
            'q2': 'half',
            'q3': 'q3',
            'final': 'final'
         };

         const targetPeriod = periodMap[activeSet];
         return w.period === targetPeriod;
      });
   }, [winners, isMultiSet, activeSet]);

   const getWinningDetails = (id: number) => {
      return visibleWinners.filter(w => w.squareId === id);
   };

   // --- Claim Code Logic ---
   const [generatedCode, setGeneratedCode] = useState<string | null>(null);
   const [inputCode, setInputCode] = useState('');
   const [isClaimingCode, setIsClaimingCode] = useState(false);
   const [claimMsg, setClaimMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

   const handleGenerateCode = async () => {
      if (!onCreateClaimCode || !guestKey) return;
      try {
         const res = await onCreateClaimCode(guestKey);
         setGeneratedCode(res.claimCode);
      } catch (e) {
         logger.error(e);
         setClaimMsg({ type: 'error', text: 'Failed to generate code.' });
      }
   };

   const handleClaimCode = async () => {
      if (!onClaimByCode || !inputCode) return;
      setIsClaimingCode(true);
      try {
         await onClaimByCode(inputCode);
         setClaimMsg({ type: 'success', text: 'Squares merged successfully!' });
         setInputCode('');
         // Ideally reload or refetch?
      } catch (e) {
         logger.error(e);
         setClaimMsg({ type: 'error', text: 'Invalid code or failed to merge.' });
      } finally {
         setIsClaimingCode(false);
      }
   };

   // --- 4-SETS LOGIC removed (hoisted) ---

   // --- Guest Key Init ---

   // Helper to get numbers for current view
   const getAxisNumbers = (side: 'home' | 'away') => {
      if (!isMultiSet) {
         return gameState.axisNumbers?.[side] ?? Array(10).fill(null);
      }
      // Mulit-set
      // Map 'final' -> 'q4' in data structure if needed, usually it's q1,q2,q3,q4 in quarterlyNumbers
      // Implementation Plan Check: "quarterlyNumbers" structure usually q1, q2, q3, q4.
      // Let's assume standard mapping.
      const setKey = activeSet === 'final' ? 'q4' : activeSet;
      const nums = (gameState.quarterlyNumbers as any)?.[setKey]?.[side];

      if (nums) return nums;

      // Fallback if data missing
      return gameState.axisNumbers?.[side] ?? Array(10).fill(null);
   };

   const currentHomeAxis = getAxisNumbers('home');
   const currentAwayAxis = getAxisNumbers('away');


   return (
      <BillingGate pool={gameState as any} isCommissioner={!!currentUser && (currentUser.id === (gameState as any).managerUid || currentUser.id === (gameState as any).ownerId)}>
      <div className="flex flex-col items-center w-full mx-auto">

         {/* --- ERROR BANNER (Always Visible) --- */}
         {errorMsg && !isConfirming && (
            <div className="w-full max-w-2xl mb-4 p-4 bg-brandred-600/10 border border-brandred-600/50 rounded-xl flex items-center gap-3 text-brandred-500 font-bold shadow-card animate-in slide-in-from-top-2 z-50">
               <AlertCircle size={24} className="shrink-0" />
               <div>{errorMsg}</div>
            </div>
         )}

         {/* --- SECTION 1: IDENTITY & ACCOUNT --- */}
         {!gameState.isLocked && (
            <div className={`w-full max-w-2xl mb-6 rounded-xl border overflow-hidden transition-ui duration-300 ${currentUser ? 'bg-card border-gold-500/40' : (isIdentitySet ? 'bg-card border-line' : 'bg-card border-gold-500/50 shadow-card')}`}>

               {/* Header */}
               <div
                  className={`p-4 flex items-center justify-between cursor-pointer ${currentUser ? 'bg-gold-500/5' : (isIdentitySet ? 'bg-gold-500/5' : 'bg-card')}`}
                  onClick={() => setIsIdentityOpen(!isIdentityOpen)}
               >
                  <div className="flex items-center gap-3">
                     <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentUser ? 'bg-navy-700 text-gold-300' : (isIdentitySet ? 'bg-[#0F7B4A] text-white' : 'bg-page text-muted border border-line')}`}>
                        {currentUser ? <UserIcon size={20} /> : <UserIcon size={20} />}
                     </div>
                     <div>
                        <h3 className={`font-display font-bold text-sm uppercase tracking-[0.08em] ${currentUser ? 'text-gold-600' : (isIdentitySet ? 'text-gold-600' : 'text-muted')}`}>
                           {currentUser ? 'Signed In As' : (isIdentitySet ? 'Picking as Guest' : 'Player Details')}
                        </h3>
                        <div className="flex items-center gap-2">
                           <p className="text-lg font-display font-bold text-[color:var(--text)] leading-none">
                              {currentUser ? currentUser.name : (isIdentitySet ? playerInfo.name : 'Enter info to start')}
                           </p>
                           {squaresAlreadyOwned > 0 && (
                              <span className="text-xs bg-page px-2 py-0.5 rounded text-muted border border-line num">
                                 {squaresAlreadyOwned} owned
                              </span>
                           )}
                        </div>
                     </div>
                  </div>
                  <button className="text-muted hover:text-[color:var(--text)] transition-colors duration-150">
                     {isIdentityOpen ? <ChevronUp size={20} /> : <Edit2 size={18} />}
                  </button>
               </div>

               {/* Form Body */}
               {isIdentityOpen && (
                  <div className="p-6 border-t border-line bg-surface animate-in slide-in-from-top-2">

                     {!currentUser && (
                        <div className="mb-6 p-4 bg-page rounded-lg border border-line flex flex-col md:flex-row items-center justify-between gap-4">
                           <div className="text-sm text-[color:var(--text)]">
                              <p className="font-bold flex items-center gap-2"><Info size={14} /> Why Sign In?</p>
                              <p className="opacity-70">Creating an account allows you to access to your personal dashboard showing the pools you have entered allowing quick access to those pools. You are not required to create an account to play in a pool.</p>
                           </div>
                           {onLogin && (
                              <button onClick={onLogin} className="shrink-0 bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm flex items-center gap-2 transition-ui duration-150 shadow-red-cta fine:hover:-translate-y-px">
                                 <LogIn size={16} /> Sign In / Join
                              </button>
                           )}
                        </div>
                     )}

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="md:col-span-2">
                           <label className="block text-xs font-display font-bold text-gold-600 uppercase tracking-[0.08em] mb-1">Your Name *</label>
                           <input
                              type="text"
                              value={playerInfo.name}
                              onChange={(e) => { setPlayerInfo(prev => ({ ...prev, name: e.target.value })); setErrorMsg(null); }}
                              className={`w-full bg-page border border-line rounded-lg px-4 py-3 font-body text-[color:var(--text)] focus:ring-2 focus:ring-gold-500 outline-none text-lg placeholder:text-faint`}
                              placeholder="e.g. John Smith"
                           />
                        </div>
                        {/* ... Details fields ... */}
                        <div>
                           <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Email Address</label>
                           <input
                              type="email"
                              value={playerInfo.details.email}
                              disabled={!!currentUser}
                              onChange={(e) => updateDetail('email', e.target.value)}
                              className="w-full bg-page border border-line rounded-lg px-4 py-2 font-body text-[color:var(--text)] focus:ring-1 focus:ring-gold-500 outline-none placeholder:text-faint"
                              placeholder="john@example.com"
                           />
                        </div>
                        {gameState.collectPhone && (
                           <div>
                              <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Phone Number</label>
                              <input
                                type="tel"
                                 value={playerInfo.details.phone}
                                 onChange={(e) => updateDetail('phone', e.target.value)}
                                 className="w-full bg-page border border-line rounded-lg px-4 py-2 font-body text-[color:var(--text)] focus:ring-1 focus:ring-gold-500 outline-none placeholder:text-faint"
                                 placeholder="(555) 123-4567"
                              />
                           </div>
                        )}
                     </div>


                     <div className="flex justify-between items-center border-t border-line pt-6 mt-2">
                        {/* LEFT SIDE: Toggle for Sync */}
                        <button
                           onClick={() => setShowGuestSync(!showGuestSync)}
                           className="text-xs font-bold text-muted hover:text-gold-600 flex items-center gap-1.5 transition-colors duration-150 group"
                        >
                           <LinkIcon size={14} className="fine:group-hover:rotate-45 transition-transform" />
                           {showGuestSync ? 'Hide Device Sync' : 'Already picking on another device?'}
                        </button>

                        {/* RIGHT SIDE: Action Button */}
                        <button
                           onClick={handleSetIdentity}
                           className="bg-brandred-600 hover:bg-brandred-500 text-white px-6 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta transition-ui duration-150 fine:hover:-translate-y-px flex items-center gap-2"
                        >
                           {currentUser ? 'Update Details' : 'Start Picking'} <ArrowRight size={18} />
                        </button>
                     </div>

                     {/* CLAIM CODE SECTION (COLLAPSIBLE) */}
                     {showGuestSync && (
                        <div className="mt-4 pt-4 border-t border-line animate-in fade-in slide-in-from-top-4">
                           <div className="flex items-center gap-2 mb-3">
                              <h4 className="text-xs font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em] flex items-center gap-2">
                                 <Smartphone size={14} /> Sync Guest Session
                              </h4>
                              <p className="text-[10px] text-faint">Move your picks between devices without an account.</p>
                           </div>

                           <div className="flex flex-col md:flex-row gap-4 bg-page p-4 rounded-lg border border-line">
                              {/* Option 1: I am on the OLD device */}
                              <div className="flex-1">
                                 <p className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-2">I am on my OLD device</p>
                                 {!generatedCode ? (
                                    <button onClick={handleGenerateCode} className="w-full text-xs bg-card hover:border-gold-500/50 text-muted hover:text-[color:var(--text)] px-3 py-2 rounded border border-line flex items-center justify-center gap-2 transition-colors duration-150">
                                       <Save size={14} /> Generate Transfer Code
                                    </button>
                                 ) : (
                                    <div className="text-xs bg-gold-500/10 text-gold-600 px-3 py-2 rounded border border-gold-500/30 text-center">
                                       Code: <span className="font-mono font-bold text-lg select-all ml-1">{generatedCode}</span>
                                    </div>
                                 )}
                                 <p className="text-[10px] text-faint mt-1 leading-tight">Use this if you have squares here and want to move them to a new phone/laptop.</p>
                              </div>

                              <div className="w-px bg-[color:var(--line)] hidden md:block"></div>

                              {/* Option 2: I am on the NEW device */}
                              <div className="flex-1">
                                 <p className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-2">I am on my NEW device</p>
                                 <div className="flex gap-2">
                                    <input
                                       type="text"
                                       value={inputCode}
                                       onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                                       placeholder="ENTER CODE"
                                       className="flex-1 bg-card border border-line rounded px-2 py-1 text-xs text-[color:var(--text)] uppercase placeholder:text-faint font-mono"
                                    />
                                    <button
                                       onClick={handleClaimCode}
                                       disabled={isClaimingCode || !inputCode}
                                       className="text-xs bg-gold-500/10 hover:bg-gold-500/20 text-gold-600 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded border border-gold-500/30 font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                                    >
                                       {isClaimingCode ? '...' : 'Sync'}
                                    </button>
                                 </div>
                                 <p className="text-[10px] text-faint mt-1 leading-tight">Enter the code from your old device here to import your squares.</p>
                              </div>
                           </div>
                           {claimMsg && (
                              <div className={`text-xs mt-3 p-2 rounded flex items-center gap-2 ${claimMsg.type === 'error' ? 'bg-brandred-600/10 text-brandred-600' : 'bg-[#0F7B4A]/10 text-[#0F7B4A]'}`}>
                                 {claimMsg.type === 'error' ? <AlertCircle size={14} /> : <Check size={14} />} {claimMsg.text}
                              </div>
                           )}
                        </div>
                     )}

                  </div>
               )}
            </div>
         )}


         {/* --- PAYMENT CONFIRMATION SECTION --- */}
         {/* Show if user has unpaid squares OR has pending confirmations OR we have a success message */}
         {isIdentitySet && (unpaidSquaresCount > 0 || pendingConfirmationCount > 0 || paymentConfirmMsg) && (
            <div className="w-full max-w-2xl mb-6 p-4 bg-card border border-line rounded-xl shadow-card relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-gold-500"></div>

               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                     <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <DollarSign className="text-gold-500" size={20} /> Payment Status
                     </h3>

                     <div className="mt-2 space-y-1 text-sm">
                        {unpaidSquaresCount > 0 && (
                           <p className="text-muted">
                              You have <span className="font-bold text-[color:var(--text)] num">{unpaidSquaresCount}</span> unpaid square{unpaidSquaresCount !== 1 ? 's' : ''}.
                              Total due: <span className="num text-gold-600 font-bold">${unpaidSquaresCount * gameState.costPerSquare}</span>
                           </p>
                        )}
                        {pendingConfirmationCount > 0 && (
                           <p className="text-muted italic flex items-center gap-1.5">
                              <Check size={14} className="text-gold-500" />
                              Payment confirmation sent for {pendingConfirmationCount} square{pendingConfirmationCount !== 1 ? 's' : ''}.
                           </p>
                        )}
                        {unpaidSquaresCount === 0 && pendingConfirmationCount === 0 && !paymentConfirmMsg && (
                           <p className="text-[#0F7B4A] font-bold flex items-center gap-1">
                              <Check size={16} /> All squares marked as paid!
                           </p>
                        )}
                     </div>
                  </div>

                  {unpaidSquaresCount > 0 && (
                     <button
                        onClick={handleConfirmPayment}
                        disabled={isConfirmingPayment}
                        className="bg-brandred-600 hover:bg-brandred-500 disabled:bg-page disabled:text-faint text-white px-4 py-3 min-h-[44px] rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta flex items-center gap-2 transition-ui duration-150 fine:hover:-translate-y-px whitespace-nowrap"
                     >
                        {isConfirmingPayment ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
                        {isConfirmingPayment ? 'Sending...' : "I've Sent Payment"}
                     </button>
                  )}
               </div>

               {/* Feedback Message */}
               {paymentConfirmMsg && (
                  <div className={`mt-3 p-3 rounded-lg flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1 ${paymentConfirmMsg.type === 'success' ? 'bg-[#0F7B4A]/10 text-[#0F7B4A] border border-[#0F7B4A]/30' : 'bg-brandred-600/10 text-brandred-600 border border-brandred-600/30'}`}>
                     {paymentConfirmMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                     {paymentConfirmMsg.text}
                  </div>
               )}

               {/* Payment Instructions (Collapsible/Tooltip-ish) */}
               {gameState.paymentInstructions && unpaidSquaresCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-line">
                     <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em] mb-1">Payment Instructions:</p>
                     <p className="text-sm text-[color:var(--text)] whitespace-pre-wrap">{gameState.paymentInstructions}</p>
                  </div>
               )}
            </div>
         )}




         {/* --- CONFIRMATION MODAL --- */}
         {isConfirming && (
            <OverlayRoot id="squares-confirm-reservation" label="Confirm reservation" onEscape={() => { if (!isSubmitting) setIsConfirming(false); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
               <div className="bg-card border border-line p-6 rounded-xl shadow-card max-w-sm w-full">
                  <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                     {isSubmitting ? <Loader className="animate-spin text-gold-500" /> : <Check className="text-gold-500" />}
                     Confirm Reservation
                  </h3>

                  <div className="bg-page rounded-lg p-4 mb-4 space-y-3 border border-line">
                     <div className="flex justify-between text-sm">
                        <span className="text-muted">Player:</span>
                        <span className="text-[color:var(--text)] font-bold">{playerInfo.name}</span>
                     </div>
                     <div className="flex justify-between text-sm">
                        <span className="text-muted">Squares:</span>
                        <span className="text-[color:var(--text)] font-bold num">{selectedSquares.length}</span>
                     </div>
                     <div className="border-t border-line pt-3 flex justify-between text-lg">
                        <span className="text-[color:var(--text)] font-display font-bold uppercase">Total Due:</span>
                        <span className="text-gold-600 num font-bold">${selectedSquares.length * gameState.costPerSquare}</span>
                     </div>
                  </div>

                  {/* LIABILITY DISCLAIMER */}
                  <div className="mb-6">
                     <label className="flex items-start gap-3 cursor-pointer group">
                        <div className="relative flex items-center">
                           <input
                              type="checkbox"
                              checked={liabilityAccepted}
                              onChange={(e) => setLiabilityAccepted(e.target.checked)}
                              className="peer h-6 w-6 cursor-pointer appearance-none rounded border border-line bg-page transition-ui checked:border-gold-500 checked:bg-gold-500 hover:border-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-1"
                           />
                           <Check size={16} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-navy-950 opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                        </div>
                        <p className="text-xs text-muted leading-relaxed group-hover:text-[color:var(--text)] transition-colors duration-150">
                           By checking this box and selecting Reserve Squares, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                        </p>
                     </label>
                  </div>

                  <div className="flex gap-3">
                     <button
                        onClick={() => setIsConfirming(false)}
                        disabled={isSubmitting}
                        className="flex-1 py-3 text-muted hover:bg-page rounded-lg font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 disabled:opacity-50"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={handleFinalizePurchase}
                        disabled={!liabilityAccepted || isSubmitting}
                        className="flex-1 py-3 bg-brandred-600 hover:bg-brandred-500 disabled:bg-page disabled:text-faint disabled:cursor-not-allowed text-white rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta flex items-center justify-center gap-2 transition-ui duration-150"
                     >
                        {isSubmitting ? 'Reserving...' : `Reserve ${selectedSquares.length} Squares`}
                     </button>
                  </div>
               </div>
            </OverlayRoot>
         )}



         {/* --- GUEST DETAILS MODAL (In-Context Checkout) --- */}
         {
            showGuestModal && (
               <OverlayRoot id="squares-guest-details" label="Guest details" onEscape={() => setShowGuestModal(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                  <div className="bg-card border border-line p-6 rounded-xl shadow-card max-w-sm w-full">
                     <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                           <UserIcon className="text-gold-500" /> Player Details
                        </h3>
                        <button onClick={() => setShowGuestModal(false)} className="text-faint hover:text-[color:var(--text)] transition-colors duration-150">
                           <X size={20} />
                        </button>
                     </div>
                     <p className="text-muted text-sm mb-6">
                        Who should we reserve these <strong>{selectedSquares.length} squares</strong> for?
                     </p>

                     <div className="space-y-4 mb-6">
                        <div>
                           <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Your Name *</label>
                           <input
                              type="text"
                              value={playerInfo.name}
                              onChange={(e) => setPlayerInfo(prev => ({ ...prev, name: e.target.value }))}
                              className="w-full bg-page border border-line rounded-lg px-4 py-3 font-body text-[color:var(--text)] focus:ring-2 focus:ring-gold-500 outline-none placeholder:text-faint"
                              placeholder="John Smith"
                              autoFocus
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Email Address</label>
                           <input
                              type="email"
                              value={playerInfo.details.email}
                              onChange={(e) => updateDetail('email', e.target.value)}
                              className="w-full bg-page border border-line rounded-lg px-4 py-3 font-body text-[color:var(--text)] focus:ring-2 focus:ring-gold-500 outline-none placeholder:text-faint"
                              placeholder="john@example.com"
                           />
                        </div>
                        {/* Show validation error inside modal if needed */}
                        {errorMsg && (
                           <div className="text-xs text-brandred-600 bg-brandred-600/10 p-2 rounded border border-brandred-600/20 flex items-center gap-2">
                              <AlertCircle size={14} /> {errorMsg}
                           </div>
                        )}
                     </div>

                     <div className="flex gap-3">
                        <button
                           onClick={() => setShowGuestModal(false)}
                           className="flex-1 py-3 text-muted hover:bg-page rounded-lg font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                        >
                           Cancel
                        </button>
                        <button
                           onClick={() => {
                              if (!playerInfo.name.trim()) {
                                 setErrorMsg("Name is required.");
                                 return;
                              }
                              handleSetIdentity(); // Validates and saves
                              setShowGuestModal(false); // Close this modal
                              setIsConfirming(true); // Open CONFIRMATION modal
                           }}
                           className="flex-1 py-3 bg-brandred-600 hover:bg-brandred-500 text-white rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta flex items-center justify-center gap-2 transition-ui duration-150"
                        >
                           Continue <ArrowRight size={16} />
                        </button>
                     </div>
                  </div>
               </OverlayRoot>
            )
         }
         {
            showWaitlistModal && (
               <OverlayRoot id="squares-waitlist" label="Join the waitlist" onEscape={() => setShowWaitlistModal(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                  <div className="bg-card border border-line p-6 rounded-xl shadow-card max-w-sm w-full">
                     <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                           <UserPlus className="text-gold-500" /> Join Waitlist
                        </h3>
                        <button onClick={() => setShowWaitlistModal(false)} className="text-faint hover:text-[color:var(--text)] transition-colors duration-150">
                           <X size={20} />
                        </button>
                     </div>
                     <p className="text-muted text-sm mb-6">
                        The grid is currently full. Add your name to the waitlist and we'll notify you when squares become available.
                     </p>

                     <div className="space-y-4 mb-6">
                        <div>
                           <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Your Name *</label>
                           <input
                              type="text"
                              value={waitlistName}
                              onChange={(e) => setWaitlistName(e.target.value)}
                              className="w-full bg-page border border-line rounded-lg px-4 py-3 font-body text-[color:var(--text)] focus:ring-2 focus:ring-gold-500 outline-none"
                              placeholder="John Smith"
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Email *</label>
                           <input
                              type="email"
                              value={waitlistEmail}
                              onChange={(e) => setWaitlistEmail(e.target.value)}
                              className="w-full bg-page border border-line rounded-lg px-4 py-3 font-body text-[color:var(--text)] focus:ring-2 focus:ring-gold-500 outline-none"
                              placeholder="john@example.com"
                           />
                        </div>
                     </div>

                     {waitlistMsg && (
                        <div className={`text-sm mb-4 p-3 rounded-lg flex items-center gap-2 ${waitlistMsg.type === 'success' ? 'bg-[#0F7B4A]/10 text-[#0F7B4A] border border-[#0F7B4A]/30' : 'bg-brandred-600/10 text-brandred-600 border border-brandred-600/30'}`}>
                           {waitlistMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                           {waitlistMsg.text}
                        </div>
                     )}

                     <div className="flex gap-3">
                        <button
                           onClick={() => setShowWaitlistModal(false)}
                           className="flex-1 py-3 text-muted hover:bg-page rounded-lg font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                        >
                           Cancel
                        </button>
                        <button
                           onClick={handleJoinWaitlist}
                           disabled={waitlistSubmitting}
                           className="flex-1 py-3 bg-brandred-600 hover:bg-brandred-500 disabled:bg-page disabled:text-faint text-white rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta flex items-center justify-center gap-2 transition-ui duration-150"
                        >
                           {waitlistSubmitting ? <Loader size={16} className="animate-spin" /> : <UserPlus size={16} />}
                           {waitlistSubmitting ? 'Joining...' : 'Join Waitlist'}
                        </button>
                     </div>
                  </div>
               </OverlayRoot>
            )
         }

         {/* --- GRID FULL BANNER --- */}
         {
            !gameState.isLocked && isGridFull && onJoinWaitlist && (
               <div className="w-full max-w-2xl mb-6 p-6 bg-gold-500/10 border border-gold-500/40 rounded-xl text-center animate-in fade-in">
                  <div className="flex items-center justify-center gap-3 mb-3">
                     <Ban className="text-gold-500" size={24} />
                     <h3 className="text-xl font-display font-bold uppercase text-gold-600">Grid is Full!</h3>
                  </div>
                  <p className="text-muted mb-4">All 100 squares have been claimed. Join the waitlist to be notified if any squares become available.</p>
                  <button
                     onClick={() => setShowWaitlistModal(true)}
                     className="bg-gold-foil text-navy-950 px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-card flex items-center gap-2 mx-auto transition-ui duration-150 fine:hover:-translate-y-px hover:shadow-card-hover"
                  >
                     <UserPlus size={18} /> Join Waitlist
                  </button>
                  {gameState.waitlist && gameState.waitlist.length > 0 && (
                     <p className="text-xs text-faint mt-3 num">{gameState.waitlist.length} {gameState.waitlist.length === 1 ? 'person is' : 'people are'} already on the waitlist.</p>
                  )}
               </div>
            )
         }

         {/* --- GAME MODE TABS --- */}
         {
            gameState.props?.enabled && (
               <div className="flex justify-center gap-4 mb-6">
                  <button
                     onClick={() => setViewMode('grid')}
                     className={`px-6 py-2 rounded-full font-display font-bold uppercase tracking-[0.05em] transition-ui duration-150 ${viewMode === 'grid'
                        ? 'bg-brandred-600 text-white shadow-red-cta'
                        : 'bg-card text-muted border border-line hover:text-[color:var(--text)] hover:bg-page'}`}
                  >
                     Grid
                  </button>
                  <button
                     onClick={() => setViewMode('props')}
                     className={`px-6 py-2 rounded-full font-display font-bold uppercase tracking-[0.05em] transition-ui duration-150 flex items-center gap-2 ${viewMode === 'props'
                        ? 'bg-gold-foil text-navy-950 shadow-card'
                        : 'bg-card text-muted border border-line hover:text-[color:var(--text)] hover:bg-page'}`}
                  >
                     <Trophy size={16} /> Side Hustle
                  </button>
               </div>
            )
         }

         {/* --- VIEW: SIDE HUSTLE --- */}
         {
            viewMode === 'props' && (
               <div className="container mx-auto max-w-6xl px-4 pb-20 animate-in fade-in space-y-8">

                  {/* 1. Info Cards (Scoreboard removed to avoid duplication with App.tsx) */}
                  <div className="grid lg:grid-cols-2 gap-8 items-stretch">
                     <StatusCard gameState={gameState} mode="props" totalEntries={allPropCards.length} />
                     <PayoutSummaryCard gameState={gameState} winners={winners || []} mode="props" totalEntries={allPropCards.length} />
                  </div>

                  <div className="grid lg:grid-cols-2 gap-8 items-start">
                     {/* LEFT COLUMN: Entry Form */}
                     <div className="order-2 lg:order-1">
                        {!currentUser ? (
                           <div className="text-center p-12 bg-card rounded-xl border border-line sticky top-4">
                              <div className="w-16 h-16 bg-page rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
                                 <Lock className="text-muted" size={32} />
                              </div>
                              <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Sign In Required</h3>
                              <p className="text-muted mb-6 max-w-md mx-auto">
                                 You really need to be signed in to participate in the Side Hustle so we can track your score.
                              </p>
                              <button
                                 onClick={onLogin}
                                 className="px-6 py-3 bg-brandred-600 hover:bg-brandred-500 text-white rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta transition-ui duration-150 fine:hover:-translate-y-px"
                              >
                                 Sign In / Register
                              </button>
                           </div>
                        ) : (
                           <PropCardForm
                              gameState={gameState}
                              currentUser={currentUser}
                              userCard={userPropCard}
                           />
                        )}
                     </div>

                     {/* RIGHT COLUMN: Leaderboard */}
                     <div className="order-1 lg:order-2">
                        <PropLeaderboard gameState={gameState} currentUser={currentUser} />
                     </div>
                  </div>
               </div>
            )
         }

         {/* --- VIEW: GRID --- */}
         {
            viewMode === 'grid' && (
               <>
                  {/* 4-SETS TOGGLE UI */}
                  {isMultiSet && (
                     <div className="w-full max-w-[80vh] mx-auto px-1 mb-4">
                        <div className="flex p-1 bg-card rounded-lg border border-line gap-1 overflow-x-auto">
                           {['q1', 'q2', 'q3', 'final'].map((setKey) => {
                              const isActive = activeSet === setKey;
                              const label = setKey === 'final' ? 'FINAL' : setKey.toUpperCase();
                              return (
                                 <button
                                    key={setKey}
                                    onClick={() => setActiveSet(setKey as any)}
                                    className={`flex-1 py-2 px-3 rounded text-xs font-display font-bold uppercase tracking-wider transition-ui duration-150 whitespace-nowrap
                              ${isActive
                                          ? 'bg-gold-foil text-navy-950 shadow-card border border-gold-300/60'
                                          : 'bg-transparent text-muted hover:bg-page hover:text-[color:var(--text)]'}`}
                                 >
                                    {label} NUMBERS
                                 </button>
                              );
                           })}
                        </div>
                        {gameState.isLocked && (
                           <p className="text-center text-[10px] text-muted mt-2 flex items-center justify-center gap-1">
                              <Info size={12} /> Viewing numbers for <strong>{activeSet.toUpperCase()}</strong>. Winners may differ each quarter.
                           </p>
                        )}
                     </div>
                  )}


                  {/* --- SECTION 2: GRID HEADER (TEAMS) --- */}
                  <div className="w-full max-w-[80vh] mx-auto bg-navy-900 p-4 rounded-t-xl border border-[rgba(230,206,150,0.16)] flex flex-wrap justify-between items-center gap-4 shadow-panel relative z-10">
                     <div className="flex items-center gap-3 bg-gradient-to-r from-navy-700/60 to-navy-900 px-4 py-2 rounded-lg border border-gold-500/25 shadow-inner">
                        {awayLogo && <img src={awayLogo} alt="" className="w-8 h-8 object-contain drop-shadow" />}
                        <div className="flex flex-col">
                           <span className="text-[10px] text-gold-400 uppercase font-display font-bold flex items-center gap-1 tracking-wider">
                              <ArrowDown size={10} /> Rows (Left)
                           </span>
                           <span className="text-lg font-display font-bold text-white leading-none">
                              {gameState.awayTeam}
                           </span>
                        </div>
                     </div>

                     <div className="hidden md:flex flex-col items-center">
                        {gameState.isLocked ? (
                           <div className="text-[#9FB0CC] font-body text-[10px] flex items-center gap-2 bg-navy-950/50 px-3 py-1 rounded-full border border-[rgba(230,206,150,0.12)]">
                              <Info size={12} />
                              <span>Last digit of score wins</span>
                           </div>
                        ) : (
                           <div className="text-gold-300 font-display font-bold text-sm num flex items-center gap-2 bg-navy-800 px-4 py-1.5 rounded-full border border-gold-500/30 shadow-inner">
                              <div className="w-2 h-2 bg-gold-400 rounded-full animate-live-pulse"></div>
                              <span>{100 - gameState.squares.filter(s => s.owner).length} Squares Left</span>
                           </div>
                        )}
                     </div>

                     <div className="flex items-center gap-3 bg-gradient-to-l from-brandred-700/40 to-navy-900 px-4 py-2 rounded-lg border border-brandred-500/30 shadow-inner text-right">
                        <div className="flex flex-col items-end">
                           <span className="text-[10px] text-brandred-500 uppercase font-display font-bold flex items-center gap-1 tracking-wider">
                              Cols (Top) <ArrowRight size={10} />
                           </span>
                           <span className="text-lg font-display font-bold text-white leading-none">
                              {gameState.homeTeam}
                           </span>
                        </div>
                        {homeLogo && <img src={homeLogo} alt="" className="w-8 h-8 object-contain drop-shadow" />}
                     </div>
                  </div>

                  {/* --- ZOOM CONTROLS (Mobile-Friendly) --- */}
                  <div className="w-full max-w-[80vh] mx-auto flex justify-between items-center px-2 mb-2 md:hidden">
                     <span className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] num">
                        Zoom: {Math.round(zoomLevel * 100)}%
                     </span>
                     <div className="flex gap-2">
                        <button
                           onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.1))}
                           disabled={zoomLevel <= 0.5}
                           className="bg-card hover:bg-page disabled:opacity-40 text-[color:var(--text)] p-2 rounded-lg transition-colors duration-150 border border-line"
                        >
                           <ZoomOut size={18} />
                        </button>
                        <button
                           onClick={() => setZoomLevel(1)}
                           className="bg-card hover:bg-page text-[color:var(--text)] px-3 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 border border-line"
                        >
                           Reset
                        </button>
                        <button
                           onClick={() => setZoomLevel(Math.min(1.5, zoomLevel + 0.1))}
                           disabled={zoomLevel >= 1.5}
                           className="bg-card hover:bg-page disabled:opacity-40 text-[color:var(--text)] p-2 rounded-lg transition-colors duration-150 border border-line"
                        >
                           <ZoomIn size={18} />
                        </button>
                     </div>
                  </div>

                  {/* --- SECTION 3: THE GRID --- */}
                  <div id="printable-grid" className="relative bg-navy-950 p-2 sm:p-4 rounded-b-xl shadow-panel overflow-x-auto overflow-y-hidden w-full max-w-[80vh] mx-auto border-x border-b border-[rgba(230,206,150,0.16)]">
                     {/* Zoom works by widening the layout width; the parent overflow-x-auto container scrolls when zoomed in */}
                     <div className="transition-[width] duration-200" style={{ width: `${zoomLevel * 100}%` }}>
                        {/* Grid Layout: BACK TO STANDARD 11x11 ALWAYS */}
                        <div className="grid grid-cols-11 gap-0.5 sm:gap-1 select-none">

                           {/* Top-Left Corner */}
                           <div className="col-span-1 row-span-1 bg-navy-900 flex flex-col items-center justify-center p-1 rounded-lg border border-navy-800 relative overflow-hidden shadow-inner">
                              <div className="absolute inset-0 bg-gradient-to-br from-gold-500/15 via-transparent to-brandred-600/20"></div>
                              {/* Diagonal Divider */}
                              <div className="absolute w-[200%] h-px bg-navy-700/60 rotate-45 transform origin-center z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
                              <div className="absolute top-2 right-2 z-20 flex flex-col items-end">
                                 <span className="text-[9px] font-display font-bold text-brandred-500 uppercase">{gameState.homeTeam.substring(0, 3)}</span>
                              </div>
                              <div className="absolute bottom-2 left-2 z-20 flex flex-col items-start">
                                 <span className="text-[9px] font-display font-bold text-gold-400 uppercase">{gameState.awayTeam.substring(0, 3)}</span>
                              </div>
                           </div>

                           {/* Top Row Headers (Home Team Numbers) */}
                           {Array.from({ length: 10 }).map((_, i) => {
                              const digit = currentHomeAxis[i];
                              const isHighlighted = highlightHomeDigit !== undefined && digit !== null && digit === highlightHomeDigit && gameState.isLocked;
                              const baseClass = "flex flex-col items-center justify-center font-display font-bold text-sm sm:text-xl md:text-2xl aspect-square rounded-md sm:rounded-lg border relative overflow-hidden group transition-ui duration-300";
                              const colorClass = isHighlighted
                                 ? "bg-gradient-to-b from-gold-400 to-gold-500 text-navy-950 border-gold-300 shadow-[0_0_15px_rgba(217,188,128,0.5)] z-20 scale-105"
                                 : "bg-navy-900 text-brandred-500 border-navy-800 hover:border-brandred-500/40 hover:bg-navy-800";

                              return (
                                 <div key={`head-top-${i}`} className={`${baseClass} ${colorClass}`}>
                                    <span className="num drop-shadow-sm">{digit !== null ? digit : '?'}</span>
                                 </div>
                              );
                           })}

                           {/* Render Rows (Away Team Numbers Left) */}
                           {Array.from({ length: 10 }).map((_, rowIndex) => (
                              <React.Fragment key={`row-${rowIndex}`}>
                                 {/* Left Column Header (Away Team) */}
                                 {(() => {
                                    const digit = currentAwayAxis[rowIndex];
                                    const isHighlighted = highlightAwayDigit !== undefined && digit !== null && digit === highlightAwayDigit && gameState.isLocked;
                                    const baseClass = "flex flex-col items-center justify-center font-display font-bold text-sm sm:text-xl md:text-2xl w-full aspect-square rounded-md sm:rounded-lg border relative overflow-hidden transition-ui duration-300";
                                    const colorClass = isHighlighted
                                       ? "bg-gradient-to-r from-gold-400 to-gold-500 text-navy-950 border-gold-300 shadow-[0_0_15px_rgba(217,188,128,0.5)] z-20 scale-105"
                                       : "bg-navy-900 text-gold-300/80 border-navy-800 hover:border-gold-500/40 hover:bg-navy-800";

                                    return (
                                       <div className={`${baseClass} ${colorClass}`}>
                                          <span className="num drop-shadow-sm">{digit !== null ? digit : '?'}</span>
                                       </div>
                                    );
                                 })()}

                                 {/* 10 Squares for this row */}
                                 {Array.from({ length: 10 }).map((_, colIndex) => {
                                    const squareIndex = rowIndex * 10 + colIndex;
                                    const square = gameState.squares[squareIndex];
                                    const squareWinners = getWinningDetails(squareIndex);
                                    const isWinner = squareWinners.length > 0;
                                    const isSelected = selectedSquares.includes(squareIndex);

                                    const isScoreChangeWinner = squareWinners.some(w => w.period === 'Event');
                                    const isStandardWinner = squareWinners.some(w => ['q1', 'half', 'q3', 'final', 'Bonus'].includes(w.period));
                                    const isHybridWinner = isScoreChangeWinner && isStandardWinner;

                                    // Highlight logic for active row/col
                                    const awayDigit = currentAwayAxis[rowIndex] ?? -1; // Row is Away
                                    const homeDigit = currentHomeAxis[colIndex] ?? -1; // Col is Home

                                    const isRowHighlighted = highlightAwayDigit !== undefined && awayDigit === highlightAwayDigit && gameState.isLocked;
                                    const isColHighlighted = highlightHomeDigit !== undefined && homeDigit === highlightHomeDigit && gameState.isLocked;
                                    const isActiveIntersection = isRowHighlighted && isColHighlighted;

                                    // --- ENHANCED STYLE LOGIC ---

                                    // State flags
                                    const isAvailable = !gameState.isLocked && !square.owner;
                                    const isLockedEmpty = gameState.isLocked && !square.owner;
                                    const isOwned = !!square.owner;

                                    // Base classes
                                    let bgClass = "bg-navy-900/40";
                                    let borderClass = "border-navy-800";
                                    let textClass = "text-[#9FB0CC]";
                                    let effectClass = "transition-ui duration-300 ease-out"; // smooth transition
                                    let zIndex = "z-0";

                                    if (isWinner) {
                                       if (isHybridWinner) {
                                          // BOTH types of win
                                          bgClass = "bg-gradient-to-br from-gold-400 via-gold-500 to-[#5B2A86] text-white backdrop-blur-md";
                                          borderClass = "border-2 border-white shadow-[0_0_30px_rgba(217,188,128,0.6)]";
                                          textClass = "text-white font-black text-shadow-sm";
                                       } else if (isStandardWinner) {
                                          // Standard Period Winner (Gold)
                                          bgClass = "bg-gold-400";
                                          borderClass = "border-2 border-gold-300 shadow-[0_0_30px_rgba(217,188,128,0.45)]";
                                          textClass = "text-navy-950 font-bold";
                                       } else {
                                          // Score Change Winner (Every-Score Purple)
                                          bgClass = "bg-[#5B2A86]";
                                          borderClass = "border-2 border-[#8655B5] shadow-[0_0_20px_rgba(91,42,134,0.5)]";
                                          textClass = "text-white font-bold text-shadow-sm";
                                       }

                                       effectClass += " transform scale-110";
                                       zIndex = "z-40";
                                    } else if (isSelected) {
                                       bgClass = "bg-gold-500 shadow-xl shadow-gold-500/40";
                                       borderClass = "border-2 border-gold-300";
                                       textClass = "text-navy-950 font-semibold";
                                       effectClass += " transform scale-110";
                                       zIndex = "z-30";
                                    } else if (isActiveIntersection) {
                                       bgClass = isOwned ? "bg-brandred-600/40" : "bg-brandred-600/20";
                                       borderClass = "border-2 border-brandred-500 animate-pulse shadow-[0_0_20px_rgba(196,52,46,0.5)]";
                                       textClass = isOwned ? "text-white font-bold" : "text-gold-200/70";
                                       zIndex = "z-30";
                                    } else if (isRowHighlighted || isColHighlighted) {
                                       // "Outline the entire row/col to current outline of winning square"
                                       borderClass = "border-2 border-gold-400/60"; // Matches winning square border style
                                       effectClass += " brightness-110";

                                       if (isOwned) {
                                          if (square.isPaid) {
                                             // Paid = Lighter Navy (Highlight Pop)
                                             bgClass = "bg-navy-600 shadow-[inset_0_0_15px_rgba(217,188,128,0.25)] brightness-110";
                                             textClass = "text-white font-bold text-shadow";
                                          } else {
                                             // Unpaid = Dark Navy
                                             bgClass = "bg-navy-800 shadow-inner";
                                             textClass = "text-gold-200 font-bold";
                                          }
                                       } else {
                                          bgClass = "bg-navy-900/60";
                                       }
                                    } else if (isOwned) {
                                       if (square.isPaid) {
                                          // PAID
                                          const isMySquare = currentUser && (
                                             square.reservedByUid === currentUser.id ||
                                             square.paidByUid === currentUser.id ||
                                             (square.owner && currentUser.name && square.owner.toLowerCase() === currentUser.name.toLowerCase())
                                          );

                                          if (isMySquare) {
                                             // Highlight Current User's Paid Squares
                                             bgClass = "bg-navy-600 shadow-[0_0_15px_rgba(217,188,128,0.4)] z-20 scale-[1.02]";
                                             borderClass = "border-2 border-gold-400";
                                             textClass = "text-white font-bold text-shadow-sm";
                                          } else {
                                             // Standard Paid
                                             bgClass = "bg-navy-700 shadow-inner";
                                             borderClass = "border-navy-600";
                                             textClass = "text-white font-bold";
                                          }
                                       } else {
                                          // UNPAID = Dark Navy + dashed gold
                                          bgClass = "bg-navy-800 shadow-inner";
                                          borderClass = "border border-dashed border-gold-500/70";
                                          textClass = "text-gold-200 font-bold";
                                       }
                                    } else if (isAvailable) {
                                       bgClass = "bg-white hover:bg-cream cursor-pointer shadow-sm hover:shadow-lg hover:shadow-gold-500/20";
                                       borderClass = "border-white/60 hover:border-gold-500/60";
                                       effectClass += " fine:hover:scale-[1.05] fine:hover:-translate-y-0.5";
                                       zIndex = "hover:z-10";
                                       textClass = "text-navy-950";
                                    } else if (isLockedEmpty) {
                                       bgClass = "bg-navy-950/40 opacity-40 cursor-not-allowed";
                                       borderClass = "border-navy-900/60";
                                    }

                                    return (
                                       <div
                                          key={`sq-${squareIndex}`}
                                          onClick={() => handleSquareClick(squareIndex)}
                                          className={`
                        relative flex flex-col items-center justify-center aspect-square rounded-md sm:rounded-lg
                        ${bgClass} ${borderClass} ${textClass} ${effectClass} ${zIndex}
                        group
                                 `}
                                       >
                                          {isActiveIntersection && (
                                             <div className="absolute inset-0 bg-white/5 animate-pulse rounded pointer-events-none"></div>
                                          )}

                                          {isSelected && (
                                             <div className="absolute -top-2 -right-2 bg-navy-900 text-gold-300 rounded-full p-0.5 shadow-sm z-50 ring-2 ring-gold-300 animate-in fade-in zoom-in-90 duration-200">
                                                <Check size={10} strokeWidth={3} />
                                             </div>
                                          )}

                                          {isWinner && (
                                             <div className={`absolute -top-3 -right-3 rounded-full p-1 border border-white/30 shadow-lg z-50 animate-bounce-3 ${isStandardWinner ? 'bg-gold-400 text-navy-950' : 'bg-[#5B2A86] text-gold-300'}`}>
                                                {isStandardWinner ? <Trophy size={14} fill="currentColor" /> : <Zap size={14} fill="currentColor" />}
                                             </div>
                                          )}

                                          {square.owner && !isWinner && (
                                             <div className="absolute top-1 left-1 text-white/40 group-hover:text-white/70 transition-colors duration-150">
                                                <UserIcon size={10} />
                                             </div>
                                          )}

                                          {isLockedEmpty && (
                                             <div className="absolute top-1 left-1 text-navy-700/60">
                                                <Lock size={10} />
                                             </div>
                                          )}

                                          {square.owner ? (
                                             <div className="text-center w-full px-0.5">
                                                {isWinner ? (
                                                   <span className={`text-[9px] font-display font-black uppercase tracking-wider mb-0 block drop-shadow-md ${isStandardWinner ? 'text-navy-900' : 'text-gold-200'}`}>
                                                      {isHybridWinner ? 'Mega Win!' : (isStandardWinner ? 'Winner!' : 'Event!')}
                                                   </span>
                                                ) : (
                                                   <div className="h-2"></div>
                                                )}
                                                <div className={`text-[10px] font-body font-medium break-words leading-tight line-clamp-2 w-full ${textClass} ${isWinner ? 'font-bold' : ''}`}>
                                                   {square.owner}
                                                </div>
                                             </div>
                                          ) : (
                                             !gameState.isLocked && !isSelected && (
                                                <div className="flex flex-col items-center gap-0.5 opacity-30 group-hover:opacity-100 transition-ui duration-300">
                                                   <UserPlus size={14} className="text-navy-600" />
                                                   <span className="text-[10px] num text-navy-700 font-bold">${gameState.costPerSquare}</span>
                                                </div>
                                             )
                                          )}

                                          {gameState.isLocked && !square.owner && (
                                             <div className="opacity-20"><Ban size={16} /></div>
                                          )}
                                       </div>
                                    );
                                 })}
                              </React.Fragment>
                           ))}
                        </div>
                     </div>
                  </div>



                  {/* --- COLOR LEGEND --- */}
                  <div className="w-full max-w-4xl mt-6 px-4 mb-24 animate-in fade-in delay-100 print:hidden">
                     <div className="bg-card rounded-xl p-4 border border-line flex flex-wrap justify-center items-center gap-6 md:gap-8">
                        <div className="flex items-center gap-3">
                           <div className="w-6 h-6 rounded bg-navy-700 border border-navy-600 shadow-sm flex items-center justify-center">
                              <Check size={14} className="text-white" />
                           </div>
                           <span className="text-sm font-bold text-[color:var(--text)]">Paid & Confirmed</span>
                        </div>

                        {currentUser && (
                           <div className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded bg-navy-600 border-2 border-gold-400 shadow-[0_0_10px_rgba(217,188,128,0.4)] flex items-center justify-center">
                                 <UserIcon size={14} className="text-gold-300" />
                              </div>
                              <span className="text-sm font-bold text-gold-600">Your Squares</span>
                           </div>
                        )}

                        <div className="flex items-center gap-3">
                           <div className="w-6 h-6 rounded bg-navy-800 border border-dashed border-gold-500/70 shadow-sm flex items-center justify-center">
                              <UserIcon size={14} className="text-gold-200" />
                           </div>
                           <span className="text-sm font-bold text-[color:var(--text)]">Reserved (Unpaid)</span>
                        </div>

                        <div className="flex items-center gap-3">
                           <div className="w-6 h-6 rounded bg-gold-400 border border-gold-300 shadow-sm flex items-center justify-center animate-bounce-3">
                              <Trophy size={14} className="text-navy-950" fill="currentColor" />
                           </div>
                           <span className="text-sm font-bold text-gold-600">Quarter Winner</span>
                        </div>

                        <div className="flex items-center gap-3">
                           <div className="w-6 h-6 rounded bg-[#5B2A86] border border-[#8655B5] shadow-sm flex items-center justify-center">
                              <Zap size={14} className="text-gold-300" fill="currentColor" />
                           </div>
                           <span className="text-sm font-bold text-[#8655B5]">Score Change</span>
                        </div>

                        {!gameState.isLocked && (
                           <div className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded bg-white border border-line shadow-sm flex items-center justify-center">
                                 <span className="text-[10px] font-bold text-navy-700">$</span>
                              </div>
                              <span className="text-sm font-bold text-[color:var(--text)]">Open For Sale</span>
                           </div>
                        )}
                     </div>
                  </div>

                  {/* --- PRINT BUTTON --- */}
                  <div className="w-full max-w-4xl px-4 mb-4 flex justify-center print:hidden">
                     <button
                        onClick={() => window.print()}
                        className="bg-card hover:bg-page text-muted hover:text-[color:var(--text)] px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors duration-150 flex items-center gap-2 border border-line"
                     >
                        <Printer size={16} />
                        Print Grid
                     </button>
                  </div>

                  {/* --- STICKY FOOTER --- */}
                  {
                     selectedSquares.length > 0 && (
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100vw-1rem)] bg-navy-900/95 backdrop-blur-md text-white px-4 sm:px-6 py-3 rounded-full shadow-panel border border-gold-500/30 flex items-center gap-3 sm:gap-6 z-40 animate-in slide-in-from-bottom-10 ring-1 ring-white/10 print:hidden">
                           <div className="flex flex-col">
                              <span className="text-[10px] text-[#9FB0CC] uppercase font-display font-bold tracking-wider">Selected</span>
                              <span className="font-display font-bold text-xl leading-none num">{selectedSquares.length} <span className="text-sm font-normal text-[#9FB0CC]">sq</span></span>
                           </div>
                           <div className="h-8 w-px bg-navy-700"></div>
                           <div className="flex flex-col">
                              <span className="text-[10px] text-[#9FB0CC] uppercase font-display font-bold tracking-wider">Total</span>
                              <span className="num text-gold-400 font-display font-bold text-xl leading-none">${selectedSquares.length * gameState.costPerSquare}</span>
                           </div>

                           {/* LIMIT INDICATOR (hidden on narrow screens to keep the pill within 375px) */}
                           <div className="h-8 w-px bg-navy-700 hidden sm:block"></div>
                           <div className="hidden sm:flex flex-col items-center min-w-[80px]">
                              <span className="text-[10px] text-[#9FB0CC] uppercase font-display font-bold flex items-center gap-1 tracking-wider">
                                 Limit <Shield size={10} />
                              </span>
                              <div className="flex items-end gap-1">
                                 <span className={`font-display font-bold text-xl leading-none num ${isLimitReached ? 'text-brandred-500' : 'text-white'}`}>
                                    {currentTotal}
                                 </span>
                                 <span className="text-sm font-normal text-[#9FB0CC] mb-0.5 num">/ {maxPerPlayer}</span>
                              </div>
                              {/* Mini Progress Bar */}
                              <div className="w-full h-1 bg-navy-700 rounded-full mt-1 overflow-hidden">
                                 <div
                                    className={`h-full rounded-full transition-ui duration-500 ${isLimitReached ? 'bg-brandred-500' : 'bg-gold-500'}`}
                                    style={{ width: `${Math.min(100, (currentTotal / maxPerPlayer) * 100)}%` }}
                                 ></div>
                              </div>
                           </div>

                           <div className="flex items-center gap-2 sm:gap-3 sm:ml-2">
                              <button
                                 onClick={() => setSelectedSquares([])}
                                 className="p-3 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-navy-800 rounded-full transition-colors duration-150 text-[#9FB0CC] hover:text-white"
                                 title="Clear Selection"
                              >
                                 <X size={20} />
                              </button>
                              <button
                                 onClick={handleInitiateCheckout}
                                 className="bg-brandred-600 hover:bg-brandred-500 text-white px-5 sm:px-6 py-2.5 min-h-[44px] rounded-full font-display font-bold uppercase tracking-[0.05em] shadow-red-cta transition-ui duration-150 fine:hover:scale-105 active:scale-95 flex items-center gap-2"
                              >
                                 Reserve <ArrowRight size={16} />
                              </button>
                           </div>
                        </div>

                     )
                  }
               </>
            )
         }
      </div >
      </BillingGate>
   );
};