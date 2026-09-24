import { type Component } from "solid-js";
import type { JSX } from "solid-js";
import { FiCrosshair, FiPlus } from "solid-icons/fi";

interface TopbarProps {
  adding: () => boolean;
  toggleAdd: () => void;
  recenter: () => void;
  setAddBtnRef: (el: HTMLButtonElement) => void;
  children?: JSX.Element;
}

const Topbar: Component<TopbarProps> = (props) => {
  return (
    <header class="topbar">
      <span class="wordmark"><span class="mark">·</span>Repogeist</span>
      <div class="topbar-actions">
        <div class="add-anchor">
          <button
            ref={props.setAddBtnRef}
            class="btn"
            classList={{ active: props.adding() }}
            onClick={props.toggleAdd}
            title="Ingest a public repository"
          >
            <FiPlus size={14} />add repo
          </button>
          {/* Injects the AddRepoPopover */}
          {props.children}
        </div>

        <button class="btn quiet" title="Fit all repos in view" onClick={props.recenter}>
          <FiCrosshair size={15} />
        </button>
      </div>
    </header>
  );
};

export default Topbar;