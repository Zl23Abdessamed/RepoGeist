import * as signalR from "@microsoft/signalr";
import type { QueryClient } from "@tanstack/solid-query";
import { API_ORIGIN } from "./api-client";
import { repoKeys, analysisKeys, cloneKeys, repoSegmentPredicate } from "./keys";
import {
  normalizeHealthStatus,
  normalizeAnalysisStatus,
  normalizeCloneStatus,
  toNumberOrNull,
  type HealthStatusValue,
  type AnalysisStatusValue,
} from "./enums";
import { shapeAnalysisStatus, type AnalysisStatus } from "./analysis";
import type { CloneStatus } from "./clone";

// ─────────────────────────────────────────────────────────────────────────
// Hub base URL
// ─────────────────────────────────────────────────────────────────────────
//
// Built from the SAME API_ORIGIN the REST client uses (api-client.ts). This file used to
// hardcode "http://localhost:5221" as a second copy, which meant setting VITE_API_URL would
// point REST at one host and the live hubs at another. Hubs sit at the origin root
// (`/hub/*`), NOT under `/api`, which is why only the origin is shared, not a path prefix.
const HUB_ORIGIN = API_ORIGIN;

// ─────────────────────────────────────────────────────────────────────────
// Wire shapes pushed over the hubs
// ─────────────────────────────────────────────────────────────────────────
//
// SignalR payloads aren't part of the OpenAPI spec (hubs aren't HTTP actions), so there's no
// generated type to import — these are hand-written against the same DTOs the REST routes
// use (backend.md §6.2). Every field is loosely typed on purpose: a push is untrusted input
// arriving on a socket, and each handler shapes it through the shared normalizers in
// ./enums (and ./analysis's shapeAnalysisStatus) rather than trusting the declared type.
//
// Enum fields hit the same wire-vs-type quirk documented in ./enums: the backend stores
// enums as strings (`HasConversion<string>()`, backend.md §6.8), so they arrive as
// "Up"/"Running"/"Ready"/... and the normalizers turn them into real unions.
interface HealthStatusPush {
  repoId?: string;
  status?: unknown;
  responseTimeMs?: number | string | null;
  checkedAt?: string;
}

interface CloneStatusPush {
  repoId?: string;
  jobId?: string;
  status?: unknown;
  progressPercent?: number | string | null;
  errorMessage?: string | null;
}

