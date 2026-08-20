import React, { useState } from 'react';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { RefreshCw, Save, Lock, AlertCircle, PencilLine } from 'lucide-react';
import type { NFLGame } from '../../types';
import type { FrozenSpread } from '@shared/frozenSpread';
import { dbService } from '../../services/dbService';

/**
 * The Spread Manager, after PLAN-NFL-SPREAD-FREEZE Revision 1.
 *
 * ⚠️ WHAT CHANGED, AND WHY THE LOCK BUTTONS ARE GONE.
 *
 * A line is now frozen by writing `nfl_frozen_spreads`, a collection
 * `firestore.rules` refuses EVERY client write to — superadmin included. So this
 * screen has two kinds of row and they behave differently:
 *
 *  - **NOT FROZEN.** `nfl_games.spread` is a WORKING line. Type a number, Save.
 *    The weekly freeze reads it as the fallback when ESPN carries no line for that
 *    game, which is what makes typing one here the manual backstop it has always
 *    been. Saving does not lock anything, because locking is the freeze's job now.
 *  - **FROZEN.** The number members are graded on. It cannot be edited from here
 *    at all; changing it takes `overrideLockedSpread`, which requires a reason,
 *    writes `admin_audit` in the same transaction, and re-scores the week.
 *
 * The per-row lock toggle and "Lock All Spreads" were REMOVED, not moved (2.2,
 * codex round 15 of the original). They wrote `{ value, locked: true }` straight
 * to `nfl_games`, creating a line members could submit against with no frozen
 * record, no audit and no way for the detector to see it later — the manual
 * backstop quietly manufacturing lines the scheme cannot watch. Unlocking was
 * worse: unlock → edit → re-lock fired no rescore at all, so finalized ATS
 * standings stayed graded against the old line permanently.
 *
 * And Save now writes only the rows that CHANGED. It used to write every game in
 * the fetched list, whole-map, every time.
 */

const SEASON_TYPE_LABEL: Record<number, string> = { 1: 'Preseason', 2: 'Regular Season', 3: 'Postseason' };

