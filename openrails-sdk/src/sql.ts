import { call } from './http.js';
import type { DataConnectorInfo, DatabaseHandle, DatabaseNamespace, SqlRows } from './types.js';

export interface SqlEnvelope { columns: string[]; rows: unknown[][]; rowcount: number; truncated: boolean; }
export function toSqlRows(result: SqlEnvelope): SqlRows {
  const rows = result.rows.map(row => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])));
  return Object.assign(rows, { columns: result.columns, rowcount: result.rowcount, truncated: result.truncated });
}
function handle(connection: string): DatabaseHandle {
  return { runSQL: (query: string, params: unknown[] = []) => call<SqlEnvelope>('POST', '/sql', { body: { connection, query, params } }).then(toSqlRows) };
}
/** The primary server's own SQLite database. No external SQL providers. */
export const data: DatabaseNamespace = Object.assign(handle, handle('default'));
export function dataConnectors(): Promise<DataConnectorInfo[]> { return call('GET', '/connections'); }
