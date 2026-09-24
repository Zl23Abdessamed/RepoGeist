import { parse as parseYaml } from "yaml";
import languagesYaml from "~/../public/languages.yml?raw";
import type { RepoCard, HealthStatusValue } from "~/lib/repos";

// Lowercase, canvas-side mirror of the API's HealthStatusValue ("Up" | "Down" |
// "Unknown"). Kept distinct from the wire value so CSS classes / healthText below
// can stay lowercase without smuggling casing assumptions into the query layer.
export type Health = "up" | "down" | "unknown";

// ── Language colors ─────────────────────────────────────────────────────────
//
// Colors are sourced from the canonical github/linguist languages.yml (served
// from /public/languages.yml). The YAML text is inlined at build time via
// Vite's `?raw` import and parsed once at module load into a case-insensitive
// Map — lookups are O(1) with zero runtime fetch overhead. If parsing fails
// (e.g. malformed YAML or missing file), the Map stays empty and every
// language falls through to the stable hash-based FALLBACK_COLORS below.
//
// Requires:  npm install yaml
// Adjust the `?raw` import path if this file lives at a different depth.
interface LanguageEntry {
  color?: string;
}

const LANGUAGE_COLORS: ReadonlyMap<string, string> = (() => {
  const idx = new Map<string, string>();
  try {
    const data = parseYaml(languagesYaml) as Record<string, LanguageEntry> | null;
    if (data) {
      for (const [name, entry] of Object.entries(data)) {
        if (entry?.color) {
          idx.set(name.toLowerCase(), entry.color);
        }
      }
    }
  } catch {
    // YAML parse failure → empty index → all colors use fallback
  }
  return idx;
})();

const FALLBACK_COLORS = ["#8a7d63", "#6b8f8c", "#8f6b73", "#6b7e8f", "#8f8a6b"];

export const languageColor = (name: string | null | undefined): string => {
  if (!name) return "#5b5b5b";
  const color = LANGUAGE_COLORS.get(name.toLowerCase());
  if (color) return color;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
};

// ───────────────────────────────────────────────────────────────────────────
// Repo: the canvas's own view-model, NOT a mirror of any single DTO.
// ───────────────────────────────────────────────────────────────────────────
// RepoCardDto (the only thing GET /api/repos returns) carries just enough for a
// card: owner/name/description/topics/primaryLanguage/liveDemoUrl/healthStatus.
// It has no `stars`, no `contributors`, no `entryPoint`, and no per-language
// share breakdown — those only exist on RepoDetailDto, fetched lazily once a repo
// is opened in the side panel (see repoDetailQuery in ~/queries/repos). Baking
// detail-only fields into the card-level Repo here would either be permanently
// empty placeholders or silently wrong, so they're left off this type entirely;
// SidePanel reads them from RepoDetail instead.
//
// `x`, `y`, and `fresh` are pure canvas/local UI state — layout position and a
// one-shot "just added" entrance flag — and have no backend counterpart at all.
export interface Repo {
  owner: string;
  name: string;
  description: string;
  primaryLanguage: string | null;
  health: Health;
  demo: string | null;
  x: number;
  y: number;
  fresh?: boolean;
}

// Maps the normalized RepoCard (RepoCardDto with healthStatus already coerced to
// "Up" | "Down" | "Unknown" by normalizeHealthStatus in ~/queries/repos) into the
// canvas's Repo. Position is supplied by the caller (findOpenSpot / existing
// layout), since the API has no concept of canvas coordinates.
export const repoCardToRepo = (
  card: RepoCard,
  pos: { x: number; y: number },
  fresh = false,
): Repo => ({
  owner: card.owner || "",
  name: card.name || "",
  description: card.description ?? "",
  primaryLanguage: card.primaryLanguage ?? null,
  health: healthStatusToHealth(card.healthStatus),
  demo: card.liveDemoUrl ?? null,
  x: pos.x,
  y: pos.y,
  fresh,
});

export const healthStatusToHealth = (status: HealthStatusValue): Health => {
  switch (status) {
    case "Up": return "up";
    case "Down": return "down";
    default: return "unknown";
  }
};

export const CARD_W = 292;
export const CARD_H = 148;

export const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const POP: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

export const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const healthText: Record<Health, string> = {
  up: "Live demo reachable",
  down: "Live demo unreachable",
  unknown: "Live demo not checked",
};

export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
export const NAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/;

// Parsed shape used only for client-side validation (dupe-checking against repos
// already on the canvas, and showing "owner/repo" back to the user). The API call
// itself — POST /api/repos via createRepoMutation — takes CreateRepoRequestDto's
// single `repoUrl: string`, so `url` (a normalized, schema-valid github.com URL) is
// what actually gets sent; `owner`/`name` here are for the frontend's own use.
export interface ParsedRepoUrl {
  owner: string;
  name: string;
  url: string;
}

export const parseRepoUrl = (raw: string): ParsedRepoUrl | null => {
  const s = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(/^(?:www\.)?github\.com\//i, "");
  const segments = s.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (segments[0].includes(".")) return null;
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
  return { owner, name, url: `https://github.com/${owner}/${name}` };
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const wrapOffset = (v: number, tileSize: number) => {
  if (tileSize <= 0) return 0;
  const m = v % tileSize;
  return m < 0 ? m + tileSize : m;
};

export const repoKey = (r: Repo) => `${r.owner}/${r.name}`;