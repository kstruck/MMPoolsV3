import type { GameState } from '../types';

/**
 * Returns the appropriate pool type display name based on the game context.
 * 
 * NFL:
 *   - Regular Season (seasonType 2) → "Game Day Squares"
 *   - Playoffs Wild Card/Divisional (seasonType 3, week 1-2) → "Playoff Game Day Squares"
 *   - Conference Championship (seasonType 3, week 3) → "Conference Championship Squares"
 *   - Super Bowl (seasonType 3, week 5) → "Super Bowl Squares"
 * 
 * College:
 *   - Regular Season → "Game Day Squares"
 *   - Playoffs (not championship) → "NCAA Playoff Squares"
 *   - National Championship → "NCAA Championship Squares"
 */
export function getPoolTypeName(pool: GameState): string {
    const league = pool.league || 'nfl';
    const seasonType = pool.seasonType || '2'; // Default to regular season
    const week = pool.week || 1;

    // Regular season or preseason → Game Day Squares
    if (seasonType === '1' || seasonType === '2') {
        return 'Game Day Squares';
    }

    // Postseason (seasonType === '3')
    if (league === 'nfl') {
        switch (week) {
            case 1: // Wild Card
            case 2: // Divisional
                return 'Playoff Game Day Squares';
            case 3: // Conference Championship
                return 'Conference Championship Squares';
            case 4: // Pro Bowl (rarely used for squares)
                return 'Pro Bowl Squares';
            case 5: // Super Bowl
                return 'Super Bowl Squares';
            default:
                return 'Playoff Game Day Squares';
        }
    }

    // College (NCAA)
    if (league === 'college' || league === 'ncaa') {
        // Week 1-4 are bowl games / CFP semifinals, Week 5+ is National Championship
        // This is a simplification - CFP structure varies year to year
        if (week >= 4) {
            return 'NCAA Championship Squares';
        }
        return 'NCAA Playoff Squares';
    }

    // Fallback
    return 'Game Day Squares';
}

/**
 * Short version for tight UI spaces
 */
export function getPoolTypeNameShort(pool: GameState): string {
    const full = getPoolTypeName(pool);
    if (full === 'Conference Championship Squares') return 'Conf. Championship';
    if (full === 'NCAA Championship Squares') return 'NCAA Championship';
    return full.replace(' Squares', '');
}
