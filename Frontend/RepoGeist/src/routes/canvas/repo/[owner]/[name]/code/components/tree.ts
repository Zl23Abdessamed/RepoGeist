// code/tree.ts — pure helpers that turn the backend's flat file list into a
// renderable tree. No Solid, no queries — deliberately framework-free so the
// nesting/sorting rules stay trivially unit-testable.

import type { FileTreeNode } from "~/lib/clone";

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

/** "a//b/" → "a/b". Drops empty segments so stray slashes can't create phantom nodes. */
export function normalizePath(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

/**
 * Nests the backend's FLAT node list (backend.md §6.2 — FileTreeDto) into a tree.
 *
 * The backend may or may not list directories explicitly, so any directory implied
 * by a file's path ("src/lib" for "src/lib/a.ts") is created on demand. Directories
 * sort before files, then by name, so the tree reads like an editor's explorer.
 */
export function buildTree(nodes: readonly FileTreeNode[]): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  const ensure = (path: string, isDirectory: boolean): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;

    const slash = path.lastIndexOf("/");
    const node: TreeNode = {
      name: slash === -1 ? path : path.slice(slash + 1),
      path,
      isDirectory,
      children: [],
    };
    byPath.set(path, node);
    // A node's parent is always a directory, even if the backend never listed it.
    (slash === -1 ? root : ensure(path.slice(0, slash), true).children).push(node);
    return node;
  };

  for (const n of nodes) {
    const path = normalizePath(n.path);
    if (path) ensure(path, n.isDirectory);
  }

  const sortLevel = (level: TreeNode[]) => {
    level.sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    );
    level.forEach((n) => sortLevel(n.children));
  };
  sortLevel(root);
  return root;
}

export function collectFilePaths(nodes: readonly TreeNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.isDirectory) collectFilePaths(n.children, into);
    else into.add(n.path);
  }
  return into;
}

/**
 * Which file to show before the person has picked one, so opening Code doesn't
 * land on an empty right pane. Prefers a root-level README, then any root-level
 * file (package.json, Program.cs, ...), and only then digs into directories — a
 * plain depth-first pick would open something like `.github/workflows/ci.yml`.
 */
export function pickDefaultFile(tree: readonly TreeNode[]): string | null {
  const rootFiles = tree.filter((n) => !n.isDirectory);
  const readme = rootFiles.find((n) => /^readme(\.|$)/i.test(n.name));
  if (readme) return readme.path;
  if (rootFiles.length > 0) return rootFiles[0].path;

  const firstFile = (nodes: readonly TreeNode[]): string | null => {
    for (const n of nodes) {
      const found = n.isDirectory ? firstFile(n.children) : n.path;
      if (found) return found;
    }
    return null;
  };
  return firstFile(tree);
}