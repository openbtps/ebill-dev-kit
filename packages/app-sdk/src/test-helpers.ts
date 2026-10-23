import { mock } from "node:test";

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export type Reply = Response | Error;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch that answers from a script, one reply per call, and records what it was asked. */
export function fakeFetch(replies: Reply[]): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...replies];
  const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("fakeFetch: no reply left"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, calls };
}

/** Drive mocked timers until the promise settles, so backoff waits pass instantly. */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  const state = { done: false };
  promise.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  while (!state.done) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.runAll();
  }
  return promise;
}

export function header(call: FetchCall | undefined, name: string): string | undefined {
  const headers = call?.init.headers as Record<string, string> | undefined;
  return headers?.[name];
}
