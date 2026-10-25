import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SPORTS_LEAGUES } from '../server/worldmonitor/sports/v1/leagues';
import {
  normalizeSportsEvent,
  sortAndLimitSportsEvents,
} from '../server/worldmonitor/sports/v1/thesportsdb';

const BASE_EVENT = {
  idEvent: 'event-1',
  strSport: 'Soccer',
  idLeague: '4328',
  strLeague: 'English Premier League',
  idHomeTeam: 'home-1',
  strHomeTeam: 'Liverpool',
  strHomeTeamBadge: 'https://example.com/home.png',
  idAwayTeam: 'away-1',
  strAwayTeam: 'Arsenal',
  strAwayTeamBadge: 'https://example.com/away.png',
  strTimestamp: '2026-07-23T18:30:00',
  strVenue: 'Anfield',
  strCity: 'Liverpool',
  strCountry: 'England',
};

describe('TheSportsDB sports adapter', () => {
  it('keeps the approved 20-league allowlist', () => {
    assert.equal(SPORTS_LEAGUES.length, 20);
    assert.equal(new Set(SPORTS_LEAGUES.map((league) => league.id)).size, 20);
  });

  it('normalizes scores, UTC timestamps, team metadata, and approximate city coordinates', () => {
    const event = normalizeSportsEvent({
      ...BASE_EVENT,
      intHomeScore: '2',
      intAwayScore: '1',
      strStatus: 'Q3',
      strProgress: '08:22',
      updated: '2026-07-23 19:01:02',
    }, 'live');

    assert.ok(event);
    assert.equal(event.status, 'live');
    assert.equal(event.startTime, '2026-07-23T18:30:00.000Z');
    assert.equal(event.homeScore, 2);
    assert.equal(event.awayScore, 1);
    assert.equal(event.homeTeam.name, 'Liverpool');
    assert.equal(event.coordinateAccuracy, 'approximate');
    assert.equal(typeof event.latitude, 'number');
    assert.equal(typeof event.longitude, 'number');
  });

  it('preserves nullable scores and maps terminal provider statuses', () => {
    const final = normalizeSportsEvent({ ...BASE_EVENT, strStatus: 'Match Finished' }, 'scheduled');
    const postponed = normalizeSportsEvent({ ...BASE_EVENT, strStatus: 'POST' }, 'scheduled');
    const cancelled = normalizeSportsEvent({ ...BASE_EVENT, strStatus: 'Cancelled' }, 'scheduled');

    assert.ok(final);
    assert.equal(final.status, 'final');
    assert.equal(final.homeScore, undefined);
    assert.equal(final.awayScore, undefined);
    assert.equal(postponed?.status, 'postponed');
    assert.equal(cancelled?.status, 'cancelled');
  });

  it('infers approximate map coordinates from v1 venue or home-team city hints', () => {
    const event = normalizeSportsEvent({
      ...BASE_EVENT,
      strCity: '',
      strVenue: 'Tokyo Dome',
      strHomeTeam: 'Tokyo Giants',
    });
    assert.ok(event);
    assert.equal(event.coordinateAccuracy, 'approximate');
    assert.equal(typeof event.latitude, 'number');
    assert.equal(typeof event.longitude, 'number');
  });

  it('rejects malformed events and leagues outside the allowlist', () => {
    assert.equal(normalizeSportsEvent({ ...BASE_EVENT, idEvent: '' }, 'scheduled'), null);
    assert.equal(normalizeSportsEvent({ ...BASE_EVENT, idLeague: '9999' }, 'scheduled'), null);
    assert.equal(normalizeSportsEvent({ ...BASE_EVENT, strTimestamp: 'not-a-date' }, 'scheduled'), null);
  });

  it('prioritizes live games, sorts schedules and finals, and caps the response at 20', () => {
    const normalized = Array.from({ length: 24 }, (_, index) => normalizeSportsEvent({
      ...BASE_EVENT,
      idEvent: `scheduled-${index}`,
      strTimestamp: `2026-07-${String(24 + (index % 4)).padStart(2, '0')}T18:30:00`,
    }, 'scheduled')).filter((event): event is NonNullable<typeof event> => event !== null);
    const live = normalizeSportsEvent({
      ...BASE_EVENT,
      idEvent: 'live',
      strTimestamp: '2026-07-28T18:30:00',
    }, 'live');
    assert.ok(live);

    const result = sortAndLimitSportsEvents([...normalized, live]);
    assert.equal(result.length, 20);
    assert.equal(result[0]?.id, 'live');
    assert.ok(result.slice(1).every((event, index, values) =>
      index === 0 || Date.parse(values[index - 1]!.startTime) <= Date.parse(event.startTime)));
  });
});
