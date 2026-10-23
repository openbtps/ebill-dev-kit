import { Transport, type Query, type TransportOptions } from "./http.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A token, or a function that returns a current one (for example after refreshing it). */
export type AccessTokenSource = string | (() => string | Promise<string>);

export interface EbillClientOptions extends TransportOptions {
  accessToken: AccessTokenSource;
}

export interface RequestOptions {
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as `Idempotency-Key`. Give one on any call that creates or changes something, so a retry cannot do it twice. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface Installation {
  id: string;
  organisation: { id: string; name: string };
  app: { handle: string; version: string };
  scopes: string[];
  /** ISO 8601 time. */
  installedAt: string;
}

export interface InstallationSettings {
  /** Keyed by the setting `key` declared in `ebill.app.toml`. */
  values: Record<string, unknown>;
  /** ISO 8601 time. */
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  next: string | null;
}

const SAFE_METHODS = new Set<HttpMethod>(["GET", "PUT", "DELETE"]);

function isPage(value: unknown): value is Page<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const { data, next } = value as Record<string, unknown>;
  return Array.isArray(data) && (typeof next === "string" || next === null);
}

/** Calls the eBill API for one installation. */
export class EbillClient {
  readonly #transport: Transport;
  readonly #accessToken: AccessTokenSource;

  constructor(options: EbillClientOptions) {
    this.#transport = new Transport(options);
    this.#accessToken = options.accessToken;
  }

  /** Who installed the app, which version, and the scopes they granted. */
  getInstallation(): Promise<Installation> {
    return this.request<Installation>("GET", "/v1/installation");
  }

  /** The values the organisation chose for the settings declared in `ebill.app.toml`. */
  getSettings(): Promise<InstallationSettings> {
    return this.request<InstallationSettings>("GET", "/v1/installation/settings");
  }

  /**
   * Call any `/v1/...` endpoint. The answer is not checked against a schema: `T` is what you expect it to be.
   * 429 is always retried; 5xx and network failures are retried on GET, PUT and DELETE, and on POST or PATCH only with an `idempotencyKey`.
   */
  async request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/v1/")) throw new TypeError(`API paths start with "/v1/": ${path}`);
    const token = typeof this.#accessToken === "string" ? this.#accessToken : await this.#accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;
    const result = await this.#transport.send({
      method,
      path,
      query: options.query,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      replayable: SAFE_METHODS.has(method) || options.idempotencyKey !== undefined,
      signal: options.signal,
    });
    return result as T;
  }

  /** Every item of a list endpoint, fetching the next page (`?after=<next>`) as you go. */
  async *paginate<T = unknown>(path: string, query: Query = {}): AsyncGenerator<T, void, undefined> {
    let after = query.after;
    for (;;) {
      const page = await this.request("GET", path, { query: { ...query, after } });
      if (!isPage(page)) throw new TypeError(`${path} did not answer with a list ({ data, next }).`);
      yield* page.data as T[];
      if (page.next === null) return;
      after = page.next;
    }
  }
}
