// src/routes/landing.tsx — Repogeist marketing/landing page
//
// Motion throughout via solid-motionone: an orchestrated hero entrance,
// scroll-triggered section reveals, a working tab demo, live health
// pulses and a scroll-progress hairline. Scroll triggers use a tiny
// IntersectionObserver hook; every animated value is a reactive signal
// fed straight into Motion's `animate` prop. Everything collapses to
// static content under prefers-reduced-motion.

import "~/styles/landing.css";
import {
  createSignal,
  For,
  Show,
  onMount,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import { Motion, Presence } from "solid-motionone";
import { FiGithub, FiArrowRight } from "solid-icons/fi";

const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
// overshoot bezier that mimics a spring pop without needing spring options
const POP: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

// --- scroll trigger: returns [inView signal, callback ref] --------------
function createInView(threshold = 0.25) {
  const [inView, setInView] = createSignal(false);
  let observer: IntersectionObserver | undefined;
  const ref = (el: HTMLElement) => {
    if (!el) return;
    if (REDUCED) {
      setInView(true);
      return;
    }
    observer?.disconnect();
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer?.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(el);
  };
  onCleanup(() => observer?.disconnect());
  return [inView, ref] as const;
}

// --- infinite helpers: no-ops under reduced motion ----------------------
const Float: Component<{ delay?: number; duration?: number; children: JSX.Element }> = (props) =>
  REDUCED ? (
    <>{props.children}</>
  ) : (
    <Motion.div
      animate={{ y: [0, -7, 0] }}
      transition={{
        duration: props.duration ?? 3.5,
        repeat: Infinity,
        easing: "ease-in-out",
        delay: props.delay ?? 0,
      }}
    >
      {props.children}
    </Motion.div>
  );

const Nudge: Component<{ children: JSX.Element }> = (props) =>
  REDUCED ? (
    <>{props.children}</>
  ) : (
    <Motion.span
      animate={{ x: [0, 4, 0] }}
      transition={{ duration: 2.2, repeat: Infinity, easing: "ease-in-out" }}
    >
      {props.children}
    </Motion.span>
  );

// --- word-by-word masked reveal ------------------------------------------
// Each word sits in an overflow-hidden mask and slides up when `when` is
// true (defaults to true — pass a signal for scroll-triggered headings).
const MaskWords: Component<{
  text: string;
  delay?: number;
  stagger?: number;
  when?: boolean;
}> = (props) => {
  const words = props.text.split(" ");
  return (
    <For each={words}>
      {(word, i) => (
        <span class="w-mask">
          <Show
            when={props.when !== false}
            fallback={<span class="w-word">{word}</span>}
          >
            <Motion.span
              class="w-word"
              initial={REDUCED ? false : { y: "110%" }}
              animate={{ y: "0%" }}
              transition={{
                duration: 0.7,
                delay: (props.delay ?? 0) + i() * (props.stagger ?? 0.07),
                easing: EASE_OUT,
              }}
            >
              {word}
            </Motion.span>
          </Show>
        </span>
      )}
    </For>
  );
};

// --- hero terrain: inert card artifacts, now drifting gently -------------
const TERRAIN_CARDS = [
  { name: "waypoint", health: "up" as const, desc: "Drift-corrected cron scheduler, ships as a static binary.", top: 8, left: 6, accent: false },
  { name: "beacon", health: "up" as const, desc: "Self-hosted status pages with incident history.", top: 148, left: 46, accent: true },
  { name: "cormorant", health: "unknown" as const, desc: "Dead-letter queue inspector for RabbitMQ.", top: 280, left: 2, accent: false },
  { name: "substrate", health: "unknown" as const, desc: "Embedded append-only store, reasonable compaction.", top: 340, left: 52, accent: false },
];

const HeroTerrainCard: Component<{
  card: (typeof TERRAIN_CARDS)[number];
  index: number;
}> = (props) => (
  <div
    class="terrain-card-slot"
    style={{ top: `${props.card.top}px`, left: `${props.card.left}%` }}
  >
    <Motion.div
      class="terrain-card"
      classList={{ accent: props.card.accent }}
      initial={REDUCED ? false : { opacity: 0, y: 30, scale: 0.92, rotate: -2 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
      transition={{ duration: 0.75, delay: 0.4 + props.index * 0.12, easing: EASE }}
    >
      <Float delay={props.index * 0.5} duration={3.2 + props.index * 0.55}>
        <div class="t-head">
          <strong>{props.card.name}</strong>
          <span class={`t-dot ${props.card.health}`} />
        </div>
        <p class="t-desc">{props.card.desc}</p>
      </Float>
    </Motion.div>
  </div>
);

// --- premise: words light up as you arrive -------------------------------
const Premise: Component = () => {
  const [inView, ref] = createInView(0.45);
  const WORDS =
    "Understanding a codebase is cartography and excavation — you're looking at terrain, and opening a repo is digging one layer down to see what's underneath.".split(
      " "
    );
  const MUTED = new Set(["cartography", "and", "excavation"]);
  return (
    <section class="premise">
      <p ref={ref}>
        <For each={WORDS}>
          {(word, i) => (
            <Motion.span
              class={MUTED.has(word) ? "p-muted" : undefined}
              initial={REDUCED ? false : { opacity: 0.12, y: 6 }}
              animate={
                inView()
                  ? { opacity: 1, y: 0 }
                  : { opacity: 0.12, y: 6 }
              }
              transition={{ duration: 0.45, delay: i() * 0.018, easing: EASE }}
            >
              {word}{" "}
            </Motion.span>
          )}
        </For>
      </p>
    </section>
  );
};

// --- shared section head with masked heading ------------------------------
const SectionHead: Component<{ kicker: string; title: string }> = (props) => {
  const [inView, ref] = createInView(0.4);
  return (
    <div class="section-head" ref={ref}>
      <Motion.p
        class="kicker"
        initial={REDUCED ? false : { opacity: 0, y: 10 }}
        animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.5, easing: EASE }}
      >
        {props.kicker}
      </Motion.p>
      <h2>
        <MaskWords text={props.title} stagger={0.045} when={inView()} />
      </h2>
    </div>
  );
};

// --- feature row: copy and visual slide in from opposite sides ------------
const FeatureRow: Component<{
  reverse?: boolean;
  title: string;
  body: string;
  visual: JSX.Element;
}> = (props) => {
  const [inView, ref] = createInView(0.3);
  const fromX = () => (props.reverse ? 48 : -48);
  return (
    <Motion.section
      class={`feature-row${props.reverse ? " reverse" : ""}`}
      ref={ref}
      initial={REDUCED ? false : { opacity: 0, y: 30 }}
      animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.7, easing: EASE }}
    >
      <Motion.div
        class="feature-copy"
        initial={false}
        animate={
          inView() ? { opacity: 1, x: 0 } : { opacity: 0, x: fromX() }
        }
        transition={{ duration: 0.7, delay: 0.1, easing: EASE }}
      >
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </Motion.div>
      <Motion.div
        class="feature-visual"
        initial={false}
        animate={
          inView() ? { opacity: 1, x: 0 } : { opacity: 0, x: -fromX() }
        }
        transition={{ duration: 0.7, delay: 0.2, easing: EASE }}
      >
        {props.visual}
      </Motion.div>
    </Motion.section>
  );
};

