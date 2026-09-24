import { type Component, Show, createEffect } from "solid-js";
import { Motion } from "solid-motionone";
import { FiExternalLink, FiGithub } from "solid-icons/fi";
import { Repo, healthText, languageColor, REDUCED, EASE, POP, repoKey } from "./utils";

interface RepoCardProps {
  repo: () => Repo;
  selected: () => Repo | null;
  draggingRepo: () => string | null;
  onPointerDown: (e: PointerEvent) => void;
  onClick: () => void;
  index: () => number;
}

const RepoCard: Component<RepoCardProps> = (props) => {
  let cardRef: HTMLElement | undefined;

  createEffect(() => {
    if (!cardRef) return;
    if (props.selected()?.name === props.repo().name) {
      cardRef.classList.add("active");
    } else {
      cardRef.classList.remove("active");
    }
  });

  createEffect(() => {
    if (!cardRef) return;
    if (props.draggingRepo() === repoKey(props.repo())) {
      cardRef.classList.add("dragging");
    } else {
      cardRef.classList.remove("dragging");
    }
  });

  return (
    <Motion.article
      ref={cardRef}
      class="repo-card"
      style={{ left: `${props.repo().x}px`, top: `${props.repo().y}px` }}
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      initial={
        REDUCED
          ? false
          : props.repo().fresh
            ? { opacity: 0, y: 12, scale: 0.96 }
            : { opacity: 0, scale: 0.85, y: -10 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        props.draggingRepo() === repoKey(props.repo())
          ? { duration: 0 }
          : props.repo().fresh
            ? { duration: 0.4, easing: EASE }
            : { duration: 0.55, delay: 0.35 + props.index() * 0.09, easing: POP }
      }
    >
      <header class="card-head">
        <h3>{props.repo().name}</h3>
        <span class={`dot ${props.repo().health}`} title={healthText[props.repo().health]} />
      </header>
      <p class="card-desc">
        {props.repo().description || "Awaiting first sync from GitHub."}
      </p>
      <footer class="card-foot">
        <Show when={props.repo().primaryLanguage} fallback={<span>sync pending</span>}>
          <span class="lang">
            <i style={{ background: languageColor(props.repo().primaryLanguage) }} />
            {props.repo().primaryLanguage}
          </span>
        </Show>
        <span class="card-links">
          <a
            href={`https://github.com/${props.repo().owner}/${props.repo().name}`}
            target="_blank" rel="noreferrer" title="View on GitHub"
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          >
            <FiGithub size={13} />
          </a>
          <Show when={props.repo().demo}>
            <a
              href={props.repo().demo || ""}
              target="_blank" rel="noreferrer" title="Live demo"
              onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
            >
              <FiExternalLink size={13} />
            </a>
          </Show>
        </span>
      </footer>
    </Motion.article>
  );
};

export default RepoCard;