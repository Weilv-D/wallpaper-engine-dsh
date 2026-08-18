/**
 * wallpaper-engine-dsh — host half.
 *
 * A Cordis plugin (loaded as an out-of-tree bundle row, see cordis.patch.yml)
 * that bridges the local Wallpaper Engine install into the DSH web GUI.
 * All parsing/enumeration logic lives in the pure layer (lib/core.js); this
 * file only wires it into same-origin HTTP routes on `ctx.webServer`:
 *
 *   GET  /we-background/inventory[?refresh=1] → { installDir, wallpapers, playlists }
 *   GET  /we-background/media/<token>[/<sub-asset>…] → video / web HTML + assets
 *   GET  /we-background/preview/<token>             → preview image
 *
 * Security model
 *   - Tokens are 72-bit random values minted per inventory build (not
 *     reversible encodings of paths). Knowing a filesystem path grants
 *     nothing; only files enumerated into the inventory are reachable.
 *     Rebuilding the inventory re-mints every token, so stale URLs die.
 *   - Web-wallpaper sub-assets resolve strictly INSIDE their project
 *     directory (core.isInsideDir) — `..` traversal is answered 403.
 *   - project.json-declared files must also be inside the project directory
 *     (core.readProject), so a hostile workshop item cannot point the server
 *     at arbitrary files.
 *   - The browser half renders web wallpapers in a sandboxed iframe
 *     (`sandbox="allow-scripts"`, no allow-same-origin), so third-party
 *     wallpaper JS gets an opaque origin and cannot touch DSH storage/APIs.
 *   - Everything is loopback same-origin; `X-Content-Type-Options: nosniff`
 *     on every media response.
 *
 * Lifecycle: every route registers through the plugin fiber and unwinds on
 * unload; the inventory cache and token map are dropped with it. The plugin
 * contributes no model-visible tool and no prompt text.
 */

import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import * as core from './core.js';

/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/we-background';
/** Inventory is cached and rebuilt at most this often unless ?refresh=1. */
const INVENTORY_TTL_MS = 30_000;

/** Steam root recorded by the Windows installer; null elsewhere/on failure. */
function steamRegistryRoot() {
  if (process.platform !== 'win32') return null;
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const out = execFileSync(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return core.steamPathFromRegQuery(out);
  } catch {
    return null;
  }
}

/** Full discovery pass: install dir + every library owning WE content. */
function discover() {
  const probes = core.steamProbeDirs();
  const registryRoot = steamRegistryRoot();
  const searchRoots = registryRoot ? [registryRoot, ...probes] : probes;
  const vdfLibraries = [];
  for (const root of searchRoots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(vdf)) continue;
    try {
      vdfLibraries.push(...core.librariesFromVdfText(readFileSync(vdf, 'utf8')));
    } catch { /* unreadable vdf → skip this root */ }
  }
  const installDir = core.findInstallDir(
    core.installDirCandidates({ registryRoot, libraryRoots: vdfLibraries }),
  );
  const libraryRoots = core.workshopLibraryRoots(searchRoots, vdfLibraries);
  return { installDir, libraryRoots };
}

export const inject = ['webServer'];

export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    return () => {}; // defensive: inject guarantees the service in practice
  }

  // ── Token registry ──────────────────────────────────────────────────────
  // token → { abs, rootDir|null }. rootDir is set for renderable projects so
  // web wallpapers can fetch their bundled sub-assets (contained, see below).
  const tokens = new Map();
  const mint = (entry) => {
    const token = randomBytes(9).toString('base64url'); // 72 bits, url-safe
    tokens.set(token, entry);
    return token;
  };

  // ── Inventory (cached) ──────────────────────────────────────────────────
  let cache = null; // { at: number, payload: object }

  // Discovery is expensive (reg.exe + vdf scan) and the install layout barely
  // changes — resolve it ONCE and reuse across builds; only an explicit
  // refresh (or TTL expiry on the first build) forces a re-discovery.
  let discoveryCache = null;
  function getDiscovery(force) {
    if (!force && discoveryCache) return discoveryCache;
    discoveryCache = discover();
    return discoveryCache;
  }

  function buildInventory(force) {
    tokens.clear(); // re-mint: tokens from older builds stop resolving
    return core.buildInventoryFrom(getDiscovery(force), { mint });
  }

  function getInventory(force) {
    if (!force && cache && Date.now() - cache.at < INVENTORY_TTL_MS) return cache.payload;
    const payload = buildInventory(force);
    cache = { at: Date.now(), payload };
    return payload;
  }

  // ── Response helpers ────────────────────────────────────────────────────
  function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  /** Stream one file with Range support (video seeking) and HEAD handling. */
  function serveFile(absPath, req, res) {
    let st;
    try { st = statSync(absPath); } catch { st = null; }
    if (!st || !st.isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', core.mimeFor(absPath));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const range = core.parseRangeHeader(req.headers.range, st.size);
    if (range && range.error) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${st.size}`);
      res.end();
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
    stream.on('error', () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  }

  // ── Routes ──────────────────────────────────────────────────────────────
  const disposers = [];

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      try {
        const url = new URL(req.url || '/', 'http://x');
        const payload = JSON.stringify(getInventory(url.searchParams.get('refresh') === '1'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Length', String(Buffer.byteLength(payload)));
        res.end(req.method === 'HEAD' ? undefined : payload);
      } catch (err) {
        sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
      }
    },
  }));

  for (const seg of ['media', 'preview']) {
    const prefix = `${BASE}/${seg}/`;
    disposers.push(webServer.register({
      kind: 'prefix',
      path: `${BASE}/${seg}`,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        let pathname;
        try {
          pathname = new URL(req.url || '/', 'http://x').pathname;
        } catch {
          sendJson(res, 400, { error: 'bad request' });
          return;
        }
        const rest = pathname.slice(prefix.length); // "<token>" | "<token>/<rel…>"
        const slash = rest.indexOf('/');
        const rawToken = slash < 0 ? rest : rest.slice(0, slash);
        let token;
        try { token = decodeURIComponent(rawToken); } catch {
          sendJson(res, 400, { error: 'bad token' });
          return;
        }
        const entry = tokens.get(token);
        if (!entry) {
          res.statusCode = 404;
          if (req.method === 'HEAD') res.end();
          else res.end('not found');
          return;
        }
        let abs = entry.abs;
        if (slash >= 0) {
          // Sub-asset of a bundled web wallpaper: must stay inside its dir.
          if (seg !== 'media' || !entry.rootDir) {
            res.statusCode = 404;
            if (req.method === 'HEAD') res.end();
            else res.end('not found');
            return;
          }
          let rel;
          try { rel = decodeURIComponent(rest.slice(slash + 1)); } catch {
            sendJson(res, 400, { error: 'bad path' });
            return;
          }
          if (!rel || rel.split('/').some((part) => part === '..' || part === '')) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
          }
          abs = join(entry.rootDir, ...rel.split('/'));
          if (!core.isInsideDir(entry.rootDir, abs)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
          }
        }
        serveFile(abs, req, res);
      },
    }));
  }

  // Warm the discovery cache now (reg.exe + vdf scan) so the first inventory
  // request answers immediately instead of paying the discovery cost inline.
  try { getDiscovery(false); } catch { /* non-fatal: inventory will 500 with reason */ }

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    disposers.length = 0;
    tokens.clear();
    cache = null;
    discoveryCache = null;
  };
}

export default { inject, apply };