// --- feature 1 visual: the canvas mock, cards drop in ----------------------
const VisualCanvas: Component = () => {
  const [inView, ref] = createInView(0.4);
  const cards = [
    { cls: "a", name: "atlas", meta: "TypeScript · 1.4k★" },
    { cls: "b", name: "meridian", meta: "TypeScript · 1.1k★" },
    { cls: "c", name: "fieldnotes", meta: "Python · 318★" },
  ];
  return (
    <div
      class="mock-canvas"
      ref={ref}
      role="img"
      aria-label="Repo cards scattered across a pannable canvas"
    >
      <For each={cards}>
        {(c, i) => (
          <Motion.div
            class={`mc-card ${c.cls}`}
            initial={REDUCED ? false : { opacity: 0, scale: 0.6, y: -16 }}
            animate={
              inView() ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.6, y: -16 }
            }
            transition={{ duration: 0.6, delay: 0.25 + i() * 0.15, easing: POP }}
          >
            <strong>{c.name}</strong>
            {c.meta}
          </Motion.div>
        )}
      </For>
    </div>
  );
};

// --- feature 2 visual: the panel mock, with tabs that actually work --------
const VisualPanel: Component = () => {
  const [inView, ref] = createInView(0.4);
  const [tab, setTab] = createSignal<"overview" | "graph">("overview");
  const bars = [
    { w: "81%", c: "#3178c6" },
    { w: "13%", c: "#563d7c" },
    { w: "6%", c: "#e34c26" },
  ];
  return (
    <div
      class="mock-panel"
      ref={ref}
      role="img"
      aria-label="Repo detail panel with overview and graph tabs"
    >
      <div class="mp-tabs">
        <span
          classList={{ on: tab() === "overview" }}
          onClick={() => setTab("overview")}
        >
          Overview
        </span>
        <span
          classList={{ on: tab() === "graph" }}
          onClick={() => setTab("graph")}
        >
          Graph
        </span>
      </div>
      <Presence exitBeforeEnter>
        <Show when={tab() === "overview"}>
          <Motion.div
            class="mp-body"
            initial={REDUCED ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28, easing: EASE }}
          >
            <div class="mp-bar">
              <For each={bars}>
                {(b, i) => (
                  <Motion.span
                    class="mp-fill"
                    style={{ width: b.w, background: b.c, "transform-origin": "left center" }}
                    initial={REDUCED ? false : { scaleX: 0 }}
                    animate={inView() ? { scaleX: 1 } : { scaleX: 0 }}
                    transition={{ duration: 0.55, delay: 0.35 + i() * 0.12, easing: EASE }}
                  />
                )}
              </For>
            </div>
            <For each={[["Entry point", "src/index.ts"], ["Stars", "2,107"]]}>
              {([k, v], i) => (
                <Motion.div
                  class="mp-row"
                  initial={REDUCED ? false : { opacity: 0, y: 6 }}
                  animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                  transition={{ duration: 0.4, delay: 0.7 + i() * 0.1, easing: EASE }}
                >
                  <span>{k}</span>
                  <span>{v}</span>
                </Motion.div>
              )}
            </For>
          </Motion.div>
        </Show>
        <Show when={tab() === "graph"}>
          <Motion.div
            class="mp-body"
            initial={REDUCED ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28, easing: EASE }}
          >
            <div class="mp-graph">
              <For each={["index.ts", "graph.ts", "api.ts"]}>
                {(n, i) => (
                  <>
                    <Show when={i() > 0}>
                      <Motion.span
                        class="mpg-edge"
                        initial={REDUCED ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.4, delay: 0.4 + i() * 0.18, easing: EASE }}
                      />
                    </Show>
                    <Motion.span
                      class="mpg-node"
                      initial={REDUCED ? false : { opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, delay: 0.2 + i() * 0.18, easing: POP }}
                    >
                      <span classList={{ "mpg-dot": true, dim: i() === 2 }} />
                      <span class="mpg-label">{n}</span>
                    </Motion.span>
                  </>
                )}
              </For>
            </div>
            <div class="mp-row">
              <span>Modules</span>
              <span>3 tracked</span>
            </div>
          </Motion.div>
        </Show>
      </Presence>
    </div>
  );
};

