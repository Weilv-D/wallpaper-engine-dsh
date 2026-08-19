/**
 * wallpaper-engine-dsh — host half.
 *
 * A Cordis plugin (loaded as an out-of-tree bundle row, see cordis.patch.yml)
 * that bridges the local Wallpaper Engine install into the DSH web GUI.
 * All parsing/enumeration logic lives in the pure layer (lib/core.js); this
 * file only wires it into same-origin HTTP routes on `ctx.webServer`:
 *
 *   GET  /we-background/inventory[?refresh=1] → { installDir, total,
 *         portableCount, wallpapers, playlists }
 *   GET  /we-background/media/<token>[/<sub-asset>…] → video / web HTML + assets
 *   GET  /we-background/preview/<token>             → preview image
 *
 * Security model
 *   - Tokens are 72-bit random values (not reversible encodings of paths).
 *     Knowing a filesystem path grants nothing; only files enumerated into
 *     the inventory are reachable. Tokens are stable per wallpaper across
 *     TTL-triggered rebuilds (so an in-flight video stream is never killed
 *     by a background refresh) and re-minted on an explicit ?refresh=1, so
 *     deliberately stale URLs die.
 *   - Web-wallpaper sub-assets resolve strictly INSIDE their project
 *     directory (core.isInsideDir) — `..` and backslash traversal are
 *     answered 403.
 *   - project.json-declared files must also be inside the project directory
 *     (core.readProject), so a hostile workshop item cannot point the server
 *     at arbitrary files.
 *   - The browser half renders web wallpapers in a sandboxed iframe
 *     (`sandbox="allow-scripts"`, no allow-same-origin), so third-party
 *     wallpaper JS gets an opaque origin and cannot touch DSH storage/APIs.
 *     That opaque origin also makes the wallpaper's own fetch()/XHR for its
 *     sub-assets cross-origin, so media/preview responses carry
 *     `Access-Control-Allow-Origin: *` — the unguessable token stays the
 *     only capability, and the surface is loopback-only.
 *   - Everything is loopback same-origin; `X-Content-Type-Options: nosniff`
 *     on every media response.
 *
 * Async: discovery (reg.exe, vdf scan) and inventory builds run through
 * fs/promises, so a rebuild never blocks the event loop mid-stream.
 *
 * Lifecycle: every route registers through the plugin fiber and unwinds on
 * unload; the inventory cache and token map are dropped with it. The plugin
 * contributes no model-visible tool and no prompt text.
 */

import {
  createReadStream,
  promises as fsp,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';

import * as core from './core.js';

/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/we-background';
/** Inventory is cached and rebuilt at most this often unless ?refresh=1. */
const INVENTORY_TTL_MS = 30_000;
/** Steam layout barely moves; re-discover at most this often on TTL builds. */
const DISCOVERY_TTL_MS = 10 * 60_000;

/** fs/promises-backed io for the pure layer (awaited there). */
const asyncIo = {
  existsSync: async (p) => { try { await fsp.access(p); return true; } catch { return false; } },
  readFileSync: (p, encoding) => fsp.readFile(p, encoding),
  readdirSync: (p) => fsp.readdir(p),
  statSync: (p) => fsp.stat(p),
};

/** Steam root recorded by the Windows installer; null elsewhere/on failure. */
function steamRegistryRoot() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolvePromise) => {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    execFile(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) { resolvePromise(null); return; }
        resolvePromise(core.steamPathFromRegQuery(stdout));
      },
    );
  });
}

/** Full discovery pass: install dir + every library owning WE content. */
async function discover() {
  const probes = core.steamProbeDirs();
  const registryRoot = await steamRegistryRoot();
  const searchRoots = registryRoot ? [registryRoot, ...probes] : probes;
  const vdfLibraries = [];
  for (const root of searchRoots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (!await asyncIo.existsSync(vdf)) continue;
    try {
      vdfLibraries.push(...core.librariesFromVdfText(await asyncIo.readFileSync(vdf, 'utf8')));
    } catch { /* unreadable vdf → skip this root */ }
  }
  const installDir = await core.findInstallDir(
    core.installDirCandidates({ registryRoot, libraryRoots: vdfLibraries }),
    asyncIo,
  );
  const libraryRoots = await core.workshopLibraryRoots(searchRoots, vdfLibraries, asyncIo);
  return { installDir, libraryRoots };
}

