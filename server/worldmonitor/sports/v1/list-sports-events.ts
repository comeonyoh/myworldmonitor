import type {
  ListSportsEventsRequest,
  ListSportsEventsResponse,
  ServerContext,
  SportsServiceHandler,
} from '../../../../src/generated/server/worldmonitor/sports/v1/service_server';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';
import { SPORTS_LEAGUES } from './leagues';
import { fetchSportsAggregate } from './thesportsdb';

const BOOTSTRAP_CACHE_KEY = 'sports:events-bootstrap:v1';
const LAST_GOOD_CACHE_KEY = 'sports:events-last-good:v1';
const BOOTSTRAP_TTL_SECONDS = 24 * 60 * 60;
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

function unavailableResponse(
  providerConfigured: boolean,
  error: string,
): ListSportsEventsResponse {
  return {
    events: [],
    fetchedAt: new Date().toISOString(),
    configured: providerConfigured,
    leagueStatuses: SPORTS_LEAGUES.map((league) => ({
      league: league.name,
      success: false,
      stale: false,
      error,
    })),
    degraded: true,
    stale: false,
    error,
  };
}

async function staleFallback(
  providerConfigured: boolean,
  error: string,
): Promise<ListSportsEventsResponse> {
  const cached = (
    await getCachedJson(LAST_GOOD_CACHE_KEY, true)
    ?? await getCachedJson(BOOTSTRAP_CACHE_KEY, true)
  ) as ListSportsEventsResponse | null;
  if (!cached?.events) return unavailableResponse(providerConfigured, error);
  return {
    ...cached,
    configured: providerConfigured,
    fetchedAt: new Date().toISOString(),
    leagueStatuses: (cached.leagueStatuses ?? []).map((status) => ({ ...status, stale: true })),
    degraded: true,
    stale: true,
    error,
  };
}

export const listSportsEvents: SportsServiceHandler['listSportsEvents'] = async (
  _ctx: ServerContext,
  _req: ListSportsEventsRequest,
): Promise<ListSportsEventsResponse> => {
  try {
    const aggregate = await fetchSportsAggregate();
    const response: ListSportsEventsResponse = {
      events: aggregate.events,
      fetchedAt: new Date().toISOString(),
      configured: true,
      leagueStatuses: aggregate.leagueStatuses,
      degraded: aggregate.degraded,
      stale: false,
      error: aggregate.error,
    };
    // Bootstrap reads canonical, unprefixed keys. Mirror every completed
    // aggregate (including useful partial data) while separately preserving
    // the last fully healthy snapshot for stale-if-error behavior.
    await setCachedJson(BOOTSTRAP_CACHE_KEY, response, BOOTSTRAP_TTL_SECONDS, true);
    if (response.events.length > 0) {
      await setCachedJson(LAST_GOOD_CACHE_KEY, response, LAST_GOOD_TTL_SECONDS, true);
    }
    return response;
  } catch (error) {
    console.warn('[sports] aggregate fetch failed:', error instanceof Error ? error.message : String(error));
    return staleFallback(true, 'upstream_unavailable');
  }
};
