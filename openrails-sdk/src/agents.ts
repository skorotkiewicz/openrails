import { call } from './http.js';
import type { AgentRun } from './types.js';
/** Reserved API. The current server returns 501 until an agent runner is configured. */
export const agents = {
  start<T = unknown>(name: string, input?: T): Promise<AgentRun> { return call('POST', `/agents/${encodeURIComponent(name)}`, { body: { input } }); },
  get(requestId: string): Promise<AgentRun> { return call('GET', `/agents/runs/${encodeURIComponent(requestId)}`); },
};
