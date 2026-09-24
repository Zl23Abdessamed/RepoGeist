// src/routes/canvas/repo/[owner]/[name]/code/index.tsx — THE ".../code" LEAF
//
// Same full-bleed decision as graph/index.tsx (Design.md §3.3, Guide.md §5.2):
// this replaces the canvas's world content rather than living in SidePanel.
// A leaf under the canvas.tsx layout route — CanvasWrapper's shell is
// already mounted above this and isn't recreated here.
//
// Per Guide.md §5.2's "familiar code view" — a conventional file-tree plus
// syntax-highlighted viewer is the solved-problem half of Tier 2 (the graph
// views are the genuinely hard part).
//
// CARDS — the explorer, the theme picker, and the viewer are three separate
// DraggableCards living in the canvas's world space, exactly like the repo
// cards on /canvas: same surface, pan/zoom applies to them, and each is
// dragged by its titlebar (DraggableCard.tsx explains why the titlebar and
// not the whole surface). Because they render inside `.world` this leaf has
// no wrapper element of its own — the cards are positioned absolutely in
// world coordinates.
//
//   "Files" card → the tree (left)
//   "Theme" card → the shiki theme picker (middle) — its own card rather
//                  than a titlebar control, since a real swatch list needs
//                  more room than a titlebar slot can give it
//   file card    → the open file; its titlebar shows the active path and
//                  language, so there's no separate header any more
//
// DATA — THE CLONE, NOT ANALYSIS (Guide.md §5.0). Everything here comes from
// ~/lib/clone:
//
//   fileTreeQuery     → Files card: a flat node list read from the clone,
//                       nested client-side by buildTree (./tree)
//   fileContentQuery  → file card: one file's text + inferred language
//   cloneStatusQuery  → only used to explain WHY there's no tree yet
//                       (queued / cloning 60% / failed / missing)
//
// Nothing here reads dependencyGraphQuery or analysisStatusQuery. Code must
// work whether or not "Analyze" was ever clicked.
//
// Live updates: while a clone is running, /hub/clone pushes (signalr.ts)
// write cloneKeys.status and, on "Ready", invalidate the tree query — so the
// "Cloning… 60%" notice below turns into the file tree with no polling. That
// relies on connectRealtimeUpdates() being called from AppProvider.tsx.
//
// LAYOUT — this file is the orchestrator only; the pieces live beside it:
//
//   tree.ts        → pure nesting/sorting/default-pick helpers
//   utils.ts       → shared motion constants (EASE_OUT / EASE / REDUCED)
//   theme.ts       → shiki theme id list + selected-theme store (localStorage)
//                    + a lazily-resolved, cached per-id color swatch
//   ThemePicker.tsx → the Theme card's body: a swatch list built on theme.ts
//   FileTree.tsx   → explorer body (Presence-driven accordion)
//   Notice.tsx     → status panel + describeMissingTree
//   CodeBlock.tsx  → shiki-highlighted body, reads theme.ts's active theme
//   (CodeHeader.tsx is no longer used — its job moved into the card titlebars.)
//
// ANIMATION POLICY — solid-motionone, matching the canvas chrome's idiom.
// The cards enter with the same pop as the repo cards. Inside them, entrances
// are animated everywhere a state resolves into content (tree ready, notice
// appearing, file loading, shiki finishing). Exits are animated only in
// FileTree, where the parent actually stays mounted across the toggle — the
// <Match> branches below unmount wholesale, so Presence has nothing to hang
// an exit on. Reduced-motion users get everything rendered in place.

import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  Show,
  Switch,
  type Component,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Motion } from "solid-motionone";
import { FiDroplet, FiFile, FiFolder } from "solid-icons/fi";
import { cloneStatusQuery, fileContentQuery, fileTreeQuery } from "~/lib/clone";
import { useCanvasData } from "../../../../components/canvas-data";
import { useCanvas } from "../../../../components/CanvasWrapper";
import { DraggableCard } from "../../../../components/DraggableCard";
import { CARD_W, CARD_H } from "../../../../components/utils";
import "~/styles/code.css";
import { CodeBlock } from "./components/CodeBlock";
import { FileTree } from "./components/FileTree";
import { Notice, describeMissingTree } from "./components/Notice";
import { buildTree, collectFilePaths, pickDefaultFile } from "./components/tree";
import { REDUCED, EASE_OUT } from "./components/utils";
import { theme } from "./components/theme";
import { ThemeCard } from "./components/ThemePicker";

// Card geometry, in world px (they scale with the camera like the repo cards).
// Three cards now (Files / Theme / Code) laid out left to right in that
// order — Theme is deliberately narrow, it's just a scrolling list of rows.
const TREE_W = 300;
const THEME_W = 220;
const FILE_W = 760;
const CARDS_H = 560;
const CARDS_GAP = 32;