// --- feature 3 visual: health cards with pulsing halos ---------------------
const VisualHealth: Component = () => {
  const [inView, ref] = createInView(0.4);
  const cards = [
    { name: "beacon", ms: "98ms", dot: "up" },
    { name: "fieldnotes", ms: "unreachable", dot: "down" },
    { name: "cormorant", ms: "not checked", dot: "unknown" },
  ] as const;
  return (
    <div class="mock-health" ref={ref}>
      <For each={cards}>
        {(c, i) => (
          <Motion.div
            class="mh-card"
            initial={REDUCED ? false : { opacity: 0, y: 18 }}
            animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            transition={{ duration: 0.5, delay: i() * 0.13, easing: EASE }}
          >
            {!REDUCED && (
              <Motion.span
                class={`mh-halo ${c.dot}`}
                animate={{ scale: [1, 2.2], opacity: [0.55, 0] }}
                transition={{
                  duration: 1.9,
                  repeat: Infinity,
                  delay: 0.8 + i() * 0.5,
                  easing: "ease-out",
                }}
              />
            )}
            <Motion.span
              class={`mh-dot ${c.dot}`}
              initial={REDUCED ? false : { scale: 0 }}
              animate={inView() ? { scale: [0, 1.4, 1] } : { scale: 0 }}
              transition={{ duration: 0.55, delay: 0.35 + i() * 0.13, easing: EASE_OUT }}
            />
            <strong>{c.name}</strong>
            <Motion.span
              class="mh-ms"
              initial={REDUCED ? false : { opacity: 0 }}
              animate={inView() ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.7 + i() * 0.13 }}
            >
              {c.ms}
            </Motion.span>
          </Motion.div>
        )}
      </For>
    </div>
  );
};

