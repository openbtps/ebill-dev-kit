import type { components } from "./api-types.ts";
import { Transport, type Query, type TransportOptions } from "./http.ts";

type Schemas = components["schemas"];

/** A document, as the API answers it. Generated from the API's OpenAPI document (`pnpm generate`). */
export type Document = Schemas["Document"];
export type DocumentFile = Schemas["File"];
export type Payment = Schemas["Payment"];
export type Contact = Schemas["Contact"];
/** A draft of any kind: `kind` says which (`invoice`, `receipt`, `letter` or `payslip`), and the rest is that kind's fields. */
export type DraftRequest = Schemas["DraftRequest"];
export type DocumentDirection = "outgoing" | "incoming";

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

/** Who installed the app, which version, and the scopes they granted. */
export type Installation = Schemas["Installation"];

/** The values the organisation chose, keyed by the setting `key` declared in `ebill.app.toml`. */
export type InstallationSettings = Schemas["Settings"];

export interface ListOptions {
  /** 1 to 100. Default 50. */
  limit?: number;
  /** The `next` of the previous page. */
  after?: string;
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

  /** One page of the organisation's documents of `direction`, newest first. Outgoing needs `documents:read`; incoming, `documents:received:read`. */
  listDocuments(direction: DocumentDirection, options: ListOptions = {}): Promise<Page<Document>> {
    return this.request<Page<Document>>("GET", "/v1/documents", { query: { direction, limit: options.limit, after: options.after } });
  }

  /** Every document of `direction`, newest first, a page at a time. */
  documents(direction: DocumentDirection, options: Pick<ListOptions, "limit"> = {}): AsyncGenerator<Document, void, undefined> {
    return this.paginate<Document>("/v1/documents", { direction, limit: options.limit });
  }

  /** One document. A 404 unless the app may read documents of its direction. */
  getDocument(documentId: string): Promise<Document> {
    return this.request<Document>("GET", `/v1/documents/${encodeURIComponent(documentId)}`);
  }

  /** The bytes of a document's file at `position` (its place in `files`). Needs `files:read`. */
  async downloadFile(documentId: string, position: number): Promise<Uint8Array> {
    const token = await this.#token();
    const bytes = await this.#transport.send({
      method: "GET",
      path: `/v1/documents/${encodeURIComponent(documentId)}/files/${String(position)}`,
      headers: { authorization: `Bearer ${token}` },
      replayable: true,
      binary: true,
    });
    return bytes as Uint8Array;
  }

  /** An invoice's payment, with its status and the events it is made of. Needs `payments:read`. */
  getPayment(documentId: string): Promise<Payment> {
    return this.request<Payment>("GET", `/v1/documents/${encodeURIComponent(documentId)}/payment`);
  }

  /**
   * A new draft, from one of the organisation's own addresses. Needs `drafts:write`. Not retried on a 5xx or a lost
   * connection, which could make it twice: list the drafts before trying again.
   */
  createDraft(draft: DraftRequest): Promise<Document> {
    return this.request<Document>("POST", "/v1/drafts", { body: draft });
  }

  /** Signs and sends a draft. Needs `documents:send`. The key is required: a retried send is never sent twice. */
  sendDocument(documentId: string, options: { idempotencyKey: string }): Promise<Document> {
    return this.request<Document>("POST", `/v1/documents/${encodeURIComponent(documentId)}/send`, { idempotencyKey: options.idempotencyKey });
  }

  /** Who may send to whom: the organisation's trusts. Needs `contacts:read`. */
  async listContacts(): Promise<Contact[]> {
    return (await this.request<{ data: Contact[] }>("GET", "/v1/contacts")).data;
  }

  /**
   * Call any `/v1/...` endpoint. The answer is not checked against a schema: `T` is what you expect it to be.
   * 429 is always retried; 5xx and network failures are retried on GET, PUT and DELETE, and on POST or PATCH only with an `idempotencyKey`.
   */
  async request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/v1/")) throw new TypeError(`API paths start with "/v1/": ${path}`);
    const token = await this.#token();
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

  async #token(): Promise<string> {
    return typeof this.#accessToken === "string" ? this.#accessToken : await this.#accessToken();
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
