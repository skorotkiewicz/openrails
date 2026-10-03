export interface ClientOptions {
  /** Backend origin, without /fn/data. */
  url: string;
  /** Trusted server-side service token. Never ship this to a browser. */
  token: string;
}

let configured: ClientOptions | undefined;

export function configure(options: ClientOptions): void {
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('OpenRails URL must be HTTP(S), without credentials, query or fragment');
  }
  if (!options.token || /\s/.test(options.token)) throw new TypeError('OpenRails token must be non-empty and contain no whitespace');
  configured = { url: url.toString().replace(/\/$/, ''), token: options.token };
}

export function environment(): Record<string, string | undefined> {
  return (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

export function ambient(): ClientOptions {
  if (!configured) {
    const env = environment();
    if (!env.OPENRAILS_TOKEN || !env.OPENRAILS_URL) {
      throw new Error('Configure openrails with configure({ url, token }) or set OPENRAILS_URL and OPENRAILS_TOKEN');
    }
    configure({ url: env.OPENRAILS_URL, token: env.OPENRAILS_TOKEN });
  }
  return configured!;
}
