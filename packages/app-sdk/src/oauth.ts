import { Transport, type TransportOptions } from "./http.ts";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ExchangeCodeOptions extends OAuthCredentials, TransportOptions {
  /** The `code` query parameter eBill added to your redirect URL. */
  code: string;
  /** The redirect URL the user came back to, exactly as listed in `ebill.app.toml`. */
  redirectUri: string;
}

export interface RefreshTokenOptions extends OAuthCredentials, TransportOptions {
  refreshToken: string;
}

/** Tokens for one installation. Store them per `installationId`, encrypted. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  /** Seconds the access token lives for, as sent by eBill. */
  expiresIn: number;
  /** `expiresIn` turned into a time, counted from when the answer arrived. */
  expiresAt: Date;
  installationId: string;
  scopes: string[];
}

function toTokenSet(body: unknown): TokenSet {
  const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { access_token, refresh_token, token_type, expires_in, installation_id, scopes } = value;
  if (
    typeof access_token !== "string" ||
    typeof refresh_token !== "string" ||
    token_type !== "Bearer" ||
    typeof expires_in !== "number" ||
    typeof installation_id !== "string" ||
    !Array.isArray(scopes) ||
    !scopes.every((scope): scope is string => typeof scope === "string")
  ) {
    throw new TypeError("The eBill token endpoint answered with an unexpected shape.");
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    tokenType: token_type,
    expiresIn: expires_in,
    expiresAt: new Date(Date.now() + expires_in * 1000),
    installationId: installation_id,
    scopes,
  };
}

async function requestToken(options: TransportOptions, form: Record<string, string>): Promise<TokenSet> {
  const transport = new Transport(options);
  const body = await transport.send({
    method: "POST",
    path: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    replayable: false,
  });
  return toTokenSet(body);
}

/** Turn the `code` from an install redirect into tokens. A code works once. */
export function exchangeCode(options: ExchangeCodeOptions): Promise<TokenSet> {
  return requestToken(options, {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });
}

/** Get a fresh access token. The answer may carry a new refresh token: store it in place of the old one. */
export function refreshToken(options: RefreshTokenOptions): Promise<TokenSet> {
  return requestToken(options, {
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });
}
