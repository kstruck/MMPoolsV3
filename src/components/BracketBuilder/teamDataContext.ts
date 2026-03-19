import { createContext } from 'react';
import type { Team } from '../../types';

/**
 * Provides a map of teamId → Team (including seed) to bracket components.
 * Populated from tournament.importedTeams at the top-level bracket renderer.
 */
export const TeamDataContext = createContext<Record<string, Team>>({});
