import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";
import { api } from "~/lib/api-client";
import { repoKeys, cloneKeys } from "./keys";
import { toApiError } from "./errors";
import {
  normalizeHealthStatus,
  normalizeAnalysisStatus,
  toNumber,
  type HealthStatusValue,
} from "./enums";

// Re-exported for backwards compatibility: canvas/components/utils.ts (and anything else
// written before enums.ts existed) imports these from "~/lib/repos". The implementations
// now live in ./enums so repos.ts / health.ts / signalr.ts share ONE copy instead of three.
export { normalizeHealthStatus };
export type { HealthStatusValue };

// ─────────────────────────────────────────────────────────────────────────
// Shared response-shape note
// ─────────────────────────────────────────────────────────────────────────
// RepoCardDto.healthStatus, RepoDetailDto.healthStatus and RepoDetailDto.analysisStatus
// are typed by openapi-typescript as `number` (it reflects the enum's CLR type), but
// RepogeistDbContext maps enums with `.HasConversion<string>()` (backend.md §6.8), so the
// JSON on the wire is a string ("Up", "Succeeded", ...). See ./enums.ts for the full story —
// every normalizer there is the single place that papers over it, so consumers downstream
// get real union types instead of `number`.

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos — the canvas's card list (Guide.md §4.1)
// ─────────────────────────────────────────────────────────────────────────
//
// queryFn is factored out to a standalone named function, and the exported type is
// derived from THAT function, not by reaching back into queryOptions()'s return
// value. queryOptions() types `queryFn` as optional on the object it returns (it has
// to, generically — disabled/skip-token queries can omit it), so
// `ReturnType<typeof someQuery>["queryFn"]` is `QueryFunction<...> | undefined`, and
// `ReturnType<T | undefined>` doesn't satisfy ReturnType's `(...args: any) => any`
// constraint — that's the TS2344 error. Naming the function first sidesteps this
// entirely: a plain `async function`'s type is never optional.
async function fetchRepoCards() {
  const { data, error, response } = await api.GET("/api/repos");
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return data.map((card) => ({
    ...card,
    healthStatus: normalizeHealthStatus(card.healthStatus),
  }));
}

export const repoCardsQuery = () =>
  queryOptions({
    queryKey: repoKeys.all,
    queryFn: fetchRepoCards,
  });

export type RepoCard = Awaited<ReturnType<typeof fetchRepoCards>>[number];

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name} — Level 2 detail panel (Guide.md §4.3)
// ─────────────────────────────────────────────────────────────────────────
//
// `analysisStatus` is new on RepoDetailDto. It drives the Overview panel's "Analyze"
// button vs. "Analyzed" indicator (Guide.md §5.0) and is independent of clone state —
// Code never reads it. The numeric fields are coerced here (types.ts widens int32 to
// `number | string`) so the panel can do arithmetic/format them without casting.
function shapeRepoDetail(data: NonNullable<Awaited<ReturnType<typeof rawFetchRepoDetail>>["data"]>) {
  return {
    ...data,
    healthStatus: normalizeHealthStatus(data.healthStatus),
    analysisStatus: normalizeAnalysisStatus(data.analysisStatus),
    stars: toNumber(data.stars),
    forks: toNumber(data.forks),
    languages: (data.languages ?? []).map((l) => ({ ...l, byteCount: toNumber(l.byteCount) })),
    contributors: (data.contributors ?? []).map((c) => ({
      ...c,
      commitCount: toNumber(c.commitCount),
    })),
    commitActivity: (data.commitActivity ?? []).map((w) => ({
      ...w,
      commitCount: toNumber(w.commitCount),
    })),
  };
}

function rawFetchRepoDetail(owner: string, name: string) {
  return api.GET("/api/repos/{owner}/{name}", {
    params: { path: { owner, name } },
  });
}

async function fetchRepoDetail(owner: string, name: string) {
  const { data, error, response } = await rawFetchRepoDetail(owner, name);
  if (error !== undefined || data === undefined) throw toApiError(response, error);
  return shapeRepoDetail(data);
}

export const repoDetailQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: repoKeys.detail(owner, name),
    queryFn: () => fetchRepoDetail(owner, name),
    // Detail data (README, contributors, commit activity) doesn't change on its own —
    // only a sync, a health push, or an analysis push updates it — so it's safe to treat
    // as fresh for a while rather than refetching on every mount/focus.
    staleTime: 60_000,
  });

export type RepoDetail = Awaited<ReturnType<typeof fetchRepoDetail>>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/repos — ingest a new public repo by URL (Guide.md §4.2)
// ─────────────────────────────────────────────────────────────────────────
//
// The backend returns the Tier 1 card immediately and fires the clone job in the
// background (Guide.md §5.0) — it does NOT wait for the clone. So on success we can't
// assume a clone exists yet; instead we (a) refresh the card list and (b) drop any stale
// clone-status for this repo so the next read reflects the fresh job. The /hub/clone
// pushes (see signalr.ts) then keep that status live from there.

export function createRepoMutation(queryClient: QueryClient) {
  return {
    mutationFn: async (repoUrl: string) => {
      const { data, error, response } = await api.POST("/api/repos", {
        body: { repoUrl },
      });
      if (error !== undefined || data === undefined) throw toApiError(response, error);

      return {
        ...data,
        healthStatus: normalizeHealthStatus(data.healthStatus),
      };
    },
    onSuccess: (created: { owner?: string; name?: string }) => {
      queryClient.invalidateQueries({ queryKey: repoKeys.all });
      // Re-ingesting a repo that was previously added can leave a stale "Failed"/"Ready"
      // clone-status cached. Clear it so the first read after ingestion is fresh.
      if (created.owner && created.name) {
        queryClient.removeQueries({ queryKey: cloneKeys.status(created.owner, created.name) });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/repos/{owner}/{name}/sync — force a re-sync from GitHub (Guide.md §4.2)
// ─────────────────────────────────────────────────────────────────────────

export function syncRepoMutation(queryClient: QueryClient) {
  return {
    mutationFn: async (vars: { owner: string; name: string }) => {
      const { data, error, response } = await api.POST("/api/repos/{owner}/{name}/sync", {
        params: { path: { owner: vars.owner, name: vars.name } },
      });
      if (error !== undefined || data === undefined) throw toApiError(response, error);
      return shapeRepoDetail(data);
    },
    onSuccess: (_data: unknown, vars: { owner: string; name: string }) => {
      // Sync can change description/topics/language/stars/forks/live-demo-url — both
      // the card list (cheap fields shown on cards) and this repo's own detail cache
      // entry are now stale.
      queryClient.invalidateQueries({ queryKey: repoKeys.all });
      queryClient.invalidateQueries({ queryKey: repoKeys.detail(vars.owner, vars.name) });
    },
  };
}