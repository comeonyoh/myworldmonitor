import type { SportsServiceHandler } from '../../../../src/generated/server/worldmonitor/sports/v1/service_server';
import { listSportsEvents } from './list-sports-events';

export const sportsHandler: SportsServiceHandler = {
  listSportsEvents,
};
