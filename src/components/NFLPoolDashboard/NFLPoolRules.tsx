import React from 'react';
import { HelpCircle, Shield, Award, Calendar, DollarSign, RefreshCw, Zap } from 'lucide-react';
import type { Pool } from '../../types';

interface NFLPoolRulesProps {
  pool: Pool;
}

export const NFLPoolRules: React.FC<NFLPoolRulesProps> = ({ pool }) => {
  const castPool = pool as any;
  const type = pool.type;
  const settings = castPool.settings || {};

  const entryFee = settings.entryFee ?? 0;
  const lockBuffer = settings.lockBufferMinutes ?? 5;

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Introduction Card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryAccent }}
        />
        <div className="flex gap-4 items-start">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-2xl">
            <HelpCircle size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white mb-2">NFL Pools Rules & Specifications</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Welcome to the pool dashboard! Below are the official configuration and scoring rules initialized by your commissioner. Ensure you submit and lock selections prior to weekly deadlines.
            </p>
          </div>
        </div>
      </div>

      {/* Rules Details Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Card 1: Entry & Deadlines */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <DollarSign size={14} className="text-indigo-400" /> Entry & Payout Settings
          </h4>
          <ul className="space-y-3.5 text-xs text-slate-350">
            <li className="flex justify-between border-b border-slate-800/60 pb-2">
              <span className="font-bold">Entry Fee:</span>
              <span className="text-white font-black font-mono">${entryFee}</span>
            </li>
            <li className="flex justify-between border-b border-slate-800/60 pb-2">
              <span className="font-bold">Payout Structure:</span>
              <span className="text-white font-black uppercase text-[10px] tracking-wider">
                {settings.payoutMode === 'SEASON' ? 'Season Standings' :
                 settings.payoutMode === 'WEEKLY' ? 'Weekly Sharp payouts' : 'Season + Weekly Hybrid'}
              </span>
            </li>
            <li className="flex flex-col gap-1">
              <span className="font-bold">Payment Instructions:</span>
              <span className="text-slate-450 italic bg-slate-950/40 p-2.5 border border-slate-850 rounded-xl leading-normal text-[11px]">
                {settings.paymentInstructions || 'Please contact commissioner for payment.'}
              </span>
            </li>
          </ul>
        </div>

        {/* Card 2: Lock Deadlines */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Calendar size={14} className="text-indigo-400" /> Lock Deadlines
          </h4>
          <ul className="space-y-3.5 text-xs text-slate-350">
            <li className="flex justify-between border-b border-slate-800/60 pb-2">
              <span className="font-bold">Lock Buffer Grace:</span>
              <span className="text-white font-black font-mono">{lockBuffer} Minutes Before Kickoff</span>
            </li>
            <li className="flex justify-between border-b border-slate-800/60 pb-2">
              <span className="font-bold">Lock Frequency Mode:</span>
              <span className="text-white font-black uppercase text-[10px] tracking-wider">
                {type === 'NFL_PICKEM' && settings.confidenceMode ? 'Strictly Weekly' :
                 type === 'NFL_PICKEM' && settings.lockMode === 'PER_GAME' ? 'Per-Game Kickoff' : 'Weekly (First Game Kickoff)'}
              </span>
            </li>
            <li className="leading-relaxed text-[11px] text-slate-500">
              ⚡ <strong>Note:</strong> Picks must be submitted prior to the kickoff lock. Locked selections cannot be edited by participants under any circumstance.
            </li>
          </ul>
        </div>

        {/* Card 3: Game Rules Specific to Pool Type */}
        {type === 'NFL_PICKEM' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4 md:col-span-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Award size={14} className="text-indigo-400" /> Pick'em Scoring & Strategy Rules
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-350">
              <div className="space-y-3">
                <p className="font-bold text-white text-sm">General Rules</p>
                <ul className="list-disc list-inside space-y-2 leading-relaxed">
                  <li>
                    {settings.confidenceMode
                      ? 'Rank each game 1 to N. Higher rank = more points on a correct pick.'
                      : 'Pick the outright winner of every scheduled game each week.'}
                  </li>
                  <li>Ties and incorrect picks earn 0 points.</li>
                  <li>Cancelled games are voided and earn 0 points for all participants.</li>
                </ul>

                {/* Custom scoring display */}
                <div className="bg-slate-950/30 border border-slate-800 rounded-xl p-3 space-y-1.5 mt-2">
                  <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Scoring Config</p>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold">Base Points Per Pick:</span>
                    <span className="text-white font-extrabold font-mono">
                      {settings.pointsPerPick ?? 1} pt{(settings.pointsPerPick ?? 1) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {settings.primetimeBonus?.thursday && (
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold">🌙 TNF Bonus:</span>
                      <span className="text-amber-400 font-extrabold font-mono">+{settings.primetimeBonus.thursday} pts</span>
                    </div>
                  )}
                  {settings.primetimeBonus?.sundayNight && (
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold">⭐ SNF Bonus:</span>
                      <span className="text-amber-400 font-extrabold font-mono">+{settings.primetimeBonus.sundayNight} pts</span>
                    </div>
                  )}
                  {settings.primetimeBonus?.monday && (
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold">🏈 MNF Bonus:</span>
                      <span className="text-amber-400 font-extrabold font-mono">+{settings.primetimeBonus.monday} pts</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 bg-slate-950/20 p-4 border border-slate-800 rounded-2xl">
                <p className={`font-bold text-sm flex items-center gap-1.5 ${
                  settings.confidenceMode ? 'text-indigo-400' : 'text-slate-400'
                }`}>
                  <Zap size={14} />
                  {settings.confidenceMode ? 'Confidence Mode Active' : 'Standard Scoring Mode'}
                </p>
                <p className="leading-relaxed text-[11px] text-slate-400">
                  {settings.confidenceMode
                    ? `Assign a unique confidence weight from 1 to N for each game. Higher weight earns more points upon success. All games must have unique confidence ranks assigned.`
                    : `Every correct pick earns ${settings.pointsPerPick ?? 1} point${(settings.pointsPerPick ?? 1) !== 1 ? 's' : ''}. Confidence rankings are disabled in this pool.`}
                </p>
              </div>
            </div>
          </div>
        )}

        {type === 'NFL_SURVIVOR' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4 md:col-span-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Shield size={14} className="text-indigo-400" /> Survivor Rules
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-350">
              <div className="space-y-3.5">
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <span className="font-bold">Play Mode:</span>
                  <span className="text-white font-extrabold uppercase">
                    {settings.pickLosersMode ? 'Pick Team to Lose' : 'Pick Team to Win'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <span className="font-bold">Mulligans / Strikes Allowed:</span>
                  <span className="text-white font-extrabold font-mono">
                    {settings.maxStrikes === 0 ? 'Sudden Death (0 strikes)' : `${settings.maxStrikes} Strikes/Mulligans`}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-2">
                  <span className="font-bold">Auto-Survive Exemption:</span>
                  <span className="text-white font-extrabold">
                    {settings.autoSurviveExemptionEnabled ? 'Enabled (Exempt when 0 eligible teams left)' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="space-y-3 bg-slate-950/20 p-4 border border-slate-800 rounded-2xl">
                <p className="font-bold text-amber-400 text-sm flex items-center gap-1.5">
                  <RefreshCw size={14} /> Rebuy & Strike Rules
                </p>
                <ul className="space-y-2 text-[11px] text-slate-450 leading-relaxed list-disc list-inside">
                  <li>You cannot select the same team twice in a season.</li>
                  <li>
                    Rebuys: {settings.maxRebuys > 0 
                      ? `Allowed up to ${settings.maxRebuys} rebuys before Week ${settings.rebuyDeadlineWeek} at a cost of $${settings.rebuyCost} per rebuy.`
                      : 'Disabled in this pool.'}
                  </li>
                  <li>Failure to submit a pick yields an automatic strike at week-end.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {type === 'NFL_MARGIN' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4 md:col-span-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Award size={14} className="text-indigo-400" /> Margin Scoring & Cascade Tiebreakers
            </h4>
            <div className="space-y-4 text-xs text-slate-350">
              <p className="leading-relaxed">
                Pick a team each week. Your score is their margin of victory (e.g. if they win by 14, you get +14).
                If they lose, the negative margin counts against you. You cannot pick the same team twice in a season.
                <strong> Non-submissions penalize you with an automatic -14 margin score!</strong>
              </p>
              
              <div className="bg-slate-950/30 p-4 border border-slate-800 rounded-2xl space-y-2.5">
                <p className="font-extrabold text-white">5-Level Tiebreaker Standings Cascade:</p>
                <ol className="list-decimal list-inside space-y-1.5 font-mono text-[10px] text-slate-400 leading-normal">
                  <li>Highest Season Total victory margin.</li>
                  <li>Lowest Negative Burden (sum of absolute values of negative margins).</li>
                  <li>Most Positive Weeks (winning selections &gt; 0 margin).</li>
                  <li>Highest Single-Week margin score.</li>
                  <li>Deterministic ID comparison.</li>
                </ol>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
