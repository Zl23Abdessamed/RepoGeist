// ─────────────────────────────────────────────────────────────────────────
// Shared HTTP error handling for every query/mutation in ~/lib
// ─────────────────────────────────────────────────────────────────────────
//
// Why this file exists: openapi-fetch hands back `{ data, error, response }`, and
// what `error` actually IS at runtime depends on what the server sent:
//
//   • A JSON/problem+json body  → `error` is the parsed object  ({ title, status, ... })
//   • A text/plain body         → `error` is a *string*
//   • An empty body             → `error` is `undefined`-ish / empty string
//
// ASP.NET Core returns text/plain for a bare `NotFound()` and problem+json for
// `NotFound(problemDetails)`, so both shapes occur on the very same route depending
// on which controller path fired. That makes `"status" in error` (or `error.status`)
// an unreliable way to detect a 404 — it silently fails on the string form.
//
// `response.status`, on the other hand, is ALWAYS present and always correct. So
// every helper here is built on the Response, and `error` is only used to pull a
// human-readable message out.
//
// Usage inside a queryFn:
//
//     const { data, error, response } = await api.GET(...);
//     if (isNotFoundResponse(response)) return null;        // expected "nothing yet"
//     if (error !== undefined || data === undefined) throw toApiError(response, error);

/** The subset of ProblemDetails we read a message from. */
interface ProblemLike {
  title?: string | null;
  detail?: string | null;
}

/** An HTTP failure carrying its real status code, so callers/retry logic can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  /** The raw `error` payload from openapi-fetch (object, string, or undefined). */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Pulls the most useful human-readable message out of whatever `error` turned out to be. */
function messageFrom(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (error && typeof error === "object") {
    const p = error as ProblemLike;
    // `detail` is the specific reason; `title` is the generic category. Prefer specific.
    if (p.detail) return p.detail;
    if (p.title) return p.title;
  }
  return fallback;
}

/** Builds an ApiError from a failed openapi-fetch result. */
export function toApiError(response: Response, error: unknown): ApiError {
  const fallback = `Request failed (HTTP ${response.status})`;
  return new ApiError(response.status, messageFrom(error, fallback), error);
}

/** True for a genuine HTTP 404 — "this resource doesn't exist (yet)". */
export function isNotFoundResponse(response: Response): boolean {
  return response.status === 404;
}

/** Type guard for errors thrown out of a queryFn/mutationFn. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * TanStack Query `retry` predicate: retry transient failures a couple of times,
 * but never retry a definitive client-side answer.
 *
 *   • 4xx (incl. 404, 501)  → the server understood and said no. Retrying just repeats it.
 *   • 5xx / network errors  → possibly transient, retry up to `maxRetries` times.
 *
 * A non-ApiError (e.g. `TypeError: Failed to fetch`) is a network failure and is retried.
 */
export function retryTransientOnly(maxRetries = 2) {
  return (failureCount: number, err: unknown): boolean => {
    if (failureCount >= maxRetries) return false;
    if (isApiError(err) && err.status >= 400 && err.status < 500) return false;
    // 501 is a 5xx but is a permanent "not implemented", not a transient fault.
    if (isApiError(err) && err.status === 501) return false;
    return true;
  };
}