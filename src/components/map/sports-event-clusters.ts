import type { SportsEvent, SportsEventCluster } from '@/types';

/**
 * Sports feeds contain at most 20 events, so grouping colocated venues before
 * rendering is cheaper and more predictable than maintaining a viewport index.
 * Two decimal places is roughly a kilometre and keeps stadiums in the same
 * complex together while preserving separate city venues.
 */
export function clusterSportsEvents(events: SportsEvent[]): SportsEventCluster[] {
  const groups = new Map<string, SportsEvent[]>();
  for (const event of events) {
    if (!Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)) continue;
    const key = `${event.latitude!.toFixed(2)},${event.longitude!.toFixed(2)}`;
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  return [...groups.entries()].map(([key, grouped]) => {
    const first = grouped[0]!;
    return {
      id: `sports-${key}`,
      latitude: grouped.reduce((sum, event) => sum + event.latitude!, 0) / grouped.length,
      longitude: grouped.reduce((sum, event) => sum + event.longitude!, 0) / grouped.length,
      events: grouped,
      count: grouped.length,
      city: first.city,
      country: first.country,
    };
  });
}