export const SuperAdminNFLSpreads: React.FC = () => {
  const [season, setSeason] = useState('2026');
  const [seasonType, setSeasonType] = useState<number>(2);
  const [week, setWeek] = useState<number>(1);
  const [games, setGames] = useState<NFLGame[]>([]);
  /** The stored working values, so Save can write only what changed. */
  const [baseline, setBaseline] = useState<Record<string, number | undefined>>({});
  const [frozen, setFrozen] = useState<Record<string, FrozenSpread>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [overriding, setOverriding] = useState<string | null>(null);
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
      snap.forEach(d => fetchedGames.push(d.data() as NFLGame));
      fetchedGames.sort((a, b) => a.startTime - b.startTime);

      // BY GAME ID, not by slate: a game re-scheduled after its week froze keeps
      // the original slate on its frozen record, so a slate query would miss it
      // from both weeks and the Override button would be unreachable.
      const frozenRecords = await dbService.getFrozenSpreadsForGames(fetchedGames.map(g => g.id));

      setGames(fetchedGames);
      setFrozen(frozenRecords);
      setBaseline(Object.fromEntries(fetchedGames.map(g => [g.id, g.spread?.value])));

      if (fetchedGames.length === 0) {
        setMessage({ type: 'error', text: `No games found for ${season} ${nflWeekLabel(seasonType, week)}. Import schedule first.` });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpreadChange = (gameId: string, value: string) => {
    setGames(prev => prev.map(g => {
      if (g.id !== gameId) return g;
      // Amend the stored spread rather than rebuilding it. Rebuilding an object
      // and losing a field is the single failure shape this plan's review found
      // fourteen times.
      return { ...g, spread: { ...(g.spread ?? { locked: false }), value: parseFloat(value) || 0 } };
    }));
  };

  /** Rows whose working value differs from what was fetched, and are not frozen. */
  const dirtyGames = () => games.filter(g => !frozen[g.id] && g.spread?.value !== baseline[g.id]);

  const handleSave = async () => {
    const changed = dirtyGames();
    if (changed.length === 0) {
      setMessage({ type: 'error', text: 'Nothing to save — no working line was changed.' });
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      // Only `spread.value`, by dotted path: a frozen row is excluded above, and
      // nothing here has any business rewriting the rest of a game document that a
      // live feed owns.
      await Promise.all(changed.map(g =>
        updateDoc(doc(db, 'nfl_games', g.id), { 'spread.value': g.spread?.value ?? 0, 'spread.locked': false })
      ));
      setBaseline(prev => ({ ...prev, ...Object.fromEntries(changed.map(g => [g.id, g.spread?.value])) }));
      setMessage({
        type: 'success',
        text: `Saved ${changed.length} working line(s). They are NOT locked — run the NFL Spread Freeze from Operations to commit the week.`,
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Failed to save: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverride = async (game: NFLGame) => {
    const record = frozen[game.id];
    const current = record ? record.value : (game.spread?.value ?? 0);
    const raw = window.prompt(
      `New line for ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}, relative to the home team (negative = home favoured).\n\nCurrently frozen at ${current}.`,
      String(current),
    );
    if (raw === null) return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) {
      setMessage({ type: 'error', text: 'That is not a number; nothing was changed.' });
      return;
    }
    const reason = window.prompt(
      'Why is this frozen line changing? This is written to the audit log and the week is re-scored against the new number. At least 10 characters.',
      '',
    );
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setMessage({ type: 'error', text: 'A reason of at least 10 characters is required; nothing was changed.' });
      return;
    }

    setOverriding(game.id);
    setMessage(null);
    try {
      const res = await dbService.overrideLockedSpread({ gameId: game.id, value, reason: reason.trim() });
      setFrozen(prev => ({
        ...prev,
        [game.id]: { ...(prev[game.id] ?? {} as FrozenSpread), gameId: game.id, value, overrideId: res.overrideId, source: 'override' },
      }));
      setMessage({
        type: 'success',
        text: `${res.shape === 'create' ? 'Created' : 'Changed'} the frozen line for ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}: ${res.previousValue ?? '—'} → ${value}. The week has been queued for re-scoring.`,
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Override failed: ${err.message}` });
    } finally {
      setOverriding(null);
    }
  };

  const frozenCount = games.filter(g => frozen[g.id]).length;

  return (
    <div className="bg-surface p-6 rounded-xl border border-line shadow-panel mt-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-gold-500/20 rounded-xl text-gold-700 dark:text-gold-400">
          <AlertCircle size={24} />
        </div>
        <div>
          <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">NFL Spread Manager</h3>
          <p className="text-sm text-muted">
            Enter working lines before the freeze. A frozen line is what members are graded on and can only be changed with a reason.
          </p>
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
            onChange={(e) => {
              const st = parseInt(e.target.value);
              setSeasonType(st);
              // Keep state inside the shrunken preseason option list (codex r5).
              if (st === 1 && week > 4) setWeek(1);
            }}
            className="w-full rounded-md border-[1.5px] border-line bg-page px-4 py-2.5 text-[color:var(--text)] font-bold text-sm cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
          >
            {[1, 2, 3].map(st => <option key={st} value={st}>{SEASON_TYPE_LABEL[st]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] block mb-2">Week</label>
          <select
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value))}
            className="w-full rounded-md border-[1.5px] border-line bg-page px-4 py-2.5 text-[color:var(--text)] font-bold text-sm cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
          >
            {Array.from({ length: seasonType === 1 ? 4 : 18 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>{nflWeekLabel(seasonType, w)}</option>
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
          <div className="mb-4 p-3 rounded-lg bg-page border border-line text-[11px] text-muted leading-relaxed">
            <span className="num font-bold text-[color:var(--text)]">{frozenCount}/{games.length}</span> frozen.
            {' '}Locking is no longer done here — the weekly freeze commits the whole week at once, at its stated time,
            and takes these working lines for any game the feed has no line for. To commit a week now, use
            {' '}<span className="font-bold">NFL Spread Freeze</span> in Operations.
          </div>

          <div className="space-y-3 mb-6 max-h-[500px] overflow-y-auto pr-2">
            {games.map(game => {
              const record = frozen[game.id];
              return (
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
                    {record ? (
                      <>
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] text-faint uppercase tracking-[0.16em] font-display font-bold mb-1 flex items-center gap-1">
                            <Lock size={9} aria-hidden="true" /> Frozen
                          </span>
                          <span className="num text-lg font-bold text-[#0F7B4A]">{record.value}</span>
                        </div>
                        <button
                          onClick={() => handleOverride(game)}
                          disabled={overriding === game.id}
                          className="p-2 rounded-lg border border-line bg-page text-faint hover:text-gold-700 dark:hover:text-gold-400 hover:border-gold-500/30 disabled:opacity-50 transition-colors"
                          title="Change this frozen line (requires a reason; audited and re-scored)"
                        >
                          {overriding === game.id ? <RefreshCw size={16} className="animate-spin" /> : <PencilLine size={16} />}
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col">
                        <label className="text-[9px] text-faint uppercase tracking-[0.16em] font-display font-bold mb-1">Working line (rel. to home)</label>
                        <input
                          type="number"
                          step="0.5"
                          value={game.spread?.value ?? ''}
                          onChange={(e) => handleSpreadChange(game.id, e.target.value)}
                          className="num w-24 rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-center text-[color:var(--text)] font-bold focus:outline-none focus:border-navy-600 transition-colors"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4 border-t border-line">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-gold-foil hover:brightness-105 disabled:opacity-50 text-navy-900 font-display font-bold uppercase tracking-[0.05em] px-8 py-3 rounded-md flex items-center gap-2 shadow-[0_6px_16px_rgba(140,109,51,0.28)] hover:-translate-y-px transition-all duration-150"
            >
              {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              Save Working Lines
            </button>
          </div>
        </>
      )}
    </div>
  );
};
