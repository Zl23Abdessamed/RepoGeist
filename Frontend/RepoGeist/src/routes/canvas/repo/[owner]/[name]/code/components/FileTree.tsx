// code/FileTree.tsx — the left-pane explorer: accordion-style, root-collapsed
// by default.
//
//   • Directories are BUTTONS that toggle open/closed. Open state lives in an
//     expanded-Set owned by CodeView (not per-row), so the reveal effect can
//     open a whole folder chain, and state survives tree refetches.
//   • A directory's children mount ONLY while it's expanded — the initial view
//     shows just the root level, like a file explorer.
//   • Files are buttons that load their content into the right pane.
//   • --depth drives per-level indentation via CSS; no nested wrapper divs.
//
// ANIMATION — the one place Presence genuinely works in this leaf: a directory
// row stays mounted while `expanded.has(path)` flips, so children get a real
// enter/exit. Only opacity/transform are animated — no height tween. (WAAPI
// can't interpolate to `auto`, and per-frame measurement on deep trees would
// jank; the slide+fade reads as an accordion without layout thrash.) Rows
// themselves stay plain buttons: repos can have thousands of entries, and a
// Motion instance per row isn't worth it — selection feedback is CSS.

import { For, Show, type Component } from "solid-js";
import { Motion, Presence } from "solid-motionone";
import { FiChevronDown, FiChevronRight, FiFile, FiFolder } from "solid-icons/fi";
import type { TreeNode } from "./tree";
import { EASE, EASE_OUT, REDUCED } from "./utils";

export interface FileTreeProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  activePath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}

interface BranchProps extends FileTreeProps {
  depth: number;
}

/** Public entry point — always starts at the root level. */
export const FileTree: Component<FileTreeProps> = (props) => (
  <FileTreeBranch
    nodes={props.nodes}
    depth={0}
    expanded={props.expanded}
    activePath={props.activePath}
    onToggleDir={props.onToggleDir}
    onSelectFile={props.onSelectFile}
  />
);

const FileTreeBranch: Component<BranchProps> = (props) => (
  <ul class="file-tree-branch">
    <For each={props.nodes}>
      {(node) => (
        <li>
          <Show
            when={node.isDirectory}
            fallback={
              <button
                type="button"
                class="file-tree-row is-file"
                classList={{ active: props.activePath === node.path }}
                style={{ "--depth": String(props.depth) }}
                onClick={() => props.onSelectFile(node.path)}
              >
                <FiFile class="file-tree-icon" />
                <span class="file-tree-name">{node.name}</span>
              </button>
            }
          >
            <button
              type="button"
              class="file-tree-row is-dir"
              classList={{ open: props.expanded.has(node.path) }}
              aria-expanded={props.expanded.has(node.path)}
              style={{ "--depth": String(props.depth) }}
              onClick={() => props.onToggleDir(node.path)}
            >
              <Show
                when={props.expanded.has(node.path)}
                fallback={<FiChevronRight class="file-tree-chevron" />}
              >
                <FiChevronDown class="file-tree-chevron" />
              </Show>
              <FiFolder class="file-tree-icon" />
              <span class="file-tree-name">{node.name}</span>
            </button>
            <Presence>
              <Show when={props.expanded.has(node.path)}>
                <Motion.div
                  class="file-tree-children"
                  initial={REDUCED ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3, transition: { duration: 0.1, easing: EASE } }}
                  transition={{ duration: 0.18, easing: EASE_OUT }}
                >
                  <FileTreeBranch
                    nodes={node.children}
                    depth={props.depth + 1}
                    expanded={props.expanded}
                    activePath={props.activePath}
                    onToggleDir={props.onToggleDir}
                    onSelectFile={props.onSelectFile}
                  />
                </Motion.div>
              </Show>
            </Presence>
          </Show>
        </li>
      )}
    </For>
  </ul>
);