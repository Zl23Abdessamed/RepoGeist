import { queryOptions } from "@tanstack/solid-query";
import { api } from "~/lib/api-client";
import { healthKeys, commitActivityKeys } from "./keys";
import { toApiError, retryTransientOnly } from "./errors";
import { normalizeHealthStatus, normalizeUtcTimestamp, toNumber, toNumberOrNull } from "./enums";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/health — historical health checks (Guide.md §4.5)
// ─────────────────────────────────────────────────────────────────────────
//
// This is a history/on-demand read only. *Live* status changes arrive over
// /hub/health (TechGuide.md §2.7) — see signalr.ts, which patches the card/detail caches
// in place and invalidates this history query (via a segment predicate) when it's mounted.
//
// `limit` is `number | string` in the generated types (int32 widening); the backend
// defaults it to 100 when omitted (backend.md §6.4), so `undefined` is a valid "use default".
//
// queryFn factored to a named function — see repos.ts's fetchRepoCards for why: deriving a
// type by reaching into queryOptions()'s return value fails because queryOptions() types
// queryFn as optional, and ReturnType<T | undefined> isn't valid.

export interface HealthCheckEntry {
  repoId: string | null;
  status: ReturnType<typeof normalizeHealthStatus>;
  /** null when the check never got a response (e.g. status "Down"). */
  responseTimeMs: number | null;
  /** ISO-8601 UTC timestamp (always zone-qualified — see normalizeUtcTimestamp). Null if unparseable. */
  checkedAt: string | null;
}

async function fetchHealthHistory(
  owner: string,
  name: string,
  limit?: number,
): Promise<HealthCheckEntry[]> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/health", {
    params: {
      path: { owner, name },
      query: limit !== undefined ? { limit } : undefined,
    },
  });
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return data.map((check) => ({
    repoId: check.repoId ?? null,
    status: normalizeHealthStatus(check.status),
    responseTimeMs: toNumberOrNull(check.responseTimeMs),
    checkedAt: normalizeUtcTimestamp(check.checkedAt),
  }));
}

export const healthHistoryQuery = (owner: string, name: string, limit?: number) =>
  queryOptions({
    queryKey: healthKeys.history(owner, name, limit),
    queryFn: () => fetchHealthHistory(owner, name, limit),
    retry: retryTransientOnly(2),
    enabled: Boolean(owner && name),
  });

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/commit-activity — weekly commit counts
// ─────────────────────────────────────────────────────────────────────────
//
// `weekStart` is the UTC Monday that starts the week (backend.md §6.1). `commitCount` is
// coerced to a real number here (types.ts widens it to `number | string`) so a chart can
// scale bars without casting, and `weekStart` is normalized to an explicit-UTC timestamp so
// it can't shift days for non-UTC users. Sorted oldest→newest so consumers can plot
// left-to-right without each re-sorting — the backend doesn't promise an order.

export interface CommitActivityEntry {
  /** ISO-8601 UTC timestamp of the week's start (a Monday). Always zone-qualified. */
  weekStart: string;
  commitCount: number;
}

async function fetchCommitActivity(
  owner: string,
  name: string,
  weeks?: number,
): Promise<CommitActivityEntry[]> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/commit-activity", {
    params: {
      path: { owner, name },
      query: weeks !== undefined ? { weeks } : undefined,
    },
  });
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  const entries: CommitActivityEntry[] = [];
  for (const w of data) {
    const weekStart = normalizeUtcTimestamp(w.weekStart);
    if (weekStart === null) continue; // drop entries with no usable date
    entries.push({ weekStart, commitCount: toNumber(w.commitCount) });
  }
  // Sort on the parsed instant, not the string: normalized strings can still differ in
  // fractional-second precision, which makes lexicographic order unreliable.
  return entries.sort((a, b) => Date.parse(a.weekStart) - Date.parse(b.weekStart));
}

export const commitActivityQuery = (owner: string, name: string, weeks?: number) =>
  queryOptions({
    queryKey: commitActivityKeys.activity(owner, name, weeks),
    queryFn: () => fetchCommitActivity(owner, name, weeks),
    // GitHub-sourced, only refreshed by a sync — no need to refetch aggressively.
    staleTime: 5 * 60_000,
    retry: retryTransientOnly(2),
    enabled: Boolean(owner && name),
  });