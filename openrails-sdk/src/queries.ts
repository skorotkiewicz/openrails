import { call } from './http.js';
import { toSqlRows, type SqlEnvelope } from './sql.js';
import type { SavedQueryInfo, SqlRows } from './types.js';
import { encPath } from './util.js';

export function query(name: string, params: Record<string, unknown> = {}): Promise<SqlRows> {
  return call<SqlEnvelope>('POST', `/queries/${encPath(name)}`, { body: { params } }).then(toSqlRows);
}
export function savedQueries(): Promise<SavedQueryInfo[]> { return call('GET', '/queries'); }