// --- tech strip: columns cascade in ----------------------------------------
const TechStrip: Component = () => {
  const [inView, ref] = createInView(0.2);
  const cols = [
    { dt: "Frontend", dd: ["SolidStart", "TypeScript", "solid-motionone"] },
    { dt: "Backend", dd: ["ASP.NET Core", "Octokit.net", "Hangfire"] },
    { dt: "Analysis", dd: ["Roslyn (C#)", "TS compiler API (JS/TS)", "d3-force (layout)"] },
    { dt: "Data", dd: ["PostgreSQL", "Entity Framework Core", "SignalR (live push)"] },
  ];
  return (
    <div class="tech-grid" ref={ref}>
      <For each={cols}>
        {(col, c) => (
          <Motion.div
            class="tech-col"
            initial={REDUCED ? false : { opacity: 0, y: 22 }}
            animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
            transition={{ duration: 0.6, delay: c() * 0.1, easing: EASE }}
          >
            <Motion.div
              class="tech-dt"
              initial={REDUCED ? false : { opacity: 0, y: 8 }}
              animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.45, delay: 0.1 + c() * 0.1, easing: EASE }}
            >
              {col.dt}
            </Motion.div>
            <For each={col.dd}>
              {(item, r) => (
                <Motion.div
                  class="tech-dd"
                  initial={REDUCED ? false : { opacity: 0, y: 8 }}
                  animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                  transition={{
                    duration: 0.45,
                    delay: 0.18 + c() * 0.1 + r() * 0.07,
                    easing: EASE,
                  }}
                >
                  {item}
                </Motion.div>
              )}
            </For>
          </Motion.div>
        )}
      </For>
    </div>
  );
};

// --- closing: masked headline + breathing CTA -------------------------------
const Closing: Component = () => {
  const [inView, ref] = createInView(0.4);
  return (
    <section class="closing" ref={ref}>
      <h2>
        <MaskWords
          text="Paste a repo. Watch it land on the map."
          stagger={0.045}
          when={inView()}
        />
      </h2>
      <Motion.p
        initial={REDUCED ? false : { opacity: 0, y: 12 }}
        animate={inView() ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.55, delay: 0.4, easing: EASE }}
      >
        Public repos only, no sign-in required. Repogeist reads what GitHub
        already knows about your project and gives it a place to stand.
      </Motion.p>
      <Motion.a
        class="btn primary"
        href="/"
        animate={REDUCED ? undefined : { scale: [1, 1.045, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, easing: "ease-in-out" }}
      >
        Open the canvas
        <Nudge>
          <FiArrowRight size={14} />
        </Nudge>
      </Motion.a>
    </section>
  );
};

