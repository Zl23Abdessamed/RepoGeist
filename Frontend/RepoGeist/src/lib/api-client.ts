// src/lib/api-client.ts
import createClient from "openapi-fetch";
import type { Middleware } from "openapi-fetch";
import type { paths } from "~/types/types";

/**
 * The API's origin (scheme + host + port, no trailing slash, no `/api` prefix).
 *
 * Exported so signalr.ts builds its hub URLs from the SAME value REST uses. Previously
 * signalr.ts hardcoded "http://localhost:5221" in a second place, so setting
 * VITE_API_URL would silently point REST at one host and the live hubs at another.
 */

//   //dev
// export const API_ORIGIN: string = (
//   import.meta.env.VITE_API_URL ?? "http://localhost:5221"
// ).replace(/\/+$/, "");

//prod
export const API_ORIGIN: string = (
  import.meta.env.VITE_API_URL ?? ""
).replace(/\/+$/, "");

// ─────────────────────────────────────────────────────────────────────────
// Literal slashes in GET /api/repos/{owner}/{name}/files/{path}
// ─────────────────────────────────────────────────────────────────────────
//
// `path` is a repo-relative file path like "src/lib/keys.ts". openapi-fetch percent-encodes
// path params wholesale, so it would send ".../files/src%2Flib%2Fkeys.ts" — an encoded
// slash. ASP.NET Core (Kestrel/IIS) rejects or mis-routes "%2F" inside a URL path by
// default, and a plain `{path}` parameter only matches ONE segment anyway. The backend
// route needs the literal form: ".../files/src/lib/keys.ts" (i.e. a `{**path}` catch-all).
//
// This middleware restores the slashes for that one route and nothing else. It only
// rewrites within the portion of the path AFTER "/files/", so an owner/name segment can
// never be affected, and other characters (spaces, unicode, "#", "?") stay percent-encoded
// — only the separators change. Verified against openapi-fetch: "my dir/a b.ts" is sent as
// ".../files/my%20dir/a%20b.ts".
const literalFileSlashes: Middleware = {
  onRequest({ request }) {
    const url = new URL(request.url);
    const marker = "/files/";
    const i = url.pathname.indexOf(marker);
    if (i === -1) return undefined; // not the file route — leave the request untouched

    const head = url.pathname.slice(0, i + marker.length);
    const tail = url.pathname.slice(i + marker.length).replace(/%2F/gi, "/");
    url.pathname = head + tail;
    return new Request(url.toString(), request);
  },
};

export const api = createClient<paths>({ baseUrl: API_ORIGIN });
api.use(literalFileSlashes);