import React, { useState } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { RefreshCw, Save, Lock, Unlock, AlertCircle } from 'lucide-react';
import type { NFLGame } from '../../types';

export const SuperAdminNFLSpreads: React.FC = () => {
  const [season, setSeason] = useState('2026');
  const [seasonType, setSeasonType] = useState<number>(2);
  const [week, setWeek] = useState<number>(1);
  const [games, setGames] = useState<NFLGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchGames = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const q = query(
        collection(db, 'nfl_games'),
        where('season', '==', season),
        where('seasonType', '==', seasonType),
        where('week', '==', week)
      );
      const snap = await getDocs(q);
      const fetchedGames: NFLGame[] = [];
      snap.forEach(doc => fetchedGames.push(doc.data() as NFLGame));
      
      // Sort by start time
      fetchedGames.sort((a, b) => a.startTime - b.startTime);
      setGames(fetchedGames);
      
      if (fetchedGames.length === 0) {
        setMessage({ type: 'error', text: `No games found for ${season} Week ${week}. Import schedule first.` });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpreadChange = (gameId: string, value: string) => {
    setGames(prev => prev.map(g => {
      if (g.id === gameId) {
        return {
          ...g,
          spread: {
            ...g.spread,
            value: parseFloat(value) || 0,
            locked: g.spread?.locked || false
          }
        };
      }
      return g;
    }));
  };

  const handleLockToggle = (gameId: string) => {
    setGames(prev => prev.map(g => {
      if (g.id === gameId) {
        return {
          ...g,
          spread: {
            value: g.spread?.value || 0,
            locked: !(g.spread?.locked || false)
          }
        };
      }
      return g;
    }));
  };

  const handleLockAll = () => {
    setGames(prev => prev.map(g => ({
      ...g,
      spread: {
        value: g.spread?.value || 0,
        locked: true
      }
    })));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      // Create updates for all modified games
      const promises = games.map(g => {
        const ref = doc(db, 'nfl_games', g.id);
        return updateDoc(ref, {
          spread: g.spread || { value: 0, locked: false }
        });
      });
      await Promise.all(promises);
      setMessage({ type: 'success', text: 'Spreads successfully saved and updated.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Failed to save: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-surface p-6 rounded-xl border border-line shadow-panel mt-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-gold-500/20 rounded-xl text-gold-700 dark:text-gold-400">
          <AlertCircle size={24} />
        </div>
        <div>
          <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">NFL Spread Override Manager</h3>
          <p className="text-sm text-muted">Manually enter spreads or override ESPN lines before locking.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] block mb-2">Season</label>
          <input
            type="text"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="num w-full rounded-md border-[1.5px] border-line bg-page px-4 py-2.5 text-[color:var(--text)] font-bold text-sm transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] block mb-2">Type</label>
          <select
            value={seasonType}
            onChange={(e) => setSeasonType(parseInt(e.target.value))}
            className="w-full rounded-md border-[1.5px] border-line bg-page px-4 py-2.5 text-[color:var(--text)] font-bold text-sm cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
          >
            <option value={1}>Preseason</option>
            <option value={2}>Regular Season</option>
            <option value={3}>Postseason</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] block mb-2">Week</label>
          <select
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value))}
            className="w-full rounded-md border-[1.5px] border-line bg-page px-4 py-2.5 text-[color:var(--text)] font-bold text-sm cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={fetchGames}
            disabled={isLoading}
            className="w-full bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-2.5 rounded-md flex items-center justify-center gap-2 transition-all duration-150 hover:-translate-y-px"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            Fetch Games
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl text-xs font-bold mb-6 ${
          message.type === 'success' ? 'bg-[#0F7B4A]/10 text-[#0F7B4A] border border-[#0F7B4A]/20' : 'bg-brandred-500/10 text-brandred-600 border border-brandred-500/20'
        }`}>
          {message.text}
        </div>
      )}

      {games.length > 0 && (
        <>
          <div className="flex justify-end mb-4">
            <button
              onClick={handleLockAll}
              className="text-xs font-display font-bold uppercase text-gold-700 dark:text-gold-400 hover:brightness-110 flex items-center gap-1"
            >
              <Lock size={14} /> Lock All Spreads
            </button>
          </div>

          <div className="space-y-3 mb-6 max-h-[500px] overflow-y-auto pr-2">
            {games.map(game => (
              <div key={game.id} className="bg-card border border-line rounded-xl p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="num text-[10px] text-faint font-bold mb-1">
                    {new Date(game.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div className="text-sm font-display font-extrabold uppercase text-[color:var(--text)] flex items-center gap-2">
                    <span className="w-12 text-right">{game.awayTeam.abbreviation}</span>
                    <span className="text-faint font-normal text-xs">@</span>
                    <span className="w-12">{game.homeTeam.abbreviation}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <label className="text-[9px] text-faint uppercase tracking-[0.16em] font-display font-bold mb-1">Spread (Rel. to Home)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={game.spread?.value || 0}
                      onChange={(e) => handleSpreadChange(game.id, e.target.value)}
                      className="num w-24 rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-center text-[color:var(--text)] font-bold focus:outline-none focus:border-navy-600 transition-colors"
                    />
                  </div>

                  <button
                    onClick={() => handleLockToggle(game.id)}
                    className={`p-2 rounded-lg border transition-colors ${
                      game.spread?.locked
                        ? 'bg-[#0F7B4A]/10 border-[#0F7B4A]/30 text-[#0F7B4A]'
                        : 'bg-page border-line text-faint hover:text-gold-700 dark:hover:text-gold-400 hover:border-gold-500/30'
                    }`}
                    title={game.spread?.locked ? 'Unlock Spread' : 'Lock Spread'}
                  >
                    {game.spread?.locked ? <Lock size={16} /> : <Unlock size={16} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4 border-t border-line">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-gold-foil hover:brightness-105 disabled:opacity-50 text-navy-900 font-display font-bold uppercase tracking-[0.05em] px-8 py-3 rounded-md flex items-center gap-2 shadow-[0_6px_16px_rgba(140,109,51,0.28)] hover:-translate-y-px transition-all duration-150"
            >
              {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              Save Overrides & Locks
            </button>
          </div>
        </>
      )}
    </div>
  );
};
