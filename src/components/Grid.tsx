import React, { useState, useEffect } from 'react';
import type { GameState, Winner, PlayerDetails, User } from '../types';
import { Lock, UserPlus, User as UserIcon, Trophy, Ban, Check, X, ArrowDown, ArrowRight, Info, Edit2, ChevronUp, AlertCircle, Shield, Loader, LogIn, Save, Smartphone, Link as LinkIcon, Zap } from 'lucide-react';
import { getTeamLogo } from '../constants';

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
}

export const Grid: React.FC<GridProps> = ({ gameState, onClaimSquares, winners, highlightHomeDigit, highlightAwayDigit, currentUser, onLogin, onCreateClaimCode, onClaimByCode }) => {
   const [selectedSquares, setSelectedSquares] = useState<number[]>([]);
   const [guestKey, setGuestKey] = useState<string>('');

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

   // Auto-scroll to error when it appears
   useEffect(() => {
      if (errorMsg) {
         window.scrollTo({ top: 0, behavior: 'smooth' });
      }
   }, [errorMsg]);

   const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam);
   const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam);

   // --- Limit Calculation ---
   const maxPerPlayer = Number(gameState.maxSquaresPerPlayer) || 100;

   // Calculate how many squares the CURRENT user (if identified) already owns in the DB
   const squaresAlreadyOwned = React.useMemo(() => {
      if (!playerInfo.name) return 0;
      return gameState.squares.filter(s =>
         s.owner && s.owner.toLowerCase() === playerInfo.name.trim().toLowerCase()
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
         setErrorMsg("Please enter your details at the top to continue.");
         setIsIdentityOpen(true);
         window.scrollTo({ top: 0, behavior: 'smooth' });
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

   const updateDetail = (field: keyof PlayerDetails, value: string) => {
      setPlayerInfo(prev => ({
         ...prev,
         details: { ...prev.details, [field]: value }
      }));
   };

   const getWinningDetails = (id: number) => {
      return winners.filter(w => w.squareId === id);
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
         console.error(e);
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
         console.error(e);
         setClaimMsg({ type: 'error', text: 'Invalid code or failed to merge.' });
      } finally {
         setIsClaimingCode(false);
      }
   };

   return (
      <div className="flex flex-col items-center w-full mx-auto">

         {/* --- ERROR BANNER (Always Visible) --- */}
         {errorMsg && !isConfirming && (
            <div className="w-full max-w-2xl mb-4 p-4 bg-rose-500/10 border border-rose-500/50 rounded-xl flex items-center gap-3 text-rose-300 font-bold shadow-lg shadow-rose-900/20 animate-in slide-in-from-top-2 z-50">
               <AlertCircle size={24} className="shrink-0" />
               <div>{errorMsg}</div>
            </div>
         )}

         {/* --- SECTION 1: IDENTITY & ACCOUNT --- */}
         {!gameState.isLocked && (
            <div className={`w-full max-w-2xl mb-6 rounded-xl border overflow-hidden transition-all duration-300 ${currentUser ? 'bg-indigo-900/20 border-indigo-500/30' : (isIdentitySet ? 'bg-slate-900/50 border-emerald-500/30' : 'bg-slate-800 border-indigo-500/50 shadow-lg shadow-indigo-500/10')}`}>

               {/* Header */}
               <div
                  className={`p-4 flex items-center justify-between cursor-pointer ${currentUser ? 'bg-indigo-900/10' : (isIdentitySet ? 'bg-emerald-900/10' : 'bg-slate-800')}`}
                  onClick={() => setIsIdentityOpen(!isIdentityOpen)}
               >
                  <div className="flex items-center gap-3">
                     <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentUser ? 'bg-indigo-500 text-white' : (isIdentitySet ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400')}`}>
                        {currentUser ? <UserIcon size={20} /> : <UserIcon size={20} />}
                     </div>
                     <div>
                        <h3 className={`font-bold text-sm uppercase tracking-wide ${currentUser ? 'text-indigo-400' : (isIdentitySet ? 'text-emerald-400' : 'text-slate-300')}`}>
                           {currentUser ? 'Signed In As' : (isIdentitySet ? 'Picking as Guest' : 'Player Details')}
                        </h3>
                        <div className="flex items-center gap-2">
                           <p className="text-lg font-bold text-white leading-none">
                              {currentUser ? currentUser.name : (isIdentitySet ? playerInfo.name : 'Enter info to start')}
                           </p>
                           {squaresAlreadyOwned > 0 && (
                              <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">
                                 {squaresAlreadyOwned} owned
                              </span>
                           )}
                        </div>
                     </div>
                  </div>
                  <button className="text-slate-400 hover:text-white transition-colors">
                     {isIdentityOpen ? <ChevronUp size={20} /> : <Edit2 size={18} />}
                  </button>
               </div>

               {/* Form Body */}
               {isIdentityOpen && (
                  <div className="p-6 border-t border-slate-700 bg-slate-900/50 animate-in slide-in-from-top-2">

                     {!currentUser && (
                        <div className="mb-6 p-4 bg-indigo-900/20 rounded-lg border border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-4">
                           <div className="text-sm text-indigo-200">
                              <p className="font-bold flex items-center gap-2"><Info size={14} /> Why Sign In?</p>
                              <p className="opacity-70">Creating an account allows you to access to your personal dashboard showing the pools you have entered allowing quick access to those pools. You are not required to create an account to play in a pool.</p>
                           </div>
                           {onLogin && (
                              <button onClick={onLogin} className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors">
                                 <LogIn size={16} /> Sign In / Join
                              </button>
                           )}
                        </div>
                     )}

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="md:col-span-2">
                           <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">Your Name *</label>
                           <input
                              type="text"
                              value={playerInfo.name}
                              onChange={(e) => { setPlayerInfo(prev => ({ ...prev, name: e.target.value })); setErrorMsg(null); }}
                              className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none text-lg placeholder:text-slate-600`}
                              placeholder="e.g. John Smith"
                           />
                        </div>
                        {/* ... Details fields ... */}
                        <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email Address</label>
                           <input
                              type="email"
                              value={playerInfo.details.email}
                              disabled={!!currentUser}
                              onChange={(e) => updateDetail('email', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none placeholder:text-slate-600"
                              placeholder="john@example.com"
                           />
                        </div>
                        {gameState.collectPhone && (
                           <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone Number</label>
                              <input
                                 type="tel"
                                 value={playerInfo.details.phone}
                                 onChange={(e) => updateDetail('phone', e.target.value)}
                                 className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none placeholder:text-slate-600"
                                 placeholder="(555) 123-4567"
                              />
                           </div>
                        )}
                     </div>


                     <div className="flex justify-between items-center border-t border-slate-700 pt-6 mt-2">
                        {/* LEFT SIDE: Toggle for Sync */}
                        <button
                           onClick={() => setShowGuestSync(!showGuestSync)}
                           className="text-xs font-bold text-slate-500 hover:text-indigo-400 flex items-center gap-1.5 transition-colors group"
                        >
                           <LinkIcon size={14} className="group-hover:rotate-45 transition-transform" />
                           {showGuestSync ? 'Hide Device Sync' : 'Already picking on another device?'}
                        </button>

                        {/* RIGHT SIDE: Action Button */}
                        <button
                           onClick={handleSetIdentity}
                           className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
                        >
                           {currentUser ? 'Update Details' : 'Start Picking'} <ArrowRight size={18} />
                        </button>
                     </div>

                     {/* CLAIM CODE SECTION (COLLAPSIBLE) */}
                     {showGuestSync && (
                        <div className="mt-4 pt-4 border-t border-slate-800 animate-in fade-in slide-in-from-top-4">
                           <div className="flex items-center gap-2 mb-3">
                              <h4 className="text-xs font-bold text-slate-300 uppercase flex items-center gap-2">
                                 <Smartphone size={14} /> Sync Guest Session
                              </h4>
                              <p className="text-[10px] text-slate-500">Move your picks between devices without an account.</p>
                           </div>

                           <div className="flex flex-col md:flex-row gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                              {/* Option 1: I am on the OLD device */}
                              <div className="flex-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">I am on my OLD device</p>
                                 {!generatedCode ? (
                                    <button onClick={handleGenerateCode} className="w-full text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded border border-slate-700 flex items-center justify-center gap-2 transition-colors">
                                       <Save size={14} /> Generate Transfer Code
                                    </button>
                                 ) : (
                                    <div className="text-xs bg-emerald-900/20 text-emerald-400 px-3 py-2 rounded border border-emerald-500/30 text-center">
                                       Code: <span className="font-mono font-bold text-lg select-all ml-1">{generatedCode}</span>
                                    </div>
                                 )}
                                 <p className="text-[10px] text-slate-600 mt-1 leading-tight">Use this if you have squares here and want to move them to a new phone/laptop.</p>
                              </div>

                              <div className="w-px bg-slate-800 hidden md:block"></div>

                              {/* Option 2: I am on the NEW device */}
                              <div className="flex-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">I am on my NEW device</p>
                                 <div className="flex gap-2">
                                    <input
                                       type="text"
                                       value={inputCode}
                                       onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                                       placeholder="ENTER CODE"
                                       className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white uppercase placeholder:text-slate-600 font-mono"
                                    />
                                    <button
                                       onClick={handleClaimCode}
                                       disabled={isClaimingCode || !inputCode}
                                       className="text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded border border-indigo-500/30 font-bold transition-colors"
                                    >
                                       {isClaimingCode ? '...' : 'Sync'}
                                    </button>
                                 </div>
                                 <p className="text-[10px] text-slate-600 mt-1 leading-tight">Enter the code from your old device here to import your squares.</p>
                              </div>
                           </div>
                           {claimMsg && (
                              <div className={`text-xs mt-3 p-2 rounded flex items-center gap-2 ${claimMsg.type === 'error' ? 'bg-rose-900/20 text-rose-400' : 'bg-emerald-900/20 text-emerald-400'}`}>
                                 {claimMsg.type === 'error' ? <AlertCircle size={14} /> : <Check size={14} />} {claimMsg.text}
                              </div>
                           )}
                        </div>
                     )}

                  </div>
               )}
            </div>
         )}

         {/* --- CONFIRMATION MODAL --- */}
         {isConfirming && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
               <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                     {isSubmitting ? <Loader className="animate-spin text-emerald-400" /> : <Check className="text-emerald-400" />}
                     Confirm Reservation
                  </h3>

                  <div className="bg-slate-900 rounded-lg p-4 mb-4 space-y-3">
                     <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Player:</span>
                        <span className="text-white font-bold">{playerInfo.name}</span>
                     </div>
                     <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Squares:</span>
                        <span className="text-white font-bold">{selectedSquares.length}</span>
                     </div>
                     <div className="border-t border-slate-700 pt-3 flex justify-between text-lg">
                        <span className="text-slate-300 font-bold">Total Due:</span>
                        <span className="text-emerald-400 font-mono font-bold">${selectedSquares.length * gameState.costPerSquare}</span>
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
                              className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-slate-500 bg-slate-900 transition-all checked:border-emerald-500 checked:bg-emerald-500 hover:border-emerald-400"
                           />
                           <Check size={14} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                           By checking this box and selecting Reserve Squares, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                        </p>
                     </label>
                  </div>

                  <div className="flex gap-3">
                     <button
                        onClick={() => setIsConfirming(false)}
                        disabled={isSubmitting}
                        className="flex-1 py-3 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition-colors disabled:opacity-50"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={handleFinalizePurchase}
                        disabled={!liabilityAccepted || isSubmitting}
                        className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all"
                     >
                        {isSubmitting ? 'Reserving...' : `Reserve ${selectedSquares.length} Squares`}
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* --- SECTION 2: GRID HEADER (TEAMS) --- */}
         <div className="w-full bg-slate-900 p-4 rounded-t-xl border border-slate-800 flex flex-wrap justify-between items-center gap-4 shadow-lg relative z-10">
            <div className="flex items-center gap-3 bg-gradient-to-r from-indigo-900/40 to-slate-900 px-4 py-2 rounded-lg border border-indigo-500/30 shadow-inner">
               {awayLogo && <img src={awayLogo} className="w-8 h-8 object-contain drop-shadow" />}
               <div className="flex flex-col">
                  <span className="text-[10px] text-indigo-400 uppercase font-bold flex items-center gap-1 tracking-wider">
                     <ArrowDown size={10} /> Rows (Left)
                  </span>
                  <span className="text-lg font-bold text-white leading-none">
                     {gameState.awayTeam}
                  </span>
               </div>
            </div>

            <div className="hidden md:flex flex-col items-center">
               {gameState.isLocked ? (
                  <div className="text-slate-500 font-mono text-[10px] flex items-center gap-2 bg-slate-950/50 px-3 py-1 rounded-full border border-slate-800/50">
                     <Info size={12} />
                     <span>Last digit of score wins</span>
                  </div>
               ) : (
                  <div className="text-emerald-400 font-bold text-sm flex items-center gap-2 bg-emerald-900/20 px-4 py-1.5 rounded-full border border-emerald-500/30 shadow-inner animate-pulse">
                     <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                     <span>{100 - gameState.squares.filter(s => s.owner).length} Squares Left</span>
                  </div>
               )}
            </div>

            <div className="flex items-center gap-3 bg-gradient-to-l from-rose-900/40 to-slate-900 px-4 py-2 rounded-lg border border-rose-500/30 shadow-inner text-right">
               <div className="flex flex-col items-end">
                  <span className="text-[10px] text-rose-400 uppercase font-bold flex items-center gap-1 tracking-wider">
                     Cols (Top) <ArrowRight size={10} />
                  </span>
                  <span className="text-lg font-bold text-white leading-none">
                     {gameState.homeTeam}
                  </span>
               </div>
               {homeLogo && <img src={homeLogo} className="w-8 h-8 object-contain drop-shadow" />}
            </div>
         </div>

         {/* --- SECTION 3: THE GRID --- */}
         <div className="relative bg-slate-950 p-2 sm:p-4 rounded-b-xl shadow-2xl overflow-hidden w-full border-x border-b border-slate-800">
            <div className="w-full">
               {/* Grid Container - 11x11 layout */}
               <div className="grid grid-cols-11 gap-0.5 sm:gap-1 select-none">

                  {/* Top-Left Corner (Logo/Team Names) */}
                  <div className="col-span-1 row-span-1 bg-slate-900 flex flex-col items-center justify-center p-1 rounded-lg border border-slate-800 relative overflow-hidden shadow-inner">
                     <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-transparent to-rose-500/20"></div>
                     {/* Diagonal Divider */}
                     <div className="absolute w-[200%] h-px bg-slate-700/50 rotate-45 transform origin-center z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>

                     <div className="absolute top-2 right-2 z-20 flex flex-col items-end">
                        {homeLogo ? (
                           <img src={homeLogo} className="w-6 h-6 object-contain drop-shadow-md" />
                        ) : (
                           <span className="text-[10px] font-bold text-rose-400 uppercase">{gameState.homeTeam.substring(0, 3)}</span>
                        )}
                     </div>

                     <div className="absolute bottom-2 left-2 z-20 flex flex-col items-start">
                        {awayLogo ? (
                           <img src={awayLogo} className="w-6 h-6 object-contain drop-shadow-md" />
                        ) : (
                           <span className="text-[10px] font-bold text-indigo-400 uppercase">{gameState.awayTeam.substring(0, 3)}</span>
                        )}
                     </div>
                  </div>

                  {/* Top Row Headers (Home Team Numbers) */}
                  {Array.from({ length: 10 }).map((_, i) => {
                     const digit = gameState.axisNumbers ? gameState.axisNumbers.home[i] : null; // Top is Home
                     const isHighlighted = highlightHomeDigit !== undefined && digit !== null && digit === highlightHomeDigit && gameState.isLocked;
                     const baseClass = "flex flex-col items-center justify-center font-bold text-sm sm:text-xl md:text-2xl aspect-square rounded-md sm:rounded-lg border relative overflow-hidden group transition-all duration-300";
                     const colorClass = isHighlighted
                        ? "bg-gradient-to-b from-rose-600 to-rose-800 text-white border-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.5)] z-20 scale-105"
                        : "bg-slate-900 text-rose-200/70 border-slate-800 hover:border-rose-500/30 hover:bg-slate-800";

                     return (
                        <div key={`head-top-${i}`} className={`${baseClass} ${colorClass}`}>
                           <span className={`text-[9px] absolute top-1 uppercase tracking-widest w-full text-center px-1 truncate font-bold flex justify-center items-center gap-1 ${isHighlighted ? 'text-rose-100' : 'text-slate-600'}`}>
                              {gameState.homeTeam.substring(0, 3)}
                           </span>
                           <span className="mt-2 font-mono drop-shadow-sm">{digit !== null ? digit : '?'}</span>
                        </div>
                     );
                  })}

                  {/* Render Rows (Away Team Numbers is now Left) */}
                  {Array.from({ length: 10 }).map((_, rowIndex) => (
                     <React.Fragment key={`row-${rowIndex}`}>
                        {/* Left Column Header (Away Team Number) */}
                        {(() => {
                           const digit = gameState.axisNumbers ? gameState.axisNumbers.away[rowIndex] : null; // Left is Away
                           const isHighlighted = highlightAwayDigit !== undefined && digit !== null && digit === highlightAwayDigit && gameState.isLocked;
                           const baseClass = "flex flex-col items-center justify-center font-bold text-sm sm:text-xl md:text-2xl w-full aspect-square rounded-md sm:rounded-lg border relative overflow-hidden transition-all duration-300";
                           const colorClass = isHighlighted
                              ? "bg-gradient-to-r from-indigo-600 to-indigo-800 text-white border-indigo-400 shadow-[0_0_15px_rgba(79,70,229,0.5)] z-20 scale-105"
                              : "bg-slate-900 text-indigo-200/70 border-slate-800 hover:border-indigo-500/30 hover:bg-slate-800";

                           return (
                              <div className={`${baseClass} ${colorClass}`}>
                                 <span className={`text-[9px] absolute top-1 uppercase tracking-widest w-full text-center px-1 truncate font-bold flex justify-center items-center gap-1 ${isHighlighted ? 'text-indigo-100' : 'text-slate-600'}`}>
                                    {gameState.awayTeam.substring(0, 3)}
                                 </span>
                                 <span className="mt-2 font-mono drop-shadow-sm">{digit !== null ? digit : '?'}</span>
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
                           const awayDigit = gameState.axisNumbers ? gameState.axisNumbers.away[rowIndex] : -1; // Row is Away
                           const homeDigit = gameState.axisNumbers ? gameState.axisNumbers.home[colIndex] : -1; // Col is Home

                           const isRowHighlighted = highlightAwayDigit !== undefined && awayDigit === highlightAwayDigit && gameState.isLocked;
                           const isColHighlighted = highlightHomeDigit !== undefined && homeDigit === highlightHomeDigit && gameState.isLocked;
                           const isActiveIntersection = isRowHighlighted && isColHighlighted;

                           // --- ENHANCED STYLE LOGIC ---

                           // State flags
                           const isAvailable = !gameState.isLocked && !square.owner;
                           const isLockedEmpty = gameState.isLocked && !square.owner;
                           const isOwned = !!square.owner;

                           // Base classes
                           let bgClass = "bg-slate-800/40";
                           let borderClass = "border-slate-800";
                           let textClass = "text-slate-500";
                           let effectClass = "transition-all duration-300 ease-out"; // smooth transition
                           let zIndex = "z-0";

                           if (isWinner) {
                              if (isHybridWinner) {
                                 // BOTH types of win
                                 bgClass = "bg-gradient-to-br from-amber-500 via-yellow-500 to-fuchsia-600 text-white backdrop-blur-md";
                                 borderClass = "border-2 border-white shadow-[0_0_30px_rgba(234,179,8,0.6)]";
                                 textClass = "text-white font-black text-shadow-sm";
                              } else if (isStandardWinner) {
                                 // Standard Period Winner (Gold)
                                 bgClass = "bg-gradient-to-br from-amber-500/40 to-yellow-600/40 backdrop-blur-md";
                                 borderClass = "border-2 border-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.4)]";
                                 textClass = "text-white font-bold text-shadow-sm";
                              } else {
                                 // Score Change Winner (Purple/Pink)
                                 bgClass = "bg-gradient-to-br from-fuchsia-600/60 to-purple-800/60 backdrop-blur-md";
                                 borderClass = "border-2 border-fuchsia-400 shadow-[0_0_20px_rgba(217,70,239,0.4)]";
                                 textClass = "text-fuchsia-100 font-bold text-shadow-sm";
                              }

                              effectClass += " transform scale-110";
                              zIndex = "z-40";
                           } else if (isSelected) {
                              bgClass = "bg-indigo-600 shadow-xl shadow-indigo-500/40";
                              borderClass = "border-2 border-indigo-300";
                              textClass = "text-white font-semibold";
                              effectClass += " transform scale-110";
                              zIndex = "z-30";
                           } else if (isActiveIntersection) {
                              bgClass = isOwned ? "bg-amber-900/40" : "bg-amber-900/20";
                              borderClass = "border-2 border-amber-500 animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.5)]";
                              textClass = isOwned ? "text-white font-bold" : "text-amber-200/70";
                              zIndex = "z-30";
                           } else if (isRowHighlighted || isColHighlighted) {
                              // "Outline the entire row/col to current outline of winning square"
                              borderClass = "border-2 border-amber-500/60"; // Matches winning square border style
                              effectClass += " brightness-110";

                              if (isOwned) {
                                 if (square.isPaid) {
                                    // Paid = Lighter Green (Highlight Pop)
                                    bgClass = "bg-emerald-400 shadow-[inset_0_0_15px_rgba(52,211,153,0.6)] brightness-110";
                                    textClass = "text-white font-bold text-shadow";
                                 } else {
                                    // Unpaid = Orange
                                    bgClass = "bg-orange-500 shadow-inner";
                                    textClass = "text-white font-bold";
                                 }
                              } else {
                                 bgClass = "bg-slate-800/60";
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
                                    bgClass = "bg-cyan-600 shadow-[0_0_15px_rgba(8,145,178,0.5)] z-20 scale-[1.02]";
                                    borderClass = "border-2 border-cyan-400";
                                    textClass = "text-white font-bold text-shadow-sm";
                                 } else {
                                    // Standard Paid
                                    bgClass = "bg-emerald-600 shadow-inner";
                                    borderClass = "border-emerald-500";
                                    textClass = "text-white font-bold";
                                 }
                              } else {
                                 // UNPAID = Orange
                                 bgClass = "bg-orange-500 shadow-inner";
                                 borderClass = "border-orange-400";
                                 textClass = "text-white font-bold";
                              }
                           } else if (isAvailable) {
                              bgClass = "bg-white hover:bg-slate-50 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-indigo-500/10";
                              borderClass = "border-slate-200 hover:border-indigo-400/50";
                              effectClass += " hover:scale-[1.05] hover:-translate-y-0.5";
                              zIndex = "hover:z-10";
                              textClass = "text-slate-900";
                           } else if (isLockedEmpty) {
                              bgClass = "bg-slate-950/30 opacity-40 cursor-not-allowed";
                              borderClass = "border-slate-900/50";
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
                                    <div className="absolute -top-2 -right-2 bg-indigo-500 text-white rounded-full p-0.5 shadow-sm z-50 ring-2 ring-slate-900 animate-in zoom-in duration-200">
                                       <Check size={10} strokeWidth={3} />
                                    </div>
                                 )}

                                 {isWinner && (
                                    <div className={`absolute -top-3 -right-3 text-slate-900 rounded-full p-1 border border-white/30 shadow-lg z-50 animate-bounce ${isStandardWinner ? 'bg-amber-400' : 'bg-fuchsia-400'}`}>
                                       {isStandardWinner ? <Trophy size={14} fill="currentColor" /> : <Zap size={14} fill="currentColor" />}
                                    </div>
                                 )}

                                 {square.owner && !isWinner && (
                                    <div className="absolute top-1 left-1 text-slate-600 group-hover:text-slate-400 transition-colors">
                                       <UserIcon size={10} />
                                    </div>
                                 )}

                                 {isLockedEmpty && (
                                    <div className="absolute top-1 left-1 text-slate-700/50">
                                       <Lock size={10} />
                                    </div>
                                 )}

                                 {square.owner ? (
                                    <div className="text-center w-full px-0.5">
                                       {isWinner ? (
                                          <span className={`text-[9px] font-black uppercase tracking-wider mb-0 block drop-shadow-md ${isStandardWinner ? 'text-amber-100' : 'text-fuchsia-100'}`}>
                                             {isHybridWinner ? 'Mega Win!' : (isStandardWinner ? 'Winner!' : 'Event!')}
                                          </span>
                                       ) : (
                                          <div className="h-2"></div>
                                       )}
                                       <div className={`text-[10px] font-medium break-words leading-tight line-clamp-2 w-full ${textClass} ${isWinner ? 'font-bold' : ''}`}>
                                          {square.owner}
                                       </div>
                                    </div>
                                 ) : (
                                    !gameState.isLocked && !isSelected && (
                                       <div className="flex flex-col items-center gap-0.5 opacity-30 group-hover:opacity-100 transition-all duration-300">
                                          <UserPlus size={14} className="text-indigo-400" />
                                          <span className="text-[10px] font-mono text-indigo-600 font-bold">${gameState.costPerSquare}</span>
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
         <div className="w-full max-w-4xl mt-6 px-4 mb-24 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 flex flex-wrap justify-center items-center gap-6 md:gap-8">
               <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-emerald-600 border border-emerald-500 shadow-sm flex items-center justify-center">
                     <Check size={14} className="text-white" />
                  </div>
                  <span className="text-sm font-bold text-slate-300">Paid & Confirmed</span>
               </div>

               {currentUser && (
                  <div className="flex items-center gap-3">
                     <div className="w-6 h-6 rounded bg-cyan-600 border border-cyan-400 shadow-[0_0_10px_rgba(8,145,178,0.5)] flex items-center justify-center">
                        <UserIcon size={14} className="text-white" />
                     </div>
                     <span className="text-sm font-bold text-cyan-400">Your Squares</span>
                  </div>
               )}

               <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-orange-500 border border-orange-400 shadow-sm flex items-center justify-center">
                     <UserIcon size={14} className="text-white" />
                  </div>
                  <span className="text-sm font-bold text-slate-300">Reserved (Unpaid)</span>
               </div>

               <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-amber-400 border border-amber-300 shadow-sm flex items-center justify-center animate-bounce">
                     <Trophy size={14} className="text-black" fill="currentColor" />
                  </div>
                  <span className="text-sm font-bold text-amber-200">Period Winner</span>
               </div>

               <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-fuchsia-500 border border-fuchsia-400 shadow-sm flex items-center justify-center">
                     <Zap size={14} className="text-white" fill="currentColor" />
                  </div>
                  <span className="text-sm font-bold text-fuchsia-300">Score Change</span>
               </div>

               {!gameState.isLocked && (
                  <div className="flex items-center gap-3">
                     <div className="w-6 h-6 rounded bg-white hover:bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center">
                        <span className="text-[10px] font-bold text-slate-400">$</span>
                     </div>
                     <span className="text-sm font-bold text-slate-300">Open For Sale</span>
                  </div>
               )}
            </div>
         </div>

         {/* --- STICKY FOOTER --- */}
         {
            selectedSquares.length > 0 && (
               <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl border border-indigo-500/30 flex items-center gap-6 z-40 animate-in slide-in-from-bottom-10 ring-1 ring-white/10">
                  <div className="flex flex-col">
                     <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Selected</span>
                     <span className="font-bold text-xl leading-none">{selectedSquares.length} <span className="text-sm font-normal text-slate-400">sq</span></span>
                  </div>
                  <div className="h-8 w-px bg-slate-700"></div>
                  <div className="flex flex-col">
                     <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Total</span>
                     <span className="font-mono text-emerald-400 font-bold text-xl leading-none">${selectedSquares.length * gameState.costPerSquare}</span>
                  </div>

                  {/* LIMIT INDICATOR */}
                  <div className="h-8 w-px bg-slate-700"></div>
                  <div className="flex flex-col items-center min-w-[80px]">
                     <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1 tracking-wider">
                        Limit <Shield size={10} />
                     </span>
                     <div className="flex items-end gap-1">
                        <span className={`font-bold text-xl leading-none ${isLimitReached ? 'text-rose-400' : 'text-white'}`}>
                           {currentTotal}
                        </span>
                        <span className="text-sm font-normal text-slate-500 mb-0.5">/ {maxPerPlayer}</span>
                     </div>
                     {/* Mini Progress Bar */}
                     <div className="w-full h-1 bg-slate-700 rounded-full mt-1 overflow-hidden">
                        <div
                           className={`h-full rounded-full transition-all duration-500 ${isLimitReached ? 'bg-rose-500' : 'bg-indigo-500'}`}
                           style={{ width: `${Math.min(100, (currentTotal / maxPerPlayer) * 100)}%` }}
                        ></div>
                     </div>
                  </div>

                  <div className="flex items-center gap-3 ml-2">
                     <button
                        onClick={() => setSelectedSquares([])}
                        className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
                        title="Clear Selection"
                     >
                        <X size={20} />
                     </button>
                     <button
                        onClick={handleInitiateCheckout}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-full font-bold shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                     >
                        Reserve <ArrowRight size={16} />
                     </button>
                  </div>
               </div>
            )
         }
      </div >
   );
};