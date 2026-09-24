import {
  createContext,
  createSignal,
  createEffect,
  on,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import Topbar from "./Topbar";
import AddRepoPopover from "./AddRepoPopover";
import { CARD_W, CARD_H, clamp, wrapOffset, REDUCED } from "./utils";

// ─────────────────────────────────────────────────────────────────────────
// CanvasWrapper / CanvasProvider
// ─────────────────────────────────────────────────────────────────────────
//
// This is the persistent pan/zoom shell described in TechGuide.md §1.1a: the
// `.stage`/`.world`/`.terrain-veil` DOM, the `view` (x/y/z) signal, the
// wheel/pointer pan handlers, and the `Topbar` + `AddRepoPopover` chrome.
//
// It is written as a plain component (not yet a `(canvas).tsx` SolidStart
// layout route) because this pass only refactors the existing `canvas/`
// files — no new routes are being added yet. Once `/repo/[owner]/[name]`,
// `.../graph`, and `.../code` exist as real leaf routes, this file's contents
// move into `(canvas).tsx` largely as-is: the `<CanvasWrapper>` call in
// CanvasHome.tsx becomes that layout's top-level render, and `props.children`
// here becomes `<Outlet/>`. Structuring it as its own component now, with all
// canvas-shell state behind a context instead of props threaded from
// CanvasHome, means that move will mostly be a file relocation rather than a
// rewrite.
//
// Layout content vs. leaf content, concretely:
//   - Owned here (shell, never remounts once real routing exists): view
//     signal, ready/animatingView, stage ref, wheel/keyboard/pan handlers,
//     Topbar, AddRepoPopover's open/closed/busy/error UI state,
//     findOpenSpot (needs `view`+`stage`, so it lives alongside them rather
//     than being recomputed by every leaf).
//   - Owned by the caller (leaf content, swaps per "route" once real routing
//     exists): the repo cards themselves, SidePanel, which repo is selected,
//     and the actual add-repo mutation (dupe-checking needs `repos`, which is
//     leaf state — CanvasWrapper only collects the parsed URL and hands it
//     back via `onAddRepo`).

export interface CanvasViewport {
  x: number;
  y: number;
  z: number;
}

interface CanvasContextValue {
  view: Accessor<CanvasViewport>;
  ready: Accessor<boolean>;
  /** True while `recenter()`'s eased transition is running — lets leaf content avoid fighting the `.world` transform. */
  animatingView: Accessor<boolean>;
  /** Re-centers and re-fits all known repo positions in view, animated. */
  recenter: () => void;
  /** Given the repos currently on the canvas, finds a free spot near the viewport center for a new card. */
  findOpenSpot: (repos: Array<{ x: number; y: number }>) => { x: number; y: number };
  /** Key (`owner/name`) of the repo card currently being dragged, or null. Leaf content owns the actual x/y updates; the wrapper only tracks *which* card so RepoCard's entrance/drag transition can react to it. */
  draggingRepo: Accessor<string | null>;
  setDraggingRepo: (key: string | null) => void;
  /** True immediately after a drag/pan gesture — set by the wrapper's own stage pan handler, and settable by leaf content's card-drag handler too, so a card's onClick can distinguish "click" from "just finished dragging" either way. */
  suppressClick: Accessor<boolean>;
  setSuppressClick: (v: boolean) => void;
  /**
   * Add-repo popover UI state. CanvasWrapper renders the popover (it's shell
   * chrome anchored to Topbar) but the actual mutation — and therefore the
   * outcome of a submit — is the leaf's job (see `onAddRepo` on
   * CanvasWrapperProps). These are exposed so the leaf's success/error
   * handlers can drive the same popover CanvasWrapper is displaying, rather
   * than the two sides needing a separate back-channel.
   */
  setAdding: (v: boolean) => void;
  setIngestError: (msg: string) => void;
  setBusy: (v: boolean) => void;
}

const CanvasContext = createContext<CanvasContextValue>();

// Leaf content (currently CanvasHome.tsx's repo-cards block) reads shell
// state through this rather than receiving it as a long prop list — the same
// shape a real `(canvas).tsx` layout route's descendants would use via
// `<Outlet/>` context, since routed leaves can't receive props directly.
export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas() must be called within <CanvasWrapper>");
  return ctx;
}

