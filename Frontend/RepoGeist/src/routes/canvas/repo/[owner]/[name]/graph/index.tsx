// src/routes/canvas/repo/[owner]/[name]/graph/index.tsx — THE ".../graph" LEAF
//
// Per Design.md §3.3 / §5.2 and Guide.md's "open decision" note, this leaf
// takes the full-bleed path: the dependency graph REPLACES the canvas's
// world content spatially (like the outer canvas, just zoomed one layer in),
// rather than living inside SidePanel's fixed-width tab. SidePanel itself
// (the layout-owned overview overlay) is unaffected — it keeps rendering
// from canvas.tsx regardless of which leaf is mounted underneath it.
//
// This file is a leaf under the canvas.tsx layout route (see that file's
// header comment), so CanvasWrapper's shell — stage/world/view signal,
// wheel/pointer pan handlers, Topbar — is already mounted above this and is
// NOT re-created here. Only `.world`'s *contents* change when navigating
// here from "/canvas" or an owner/name sibling leaf.
//
// Data: dependencyGraphQuery (~/lib/analysis) returns null on 404 ("not
// analyzed yet" — see that file's extensive comment on why 404 isn't an
// error state here) rather than throwing. With the analyzer pipeline
// currently disabled server-side (per analysis.ts's notes), every repo will
// show the "not yet analyzed" empty state below until that's wired up.
//
// Layout (TechGuide.md §1.3): SVG, not Canvas/WebGL — nodes are real DOM
// elements (hit-testing/hover/accessibility), edges are trivial as SVG
// lines/curves. d3-force computes positions each tick; Solid owns the DOM.

import { createEffect, createMemo, For, onCleanup, Show, type Component } from "solid-js";
import { useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { forceSimulation, forceLink, forceManyBody, forceCenter, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force";
import { createStore } from "solid-js/store";
import { useCanvasData } from "../../../../components/canvas-data";
import { dependencyGraphQuery } from "~/lib/analysis";
import type { components } from "~/types/types";

type GraphNodeDto = components["schemas"]["GraphNodeDto"];
type GraphEdgeDto = components["schemas"]["GraphEdgeDto"];

// d3-force mutates .x/.y/.vx/.vy onto whatever objects you hand it, so the
// simulation's own node type is the DTO plus those fields — this is d3's
// convention, not a Repogeist-specific shape.
interface SimNode extends SimulationNodeDatum {
  id: string;
  nodeType: string;
  pathOrName: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edgeType: string;
}

// A file (not function) node's short label — the tail segment of a path
// reads far better on a card-sized SVG node than the full path does.
const shortLabel = (pathOrName: string) => pathOrName.split("/").pop() ?? pathOrName;

const GraphView: Component = () => {
  const params = useParams<{ owner: string; name: string }>();
  // Only used here for the repo title in the header strip — the graph data
  // itself comes from the route params, not from canvas-local state, so this
  // leaf works from a deep link even if the repo isn't the `selected` one.
  const canvasData = useCanvasData();

  const graphQuery = createQuery(() => dependencyGraphQuery(params.owner, params.name));

  const repoTitle = createMemo(() => {
    const match = canvasData.repos().find(
      (r) => r.owner.toLowerCase() === params.owner.toLowerCase() && r.name.toLowerCase() === params.name.toLowerCase(),
    );
    return match ? `${match.owner}/${match.name}` : `${params.owner}/${params.name}`;
  });

  // Rendered node/link positions, ticked by the simulation. A store (not a
  // plain signal re-set every tick) so <For> only re-renders the individual
  // <g> that actually moved rather than diffing the whole node list on every
  // animation frame.
  const [positions, setPositions] = createStore<{ nodes: SimNode[]; links: SimLink[] }>({
    nodes: [],
    links: [],
  });

  let sim: ReturnType<typeof forceSimulation<SimNode>> | undefined;

  createEffect(() => {
    // Tear down any simulation from a previous graph before building a new
    // one — otherwise switching repos (or a refetch after analysis
    // completes) would leave a stale tick loop running against nodes that
    // no longer exist in `positions`.
    sim?.stop();

    const graph = graphQuery.data;
    if (!graph) {
      setPositions({ nodes: [], links: [] });
      return;
    }

    const nodes: SimNode[] = (graph.nodes ?? []).map((n: GraphNodeDto) => ({
      id: n.id ?? "",
      nodeType: n.nodeType ?? "file",
      pathOrName: n.pathOrName ?? "",
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const links: SimLink[] = (graph.edges ?? [])
      .filter((e: GraphEdgeDto) => nodeById.has(e.sourceNodeId ?? "") && nodeById.has(e.targetNodeId ?? ""))
      .map((e: GraphEdgeDto) => ({
        source: nodeById.get(e.sourceNodeId ?? "")!,
        target: nodeById.get(e.targetNodeId ?? "")!,
        edgeType: e.edgeType ?? "imports",
      }));

    sim = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-160))
      .force("link", forceLink<SimNode, SimLink>(links).distance(90).strength(0.6))
      .force("center", forceCenter(0, 0))
      .on("tick", () => {
        setPositions({ nodes: [...nodes], links: [...links] });
      });
  });

  onCleanup(() => sim?.stop());

  return (
    <div class="graph-view">
      <header class="graph-header">
        <p class="graph-owner">{repoTitle()}</p>
        <h2 class="graph-title font-display">Dependency graph</h2>
      </header>

      <Show when={graphQuery.isLoading}>
        <p class="muted graph-status">Loading graph…</p>
      </Show>

      <Show when={graphQuery.isError}>
        <p class="muted graph-status">Couldn't load the dependency graph. Try again shortly.</p>
      </Show>

      {/* dependencyGraphQuery resolves `null` (not an error) when no analysis
          has completed yet — see analysis.ts. This is the expected common
          case while the analyzer pipeline is disabled server-side. */}
      <Show when={graphQuery.isSuccess && graphQuery.data === null}>
        <div class="empty graph-status">
          <p>This repo hasn't been analyzed yet.</p>
          <p class="muted">Kick off an analysis from the Overview panel to see its file graph here.</p>
        </div>
      </Show>

      <Show when={graphQuery.isSuccess && graphQuery.data}>
        <svg class="graph-svg" viewBox="-400 -300 800 600" preserveAspectRatio="xMidYMid meet">
          <g class="graph-edges">
            <For each={positions.links}>
              {(link) => {
                const s = link.source as SimNode;
                const t = link.target as SimNode;
                return <line x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0} />;
              }}
            </For>
          </g>
          <g class="graph-nodes">
            <For each={positions.nodes}>
              {(node) => (
                <g class="graph-node" classList={{ function: node.nodeType === "function" }} transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}>
                  <circle r={node.nodeType === "function" ? 5 : 7} />
                  <text dy={-12}>{shortLabel(node.pathOrName)}</text>
                </g>
              )}
            </For>
          </g>
        </svg>
      </Show>
    </div>
  );
};

export default GraphView;