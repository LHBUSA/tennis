import api, { propsportsFetch } from './index.js';
import { WorkerEntrypoint } from 'cloudflare:workers';

export default api;

// Named service-binding entrypoint. It is not attached to the public custom domain;
// PropSports binds directly to this entrypoint after validating a Tennis entitlement.
export class PropSportsTennis extends WorkerEntrypoint {
  fetch(request) {
    return propsportsFetch(request, this.env, this.ctx);
  }
}
