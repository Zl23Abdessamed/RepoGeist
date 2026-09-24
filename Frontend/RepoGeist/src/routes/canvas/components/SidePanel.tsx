import { type Component, Show, For, createMemo } from "solid-js";
import { createQuery, skipToken } from "@tanstack/solid-query";
import { A } from "@solidjs/router";
import { FiExternalLink, FiGithub, FiX, FiShare2, FiCode } from "solid-icons/fi";
import { Repo, healthText, languageColor } from "./utils";
import { repoDetailQuery } from "~/lib/repos";

// ─────────────────────────────────────────────────────────────────────────
// Overview-only panel
// ─────────────────────────────────────────────────────────────────────────
//
// Per Guide.md §5.2 / Design.md §3.3's settled decision: Graph and Code are
// no longer tabs living inside this fixed-width panel. They're routed leaves
// (src/routes/canvas/repo/[owner]/[name]/graph|code/index.tsx) that replace
// the canvas full-bleed — "you've zoomed into a smaller map inside the
// bigger one," not "here's a chart in a sidebar." SidePanel now only ever
// shows the Overview content, and offers Graph/Code as real navigations
// (via <A>, not onClick + local tab state) alongside the existing
// GitHub/Live-demo links in `.panel-actions`.
//
// `props.tab`/`props.setTab` are kept as-is in the props interface — the
// canvas layout route (canvas.tsx) still owns and passes that signal, and
// changing its shape isn't this change's concern — but this component no
// longer reads or renders anything conditioned on "graph"/"code" tab state,
// since there's nothing left inside the panel for those values to switch to.

interface SidePanelProps {
  repo: () => Repo | null;
  closing: () => boolean;
  tab: () => "overview" | "graph" | "code";
  setTab: (t: "overview" | "graph" | "code") => void;
  closeRepo: () => void;
}

const SidePanel: Component<SidePanelProps> = (props) => {
  const detailQuery = createQuery(() => {
    const r = props.repo();

    if (!r) {
      return {
        queryKey: ["repo", "", ""] as const,
        queryFn: skipToken,
      };
    }

    return repoDetailQuery(r.owner, r.name);
  });

  const detail = createMemo(() => detailQuery.data ?? null);

  return (
    <Show when={props.repo()}>
      {(repo) => (
        <>
          <div class="scrim" onClick={props.closeRepo} />

          <aside
            class="panel"
            classList={{ closing: props.closing() }}
            role="dialog"
            aria-modal="true"
          >
            <header class="panel-head">
              <div>
                <p class="panel-owner">{repo().owner}</p>
                <h2 class="panel-title">{repo().name}</h2>
              </div>

              <button
                class="btn quiet"
                onClick={props.closeRepo}
                aria-label="Close panel"
              >
                <FiX size={16} />
              </button>
            </header>

            <div class="panel-body">
              <div class="health">
                <span class={`dot ${repo().health}`} />
                <span>{healthText[repo().health]}</span>
              </div>

              <p class="panel-desc">
                <Show
                  when={repo().description}
                  fallback={
                    <span class="muted">
                      No description yet.
                    </span>
                  }
                >
                  {repo().description}
                </Show>
              </p>

              <Show when={detailQuery.isLoading}>
                <p class="panel-note">Loading detail…</p>
              </Show>

              <Show when={detailQuery.isError}>
                <p class="panel-note">
                  Couldn't load details for this repo.
                </p>
              </Show>

              <Show when={detail()}>
                {(d) => (
                  <>
                    <dl class="meta">
                      <div>
                        <dt>Entry point</dt>
                        <dd class="mono">
                          <Show
                            when={d().entryPointPath}
                            fallback={
                              <span class="muted">
                                not yet detected
                              </span>
                            }
                          >
                            {d().entryPointPath}
                          </Show>
                        </dd>
                      </div>

                      <div>
                        <dt>Stars</dt>
                        <dd>
                          <Show
                            when={Number(d().stars ?? 0) > 0}
                            fallback={
                              <span class="muted">—</span>
                            }
                          >
                            {Number(d().stars).toLocaleString("en-US")}
                          </Show>
                        </dd>
                      </div>
                    </dl>

                    <section>
                      <h4>Languages</h4>

                      <Show
                        when={(d().languages?.length ?? 0) > 0}
                        fallback={
                          <p class="panel-note">
                            No language data yet.
                          </p>
                        }
                      >
                        {(() => {
                          const stats = d().languages!;
                          const total =
                            stats.reduce(
                              (sum, s) =>
                                sum + Number(s.byteCount ?? 0),
                              0,
                            ) || 1;

                          const withShare = stats.map((s) => ({
                            name: s.language,
                            share:
                              Number(s.byteCount ?? 0) / total,
                            color: languageColor(s.language),
                          }));

                          return (
                            <>
                              <div class="lang-bar">
                                <For each={withShare}>
                                  {(l) => (
                                    <i
                                      style={{
                                        width: `${l.share * 100}%`,
                                        background: l.color,
                                      }}
                                      title={`${l.name} ${Math.round(
                                        l.share * 100,
                                      )}%`}
                                    />
                                  )}
                                </For>
                              </div>

                              <ul class="lang-legend">
                                <For each={withShare}>
                                  {(l) => (
                                    <li>
                                      <i
                                        style={{
                                          background: l.color,
                                        }}
                                      />

                                      {l.name}{" "}
                                      <span class="muted">
                                        {Math.round(
                                          l.share * 100,
                                        )}
                                        %
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </>
                          );
                        })()}
                      </Show>
                    </section>

                    <section>
                      <h4>Contributors</h4>

                      <Show
                        when={
                          (d().contributors?.length ?? 0) > 0
                        }
                        fallback={
                          <p class="panel-note">
                            No contributor data yet.
                          </p>
                        }
                      >
                        <div class="avatars">
                          <For each={d().contributors}>
                            {(c) => (
                              <span class="avatar">
                                {(c.githubUsername ?? "?")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </section>
                  </>
                )}
              </Show>

              <div class="panel-actions">
                <a
                  class="btn"
                  href={`https://github.com/${repo().owner}/${repo().name}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FiGithub size={14} />
                  GitHub
                </a>

                <Show when={repo().demo}>
                  <a
                    class="btn"
                    href={repo().demo!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FiExternalLink size={14} />
                    Live demo
                  </a>
                </Show>

                {/* Full-bleed navigations, not tab switches — leaving this
                    panel's "overview" content, the canvas world swaps to the
                    graph/code leaf underneath (see the .../graph and
                    .../code route files). SidePanel itself stays mounted and
                    keeps showing this same repo's overview regardless. */}
                <A
                  class="btn"
                  href={`/canvas/repo/${repo().owner}/${repo().name}/graph`}
                >
                  <FiShare2 size={14} />
                  Graph
                </A>

                <A
                  class="btn"
                  href={`/canvas/repo/${repo().owner}/${repo().name}/code`}
                >
                  <FiCode size={14} />
                  Code
                </A>
              </div>
            </div>
          </aside>
        </>
      )}
    </Show>
  );
};

export default SidePanel;