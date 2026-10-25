import type { SportsEvent, SportsLeagueSourceStatus } from '@/types';
import { getHydratedData } from '@/services/bootstrap';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { SportsServiceClient } from '@/services/generated-rpc-clients';

export interface SportsEventsResult {
  events: SportsEvent[];
  fetchedAt: string;
  configured: boolean;
  leagueStatuses: SportsLeagueSourceStatus[];
  degraded: boolean;
  stale: boolean;
  error?: string;
}

type RawSportsResponse = {
  events?: unknown[];
  fetchedAt?: string;
  queriedAt?: string;
  configured?: boolean;
  providerConfigured?: boolean;
  leagueStatuses?: unknown[];
  degraded?: boolean;
  stale?: boolean;
  error?: string;
};

const getClient = createLazyClient(
  () => new SportsServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) }),
);

let hydratedConsumed = false;
let lastGoodResult: SportsEventsResult | null = null;

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeStatus(value: unknown): SportsEvent['status'] {
  const normalized = String(value ?? '').toLowerCase().replace(/^sports_event_status_/, '');
  if (normalized === 'upcoming') return 'scheduled';
  if (normalized === 'live' || normalized === 'final' || normalized === 'postponed' || normalized === 'cancelled') {
    return normalized;
  }
  return 'scheduled';
}

function normalizeAccuracy(value: unknown): SportsEvent['coordinateAccuracy'] {
  const normalized = String(value ?? '').toLowerCase().replace(/^coordinate_accuracy_/, '');
  if (normalized === 'exact' || normalized === 'approximate') return normalized;
  return 'unknown';
}

function normalizeEvent(value: unknown): SportsEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '');
  const home = raw.homeTeam && typeof raw.homeTeam === 'object'
    ? raw.homeTeam as Record<string, unknown>
    : { name: raw.homeTeam };
  const away = raw.awayTeam && typeof raw.awayTeam === 'object'
    ? raw.awayTeam as Record<string, unknown>
    : { name: raw.awayTeam };
  const homeTeam = String(home.name ?? '');
  const awayTeam = String(away.name ?? '');
  const startTime = String(raw.startTime ?? '');
  if (!id || !homeTeam || !awayTeam || !startTime || !Number.isFinite(Date.parse(startTime))) return null;

  return {
    id,
    sport: String(raw.sport ?? ''),
    league: String(raw.league ?? ''),
    status: normalizeStatus(raw.status),
    startTime,
    homeTeam,
    awayTeam,
    ...(home.logoUrl || raw.homeTeamLogo ? { homeTeamLogo: String(home.logoUrl ?? raw.homeTeamLogo) } : {}),
    ...(away.logoUrl || raw.awayTeamLogo ? { awayTeamLogo: String(away.logoUrl ?? raw.awayTeamLogo) } : {}),
    ...(optionalNumber(raw.homeScore) !== undefined ? { homeScore: optionalNumber(raw.homeScore) } : {}),
    ...(optionalNumber(raw.awayScore) !== undefined ? { awayScore: optionalNumber(raw.awayScore) } : {}),
    ...(raw.period ? { period: String(raw.period) } : {}),
    ...(raw.clock ? { clock: String(raw.clock) } : {}),
    ...(raw.venue ? { venue: String(raw.venue) } : {}),
    ...(raw.city ? { city: String(raw.city) } : {}),
    ...(raw.country ? { country: String(raw.country) } : {}),
    ...(optionalNumber(raw.latitude) !== undefined ? { latitude: optionalNumber(raw.latitude) } : {}),
    ...(optionalNumber(raw.longitude) !== undefined ? { longitude: optionalNumber(raw.longitude) } : {}),
    coordinateAccuracy: normalizeAccuracy(raw.coordinateAccuracy),
    updatedAt: String(raw.updatedAt ?? startTime),
  };
}

function normalizeResponse(raw: RawSportsResponse): SportsEventsResult {
  const events = (raw.events ?? [])
    .map(normalizeEvent)
    .filter((event): event is SportsEvent => event !== null)
    .slice(0, 20);

  return {
    events,
    fetchedAt: raw.fetchedAt || raw.queriedAt || new Date().toISOString(),
    configured: raw.configured ?? raw.providerConfigured ?? false,
    leagueStatuses: (raw.leagueStatuses ?? []) as SportsLeagueSourceStatus[],
    degraded: Boolean(raw.degraded),
    stale: Boolean(raw.stale),
    ...(raw.error ? { error: raw.error } : {}),
  };
}

export async function fetchSportsEvents(): Promise<SportsEventsResult> {
  if (!hydratedConsumed) {
    hydratedConsumed = true;
    const hydrated = getHydratedData('sportsEvents') as RawSportsResponse | undefined;
    if (hydrated) {
      const result = normalizeResponse(hydrated);
      if (result.events.length > 0) lastGoodResult = result;
      return result;
    }
  }

  try {
    const response = await getClient().listSportsEvents({}, { signal: AbortSignal.timeout(15_000) });
    const result = normalizeResponse(response as RawSportsResponse);
    if (result.events.length > 0) lastGoodResult = result;
    return result;
  } catch (error) {
    if (lastGoodResult) {
      return { ...lastGoodResult, stale: true, degraded: true, error: String(error) };
    }
    throw error;
  }
}
