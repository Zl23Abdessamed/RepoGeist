// Centralized query-key factories. Every query/mutation file below imports its keys
// from here rather than inlining array literals, so a SignalR handler patching the
// cache (HealthUpdate/CloneUpdate/AnalysisUpdate — TechGuide.md §2.7) can reference the
// exact same key a component's createQuery used, with no risk of a typo desyncing the two.
//
// KEY-SHAPE CONVENTION. Every per-repo key starts with ["repo", owner, name, <segment>, ...].
// The shared ["repo", owner, name] prefix means `invalidateQueries({ queryKey: [...] })`
// can sweep everything for one repo — but it also means a prefix match is BROAD (it hits
// health, commit-activity, clone, and analysis keys alike). When a handler needs to touch
// only one concern, match on the segment at index 3 with a predicate rather than slicing
// the prefix — see `repoSegmentPredicate` below, used by signalr.ts.
//
// (repoKeys.detail is the one exception: ["repo", owner, name] with NO segment — it IS the
// shared prefix. That's why a prefix-style `invalidateQueries({ queryKey: repoKeys.detail(...) })`
// sweeps every concern for the repo, while `repoSegmentPredicate` never matches it, since
// the predicate requires a segment at index 3.)
export const repoKeys = {
  all: ["repos"] as const,
  detail: (owner: string, name: string) => ["repo", owner, name] as const,
};

export const healthKeys = {
  history: (owner: string, name: string, limit?: number) =>
    ["repo", owner, name, "health", limit ?? "default"] as const,
};

export const commitActivityKeys = {
  activity: (owner: string, name: string, weeks?: number) =>
    ["repo", owner, name, "commit-activity", weeks ?? "default"] as const,
};

// Analysis = the OPTIONAL Tier 2 pipeline (parse → dependency graph). It is deliberately
// separate from cloning below: Code works off the clone alone and never touches these
// (Guide.md §5.0). `file`/`file-tree` used to live here; they moved to cloneKeys because
// keeping them under "analysis" misrepresented Code as depending on analysis.
export const analysisKeys = {
  status: (owner: string, name: string) => ["repo", owner, name, "analysis-status"] as const,
  graph: (owner: string, name: string) => ["repo", owner, name, "graph"] as const,
};

// Cloning = the Tier 1.5 background job fired automatically on ingestion. It is what makes
// the Code view work: file tree + file contents are served straight from the clone.
export const cloneKeys = {
  status: (owner: string, name: string) => ["repo", owner, name, "clone-status"] as const,
  tree: (owner: string, name: string) => ["repo", owner, name, "file-tree"] as const,
  file: (owner: string, name: string, path: string) =>
    ["repo", owner, name, "file", path] as const,
};

/**
 * Builds a `predicate` for invalidateQueries/setQueriesData that matches every query
 * belonging to ONE concern of ONE repo, at any parameters (e.g. any `limit`).
 *
 *     invalidateQueries({ predicate: repoSegmentPredicate(owner, name, "health") })
 *
 * matches ["repo", owner, name, "health", <anything>...] and nothing else — in particular
 * NOT the sibling "commit-activity"/"graph"/"clone-status" keys that share the same
 * ["repo", owner, name] prefix, which a plain `queryKey` prefix match would also sweep up.
 */
export function repoSegmentPredicate(owner: string, name: string, segment: string) {
  return (query: { queryKey: readonly unknown[] }): boolean => {
    const k = query.queryKey;
    return k[0] === "repo" && k[1] === owner && k[2] === name && k[3] === segment;
  };
}