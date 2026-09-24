import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";
import { api } from "~/lib/api-client";
import { analysisKeys, repoKeys } from "./keys";
import { toApiError, isNotFoundResponse, retryTransientOnly } from "./errors";
import { normalizeAnalysisStatus, toNumberOrNull } from "./enums";
import type { AnalysisStatusValue } from "./enums";

// ─────────────────────────────────────────────────────────────────────────
// Scope (Guide.md §5.0)
// ─────────────────────────────────────────────────────────────────────────
//
// Analysis is the OPTIONAL Tier 2 pipeline: parse the clone → dependency graph. It is
// about the *graph* specifically. It says nothing about whether Code is available — Code
// works off the clone alone (see ./clone). So nothing here is a prerequisite for viewing
// files, and the "Analyzed" / "Analyze" UI must not be presented as "is Code ready."
//
// (fileContentQuery used to live in this file, which implied Code depended on analysis.
// It moved to ./clone along with the new file-tree and clone-status queries.)

// ─────────────────────────────────────────────────────────────────────────
// Shared status shape
// ─────────────────────────────────────────────────────────────────────────

export interface AnalysisStatus {
  repoId: string | null;
  jobId: string | null;
  status: AnalysisStatusValue;
  /** 0–100 while Running; null when the backend isn't reporting progress. */
  progressPercent: number | null;
  errorMessage: string | null;
}

/** "This repo has never had an analysis job." Distinct from Failed/Queued — see enums.ts. */
const NOT_ANALYZED: AnalysisStatus = {
  repoId: null,
  jobId: null,
  status: "NotAnalyzed",
  progressPercent: null,
  errorMessage: null,
};

type AnalysisStatusWire = {
  repoId?: string;
  jobId?: string;
  status?: string;
  progressPercent?: null | number | string;
  errorMessage?: null | string;
};

/** Shapes a raw AnalysisStatusDto into the AnalysisStatus the UI consumes. */
export function shapeAnalysisStatus(data: AnalysisStatusWire): AnalysisStatus {
  return {
    repoId: data.repoId ?? null,
    jobId: data.jobId ?? null,
    status: normalizeAnalysisStatus(data.status),
    progressPercent: toNumberOrNull(data.progressPercent),
    errorMessage: data.errorMessage ?? null,
  };
}

/** True while a job is in flight — used to disable the "Analyze" button and show progress. */
export function isAnalysisActive(status: AnalysisStatusValue): boolean {
  return status === "Queued" || status === "Running";
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/analysis-status — drives "Analyze" vs. "Analyzed"
// ─────────────────────────────────────────────────────────────────────────
//
// Seeds the initial state for SidePanel Overview's Analyze/Analyzed treatment; the
// /hub/analysis pushes (signalr.ts) keep the same cache entry live afterward.
//
// The spec now documents a 404 (ProblemDetails) for this route, meaning "no analysis job
// exists for this repo yet". That's the normal state for a freshly-ingested repo, so it
// resolves to NOT_ANALYZED rather than throwing — the panel then shows the "Analyze" button.

async function fetchAnalysisStatus(owner: string, name: string): Promise<AnalysisStatus> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/analysis-status", {
    params: { path: { owner, name } },
  });

  if (isNotFoundResponse(response)) return NOT_ANALYZED;
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return shapeAnalysisStatus(data);
}

export const analysisStatusQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: analysisKeys.status(owner, name),
    queryFn: () => fetchAnalysisStatus(owner, name),
    retry: retryTransientOnly(2),
    // The hub keeps this live; no need to refetch on every focus/mount.
    staleTime: 30_000,
    enabled: Boolean(owner && name),
  });

// ─────────────────────────────────────────────────────────────────────────
// POST /api/repos/{owner}/{name}/analyze — kick off a Tier 2 analysis job
// ─────────────────────────────────────────────────────────────────────────
//
// The job itself checks for an existing clone first and only re-clones if it's missing
// (backend.md §6.6 — RunAnalysisJobAsync step 3), so this is safe to call whether or not
// the original ingestion-time clone succeeded.
//
// The returned AnalysisStatusDto is the freshly-created job (typically "Queued"). We write
// it straight into the analysis-status cache so the Overview panel flips from "Analyze" to
// a queued/running state immediately, without waiting for the first hub push or a refetch.

