import type { KvRecord, WhereOp } from "./types";
/** A lazy query over a collection: chain filters, then page()/first()/count(). */
declare class DbQuery<T> {
    private collection;
    private _where;
    private _prefix?;
    private _since?;
    private _before?;
    private _order?;
    constructor(collection: string);
    where(field: string, op: WhereOp, value: unknown): this;
    prefix(value: string): this;
    updatedSince(value: string | Date): this;
    updatedBefore(value: string | Date): this;
    orderBy(field: string, direction?: "asc" | "desc"): this;
    private params;
    private fetchPage;
    page(page?: number, size?: number): Promise<KvRecord<T>[]>;
    first(): Promise<KvRecord<T> | null>;
    count(): Promise<number>;
}
declare class Collection<T> {
    private name;
    constructor(name: string);
    /** The stored value for ``key``, or null if absent. */
    get(key: string): Promise<T | null>;
    /** Upsert ``key`` → ``value``; returns the stored value. */
    put(key: string, value: T): Promise<T>;
    delete(key: string): Promise<void>;
    /** All records in the collection (first page). */
    list(): Promise<KvRecord<T>[]>;
    query(): DbQuery<T>;
    where(field: string, op: WhereOp, value: unknown): DbQuery<T>;
    prefix(value: string): DbQuery<T>;
}
/** A frozen v1 scope of a migrated app — READ-ONLY, for live migration. */
declare class FrozenCollection<T> {
    private kind;
    private owner;
    private name;
    constructor(kind: "user" | "role", owner: string, name: string);
    private base;
    get(key: string): Promise<T | null>;
    list(page?: number, size?: number): Promise<KvRecord<T>[]>;
}
export interface FrozenScope {
    collection<T = unknown>(name: string): FrozenCollection<T>;
}
export declare const db: {
    collection<T = unknown>(name: string): Collection<T>;
    /** A migrated v1 app's frozen USER-scoped data (read-only). */
    scoped(userId: string): FrozenScope;
    /** A migrated v1 app's frozen ROLE-scoped data (read-only). */
    scopedRole(roleUuid: string): FrozenScope;
};
export {};
