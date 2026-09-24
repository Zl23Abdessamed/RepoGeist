// code/theme.ts — the syntax-highlighting theme: which one is active, the
// full list to populate the Theme card's picker with, a lazily-resolved
// color swatch per theme, and localStorage persistence.
//
// LIST SOURCE — `bundledThemes` from the `shiki` package itself, not a
// hand-typed list. shiki re-distributes the textmate-grammars-themes/
// tm-themes collection (https://textmate-grammars-themes.netlify.app/ is a
// gallery of the same set) and its theme ids shift across versions — reading
// the package's own export keeps the picker correct for whatever version
// is installed instead of drifting out of sync with it. Loaded the same way
// CodeBlock.tsx already loads `bundledLanguages`: a lazy `import("shiki")`,
// not a static top-level one, so this module costs nothing until a theme
// list is actually requested (module-level `import()` results are cached by
// the runtime, so asking twice doesn't re-fetch).
//
// WHY A MODULE-LEVEL SIGNAL, NOT PROPS — CodeBlock (the highlighter) and
// ThemePicker (the Theme card's body) are siblings under CodeView, not
// parent/child, and CodeView itself has no other use for theme state.
// Threading it through props would mean lifting it into CodeView just to
// pass it back down two different branches. A tiny shared store is simpler.
//
// PERSISTENCE — read synchronously at module init (not in an effect) so the
// first paint already uses the saved theme; an effect would paint the
// default once and then flicker to the saved value a tick later.

import { createSignal } from "solid-js";

export const DEFAULT_THEME = "github-dark";
const STORAGE_KEY = "code-theme";

// Whether the Theme card is showing the picker list (true) or collapsed down
// to just the current-theme button (false). Lives here, not in ThemePicker,
// because index.tsx needs it too — to shrink the card's height while
// collapsed. Same shared-store idiom as `theme` above.
const [themeOpen, setThemeOpenRaw] = createSignal(false);
export { themeOpen };
export const setThemeOpen = (open: boolean): void => setThemeOpenRaw(open);

function readStoredTheme(): string | null {
  if (typeof localStorage === "undefined") return null; // SSR guard
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled / full / private-mode throw
  }
}

function writeStoredTheme(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore — theme just won't persist this session
  }
}

const [theme, setThemeRaw] = createSignal<string>(readStoredTheme() ?? DEFAULT_THEME);

/** The active shiki theme id. CodeBlock reads this to highlight with. */
export { theme };

/** Change the active theme and persist it. */
export function setTheme(id: string): void {
  setThemeRaw(id);
  writeStoredTheme(id);
}

// The Theme card's row list. Cached module-wide after first resolution —
// every card/instance shares one fetch. `null` while unresolved, so the
// list can render just the current theme until the rest finish loading
// (typically instant since `bundledThemes` is a plain object of lazy
// loaders, not the theme data itself).
const [themeIds, setThemeIds] = createSignal<string[] | null>(null);
export { themeIds };

let loading: Promise<void> | null = null;

export function ensureThemeIdsLoaded(): void {
  if (themeIds() !== null || loading) return;
  loading = import("shiki")
    .then(({ bundledThemes }) => {
      setThemeIds(Object.keys(bundledThemes).sort((a, b) => a.localeCompare(b)));
    })
    .catch(() => {
      // Fall back to just the theme already in use, so the dropdown still
      // renders something selectable instead of staying empty forever.
      setThemeIds([theme()]);
    })
    .finally(() => {
      loading = null;
    });
}

// ── swatches ──────────────────────────────────────────────────────────────
// A picker that shows real colors (not just an id string) needs each theme's
// editor background/foreground plus one accent token color. `bundledThemes`
// only hands back LAZY LOADERS though — the id list above is free (reading
// object keys), but resolving what a theme actually looks like means
// awaiting that theme's own module. Doing that for all ~65 themes on picker
// mount would import every theme just to draw a list of dots, which is
// exactly what this module otherwise avoids (see the module banner).
//
// So this is cached per id, resolved on demand — the picker calls
// `ensureSwatchLoaded(id)` for whichever rows it's about to render, and reads
// the result out of `swatches()` as a plain record (id → Swatch | undefined
// | null). `null` means "resolved but this theme had no usable colors",
// which is distinct from `undefined` ("not asked for yet / still loading")
// so the picker can tell "still loading" from "loaded, nothing to show".
export interface ThemeSwatch {
  /** The theme's own editor background, e.g. "#24292e". */
  bg: string;
  /** The theme's own editor foreground. */
  fg: string;
  /** One representative token color, for a small accent dot. Falls back to `fg`. */
  accent: string;
}

const [swatches, setSwatches] = createSignal<Record<string, ThemeSwatch | null>>({});
export { swatches };

const swatchLoading = new Set<string>();

export function ensureSwatchLoaded(id: string): void {
  if (id in swatches() || swatchLoading.has(id)) return;
  swatchLoading.add(id);
  import("shiki")
    .then(async ({ bundledThemes }) => {
      const loader = bundledThemes[id as keyof typeof bundledThemes];
      if (!loader) {
        setSwatches((prev) => ({ ...prev, [id]: null }));
        return;
      }
      const mod = await loader();
      // shiki themes are shipped as `{ default: ... }` on some bundlers and
      // as the theme object directly on others — handle both rather than
      // assuming.
      const raw = (mod as { default?: unknown }).default ?? mod;
      const t = raw as {
        colors?: Record<string, string>;
        tokenColors?: { settings?: { foreground?: string } }[];
      };
      const bg = t.colors?.["editor.background"];
      const fg = t.colors?.["editor.foreground"];
      if (!bg || !fg) {
        setSwatches((prev) => ({ ...prev, [id]: null }));
        return;
      }
      const accent = t.tokenColors?.find((tc) => tc.settings?.foreground)?.settings?.foreground ?? fg;
      setSwatches((prev) => ({ ...prev, [id]: { bg, fg, accent } }));
    })
    .catch(() => {
      setSwatches((prev) => ({ ...prev, [id]: null }));
    })
    .finally(() => {
      swatchLoading.delete(id);
    });
}