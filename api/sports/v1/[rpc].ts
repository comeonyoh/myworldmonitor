export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createSportsServiceRoutes } from '../../../src/generated/server/worldmonitor/sports/v1/service_server';
import { sportsHandler } from '../../../server/worldmonitor/sports/v1/handler';

export default createDomainGateway(
  createSportsServiceRoutes(sportsHandler, serverOptions),
);
