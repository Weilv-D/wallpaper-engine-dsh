/**
 * wallpaper-engine-dsh — pure logic layer (lib/core.js).
 *
 * Every function here is free of Cordis/DSH imports and side-effect-light:
 * parsing, validation, path arithmetic and filesystem enumeration against
 * explicit roots. The host plugin (lib/index.js) wires these into HTTP routes;
 * the unit tests (test/core.test.mjs) exercise them against fixture trees.
 *
 * Layers:
 *   1. KeyValues (VDF) tokenizer/parser — Steam's libraryfolders.vdf.
 *   2. Steam / Wallpaper Engine discovery — candidate ranking, library scan.
 *   3. Wallpaper project model — project.json validation, type inference,
 *      path containment (a project file may never escape its own directory).
 *   4. Playlist model — WE config.json parsing (both schemas), item resolution.
 *   5. HTTP helpers — Range header parsing, MIME table, containment checks.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, normalize, basename, sep } from 'node:path';

/** Steam appid for Wallpaper Engine. */
export const WE_APPID = '431960';

/** Wallpaper kinds WE can declare. */
export const KINDS = Object.freeze(['scene', 'video', 'web', 'application']);

/** Kinds this bundle can render in a browser. */
export const PORTABLE_KINDS = Object.freeze(['video', 'web']);

// ── 1. Valve KeyValues (VDF) ─────────────────────────────────────────────────

/**
 * Parse Valve KeyValues text into a plain object.
 *
 * Correct-by-construction tokenizer rather than line regexes:
 *   - quoted strings with backslash escapes (`\\` in Windows paths → `\`),
 *   - `//` line comments,
 *   - bare (unquoted) tokens,
 *   - arbitrarily nested blocks.
 * Later duplicate keys win, which matches Steam's own last-write behaviour.
 * Malformed input degrades to a partial tree instead of throwing.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseKeyValues(text) {
  const src = String(text);
  const n = src.length;
  let i = 0;
  let depth = 0;
  const MAX_DEPTH = 100; // pathological nesting degrades, never overflows

  // `__proto__`/`constructor`/`prototype` keys would corrupt (or fabricate
  // via) the prototype chain through plain assignment — parse and discard.
  const POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const safeAssign = (obj, key, val) => {
    if (!POISON_KEYS.has(key)) obj[key] = val;
  };

  const skipSpace = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      return;
    }
  };

  const quoted = () => {
    i++; // opening quote
    let out = '';
    while (i < n) {
      const c = src[i];
      if (c === '"') { i++; return out; }
      if (c === '\\' && i + 1 < n) { out += src[i + 1]; i += 2; continue; }
      out += c; i++;
    }
    return out; // unterminated: keep what we have
  };

  const bare = () => {
    let out = '';
    while (i < n && !/[\s{}"]/.test(src[i])) { out += src[i]; i++; }
    return out;
  };

  const token = () => (src[i] === '"' ? quoted() : bare());

  const value = () => {
    skipSpace();
    if (src[i] !== '{') return token();
    if (++depth > MAX_DEPTH) {
      // Too deep: consume the block without building it, keep parsing.
      let d = 1;
      i++;
      while (i < n && d > 0) {
        if (src[i] === '{') d++;
        else if (src[i] === '}') d--;
        i++;
      }
      depth--;
      return null;
    }
    i++;
    const obj = {};
    for (;;) {
      skipSpace();
      if (i >= n) break;
      if (src[i] === '}') { i++; break; }
      const key = token();
      safeAssign(obj, key, value());
    }
    depth--;
    return obj;
  };

  const root = {};
  while (i < n) {
    skipSpace();
    if (i >= n) break;
    const key = token();
    if (!key) { i++; continue; }
    safeAssign(root, key, value());
  }
  return root;
}

/**
 * Extract the Steam library roots that own `appid` from libraryfolders.vdf
 * text. Handles both schemas:
 *   modern:  "0" { "path" "..." "apps" { "431960" "..." } }
 *   legacy:  "1" "D:\\SteamLibrary"          (no app list → include as probe)
 * Appid matching is EXACT (object key lookup) — a substring check would false-
 * positive on appids like 1431960.
 *
 * @param {string} vdfText
 * @param {string} [appid]
 * @returns {string[]} normalized, de-duplicated library roots
 */
