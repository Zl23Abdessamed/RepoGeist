import { createEffect, type Component, Show, onMount, onCleanup } from "solid-js";
import type { Setter } from "solid-js";
import { Motion, Presence } from "solid-motionone";
import { FiX } from "solid-icons/fi";
import { parseRepoUrl, EASE_OUT, EASE, REDUCED } from "./utils";

interface AddRepoPopoverProps {
  show: () => boolean;
  close: () => void;
  // Matches CreateRepoRequestDto's shape: POST /api/repos takes a single
  // `repoUrl: string`, not a separate owner/name pair — the backend does its own
  // parsing server-side. `owner`/`name` are passed alongside purely so the caller
  // can do an optimistic dupe-check without re-parsing the URL itself.
  onSubmit: (parsed: { owner: string; name: string; url: string }) => void;
  triggerRef: () => HTMLButtonElement | undefined;
  urlValue: () => string;
  setUrlValue: Setter<string>;
  ingestError: () => string;
  setIngestError: Setter<string>;
  busy: () => boolean;
  setBusy: Setter<boolean>;
}

const AddRepoPopover: Component<AddRepoPopoverProps> = (props) => {
  let urlInput: HTMLInputElement | undefined;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (props.busy()) return;

    const parsed = parseRepoUrl(props.urlValue());
    if (!parsed) {
      props.setIngestError("That doesn't parse as a repository. Expected github.com/owner/repo.");
      urlInput?.focus();
      return;
    }
    props.setIngestError("");
    props.setBusy(true);
    props.onSubmit(parsed);
  };

  const handleClose = () => {
    if (!props.busy()) props.close();
  };

  // Reset internal/external state cleanly every time the popover mounts
  createEffect(() => {
    if (props.show()) {
      props.setUrlValue("");
      props.setIngestError("");
      props.setBusy(false);
      setTimeout(() => urlInput?.focus(), 0);
    }
  });

  onMount(() => {
    const onPointerDownOutside = (e: PointerEvent) => {
      if (!props.show()) return;
      const target = e.target as Node;
      const trigger = props.triggerRef();
      if (trigger?.contains(target)) return;
      if (!(e.target as HTMLElement).closest?.(".add-popover")) handleClose();
    };
    window.addEventListener("pointerdown", onPointerDownOutside);
    onCleanup(() => window.removeEventListener("pointerdown", onPointerDownOutside));
  });

  return (
    <Presence>
      <Show when={props.show()}>
        <Motion.div
          class="add-popover"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-repo-title"
          initial={REDUCED ? false : { opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.14, easing: EASE } }}
          transition={{ duration: 0.22, easing: EASE_OUT }}
          style={{ "transform-origin": "top right" }}
        >
          <header class="popover-head">
            <h2 id="add-repo-title" class="popover-title">Add a repository</h2>
            <button class="btn quiet" onClick={handleClose} aria-label="Close" disabled={props.busy()}>
              <FiX size={14} />
            </button>
          </header>

          <form onSubmit={handleSubmit}>
            <div class="popover-row">
              <input
                id="repo-url"
                ref={urlInput}
                class="url-input"
                classList={{ invalid: !!props.ingestError() }}
                type="text"
                placeholder="github.com/owner/repo"
                value={props.urlValue()}
                onInput={(e) => {
                  props.setUrlValue(e.currentTarget.value);
                  if (props.ingestError()) props.setIngestError("");
                }}
                disabled={props.busy()}
                spellcheck={false}
                autocomplete="off"
              />
              <button type="submit" class="btn btn-primary" disabled={props.busy()}>
                {props.busy() ? "Ingesting…" : "Add"}
              </button>
            </div>
            <Show
              when={props.ingestError()}
              fallback={<p class="field-help">Public repos only — full URL or owner/repo shorthand weeeeeeeeeeeeeee</p>}
            >
              <p class="field-error">{props.ingestError()}</p>
            </Show>
          </form>
        </Motion.div>
      </Show>
    </Presence>
  );
};

export default AddRepoPopover;