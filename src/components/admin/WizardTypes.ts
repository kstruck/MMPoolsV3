import type { GameState, Scores, PoolTheme } from '../../types';

/**
 * Props shared by all wizard step components.
 * This interface defines the common context available to each step.
 */
export interface WizardStepProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    updateScores: (scores: Partial<Scores>) => void;
    checkSlugAvailable: (slug: string) => boolean;
    checkNameAvailable: (name: string) => boolean;
}

/**
 * Extended props for steps that need schedule/game selection
 */
export interface WizardStep1Props extends WizardStepProps {
    showSchedule: boolean;
    setShowSchedule: (show: boolean) => void;
    scheduleGames: any[];
    isLoadingSchedule: boolean;
    fetchSchedule: () => void;
    selectGame: (game: any) => void;
    seasonType: string;
    setSeasonType: (type: string) => void;
    week: string;
    setWeek: (week: string) => void;
    cfbConference: string;
    setCfbConference: (conf: string) => void;
    CFB_CONFERENCES: { id: string; name: string }[];
    currentEstimatedWeek: number;
}

/**
 * Props for Step 2 (Basic Info)
 */
export interface WizardStep2Props extends WizardStepProps {
    slugError: string | null;
    setSlugError: (error: string | null) => void;
}

/**
 * Props for Step 4 (Payouts)
 */
export interface WizardStep4Props extends WizardStepProps {
    totalPayout: number;
}

/**
 * Props for Step 5 (Preferences/Theme Selection)
 */
export interface WizardStep5Props extends WizardStepProps {
    availableThemes: PoolTheme[];
}

/**
 * Props for Step 7 (Theme/Branding)
 */
export interface WizardStep7Props extends WizardStepProps {
    handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Props for Reminders step
 */
export interface WizardRemindersProps extends WizardStepProps { }
