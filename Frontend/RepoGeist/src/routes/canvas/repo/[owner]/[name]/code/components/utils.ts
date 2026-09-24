// code/utils.ts — motion constants shared by the code leaf's components.
//
// Same curves the canvas chrome uses (AddRepoPopover & co), so the code view
// moves like the rest of the app. If these ever get lifted into a shared
// module (~/lib/motion.ts), this file should re-export from there instead.

export type Easing = [number, number, number, number];

/** Fast start, long gentle settle — the default curve for things appearing. */
export const EASE_OUT: Easing = [0.22, 1, 0.36, 1];

/** Balanced curve — used for exits, which should read calmer than entrances. */
export const EASE: Easing = [0.4, 0, 0.2, 1];

/**
 * Evaluated once at module load. Every animated element passes
 * `initial={REDUCED ? false : {...}}` so, under `prefers-reduced-motion`,
 * things render straight in their final position — no slide, no fade.
 */
export const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;