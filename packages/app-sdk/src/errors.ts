export interface EbillApiErrorInit {
  status: number;
  error: string;
  message: string;
  reference?: string | undefined;
  retryAfter?: number | undefined;
}

/**
 * A non-2xx answer from the eBill API.
 * Quote `reference` when you contact eBill support about a failed call.
 */
export class EbillApiError extends Error {
  override readonly name = "EbillApiError";
  readonly status: number;
  /** Machine-readable code, for example `invalid_request` or `rate_limited`. */
  readonly error: string;
  readonly reference: string | undefined;
  /** Seconds to wait before trying again, when the server sent `Retry-After`. */
  readonly retryAfter: number | undefined;

  constructor(init: EbillApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.error = init.error;
    this.reference = init.reference;
    this.retryAfter = init.retryAfter;
  }
}

/** The request never got an HTTP answer: DNS, connection, TLS or timeout. */
export class EbillNetworkError extends Error {
  override readonly name = "EbillNetworkError";
}

export type WebhookVerificationFailure =
  "malformed_header" | "timestamp_out_of_tolerance" | "signature_mismatch" | "invalid_body" | "unknown_topic" | "delivery_mismatch";

/** A webhook that failed verification. Answer it with a 400 and do not act on it. */
export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}