export function librariesFromVdfText(vdfText, appid = WE_APPID) {
  const tree = parseKeyValues(vdfText);
  const root = tree && typeof tree === 'object' ? tree.libraryfolders : null;
  if (!root || typeof root !== 'object') return [];
  const libs = [];
  for (const entry of Object.values(root)) {
    if (typeof entry === 'string') {
      if (entry.trim()) libs.push(normalize(entry));
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const path = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!path) continue;
    const apps = entry.apps && typeof entry.apps === 'object' ? entry.apps : {};
    if (Object.prototype.hasOwnProperty.call(apps, appid)) libs.push(normalize(path));
  }
  return [...new Set(libs)];
}

// ── 2. Discovery ─────────────────────────────────────────────────────────────

/**
 * Well-known Steam roots per platform, probed when the registry /
 * libraryfolders.vdf trail goes cold.
 * @param {string} [platform]
 * @param {() => string} [home]
 * @returns {string[]}
 */
export function steamProbeDirs(platform = process.platform, home = homedir) {
  switch (platform) {
    case 'win32':
      return [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        'D:\\Steam',
        'D:\\SteamLibrary',
        'E:\\SteamLibrary',
      ];
    case 'darwin':
      return [join(home(), 'Library', 'Application Support', 'Steam')];
    case 'linux':
      return [
        join(home(), '.steam', 'steam'),
        join(home(), '.local', 'share', 'Steam'),
        join(home(), '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
      ];
    default:
      return [];
  }
}

/**
 * Parse `reg query HKCU\Software\Valve\Steam /v SteamPath` output.
 * Pure — the caller runs reg.exe and passes stdout here.
 * @param {string} stdout
 * @returns {string | null}
 */
export function steamPathFromRegQuery(stdout) {
  const m = /SteamPath\s+REG_SZ\s+(\S[^\r\n]*)/i.exec(String(stdout));
  return m ? normalize(m[1].trim()) : null;
}

/**
 * The executable that proves a directory is a Wallpaper Engine install.
 * @param {string} platform
 * @returns {string}
 */
export function weBinaryName(platform = process.platform) {
  return platform === 'darwin' ? 'Wallpaper Engine.app' : 'wallpaper32.exe';
}

/**
 * First candidate directory that contains the WE binary, in order.
 * Async: io methods may be sync or return promises (the host injects
 * fs/promises so discovery never blocks the event loop).
 * @param {string[]} candidates
 * @param {{ existsSync?: (p: string) => boolean | Promise<boolean>, platform?: string }} [io]
 * @returns {Promise<string | null>}
 */
export async function findInstallDir(candidates, io = {}) {
  const exists = io.existsSync || existsSync;
  const bin = weBinaryName(io.platform || process.platform);
  const seen = new Set();
  for (const raw of candidates) {
    if (!raw) continue;
    const dir = normalize(String(raw));
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (await exists(join(dir, bin))) return dir;
  }
  return null;
}

/**
 * Ranked install-dir candidates: registry root first, then vdf-reported
 * libraries that own WE, then the probe list, then the standalone installer
 * location. Pure ranking — pass it to findInstallDir.
 * @param {{ registryRoot?: string | null, libraryRoots?: string[], platform?: string, home?: () => string }} input
 * @returns {string[]}
 */
export function installDirCandidates(input = {}) {
  const probes = steamProbeDirs(input.platform, input.home);
  const roots = [
    ...(input.registryRoot ? [input.registryRoot] : []),
    ...(input.libraryRoots || []),
    ...probes,
  ];
  const out = roots.map((r) => join(r, 'steamapps', 'common', 'wallpaper_engine'));
  if ((input.platform || process.platform) === 'win32') {
    out.push('C:\\Program Files (x86)\\Wallpaper Engine');
  }
  return out;
}

/**
 * Every Steam library root that can hold WE workshop content: the vdf-listed
 * owners of appid PLUS any probe root that has WE installed (the default
 * library is never listed as a "path" entry inside its own
 * libraryfolders.vdf, so it must be recovered by direct inspection).
 * @param {string[]} probes
 * @param {string[]} vdfLibraries
 * @param {{ existsSync?: (p: string) => boolean | Promise<boolean>, platform?: string }} [io]
 * @returns {Promise<string[]>}
 */
export async function workshopLibraryRoots(probes, vdfLibraries, io = {}) {
  const exists = io.existsSync || existsSync;
  const bin = weBinaryName(io.platform || process.platform);
  const libs = [...vdfLibraries];
  for (const probe of probes) {
    if (await exists(join(probe, 'steamapps', 'common', 'wallpaper_engine', bin))) {
      libs.push(probe);
    }
  }
  return [...new Set(libs.map((p) => normalize(p)))];
}

// ── 3. Wallpaper project model ───────────────────────────────────────────────

/** Last-resort type inference from the main file extension. */
export function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov|m4v)$/i.test(file)) return 'video';
  if (/\.(html?|js)$/i.test(file)) return 'web';
  return 'scene';
}