interface CanvasWrapperProps {
  /** Repos currently on the canvas, purely to compute the centered/fitted view — CanvasWrapper does not own or render them. */
  repos: Accessor<Array<{ x: number; y: number }>>;
  /** Dims and slightly scales back the stage — driven by whether a side panel (or future overlay) is open. */
  dimmed: Accessor<boolean>;
  /** Called with a parsed `{ owner, name, url }` when the add-repo form submits. The wrapper owns the popover's open/closed/busy/error UI; the caller owns dupe-checking and the actual mutation, and is responsible for calling the passed-through `setBusy`/`setIngestError` on success/failure — CanvasHome does this today via the same signals CanvasWrapper renders the popover with. */
  onAddRepo: (parsed: { owner: string; name: string; url: string }) => void;
  /**
   * Rendered inside `.world` — pan/zoom applies to this. This is where repo
   * cards (and anything else meant to live "on the map") go. Only content
   * that needs to consume `useCanvas()` can be rendered here or via
   * `overlay` below: Solid's context is read at render time by whatever's
   * mounted *under* `<CanvasContext.Provider>`, which excludes the caller
   * of `<CanvasWrapper>` itself — see CanvasHome's `CanvasHomeInner` split.
   */
  children: JSX.Element;
  /**
   * Rendered as a sibling of `.stage`, outside pan/zoom — for overlays that
   * should stay screen-fixed regardless of camera position, like SidePanel.
   * Optional: most CanvasWrapper consumers so far only need `children`.
   */
  overlay?: JSX.Element;
}

