import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { getAllowedLayerKeys, LAYER_REGISTRY } from '../src/config/map-layer-definitions';
import { clusterSportsEvents } from '../src/components/map/sports-event-clusters';
import type { SportsEvent } from '../src/types';

const event = (overrides: Partial<SportsEvent>): SportsEvent => ({
  id: 'event-1',
  sport: 'Soccer',
  league: 'English Premier League',
  status: 'scheduled',
  startTime: '2026-07-23T12:00:00Z',
  homeTeam: 'Home',
  awayTeam: 'Away',
  latitude: 51.555,
  longitude: -0.108,
  coordinateAccuracy: 'exact',
  updatedAt: '2026-07-23T10:00:00Z',
  ...overrides,
});

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('sports map layer', () => {
  it('is available only in the full variant and supports all renderers', () => {
    assert.deepEqual(LAYER_REGISTRY.sportsEvents.renderers, ['flat', 'globe']);
    assert.ok(getAllowedLayerKeys('full').has('sportsEvents'));
    for (const variant of ['tech', 'finance', 'happy', 'commodity', 'energy'] as const) {
      assert.equal(getAllowedLayerKeys(variant).has('sportsEvents'), false);
    }
  });

  it('clusters colocated events and excludes events without coordinates', () => {
    const clusters = clusterSportsEvents([
      event({ id: 'one' }),
      event({ id: 'two' }),
      event({ id: 'no-location', latitude: undefined, longitude: undefined }),
    ]);

    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.count, 2);
    assert.deepEqual(clusters[0]?.events.map(item => item.id), ['one', 'two']);
  });

  it('wires data replay and event popups through all three map renderers', () => {
    const container = read('src/components/MapContainer.ts');
    const deck = read('src/components/DeckGLMap.ts');
    const svg = read('src/components/Map.ts');
    const globe = read('src/components/GlobeMap.ts');
    const popup = read('src/components/MapPopup.ts');

    assert.match(container, /cachedSportsEvents/);
    assert.match(container, /setSportsEvents\(events:\s*SportsEvent\[\]\)/);
    for (const renderer of [deck, svg, globe]) {
      assert.match(renderer, /setSportsEvents\(events:\s*SportsEvent\[\]\)/);
      assert.match(renderer, /sportsEventCluster/);
    }
    assert.match(popup, /renderSportsEventPopup/);
    assert.match(popup, /Demo · Free v1 data:[\s\S]*TheSportsDB/);
    assert.match(popup, /Approximate location/);
  });
});