// NEVER READ `query.data` WHILE A QUERY MIGHT BE PENDING.
// solid-query's `.data` getter falls through to its underlying resource
// whenever the store has no data yet, and reading a pending resource SUSPENDS
// the nearest <Suspense> — which sits above the canvas layout, so the whole
// canvas (cards, camera, topbar) is swapped for the fallback until the request
// lands. `.status` never suspends. A new file path is a new query key, so
// every first visit to a file is "pending" — reading `.data` unguarded meant
// the canvas blanked on each file click. This only touches `.data` once the
// query has left "pending" (data exists, or the query has errored).
const dataOf = <T,>(q: {
  readonly status: "pending" | "error" | "success";
  readonly data: T | undefined;
}): T | undefined => (q.status === "pending" ? undefined : q.data);

const CodeView: Component = () => {
  const params = useParams<{ owner: string; name: string }>();
  const canvas = useCanvas(); // shell/camera context — same one the repo cards use
  const canvasData = useCanvasData();

  const repoTitle = createMemo(() => {
    const match = canvasData.repos().find(
      (r) => r.owner.toLowerCase() === params.owner.toLowerCase() && r.name.toLowerCase() === params.name.toLowerCase(),
    );
    return match ? `${match.owner}/${match.name}` : `${params.owner}/${params.name}`;
  });

  const cloneQuery = createQuery(() => cloneStatusQuery(params.owner, params.name));
  const treeQuery = createQuery(() => fileTreeQuery(params.owner, params.name));

  const treeData = () => dataOf(treeQuery);
  const tree = createMemo(() => {
    const data = treeData();
    return data ? buildTree(data.nodes) : [];
  });
  const filePaths = createMemo(() => collectFilePaths(tree()));

  // Which screen the tree side is on. `null` data (a 404) is "unavailable", not "empty":
  // it means there's no readable clone, which describeMissingTree then explains.
  const view = createMemo<"loading" | "error" | "unavailable" | "empty" | "ready">(() => {
    if (treeQuery.status === "pending") return "loading";
    if (treeQuery.status === "error") return "error";
    if (!treeData()) return "unavailable";
    return filePaths().size === 0 ? "empty" : "ready";
  });

  // The person's pick is stored WITH the repo it was made in, and only honored while
  // it's still a file in the current tree. This is what stops a path picked in repo A
  // from being requested against repo B when the leaf stays mounted across a param
  // change — that request would 404 and show a bogus "file not found".
  const repoKey = () => `${params.owner}/${params.name}`;
  const [selected, setSelected] = createSignal<{ repo: string; path: string } | null>(null);

  // Which directories are expanded. Owned here (not inside FileTreeBranch) so
  // the reveal effect can open a folder chain and so open folders survive
  // tree refetches.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [themeOpen, setThemeOpen] = createSignal(false);
  const themeTogglePos = () => spawnAt("theme");


  const activePath = createMemo<string | null>(() => {
    const pick = selected();
    if (pick && pick.repo === repoKey() && filePaths().has(pick.path)) return pick.path;
    return pickDefaultFile(tree());
  });

  const select = (path: string) => setSelected({ repo: repoKey(), path });

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // `enabled` in fileContentQuery is false for an empty path, so this stays idle
  // until there's a file to fetch.
  const fileQuery = createQuery(() => fileContentQuery(params.owner, params.name, activePath() ?? ""));

  const recheck = () => {
    void Promise.all([cloneQuery.refetch(), treeQuery.refetch()]);
  };

  // WHY there's no tree, for the "unavailable" pane. Reactive: while a clone
  // runs, cloneQuery's pushes flow through and the notice text updates in place
  // (Notice deliberately doesn't re-animate per progress tick).
  const missingTreeNotice = createMemo(() =>
    describeMissingTree(dataOf(cloneQuery), {
      cloneErrored: cloneQuery.isError,
      refetchingTree: treeQuery.isFetching,
    }),
  );

  // Keep the active file visible: open every ancestor folder of whatever the
  // file card is showing (the default pick can be nested, e.g. src/index.ts
  // in a repo without a root README). Deliberately does NOT re-run when
  // folders are toggled — a folder the person closed stays closed.
  createEffect(() => {
    const active = activePath();
    if (!active) return;
    const parts = active.split("/");
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("/"));
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a))) return prev; // nothing to open
      const next = new Set(prev);
      for (const a of ancestors) next.add(a);
      return next;
    });
  });

  // Navigating to a different repo while this leaf stays mounted must not
  // carry the previous repo's open folders over — start collapsed.
  createEffect(on(repoKey, () => setExpanded(new Set<string>()), { defer: true }));

  // ── card placement ─────────────────────────────────────────────────────
  // First time the cards ever appear they open side by side, centered on
  // whatever the camera is currently looking at. findOpenSpot with an empty
  // list always answers "a CARD_W×CARD_H box centered on the viewport", so
  // adding half a card back gives the viewport's center in world coords.
  // (Called once per card, at mount — after canvas.ready(), so the stage
  // exists and the view is measured.)
  const viewportCenter = () => {
    const spot = canvas.findOpenSpot([]);
    return { x: spot.x + CARD_W / 2, y: spot.y + CARD_H / 2 };
  };
  const spawnAt = (which: "tree" | "theme" | "file") => {
    const c = viewportCenter();
    const totalW = TREE_W + CARDS_GAP + THEME_W + CARDS_GAP + FILE_W;
    const left = Math.round(c.x - totalW / 2);
    const top = Math.round(c.y - CARDS_H / 2);
    if (which === "tree") return { x: left, y: top };
    if (which === "theme") return { x: left + TREE_W + CARDS_GAP, y: top };
    return { x: left + TREE_W + CARDS_GAP + THEME_W + CARDS_GAP, y: top };
  };

  // The file card's titlebar: directory muted, filename in full ink. The
  // directory is the part that gets ellipsized when the card is narrow.
  const pathParts = createMemo(() => {
    const path = activePath();
    if (!path) return null;
    const cut = path.lastIndexOf("/") + 1;
    return { dir: path.slice(0, cut), base: path.slice(cut) };
  });

  return (
    // Same gate the repo cards use: nothing exists in the world until the
    // shell has measured its center.
    <Show when={canvas.ready()}>
      <DraggableCard
        id="code:tree"
        label="Repository files"
        width={TREE_W}
        height={CARDS_H}
        index={0}
        defaultPos={() => spawnAt("tree")}
        icon={<FiFolder />}
        title="Files"
        meta={repoTitle()}
      >
        <nav class="file-tree" aria-label="Repository files">
          <Switch fallback={<p class="muted">No files to show.</p>}>
            <Match when={view() === "loading"}>
              <p class="muted">Loading files…</p>
            </Match>
            <Match when={view() === "ready"}>
              <Motion.div
                initial={REDUCED ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, easing: EASE_OUT }}
              >
                <FileTree
                  nodes={tree()}
                  expanded={expanded()}
                  activePath={activePath()}
                  onToggleDir={toggleDir}
                  onSelectFile={select}
                />
              </Motion.div>
            </Match>
          </Switch>
        </nav>
      </DraggableCard>

      <ThemeCard defaultPos={() => spawnAt("theme")} index={1} />

      <DraggableCard
        id="code:file"
        label="File contents"
        width={FILE_W}
        height={CARDS_H}
        index={2}
        defaultPos={() => spawnAt("file")}
        icon={<FiFile />}
        title={
          <Show when={pathParts()} fallback="Code">
            {(parts) => (
              <span class="code-titlebar-path" title={activePath() ?? undefined}>
                <Show when={parts().dir}>
                  <span class="code-titlebar-dir">{parts().dir}</span>
                </Show>
                <span class="code-titlebar-base">{parts().base}</span>
              </span>
            )}
          </Show>
        }
        meta={<Show when={dataOf(fileQuery)?.language}>{(lang) => <span class="code-titlebar-lang">{lang()}</span>}</Show>}
        // A new file opens at the top, not wherever the last one was scrolled to.
        resetScrollOn={activePath}
      >
        <Switch>
          <Match when={view() === "error"}>
            <Notice
              title="Couldn't load the file list."
              detail={treeQuery.error as string}
              onAction={recheck}
            />
          </Match>

          <Match when={view() === "unavailable"}>
            <Notice
              title={missingTreeNotice().title}
              detail={missingTreeNotice().detail}
              actionLabel="Check again"
              onAction={missingTreeNotice().recheck ? recheck : undefined}
            />
          </Match>

          <Match when={view() === "empty"}>
            <Notice title="This repository has no files to show." />
          </Match>

          <Match when={view() === "ready"}>
            <Show
              when={activePath()}
              fallback={<p class="muted code-status">Select a file to view its contents.</p>}
            >
              <Switch>
                <Match when={fileQuery.status === "pending"}>
                  <p class="muted code-status">Loading file…</p>
                </Match>

                <Match when={fileQuery.status === "error"}>
                  <Notice
                    title="Couldn't load this file."
                    detail={fileQuery.error as string}
                    onAction={() => void fileQuery.refetch()}
                  />
                </Match>

                {/* A 404 from the file route means "no such file in the clone" — a
                    missing CLONE is repaired inline server-side (backend.md §6.4)
                    and never surfaces here. */}
                <Match when={dataOf(fileQuery) === null}>
                  <Notice title="This file wasn't found." detail="It isn't present in the repository clone." />
                </Match>

                <Match when={dataOf(fileQuery)}>
                  {(file) => (
                    // Entrance on every fresh data arrival (new file fetched).
                    // Switching between cached files swaps content in place —
                    // intentionally instant, so flipping through files feels snappy.
                    <Motion.div
                      class="code-file"
                      initial={REDUCED ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, easing: EASE_OUT }}
                    >
                      <CodeBlock code={file().content} language={file().language} />
                    </Motion.div>
                  )}
                </Match>
              </Switch>
            </Show>
          </Match>
        </Switch>
      </DraggableCard>
    </Show>
  );
};

export default CodeView;