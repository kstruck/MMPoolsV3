import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, ChevronLeft, ShieldAlert, Sparkles, Coins, Palette, ShieldCheck } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { User, BillingConfig } from '../../types';
import { BillingInvoiceCard } from '../billing/BillingInvoiceCard';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useToast } from '../ui/Toast';
import { getUserMessage } from '../../utils/errorMessages';

interface NFLPoolWizardProps {
  user: User;
  onComplete: () => void;
  onCancel: () => void;
}

export const NFLPoolWizard: React.FC<NFLPoolWizardProps> = ({ user, onComplete, onCancel }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const poolType = (searchParams.get('type') || 'NFL_PICKEM') as 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';

  const [billingConfig, setBillingConfig] = useState<BillingConfig | null>(null);

  useEffect(() => {
    const docRef = doc(db, 'settings', 'billing_config');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setBillingConfig(docSnap.data() as BillingConfig);
      }
    }, (err) => {
      console.warn('[NFLPoolWizard] Failed to fetch billing config:', err);
    });
    return () => unsubscribe();
  }, []);

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 5;
  const [isCreating, setIsCreating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tosAccepted, setTosAccepted] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [estimatedPlayers, setEstimatedPlayers] = useState(40);

  // 1. Sensible defaults based on pool type
  const [name, setName] = useState('');
  const [season, setSeason] = useState('2026');
  const [seasonType, setSeasonType] = useState<1 | 2>(2); // 1 = Preseason, 2 = Regular
  const [entryFee, setEntryFee] = useState(20);
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [isListedPublic, setIsListedPublic] = useState(false);

  // Pick'em settings
  const [confidenceMode, setConfidenceMode] = useState(false);
  const [pickemLockMode, setPickemLockMode] = useState<'PER_GAME' | 'WEEKLY'>('PER_GAME');
  const [lockBufferMinutes, setLockBufferMinutes] = useState(5);
  const [pickemPayoutMode, setPickemPayoutMode] = useState<'SEASON' | 'WEEKLY' | 'HYBRID'>('SEASON');
  const [pickMode, setPickMode] = useState<'STRAIGHT' | 'ATS'>('STRAIGHT');

  // Scoring options (Pick'em)
  const [pointsPerPick, setPointsPerPick] = useState(1);
  const [thursdayBonus, setThursdayBonus] = useState(0);
  const [sundayNightBonus, setSundayNightBonus] = useState(0);
  const [mondayBonus, setMondayBonus] = useState(0);

  // Survivor settings
  const [maxStrikes, setMaxStrikes] = useState(0); // 0 = sudden death
  const [maxRebuys, setMaxRebuys] = useState(0); // 0 = no rebuys
  const [rebuyDeadlineWeek, setRebuyDeadlineWeek] = useState(8);
  const [rebuyCost, setRebuyCost] = useState(20);
  const [pickLosersMode, setPickLosersMode] = useState(false);
  const [autoSurviveExemptionEnabled, setAutoSurviveExemptionEnabled] = useState(true);

  // Margin settings
  const [marginPayoutMode, setMarginPayoutMode] = useState<'SEASON' | 'WEEKLY' | 'HYBRID'>('SEASON');

  // Branding Customization
  const [primaryColor, setPrimaryColor] = useState('#0f172a'); // default dark slate
  const [accentColor, setAccentColor] = useState('#6366f1'); // default indigo

  // Premium Features States
  const [hasCustomBranding, setHasCustomBranding] = useState(true);
  const [hasAiCommissioner, setHasAiCommissioner] = useState(false);

  // Re-run support (?cloneFrom=<poolId>): seed the wizard from a prior pool the user owns
  const cloneFromId = searchParams.get('cloneFrom');
  const [cloneSourceName, setCloneSourceName] = useState<string | null>(null);
  const [cloneRebuyCost, setCloneRebuyCost] = useState<number | null>(null);

  // Force Weekly Lock if Confidence Mode is enabled
  useEffect(() => {
    if (confidenceMode) {
      setPickemLockMode('WEEKLY');
    }
  }, [confidenceMode]);

  // Synchronize rebuy cost with entry fee by default
  useEffect(() => {
    setRebuyCost(entryFee);
  }, [entryFee]);

  // Apply a cloned rebuy cost AFTER the entry-fee sync above so cloning the
  // entry fee doesn't clobber a custom rebuy cost (both effects fire in the
  // same commit; this one is declared later, so its setRebuyCost wins).
  useEffect(() => {
    if (cloneRebuyCost !== null) setRebuyCost(cloneRebuyCost);
  }, [cloneRebuyCost]);

  // Seed wizard state from the cloneFrom pool ("Re-run this pool").
  // Season/dates intentionally NOT cloned — the wizard's normal season defaults apply.
  useEffect(() => {
    if (!cloneFromId) return;
    let cancelled = false;
    (async () => {
      try {
        const source = await dbService.getPoolById(cloneFromId) as any;
        if (cancelled || !source) return;
        // Only the pool's own commissioner may re-run it, and only into the same pool type
        const isOwner = source.ownerId === user.id || source.managerUid === user.id;
        if (!isOwner || source.type !== poolType) return;

        const s = source.settings || {};
        const nextYear = new Date().getFullYear() + 1;
        const baseName: string = source.name || '';
        // Swap an embedded year for next year if present, otherwise append it
        setName(/\b20\d{2}\b/.test(baseName)
          ? baseName.replace(/\b20\d{2}\b/, String(nextYear))
          : `${baseName} ${nextYear}`.trim());

        if (typeof s.entryFee === 'number') setEntryFee(s.entryFee);
        if (typeof s.paymentInstructions === 'string') setPaymentInstructions(s.paymentInstructions);
        if (typeof s.isListedPublic === 'boolean') setIsListedPublic(s.isListedPublic);
        if (typeof s.maxEntriesTotal === 'number' && s.maxEntriesTotal > 0) setEstimatedPlayers(s.maxEntriesTotal);

        if (poolType === 'NFL_PICKEM') {
          if (typeof s.confidenceMode === 'boolean') setConfidenceMode(s.confidenceMode);
          if (s.lockMode === 'PER_GAME' || s.lockMode === 'WEEKLY') setPickemLockMode(s.lockMode);
          if (typeof s.lockBufferMinutes === 'number') setLockBufferMinutes(s.lockBufferMinutes);
          if (s.payoutMode === 'SEASON' || s.payoutMode === 'WEEKLY' || s.payoutMode === 'HYBRID') setPickemPayoutMode(s.payoutMode);
          if (s.pickMode === 'STRAIGHT' || s.pickMode === 'ATS') setPickMode(s.pickMode);
          if (typeof s.pointsPerPick === 'number') setPointsPerPick(s.pointsPerPick);
          setThursdayBonus(s.primetimeBonus?.thursday ?? 0);
          setSundayNightBonus(s.primetimeBonus?.sundayNight ?? 0);
          setMondayBonus(s.primetimeBonus?.monday ?? 0);
        } else if (poolType === 'NFL_SURVIVOR') {
          if (typeof s.maxStrikes === 'number') setMaxStrikes(s.maxStrikes);
          if (typeof s.maxRebuys === 'number') setMaxRebuys(s.maxRebuys);
          if (typeof s.rebuyDeadlineWeek === 'number') setRebuyDeadlineWeek(s.rebuyDeadlineWeek);
          if (typeof s.rebuyCost === 'number') setCloneRebuyCost(s.rebuyCost);
          if (typeof s.pickLosersMode === 'boolean') setPickLosersMode(s.pickLosersMode);
          if (typeof s.autoSurviveExemptionEnabled === 'boolean') setAutoSurviveExemptionEnabled(s.autoSurviveExemptionEnabled);
        } else if (poolType === 'NFL_MARGIN') {
          if (s.payoutMode === 'SEASON' || s.payoutMode === 'WEEKLY' || s.payoutMode === 'HYBRID') setMarginPayoutMode(s.payoutMode);
        }

        const b = source.branding || {};
        if (typeof b.primaryColor === 'string' && b.primaryColor) setPrimaryColor(b.primaryColor);
        if (typeof b.secondaryColor === 'string' && b.secondaryColor) setAccentColor(b.secondaryColor);

        setCloneSourceName(baseName || 'previous pool');
      } catch (err) {
        // Silently ignore — the wizard just starts fresh
        logger.warn('[NFLPoolWizard] cloneFrom seed failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [cloneFromId, poolType, user.id]);

  // Set default pool names
  useEffect(() => {
    const typeLabel =
      poolType === 'NFL_PICKEM' ? "Weekly Pick'em" :
      poolType === 'NFL_SURVIVOR' ? "Survivor Pool" : "Margin Pool";
    setName(`${user.name || 'My'}'s 2026 NFL ${typeLabel}`);
  }, [poolType, user.name]);

  // Form Validation
  const validateStep = (currentStep: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (currentStep === 1) {
      if (!name.trim()) newErrors.name = 'Pool name is required.';
      if (entryFee < 0) newErrors.entryFee = 'Entry fee cannot be negative.';
    }

    if (currentStep === 2) {
      if (poolType === 'NFL_SURVIVOR') {
        if (maxStrikes < 0) newErrors.maxStrikes = 'Strikes cannot be negative.';
        if (maxRebuys < 0) newErrors.maxRebuys = 'Rebuy limit cannot be negative.';
        if (rebuyDeadlineWeek < 1 || rebuyDeadlineWeek > 18) {
          newErrors.rebuyDeadlineWeek = 'Deadline week must be between 1 and 18.';
        }
        if (rebuyCost < 0) newErrors.rebuyCost = 'Rebuy cost cannot be negative.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(s => Math.min(TOTAL_STEPS, s + 1));
    }
  };

  const handleBack = () => {
    setStep(s => Math.max(1, s - 1));
  };

  const handleLaunch = async () => {
    if (!validateStep(step)) return;
    setIsCreating(true);

    try {
      const payouts = {
        places: [{ rank: 1, percentage: 100 }],
        bonuses: []
      };

      // Construct Settings depending on selected NFL pool type
      let settings: any = {
        entryFee,
        paymentInstructions,
        isListedPublic,
        payouts,
        maxEntriesTotal: estimatedPlayers
      };

      if (poolType === 'NFL_PICKEM') {
        const primetimeBonus: Record<string, number> = {};
        if (thursdayBonus > 0) primetimeBonus.thursday = thursdayBonus;
        if (sundayNightBonus > 0) primetimeBonus.sundayNight = sundayNightBonus;
        if (mondayBonus > 0) primetimeBonus.monday = mondayBonus;

        settings = {
          ...settings,
          confidenceMode,
          lockMode: pickemLockMode,
          lockBufferMinutes,
          payoutMode: pickemPayoutMode,
          pickMode,
          pointsPerPick,
          ...(Object.keys(primetimeBonus).length > 0 ? { primetimeBonus } : {})
        };
      } else if (poolType === 'NFL_SURVIVOR') {
        settings = {
          ...settings,
          maxStrikes,
          maxRebuys,
          rebuyDeadlineWeek,
          rebuyCost,
          pickLosersMode,
          autoSurviveExemptionEnabled
        };
      } else if (poolType === 'NFL_MARGIN') {
        settings = {
          ...settings,
          payoutMode: marginPayoutMode
        };
      }

      const poolData = {
        type: poolType,
        league: 'NFL',
        name,
        season,
        seasonType,
        settings,
        managerName: user.name || '',
        contactEmail: user.email || '',
        contactPhone: user.phone || '',
        contactMethod: 'email',
        branding: {
          logo: '',
          bgColor: '#0b1329', // dark navy themed for NFL
          primaryColor,
          secondaryColor: accentColor
        },
        billing: {
          status: 'trial',
          tier: estimatedPlayers <= (billingConfig?.freePlayerThreshold ?? 10) ? 'free_tier' : 'premium_tier',
          pricePaid: 0,
          maxPlayersAllowed: estimatedPlayers <= (billingConfig?.freePlayerThreshold ?? 10) ? (billingConfig?.freePlayerThreshold ?? 10) : estimatedPlayers,
          trialEndsAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
          featuresUnlocked: {
            whatIfSimulator: false,
            customBranding: hasCustomBranding,
            aiCommissioner: hasAiCommissioner
          },
          couponCode: couponCode || undefined
        }
      };

      logger.log(`[NFLPoolWizard] Launching NFL pool:`, poolData);
      const poolId = await dbService.createNFLPool(poolData);

      // Proactively import schedule for that season & preseason type
      // Our function creates the doc, backend job fetches schedule.

      if (cloneSourceName) {
        toast.success("Pool created! Open Share → Invite by email to bring back last season's members.");
      }
      navigate(`/pool/${poolId}`);
      onComplete();
    } catch (err: any) {
      logger.error('Failed to create NFL pool:', err);
      toast.error(getUserMessage(err, 'Failed to create pool. Please try again.'));
      setIsCreating(false);
    }
  };

  const isSuperAdminUser = user.role === 'SUPER_ADMIN';

  return (
    <div className="flex-grow bg-slate-950 text-slate-100 flex flex-col items-center py-10 px-4">
      <div className="max-w-3xl w-full">
        <button onClick={onCancel} className="flex items-center gap-2 text-slate-500 hover:text-white mb-6 transition-colors font-bold text-sm">
          <ArrowLeft size={16} /> Cancel & Back
        </button>

        {/* Re-run banner: wizard was seeded from a previous season's pool */}
        {cloneSourceName && (
          <div className="mb-6 bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-indigo-200 font-semibold leading-relaxed">
            <Sparkles size={14} className="text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Re-running &ldquo;{cloneSourceName}&rdquo; &mdash; settings copied, review and launch. You can invite last season&rsquo;s members from the share menu after creating.
            </span>
          </div>
        )}

        {/* Dynamic header title depending on selection */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
              const s = i + 1;
              return (
                <div
                  key={s}
                  className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                    step >= s
                      ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]'
                      : 'bg-slate-800'
                  }`}
                ></div>
              );
            })}
          </div>
          <div className="flex justify-between items-end">
            <div>
              <span className="text-blue-500 font-extrabold uppercase text-xs tracking-widest block mb-1">
                NFL Setup Wizard
              </span>
              <h1 className="text-3xl font-black text-white drop-shadow-md">
                {step === 1 && 'Basic Configurations'}
                {step === 2 && 'Custom Pool Rules'}
                {step === 3 && 'Payment Settings'}
                {step === 4 && 'Aesthetic Customization'}
                {step === 5 && 'Verify & Launch'}
              </h1>
            </div>
            <span className="text-slate-500 font-bold font-mono text-sm">Step {step} of {TOTAL_STEPS}</span>
          </div>
        </div>

        {/* Wizard Form Sections */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 md:p-8 min-h-[380px] shadow-2xl backdrop-blur-sm">
          {/* STEP 1: BASICS */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">Pool Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Gridiron Gang Weekly Pick'em"
                  className={`w-full bg-slate-950 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                    errors.name ? 'border-red-500 focus:ring-red-500' : 'border-slate-800'
                  }`}
                />
                {errors.name && <p className="text-red-500 text-xs font-bold mt-1.5">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-300 mb-2">NFL Season</label>
                  <select
                    value={season}
                    onChange={e => setSeason(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value="2026">2026 Season</option>
                    <option value="2027">2027 Season</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-300 mb-2">Entry Fee ($)</label>
                  <input
                    type="number"
                    value={entryFee}
                    onChange={e => setEntryFee(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  {errors.entryFee && <p className="text-red-500 text-xs font-bold mt-1.5">{errors.entryFee}</p>}
                </div>
              </div>

              {isSuperAdminUser && (
                <div className="bg-slate-950/80 border border-indigo-900/50 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Sparkles className="text-indigo-400" size={24} />
                    <div>
                      <h4 className="text-sm font-bold text-white">Pre-Season Test Mode</h4>
                      <p className="text-xs text-slate-400">Treats preseason games as active. Perfect for simulated audits.</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={seasonType === 1}
                    onChange={e => setSeasonType(e.target.checked ? 1 : 2)}
                    className="w-5 h-5 rounded border-slate-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          {/* STEP 2: RULES */}
          {step === 2 && (
            <div className="space-y-6">
              {/* PICK'EM RULES */}
              {poolType === 'NFL_PICKEM' && (
                <>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">Confidence Mode</h4>
                      <p className="text-xs text-slate-400">Players rank games 1 to N (N = games in week). Highest gets most points.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={confidenceMode}
                      onChange={e => setConfidenceMode(e.target.checked)}
                      className="w-5 h-5 rounded border-slate-800 text-blue-500 focus:ring-blue-500 cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Pick Mode</label>
                      <select
                        value={pickMode}
                        onChange={e => setPickMode(e.target.value as 'STRAIGHT' | 'ATS')}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value="STRAIGHT">Straight Up</option>
                        <option value="ATS">Against the Spread (ATS)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Payout Method</label>
                      <select
                        value={pickemPayoutMode}
                        onChange={e => setPickemPayoutMode(e.target.value as 'SEASON' | 'WEEKLY' | 'HYBRID')}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value="SEASON">Season-End Standings Only</option>
                        <option value="WEEKLY">Weekly Winner Only</option>
                        <option value="HYBRID">Hybrid (Season-End + Weekly Prizes)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Lock Mode</label>
                      <select
                        value={pickemLockMode}
                        disabled={confidenceMode}
                        onChange={e => setPickemLockMode(e.target.value as 'PER_GAME' | 'WEEKLY')}
                        className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                          confidenceMode ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <option value="PER_GAME">Per-Game Lock (kickoff time)</option>
                        <option value="WEEKLY">Weekly Lock (first game kickoff)</option>
                      </select>
                      {confidenceMode && (
                        <p className="text-[10px] text-yellow-500 font-bold mt-1">
                          * Weekly lock forced in Confidence Mode
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Kickoff Lock Buffer</label>
                      <select
                        value={lockBufferMinutes}
                        onChange={e => setLockBufferMinutes(parseInt(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value="0">0 Mins (Exactly at kickoff)</option>
                        <option value="10">10 Mins Grace</option>
                      </select>
                    </div>
                  </div>

                  {/* ─── Scoring Configuration ─── */}
                  <div className="bg-slate-950/60 border border-blue-900/30 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-blue-400 text-xs font-black uppercase tracking-widest">🏆 Scoring Configuration</span>
                    </div>

                    {/* Base points per pick */}
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-1">Base Points Per Correct Pick</label>
                      <p className="text-xs text-slate-500 mb-2">Default is 1 pt. Set to 2 for a double-point pool, etc.</p>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          value={pointsPerPick}
                          min={1}
                          max={10}
                          onChange={e => setPointsPerPick(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-28 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                        <span className="text-slate-400 text-xs font-bold">point(s) per correct pick</span>
                      </div>
                    </div>

                    {/* Primetime bonus points */}
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-1">Primetime Game Bonus Points</label>
                      <p className="text-xs text-slate-500 mb-3">Add flat bonus points on top of the base score for correct primetime picks. Set 0 to disable.</p>
                      <div className="space-y-3">
                        {[
                          { label: '🌙 Thursday Night Game', value: thursdayBonus, setter: setThursdayBonus },
                          { label: '⭐ Sunday Night Game (SNF)', value: sundayNightBonus, setter: setSundayNightBonus },
                          { label: '🏈 Monday Night Game (MNF)', value: mondayBonus, setter: setMondayBonus },
                        ].map(({ label, value, setter }) => (
                          <div key={label} className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5">
                            <span className="text-slate-300 text-xs font-bold">{label}</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={value}
                                min={0}
                                max={10}
                                onChange={e => setter(Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                              />
                              <span className="text-slate-500 text-xs">{value > 0 ? `+${value} bonus pts` : 'disabled'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* SURVIVOR RULES */}
              {poolType === 'NFL_SURVIVOR' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Strikes Limit (Mulligans)</label>
                      <select
                        value={maxStrikes}
                        onChange={e => setMaxStrikes(parseInt(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value="0">0 Strikes (Sudden Death)</option>
                        <option value="1">1 Strike (Double Elimination)</option>
                        <option value="2">2 Strikes (Triple Elimination)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-2">Max Rebuys (Buy-backs)</label>
                      <select
                        value={maxRebuys}
                        onChange={e => setMaxRebuys(parseInt(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value="0">No Buy-backs Allowed</option>
                        <option value="1">1 Buy-back Limit</option>
                        <option value="2">2 Buy-backs Limit</option>
                        <option value="3">3 Buy-backs Limit</option>
                      </select>
                    </div>
                  </div>

                  {maxRebuys > 0 && (
                    <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
                      <div>
                        <label className="block text-xs font-extrabold text-slate-400 mb-1.5 uppercase">Rebuy Cutoff Week</label>
                        <input
                          type="number"
                          value={rebuyDeadlineWeek}
                          onChange={e => setRebuyDeadlineWeek(Math.max(1, Math.min(18, parseInt(e.target.value) || 1)))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                        {errors.rebuyDeadlineWeek && <p className="text-red-500 text-[10px] font-bold mt-1">{errors.rebuyDeadlineWeek}</p>}
                      </div>

                      <div>
                        <label className="block text-xs font-extrabold text-slate-400 mb-1.5 uppercase">Rebuy Fee ($)</label>
                        <input
                          type="number"
                          value={rebuyCost}
                          onChange={e => setRebuyCost(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                        {errors.rebuyCost && <p className="text-red-500 text-[10px] font-bold mt-1">{errors.rebuyCost}</p>}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-white">Pick-Loser Mode</h4>
                        <p className="text-xs text-slate-400">Inverts logic: Pick a team to LOSE. Survive if they lose or tie.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={pickLosersMode}
                        onChange={e => setPickLosersMode(e.target.checked)}
                        className="w-5 h-5 rounded border-slate-800 text-red-500 focus:ring-red-500 cursor-pointer"
                      />
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-white">Auto-Survive Exemption</h4>
                        <p className="text-xs text-slate-400">Survive automatically if all playing teams are either already used or on bye.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoSurviveExemptionEnabled}
                        onChange={e => setAutoSurviveExemptionEnabled(e.target.checked)}
                        className="w-5 h-5 rounded border-slate-800 text-green-500 focus:ring-green-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* MARGIN RULES */}
              {poolType === 'NFL_MARGIN' && (
                <>
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-2">Payout Method</label>
                    <select
                      value={marginPayoutMode}
                      onChange={e => setMarginPayoutMode(e.target.value as 'SEASON' | 'WEEKLY' | 'HYBRID')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      <option value="SEASON">Season-End Margin Totals Only</option>
                      <option value="WEEKLY">Weekly Highest Margin Wins</option>
                      <option value="HYBRID">Hybrid (Season-End + Weekly Winners)</option>
                    </select>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-yellow-500">
                      <ShieldAlert size={18} />
                      <span className="text-xs font-bold uppercase tracking-wider">Strict Tiebreaker Cascade</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Margin pools use a strict 5-level sort cascade to rank players:
                    </p>
                    <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside pl-1 font-bold">
                      <li>Highest Total Season Points</li>
                      <li>Lowest Seasonal "Negative Burden" (sum of abs(losing margins))</li>
                      <li>Most Positive Weeks (weeks scored &gt; 0)</li>
                      <li>Highest Single-Week Score</li>
                      <li>Deterministic Coin Flip</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: PAYMENTS */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="p-4 bg-gradient-to-r from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 rounded-2xl flex gap-3 items-start shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <div className="text-xl">🚀</div>
                <div>
                  <strong className="text-white block mb-1 text-sm">100% Free Trial Setup</strong>
                  <p className="text-emerald-200/80 text-xs leading-relaxed">
                    Set up rules, invite participants, and run your pool completely free for 14 days! Pay only when you are ready to upgrade.
                  </p>
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex gap-4 items-center">
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
                  <Coins size={28} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Payment Reminders</h4>
                  <p className="text-xs text-slate-400">Managers can mark participants as Paid. Auto-email payment reminders are enabled by default.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">Payment Instructions / Venmo Handle</label>
                <textarea
                  value={paymentInstructions}
                  onChange={e => setPaymentInstructions(e.target.value)}
                  placeholder="e.g. Venmo @my-venmo-username. Please mention pool name in Venmo comment."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm resize-none"
                />
              </div>

              {/* 🏆 Estimated Participants & Season Tiers Table */}
              <div className="bg-slate-950/60 border border-slate-850 rounded-2xl p-5 space-y-4 shadow-inner">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="text-blue-400" size={16} /> Estimated Participants
                    </h4>
                    <p className="text-xs text-slate-400">Select how many players you expect to join. Base cost updates dynamically!</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={estimatedPlayers}
                      min={1}
                      max={9999}
                      onChange={e => setEstimatedPlayers(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-center font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <span className="text-xs text-slate-500 font-bold">Players</span>
                  </div>
                </div>

                <input
                  type="range"
                  min={1}
                  max={150}
                  value={estimatedPlayers > 150 ? 150 : estimatedPlayers}
                  onChange={e => setEstimatedPlayers(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />

                {/* Tier Guide Table */}
                <div className="border-t border-slate-850 pt-4 mt-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">
                    Season Pricing Tiers Guide
                  </span>
                  <div className="flex flex-wrap gap-2 text-center text-[10px] justify-center">
                    {/* Free Tier */}
                    <div
                      className={`rounded-xl p-2.5 border transition-all flex-1 min-w-[70px] ${
                        estimatedPlayers <= (billingConfig?.freePlayerThreshold ?? 10)
                          ? 'bg-blue-500/10 border-blue-500 text-white font-extrabold shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                          : 'bg-slate-900/40 border-slate-850 text-slate-400'
                      }`}
                    >
                      <div className="font-bold mb-0.5">1–{billingConfig?.freePlayerThreshold ?? 10}</div>
                      <div className={`font-mono ${estimatedPlayers <= (billingConfig?.freePlayerThreshold ?? 10) ? 'text-blue-400' : 'text-slate-300'}`}>FREE</div>
                    </div>

                    {/* Dynamic Pricing Tiers */}
                    {(billingConfig?.pricing?.season || [
                      { min: 11, max: 25, price: 29 },
                      { min: 26, max: 50, price: 59 },
                      { min: 51, max: 100, price: 99 },
                      { min: 101, max: 9999, price: 149 }
                    ]).map((t, idx) => {
                      const isActive = estimatedPlayers >= t.min && estimatedPlayers <= t.max;
                      const rangeLabel = t.max >= 9999 ? `${t.min}+` : `${t.min}–${t.max}`;
                      return (
                        <div
                          key={idx}
                          className={`rounded-xl p-2.5 border transition-all flex-1 min-w-[70px] ${
                            isActive
                              ? 'bg-blue-500/10 border-blue-500 text-white font-extrabold shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                              : 'bg-slate-900/40 border-slate-850 text-slate-400'
                          }`}
                        >
                          <div className="font-bold mb-0.5">{rangeLabel}</div>
                          <div className={`font-mono ${isActive ? 'text-blue-400' : 'text-slate-300'}`}>${t.price}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs rounded-xl flex gap-2 items-start animate-in fade-in duration-300">
                <Sparkles size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white block mb-0.5">💡 Start Small, Upgrade Later!</strong>
                  Not sure how many players will join? Choose a lower estimate to minimize upfront costs. You can instantly upgrade with one click later for only the pro-rated difference!
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">List Pool Publicly</h4>
                  <p className="text-xs text-slate-400">Allow other platform users to find and request to join this pool via public browser.</p>
                </div>
                <input
                  type="checkbox"
                  checked={isListedPublic}
                  onChange={e => setIsListedPublic(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-800 text-blue-500 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* STEP 4: BRANDING */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex gap-4 items-center">
                <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
                  <Palette size={28} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Pool Custom Branding</h4>
                  <p className="text-xs text-slate-400">Personalise the look and feel of your dashboard. Choose your primary and accent themes.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-300 mb-2">Primary Color (Background)</label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      className="w-10 h-10 border border-slate-800 rounded cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-300 mb-2">Accent Theme Color</label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="w-10 h-10 border border-slate-800 rounded cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-300 mb-3">NFL Theme Presets</label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => { setPrimaryColor('#0b1329'); setAccentColor('#6366f1'); }}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-500 text-xs font-bold transition-all"
                  >
                    🏈 Dark Navy & Indigo
                  </button>
                  <button
                    onClick={() => { setPrimaryColor('#1c0c0c'); setAccentColor('#e11d48'); }}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-500 text-xs font-bold transition-all"
                  >
                    🔥 Dark Crimson & Rose
                  </button>
                  <button
                    onClick={() => { setPrimaryColor('#061c14'); setAccentColor('#10b981'); }}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-500 text-xs font-bold transition-all"
                  >
                    🌲 Forest Green & Emerald
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                <h3 className="text-xl font-bold text-white border-b border-slate-800 pb-2">
                  Pool Setup Summary
                </h3>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <span className="text-slate-500 font-bold">Pool Name:</span>
                  <span className="text-white font-extrabold">{name}</span>

                  <span className="text-slate-500 font-bold">Pool Type:</span>
                  <span className="text-blue-400 font-extrabold">
                    {poolType === 'NFL_PICKEM' ? "NFL Weekly Pick'em" :
                     poolType === 'NFL_SURVIVOR' ? "NFL Survivor Pool" : "NFL Margin Pool"}
                  </span>

                  <span className="text-slate-500 font-bold">NFL Season:</span>
                  <span className="text-white font-bold">{season} ({seasonType === 1 ? 'Preseason' : 'Regular Season'})</span>

                  <span className="text-slate-500 font-bold">Entry Fee:</span>
                  <span className="text-emerald-400 font-extrabold">${entryFee}</span>

                  {poolType === 'NFL_PICKEM' && (
                    <>
                      <span className="text-slate-500 font-bold">Confidence Mode:</span>
                      <span className="text-white font-bold">{confidenceMode ? 'Enabled' : 'Disabled'}</span>

                      <span className="text-slate-500 font-bold">Lock Mode:</span>
                      <span className="text-white font-bold">{pickemLockMode}</span>

                      <span className="text-slate-500 font-bold">Points Per Pick:</span>
                      <span className="text-emerald-400 font-extrabold">{pointsPerPick} pt{pointsPerPick !== 1 ? 's' : ''}</span>

                      {(thursdayBonus > 0 || sundayNightBonus > 0 || mondayBonus > 0) && (
                        <>
                          <span className="text-slate-500 font-bold">Primetime Bonuses:</span>
                          <span className="text-amber-400 font-bold text-xs">
                            {[thursdayBonus > 0 && `TNF +${thursdayBonus}`, sundayNightBonus > 0 && `SNF +${sundayNightBonus}`, mondayBonus > 0 && `MNF +${mondayBonus}`].filter(Boolean).join(' · ')}
                          </span>
                        </>
                      )}
                    </>
                  )}

                  {poolType === 'NFL_SURVIVOR' && (
                    <>
                      <span className="text-slate-500 font-bold">Max strikes limit:</span>
                      <span className="text-white font-bold">{maxStrikes} (mulligans)</span>

                      <span className="text-slate-500 font-bold">Max rebuys limit:</span>
                      <span className="text-white font-bold">{maxRebuys > 0 ? `${maxRebuys} rebuys allowed` : 'None'}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 font-sans text-left">
                <BillingInvoiceCard
                  poolName={name || 'New Pool'}
                  poolType="season"
                  estimatedPlayers={estimatedPlayers}
                  hasCustomBranding={hasCustomBranding}
                  hasAiCommissioner={hasAiCommissioner}
                  isWizard={true}
                  onTosAcceptChange={setTosAccepted}
                  onCouponAppliedChange={(couponCode) => setCouponCode(couponCode)}
                  initialCouponCode={couponCode || ''}
                  onFeatureToggle={(featureKey, enabled) => {
                    if (featureKey === 'customBranding') setHasCustomBranding(enabled);
                    if (featureKey === 'aiCommissioner') setHasAiCommissioner(enabled);
                  }}
                />

                <div className="mt-4 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex gap-3 items-start animate-in fade-in duration-300 text-slate-400 text-xs">
                  <ShieldCheck className="text-indigo-400 shrink-0 mt-0.5" size={20} />
                  <div>
                    <strong className="text-white block mb-0.5">🚀 100% Free Trial Setup</strong>
                    Set up rules, invite participants, and run your pool completely free for 14 days! Pay only when you are ready to upgrade.
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500 text-center leading-relaxed">
                By launching, this pool will immediately be initialized. A shareable invite link will be generated for your participants.
              </p>
            </div>
          )}
        </div>

        {/* Wizard Navigation Footer */}
        <div className="flex justify-between items-center pt-8 border-t border-slate-800 mt-8">
          <button
            onClick={handleBack}
            disabled={step === 1}
            className={`text-slate-400 hover:text-white font-bold text-sm flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-900 transition-colors ${
              step === 1 ? 'opacity-0 pointer-events-none' : ''
            }`}
          >
            <ChevronLeft size={16} /> Back
          </button>

          {step < TOTAL_STEPS ? (
            <button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all hover:scale-105"
            >
              Next Step <ChevronRight size={20} strokeWidth={3} />
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              disabled={isCreating || !tosAccepted}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100"
            >
              {isCreating ? 'Launching Pool...' : (
                <>
                  Launch Pool <Check size={20} strokeWidth={3} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