/**
 * Containment check: is `target` inside directory `root` (or equal to it)?
 * Both sides are resolved first; comparison is case-insensitive on win32.
 * Guards against `..` escapes AND the sibling-prefix trap
 * (`/root/abc` must not pass for root `/root/ab`).
 * @param {string} root
 * @param {string} target
 * @param {string} [platform]
 * @returns {boolean}
 */
export function isInsideDir(root, target, platform = process.platform) {
  const win = platform === 'win32';
  // Canonicalize for comparison: win32 paths are case-insensitive and accept
  // both separators, so normalize `/` and `\` to `\` and lowercase. This also
  // makes the win32 semantics identical no matter which OS the code runs on
  // (CI is Linux; the WE files themselves are Windows paths).
  const canon = (p) => {
    let r = resolve(String(p));
    if (win) r = r.replace(/[\\/]/g, '\\').toLowerCase();
    return r;
  };
  const r = canon(root);
  const t = canon(target);
  if (t === r) return true;
  const boundary = win ? '\\' : sep;
  const withSep = r.endsWith(boundary) ? r : r + boundary;
  return t.startsWith(withSep);
}

/**
 * Read and validate one wallpaper project directory.
 * Returns null for anything unusable; never throws.
 * Security invariant: the declared main file and preview must resolve INSIDE
 * the project directory — a hostile project.json cannot point the media
 * server at arbitrary files.
 *
 * @param {string} dir
 * @param {{ readFileSync?: (p: string, e: string) => string | Promise<string>, existsSync?: (p: string) => boolean | Promise<boolean> }} [io]
 */
export async function readProject(dir, io = {}) {
  const read = io.readFileSync || readFileSync;
  const exists = io.existsSync || existsSync;
  const pj = join(dir, 'project.json');
  if (!await exists(pj)) return null;
  try {
    const o = JSON.parse(await read(pj, 'utf8'));
    if (!o || typeof o !== 'object' || typeof o.file !== 'string' || !o.file.trim()) return null;
    // A declared-but-unknown type (typo, trailing whitespace) is not
    // evidence of "scene": fall back to extension inference first.
    let type = typeof o.type === 'string' ? o.type.trim().toLowerCase() : '';
    if (!KINDS.includes(type)) type = inferType(o.file);
    const fileAbs = resolve(dir, o.file);
    if (!isInsideDir(dir, fileAbs)) return null;
    let previewAbs = null;
    if (typeof o.preview === 'string' && o.preview.trim()) {
      const p = resolve(dir, o.preview);
      if (isInsideDir(dir, p)) previewAbs = p;
    }
    return {
      id: basename(dir),
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : basename(dir),
      type,
      dir,
      fileAbs,
      previewAbs,
    };
  } catch {
    return null;
  }
}

/**
 * Enumerate every wallpaper project under the given roots (first occurrence
 * of an id wins), sorted case-insensitively by title.
 * @param {string[]} roots
 * @param {{ readdirSync?: (p: string) => string[] | Promise<string[]>, statSync?: (p: string) => { isDirectory(): boolean } | Promise<{ isDirectory(): boolean }> }} [io]
 */
export async function enumerateWallpapers(roots, io = {}) {
  const readdir = io.readdirSync || readdirSync;
  const stat = io.statSync || statSync;
  const found = new Map();
  for (const root of roots) {
    let entries;
    try { entries = await readdir(root); } catch { continue; }
    for (const entry of entries) {
      const dir = join(root, entry);
      try { if (!(await stat(dir)).isDirectory()) continue; } catch { continue; }
      const proj = await readProject(dir, io);
      if (!proj || found.has(proj.id)) continue;
      found.set(proj.id, proj);
    }
  }
  return [...found.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/**
 * The roots to enumerate: built-in project folders inside the install dir,
 * plus the workshop content folder of every owning library.
 * @param {string | null} installDir
 * @param {string[]} libraryRoots
 * @param {{ existsSync?: (p: string) => boolean | Promise<boolean> }} [io]
 * @returns {Promise<string[]>}
 */
export async function wallpaperRoots(installDir, libraryRoots, io = {}) {
  const exists = io.existsSync || existsSync;
  const roots = [];
  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects']) {
      const p = join(installDir, 'projects', sub);
      if (await exists(p)) roots.push(p);
    }
  }
  for (const lib of libraryRoots) {
    const ws = join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
    if (await exists(ws)) roots.push(ws);
  }
  return roots;
}

// ── 4. Playlist model ────────────────────────────────────────────────────────

