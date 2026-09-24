// code/CodeBlock.tsx — the file body: shiki-highlighted, with plain-text
// fallbacks for oversized files and while highlighting is in flight.
//
// THEME — highlighted with whatever `theme.ts`'s shared signal currently
// holds (user-selectable, see the dropdown in CodeView's file-card titlebar).
// No light/dark split: a single named shiki theme supplies both foreground
// token colors and background, and code.css deliberately makes that
// background win over the card surface (`.code-highlighted pre.shiki {
// background: transparent !important }` was for the old fixed github-dark —
// see the note there) — the whole point of a theme picker is that the block
// can look like a VS Code screenshot in whatever palette was chosen, so the
// background must NOT be forced transparent per-theme. See code.css.
//
// ANIMATION — the highlighted <div> fades in the moment shiki resolves. It
// mounts in exactly the position the raw <pre> occupied, so there's no layout
// shift — just the paint upgrading under the reader's eye.

import { createResource, Show, type Component } from "solid-js";
import { Motion } from "solid-motionone";
import { theme } from "./theme";
import { EASE_OUT, REDUCED } from "./utils";

// Highlighting runs on the main thread, and repos contain lockfiles / minified
// bundles that are megabytes of text. Past this size the highlighter can freeze the
// tab for seconds, so the file is shown as plain text instead.
const MAX_HIGHLIGHT_CHARS = 150_000;

export const CodeBlock: Component<{ code: string; language: string | null }> = (props) => {
  const skip = () => props.code.length > MAX_HIGHLIGHT_CHARS;

  // Shiki's highlighter is async to create and reasonably heavy — the shorthand
  // codeToHtml shares a module-level singleton and loads languages/themes on demand,
  // so the "one shared instance" behavior is built in. The resource re-runs when the
  // code, language, OR theme changes — switching the dropdown re-highlights whatever
  // file is currently open.
  const [html] = createResource(
    () => (skip() ? null : { code: props.code, lang: (props.language ?? "text").toLowerCase(), theme: theme() }),
    async (input) => {
      // Everything sits inside the try — including the dynamic import — because a
      // rejected resource would throw when read below and take down the route.
      try {
        const { codeToHtml, bundledLanguages, bundledThemes } = await import("shiki");
        // Unknown language ids fall back to plain text ("text" is a shiki special
        // lang with no grammar, so it can't itself throw).
        const lang = input.lang in bundledLanguages ? input.lang : "text";
        // Unknown/mid-switch theme ids fall back the same way, rather than throwing
        // and leaving the previous file's highlighting stuck on screen.
        const themeId = input.theme in bundledThemes ? input.theme : "github-dark";
        return await codeToHtml(input.code, { lang, theme: themeId });
      } catch {
        return "";
      }
    },
  );

  return (
    <>
      <Show when={skip()}>
        <p class="muted code-status">Large file — syntax highlighting skipped.</p>
      </Show>
      {/* `html.loading` is checked BEFORE `html()`: reading a pending resource
          suspends the nearest <Suspense>, which would blank the whole route on
          every file switch. While highlighting runs, the raw text shows instead. */}
      <Show when={!html.loading && html()} fallback={<pre class="code-raw">{props.code}</pre>}>
        {(markup) => (
          <Motion.div
            class="code-highlighted"
            initial={REDUCED ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, easing: EASE_OUT }}
            innerHTML={markup()}
          />
        )}
      </Show>
    </>
  );
};