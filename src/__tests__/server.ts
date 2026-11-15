/**
 * The mock API for Vitest: the dev preview's handlers (`src/dev/msw`) on
 * `msw/node`. `vitest.setup.ts` starts it with `onUnhandledRequest: 'error'`
 * and, after every test, drops the test's own handlers and puts the fixture
 * state back.
 *
 * A test changes one answer with a typed handler:
 *
 *   server.use(http.get('/workspaces/{workspace_id}/usage', ({ response }) => response(200).json(…)));
 *
 * and a failure with `problem(code, detail, extra)`. A test that sends a
 * shape off the contract, to see the client refuse it, says so with
 * `response.untyped(HttpResponse.json(…))`.
 */
import { setupServer } from 'msw/node';
import { handlers, problem } from '@/dev/msw/handlers';

export const server = setupServer(...handlers);

export { agentHttp, http, invalidRequest, problem } from '@/dev/msw/handlers';
export { HttpResponse, delay } from 'msw';

/**
 * The server failing, for a test's stand-in that throws: a 500 problem whose
 * detail is the error's message, which is what the app shows.
 */
export function serverError(error: unknown) {
  return problem('internal_error', error instanceof Error ? error.message : String(error));
}

const recordings = new Set<Request[]>();
server.events.on('request:start', ({ request }) => {
  for (const sent of recordings) sent.push(request.clone());
});

/**
 * Every request the app sends from now until the test ends, in order, as
 * the server received it. Its body can still be read.
 */
export function recordRequests(): Request[] {
  const sent: Request[] = [];
  recordings.add(sent);
  return sent;
}

/** End the test's recordings (`vitest.setup.ts`, after each test). */
export function stopRecording(): void {
  recordings.clear();
}

const unhandled: string[] = [];
server.events.on('request:unhandled', ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

/** The requests no handler answered since the last call, which fail the test that sent them. */
export function takeUnhandled(): string[] {
  return unhandled.splice(0);
}

/**
 * A route answered by a test's stand-in: `send` answers what `get` returns,
 * and what `get` throws is the server failing (`serverError`).
 *
 *   http.get('/workspaces/{workspace_id}/resources', ({ request, response }) =>
 *     respond(() => mocks.list(queryOf(request)), (body) => response(200).json(body)))
 */
export async function respond<Body, Reply>(get: () => Body | Promise<Body>, send: (body: Body) => Reply) {
  try {
    return send(await get());
  } catch (error) {
    return serverError(error);
  }
}

/** The query parameters of a request. */
export function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/** Path and query of a request, as the API sees them behind the `/api` proxy. */
export function pathOf(request: Request | undefined): string {
  if (!request) throw new Error('No such request was sent');
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/** The JSON body of a recorded request. */
export async function jsonOf(request: Request | undefined): Promise<unknown> {
  if (!request) throw new Error('No such request was sent');
  const text = await request.clone().text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

/**
 * The text fields of a multipart request. Under jsdom, `FormData` and `File`
 * are jsdom's while `Request` is Node's, which serializes the form but cannot
 * parse it back (and loses a file's bytes and name); a browser has neither
 * problem. A file part is listed by its name as `file:<content type>`.
 */
export async function multipartFields(request: Request): Promise<Record<string, string>> {
  const text = await request.clone().text();
  const fields: Record<string, string> = {};
  for (const part of text.split(/\r\n--[^\r\n]+/)) {
    const match = /name="([^"]+)"(?:; filename="[^"]*"\r\nContent-Type: ([^\r\n]*))?[^]*?\r\n\r\n([^]*)$/.exec(part);
    if (!match?.[1]) continue;
    fields[match[1]] = match[2] !== undefined ? `file:${match[2]}` : (match[3] ?? '');
  }
  return fields;
}