/**
 * Pull the playlist rows out of one WE config profile. Supports both schemas:
 *   modern: profile.general.playlists[]
 *   legacy: profile.general.wallpaperconfig.selectedwallpapers.<monitor>.playlist
 */
export function playlistRows(profile) {
  const general = profile && typeof profile === 'object' ? profile.general : null;
  if (!general || typeof general !== 'object') return [];
  if (Array.isArray(general.playlists) && general.playlists.length) return general.playlists;
  const selected = general.wallpaperconfig && general.wallpaperconfig.selectedwallpapers;
  if (!selected || typeof selected !== 'object') return [];
  return Object.values(selected)
    .map((monitor) => monitor && monitor.playlist)
    .filter((playlist) => playlist && typeof playlist === 'object');
}

/**
 * Parse WE's config.json object into normalized playlists.
 * Rows with no usable items are dropped; exact duplicates (same name + same
 * item list) collapse. Pure — the caller reads the file.
 * @param {unknown} config parsed config.json
 * @returns {{ name: string, items: string[], order: 'sequence'|'random', delay: number|null }[]}
 */
export function parsePlaylists(config) {
  if (!config || typeof config !== 'object') return [];
  const result = [];
  const seen = new Set();
  for (const profile of Object.values(config)) {
    for (const [index, row] of playlistRows(profile).entries()) {
      if (!row || typeof row !== 'object') continue;
      const items = Array.isArray(row.items)
        ? [...new Set(row.items.filter((item) => typeof item === 'string' && item.trim()))]
        : [];
      if (!items.length) continue;
      const name = typeof row.name === 'string' && row.name.trim()
        ? row.name.trim() : `Playlist ${index + 1}`;
      const signature = `${name}\u0000${items.join('\u0000')}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
      result.push({
        name,
        items,
        order: settings.order === 'random' ? 'random' : 'sequence',
        delay: typeof settings.delay === 'number' && settings.delay >= 0 ? settings.delay : null,
      });
    }
  }
  return result;
}

/** Normalized lowercase path key for item matching. */
export function pathKey(file) {
  return normalize(String(file).replace(/\//g, sep)).toLowerCase();
}

/**
 * Resolve one WE playlist item (an absolute or install-relative path string)
 * to an enumerated wallpaper id. Strategy order:
 *   1. exact normalized path match against enumerated main files,
 *   2. workshop url fragment `…/431960/<projectId>/…`,
 *   3. trailing project-folder name (covers install-relative entries),
 *   4. bare workshop id.
 * @param {string} item
 * @param {Map<string, string>} byPath pathKey(fileAbs) → id
 * @param {Map<string, unknown>} byId id → project
 * @returns {string | null}
 */
export function resolvePlaylistItem(item, byPath, byId) {
  const exact = byPath.get(pathKey(item));
  if (exact) return exact;
  const workshop = /[\\/]431960[\\/]([^\\/]+)(?:[\\/]|$)/i.exec(item);
  if (workshop && byId.has(workshop[1])) return workshop[1];
  const folder = /[\\/]([^\\/]+)[\\/][^\\/]+$/i.exec(item);
  if (folder && byId.has(folder[1])) return folder[1];
  if (typeof item === 'string' && byId.has(item)) return item; // bare id
  return null;
}

// ── 5. HTTP helpers ──────────────────────────────────────────────────────────

/**
 * Parse an HTTP Range header for a resource of `size` bytes.
 * Supports `bytes=a-b`, `bytes=a-`, `bytes=-suffix`.
 *
 * RFC 9110 §14.2: a server MUST ignore a Range header it does not understand
 * (malformed, wrong unit, multi-range) and answer 200 — 416 is reserved for
 * syntactically valid but unsatisfiable ranges.
 *
 * @returns {null | { start: number, end: number } | { error: true }}
 *   null    → no header, or an invalid/unsupported one: ignore it, serve 200
 *   error   → valid syntax but unsatisfiable for this resource: answer 416
 *   start/end → inclusive byte range, answer 206
 */
export function parseRangeHeader(header, size) {
  if (!header || typeof header !== 'string') return null;
  if (!Number.isFinite(size) || size < 0) return { error: true };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // wrong unit / multi-range / garbage → ignore (200)
  const [, a, b] = m;
  if (a === '' && b === '') return null; // "bytes=-" is not a range → 200
  let start;
  let end;
  if (a === '') {
    const suffix = parseInt(b, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null; // "bytes=-0"
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(a, 10);
    end = b === '' ? size - 1 : Math.min(parseInt(b, 10), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Valid syntax; unsatisfiable for this resource.
  if (size === 0 || start > end || start >= size) return { error: true };
  return { start, end };
}

/** Minimal MIME table for the files this bundle can legitimately serve. */
export function mimeFor(absPath) {
  const m = /\.([^.]+)$/.exec(String(absPath));
  const ext = m ? m[1].toLowerCase() : '';
  return {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  }[ext] || 'application/octet-stream';
}

// ── 6. Inventory assembly (pure; the host wires it to HTTP) ──────────────────

/**
 * Assemble the JSON inventory payload from a discovery result. Pure on top of
 * the enumeration/playlist helpers, so the host's HTTP layer stays thin and
 * this function is directly unit-testable against fixture trees.
 *
 * @param {{ installDir: string | null, libraryRoots: string[] }} discovery
 * @param {object} [io] overridable IO: existsSync/readFileSync/readdirSync/
 *   statSync (default to node:fs sync functions; each may also return a
 *   promise — the host injects fs/promises to keep the event loop free),
 *   plus:
 *   - `mint(entry)` — mint a media/preview token for a file entry; when it
 *     returns a falsy value (or is omitted) the URL is null, never
 *     "…/media/null".
 *   - `base` — URL prefix for media/preview links (default '/we-background').
 * @returns {Promise<{ installDir, total, portableCount, wallpapers, playlists }>}
 */
export async function buildInventoryFrom(discovery = {}, io = {}) {
  const exists = io.existsSync || existsSync;
  const read = io.readFileSync || readFileSync;
  const mint = io.mint || (() => null);
  const base = io.base || '/we-background';

  const installDir = discovery.installDir || null;
  const libraryRoots = Array.isArray(discovery.libraryRoots) ? discovery.libraryRoots : [];
  const roots = await wallpaperRoots(installDir, libraryRoots, { existsSync: exists });
  const projects = await enumerateWallpapers(roots, io);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const byPath = new Map(projects.map((p) => [pathKey(p.fileAbs), p.id]));

  const wallpapers = [];
  for (const p of projects) {
    // Renderable kinds ONLY: scene/application wallpapers are .pkg scene
    // packages no browser can render, and their preview stills are a
    // degraded experience — skip them instead of offering them.
    if (!PORTABLE_KINDS.includes(p.type)) continue;
    const hasMedia = await exists(p.fileAbs);
    const hasPreview = Boolean(p.previewAbs) && await exists(p.previewAbs);
    const mediaToken = hasMedia
      ? mint({ abs: p.fileAbs, rootDir: p.type === 'web' ? p.dir : null, key: `${p.id}:media` })
      : null;
    const previewToken = hasPreview
      ? mint({ abs: p.previewAbs, rootDir: null, key: `${p.id}:preview` })
      : null;
    wallpapers.push({
      id: p.id,
      title: p.title,
      type: p.type,
      playable: hasMedia && Boolean(mediaToken),
      media: hasMedia && mediaToken ? `${base}/media/${mediaToken}` : null,
      // The preview stays in the payload even though stills are never
      // selected: it is the decode-failure fallback for playable entries.
      preview: hasPreview && previewToken ? `${base}/preview/${previewToken}` : null,
    });
  }
  const playableIds = new Set(wallpapers.filter((w) => w.playable).map((w) => w.id));

  let playlists = [];
  const configPath = installDir ? join(installDir, 'config.json') : null;
  if (configPath && await exists(configPath)) {
    try {
      playlists = parsePlaylists(JSON.parse(await read(configPath, 'utf8')));
    } catch { /* malformed config.json → no playlists, not fatal */ }
  }
  const playlistView = playlists.map((playlist, index) => {
    const ids = [];
    const seen = new Set();
    for (const item of playlist.items) {
      const id = resolvePlaylistItem(item, byPath, byId);
      // Only ids present IN THE PAYLOAD: a scene/application item resolves
      // to an enumerated project but is filtered from wallpapers[] — keeping
      // it would hand the client a dangling id it cannot render or look up.
      // Such items count as unresolved (they are, for our purposes).
      if (id && playableIds.has(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
    return {
      id: `pl-${index}`,
      name: playlist.name,
      order: playlist.order,
      delay: playlist.delay,
      wallpaperIds: ids,
      total: ids.length,
      portableCount: ids.filter((id) => playableIds.has(id)).length,
      unresolvedCount: Math.max(0, playlist.items.length - ids.length),
    };
  });

  return {
    installDir,
    total: wallpapers.length,
    portableCount: wallpapers.filter((w) => w.playable).length,
    wallpapers,
    playlists: playlistView,
  };
}
