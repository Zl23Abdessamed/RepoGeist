// The context the canvas LAYOUT route (src/routes/canvas.tsx) provides to
// whichever leaf route is mounted under it. Routed leaves can't receive
// props from their layout, so this down-channel replaces the prop list the
// pre-routing CanvasHome handed its inner half.
//
// Scope: the layout owns the persistent chrome (CanvasWrapper shell +
// SidePanel). A leaf renders the WORLD CONTENT for its URL — /canvas's repo
// cards, .../code's file tree, etc. The context carries what that content
// needs: the repos view-model (layout-owned, since CanvasWrapper's `repos`
// prop is read up at the layout level), the selected-repo signal the
// SidePanel renders from, and the add-handler slot.
//
// Plain .ts on purpose: every .tsx under src/routes/ becomes a route in
// SolidStart, so colocated non-route modules stay .ts.

import { createContext, useContext, type Accessor, type Setter } from "solid-js";
import type { Repo } from "./utils";

export type ParsedRepoUrl = { owner: string; name: string; url: string };

export interface CanvasDataContextValue {
  /** Canvas view-model (server cards + client-only x/y / `fresh`). Layout-owned: CanvasWrapper's `repos` prop reads it for view fitting/findOpenSpot. */
  repos: Accessor<Repo[]>;
  setRepos: Setter<Repo[]>;
  /** Repo whose SidePanel is open (the panel is layout-owned chrome), or null. */
  selected: Accessor<Repo | null>;
  /** Opens the SidePanel for a repo (signal-driven for now — no overview route yet). */
  openRepo: (repo: Repo) => void;
  /**
   * Late-bound add-repo handler (see canvas.tsx). The leaf that owns the
   * mutation binds itself on mount and unbinds on unmount, so popover
   * submits always land on a live handler, never a disposed leaf's.
   */
  bindAddHandler: (handler: ((parsed: ParsedRepoUrl) => void) | undefined) => void;
}

export const CanvasDataContext = createContext<CanvasDataContextValue>();

export function useCanvasData(): CanvasDataContextValue {
  const ctx = useContext(CanvasDataContext);
  if (!ctx) {
    throw new Error(
      "useCanvasData() must be called within a child of the canvas layout route (src/routes/canvas.tsx)"
    );
  }
  return ctx;
}