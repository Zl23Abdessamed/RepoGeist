// ─────────────────────────────────────────────────────────────────────────
// Enum + numeric normalizers — the single place wire quirks get papered over
// ─────────────────────────────────────────────────────────────────────────
//
// THE PROBLEM. openapi-typescript reflects an enum's underlying CLR type, so the
// generated types.ts documents these as plain numbers:
//
//     HealthStatus:   number
//     AnalysisStatus: number
//
// But RepogeistDbContext maps every enum with `.HasConversion<string>()`
// (backend.md §6.8), so what actually travels over the wire is a *string*:
// "Up" | "Down" | "Unknown", "Queued" | "Running" | "Succeeded" | "Failed", etc.
// The generated type is wrong for these fields: TS would reject `status === "Up"`
// against a `number`, so without a fix every call site would be forced into a cast
// (or, worse, compare against the numeric values that never actually arrive).
//
// So each normalizer accepts `unknown`, handles the string form (the real one), and
// defensively handles the int form (in case the backend ever drops the string
// conversion), always returning a proper union type.
//
// The int→string mappings below mirror the declaration order of the enums in
// Models.cs. If a member is ever inserted or reordered backend-side, the *string*
// form is unaffected (that's the whole point of storing strings), but these int
// fallbacks would need updating — another reason the string form is preferred.
//
// Previously `normalizeHealthStatus` was copy-pasted into repos.ts, health.ts AND
// signalr.ts. It now lives only here.

// ── Tolerant string matching ──────────────────────────────────────────────
//
// The backend documents PascalCase ("Ready"), but a serializer naming-policy change or a
// hand-rolled hub payload could plausibly send "ready" / "READY" / " Ready ". Matching
// exactly would then misreport a *finished* clone as "never cloned" and keep the Code view
// locked forever — a silent failure. So matching is case-insensitive and trims whitespace,
// and always returns the canonical member (never the raw input).

function matchMember<T extends string>(raw: unknown, members: readonly T[]): T | null {
  if (typeof raw !== "string") return null;
  const needle = raw.trim().toLowerCase();
  return members.find((m) => m.toLowerCase() === needle) ?? null;
}

// ── HealthStatus ──────────────────────────────────────────────────────────

export type HealthStatusValue = "Up" | "Down" | "Unknown";

const HEALTH_MEMBERS = ["Up", "Down", "Unknown"] as const;

export function normalizeHealthStatus(raw: unknown): HealthStatusValue {
  const m = matchMember(raw, HEALTH_MEMBERS);
  if (m) return m;
  // Int fallback — Models.cs: enum HealthStatus { Up = 0, Down = 1, Unknown = 2 }
  if (raw === 0) return "Up";
  if (raw === 1) return "Down";
  return "Unknown";
}

// ── AnalysisStatus ────────────────────────────────────────────────────────
//
// "NotAnalyzed" is a *frontend-only* member. The backend enum has no such value
// (it's Queued/Running/Succeeded/Failed — a job state, and a repo that has never had
// a job has no state to report). But RepoDetailDto.analysisStatus is a required-looking
// field that can arrive missing/unrecognized for a never-analyzed repo, and the UI needs
// a value to branch on for the "Analyze" button vs. "Analyzed" indicator (Guide.md §5.0).
// Mapping "no job yet" to an explicit union member is safer than leaving it `undefined`
// and hoping every consumer remembers to check.

export type AnalysisStatusValue = "NotAnalyzed" | "Queued" | "Running" | "Succeeded" | "Failed";

const ANALYSIS_MEMBERS = ["Queued", "Running", "Succeeded", "Failed"] as const;

export function normalizeAnalysisStatus(raw: unknown): AnalysisStatusValue {
  const m = matchMember(raw, ANALYSIS_MEMBERS);
  if (m) return m;
  // Int fallback — Models.cs: enum AnalysisStatus { Queued = 0, Running = 1, Succeeded = 2, Failed = 3 }
  if (raw === 0) return "Queued";
  if (raw === 1) return "Running";
  if (raw === 2) return "Succeeded";
  if (raw === 3) return "Failed";
  return "NotAnalyzed";
}

// ── CloneStatus ───────────────────────────────────────────────────────────
//
// CloneStatusDto.status is documented as a plain `string` in types.ts (not an enum
// reference), so unlike the two above there's no wrong `number` type to fix — but the
// string is still just `string`, and consumers want a union to switch on.
// "NotCloned" is frontend-only for the same reason "NotAnalyzed" is above.

export type CloneStatusValue = "NotCloned" | "Queued" | "Cloning" | "Ready" | "Failed";

const CLONE_MEMBERS = ["Queued", "Cloning", "Ready", "Failed"] as const;

export function normalizeCloneStatus(raw: unknown): CloneStatusValue {
  const m = matchMember(raw, CLONE_MEMBERS);
  if (m) return m;
  return "NotCloned";
}

// ── Numeric coercion ──────────────────────────────────────────────────────
//
// openapi-typescript widens every `int32`/`int64` to `number | string` (it can't know
// whether a given server serializes 64-bit ints as strings to dodge JS precision loss).
// In practice ASP.NET sends JSON numbers, but the *type* says otherwise, so any place
// that does arithmetic or renders a progress bar needs a real `number`. These coerce
// once, at the boundary, instead of at every use site.

/** `number | string | null | undefined` → `number` (0 if absent or non-numeric). */
export function toNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Like toNumber, but preserves "no value" as `null` (e.g. progress that isn't reported). */
export function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ── Timestamps ────────────────────────────────────────────────────────────
//
// The backend stores every timestamp as UTC (backend.md §6.1 — e.g. CommitActivity.WeekStart
// is "UTC, Monday"). But ASP.NET serializes a DateTime whose Kind is Unspecified WITHOUT a
// trailing "Z" ("2026-01-05T00:00:00"), and JavaScript parses a zone-less ISO string as
// LOCAL time, not UTC. For a user in Los Angeles that shifts the instant by 7–8 hours, which
// can push a "Monday" week-start onto the previous day in a chart label.
//
// This appends "Z" to a zone-less timestamp so it's read as the UTC instant the backend meant.
// A string that already carries a zone ("Z", "+00:00", "-05:00") is returned untouched.
// Returns null for anything that isn't a parseable date, so callers never render "Invalid Date".

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function normalizeUtcTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const s = raw.trim();
  const withZone = HAS_ZONE.test(s) ? s : `${s}Z`;
  return Number.isNaN(Date.parse(withZone)) ? null : withZone;
}