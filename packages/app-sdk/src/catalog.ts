/** Every scope an app can ask for, with the label the user sees when approving the install. */
export const SCOPES = {
  "drafts:write": "Create and change drafts",
  "documents:send": "Send documents in your name",
  "documents:read": "See documents you send and what happened to them",
  "documents:received:read": "See documents you receive",
  "files:read": "Download the files on your documents",
  "contacts:read": "See your contacts",
  "payments:read": "See payments on your invoices",
  "payments:write": "Record payments and answer them in your name",
} as const;

export type Scope = keyof typeof SCOPES;

export const SCOPE_NAMES = Object.keys(SCOPES) as readonly Scope[];

/** Every webhook topic, with the scope an app must hold to subscribe to it (`null` when none is needed). */
export const TOPICS = {
  "document.sent": "documents:read",
  "document.delivered": "documents:read",
  "document.failed": "documents:read",
  "document.received": "documents:received:read",
  "payment.proposed": "payments:read",
  "payment.answered": "payments:read",
  "app.installed": null,
  "app.uninstalled": null,
  "app.settings.updated": null,
} as const satisfies Record<string, Scope | null>;

export type Topic = keyof typeof TOPICS;

export const TOPIC_NAMES = Object.keys(TOPICS) as readonly Topic[];

export function isScope(value: string): value is Scope {
  return Object.hasOwn(SCOPES, value);
}

export function isTopic(value: string): value is Topic {
  return Object.hasOwn(TOPICS, value);
}

/** The scope a topic needs, or `null` for topics every app may receive. */
export function requiredScope(topic: Topic): Scope | null {
  return TOPICS[topic];
}
