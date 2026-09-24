// code/ThemePicker.tsx — the "Theme" card, collapsed and expanded, as one
// component with one drag identity.
//
// COLLAPSED ⇄ EXPANDED, SAME CARD — this used to be two different elements:
// a plain absolutely-positioned <button> when collapsed, and a real
// DraggableCard when expanded. That's why the collapsed pill couldn't be
// dragged: it never went through DraggableCard's pointer wiring at all.
// Now ThemeCard is the only thing index.tsx mounts for this slot, and it
// stays exactly one DraggableCard instance (same `id="code:theme"`)
// regardless of open/closed. That keeps its placement in DraggableCard's
// `placed` map and its stacking in `topZ` continuous across a collapse —
// drag it while collapsed, then open it, and it opens where you left it.
//
// WHAT CHANGES ON TOGGLE — just the props fed to that one DraggableCard:
// width/height shrink to pill size, and the body swaps from the swatch list
// to a single "current theme" row that reopens it. The titlebar stays the
// drag handle in both states, same as every other card.
//
// SWATCH LOADING — theme.ts only resolves a theme's colors on demand
// (`ensureSwatchLoaded`), since resolving all ~65 bundled themes just to
// paint dots would defeat the lazy-loading this module is built around. The
// expanded list asks for every visible row's swatch on each render —
// `ensureSwatchLoaded` itself no-ops past the first call per id (module-level
// cache), so re-render-triggered calls are free. The collapsed row asks for
// just the active theme's swatch, same way.
//
// SELECTION FEEDBACK — CSS only, same reasoning as FileTree's rows: this is a
// flat list of ~65 buttons, not worth a Motion instance each.

import { createSignal, For, Show, type Component } from "solid-js";
import { FiDroplet } from "solid-icons/fi";

import { ensureSwatchLoaded, ensureThemeIdsLoaded, setTheme, swatches, theme, themeIds } from "./theme";
import { CardPos, DraggableCard } from "~/routes/canvas/components/DraggableCard";

// Same label heuristic as the old dropdown: "github-dark" → "Github Dark".
export const themeLabel = (id: string): string =>
  id
    .split("-")
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

const EXPANDED_W = 220;
const EXPANDED_H = 560;
// Pill-sized collapsed card — just tall enough for one titlebar-adjacent row.
const COLLAPSED_W = 200;
const COLLAPSED_H = 86;

const Swatch: Component<{ id: string }> = (props) => {
  ensureSwatchLoaded(props.id);
  const swatch = () => swatches()[props.id];
  return (
    <span class="theme-picker-swatch" aria-hidden="true">
      <Show when={swatch()} fallback={<span class="theme-picker-swatch-bg theme-picker-swatch-loading" />}>
        {(s) => (
          <span class="theme-picker-swatch-bg" style={{ "background-color": s().bg }}>
            <span class="theme-picker-swatch-accent" style={{ "background-color": s().accent }} />
          </span>
        )}
      </Show>
    </span>
  );
};

export interface ThemeCardProps {
  /** World-space position for the FIRST time this card ever mounts (read once). */
  defaultPos: () => CardPos;
  /** Position in the entrance stagger (0 = first). */
  index?: number;
}

/** The standalone Theme card: one DraggableCard, collapsed or expanded. */
export const ThemeCard: Component<ThemeCardProps> = (props) => {
  const [open, setOpen] = createSignal(false);

  ensureThemeIdsLoaded();
  const ids = () => themeIds() ?? [theme()];

  const choose = (id: string) => {
    setTheme(id);
    setOpen(false); // picking a theme collapses the card back
  };

  return (
    <DraggableCard
      id="code:theme"
      label="Syntax highlighting theme"
      width={open() ? EXPANDED_W : COLLAPSED_W}
      height={open() ? EXPANDED_H : COLLAPSED_H}
      index={props.index}
      defaultPos={props.defaultPos}
      icon={<FiDroplet />}
      title="Theme"
    >
      <Show
        when={open()}
        fallback={
          <button type="button" class="theme-picker-collapsed-row" onClick={() => setOpen(true)}>
            <Swatch id={theme()} />
            <span class="theme-picker-name">{themeLabel(theme())}</span>
          </button>
        }
      >
        <ul class="theme-picker-list" role="listbox" aria-label="Syntax highlighting theme">
          <For each={ids()}>
            {(id) => {
              const active = () => theme() === id;
              return (
                <li>
                  <button
                    type="button"
                    class="theme-picker-row"
                    classList={{ active: active() }}
                    role="option"
                    aria-selected={active()}
                    onClick={() => choose(id)}
                  >
                    <Swatch id={id} />
                    <span class="theme-picker-name">{themeLabel(id)}</span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </DraggableCard>
  );
};