const LandingPage: Component = () => {
  const [progress, setProgress] = createSignal(0);

  onMount(() => {
    if (REDUCED) return;
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? el.scrollTop / max : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => window.removeEventListener("scroll", onScroll));
  });

  return (
    <div class="landing">
      {/* scroll progress hairline */}
      <Motion.div
        class="scroll-progress"
        aria-hidden="true"
        animate={{ scaleX: progress() }}
        style={{ "transform-origin": "left center" }}
      />

      <Motion.nav
        class="landing-nav"
        initial={REDUCED ? false : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, easing: EASE }}
      >
        <Motion.span
          class="wordmark"
          initial={REDUCED ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, easing: EASE }}
        >
          <span class="mark">·</span>Repogeist
        </Motion.span>
        <div class="landing-nav-links">
          <Motion.a
            class="btn quiet"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            initial={REDUCED ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, easing: EASE }}
          >
            <FiGithub size={14} />
            Source
          </Motion.a>
          <Motion.a
            class="btn primary"
            href="/"
            initial={REDUCED ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35, easing: EASE }}
          >
            Open the canvas
            <Nudge>
              <FiArrowRight size={14} />
            </Nudge>
          </Motion.a>
        </div>
      </Motion.nav>

      {/* ---------------- hero ---------------- */}
      <section class="hero">
        <Motion.div
          class="hero-glow"
          aria-hidden="true"
          animate={REDUCED ? undefined : { opacity: [0.35, 0.6, 0.35], x: [0, 30, 0] }}
          transition={{ duration: 9, repeat: Infinity, easing: "ease-in-out" }}
        />
        <div class="hero-terrain" role="presentation" aria-hidden="true">
          <For each={TERRAIN_CARDS}>
            {(card, i) => <HeroTerrainCard card={card} index={i()} />}
          </For>
        </div>

        <Motion
          class="hero-copy"
          initial={REDUCED ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, easing: EASE }}
        >
          <Motion.p
            class="hero-eyebrow"
            initial={REDUCED ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, easing: EASE }}
          >
            <span class="mark">·</span>a spatial way to look at your repos
          </Motion.p>
          <h1>
            <MaskWords text="Your repos, as terrain." delay={0.3} stagger={0.1} />
          </h1>
          <Motion.p
            class="hero-sub"
            initial={REDUCED ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8, easing: EASE }}
          >
            Repogeist lays your GitHub repositories out on an open canvas you
            pan and zoom, instead of a list you scroll. Click one to dig a
            layer down — languages, contributors, whether the live demo still
            answers.
          </Motion.p>
          <Motion.div
            class="hero-actions"
            initial={REDUCED ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1, easing: EASE }}
          >
            <a class="btn primary" href="/about">
              Open the canvas
              <Nudge>
                <FiArrowRight size={14} />
              </Nudge>
            </a>
            <a class="btn quiet" href="https://github.com" target="_blank" rel="noreferrer">
              <FiGithub size={14} />
              View source
            </a>
          </Motion.div>
        </Motion>
      </section>

      {/* ---------------- premise ---------------- */}
      <Premise />

      {/* ---------------- functionality ---------------- */}
      <section class="features">
        <SectionHead
          kicker="what it does"
          title="Three things, done properly, before anything cleverer."
        />

        <FeatureRow
          title="An open canvas, not a grid"
          body="Every repo you add is a card placed in open space — pan and zoom to explore, the way you'd look at a map rather than scroll a feed. Positions persist, so the canvas feels discovered, not arranged."
          visual={<VisualCanvas />}
        />

        <FeatureRow
          reverse
          title="Click in, one layer at a time"
          body="A repo opens as a panel, not a new page — the canvas stays put underneath, slightly dimmed. Overview first: description, languages, contributors. Graph and code views wait behind their own tabs until you actually want them."
          visual={<VisualPanel />}
        />

        <FeatureRow
          title="Live demos, actually checked"
          body="Each repo's live-demo URL is pinged on a schedule, not assumed. A quiet status dot on the card tells you what a badge in a README can't: whether the thing still works right now."
          visual={<VisualHealth />}
        />
      </section>

      {/* ---------------- tech ---------------- */}
      <section class="tech">
        <SectionHead
          kicker="built with"
          title="A real stack, chosen for the reasons in the tech guide."
        />
        <TechStrip />
      </section>

      {/* ---------------- closing ---------------- */}
      <Closing />

      <footer class="landing-footer">
        <span>Repogeist</span>
        <a href="https://github.com" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
};

export default LandingPage;