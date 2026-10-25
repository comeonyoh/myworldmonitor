import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('sports panel integration', () => {
  it('registers the panel and layer as full-only defaults with the layer off', () => {
    const panels = read('src/config/panels.ts');
    const layers = read('src/config/map-layer-definitions.ts');
    assert.match(panels, /'sports-live':\s*\{\s*name:\s*'Sports Live',\s*enabled:\s*true/);
    assert.match(panels, /sportsEvents:\s*false/);
    assert.match(layers, /full:\s*\[[\s\S]*'sportsEvents'/);
    assert.doesNotMatch(layers, /tech:\s*\[[\s\S]{0,300}'sportsEvents'/);
  });

  it('loads once for either the panel or layer and primes the map replay cache', () => {
    const loader = read('src/app/data-loader.ts');
    assert.match(loader, /shouldLoad\('sports-live'\)\s*\|\|\s*this\.ctx\.mapLayers\.sportsEvents/);
    assert.match(loader, /this\.ctx\.map\?\.setSportsEvents\(result\.events\)/);
    assert.match(loader, /dataFreshness\.recordUpdate\('sports'/);
  });

  it('refreshes at the provider cadence and remains discoverable', () => {
    const intervals = read('src/config/variants/base.ts');
    const commands = read('src/config/commands.ts');
    assert.match(intervals, /sportsEvents:\s*10\s*\*\s*60\s*\*\s*1000/);
    assert.match(commands, /id:\s*'panel:sports-live'/);
    assert.match(commands, /id:\s*'layer:sportsEvents'/);
  });

  it('uses the free v1 demo feed and registers the RPC in the Vite dev server', () => {
    const provider = read('server/worldmonitor/sports/v1/thesportsdb.ts');
    const handler = read('server/worldmonitor/sports/v1/list-sports-events.ts');
    const panel = read('src/components/SportsLivePanel.ts');
    const vite = read('vite.config.ts');
    assert.match(provider, /api\/v1\/json\/123/);
    assert.match(provider, /eventsday\.php/);
    assert.match(provider, /eventsnextleague\.php/);
    assert.match(provider, /aggregateMemoryCache/);
    assert.match(provider, /aggregateInFlight/);
    assert.doesNotMatch(provider, /livescore\/all|X-API-KEY/);
    assert.doesNotMatch(handler, /THESPORTSDB_API_KEY|missing_credentials/);
    assert.match(panel, /sports-demo-notice/);
    assert.match(vite, /createSportsServiceRoutes/);
  });
});
