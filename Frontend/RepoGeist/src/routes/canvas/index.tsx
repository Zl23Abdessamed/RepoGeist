// src/routes/canvas/index.tsx — THE "/canvas" LEAF (the repo cards)
//
// The layout (src/routes/canvas.tsx) owns the persistent canvas: the shell
// (CanvasWrapper — stage/world/view/Topbar/add-repo popover) and the
// SidePanel overlay. This file is the leaf mounted at exactly /canvas, and
// it fills the shell's `.world` through the layout's {props.children} slot:
// the repo cards.
//
// Navigate to /canvas/repos/[owner]/[name]/code and THIS leaf unmounts — the
// cards leave the world and that route's content takes the same space —
// while the shell and panel above it never reset. Different world content
// per route, one persistent canvas.
//
// Both contexts are valid here (this renders UNDER CanvasWrapper):
//   useCanvas()     — shell/camera: findOpenSpot, popover busy/error setters,
//                     drag and click-suppression flags.
//   useCanvasData() — layout state: repos, selected, openRepo, handler slot.

import { createEffect, onCleanup, For, Show, type Component } from "solid-js";
import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query";
import { useCanvas } from "./components/CanvasWrapper";
import RepoCard from "./components/RepoCard";
import { Repo, repoKey, repoCardToRepo } from "./components/utils";
import { useCanvasData, type ParsedRepoUrl } from "./components/canvas-data";
import { repoCardsQuery, createRepoMutation } from "~/lib/repos";

const CanvasCards: Component = () => {
  const queryClient = useQueryClient();
  const canvas = useCanvas(); // shell/camera context (CanvasWrapper)
  const data = useCanvasData(); // layout context: repos/selected/openRepo/bindAddHandler

  // GET /api/repos — the server's source of truth. `data.repos` is the
  // canvas's own copy, carrying x/y and the `fresh` flag.
  const repoCards = createQuery(() => repoCardsQuery());

  // POST /api/repos — where the popover's submit ends up.
  const addRepo = createMutation(() => createRepoMutation(queryClient));

  // Dragging a card moves that card in world space (screen deltas divided
  // by zoom). The shell only tracks *which* card is dragging.
  const onCardPointerDown = (repo: Repo) => (e: PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey) return;
    e.stopPropagation();
    const key = repoKey(repo);
    const start = { x: e.clientX, y: e.clientY, ox: repo.x, oy: repo.y };
    let moved = 0;
    canvas.setDraggingRepo(key);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / canvas.view().z;
      const dy = (ev.clientY - start.y) / canvas.view().z;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 4 / canvas.view().z) {
        canvas.setSuppressClick(true);
        const nx = start.ox + dx;
        const ny = start.oy + dy;
        data.setRepos((rs) => rs.map((r) => (repoKey(r) === key ? { ...r, x: nx, y: ny } : r)));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.setDraggingRepo(null);
      setTimeout(() => canvas.setSuppressClick(false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The popover (rendered + validated + parsed inside CanvasWrapper) hands
  // us { owner, name, url }. We own the dupe check and the mutation, and
  // drive the popover's busy/error state back through the shell context.
  const handleAddRepo = ({ owner, name, url }: ParsedRepoUrl) => {
    const dupe = data.repos().some(
      (r) =>
        r.owner.toLowerCase() === owner.toLowerCase() &&
        r.name.toLowerCase() === name.toLowerCase()
    );
    if (dupe) {
      canvas.setIngestError(`${owner}/${name} is already on your canvas.`);
      canvas.setBusy(false);
      return;
    }
    canvas.setIngestError("");
    addRepo.mutate(url, {
      onSuccess: (card) => {
        const spot = canvas.findOpenSpot(data.repos());
        data.setRepos((rs) => [...rs, repoCardToRepo(card, spot, true)]);
        canvas.setBusy(false);
        canvas.setAdding(false);
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Couldn't add that repository. Please try again.";
        canvas.setIngestError(message);
        canvas.setBusy(false);
      },
    });
  };

  // Bind the handler up to the layout's slot for exactly as long as this
  // leaf is mounted. Unlike the pre-routing code — where the cards could
  // never unmount — navigating to a sibling leaf DOES unmount this component,
  // so the unbind matters: a popover submit while a graph/code leaf is active
  // must not call into this disposed component's mutation.
  data.bindAddHandler(handleAddRepo);
  onCleanup(() => data.bindAddHandler(undefined));

  // Reconcile the server's card list into canvas state: keep existing local
  // positions, assign a free spot to repos that appeared from elsewhere,
  // drop ones that no longer exist server-side. The repos signal itself is
  // layout-owned, so positions survive leaving and re-entering this leaf.
  createEffect(() => {
    const cards = repoCards.data;
    if (!cards) return;
    data.setRepos((current) => {
      const existingByKey = new Map(current.map((r) => [repoKey(r), r]));
      return cards.map((card) => {
        const key = `${card.owner}/${card.name}`;
        const existing = existingByKey.get(key);
        if (existing) {
          return repoCardToRepo(card, { x: existing.x, y: existing.y }, false);
        }
        const spot = canvas.findOpenSpot(current);
        return repoCardToRepo(card, spot, false);
      });
    });
  });

  return (
    <Show when={canvas.ready()}>
      <For each={data.repos()}>
        {(repo, i) => (
          <RepoCard
            repo={() => repo}
            selected={data.selected}
            draggingRepo={canvas.draggingRepo}
            onPointerDown={onCardPointerDown(repo)}
            onClick={() => !canvas.suppressClick() && data.openRepo(repo)}
            index={i}
          />
        )}
      </For>
      <Show when={repoCards.isLoading}>
        <p class="muted" style={{ position: "absolute", left: "24px", top: "24px" }}>
          Loading repositories…
        </p>
      </Show>
      <Show when={repoCards.isError}>
        <p class="muted" style={{ position: "absolute", left: "24px", top: "24px" }}>
          Couldn't load your repos. Try refreshing.
        </p>
      </Show>
      <Show when={repoCards.isSuccess && data.repos().length === 0}>
        <p class="muted" style={{ position: "absolute", left: "24px", top: "24px" }}>
          No repos yet — add one to get started.
        </p>
      </Show>
    </Show>
  );
};

export default CanvasCards;