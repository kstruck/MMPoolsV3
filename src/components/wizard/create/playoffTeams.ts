import type { PlayoffTeam } from '../../../types';

// Placeholder playoff field seeded at pool creation (same set the legacy
// PlayoffWizard injected). Real teams/results are synced later by game ops.
export const PLAYOFF_PLACEHOLDER_TEAMS: PlayoffTeam[] = [
  { id: 'KC', name: 'Kansas City Chiefs', conference: 'AFC', seed: 1, eliminated: false },
  { id: 'BUF', name: 'Buffalo Bills', conference: 'AFC', seed: 2, eliminated: false },
  { id: 'BAL', name: 'Baltimore Ravens', conference: 'AFC', seed: 3, eliminated: false },
  { id: 'HOU', name: 'Houston Texans', conference: 'AFC', seed: 4, eliminated: false },
  { id: 'CLE', name: 'Cleveland Browns', conference: 'AFC', seed: 5, eliminated: false },
  { id: 'MIA', name: 'Miami Dolphins', conference: 'AFC', seed: 6, eliminated: false },
  { id: 'PIT', name: 'Pittsburgh Steelers', conference: 'AFC', seed: 7, eliminated: false },
  { id: 'SF', name: 'San Francisco 49ers', conference: 'NFC', seed: 1, eliminated: false },
  { id: 'DAL', name: 'Dallas Cowboys', conference: 'NFC', seed: 2, eliminated: false },
  { id: 'DET', name: 'Detroit Lions', conference: 'NFC', seed: 3, eliminated: false },
  { id: 'TB', name: 'Tampa Bay Buccaneers', conference: 'NFC', seed: 4, eliminated: false },
  { id: 'PHI', name: 'Philadelphia Eagles', conference: 'NFC', seed: 5, eliminated: false },
  { id: 'LAR', name: 'Los Angeles Rams', conference: 'NFC', seed: 6, eliminated: false },
  { id: 'GB', name: 'Green Bay Packers', conference: 'NFC', seed: 7, eliminated: false },
];
