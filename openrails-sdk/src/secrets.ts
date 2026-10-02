import { environment } from './ambient.js';
/** Local process environment, not a server secret store. */
export const secrets: Record<string, string | undefined> = new Proxy({}, {
  get: (_, property) => typeof property === 'string' ? environment()[property] : undefined,
  has: (_, property) => typeof property === 'string' && environment()[property] !== undefined,
  ownKeys: () => Object.keys(environment()),
  getOwnPropertyDescriptor: (_, property) => typeof property === 'string' && environment()[property] !== undefined
    ? { configurable: true, enumerable: true, value: environment()[property] } : undefined,
});
