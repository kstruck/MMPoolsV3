import React, { useState, useEffect } from 'react';
import type { GameState, Winner, PlayerDetails } from '../types';
import { Lock, UserPlus, User, Trophy, Ban, Check, X, ArrowDown, ArrowRight, Info, Edit2, ChevronUp, AlertCircle, Shield } from 'lucide-react';
import { getTeamLogo } from '../constants';

interface GridProps {
   gameState: GameState;
   onClaimSquares: (ids: number[], name: string, details: PlayerDetails) => { success: boolean; message?: string };
   winners: Winner[];
   highlightHomeDigit?: number;
   highlightAwayDigit?: number;
}

export const Grid: React.FC<GridProps> = ({ gameState, onClaimSquares, winners, highlightHomeDigit, highlightAwayDigit }) => {
   const [selectedSquares, setSelectedSquares] = useState<number[]>([]);

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

   // Auto-scroll to error when it appears
   useEffect(() => {
      if (errorMsg) {
         window.scrollTo({ top: 0, behavior: 'smooth' });
      }
   }, [errorMsg]);

   const homeLogo = getTeamLogo(gameState.homeTeam);
   const awayLogo = getTeamLogo(gameState.awayTeam);

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

   const handleFinalizePurchase = () => {
      const result = onClaimSquares(selectedSquares, playerInfo.name, playerInfo.details);
      if (result.success) {
         setSelectedSquares([]);
         setIsConfirming(false);
         setErrorMsg(null);
         // We keep the identity set so they can buy more easily!
      } else {
         setErrorMsg(result.message || 'Error processing request');
         setIsConfirming(false);
         setIsIdentityOpen(true); // Re-open just in case they need to fix name
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

   return (
      <div className="flex flex-col items-center w-full mx-auto">

         {/* --- ERROR BANNER (Always Visible) --- */}
         {errorMsg && !isConfirming && (
            <div className="w-full max-w-2xl mb-4 p-4 bg-rose-500/10 border border-rose-500/50 rounded-xl flex items-center gap-3 text-rose-300 font-bold shadow-lg shadow-rose-900/20 animate-in slide-in-from-top-2 z-50">
               <AlertCircle size={24} className="shrink-0" />
               <div>{errorMsg}</div>
            </div>
         )}

         {/* --- SECTION 1: PLAYER IDENTITY PANEL --- */}
         <div className={`w-full max-w-2xl mb-6 rounded-xl border overflow-hidden transition-all duration-300 ${isIdentitySet ? 'bg-slate-900/50 border-emerald-500/30' : 'bg-slate-800 border-indigo-500/50 shadow-lg shadow-indigo-500/10'}`}>

            {/* Header */}
            <div
               className={`p-4 flex items-center justify-between cursor-pointer ${isIdentitySet ? 'bg-emerald-900/10' : 'bg-slate-800'}`}
               onClick={() => setIsIdentityOpen(!isIdentityOpen)}
            >
               <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isIdentitySet ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-700 text-slate-400'}`}>
                     <User size={20} />
                  </div>
                  <div>
                     <h3 className={`font-bold text-sm uppercase tracking-wide ${isIdentitySet ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {isIdentitySet ? 'Picking as:' : 'Player Details'}
                     </h3>
                     <div className="flex items-center gap-2">
                        <p className="text-lg font-bold text-white leading-none">
                           {isIdentitySet ? playerInfo.name : 'Enter your info to start'}
                        </p>
                        {isIdentitySet && squaresAlreadyOwned > 0 && (
                           <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">
                              Owns {squaresAlreadyOwned} sq
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                     <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">Your Name *</label>
                        <input
                           type="text"
                           value={playerInfo.name}
                           onChange={(e) => { setPlayerInfo(prev => ({ ...prev, name: e.target.value })); setErrorMsg(null); }}
                           className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none text-lg placeholder:text-slate-600"
                           placeholder="e.g. John Smith"
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email Address</label>
                        <input
                           type="email"
                           value={playerInfo.details.email}
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
                     {gameState.collectReferral && (
                        <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Referred By</label>
                           <input
                              type="text"
                              value={playerInfo.details.referral}
                              onChange={(e) => updateDetail('referral', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                           />
                        </div>
                     )}
                     {gameState.collectAddress && (
                        <div className="md:col-span-2">
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Postal Address</label>
                           <input
                              type="text"
                              value={playerInfo.details.address}
                              onChange={(e) => updateDetail('address', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                           />
                        </div>
                     )}
                     {gameState.collectNotes && (
                        <div className="md:col-span-2">
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                           <textarea
                              value={playerInfo.details.notes}
                              onChange={(e) => updateDetail('notes', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-20 resize-none placeholder:text-slate-600"
                              placeholder="Special requests..."
                           />
                        </div>
                     )}
                  </div>

                  <div className="flex justify-end">
                     <button
                        onClick={handleSetIdentity}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
                     >
                        Start Picking <ArrowRight size={18} />
                     </button>
                  </div>
               </div>
            )}
         </div>

         {/* --- CONFIRMATION MODAL --- */}
         {isConfirming && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
               <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Check className="text-emerald-400" /> Confirm Purchase</h3>

                  <div className="bg-slate-900 rounded-lg p-4 mb-6 space-y-3">
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

                  <div className="flex gap-3">
                     <button onClick={() => setIsConfirming(false)} className="flex-1 py-3 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition-colors">Cancel</button>
                     <button onClick={handleFinalizePurchase} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow-lg shadow-emerald-500/20">Confirm</button>
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
            <div className="overflow-x-auto grid-scroll pb-2">
               {/* Grid Container - 11x11 layout */}
               <div className="min-w-[600px] grid grid-cols-11 gap-1 select-none">

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
                     const baseClass = "flex flex-col items-center justify-center font-bold text-2xl h-16 rounded-lg border relative overflow-hidden group transition-all duration-300";
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
                           const baseClass = "flex flex-col items-center justify-center font-bold text-2xl w-full h-16 rounded-lg border relative overflow-hidden transition-all duration-300";
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
                              bgClass = "bg-gradient-to-br from-amber-500/40 to-yellow-600/40 backdrop-blur-md";
                              borderClass = "border-2 border-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.4)]";
                              textClass = "text-white font-bold text-shadow-sm";
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
                              bgClass = isOwned ? "bg-slate-900" : "bg-slate-800/60";
                              borderClass = "border-slate-700";
                              effectClass += " brightness-110";
                           } else if (isOwned) {
                              bgClass = "bg-black shadow-inner";
                              borderClass = "border-slate-800";
                              textClass = "text-slate-200 font-medium";
                           } else if (isAvailable) {
                              bgClass = "bg-slate-800 hover:bg-slate-700 cursor-pointer backdrop-blur-sm hover:shadow-lg hover:shadow-indigo-500/10";
                              borderClass = "border-slate-700 hover:border-indigo-400/50";
                              effectClass += " hover:scale-[1.05] hover:-translate-y-0.5";
                              zIndex = "hover:z-10";
                              textClass = "text-indigo-200";
                           } else if (isLockedEmpty) {
                              bgClass = "bg-slate-950/30 opacity-40 cursor-not-allowed";
                              borderClass = "border-slate-900/50";
                           }

                           return (
                              <div
                                 key={`sq-${squareIndex}`}
                                 onClick={() => handleSquareClick(squareIndex)}
                                 className={`
                        relative flex flex-col items-center justify-center h-16 rounded-lg 
                        ${bgClass} ${borderClass} ${textClass} ${effectClass} ${zIndex}
                        group
                      `}
                              >
                                 {isActiveIntersection && (
                                    <div className="absolute inset-0 bg-white/5 animate-pulse rounded pointer-events-none"></div>
                                 )}

                                 {/* --- SMALL CORNER ICONS --- */}

                                 {/* Selected Indicator (Top Right) */}
                                 {isSelected && (
                                    <div className="absolute -top-2 -right-2 bg-indigo-500 text-white rounded-full p-0.5 shadow-sm z-50 ring-2 ring-slate-900 animate-in zoom-in duration-200">
                                       <Check size={10} strokeWidth={3} />
                                    </div>
                                 )}

                                 {/* Winner Indicator (Top Right) */}
                                 {isWinner && (
                                    <div className="absolute -top-3 -right-3 text-slate-900 bg-amber-400 rounded-full p-1 border border-white/30 shadow-lg z-50 animate-bounce">
                                       <Trophy size={14} fill="currentColor" />
                                    </div>
                                 )}

                                 {/* Owned Indicator (Top Left) */}
                                 {square.owner && !isWinner && (
                                    <div className="absolute top-1 left-1 text-slate-600 group-hover:text-slate-400 transition-colors">
                                       <User size={10} />
                                    </div>
                                 )}

                                 {/* Locked/Empty Indicator (Top Left) */}
                                 {isLockedEmpty && (
                                    <div className="absolute top-1 left-1 text-slate-700/50">
                                       <Lock size={10} />
                                    </div>
                                 )}

                                 {/* --- CONTENT --- */}

                                 {square.owner ? (
                                    <div className="text-center w-full px-0.5">
                                       {isWinner ? (
                                          <span className="text-[9px] font-black text-amber-100 uppercase tracking-wider mb-0 block drop-shadow-md">Winner!</span>
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
                                          <span className="text-[10px] font-mono text-indigo-300 font-bold">${gameState.costPerSquare}</span>
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

         {/* --- STICKY FOOTER --- */}
         {selectedSquares.length > 0 && (
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
                     Checkout <ArrowRight size={16} />
                  </button>
               </div>
            </div>
         )}
      </div>
   );
};