import { CITY_COORDS } from '../../../../api/data/city-coords';
import { CHROME_UA } from '../../../_shared/constants';
import { cachedFetchJson } from '../../../_shared/redis';
import { SPORTS_LEAGUE_IDS, SPORTS_LEAGUES, type SportsLeague } from './leagues';

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const DAY_CACHE_TTL_SECONDS = 120;
const SCHEDULE_CACHE_TTL_SECONDS = 600;
const FETCH_TIMEOUT_MS = 5_000;
const FETCH_CONCURRENCY = 6;
const MAX_EVENTS = 20;
const AGGREGATE_MEMORY_TTL_MS = 10 * 60 * 1000;

type RawRecord = Record<string, unknown>;

interface RawList {
  rows: RawRecord[];
}

export interface NormalizedSportsTeam {
  id: string;
  name: string;
  logoUrl: string;
}

export interface NormalizedSportsEvent {
  id: string;
  sport: string;
  leagueId: string;
  league: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
  startTime: string;
  homeTeam: NormalizedSportsTeam;
  awayTeam: NormalizedSportsTeam;
  homeScore?: number;
  awayScore?: number;
  period: string;
  clock: string;
  venue: string;
  city: string;
  country: string;
  latitude?: number;
  longitude?: number;
  coordinateAccuracy: string;
  updatedAt: string;
}

export interface LeagueFetchStatus {
  league: string;
  success: boolean;
  stale: boolean;
  error: string;
}

export interface SportsAggregate {
  events: NormalizedSportsEvent[];
  leagueStatuses: LeagueFetchStatus[];
  degraded: boolean;
  error: string;
}

