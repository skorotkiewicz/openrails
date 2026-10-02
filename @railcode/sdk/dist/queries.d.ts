import type { SavedQueryInfo, SqlRows } from "./types";
/** Invoke a saved query by name; `params` are the query's declared, typed params. */
export declare const query: (name: string, params?: Record<string, unknown>) => Promise<SqlRows>;
/** The saved queries this app may see — signatures only, never the SQL text. */
export declare const savedQueries: () => Promise<SavedQueryInfo[]>;
