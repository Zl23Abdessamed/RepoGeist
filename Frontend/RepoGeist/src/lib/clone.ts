import { queryOptions } from "@tanstack/solid-query";
import { api } from "~/lib/api-client";
import { cloneKeys } from "./keys";
import { toApiError, isNotFoundResponse, retryTransientOnly } from "./errors";
import { normalizeCloneStatus, toNumberOrNull } from "./enums";

// ─────────────────────────────────────────────────────────────────────────
// Why this file exists (Guide.md §5.0)
// ─────────────────────────────────────────────────────────────────────────
//
// Cloning is a Tier 1.5 background job, fired AUTOMATICALLY the moment a repo is ingested.
// The clone — not analysis — is what powers the Code view: the file tree and file contents
// are served straight from it. So nothing in this file depends on, or should ever read,
// anything from ./analysis. If you find yourself importing an analysis key here, the two
// pipelines have been conflated — see Guide.md §5.0 for why that's the thing to avoid.
//
// (fileContentQuery used to live in analysis.ts, which misrepresented Code as depending on
// Tier 2. It moved here along with the new file-tree and clone-status queries.)

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/clone-status — ingestion-time "cloning…" state
// ─────────────────────────────────────────────────────────────────────────
//
// This is the INITIAL read. After it seeds the cache, /hub/clone pushes (signalr.ts) keep
// the same cache entry live, so a mounted panel updates without polling.
//
// A 404 here means "no clone job exists for this repo" — e.g. a repo ingested before the
// clone pipeline shipped. That's an expected state, not a failure, so it resolves to a
// "NotCloned" value rather than throwing. Callers get one uniform shape either way.

export interface CloneStatus {
  repoId: string | null;
  jobId: string | null;
  status: ReturnType<typeof normalizeCloneStatus>;
  /** 0–100 while Cloning; null when the backend isn't reporting progress. */
  progressPercent: number | null;
  errorMessage: string | null;
}

const NOT_CLONED: CloneStatus = {
  repoId: null,
  jobId: null,
  status: "NotCloned",
  progressPercent: null,
  errorMessage: null,
};

async function fetchCloneStatus(owner: string, name: string): Promise<CloneStatus> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/clone-status", {
    params: { path: { owner, name } },
  });

  if (isNotFoundResponse(response)) return NOT_CLONED;
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return {
    repoId: data.repoId ?? null,
    jobId: data.jobId ?? null,
    status: normalizeCloneStatus(data.status),
    progressPercent: toNumberOrNull(data.progressPercent),
    errorMessage: data.errorMessage ?? null,
  };
}

export const cloneStatusQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: cloneKeys.status(owner, name),
    queryFn: () => fetchCloneStatus(owner, name),
    retry: retryTransientOnly(2),
    // The hub keeps this live; there's no reason to refetch on every focus/mount.
    staleTime: 30_000,
  });

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/file-tree — flat node list for the Code view
// ─────────────────────────────────────────────────────────────────────────
//
// The backend returns a FLAT list (backend.md §6.2 — FileTreeDto.Nodes); each node carries
// only its own path + isDirectory, and parent relationships are derived client-side for the
// spatial file-node layout. `parentPath` is computed here once so the layout code doesn't
// each re-derive it.
//
// A 404 means the clone isn't ready/doesn't exist yet. Unlike clone-status this is NOT
// "expected and boring" — the Code view is unusable without a tree — but it isn't a crash
// either. It resolves to `null` so the leaf can render a "still cloning…" state (driven by
// cloneStatusQuery) instead of an error screen.

export interface FileTreeNode {
  path: string;
  isDirectory: boolean;
  /** Path of the containing directory, or "" for a root-level entry. */
  parentPath: string;
  /** Last path segment — the display name. */
  name: string;
}

export interface FileTree {
  repoId: string | null;
  nodes: FileTreeNode[];
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

async function fetchFileTree(owner: string, name: string): Promise<FileTree | null> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/file-tree", {
    params: { path: { owner, name } },
  });

  if (isNotFoundResponse(response)) return null;
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return {
    repoId: data.repoId ?? null,
    nodes: (data.nodes ?? [])
      // Drop malformed entries rather than let an undefined path crash the layout.
      .filter((n): n is { path: string; isDirectory?: boolean } => typeof n.path === "string")
      .map((n) => ({
        path: n.path,
        isDirectory: n.isDirectory === true,
        parentPath: parentOf(n.path),
        name: baseName(n.path),
      })),
  };
}

export const fileTreeQuery = (owner: string, name: string) =>
  queryOptions({
    queryKey: cloneKeys.tree(owner, name),
    queryFn: () => fetchFileTree(owner, name),
    retry: retryTransientOnly(2),
    // A clone is a fixed snapshot; the tree only changes if the repo is re-cloned.
    staleTime: 5 * 60_000,
    enabled: Boolean(owner && name),
  });

export type FileTreeResult = Awaited<ReturnType<typeof fetchFileTree>>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/repos/{owner}/{name}/files/{path} — single file content (code viewer)
// ─────────────────────────────────────────────────────────────────────────
//
// The backend serves this from the clone and, if the clone is missing, re-clones INLINE
// rather than 404ing (backend.md §6.4 — "Code should just work"). So a 404 here is genuinely
// "no such file in the clone" and is worth surfacing as `null` ("file not found") rather
// than a thrown error; callers render an empty/"not found" state.
//
// `path` contains slashes (`src/lib/keys.ts`). openapi-fetch would normally percent-encode
// those to "%2F", which ASP.NET rejects/mis-routes in a URL path. api-client.ts installs a
// middleware scoped to this one route that restores literal slashes on the wire, so callers
// just pass the plain repo-relative path here — no manual encoding needed.

export interface FileContent {
  path: string;
  content: string;
  /** Inferred backend-side from the extension; drives Shiki grammar selection. Null if unknown. */
  language: string | null;
}

async function fetchFileContent(
  owner: string,
  name: string,
  path: string,
): Promise<FileContent | null> {
  const { data, error, response } = await api.GET("/api/repos/{owner}/{name}/files/{path}", {
    params: { path: { owner, name, path } },
  });

  if (isNotFoundResponse(response)) return null;
  if (error !== undefined || data === undefined) throw toApiError(response, error);

  return {
    path: data.path ?? path,
    content: data.content ?? "",
    language: data.language ?? null,
  };
}

export const fileContentQuery = (owner: string, name: string, path: string) =>
  queryOptions({
    queryKey: cloneKeys.file(owner, name, path),
    queryFn: () => fetchFileContent(owner, name, path),
    retry: retryTransientOnly(2),
    // File contents are immutable for a given clone.
    staleTime: 10 * 60_000,
    enabled: Boolean(owner && name && path),
  });