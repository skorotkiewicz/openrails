import { call, getOrNull, type Query } from './http.js';
import type { KvRecord, WhereOp } from './types.js';
import { encPath, toIso } from './util.js';

export class DbQuery<T> {
  private filters: Array<[string, WhereOp, unknown]> = [];
  private keyPrefix?: string;
  private since?: string;
  private before?: string;
  private order?: [string, 'asc' | 'desc'];
  constructor(private collection: string) {}
  where(field: string, op: WhereOp, value: unknown): this { this.filters.push([field, op, value]); return this; }
  prefix(value: string): this { this.keyPrefix = value; return this; }
  updatedSince(value: string | Date): this { this.since = toIso(value); return this; }
  updatedBefore(value: string | Date): this { this.before = toIso(value); return this; }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this { this.order = [field, direction]; return this; }
  private params(extra: Query = {}): Query {
    return { where: this.filters.length ? JSON.stringify(this.filters) : undefined, prefix: this.keyPrefix,
      updated_since: this.since, updated_before: this.before, order: this.order ? JSON.stringify(this.order) : undefined, ...extra };
  }
  async page(page = 1, size?: number): Promise<KvRecord<T>[]> {
    return (await call<{ items: KvRecord<T>[] }>('GET', `/kv/${encPath(this.collection)}`, { query: this.params({ page, size }) })).items;
  }
  async first(): Promise<KvRecord<T> | null> { return (await this.page(1, 1))[0] ?? null; }
  async count(): Promise<number> {
    return (await call<{ count: number }>('GET', `/kv/${encPath(this.collection)}`, { query: this.params({ count: true }) })).count;
  }
}

export class Collection<T> {
  constructor(private name: string) {
    encPath(name);
    if (name.includes('/')) throw new TypeError('Collection names must be one path segment');
  }
  async get(key: string): Promise<T | null> { return (await getOrNull<KvRecord<T>>(`/kv/${encPath(this.name)}/${encPath(key)}`))?.value ?? null; }
  async put(key: string, value: T): Promise<T> {
    return (await call<KvRecord<T>>('PUT', `/kv/${encPath(this.name)}/${encPath(key)}`, { body: { value } })).value;
  }
  delete(key: string): Promise<void> { return call('DELETE', `/kv/${encPath(this.name)}/${encPath(key)}`); }
  list(): Promise<KvRecord<T>[]> { return this.query().page(); }
  query(): DbQuery<T> { return new DbQuery<T>(this.name); }
  where(field: string, op: WhereOp, value: unknown): DbQuery<T> { return this.query().where(field, op, value); }
  prefix(value: string): DbQuery<T> { return this.query().prefix(value); }
}

class FrozenCollection<T> {
  private base: string;
  constructor(kind: 'user' | 'role', owner: string, name: string) {
    if (name.includes('/')) throw new TypeError('Collection names must be one path segment');
    this.base = `/kv-scoped/${kind}/${encPath(owner)}/${encPath(name)}`;
  }
  async get(key: string): Promise<T | null> { return (await getOrNull<KvRecord<T>>(`${this.base}/${encPath(key)}`))?.value ?? null; }
  async list(page = 1, size?: number): Promise<KvRecord<T>[]> {
    return (await call<{ items: KvRecord<T>[] }>('GET', this.base, { query: { page, size } })).items;
  }
}
export interface FrozenScope { collection<T = unknown>(name: string): FrozenCollection<T>; }
export interface AtomicRequest {
  checks?: Array<{ collection: string; key: string; exists: boolean; value?: unknown }>;
  puts?: Array<{ collection: string; key: string; value: unknown }>;
  deletes?: Array<{ collection: string; key: string }>;
  /** A base64-encoded file committed with the KV mutations. */
  attachment?: { name: string; content_type: string; data: string };
}
export const db = {
  transaction(request: AtomicRequest): Promise<{ committed: true }> {
    return call('POST', '/kv/transaction', { body: request });
  },
  collection<T = unknown>(name: string): Collection<T> { return new Collection<T>(name); },
  scoped(owner: string): FrozenScope { return { collection: <T = unknown>(name: string) => new FrozenCollection<T>('user', owner, name) }; },
  scopedRole(owner: string): FrozenScope { return { collection: <T = unknown>(name: string) => new FrozenCollection<T>('role', owner, name) }; },
};
