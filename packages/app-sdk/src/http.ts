import { EbillApiError, EbillNetworkError } from "./errors.ts";
import { SDK_VERSION } from "./version.ts";

export const DEFAULT_BASE_URL = "https://api.ebilladdress.com";

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

export interface RetryInfo {
  /** 1 for the first retry, 2 for the second, and so on. */
  attempt: number;
  delayMs: number;
  method: string;
  url: string;
  /** The HTTP status that caused the retry, or `undefined` for a network error. */
  status: number | undefined;
  error: EbillApiError | EbillNetworkError;
}

export interface RetryOptions {
  /** Retries after the first attempt. Default 3; 0 turns retrying off. */
  maxRetries?: number;
  /** First backoff step. Default 500 ms, doubled on each retry. */
  baseDelayMs?: number;
  /** Longest wait between attempts. Default 30 s. A `Retry-After` longer than this is not waited for: the error is thrown. */
  maxDelayMs?: number;
  onRetry?: (info: RetryInfo) => void;
}

export interface TransportOptions {
  /** Default `https://api.ebilladdress.com`. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Per attempt. Default 30 s. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Appended to the SDK's own User-Agent, for example `acme-subscriptions/1.4.0`. */
  userAgent?: string;
}

export interface SendInit {
  method: string;
  path: string;
  query?: Query | undefined;
  headers?: Record<string, string>;
  body?: string | undefined;
  /** Whether a 5xx or network failure may be retried. Only true when repeating the request cannot do the work twice. */
  replayable: boolean;
  signal?: AbortSignal | undefined;
}

const DEFAULTS = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000, timeoutMs: 30_000 };

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  if (!path.startsWith("/")) throw new TypeError(`Path must start with "/": ${path}`);
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    const values: readonly QueryValue[] = Array.isArray(value) ? value : [value as QueryValue];
    for (const item of values) {
      if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
    }
  }
  return url.toString();
}

export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

function backoff(retry: number, baseDelayMs: number, maxDelayMs: number): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (retry - 1));
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(toError(signal.reason));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(toError(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function toApiError(response: Response): Promise<EbillApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const fields = isRecord(body) ? body : {};
  const error = typeof fields.error === "string" ? fields.error : `http_${String(response.status)}`;
  const message =
    typeof fields.message === "string"
      ? fields.message
      : typeof fields.error_description === "string"
        ? fields.error_description
        : `${String(response.status)} ${response.statusText}`.trim();
  return new EbillApiError({
    status: response.status,
    error,
    message,
    reference: typeof fields.reference === "string" ? fields.reference : undefined,
    retryAfter: parseRetryAfter(response.headers.get("retry-after")),
  });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new EbillApiError({ status: response.status, error: "invalid_response", message: "The eBill API answered with a body that is not JSON." });
  }
}

export class Transport {
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #retry: Required<Omit<RetryOptions, "onRetry">> & Pick<RetryOptions, "onRetry">;
  readonly #userAgent: string;

  constructor(options: TransportOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.#retry = {
      maxRetries: options.retry?.maxRetries ?? DEFAULTS.maxRetries,
      baseDelayMs: options.retry?.baseDelayMs ?? DEFAULTS.baseDelayMs,
      maxDelayMs: options.retry?.maxDelayMs ?? DEFAULTS.maxDelayMs,
      onRetry: options.retry?.onRetry,
    };
    const own = `ebilladdress-app-sdk/${SDK_VERSION}`;
    this.#userAgent = options.userAgent ? `${own} ${options.userAgent}` : own;
  }

  async send(init: SendInit): Promise<unknown> {
    const url = buildUrl(this.baseUrl, init.path, init.query);
    const headers = { accept: "application/json", "user-agent": this.#userAgent, ...init.headers };
    const { maxRetries, baseDelayMs, maxDelayMs, onRetry } = this.#retry;

    for (let retry = 0; ; retry++) {
      let failure: EbillApiError | EbillNetworkError;
      let delayMs: number | undefined;
      try {
        const signals = [AbortSignal.timeout(this.#timeoutMs)];
        if (init.signal) signals.push(init.signal);
        const response = await this.#fetch(url, { method: init.method, headers, body: init.body ?? null, signal: AbortSignal.any(signals) });
        if (response.ok) return await readBody(response);
        failure = await toApiError(response);
        const retryable = response.status === 429 || (response.status >= 500 && init.replayable);
        if (!retryable) throw failure;
        if (failure.retryAfter !== undefined) {
          delayMs = failure.retryAfter * 1000;
          if (delayMs > maxDelayMs) throw failure;
        }
      } catch (cause) {
        if (cause instanceof EbillApiError) throw cause;
        if (init.signal?.aborted) throw toError(init.signal.reason);
        failure = new EbillNetworkError(`Could not reach ${new URL(url).origin}: ${toError(cause).message}`, { cause });
        if (!init.replayable) throw failure;
      }
      if (retry >= maxRetries) throw failure;
      delayMs ??= backoff(retry + 1, baseDelayMs, maxDelayMs);
      onRetry?.({
        attempt: retry + 1,
        delayMs,
        method: init.method,
        url,
        status: failure instanceof EbillApiError ? failure.status : undefined,
        error: failure,
      });
      await sleep(delayMs, init.signal);
    }
  }
}