interface AnalysisStatusPush {
  repoId?: string;
  jobId?: string;
  status?: unknown;
  progressPercent?: number | string | null;
  errorMessage?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Event names
// ─────────────────────────────────────────────────────────────────────────
//
// backend.md §6.5 gives the hub METHOD names (BroadcastHealthUpdate / BroadcastCloneUpdate /
// BroadcastAnalysisUpdate) but never the client-side event string passed to
// `SendAsync(...)`, and no other doc specifies it either. That's a silent-failure hazard:
// SignalR simply never invokes a handler whose name doesn't match — no error, no warning.
//
// Rather than bet on one convention, each hub listens under every plausible name. This is
// safe: a server sends one name per push, a handler registered under a name fires only for
// that name, and unregistered names are inert (verified against a real SignalR-protocol
// server — no double-firing from a single push). Once you confirm the actual string in the
// hub's `SendAsync` call, trim the list to that one.
const HEALTH_EVENTS = ["HealthUpdate", "BroadcastHealthUpdate", "ReceiveHealthUpdate"] as const;
const CLONE_EVENTS = ["CloneUpdate", "BroadcastCloneUpdate", "ReceiveCloneUpdate"] as const;
const ANALYSIS_EVENTS = ["AnalysisUpdate", "BroadcastAnalysisUpdate", "ReceiveAnalysisUpdate"] as const;

/** Registers one handler under several event names. */
function onAny<T>(
  connection: signalR.HubConnection,
  names: readonly string[],
  handler: (push: T) => void,
): void {
  for (const n of names) connection.on(n, handler);
}

// ─────────────────────────────────────────────────────────────────────────
// repoId → owner/name
// ─────────────────────────────────────────────────────────────────────────
//
// Every query key in keys.ts is keyed by owner/name, but all three push DTOs carry only
// repoId (backend.md §6.2 — none of HealthStatusDto/CloneStatusDto/AnalysisStatusDto
// includes Owner/Name). GET /api/repos already returns every RepoCardDto (which carries id,
// owner, name), so rather than adding a lookup endpoint this resolves repoId against the
// repoKeys.all query cache — the same list the canvas renders from.
//
// A repoId with no match is dropped by the caller. The realistic cause is a push arriving
// before the card list has loaded, OR (new with cloning) a push for a repo that was JUST
// ingested: the clone job starts immediately, so its first "Queued"/"Cloning" push can beat
// the refetch that brings the new card into the cache. See `resolveOrRefresh` below, which
// handles that race instead of silently losing the update.
function resolveOwnerName(
  queryClient: QueryClient,
  repoId: string,
): { owner: string; name: string } | null {
  const cards = queryClient.getQueryData<Array<{ id?: string; owner?: string; name?: string }>>(
    repoKeys.all,
  );
  const match = cards?.find((c) => c.id === repoId);
  if (!match?.owner || !match?.name) return null;
  return { owner: match.owner, name: match.name };
}

// Repos whose id we couldn't resolve, so we've already scheduled a card-list refetch. A burst
// of pushes for the same unknown repo (Queued → Cloning 10% → 20% → ...) must not each fire
// its own refetch.
const pendingRefresh = new Set<string>();

/**
 * Resolves a repoId to owner/name; if it's unknown, refetches the card list ONCE (per repoId
 * burst) and retries after it lands. This closes the ingestion race described above: the
 * clone push for a brand-new repo can arrive before the card list contains that repo.
 * Returns null on the first (unresolvable) call — the push that triggered the refresh is
 * intentionally dropped; the refetched data + every later push in the burst carry the state.
 */
function resolveOrRefresh(
  queryClient: QueryClient,
  repoId: string,
): { owner: string; name: string } | null {
  const hit = resolveOwnerName(queryClient, repoId);
  if (hit) return hit;

  if (!pendingRefresh.has(repoId)) {
    pendingRefresh.add(repoId);
    void queryClient
      .invalidateQueries({ queryKey: repoKeys.all })
      .finally(() => pendingRefresh.delete(repoId));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Connection lifecycle
// ─────────────────────────────────────────────────────────────────────────
//
// One HubConnection per hub, built with withAutomaticReconnect so a dropped connection
// (laptop sleep, backend redeploy) recovers on its own. All connections are started eagerly
// and kept for the lifetime of the app shell (see AppProvider.tsx), not per-repo — a repo's
// detail panel closing shouldn't tear down the socket that every other card's live dot
// depends on.

let healthConnection: signalR.HubConnection | null = null;
let cloneConnection: signalR.HubConnection | null = null;
let analysisConnection: signalR.HubConnection | null = null;

function buildConnection(path: string): signalR.HubConnection {
  return new signalR.HubConnectionBuilder()
    .withUrl(`${HUB_ORIGIN}${path}`)
    .withAutomaticReconnect()
    .build();
}

/**
 * Starts a connection and, once it (re)connects, refetches what a push-only channel can't
 * replay. SignalR does NOT buffer messages while a socket is down, so anything that changed
 * during a disconnect (laptop sleep, redeploy) is simply lost — the status caches would sit
 * stale until something else refreshed them. `onReconnected` lets each hub resync.
 */
function startConnection(
  connection: signalR.HubConnection,
  label: string,
  onReconnected: () => void,
): void {
  connection.onreconnected(() => onReconnected());
  connection.start().catch((err) => {
    // Swallow rather than throw: a failed realtime connection shouldn't take down the app —
    // the REST queries this complements still work standalone, just without live pushes
    // until reconnection succeeds.
    console.error(`SignalR: failed to connect to ${label}`, err);
  });
}

/**
 * Opens the /hub/health, /hub/clone and /hub/analysis SignalR connections and wires their
 * pushes into the QueryClient's cache, so every component reading through repoCardsQuery /
 * repoDetailQuery / healthHistoryQuery / cloneStatusQuery / analysisStatusQuery /
 * dependencyGraphQuery sees live updates without polling. Call once, near the query
 * client's own setup (e.g. from AppProvider.tsx) — calling it again while connections are
 * already open is a no-op.
 *
 * Returns a teardown function that stops all connections; mainly useful for tests or HMR,
 * since in normal app usage the connections live as long as the page does.
 */
export function connectRealtimeUpdates(queryClient: QueryClient): () => void {
  // ── /hub/health ────────────────────────────────────────────────────────
  if (!healthConnection) {
    healthConnection = buildConnection("/hub/health");

    // HealthHub.BroadcastHealthUpdate(HealthStatusDto) — the live counterpart to
    // GET /api/repos/{owner}/{name}/health, which is history-only.
    onAny<HealthStatusPush>(healthConnection, HEALTH_EVENTS, (push) => {
      if (!push.repoId) return;
      const target = resolveOrRefresh(queryClient, push.repoId);
      if (!target) return;
      const status: HealthStatusValue = normalizeHealthStatus(push.status);

      // repoCardsQuery's list (drives each card's status dot) — patch in place rather than
      // invalidate-and-refetch, since a health push is exactly the one field that changed.
      queryClient.setQueryData<Array<{ owner: string; name: string; healthStatus: HealthStatusValue }>>(
        repoKeys.all,
        (cards) =>
          cards?.map((c) =>
            c.owner === target.owner && c.name === target.name ? { ...c, healthStatus: status } : c,
          ),
      );

      // repoDetailQuery's entry, if the side panel has ever fetched this repo — same
      // in-place patch, only touched if present so a push for a repo nobody's opened doesn't
      // fabricate a detail cache entry.
      queryClient.setQueryData<{ healthStatus: HealthStatusValue } | undefined>(
        repoKeys.detail(target.owner, target.name),
        (detail) => (detail ? { ...detail, healthStatus: status } : detail),
      );

      // healthHistoryQuery — a mounted history list should pick up the new check. Only the
      // caller knows what `limit` a mounted query used, so this can't build the exact key;
      // repoSegmentPredicate matches every ["repo", owner, name, "health", *] key at any
      // limit and nothing else (a bare ["repo", owner, name] prefix would also sweep the
      // sibling commit-activity / graph / clone-status keys).
      queryClient.invalidateQueries({
        predicate: repoSegmentPredicate(target.owner, target.name, "health"),
      });
    });

    startConnection(healthConnection, "/hub/health", () => {
      // Missed health pushes while disconnected → the card list is the source of the dots.
      void queryClient.invalidateQueries({ queryKey: repoKeys.all });
    });
  }

  // ── /hub/clone ─────────────────────────────────────────────────────────
  if (!cloneConnection) {
    cloneConnection = buildConnection("/hub/clone");

    // CloneHub.BroadcastCloneUpdate(CloneStatusDto) — Queued → Cloning → Ready/Failed, pushed
    // from CloneJobs.RunCloneJobAsync (backend.md §6.6). Fires automatically on ingestion,
    // not on user action, so it can arrive for a repo nobody has opened.
    onAny<CloneStatusPush>(cloneConnection, CLONE_EVENTS, (push) => {
      if (!push.repoId) return;
      const target = resolveOrRefresh(queryClient, push.repoId);
      if (!target) return;

      const next: CloneStatus = {
        repoId: push.repoId,
        jobId: push.jobId ?? null,
        status: normalizeCloneStatus(push.status),
        progressPercent: toNumberOrNull(push.progressPercent),
        errorMessage: push.errorMessage ?? null,
      };

      // Write straight into cloneStatusQuery's cache entry — this is what drives a live
      // "cloning… 60%" indicator with no polling. setQueryData on a key nobody has fetched
      // yet creates the entry, which is what we want: the first push seeds it.
      queryClient.setQueryData<CloneStatus>(cloneKeys.status(target.owner, target.name), next);

      // Ready means the clone now exists, so anything that read "no clone yet" is stale. A
      // 404'd file-tree resolved to `null` and was cached as such — without this, the Code
      // view would keep showing "still cloning…" until staleTime (5 min) expired even though
      // the tree is now available. Invalidate the tree and any cached file lookups.
      //
      // Failed does the same in the other direction: nothing to fetch, nothing to invalidate.
      if (next.status === "Ready") {
        queryClient.invalidateQueries({ queryKey: cloneKeys.tree(target.owner, target.name) });
        queryClient.invalidateQueries({
          predicate: repoSegmentPredicate(target.owner, target.name, "file"),
        });
      }
    });

    startConnection(cloneConnection, "/hub/clone", () => {
      // A clone can finish while the socket is down. Refetch every clone-status/tree we hold.
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "repo" &&
          (q.queryKey[3] === "clone-status" || q.queryKey[3] === "file-tree"),
      });
    });
  }

  // ── /hub/analysis ──────────────────────────────────────────────────────
  if (!analysisConnection) {
    analysisConnection = buildConnection("/hub/analysis");

    // AnalysisHub.BroadcastAnalysisUpdate(AnalysisStatusDto) — pushed at each transition
    // AnalysisJobs.RunAnalysisJobAsync passes through (backend.md §6.6: Running, then
    // Succeeded/Failed).
    onAny<AnalysisStatusPush>(analysisConnection, ANALYSIS_EVENTS, (push) => {
      if (!push.repoId) return;
      const target = resolveOrRefresh(queryClient, push.repoId);
      if (!target) return;

      const next: AnalysisStatus = shapeAnalysisStatus({
        repoId: push.repoId,
        jobId: push.jobId,
        status: typeof push.status === "string" ? push.status : undefined,
        progressPercent: push.progressPercent,
        errorMessage: push.errorMessage,
      });

      // Previously every non-terminal push was DROPPED ("there's no queryKey for in-flight
      // progress"). analysisKeys.status now exists, so Running / progressPercent lands in
      // the cache and the Overview panel can render a live progress bar. This is also what
      // flips "Analyze" → "Analyzed" the instant a job succeeds.
      queryClient.setQueryData<AnalysisStatus>(analysisKeys.status(target.owner, target.name), next);

      // RepoDetailDto carries its own analysisStatus field; keep that entry consistent so a
      // panel reading the detail query and one reading the status query never disagree.
      const detailStatus: AnalysisStatusValue = normalizeAnalysisStatus(push.status);
      queryClient.setQueryData<{ analysisStatus: AnalysisStatusValue } | undefined>(
        repoKeys.detail(target.owner, target.name),
        (detail) => (detail ? { ...detail, analysisStatus: detailStatus } : detail),
      );

      // The graph only meaningfully changes at a terminal state. Succeeded → the mounted
      // Graph view refetches real data (404→null while Running, real graph once Succeeded).
      // Failed → nothing new to fetch, but invalidating is harmless and clears any stale
      // graph left over from a previous successful run.
      if (next.status === "Succeeded" || next.status === "Failed") {
        queryClient.invalidateQueries({ queryKey: analysisKeys.graph(target.owner, target.name) });
      }
    });

    startConnection(analysisConnection, "/hub/analysis", () => {
      // A job can finish while the socket is down. Resync status + graph for every repo held.
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "repo" &&
          (q.queryKey[3] === "analysis-status" || q.queryKey[3] === "graph"),
      });
    });
  }

  return () => {
    void healthConnection?.stop();
    void cloneConnection?.stop();
    void analysisConnection?.stop();
    healthConnection = null;
    cloneConnection = null;
    analysisConnection = null;
    pendingRefresh.clear();
  };
}