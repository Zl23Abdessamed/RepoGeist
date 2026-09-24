// code/Notice.tsx — the panel used everywhere the code view has something to
// explain: a failed tree fetch, a clone that's queued / cloning / failed /
// missing, an empty repo, a 404'd file.
//
// ANIMATION — entrance only (Motion, no Presence). Notices sit inside
// route-level <Match> branches, so when the view flips state the whole branch
// unmounts at once — there's no surviving parent for an exit animation to hang
// off of. The incoming state's entrance carries the transition instead.
// Deliberately NOT re-keyed on content: while a clone runs,
// describeMissingTree recomputes on every progress push and the title updates
// IN PLACE inside the same mounted Motion.div — re-animating per tick would strobe.

import { Show, type Component } from "solid-js";
import { Motion } from "solid-motionone";
import type { CloneStatus } from "~/lib/clone";
import { EASE_OUT, REDUCED } from "./utils";

export interface NoticeContent {
  title: string;
  detail?: string;
  /** Whether a "Check again" button makes sense (i.e. the state might change on its own). */
  recheck?: boolean;
}

export function describeMissingTree(
  clone: CloneStatus | undefined,
  ctx: { cloneErrored: boolean; refetchingTree: boolean },
): NoticeContent {
  if (!clone) {
    return ctx.cloneErrored
      ? { title: "Files aren't available yet.", detail: "Couldn't check this repository's clone status.", recheck: true }
      : { title: "Checking repository…" };
  }

  switch (clone.status) {
    case "Queued":
      return {
        title: "Waiting to clone this repository…",
        detail: "Cloning starts automatically after a repository is added.",
      };
    case "Cloning": {
      const pct = clone.progressPercent === null ? "" : ` ${Math.round(Math.min(100, Math.max(0, clone.progressPercent)))}%`;
      return { title: `Cloning repository…${pct}`, detail: "The files will appear here as soon as it's done." };
    }
    case "Failed":
      return {
        title: "Cloning failed.",
        detail: clone.errorMessage ?? "The repository couldn't be cloned.",
        recheck: true,
      };
    case "Ready":
      // Right after a Ready push the tree refetch is still in flight — don't flash
      // the "can't be read" message during that gap.
      return ctx.refetchingTree
        ? { title: "Loading files…" }
        : {
          title: "This repository's files aren't available right now.",
          detail: "The clone was marked ready, but its files can't be read — it may have been cleaned up on the server.",
          recheck: true,
        };
    case "NotCloned":
      return {
        title: "This repository hasn't been cloned.",
        detail: "No clone job exists for it, so there are no files to show.",
        recheck: true,
      };
  }
}

export const Notice: Component<{
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}> = (props) => (
  <Motion.div
    class="empty code-status"
    role="status"
    aria-live="polite"
    initial={REDUCED ? false : { opacity: 0, y: 10, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.22, easing: EASE_OUT }}
  >
    <p>{props.title}</p>
    <Show when={props.detail}>
      <p class="muted">{props.detail}</p>
    </Show>
    <Show when={props.onAction}>
      <button type="button" class="code-recheck" onClick={() => props.onAction?.()}>
        {props.actionLabel ?? "Try again"}
      </button>
    </Show>
  </Motion.div>
);