/**
 * Register all routes on a webServer-like registry and return a disposer.
 * Extracted from apply() so integration tests can drive the HTTP surface
 * against a fixture discovery without a live Steam install.
 *
 * @param {{ register(route: { kind: 'exact'|'prefix', path: string, handler: Function }): () => void }} webServer
 * @param {{ discover?: () => Promise<{ installDir: string|null, libraryRoots: string[] }>, inventoryTtlMs?: number, discoveryTtlMs?: number }} [opts]
 */
export function createRouteRegistrar(webServer, opts = {}) {
  const discoverFn = opts.discover || discover;
  const inventoryTtlMs = opts.inventoryTtlMs ?? INVENTORY_TTL_MS;
  const discoveryTtlMs = opts.discoveryTtlMs ?? DISCOVERY_TTL_MS;

  // ── Token registry ──────────────────────────────────────────────────────
  // token → { abs, rootDir|null }. rootDir is set for renderable web projects
  // so their bundled sub-assets can be fetched (contained, see below).
  // Tokens are keyed per wallpaper asset (`<id>:media` / `<id>:preview`):
  // TTL rebuilds REUSE the token for an unchanged asset (in-flight streams
  // survive), prune assets that vanished, and only an explicit ?refresh=1
  // re-mints everything.
  const tokens = new Map();
  const tokenByKey = new Map();
  const mint = (entry) => {
    const key = entry && entry.key;
    if (key && tokenByKey.has(key)) return tokenByKey.get(key);
    const token = randomBytes(9).toString('base64url'); // 72 bits, url-safe
    tokens.set(token, entry);
    if (key) tokenByKey.set(key, token);
    return token;
  };
  const remintAll = () => { tokens.clear(); tokenByKey.clear(); };
  // Web-wallpaper media URLs carry the entry file's path after the token
  // (`…/media/<token>/index.html`) — the token is the FIRST path segment,
  // never the last. Extract it structurally so pruning cannot mistake
  // `index.html` for the token and kill a live wallpaper on a TTL rebuild.
  const tokenUrlRe = new RegExp(`^${BASE}/(media|preview)/([^/?#]+)`);
  const tokenOfUrl = (url) => {
    const m = tokenUrlRe.exec(String(url));
    return m ? m[2] : null;
  };
  const pruneTokens = (payload) => {
    const live = new Set();
    for (const w of payload.wallpapers) {
      for (const url of [w.media, w.preview]) {
        if (!url) continue;
        const token = tokenOfUrl(url);
        if (token) live.add(token);
      }
    }
    for (const token of [...tokens.keys()]) {
      if (!live.has(token)) {
        const entry = tokens.get(token);
        tokens.delete(token);
        if (entry && entry.key && tokenByKey.get(entry.key) === token) {
          tokenByKey.delete(entry.key);
        }
      }
    }
  };

  // ── Inventory (cached) ──────────────────────────────────────────────────
  let cache = null; // { at: number, payload: object }
  let discoveryCache = null; // { at: number, value: object }
  let discovering = null; // in-flight discovery (cold-start dedupe)
  let building = null; // in-flight build promise (request coalescing)

  async function getDiscovery(force) {
    const fresh = discoveryCache && Date.now() - discoveryCache.at < discoveryTtlMs;
    if (!force && fresh) return discoveryCache.value;
    // Concurrent callers (registration warm-up + first request) share ONE
    // discovery run instead of racing reg.exe twice at cold start. A forced
    // run deliberately does not join an in-flight non-forced one; either way,
    // a run only releases the slot it still owns — clearing it unconditionally
    // would kill another run's join promise, never clearing it would pin the
    // slot to a settled promise and freeze TTL re-discovery forever.
    if (discovering && !force) return discovering;
    const run = discoverFn()
      .then((value) => {
        discoveryCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => { if (discovering === run) discovering = null; });
    discovering = run;
    return run;
  }

  async function buildInventory(force) {
    if (force) remintAll(); // explicit refresh: stale URLs die on purpose
    const payload = await core.buildInventoryFrom(await getDiscovery(force), {
      ...asyncIo,
      mint,
      base: BASE,
    });
    pruneTokens(payload);
    return payload;
  }

  function getInventory(force) {
    if (!force && cache && Date.now() - cache.at < inventoryTtlMs) {
      return Promise.resolve(cache.payload);
    }
    // Coalesce concurrent NON-forced builds (double-clicked 刷新 within the
    // same tick, parallel clients). A forced refresh must never be folded
    // into a non-forced in-flight build — the whole point of ?refresh=1 is
    // the remint, so it waits for the current build and then rebuilds.
    if (building) {
      if (!force) return building;
      return building.catch(() => {}).then(() => getInventory(true));
    }
    building = buildInventory(force)
      .then((payload) => { cache = { at: Date.now(), payload }; return payload; })
      .finally(() => { building = null; });
    return building;
  }

  // ── Response helpers ────────────────────────────────────────────────────
  function sendJson(req, res, status, body) {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(Buffer.byteLength(text)));
    res.end(req.method === 'HEAD' ? undefined : text);
  }

  /** Bodyless status answer (404/405-style); indistinguishable per reason. */
  function sendEmpty(res, status) {
    res.statusCode = status;
    res.setHeader('Content-Length', '0');
    res.end();
  }

  /** Preflight answer for the media/preview surface (see serveFile re CORS). */
  function sendCorsPreflight(res) {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.end();
  }

  /** Stream one file with Range support (video seeking) and HEAD handling. */
  function serveFile(absPath, req, res) {
    fsp.stat(absPath).then((st) => {
      if (!st.isFile()) {
        sendEmpty(res, 404);
        return;
      }
      const mime = core.mimeFor(absPath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Web wallpapers render in a sandboxed iframe (opaque origin), so their
      // own fetch()/XHR for sub-assets is CROSS-origin from the browser's
      // point of view and would be blocked without an explicit allow. The
      // unguessable token remains the only capability — wildcard origin
      // grants nothing beyond what a known URL already grants.
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (mime === 'text/html' || mime === 'image/svg+xml') {
        // Script-capable documents (web wallpapers, SVG previews) get a
        // sandbox CSP even on direct top-level navigation, so they can
        // never execute against the DSH origin. `allow-scripts` keeps the
        // wallpaper itself functional — inside the sandbox the origin is
        // opaque either way, so the isolation goal is unchanged.
        res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
      }

      const range = core.parseRangeHeader(req.headers.range, st.size);
      if (range && range.error) {
        res.setHeader('Content-Range', `bytes */${st.size}`);
        sendEmpty(res, 416);
        return;
      }
      const head = req.method === 'HEAD';
      if (range) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
      } else {
        res.setHeader('Content-Length', String(st.size));
      }
      if (head) { res.end(); return; }

      const stream = range
        ? createReadStream(absPath, { start: range.start, end: range.end })
        : createReadStream(absPath);
      // The file can vanish between stat and open; ending normally would
      // leave the already-announced Content-Length unsatisfied and the
      // client hanging — destroy the response instead.
      stream.on('error', () => { res.destroy(); });
      // A file that SHRANK between stat and open streams fewer bytes than
      // the announced Content-Length without any open error — count what
      // actually went out and tear the response down on a short read so the
      // client sees a retryable network failure, not a silent truncation.
      const expected = range ? range.end - range.start + 1 : st.size;
      let sent = 0;
      stream.on('data', (chunk) => { sent += chunk.length; });
      stream.on('end', () => {
        if (sent !== expected) res.destroy();
      });
      stream.pipe(res);
    }).catch(() => {
      sendEmpty(res, 404);
    });
  }

  /**
   * Real-path containment check (symlink defense). The lexical
   * isInsideDir() passes above reject `..`-style escapes, but a symlink
   * placed inside a wallpaper dir pointing outside would sail through
   * lexically and be followed at open time. Resolve BOTH sides with
   * realpath and re-check: a symlinked target resolves outside the real
   * root and is refused. Resolves null when the path does not exist.
   */
  const realRootCache = new Map(); // token → realpath(root) | null
  async function realPathWithin(entry, candidateAbs) {
    let rootReal = realRootCache.get(entry.key || entry.abs);
    if (rootReal === undefined) {
      rootReal = await fsp.realpath(entry.rootDir || dirname(entry.abs)).catch(() => null);
      realRootCache.set(entry.key || entry.abs, rootReal);
    }
    if (!rootReal) return null;
    const realAbs = await fsp.realpath(candidateAbs).catch(() => null);
    if (!realAbs || !core.isInsideDir(rootReal, realAbs)) return null;
    return realAbs;
  }

  // ── Routes ──────────────────────────────────────────────────────────────
  const disposers = [];

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(req, res, 405, { error: 'method not allowed' });
        return;
      }
      let url;
      try {
        url = new URL(req.url || '/', 'http://x');
      } catch {
        sendJson(req, res, 400, { error: 'bad request' });
        return;
      }
      getInventory(url.searchParams.get('refresh') === '1')
        .then((payload) => sendJson(req, res, 200, payload))
        .catch((err) => {
          // Loopback-only, but the raw message can carry absolute paths —
          // genericise for the wire, keep detail in the server log.
          console.error('[we-background] inventory build failed:', err && err.stack || err);
          sendJson(req, res, 500, { error: 'inventory build failed' });
        });
    },
  }));

  for (const seg of ['media', 'preview']) {
    const prefix = `${BASE}/${seg}/`;
    disposers.push(webServer.register({
      kind: 'prefix',
      path: `${BASE}/${seg}`,
      handler: (req, res) => {
        if (req.method === 'OPTIONS') { sendCorsPreflight(res); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('Allow', 'GET, HEAD, OPTIONS');
          sendJson(req, res, 405, { error: 'method not allowed' });
          return;
        }
        let pathname;
        try {
          pathname = new URL(req.url || '/', 'http://x').pathname;
        } catch {
          sendJson(req, res, 400, { error: 'bad request' });
          return;
        }
        const rest = pathname.slice(prefix.length); // "<token>" | "<token>/<rel…>"
        const slash = rest.indexOf('/');
        const rawToken = slash < 0 ? rest : rest.slice(0, slash);
        let token;
        try { token = decodeURIComponent(rawToken); } catch {
          sendJson(req, res, 400, { error: 'bad token' });
          return;
        }
        const entry = tokens.get(token);
        if (!entry) {
          sendEmpty(res, 404);
          return;
        }
        let abs = entry.abs;
        if (slash >= 0) {
          let rel;
          try { rel = decodeURIComponent(rest.slice(slash + 1)); } catch {
            sendJson(req, res, 400, { error: 'bad path' });
            return;
          }
          if (rel === '') {
            // Directory form (`…/media/<token>/`): the entry document itself,
            // exactly like the bare-token URL — abs already points at it, so
            // fall through to the shared symlink backstop below. Preview
            // tokens have no directory form.
            if (seg !== 'media') {
              sendEmpty(res, 404);
              return;
            }
          } else {
            // Sub-asset of a bundled web wallpaper: must stay inside its dir.
            if (seg !== 'media' || !entry.rootDir) {
              sendEmpty(res, 404);
              return;
            }
            // Backslash parts are never legitimate in a URL path here; on
            // win32 `..\evil` would slip past a `/`-only split (the
            // isInsideDir backstop still catches it — defense in depth).
            if (rel.split('/').some((part) => part === '..' || part === '' || part.includes('\\'))) {
              sendJson(req, res, 403, { error: 'forbidden' });
              return;
            }
            abs = join(entry.rootDir, ...rel.split('/'));
            if (!core.isInsideDir(entry.rootDir, abs)) {
              sendJson(req, res, 403, { error: 'forbidden' });
              return;
            }
          }
        }
        // Symlink backstop: serve only what realpath still keeps inside the
        // entry's real root (404 — indistinguishable from a vanished file).
        realPathWithin(entry, abs).then((real) => {
          if (!real) {
            sendEmpty(res, 404);
            return;
          }
          serveFile(real, req, res);
        });
      },
    }));
  }

  // Warm the discovery cache now (async, off the request path) so the first
  // inventory request answers quickly.
  getDiscovery(false).catch(() => { /* non-fatal: inventory will 500 with reason */ });

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    disposers.length = 0;
    remintAll();
    realRootCache.clear();
    cache = null;
    discoveryCache = null;
  };
}

export const inject = ['webServer'];

export function apply(ctx) {
  // inject guarantees the service is present before apply runs.
  return createRouteRegistrar(ctx.webServer);
}

export default { inject, apply };
