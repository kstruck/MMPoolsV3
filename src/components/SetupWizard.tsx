import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, ChevronLeft } from 'lucide-react';
import { dbService } from '../services/dbService';
import { logger } from '../utils/logger';

import type { GameState, PoolTheme } from "../types";
import type { User } from '../types';
import type { ESPNGame, ESPNCompetitor } from '../types/espn';

// Import all shared wizard steps
import {
    WizardStepMatchup,
    WizardStepBasics,
    WizardStepRules,
    WizardStepPayouts,
    WizardStepSideHustle,
    WizardStepBrandingAdmin,
    WizardStepReminders,
    WizardStepFinish,
    WizardStepSummary
} from './admin';

interface SetupWizardProps {
    user: User;
    onComplete: () => void;
    onBack: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ user, onComplete, onBack }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const TOTAL_STEPS = 9;
    logger.log('[SetupWizard] Initialized - Version 1.1 (9 Steps, New Defaults)');
    const [isCreating, setIsCreating] = useState(false);
    const [tosAccepted, setTosAccepted] = useState(false);

    // Initial Draft State
    const [gameState, setGameState] = useState<Partial<GameState>>({
        name: 'New Pool',
        ownerId: user.id,
        type: 'SQUARES',
        managerName: user.name || '',
        contactEmail: user.email || '',
        costPerSquare: 10,
        maxSquaresPerPlayer: 100, // Default unlimited
        showPaid: true, // Default to showing paid status
        payouts: { q1: 10, half: 20, q3: 10, final: 60 },
        ruleVariations: {
            quarterlyRollover: true, // Default to rollover winnings
            reverseWinners: false,
            scoreChangePayout: false,
            unclaimedFinalPrizeStrategy: 'last_winner',
        },
        includeOvertime: true, // Default to include OT in final score
        emailNumbersGenerated: true, // Default to email players when numbers set
        notifyAdminFull: true, // Default to alert admin when grid full
        charity: { enabled: false, name: '', percentage: 0 },
        branding: { backgroundColor: '#0f172a' }, // Default slate-900
        emailConfirmation: 'Email Confirmation',
        paymentHandles: {
            venmo: user.paymentHandles?.venmo || '',
            zelle: user.paymentHandles?.zelle || '',
        },
        paymentInstructions: '',
        waitlist: [],
        reminders: {
            payment: { enabled: true, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: true },
            lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: undefined },
            winner: { enabled: true, channels: ['email'], includeDigits: true, includeCharityImpact: true }
        },
        props: {
            enabled: false,
            cost: 10,
            maxCards: 1,
            payouts: [100],
            questions: []
        }
    });

    // Schedule State (for Step 1) - Defaults to Postseason Divisional Round

    // Schedule State (for Step 1) - Defaults to Postseason Divisional Round
    const [seasonType, setSeasonType] = useState('3');
    const [week, setWeek] = useState('2');
    const [scheduleGames, setScheduleGames] = useState<ESPNGame[]>([]);
    const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
    const [showSchedule, setShowSchedule] = useState(false);
    const [cfbConference, setCfbConference] = useState('80');

    // Theme State (for Step 6)
    const [availableThemes, setAvailableThemes] = useState<PoolTheme[]>([]);

    useEffect(() => {
        const fetchThemes = async () => {
            const themes = await dbService.getActiveThemes();
            if (themes && themes.length > 0) {
                setAvailableThemes(themes as PoolTheme[]);
            } else {
                // Fallback to presets
                const { PRESET_THEMES } = await import('../constants/presetThemes');
                setAvailableThemes(PRESET_THEMES as unknown as PoolTheme[]);
            }
        };
        fetchThemes();
    }, []);

    // Estimated Week Logic
    const getEstimatedWeek = () => {
        const now = new Date();
        let year = now.getFullYear();
        if (now.getMonth() < 6) year--;
        const seasonStart = new Date(year, 8, 5);
        const diff = now.getTime() - seasonStart.getTime();
        if (diff < 0) return 1;
        const weekNum = Math.ceil(diff / (1000 * 60 * 60 * 24 * 7));
        return Math.max(1, weekNum);
    };
    const currentEstimatedWeek = getEstimatedWeek();


    const updateConfig = (updates: Partial<GameState>) => {
        setGameState(prev => ({ ...prev, ...updates }));
    };

    // --- Handlers for Step 1 Copy ---
    const fetchSchedule = async () => {
        setIsLoadingSchedule(true);
        setScheduleGames([]);
        setShowSchedule(true);
        try {
            const leaguePath = gameState.league === 'college' || gameState.league === 'ncaa' ? 'college-football' : 'nfl';
            let url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?seasontype=${seasonType}&week=${week}`;
            if (leaguePath === 'college-football') {
                url += `&groups=${cfbConference}`;
                url += `&limit=100`;
            }
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch schedule');
            const data = await response.json() as { events?: ESPNGame[] };
            const events = data.events || [];
            // Filter for future games only
            const now = new Date();
            const upcoming = events.filter((e: ESPNGame) => {
                const gameDate = new Date(e.date);
                return gameDate > now;
            });

            setScheduleGames(upcoming);
        } catch (e) {
            logger.error(e);
            setShowSchedule(false);
        }
        setIsLoadingSchedule(false);
    };



    const selectGame = (game: ESPNGame) => {
        const comp = game.competitions[0];
        const home = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'home')?.team;
        const away = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'away')?.team;
        const gameDate = new Date(game.date);

        // Auto-Name Logic
        const candidateName = `${away?.displayName || 'Away'} @ ${home?.displayName || 'Home'}`;
        // Basic check - uniqueness handled by server/db usually, or we just let it be duplicate name
        // ... omitted sophisticated unique check for wizard ...

        updateConfig({
            name: candidateName,
            homeTeam: home?.displayName || 'Home',
            awayTeam: away?.displayName || 'Away',
            gameId: game.id,
            homeTeamLogo: home?.logo,
            awayTeamLogo: away?.logo,
            seasonType: seasonType as '1' | '2' | '3',
            week: parseInt(week),
            gameTime: gameDate.getTime(), // Added gameTime
            reminders: {
                ...(gameState.reminders || {
                    payment: { enabled: true, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: true },
                    lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: undefined },
                    winner: { enabled: true, channels: ['email'], includeDigits: true, includeCharityImpact: true }
                }),
                lock: {
                    ...(gameState.reminders?.lock || { enabled: true, scheduleMinutes: [60, 30, 15] }),
                    lockAt: gameDate.getTime() - (15 * 60 * 1000)
                }
            },
            scores: {
                ...(gameState.scores || {
                    current: null,
                    q1: null,
                    half: null,
                    q3: null,
                    final: null,
                    gameStatus: 'pre',
                    clock: '',
                    period: 0
                }),
                startTime: game.date
            }
        });

        setShowSchedule(false);
    };

    // --- Handlers for Branding ---
    const handleThemeSelect = async (theme: PoolTheme) => {
        if (!theme.id) {
            // It's a preset, likely need to save it if used? 
            // Actually for wizard we can just set the themeId if we had it, or just use the colors directly?
            // The AdminPanel saves it. SetupWizard should probably just use the ID if available, or update local config colors.
            // But GameState only stores themeId usually. 
            // If it's a new pool, we might want to just set themeId if it exists in DB.
            // For presets that are not in DB, we'd need to save them.
            // Simpler approach for SetupWizard: Just set themeId if it has one.
        }
        if (theme.id) {
            updateConfig({ themeId: theme.id });
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            alert("Logo file is too large! Max size is 2MB.");
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            updateConfig({ branding: { ...(gameState.branding || {}), logoUrl: base64 } });
        };
        reader.readAsDataURL(file);
    };

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            // Create the pool
            const newPool = {
                ...gameState,
                ownerId: user.id, // Ensure owner
                members: [user.id],
                createdAt: Date.now(),
                squares: Array(100).fill(null).map((_, i) => ({ id: i, owner: null })),
                scores: { ...gameState.scores, q1: {}, half: {}, q3: {}, final: {}, current: { home: 0, away: 0 } }, // Init scores
                billing: {
                    status: 'trial',
                    tier: 'free_tier',
                    pricePaid: 0,
                    maxPlayersAllowed: 10,
                    trialEndsAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
                    featuresUnlocked: {
                        aiCommissioner: false,
                        smsNotifications: false,
                        whatIfSimulator: false,
                        customBranding: true
                    },
                    ...(gameState as any).billing
                }
            };

            const poolId = await dbService.createPool(newPool as unknown as Record<string, unknown>);
            navigate(`/pool/${poolId}`);
            onComplete();
        } catch (error) {
            logger.error("Failed to create pool", error);
            alert("Failed to create pool. Please try again.");
            setIsCreating(false);
        }
    };

    const totalPayout = (gameState.payouts?.q1 || 0) + (gameState.payouts?.half || 0) + (gameState.payouts?.q3 || 0) + (gameState.payouts?.final || 0);


    return (
        <div className="flex-grow bg-slate-950 text-slate-100 flex flex-col items-center py-10 px-4">
            <div className="max-w-4xl w-full">
                <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-white mb-6 transition-colors font-bold text-sm">
                    <ArrowLeft size={16} /> Back to Selection
                </button>

                {/* Progress Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                            const s = i + 1;
                            return (
                                <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${step >= s ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-slate-800'}`}></div>
                            );
                        })}
                    </div>
                    <div className="flex justify-between items-end">
                        <h1 className="text-3xl font-bold text-white transition-all drop-shadow-lg">
                            {step === 1 && 'The Matchup'}
                            {step === 2 && 'Pool Basics'}
                            {step === 3 && 'Grid Rules'}
                            {step === 4 && 'Payouts'}
                            {step === 5 && 'Side Hustle'}
                            {step === 6 && 'Branding'}
                            {step === 7 && 'Reminders'}
                            {step === 8 && 'Summary'}
                            {step === 9 && 'Final Review'}
                        </h1>
                        <span className="text-slate-500 font-bold font-mono">Step {step} of {TOTAL_STEPS}</span>
                    </div>
                </div>

                {/* Content Area */}
                <div className="min-h-[400px]">
                    {step === 1 && (
                        <WizardStepMatchup
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                            seasonType={seasonType}
                            setSeasonType={setSeasonType}
                            week={week}
                            setWeek={setWeek}
                            scheduleGames={scheduleGames}
                            isLoadingSchedule={isLoadingSchedule}
                            showSchedule={showSchedule}
                            setShowSchedule={setShowSchedule}
                            fetchSchedule={fetchSchedule}
                            selectGame={selectGame}
                            currentEstimatedWeek={currentEstimatedWeek}
                            cfbConference={cfbConference}
                            setCfbConference={setCfbConference}
                        />
                    )}

                    {step === 2 && (
                        <WizardStepBasics
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                        // checkSlugAvailable omitted for SetupWizard (handled by server on create)
                        />
                    )}

                    {step === 3 && (
                        <WizardStepRules
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                        />
                    )}

                    {step === 4 && (
                        <WizardStepPayouts
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                            totalPayout={totalPayout}
                        />
                    )}

                    {step === 5 && (
                        <WizardStepSideHustle
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                        />
                    )}

                    {step === 6 && (
                        <WizardStepBrandingAdmin
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                            availableThemes={availableThemes}
                            handleThemeSelect={handleThemeSelect}
                            handleLogoUpload={handleLogoUpload}
                        />
                    )}

                    {step === 7 && (
                        <WizardStepReminders
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                        />
                    )}

                    {step === 8 && (
                        <WizardStepSummary
                            gameState={gameState as GameState}
                            onEditStep={(s) => setStep(s)}
                            onTosAcceptChange={(val) => setTosAccepted(val)}
                            onCouponAppliedChange={(couponCode) => {
                                updateConfig({
                                    billing: {
                                        ...((gameState as any).billing || {}),
                                        couponCode: couponCode || undefined
                                    } as any
                                });
                            }}
                            updateConfig={updateConfig as any}
                        />
                    )}

                    {step === 9 && (
                        <WizardStepFinish
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                            setupMode={true}
                            currentUser={user}
                        />
                    )}
                </div>

                {/* Footer Navigation */}
                <div className="flex justify-between items-center pt-8 border-t border-slate-800 mt-8">
                    <button
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1}
                        className={`text-slate-400 hover:text-white font-bold text-sm flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-900 transition-colors ${step === 1 ? 'opacity-0 pointer-events-none' : ''}`}
                    >
                        <ChevronLeft size={16} /> Back
                    </button>

                    {step < TOTAL_STEPS ? (
                        <button
                            onClick={() => setStep(s => Math.min(TOTAL_STEPS, s + 1))}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition-all hover:scale-105"
                        >
                            Next Step <ChevronRight size={20} strokeWidth={3} />
                        </button>
                    ) : (
                        <button
                            onClick={handleCreate}
                            disabled={isCreating || !tosAccepted}
                            className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100"
                        >
                            {isCreating ? 'Creating Pool...' : <>Launch Pool <Check size={20} strokeWidth={3} /></>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