export function analyzeRepoMutation(queryClient: QueryClient) {
  return {
    mutationFn: async (vars: { owner: string; name: string }) => {
      const { data, error, response } = await api.POST("/api/repos/{owner}/{name}/analyze", {
        params: { path: { owner: vars.owner, name: vars.name } },
      });
      if (error !== undefined || data === undefined) throw toApiError(response, error);
      return shapeAnalysisStatus(data);
    },
    onSuccess: (status: AnalysisStatus, vars: { owner: string; name: string }) => {
      queryClient.setQueryData<AnalysisStatus>(analysisKeys.status(vars.owner, vars.name), status);

      // A fresh run means whatever graph is cached is about to be superseded. Mark it stale
      // (don't remove it) so a mounted Graph view keeps showing the old graph until the
      // new one lands, rather than flashing empty mid-run.
      queryClient.invalidateQueries({ queryKey: analysisKeys.graph(vars.owner, vars.name) });

      // RepoDetailDto carries its own analysisStatus field; keep that entry consistent too.
      queryClient.setQueryData<{ analysisStatus: AnalysisStatusValue } | undefined>(
        repoKeys.detail(vars.owner, vars.name),
        (detail) => (detail ? { ...detail, analysisStatus: status.status } : detail),
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/graph — the cached computed dependency graph
// ─────────────────────────────────────────────────────────────────────────
//
// Resolves to `null` for a 404 — "this repo hasn't been analyzed" — rather than throwing,
// because that's the expected state for most repos most of the time. Per Frontend.md's data
// flow, the graph leaf should treat `null` as "send the person back to Overview's Analyze
// action" instead of rendering an empty graph.
//
// The spec now declares a 404 (ProblemDetails) on this route, so `error` types properly and
// the old `response.status`-outside-`if (error)` workaround — which existed only because the
// spec used to document a bare 200 — is gone. We still key the 404 check off `response`,
// not `error`: ASP.NET can return either problem+json or a plain-text body for a 404, and
// `error` is a string in the latter case, so `error.status` isn't dependable.
//
// Node/edge fields come back optional; malformed entries are filtered here so the d3-force
// layout downstream never sees a node without an id or an edge without endpoints.

export interface GraphNode {
  id: string;
  nodeType: string;
  pathOrName: string;
}

export interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
}

export interface DependencyGraph {
  repoId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

async function fetchDependencyGraph(owner: string, name: string): Promise<DependencyGraph | null> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/graph", {
    params: { path: { owner, name } },
  });

  if (isNotFoundResponse(response)) return null;
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  const nodes: GraphNode[] = (data.nodes ?? [])
    .filter((n): n is { id: string; nodeType?: string; pathOrName?: string } => typeof n.id === "string")
    .map((n) => ({
      id: n.id,
      nodeType: n.nodeType ?? "File",
      pathOrName: n.pathOrName ?? "",
    }));

  // An edge pointing at a node that isn't in the list would make d3-force throw
  // ("node not found"), so drop dangling edges here rather than at layout time.
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = (data.edges ?? [])
    .filter(
      (e): e is { sourceNodeId: string; targetNodeId: string; edgeType?: string } =>
        typeof e.sourceNodeId === "string" &&
        typeof e.targetNodeId === "string" &&
        ids.has(e.sourceNodeId) &&
        ids.has(e.targetNodeId),
    )
    .map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      edgeType: e.edgeType ?? "Imports",
    }));

  return { repoId: data.repoId ?? null, nodes, edges };
}

export const dependencyGraphQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: analysisKeys.graph(owner, name),
    queryFn: () => fetchDependencyGraph(owner, name),
    // A 404 already resolved to `null` above, so it never reaches retry. What does reach it
    // is a real failure — retry only the transient kind (5xx / network), never a 4xx.
    retry: retryTransientOnly(2),
    // A computed graph only changes when a new analysis run finishes, and the hub
    // invalidates this key at that moment — so it's safe to treat as fresh meanwhile.
    staleTime: 5 * 60_000,
    enabled: Boolean(owner && name),
  });