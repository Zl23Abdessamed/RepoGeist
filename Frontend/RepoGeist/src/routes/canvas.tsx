// src/routes/canvas.tsx — THE CANVAS LAYOUT ROUTE
//
// SolidStart file routing: this file is the parent layout for every route
// under canvas/. The layout stays mounted while navigating between child
// routes, so the CanvasWrapper state (pan position, animations, etc.) survives.
//
// The outer CanvasHome state lives here:
// - repos
// - selected repo
// - closing animation state
// - active tab
// - closeRepo + Escape handling
// - SidePanel
// - late-bound add-repo handler
//
// Child routes receive this shared state through CanvasDataContext.
//
// IMPORTANT:
// CanvasLayout is CanvasWrapper's CALLER, not its child.
// Therefore it must NOT call useCanvas().
// The CanvasWrapper provides that context further down the tree.

import {
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";

import { type RouteSectionProps } from "@solidjs/router";

import "~/styles/canvas.css";

import CanvasWrapper from "./canvas/components/CanvasWrapper";
import SidePanel from "./canvas/components/SidePanel";

import type { Repo } from "./canvas/components/utils";

import {
  CanvasDataContext,
  type CanvasDataContextValue,
  type ParsedRepoUrl,
} from "./canvas/components/canvas-data";

const CanvasLayout = (props: RouteSectionProps) => {
  // ---------------------------------------------------------------------------
  // Shared canvas state
  // ---------------------------------------------------------------------------

  const [repos, setRepos] = createSignal<Repo[]>([]);

  const [selected, setSelected] = createSignal<Repo | null>(null);

  const [closing, setClosing] = createSignal(false);

  const [tab, setTab] = createSignal<
    "overview" | "graph" | "code"
  >("overview");

  // ---------------------------------------------------------------------------
  // Late-bound add-repo handler
  // ---------------------------------------------------------------------------
  //
  // The actual add-repo operation needs CanvasWrapper's context
  // (findOpenSpot, setBusy, etc.).
  //
  // CanvasWrapper is BELOW this layout, so the layout cannot directly
  // access that context.
  //
  // Instead, the child route that owns the mutation binds its handler here.
  //
  // Example:
  //
  // bindAddHandler((parsed) => {
  //   // add repository using CanvasWrapper context
  // });
  //
  // The CanvasWrapper's add-repo popover then calls this function.

  let leafAddHandler:
    | ((parsed: ParsedRepoUrl) => void)
    | undefined;

  // ---------------------------------------------------------------------------
  // Open repository
  // ---------------------------------------------------------------------------

  const openRepo = (repo: Repo) => {
    setTab("overview");
    setSelected(repo);
  };

  // ---------------------------------------------------------------------------
  // Close repository panel
  // ---------------------------------------------------------------------------

  const closeRepo = () => {
    // Nothing selected or already closing.
    if (!selected() || closing()) {
      return;
    }

    setClosing(true);

    // Allow the closing animation to finish before removing the repo.
    setTimeout(() => {
      setSelected(null);
      setClosing(false);
    }, 200);
  };

  // ---------------------------------------------------------------------------
  // Escape key
  // ---------------------------------------------------------------------------
  //
  // We use onMount + onCleanup rather than createEffect.
  //
  // createEffect does not use a returned function as a cleanup function.
  // onMount/onCleanup is the correct lifecycle pair for this DOM listener.

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRepo();
      }
    };

    window.addEventListener("keydown", onKey);

    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
    });
  });

  // ---------------------------------------------------------------------------
  // Canvas data context
  // ---------------------------------------------------------------------------

  const data: CanvasDataContextValue = {
    repos,
    setRepos,

    selected,

    openRepo,

    bindAddHandler: (handler) => {
      leafAddHandler = handler;
    },
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <CanvasDataContext.Provider value={data}>
      <CanvasWrapper
        repos={() => repos()}
        dimmed={() => !!selected()}
        onAddRepo={(parsed) => {
          leafAddHandler?.(parsed);
        }}
        overlay={
          <SidePanel
            repo={selected}
            closing={closing}
            tab={tab}
            setTab={setTab}
            closeRepo={closeRepo}
          />
        }
      >
        {/* 
          Solid Router does NOT use <Outlet /> here.

          In a SolidStart layout, the matched child route is available
          through props.children.

          This is what allows the child route to render inside the
          persistent CanvasWrapper.
        */}

        {props.children}
      </CanvasWrapper>
    </CanvasDataContext.Provider>
  );
};

export default CanvasLayout;