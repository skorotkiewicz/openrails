import { call } from './http.js';
import type { ConnectorHandle, ConnectorFetchOptions, ServiceConnectorDocs, ServiceConnectorInfo, ServiceConnectorResponse } from './types.js';
import { encPath } from './util.js';

type Envelope = Pick<ServiceConnectorResponse, 'status' | 'ok' | 'headers' | 'truncated'> & { body: string };
export function connector(name: string): ConnectorHandle {
  encPath(name);
  return {
    async fetch(path: string, options: ConnectorFetchOptions = {}): Promise<ServiceConnectorResponse> {
      const result = await call<Envelope>('POST', '/service-connectors/request', {
        body: { connector: name, path, method: (options.method ?? 'GET').toUpperCase(), body: options.body },
      });
      return { status: result.status, ok: result.ok, headers: result.headers, truncated: result.truncated,
        text: async () => result.body, json: async <T = unknown>() => JSON.parse(result.body) as T };
    },
    tools: () => call('GET', `/service-connectors/${encPath(name)}/tools`),
    call: <T = unknown>(tool: string, args: Record<string, unknown> = {}) => call<{ result: T }>('POST', '/service-connectors/call', { body: { connector: name, tool, arguments: args } }).then(result => result.result),
  };
}
export function serviceConnectors(): Promise<ServiceConnectorInfo[]> { return call('GET', '/service-connectors'); }
export function serviceConnectorDocs(name: string): Promise<ServiceConnectorDocs> { return call('GET', `/service-connectors/${encPath(name)}`); }