let aggregateMemoryCache: { expiresAt: number; value: SportsAggregate } | null = null;
let aggregateInFlight: Promise<SportsAggregate> | null = null;

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function score(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function cityCoordinates(cityValue: string): { lat: number; lng: number; country: string } | null {
  const normalized = cityValue.toLowerCase().trim();
  if (!normalized) return null;

  const direct = CITY_COORDS[normalized];
  if (direct && !direct.virtual) return direct;

  const baseCity = normalized.split(',')[0]?.trim() ?? '';
  const withoutSuffix = CITY_COORDS[baseCity];
  if (withoutSuffix && !withoutSuffix.virtual) return withoutSuffix;

  if (normalized.length < 4) return null;
  for (const [candidate, coordinates] of Object.entries(CITY_COORDS)) {
    if (!coordinates.virtual && candidate.length >= 4
      && (normalized.includes(candidate) || candidate.includes(normalized))) {
      return coordinates;
    }
  }
  return null;
}

function normalizeIsoTimestamp(raw: RawRecord): string {
  const timestamp = text(raw.strTimestamp);
  if (timestamp) {
    const explicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
    const parsed = new Date(explicitZone ? timestamp : `${timestamp}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const date = text(raw.dateEvent);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const rawTime = text(raw.strEventTime) || text(raw.strTime) || '00:00:00';
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? `${rawTime}:00` : rawTime;
  const parsed = new Date(`${date}T${time}Z`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeUpdatedAt(raw: RawRecord, fallback: string): string {
  const updated = text(raw.updated) || text(raw.strUpdated);
  if (!updated) return fallback;
  const explicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(updated);
  const parsed = new Date(explicitZone ? updated : `${updated.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeStatus(
  raw: RawRecord,
  fallback: 'live' | 'scheduled' | 'final',
): NormalizedSportsEvent['status'] {
  const status = `${text(raw.strStatus)} ${text(raw.strProgress)}`.trim().toLowerCase();
  if (/(^|\s)(ft|aet|pen)(\s|$)|finished|final/.test(status)) return 'final';
  if (/(^|\s)(cancelled|canceled)(\s|$)|abandoned/.test(status)) return 'cancelled';
  if (/(^|\s)post(\s|$)|postpon/.test(status)) return 'postponed';
  if (/(^|\s)(ns|tbd)(\s|$)|not started|scheduled/.test(status)) return 'scheduled';
  if (/(^|\s)(q[1-4]|h[1-2]|in\d+|ot|live|ht)(\s|$)|in progress|period/.test(status)) return 'live';
  return fallback;
}

function rawCoordinates(raw: RawRecord): { latitude: number; longitude: number; accuracy: string } | null {
  const latitude = Number(raw.latitude ?? raw.lat ?? raw.strLatitude);
  const longitude = Number(raw.longitude ?? raw.lng ?? raw.lon ?? raw.strLongitude);
  if (validCoordinate(latitude, longitude)) return { latitude, longitude, accuracy: 'exact' };

  // Free v1 schedule rows frequently omit strCity. Stadium and home-team
  // names often contain the city (for example "Tokyo Dome" or
  // "Atlanta Braves"), so use those fields only against the existing,
  // curated city registry and mark every such match approximate.
  const locationHint = [
    text(raw.strCity),
    text(raw.strVenue),
    text(raw.strHomeTeam),
  ].filter(Boolean).join(', ');
  const approximate = cityCoordinates(locationHint);
  if (!approximate) return null;
  return { latitude: approximate.lat, longitude: approximate.lng, accuracy: 'approximate' };
}

/**
 * Normalize a TheSportsDB v1 event/schedule row.
 * Exported for focused adapter tests.
 */
export function normalizeSportsEvent(
  raw: RawRecord,
  fallbackStatus: 'live' | 'scheduled' | 'final' = 'scheduled',
  details?: RawRecord,
): NormalizedSportsEvent | null {
  // Detail lookups supply venue/city while livescore rows carry the freshest
  // score, clock, status, and badges. Apply the livescore row last.
  const combined = details ? { ...details, ...raw } : raw;
  const id = text(combined.idEvent) || text(combined.idLiveScore);
  const leagueId = text(combined.idLeague);
  const homeName = text(combined.strHomeTeam);
  const awayName = text(combined.strAwayTeam);
  const startTime = normalizeIsoTimestamp(combined);
  if (!id || !SPORTS_LEAGUE_IDS.has(leagueId) || !homeName || !awayName || !startTime) return null;

  const coordinates = rawCoordinates(combined);
  const queriedAt = new Date().toISOString();
  return {
    id,
    sport: text(combined.strSport),
    leagueId,
    league: text(combined.strLeague) || SPORTS_LEAGUES.find((league) => league.id === leagueId)?.name || '',
    status: normalizeStatus(combined, fallbackStatus),
    startTime,
    homeTeam: {
      id: text(combined.idHomeTeam),
      name: homeName,
      logoUrl: text(combined.strHomeTeamBadge),
    },
    awayTeam: {
      id: text(combined.idAwayTeam),
      name: awayName,
      logoUrl: text(combined.strAwayTeamBadge),
    },
    ...(score(combined.intHomeScore) !== undefined && { homeScore: score(combined.intHomeScore) }),
    ...(score(combined.intAwayScore) !== undefined && { awayScore: score(combined.intAwayScore) }),
    period: text(combined.strStatus),
    clock: text(combined.strProgress),
    venue: text(combined.strVenue),
    city: text(combined.strCity),
    country: text(combined.strCountry)
      || (coordinates?.accuracy === 'approximate'
        ? cityCoordinates(text(combined.strCity))?.country || ''
        : ''),
    ...(coordinates && {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    }),
    coordinateAccuracy: coordinates?.accuracy ?? '',
    updatedAt: normalizeUpdatedAt(combined, queriedAt),
  };
}

async function fetchV1(path: string): Promise<RawRecord> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TheSportsDB HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('TheSportsDB returned an invalid payload');
  }
  return payload as RawRecord;
}

function arrayFrom(payload: RawRecord, key: string): RawRecord[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is RawRecord => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

async function fetchDay(sport: SportsLeague['sport']): Promise<RawRecord[]> {
  const date = new Date().toISOString().slice(0, 10);
  const cached = await cachedFetchJson<RawList>(
    `sports:thesportsdb:day:${date}:${sport}:v1-free`,
    DAY_CACHE_TTL_SECONDS,
    async () => ({
      rows: arrayFrom(
        await fetchV1(`/eventsday.php?d=${encodeURIComponent(date)}&s=${encodeURIComponent(sport)}`),
        'events',
      ),
    }),
    30,
    { timeoutMs: FETCH_TIMEOUT_MS + 1_000 },
  );
  return cached?.rows ?? [];
}

async function fetchNextSchedule(league: SportsLeague): Promise<RawRecord[]> {
  const cached = await cachedFetchJson<RawList>(
    `sports:thesportsdb:schedule:next:${league.id}:v1-free`,
    SCHEDULE_CACHE_TTL_SECONDS,
    async () => ({
      rows: arrayFrom(await fetchV1(`/eventsnextleague.php?id=${encodeURIComponent(league.id)}`), 'events'),
    }),
    60,
    { timeoutMs: FETCH_TIMEOUT_MS + 1_000 },
  );
  return cached?.rows ?? [];
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

/** Deduplicate, apply dashboard priority, and enforce the public 20-row cap. */
export function sortAndLimitSportsEvents(events: NormalizedSportsEvent[]): NormalizedSportsEvent[] {
  const byId = new Map<string, NormalizedSportsEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, event);
      continue;
    }
    // Current-day rows are inserted first; retain their score/status while
    // filling in richer schedule metadata when it becomes available.
    byId.set(event.id, {
      ...event,
      ...existing,
      venue: existing.venue || event.venue,
      city: existing.city || event.city,
      country: existing.country || event.country,
      latitude: existing.latitude ?? event.latitude,
      longitude: existing.longitude ?? event.longitude,
      coordinateAccuracy: existing.coordinateAccuracy || event.coordinateAccuracy,
    });
  }
  const rank: Record<NormalizedSportsEvent['status'], number> = {
    live: 0,
    scheduled: 1,
    postponed: 2,
    cancelled: 3,
    final: 4,
  };
  return [...byId.values()].sort((a, b) => {
    const statusOrder = rank[a.status] - rank[b.status];
    if (statusOrder !== 0) return statusOrder;
    const aTime = Date.parse(a.startTime);
    const bTime = Date.parse(b.startTime);
    return a.status === 'final' ? bTime - aTime : aTime - bTime;
  }).slice(0, MAX_EVENTS);
}

async function fetchSportsAggregateUncached(): Promise<SportsAggregate> {
  const events: NormalizedSportsEvent[] = [];
  const sports = [...new Set(SPORTS_LEAGUES.map((league) => league.sport))];
  const dayResults = await mapConcurrent(sports, FETCH_CONCURRENCY, async (sport) => {
    try {
      return { success: true, rows: await fetchDay(sport) };
    } catch (error) {
      console.warn(`[sports] TheSportsDB v1 day fetch failed for ${sport}:`, error instanceof Error ? error.message : String(error));
      return { success: false, rows: [] };
    }
  });
  for (const result of dayResults) {
    for (const row of result.rows) {
      if (!SPORTS_LEAGUE_IDS.has(text(row.idLeague))) continue;
      const normalized = normalizeSportsEvent(row, 'scheduled');
      if (normalized) events.push(normalized);
    }
  }

  // Free v1 returns one upcoming event per league. Combined with four
  // sport-scoped current-day calls this stays below the documented 30 rpm
  // free-tier limit on a cold cache (24 requests total).
  let anyScheduleFailure = false;
  const leagueStatuses: LeagueFetchStatus[] = await mapConcurrent(
    SPORTS_LEAGUES,
    FETCH_CONCURRENCY,
    async (league) => {
      try {
        const nextRows = await fetchNextSchedule(league);
        for (const row of nextRows) {
          const normalized = normalizeSportsEvent(row, 'scheduled');
          if (normalized) events.push(normalized);
        }
        return {
          league: league.name,
          success: true,
          stale: false,
          error: '',
        };
      } catch (error) {
        anyScheduleFailure = true;
        console.warn(`[sports] TheSportsDB v1 schedule fetch failed for ${league.name}:`, error instanceof Error ? error.message : String(error));
        return {
          league: league.name,
          success: false,
          stale: false,
          error: 'schedule_unavailable',
        };
      }
    },
  );

  const merged = sortAndLimitSportsEvents(events);
  const dayFailed = dayResults.some((result) => !result.success);
  if (dayResults.every((result) => !result.success) && !leagueStatuses.some((status) => status.success)) {
    throw new Error('TheSportsDB unavailable');
  }
  return {
    events: merged,
    leagueStatuses,
    degraded: dayFailed || anyScheduleFailure,
    error: dayFailed ? 'partial_day_failure' : anyScheduleFailure ? 'partial_schedule_failure' : '',
  };
}

/**
 * Coalesce bootstrap/panel requests and retain a short process-local cache.
 * Local development commonly runs without Redis; without this guard, a page
 * reload can repeat all 24 free-tier requests and immediately hit 30 rpm.
 */
export async function fetchSportsAggregate(): Promise<SportsAggregate> {
  if (aggregateMemoryCache && aggregateMemoryCache.expiresAt > Date.now()) {
    return aggregateMemoryCache.value;
  }
  if (aggregateInFlight) return aggregateInFlight;

  aggregateInFlight = fetchSportsAggregateUncached()
    .then((value) => {
      aggregateMemoryCache = {
        expiresAt: Date.now() + AGGREGATE_MEMORY_TTL_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      aggregateInFlight = null;
    });
  return aggregateInFlight;
}
