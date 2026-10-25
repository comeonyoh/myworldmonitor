export interface SportsLeague {
  id: string;
  name: string;
  sport: 'Soccer' | 'Baseball' | 'Basketball' | 'Ice Hockey';
}

// Fixed product allowlist. IDs are TheSportsDB's stable league identifiers.
export const SPORTS_LEAGUES: readonly SportsLeague[] = [
  { id: '4328', name: 'English Premier League', sport: 'Soccer' },
  { id: '4335', name: 'Spanish La Liga', sport: 'Soccer' },
  { id: '4331', name: 'German Bundesliga', sport: 'Soccer' },
  { id: '4332', name: 'Italian Serie A', sport: 'Soccer' },
  { id: '4334', name: 'French Ligue 1', sport: 'Soccer' },
  { id: '4480', name: 'UEFA Champions League', sport: 'Soccer' },
  { id: '4346', name: 'American Major League Soccer', sport: 'Soccer' },
  { id: '4350', name: 'Mexican Primera League', sport: 'Soccer' },
  { id: '4351', name: 'Brazilian Serie A', sport: 'Soccer' },
  { id: '4406', name: 'Argentinian Primera Division', sport: 'Soccer' },
  { id: '4633', name: 'Japanese J1 League', sport: 'Soccer' },
  { id: '4689', name: 'South Korean K League 1', sport: 'Soccer' },
  { id: '4668', name: 'Saudi-Arabian Pro League', sport: 'Soccer' },
  { id: '4356', name: 'Australian A-League', sport: 'Soccer' },
  { id: '4424', name: 'MLB', sport: 'Baseball' },
  { id: '4591', name: 'Nippon Baseball League', sport: 'Baseball' },
  { id: '4830', name: 'Korean KBO League', sport: 'Baseball' },
  { id: '4387', name: 'NBA', sport: 'Basketball' },
  { id: '4546', name: 'EuroLeague Basketball', sport: 'Basketball' },
  { id: '4380', name: 'NHL', sport: 'Ice Hockey' },
] as const;

export const SPORTS_LEAGUE_IDS = new Set(SPORTS_LEAGUES.map((league) => league.id));
