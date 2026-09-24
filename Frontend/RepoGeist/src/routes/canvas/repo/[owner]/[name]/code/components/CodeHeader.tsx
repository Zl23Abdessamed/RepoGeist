// code/CodeHeader.tsx — repo owner/name + the "Code" title.
// Entrance-only Motion: it mounts once per leaf mount and never changes state,
// so there's nothing for Presence to track.

import type { Component } from "solid-js";
import { Motion } from "solid-motionone";
import { EASE_OUT, REDUCED } from "./utils";

export const CodeHeader: Component<{ title: string }> = (props) => (
  <Motion.header
    class="code-header"
    initial={REDUCED ? false : { opacity: 0, y: -8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.24, easing: EASE_OUT }}
  >
    <p class="code-owner">{props.title}</p>
    <h2 class="code-title font-display">Code</h2>
  </Motion.header>
);