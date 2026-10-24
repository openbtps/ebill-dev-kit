// The eBill developer API (CONTRACT.md, "Developer API"): signing the CLI in with the OAuth 2.0 device grant
// (RFC 8628), and listing, pushing and releasing the organisation's apps with the developer token it gives.

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export class DeveloperApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly reference: string | undefined;

  constructor(status: number, error: string, message: string, reference?: string) {
    super(message);
    this.name = "DeveloperApiError";
    this.status = status;
    this.error = error;
    this.reference = reference;
  }
}

export interface DeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type Poll = { token: string; expiresIn: number } | { error: string };

export interface AppVersion {
  id: string;
  version: string;
  state: string;
  submittedAt: string;
  reviewNote: string | null;
}

export interface DeveloperApp {
  id: string;
  handle: string;
  kind: string;
  clientId: string;
  delistedAt: string | null;
  versions: AppVersion[];
}

export interface CheckFailure {
  check: string;
  path: string;
  reason: string;
}

export interface Pushed {
  state: "rejected" | "review_pending";
  failures: CheckFailure[];
  version?: AppVersion;
}

export interface Released {
  version: AppVersion;
  moved: number;
  waiting: number;
}

/** A dev push: refused with every failure, or installed in the sandbox, with where the app's server signs in. */
export type DevInstalled =
  | { state: "rejected"; failures: CheckFailure[] }
  | {
      state: "dev";
      failures: [];
      version: AppVersion;
      sandbox: { organisationId: string; name: string };
      installation: { installationId: string; redirectUrl: string };
    };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

export class DeveloperApi {
  private readonly apiUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly token: string | undefined;

  constructor(apiUrl: string, fetcher: typeof globalThis.fetch, token?: string) {
    this.apiUrl = apiUrl;
    this.fetcher = fetcher;
    this.token = token;
  }

  /** `form`: the body as `application/x-www-form-urlencoded`, which the token endpoint takes (RFC 6749 §4.1.3). */
  private async send(
    path: string,
    init: { method: string; body?: unknown; form?: Record<string, string>; auth: boolean },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
    else if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const body = init.form !== undefined ? new URLSearchParams(init.form).toString() : init.body === undefined ? null : JSON.stringify(init.body);
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiUrl}${path}`, {
        method: init.method,
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new DeveloperApiError(0, "unreachable", `Could not reach ${this.apiUrl}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      answer = {};
    }
    return { status: response.status, body: isRecord(answer) ? answer : {} };
  }

  private async call(path: string, init: { method: string; body?: unknown }): Promise<Record<string, unknown>> {
    const { status, body } = await this.send(path, { ...init, auth: true });
    if (status >= 200 && status < 300) return body;
    throw new DeveloperApiError(
      status,
      text(body.error, `http_${String(status)}`),
      text(body.message, text(body.error_description, `The eBill API answered ${String(status)}.`)),
      typeof body.reference === "string" ? body.reference : undefined,
    );
  }

  /** RFC 8628 §3.1. */
  async startLogin(): Promise<DeviceLogin> {
    const { status, body } = await this.send("/developer/device/code", { method: "POST", body: {}, auth: false });
    if (status !== 200)
      throw new DeveloperApiError(status, text(body.error, `http_${String(status)}`), "eBill could not start a sign-in.", text(body.reference) || undefined);
    return {
      deviceCode: text(body.device_code),
      userCode: text(body.user_code),
      verificationUri: text(body.verification_uri),
      verificationUriComplete: text(body.verification_uri_complete, text(body.verification_uri)),
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : 600,
      interval: typeof body.interval === "number" ? body.interval : 5,
    };
  }

  /** RFC 8628 §3.4: the token, or the error a poll was given (authorization_pending, access_denied, expired_token, …). */
  async poll(deviceCode: string, label: string): Promise<Poll> {
    const { status, body } = await this.send("/developer/device/token", {
      method: "POST",
      form: { grant_type: DEVICE_GRANT, device_code: deviceCode, label },
      auth: false,
    });
    if (status === 200 && typeof body.access_token === "string")
      return { token: body.access_token, expiresIn: typeof body.expires_in === "number" ? body.expires_in : 0 };
    return { error: text(body.error, `http_${String(status)}`) };
  }

  async apps(): Promise<DeveloperApp[]> {
    const body = await this.call("/developer/v1/apps", { method: "GET" });
    return Array.isArray(body.data) ? (body.data as DeveloperApp[]) : [];
  }

  async push(appId: string, manifest: unknown, listing: unknown): Promise<Pushed> {
    return (await this.call(`/developer/v1/apps/${encodeURIComponent(appId)}/versions`, { method: "POST", body: { manifest, listing } })) as unknown as Pushed;
  }

  async release(versionId: string): Promise<Released> {
    return (await this.call(`/developer/v1/versions/${encodeURIComponent(versionId)}/release`, { method: "POST", body: {} })) as unknown as Released;
  }

  /** The app's dev version, checked but not reviewed, installed in the organisation's sandbox (`ebill app dev`). */
  async dev(appId: string, manifest: unknown, listing: unknown): Promise<DevInstalled> {
    return (await this.call(`/developer/v1/apps/${encodeURIComponent(appId)}/dev`, { method: "POST", body: { manifest, listing } })) as unknown as DevInstalled;
  }
}