const CanvasWrapper: Component<CanvasWrapperProps> = (props) => {
  const [view, setView] = createSignal<CanvasViewport>({ x: 0, y: 0, z: 1 });
  const [ready, setReady] = createSignal(false);
  const [animatingView, setAnimatingView] = createSignal(false);
  const [draggingRepo, setDraggingRepo] = createSignal<string | null>(null);
  const [suppressClickSig, setSuppressClickSig] = createSignal(false);

  const [adding, setAdding] = createSignal(false);
  const [urlValue, setUrlValue] = createSignal("");
  const [ingestError, setIngestError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  let stage: HTMLDivElement | undefined;
  let addBtn: HTMLButtonElement | undefined;

  const computeCenteredView = (z: number): CanvasViewport => {
    if (!stage) return { x: 0, y: 0, z };
    const rs = props.repos();
    // Nothing on the canvas yet (empty account, or GET /api/repos hasn't resolved
    // yet) — center the empty grid on the stage rather than running min/max over an
    // empty array (which yields ±Infinity and would NaN out the transform).
    if (rs.length === 0) {
      return { x: stage.clientWidth / 2, y: stage.clientHeight / 2, z };
    }
    const xs = rs.map((r) => r.x);
    const ys = rs.map((r) => r.y);
    const cx = (Math.min(...xs) + Math.max(...xs) + CARD_W) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys) + CARD_H) / 2;
    return { x: stage.clientWidth / 2 - cx * z, y: stage.clientHeight / 2 - cy * z, z };
  };

  const centerView = () => setView((v) => computeCenteredView(v.z));
  const recenter = () => {
    setAnimatingView(true);
    setView(computeCenteredView(1));
    setTimeout(() => setAnimatingView(false), 1000);
  };

  const findOpenSpot = (repos: Array<{ x: number; y: number }>): { x: number; y: number } => {
    if (!stage) return { x: 240, y: 200 };
    const cx = (stage.clientWidth / 2 - view().x) / view().z;
    const cy = (stage.clientHeight / 2 - view().y) / view().z;
    const gap = 48, stepX = CARD_W + gap, stepY = CARD_H + gap, pad = 24;
    const offsets: Array<[number, number]> = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [-2, 0], [0, 2], [0, -2],
    ];
    for (const [gx, gy] of offsets) {
      const x = Math.round(cx - CARD_W / 2 + gx * stepX);
      const y = Math.round(cy - CARD_H / 2 + gy * stepY);
      const clash = repos.some((r) => x < r.x + CARD_W + pad && x + CARD_W + pad > r.x && y < r.y + CARD_H + pad && y + CARD_H + pad > r.y);
      if (!clash) return { x, y };
    }
    return { x: Math.round(cx - CARD_W / 2), y: Math.round(cy - CARD_H / 2) };
  };

  // Ctrl+drag on empty stage pans the camera. A plain drag starting on a card
  // is handled by the leaf's own per-card pointerdown handler instead, which
  // calls e.stopPropagation() before this ever sees the event.
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.ctrlKey || draggingRepo()) return;
    const start = { x: e.clientX, y: e.clientY, ox: view().x, oy: view().y };
    let moved = 0;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 4) {
        setSuppressClickSig(true);
        setView((v) => ({ ...v, x: start.ox + dx, y: start.oy + dy }));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(() => setSuppressClickSig(false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleAdd = () => (adding() ? closeAdd() : setAdding(true));
  const closeAdd = () => { if (!busy()) setAdding(false); };

  const [stageEl, setStageEl] = createSignal<HTMLDivElement>();
  createEffect(on(stageEl, (el) => { if (!el) return; centerView(); setReady(true); }));
  createEffect(on(ready, (isReady) => {
    if (!isReady) return;
    const onResize = () => { if (view().z === 1) centerView(); };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  }));

  onMount(() => {
    setStageEl(stage);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const z = clamp(v.z * Math.exp(-e.deltaY * 0.0016), 0.45, 2.2);
        return { z, x: px - (px - v.x) * (z / v.z), y: py - (py - v.y) * (z / v.z) };
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (adding()) closeAdd();
      // Closing an open repo panel on Escape is leaf-content behavior (it
      // depends on `selected`, which CanvasWrapper doesn't own) — CanvasHome
      // wires its own Escape handling for that; this one only owns the
      // add-repo popover, which *is* shell state.
    };
    stage!.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      stage!.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    });
  });

  const ctx: CanvasContextValue = {
    view,
    ready,
    animatingView,
    recenter,
    findOpenSpot,
    draggingRepo,
    setDraggingRepo,
    suppressClick: suppressClickSig,
    setSuppressClick: setSuppressClickSig,
    setAdding,
    setIngestError,
    setBusy,
  };

  return (
    <CanvasContext.Provider value={ctx}>
      <div class="page">
        <Topbar
          adding={adding}
          toggleAdd={toggleAdd}
          recenter={recenter}
          setAddBtnRef={(el) => (addBtn = el)}
        >
          <AddRepoPopover
            show={adding}
            close={closeAdd}
            onSubmit={props.onAddRepo}
            triggerRef={() => addBtn}
            urlValue={urlValue}
            setUrlValue={setUrlValue}
            ingestError={ingestError}
            setIngestError={setIngestError}
            busy={busy}
            setBusy={setBusy}
          />
        </Topbar>

        <main
          class="stage"
          classList={{ dimmed: props.dimmed(), ready: ready() }}
          ref={stage}
          onPointerDown={onPointerDown}
        >
          <div
            class="terrain-veil"
            style={{
              "background-size": `${44 * view().z}px ${44 * view().z}px`,
              "background-position": `${wrapOffset(view().x, 44 * view().z)}px ${wrapOffset(view().y, 44 * view().z)}px`,
              opacity: ready() ? 1 : 0,
              transform: ready() ? "scale(1)" : "scale(0.85)",
              transition: REDUCED ? "opacity 160ms ease" : "opacity 900ms cubic-bezier(0.22,0.61,0.36,1), transform 900ms cubic-bezier(0.22,0.61,0.36,1)",
            }}
          />

          <div
            class="world"
            classList={{ smooth: animatingView() }}
            style={{ transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().z})` }}
          >
            {props.children}
          </div>
        </main>

        {props.overlay}
      </div>
    </CanvasContext.Provider>
  );
};

export default CanvasWrapper;