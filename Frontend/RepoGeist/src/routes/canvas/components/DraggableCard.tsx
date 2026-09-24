// canvas/components/DraggableCard.tsx — a free-floating card in the canvas's
// world space. It's the repo-card idea (absolute-positioned, draggable, lives
// inside `.world` so pan/zoom applies to it) generalised for cards that hold
// real content: a titlebar that is the drag handle + a scrolling body.
//
// WHY THE TITLEBAR IS THE HANDLE — a RepoCard is one big click target, so it
// can be dragged from anywhere. These cards hold text you want to select,
// rows you want to click and content you want to scroll; if the whole surface
// started a drag, none of that would work. Dragging is titlebar-only.
//
// HOW IT TALKS TO THE SHELL — through useCanvas(), exactly like the repo cards
// do (so it must render UNDER <CanvasWrapper>, i.e. inside a leaf route):
//   • canvas.view().z          → drag deltas are screen px / zoom = world px
//   • canvas.setDraggingRepo() → reused as "which card is being dragged"; the
//     wrapper's own ctrl+drag pan already bails while it's set. The id is
//     opaque to the shell, so a non-repo id like "code:tree" is fine.
//   • Ctrl+drag on the titlebar is NOT swallowed — it falls through to the
//     stage and pans the camera, same as on a repo card.
//
// WHEEL — the stage turns every wheel event into a zoom. Over a card body
// that overflows, a plain wheel scrolls the card instead (Ctrl+wheel / pinch
// still zooms, so you can zoom from anywhere). A body with nothing to scroll
// lets the wheel through to the stage.
//
// TWO ELEMENTS, ON PURPOSE — read before "simplifying" this.
//   <article.canvas-card-anchor>   plain element: position, size, z-index and
//                                  the `dragging` class. All the reactive bits.
//     <Motion.div.canvas-card>     the visible surface. Entrance animation
//                                  only, and every prop on it is STATIC.
// solid-motionone builds a Motion element's `style` as
// combineStyle(props.style, <its initial styles, incl. opacity: 0>), and
// Solid's style() re-applies EVERY key whenever any part of it re-evaluates.
// So one reactive class/style change on a Motion element stamps `opacity: 0`
// back over the `opacity: 1` Motion committed when the entrance finished, and
// nothing re-runs the animation — the card is invisible for good. (RepoCard
// dodges this with imperative classList calls and a `duration: 0` transition
// while dragging.) Keeping the reactive props on a plain parent avoids it.
//
// Named export only (no default) so the file router never treats it as a
// page, same convention as the code/ components.

import {
  children as resolveChildren,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from "solid-js";
import { Motion } from "solid-motionone";
import { useCanvas } from "./CanvasWrapper";
import { POP, REDUCED } from "./utils";
import "~/styles/canvas-card.css";

export interface CardPos {
  x: number;
  y: number;
}

// Where each card was last left, keyed by id, so switching graph → code →
// graph doesn't reshuffle the layout. A plain Map on purpose: it's only
// written from pointer handlers (client-only) and only read once per mount,
// so it needs no reactivity and can't leak state between SSR requests.
const placed = new Map<string, CardPos>();

// Cards raise themselves above their siblings when touched. One shared counter
// means N cards need no coordination with each other.
let topZ = 1;

export interface DraggableCardProps {
  /** Stable id: keys the remembered position and the shell's dragging flag. */
  id: string;
  /** Accessible name for the card as a whole. */
  label: string;
  /** World-space position for the FIRST time this id ever mounts (read once). */
  defaultPos: () => CardPos;
  /** Size in world px — scales with zoom like everything else in `.world`. */
  width: number;
  height: number;
  /** Position in the entrance stagger (0 = first). */
  index?: number;
  icon?: JSX.Element;
  /** Left side of the titlebar. */
  title: JSX.Element;
  /** Right side of the titlebar, muted. Falsy hides it. */
  meta?: JSX.Element;
  /** When this value changes the body scrolls back to the top-left. */
  resetScrollOn?: () => unknown;
  children: JSX.Element;
}

export const DraggableCard: Component<DraggableCardProps> = (props) => {
  const canvas = useCanvas();

  // Deliberately read once — defaultPos only matters for a card's first mount.
  const [pos, setPos] = createSignal<CardPos>(placed.get(props.id) ?? props.defaultPos());
  const [z, setZ] = createSignal(0);

  const dragging = () => canvas.draggingRepo() === props.id;
  const raise = () => setZ(++topZ);

  // `children()` resolves once — reading `props.icon` twice (in `when` and in
  // the body) would build the element twice.
  const icon = resolveChildren(() => props.icon);
  const meta = resolveChildren(() => props.meta);

  let body!: HTMLDivElement;
  createEffect(
    on(
      () => props.resetScrollOn?.(),
      () => {
        body.scrollTop = 0;
        body.scrollLeft = 0;
      },
      { defer: true },
    ),
  );

  // If the leaf unmounts mid-drag (route change), release the window
  // listeners and the shell's dragging flag rather than leaking them.
  let endDrag: (() => void) | undefined;
  onCleanup(() => endDrag?.());

  const onBarPointerDown = (e: PointerEvent) => {
    // Ctrl+drag falls through to the stage's camera pan.
    if (e.button !== 0 || e.ctrlKey) return;
    e.stopPropagation();
    raise();

    const start = { x: e.clientX, y: e.clientY, ox: pos().x, oy: pos().y };
    canvas.setDraggingRepo(props.id);

    const move = (ev: PointerEvent) => {
      const zoom = canvas.view().z;
      setPos({
        x: start.ox + (ev.clientX - start.x) / zoom,
        y: start.oy + (ev.clientY - start.y) / zoom,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      endDrag = undefined;
      placed.set(props.id, pos());
      canvas.setDraggingRepo(null);
    };
    endDrag = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onBodyWheel: JSX.EventHandler<HTMLDivElement, WheelEvent> = (e) => {
    if (e.ctrlKey) return; // pinch / ctrl+wheel → let the stage zoom
    const el = e.currentTarget;
    const overflows = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (overflows) e.stopPropagation(); // scroll the card, don't zoom the canvas
  };

  return (
    <article
      class={dragging() ? "canvas-card-anchor dragging" : "canvas-card-anchor"}
      role="group"
      aria-label={props.label}
      style={{
        left: `${pos().x}px`,
        top: `${pos().y}px`,
        width: `${props.width}px`,
        height: `${props.height}px`,
        "z-index": z(),
      }}
      // Touching the body (not just the titlebar) also brings the card forward.
      onPointerDown={raise}
    >
      {/* Everything on this Motion element must stay static — see the note at
          the top of the file. Same entrance idiom as RepoCard, tuned for larger
          surfaces: smaller scale jump, and a short delay because the shell is
          already mounted (RepoCard's 0.35s waits out the first-load terrain fade). */}
      <Motion.div
        class="canvas-card"
        initial={REDUCED ? false : { opacity: 0, scale: 0.94, y: -10 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, delay: 0.12 + (props.index ?? 0) * 0.09, easing: POP }}
      >
        <header class="canvas-card-bar" onPointerDown={onBarPointerDown}>
          <Show when={icon()}>
            <span class="canvas-card-icon" aria-hidden="true">
              {icon()}
            </span>
          </Show>
          <div class="canvas-card-title">{props.title}</div>
          <Show when={meta()}>
            <div class="canvas-card-meta">{meta()}</div>
          </Show>
        </header>

        <div class="canvas-card-body" ref={body} onWheel={onBodyWheel}>
          {props.children}
        </div>
      </Motion.div>
    </article>
  );
};