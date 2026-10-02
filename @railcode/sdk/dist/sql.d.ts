import type { DataConnectorInfo, DatabaseNamespace, SqlRows } from "./types";
interface SqlEnvelope {
    columns: string[];
    rows: unknown[][];
    rowcount: number;
    truncated: boolean;
}
export declare const toSqlRows: (r: SqlEnvelope) => SqlRows;
export declare const data: DatabaseNamespace;
export declare const postgres: DatabaseNamespace;
export declare const bigquery: DatabaseNamespace;
export declare const turso: DatabaseNamespace;
/** Every org data connection this app can target — name + engine, never a DSN.
 * Listing is discovery: to actually query one, declare it in your manifest's
 * `adhoc_sql` (ratified), which `/sql` enforces. */
export declare const dataConnectors: () => Promise<DataConnectorInfo[]>;
export {};
