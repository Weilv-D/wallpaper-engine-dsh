/**
 * verify-client.mjs — smoke-verify the EMITTED bundle (lib/client.js).
 *
 * Boots the real artifact in a node:vm sandbox under the DSH module-loader
 * contract, drives apply() with a mock slots/effect context, and asserts the
 * behavioural contract end to end:
 *   - module envelope (id, exports, Symbol.toStringTag)
 *   - settings.section slot registration (own dedicated section)
 *   - style tag lifecycle (injected on apply, REMOVED on dispose)
 *   - wallpaper + scrim layers under <body>, body attribute, CSS variables
 *   - web wallpapers get a sandboxed iframe (allow-scripts only)
 *   - web wallpapers keep the crop-adjust overlay AND the fit select
 *     ("free" drives the crop transforms on an iframe too)
 *   - scene/application wallpapers are filtered out host-side and never render
 *   - refresh does NOT remount the playing wallpaper (token churn tolerated)
 *   - crossfade keeps two layers until the leave timer settles
 *   - clearing fades out gracefully (scrim outlives the layer until the fade
 *     completes) instead of tearing everything down instantly
 *   - rotation timer advances and wraps within the user-defined group
 *   - 刷新 calls /we-background/inventory?refresh=1
 *   - stale media errors from crossfade-leaving elements are ignored (the
 *     failure ladder keys off the mount-time id, not the live selection)
 *   - a cleared selection stops the "auto-rotating" status claim
 *   - transient inventory outages are non-destructive (selection, rotation
 *     and the playing layer survive; 重试 recovers in place)
 *   - dispose tears down every layer, the scrim, timers, monitors and effects
 *
 * Exits non-zero when any assertion fails (CI-friendly).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
function check(label, cond, detail) {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : '  → ' + detail}`);
}

// ── Minimal-but-real DOM mock ────────────────────────────────────────────────
// Canvas pixel source for the smart-veil luminance sampler: set before firing
// a media load event, and the fake 2D context reports exactly these bytes.
let mockCanvasPixels = null;

function walkAll(root, out) {
  for (const c of root.children) {
    out.push(c);
    walkAll(c, out);
  }
  return out;
}

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    // True unconditionally: the mock cannot tell attachment, and the tests
    // that remove surfaces go through explicit dispose paths.
    isConnected: true,
    dataset: {},
    attributes: {},
    _classes: new Set(),
    _id: '',
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      removeProperty(k) { delete this._props[k]; },
    },
    get className() { return [...el._classes].join(' '); },
    set className(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: {
      add: (...cs) => cs.forEach((c) => el._classes.add(c)),
      remove: (...cs) => cs.forEach((c) => el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    get id() { return el._id; },
    set id(v) { el._id = String(v); },
    appendChild(c) {
      // Real-DOM semantics: appending DETACHES from the previous parent
      // (moving a node). Without this, adjust-mode's layer relocation left
      // stale copies in two children arrays.
      if (c._parent) {
        const i = c._parent.children.indexOf(c);
        if (i >= 0) c._parent.children.splice(i, 1);
      }
      el.children.push(c); c._parent = el; return c;
    },
    remove() {
      const p = el._parent;
      if (p) {
        const i = p.children.indexOf(el);
        if (i >= 0) p.children.splice(i, 1);
        el._parent = null;
      }
    },
    get parentNode() { return el._parent || null; },
    removeChild(c) {
      const i = el.children.indexOf(c);
      if (i >= 0) el.children.splice(i, 1);
      c._parent = null;
      return c;
    },
    replaceWith(node) {
      const p = el._parent;
      if (!p) return;
      const i = p.children.indexOf(el);
      if (i >= 0) p.children[i] = node;
      node._parent = p;
      el._parent = null;
    },
    get firstChild() { return el.children[0] || null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    get innerHTML() { return el._innerHTML || ''; },
    set innerHTML(v) {
      el._innerHTML = String(v);
      el.children.length = 0;
      const m = /^\s*<([a-zA-Z]+)/.exec(el._innerHTML);
      if (m) {
        const child = makeEl(m[1]);
        child._parent = el;
        el.children.push(child);
      }
    },
    // Namespace-blind like the rest of the mock: the lens only reads back
    // the plain attributes map.
    setAttributeNS(_ns, k, v) { el.attributes[k] = String(v); },
    setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'id') el._id = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributes, k); },
    removeAttribute(k) { if (k === 'id') el._id = ''; delete el.attributes[k]; },
    // Record the last listener per type so tests can fire real handlers
    // (adjust-overlay Done button, pointer pan, keydown Esc).
    addEventListener(type, fn) { el._listeners = el._listeners || {}; el._listeners[type] = fn; },
    removeEventListener(type) { if (el._listeners) delete el._listeners[type]; },
    matches(sel) {
      // Only the lens spec selectors; everything else stays unsupported
      // Honors the element: only a node carrying the data attribute matches.
      return sel === '[data-composer-card]' && 'composerCard' in el.dataset;
    },
    contains(node) { return walkAll(el, []).includes(node); },
    play() { el.playCalled = (el.playCalled || 0) + 1; return { catch() {} }; },
    pause() { el.pauseCalled = (el.pauseCalled || 0) + 1; },
    ...(tag.toLowerCase() === 'canvas' ? {
      // Enough of a 2D API for BOTH consumers: the luminance sampler reads
      // mock-pixel bytes via getImageData, and the lens displacement-map
      // builder rasterises an SDF through createImageData/putImageData and
      // mints a data URL off the element itself.
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: mockCanvasPixels || new Uint8Array(0) }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {},
      }),
      toDataURL: () => 'data:image/png;base64,TEVOU01BUA==',
    } : {}),
    querySelector(sel) {
      const all = walkAll(el, []);
      if (sel.startsWith('.')) return all.find((n) => n._classes.has(sel.slice(1))) || null;
      const tagName = sel.split('[')[0].toUpperCase();
      return all.find((n) => n.tagName === tagName) || null;
    },
    querySelectorAll(sel) {
      const all = walkAll(el, []);
      if (sel.startsWith('.')) return all.filter((n) => n._classes.has(sel.slice(1)));
      const tagName = sel.split('[')[0].toUpperCase();
      return tagName ? all.filter((n) => n.tagName === tagName) : all;
    },
  };
  return el;
}

const headEl = makeEl('head');
const bodyEl = makeEl('body');

// Lens fixture: a composer card the scan can claim, with fixed geometry so
// paintLensSlot exercises the full raster -> paint -> inline-chain path.
const composerFixture = makeEl('div');
composerFixture.dataset.composerCard = '';
composerFixture.clientWidth = 720;
composerFixture.clientHeight = 116;
bodyEl.appendChild(composerFixture);

// Plugin-page sticky bar fixture: syncHeaderWindow parks a clipped clone of
// the live media inside this bar (video → a second decoder; web → the
// preview still). Without it the header-window code path never runs here.
const pageBarFixture = makeEl('div');
pageBarFixture._classes = new Set(['settings_pageBar']);
pageBarFixture.dataset.natural = '';
pageBarFixture.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 64 });
bodyEl.appendChild(pageBarFixture);

// Settings-nav row fixture: styleNavIcon swaps the default gear SVG for the
// plugin glyph on rows whose label text matches the plugin's nav label.
const navGear = makeEl('svg');
const navRow = makeEl('button');
navRow._classes = new Set(['settings_navCell']);
navRow.textContent = '壁纸背景';
navRow.appendChild(navGear);
bodyEl.appendChild(navRow);
const documentMock = {
  createElement: (t) => makeEl(t),
  // The lens defs tree is built with the SVG-namespaced factory; the mock
  // element is namespace-blind, which is all the client reads back.
  createElementNS: (_ns, t) => makeEl(t),
  getElementById: (id) =>
    walkAll(bodyEl, []).concat(walkAll(headEl, [])).find((n) => n._id === id) || null,
  querySelector: (sel) => {
    if (sel.startsWith('style')) {
      return headEl.children.find((n) => n.tagName === 'STYLE') || null;
    }
    if (typeof sel === 'string' && sel.includes('_pageBar')) return pageBarFixture;
    return bodyEl.querySelector(sel);
  },
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  _listeners: {},
  addEventListener(type, fn) { this._listeners[type] = fn; },
  removeEventListener(type) { delete this._listeners[type]; },
  visibilityState: 'visible',
  head: headEl,
  body: bodyEl,
};

const timers = [];

// Drain every pending sub-second timer (crossfade leave timers AND the glass
// wake relax at 450ms — both live in the same queue): fire newest-first.
function drainShortTimers() {
  for (let guard = 0; guard < 8; guard++) {
    const t = [...timers].reverse().find((x) => !x.cleared && !x.fired && x.ms < 1000);
    if (!t) return;
    t.fn();
  }
}
// Mutable on purpose: the lens UA gate reads navigator.userAgent on every
// applyEffects call, so the harness can flip into a Safari UA and assert the
// gate drops the lens without a second module boot.
const CHROMIUM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Electron/37.0.0 DSH/0.2.1';
const navigatorMock = { userAgent: CHROMIUM_UA, language: 'zh-CN' };
// Minimal MutationObserver: the client uses it only to trigger re-sweeps and
// never inspects records synchronously. The harness delivers no records, so
// binding one lets the apply-time initial sweep (styleNavIcon) run — the
// lens watcher binds the same mock and stays silent, which is fine: scans
// also run from applyEffects.
class MutationObserverMock {
  constructor(cb) { this._cb = cb; }
  observe() {}
  disconnect() {}
}
const windowMock = {
  __ModuleLoader__: null, // installed below
  matchMedia: () => ({ matches: false }),
  setTimeout: (fn, ms) => {
    const token = { fn: () => { token.fired = true; fn(); }, ms, cleared: false, fired: false };
    timers.push(token);
    return token;
  },
  clearTimeout: (token) => { if (token) token.cleared = true; },
  confirm: () => true,
  requestAnimationFrame: () => 0, // never fires → fps stays unsampled
  cancelAnimationFrame: () => {},
};

const localStorageMock = {
  _store: {
    'wallpaper-engine-dsh:selection': JSON.stringify({
      id: 'a',
      rotationGroupId: 'g1',
      rotationEnabled: true,
      border: 1, // persisted at the slider's ceiling edge
      rotationGroups: [
        { id: 'g1', name: 'My list', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b'] },
        { id: 'g2', name: 'Solo', interval: 5, order: 'sequence', wallpaperIds: ['c'] },
      ],
      rotationSeeded: true,
    }),
    // A "*" verdict was recorded while the host could not identify the bytes
    // (pre-2.3.9 host, or a stat that failed). The host now fingerprints the
    // file, so the verdict must be released on load: the bytes may have been
    // re-encoded outside the plugin, and the failure ladder records a real
    // fingerprint again if the file still cannot decode.
    'wallpaper-engine-dsh:undecodable': JSON.stringify({ v: 1, marks: { b: '*' } }),
  },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = String(v); },
};

// Token churn: every fetch hands out FRESH media URLs (as the host does when
// it re-mints tokens on each inventory rebuild), so the test can prove the
// client does not reload the playing wallpaper just because URLs changed.
let fetchCount = 0;
let failFetch = false; // transient-outage test: flip before, clear after
const fetchCalls = [];
const fetchMock = (url) => {
  fetchCalls.push(String(url));
  if (failFetch) return Promise.reject(new Error('simulated outage'));
  const n = ++fetchCount;
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      installDir: 'D:/we', total: 3, portableCount: 3,
      playlists: [
        { id: 'pl-0', name: 'WE playlist', order: 'sequence', delay: null, wallpaperIds: ['a', 'b'], total: 2, portableCount: 2 },
      ],
      wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, fingerprint: '4096:111', media: `/we-background/media/tokA-${n}`, preview: `/we-background/preview/pA-${n}` },
        { id: 'b', title: 'Web B', type: 'web', playable: true, fingerprint: '2048:222', media: `/we-background/media/tokB-${n}/index.html`, preview: `/we-background/preview/pB-${n}` },
        // Playable but preview-less — the decode-failure path for it must
        // end in a cleared selection, not a dead element on the layer.
        { id: 'c', title: 'Clip C', type: 'video', playable: true, fingerprint: '1024:333', media: `/we-background/media/tokC-${n}`, preview: null },
      ],
    }),
  });
};

// ── Boot the emitted bundle ─────────────────────────────────────────────────
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const cap = { handoff: null };
windowMock.__ModuleLoader__ = { load: (h) => { cap.handoff = h; } };

const sandbox = {
  window: windowMock,
  document: documentMock,
  localStorage: localStorageMock,
  fetch: fetchMock,
  navigator: navigatorMock,
  MutationObserver: MutationObserverMock,
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

check('module registered with __ModuleLoader__', cap.handoff && cap.handoff.id === 'wallpaper-engine-dsh', cap.handoff && cap.handoff.id);

// Mechanical i18n parity: a key missing from one STRINGS table only surfaces
// when that language renders it — diff the two key sets up front instead.
{
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const table = (lang) => {
    const m = src.match(new RegExp(lang + ': \\{([\\s\\S]*?)\\n  \\}'));
    return m ? [...m[1].matchAll(/^ {4}(\w+):/gm)].map((x) => x[1]) : [];
  };
  const zh = table('zh');
  const en = table('en');
  check('STRINGS zh/en key sets identical',
    zh.length > 0 && zh.length === en.length &&
      !zh.some((k) => !en.includes(k)) && !en.some((k) => !zh.includes(k)),
    `zh=${zh.length} en=${en.length}`);
}

const React = {
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

const { factory } = cap.handoff;
const requireMock = (spec) => { if (spec === 'react') return React; throw new Error('unexpected require: ' + spec); };
const exportsObj = factory(requireMock);
check('exports apply + inject', typeof exportsObj.apply === 'function' && Array.isArray(exportsObj.inject));
check('inject declares slots, locale, theme',
  JSON.stringify(exportsObj.inject) === '["slots","locale","theme"]',
  JSON.stringify(exportsObj.inject));
check('bundle carries no legacy data-ds-dark-theme hook', !code.includes('data-ds-dark-theme'));
check('glass wake machinery present in bundle', code.includes('function triggerGlassWake') && code.includes('triggerGlassWake();') && code.includes('glassWake ? 0.22 : 0'));
check('Symbol.toStringTag is Module', Object.prototype.toString.call(exportsObj) === '[object Module]');

// ── apply() with a mock Cordis ctx ──────────────────────────────────────────
const registrations = [];
const cleanups = [];
const pickerRenders = [];
const eventHandlers = {};
let themeIsDark = false;
const themeSvc = {
  getTheme: () => ({ active: { colorScheme: themeIsDark ? 'dark' : 'light' } }),
};
const localeSvc = { getLocale: () => ({ active: 'zh' }) };
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => {
    registrations.push({ key: opts.name, id: opts.id, label: opts.label, order: opts.order });
    pickerRenders.push(render);
  },
};
const ctx = {
  slots,
  get: (name) => (name === 'theme' ? themeSvc : name === 'locale' ? localeSvc : undefined),
  on: (event, handler) => { (eventHandlers[event] = eventHandlers[event] || []).push(handler); },
  effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
};
// Theme flips now arrive through the shell theme service's event, not a DOM
// attribute mutation.
const emitTheme = (dark) => {
  themeIsDark = dark;
  for (const h of eventHandlers['theme/change'] || []) {
    h({ active: { colorScheme: dark ? 'dark' : 'light' } });
  }
};

let thrown = null;
try { exportsObj.apply(ctx); } catch (e) { thrown = e && e.stack || e; }
check('apply() does not throw', !thrown, thrown);
check('registers its own settings.section (not a row inside General)',
  registrations.some((r) => r.key === 'settings.section' && r.id === 'we-background'),
  JSON.stringify(registrations));
check('style tag injected on apply', headEl.children.some((n) => n.tagName === 'STYLE'));
// styleNavIcon swaps the default gear SVG for the plugin glyph in place —
// dataset-guarded, the gear detaches, an svg (the plugin one) remains.
check('nav icon swapped in place on the settings row',
  navRow.dataset.webgNavIcon === '1' && navGear._parent === null &&
    Boolean(navRow.querySelector('svg')) && navRow.querySelector('svg') !== navGear,
  JSON.stringify([navRow.dataset.webgNavIcon, String(navGear._parent)]));
// The shell's brand-primary-invert aliases brand-primary itself (no
// contrast) — anything on a brand fill must take its colour from the
// inverted label ramp instead, or buttons render as blank patches.
{
  const styleCss = (headEl.children.find((n) => n.tagName === 'STYLE') || {}).textContent || '';
  check('on-brand contrast comes from the inverted label ramp, not brand-primary-invert',
    styleCss.includes('--webg-on-brand: var(--dsw-alias-label-primary-inverted') &&
      !styleCss.includes('var(--dsw-alias-brand-primary-invert'));
  // The shell's color-scheme: dark propagates into sandboxed web wallpapers
  // and breaks some of them (solid white page) — the iframe must pin the
  // neutral scheme itself.
  check('web wallpaper iframe pins color-scheme: normal against theme leakage',
    styleCss.includes('color-scheme: normal'));
  // Liquid-glass material inventory (v3): the wallpaper-sampled body, the
  // lit-column bevel, the four elevation steps, the per-tier chains and both
  // accessibility blocks. Grain is pinned ABSENT: retired with the frosted era
  // - on video wallpaper a static noise tile reads as dirt, and Apple's layer
  // model has no grain layer.
  check('liquid-glass material blocks present in css',
    !styleCss.includes('--webg-grain:') &&
      // Body is a wallpaper-derived glass body, not a white wash.
      styleCss.includes('--webg-body: hsl(var(--webg-tint-h)') &&
      (styleCss.match(/--webg-body: hsl\(var\(--webg-tint-h\)[^;]*--webg-k/g) || []).length >= 2 &&
      // Per-surface density lives in a SURFACE-level re-declaration (custom
      // property substitution happens at the declaring element, so a
      // per-surface --webg-k never reaches the body-level formula).
      (styleCss.match(/data-dsh-bottom-panel/g) || []).length >= 4 &&
      styleCss.includes('--webg-bevel:') &&
      styleCss.includes('calc(0.50 * var(--webg-rim))') &&
      styleCss.includes('calc(0.26 * var(--webg-rim))') &&
      styleCss.includes('--webg-e2:') &&
      styleCss.includes('--webg-e3:') &&
      styleCss.includes('--webg-spec-gloss:') &&
      styleCss.includes('--webg-lens-chain') &&
      styleCss.includes('data-webg-lens') &&
      styleCss.includes('--dsw-menu-backdrop-filter: var(--webg-chain-t2') &&
      styleCss.includes('--dsw-menu-surface-fill: var(--webg-body)') &&
      styleCss.includes('[class$="_overlay"] > [class$="_panel"]:not([data-menu-material])::before') &&
      // The glass hairline rides the borders slider; host border tokens stay
      // at host values (hijacking them outlined every elevated control).
      styleCss.includes('calc(0.09 * var(--webg-rim) * var(--webg-border-alpha, 0.35) / 0.35)') &&
      !styleCss.includes('--dsw-alias-border-l1: rgba(180') &&
      styleCss.includes('--dsw-alias-border-l4: rgba(255, 255, 255, 0.13)') &&
      // Every tier keeps a shadow token of its own.
      styleCss.includes('--webg-glass-shadow: var(--webg-bevel), var(--webg-e1)') &&
      styleCss.includes('--webg-panel-shadow: var(--webg-bevel), var(--webg-e2)') &&
      styleCss.includes('--webg-deep-shadow: var(--webg-bevel), var(--webg-e3)') &&
      // @property + fluidity: the thickness token eases, the crop bar springs.
      styleCss.includes('@property --webg-rim') &&
      styleCss.includes('@property --webg-adapt-dim') &&
      styleCss.includes('--webg-adapt-dim 600ms ease') &&
      styleCss.includes('--webg-rim 700ms ease') &&
      styleCss.includes('@keyframes webg-bar-in') &&
      styleCss.includes('box-shadow: var(--webg-panel-shadow') &&
      // The dock is T2 light glass now, not a bare hole and not a deep tint.
      !styleCss.includes('[data-dsh-bottom-panel]::before') &&
      styleCss.includes('[data-dsh-bottom-panel]') &&
      // new-session button rides the clear control tier; collapsed stays bare
      styleCss.includes('[class$="_newSession"]') &&
      styleCss.includes('color-mix(in srgb, var(--dsw-alias-button-elevated-fill) 42%') &&
      styleCss.includes('[class*="_collapsed"] [class$="_newSession"]') &&
      // settings/account cards soften to a translucent layer via one token
      styleCss.includes('--dsw-alias-settings-card-fill: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%') &&
      // Composer controls ride Apple's tiers: neutral affordance = clear
      // glass on the selector token; primary action = prominent tinted
      // glass at 85% (tint stays dominant for the white glyph).
      styleCss.includes('[data-composer-card] [class$="_add"]') &&
      styleCss.includes('[data-composer-card] [class$="_primary"]') &&
      styleCss.includes('color-mix(in srgb, var(--dsw-specific-selector) 40%') &&
      styleCss.includes('color-mix(in srgb, var(--dsw-alias-button-info-fill) 85%') &&
      styleCss.includes('.dshRemotePage') &&
      styleCss.includes('.dshRemotePage::before') &&
      styleCss.includes('[data-dsh-bottom-panel] [class$="_tabBar"]') &&
      // Content layers carry no backdrop: bubbles and Q&A cards keep body only.
      styleCss.includes('[class*="_bubble"]:not(:has([class*="_question"]))') &&
      styleCss.includes('[class*="_bubble"]:has([class*="_question"])') &&
      styleCss.includes('@media (prefers-contrast: more)') &&
      styleCss.includes('@media (prefers-reduced-transparency: reduce)'),
    'body/bevel/elevation/tier/lens/contrast/transparency markers');

  // Layer-count guard. --webg-glass-layers expands --webg-spec-gloss into FOUR
  // radials and --webg-pointer-gloss into TWO (top band + bottom bounce), so
  // the resolved stack is veil + 4 pools + gloss + pointer = 8 layers, none of
  // them tiled. A sizes/repeats list shorter than the stack
  // cycles from the start and tiles one gradient — the patchy-squares
  // regression this check pins down.
  {
    const token = (name) => {
      const m = styleCss.match(new RegExp(name + ":([^;]*);"));
      return m ? m[1] : "";
    };
    const entries = (v) => {
      let depth = 0;
      let n = 0;
      let seen = false;
      for (const ch of v) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) { n++; continue; }
        if (depth === 0 && ch.trim()) seen = true;
      }
      return seen ? n + 1 : 0;
    };
    const pools = entries(token("--webg-spec-gloss"));
    const sizes = entries(token("--webg-glass-sizes"));
    const repeats = entries(token("--webg-glass-repeats"));
    check('glass layer lists stay in step with the four specular radials',
      pools === 4 && sizes === 8 && repeats === 8,
      pools + ' pools / ' + sizes + ' sizes / ' + repeats + ' repeats');
  }
}
check('initial fetch hits inventory', fetchCalls.includes('/we-background/inventory'), fetchCalls.join(','));
check('theme/change handler bound for shell theme service',
  Array.isArray(eventHandlers['theme/change']) && eventHandlers['theme/change'].length > 0);

// Walk a rendered picker tree for button / select descriptors.
function collectButtons(tree) { return collectByType(tree, 'button'); }
function collectSelects(tree) { return collectByType(tree, 'select'); }
function collectByType(tree, type) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === type) found.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(tree);
  return found;
}

// ── Async assertions after the inventory resolves ───────────────────────────
setTimeout(async () => {
  const layer = documentMock.getElementById('wallpaper-engine-dsh-layer');
  check('wallpaper layer mounted under body', Boolean(layer));
  const media = layer && layer.children[0];
  check('video element for a video wallpaper', media && media.tagName === 'VIDEO', media && media.tagName);
  check('video is muted + looping + autoplaying', Boolean(media && media.muted && media.loop && media.autoplay));
  check('scrim mounted', Boolean(documentMock.getElementById('wallpaper-engine-dsh-scrim')));
  check('body active attribute set', bodyEl.attributes['data-webg-wallpaper'] === 'on');

  // Header wallpaper window: the sticky-bar fixture lets syncHeaderWindow
  // park a clipped clone of the live media inside the bar — a second muted
  // video decoder for a video wallpaper, the preview still for a web one —
  // plus the veil strip so the bar pixel-matches the wallpaper around it.
  const barEl = documentMock.querySelector('[class*="_pageBar"][data-natural]');
  check('plugin-page bar fixture is visible to the client', Boolean(barEl));
  const headerHost = barEl && barEl.children.find((c) => c._classes && c._classes.has('webg-header-window'));
  check('header wallpaper window mounts inside the bar', Boolean(headerHost));
  const headerFrame = headerHost && headerHost.children.find((c) => c._classes && c._classes.has('webg-header-frame'));
  check('header frame clones the live video (muted loop second decoder)',
    Boolean(headerFrame && headerFrame.children[0] && headerFrame.children[0].tagName === 'VIDEO' &&
      headerFrame.children[0].muted && headerFrame.children[0].loop),
    headerFrame && headerFrame.children[0] && headerFrame.children[0].tagName);
  check('header window carries the scrim veil strip',
    Boolean(headerHost && headerHost.children.some((c) => c._classes && c._classes.has('webg-header-veil'))));

  const props = bodyEl.style._props;
  // The veil OPPOSES the text colour: light theme (dark text) veils WHITE,
  // dark theme (light text) veils BLACK — readable over any wallpaper.
  check('scrim veil is black (material dark-pinned)', props['--webg-scrim-color'] === 'rgba(0,0,0,0.18)',
    props['--webg-scrim-color']);
  // --webg-blur / --webg-busy were written but never read by the stylesheet;
  // they are retired so a dead token cannot silently drift into meaning
  // something later. The tier chains below are the single source of truth.
  check('retired dead tokens are not written',
    props['--webg-blur'] === undefined && props['--webg-busy'] === undefined,
    props['--webg-blur'] + ' / ' + props['--webg-busy']);
  check('media filter is none at zero blur (bit-exact pixels)', props['--webg-media-filter'] === 'none',
    props['--webg-media-filter']);
  check('noise overlay hidden at zero blur', props['--webg-noise-display'] === 'none',
    props['--webg-noise-display']);
  // Glass chain: the tiered chains feed every surface. At the 8px default the
  // T2 chain is 8px of blur with the tier's vibrancy (1.4) and its tone
  // flattening (0.92) — the flattening is what keeps text readable over a
  // saturated poster without stacking more fill.
  check('backdrop chain var default (T2 blur, tier vibrancy, flattened tone)',
    props['--webg-backdrop'] === 'blur(5px) saturate(1.4) brightness(1.1) contrast(0.92)',
    props['--webg-backdrop']);
  check('tier chains are all written for the css tiers to pick up',
    /^blur\(\d+px\) saturate\(1\.6\) brightness\([\d.]+\) contrast\(1\)$/.test(props['--webg-chain-t1']) &&
      /^blur\(\d+px\) saturate\(1\.3\) brightness\([\d.]+\) contrast\(0\.9\)$/.test(props['--webg-chain-t3']),
    props['--webg-chain-t1'] + ' | ' + props['--webg-chain-t3']);
  check('no compat lens alias survives', props['--webg-backdrop-lens'] === undefined, props['--webg-backdrop-lens']);
  check('adapt-dim idle at zero luminance evidence',
    props['--webg-adapt-dim'] === 'rgba(0,0,0,0)', props['--webg-adapt-dim']);
  check('glass body takes the wallpaper tint, not a fixed fill',
    props['--webg-tint-a'] === '0.201' && props['--webg-tint-s'] === '6.2%',
    props['--webg-tint-a'] + ' / ' + props['--webg-tint-s']);
  check('body lens gate attribute set', bodyEl.attributes['data-webg-lens'] === '');
  // The lens is per surface: a single shared 256px map stretched across every
  // pane is the defect v3 removed, so the bundle must not reference it.
  check('no shared url(#webg-lens) map survives',
    !code.includes('url(#webg-lens') && code.includes('preserveAspectRatio') &&
      code.includes('xChannelSelector') && code.includes('ResizeObserver'));

  // Rotation: 5-minute timer from the group, fires → 'b' (web wallpaper).
  const rotationTimer = timers.find((t) => !t.cleared && t.ms === 300000);
  check('rotation timer scheduled (5 min)', Boolean(rotationTimer));
  if (rotationTimer) {
    rotationTimer.fn();
    check('rotation advanced to web wallpaper b',
      JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'b');
    // triggerGlassWake fired on the a→b switch: the rim writes swollen
    // (+0.22 over the 0.830 no-sample base) until the 450ms relax lands.
    check('wallpaper switch swells the rim for one wake beat',
      bodyEl.style._props['--webg-rim'] === '1.050',
      bodyEl.style._props['--webg-rim']);

    const layers = documentMock.querySelectorAll('.webg-layer');
    check('crossfade keeps two layers mid-switch', layers.length === 2, layers.length);
    check('old layer is leaving', layers.some((l) => l._classes.has('webg-layer--leave')));
    const newLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
    const frame = newLayer && newLayer.children[0];
    check('web wallpaper renders in an iframe', frame && frame.tagName === 'IFRAME', frame && frame.tagName);
    check('iframe is sandboxed (allow-scripts only)',
      frame && frame.attributes.sandbox === 'allow-scripts',
      frame && frame.attributes.sandbox);
    check('iframe sends no referrer', frame && frame.attributes.referrerpolicy === 'no-referrer');

        drainShortTimers(); // fires the leave timer AND any glass-wake relax
    check('leaving layer removed after crossfade', documentMock.querySelectorAll('.webg-layer').length === 1);
    check('wake relax restores the base rim',
      bodyEl.style._props['--webg-rim'] === '0.830',
      bodyEl.style._props['--webg-rim']);

    {
      // A web wallpaper's pixels are unreadable in the sandboxed iframe, so
      // the header clone swaps to the preview still for the same strip.
      const bar = documentMock.querySelector('[class*="_pageBar"][data-natural]');
      const host = bar && bar.children.find((c) => c._classes && c._classes.has('webg-header-window'));
      const frame = host && host.children.find((c) => c._classes && c._classes.has('webg-header-frame'));
      check('web wallpaper swaps the header clone to the preview still',
        Boolean(frame && frame.children[0] && frame.children[0].tagName === 'IMG'),
        frame && frame.children[0] && frame.children[0].tagName);
    }
    const wrapTimer = [...timers].reverse().find((t) => !t.cleared && t.ms === 300000);
    if (wrapTimer) {
      wrapTimer.fn();
      check('rotation wraps back to a',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'a');
      // Settle the b→a crossfade so later layer-count checks start clean.
            drainShortTimers();
    }
  }

  // Picker render + interactions.
  check('picker render function registered', pickerRenders.length > 0);
  let tree = null;
  let renderError = null;
  try { tree = pickerRenders[0](); } catch (e) { renderError = e && e.stack || e; }
  check('picker renders without throwing', !renderError, renderError);

  if (tree) {
    const buttons = collectButtons(tree);
    const cards = buttons.filter((b) => String(b.props.className || '').startsWith('webg-card'));
    check('grid shows close + every playable card (a, b, c)', cards.length === 4, cards.length);
    check('unplayable kinds never surface in the grid',
      !JSON.stringify(cards).includes('Scene'));

    // Crop row availability per type: web wallpapers get 调整画面/重置裁剪
    // (the crop is a CSS transform and applies to iframes) but NOT the
    // object-fit select, which an iframe ignores. Card titles live in a
    // nested .webg-card-title span — match one level down.
    const cardByTitle = (list, title) => list.find((b) =>
      Array.isArray(b.children) && b.children.some((c) =>
        c && typeof c === 'object' && Array.isArray(c.children) && c.children.includes(title)));
    // Untagged verdicts (id list / 2.3.9 object) are not proof about today's
    // bytes: they must be dropped, not pinned, or a file fixed outside the
    // plugin stays hidden forever. The seeded verdict for "Web B" is tagged
    // but carries "*" — released because the host now fingerprints the file.
    check('unverifiable "*" verdict is released on load',
      !JSON.parse(localStorageMock._store['wallpaper-engine-dsh:undecodable'] || '{}').marks.b);
    {
      const webCard = cardByTitle(cards, 'Web B');
      check('web card found in the grid', Boolean(webCard));
      if (webCard) {
        webCard.props.onClick();
                drainShortTimers();
        const webTree = pickerRenders[0]();
        const webButtons = collectButtons(webTree);
        check('web wallpaper keeps the crop-adjust button',
          webButtons.some((b) => Array.isArray(b.children) && b.children.includes('调整画面')));
        // The fit select shows for web too: object-fit is meaningless for an
        // iframe, but "free" unlocks drag/zoom transforms on it.
        const webFit = collectSelects(webTree).find((s) =>
          String(s.props.className || '').includes('webg-fit-select'));
        check('web wallpaper shows the fit select (free transforms the iframe)',
          Boolean(webFit));
        if (webFit) {
          webFit.props.onChange({ target: { value: 'free' } });
          check('free fit applies to the web wallpaper (canvas + natural size)',
            bodyEl.style._props['--webg-fit'] === 'none' &&
              bodyEl.style._props['--webg-layer-bg'] === '#000');
          webFit.props.onChange({ target: { value: 'cover' } });
        }
        const backToVideo = cardByTitle(webButtons, 'Video A');
        if (backToVideo) {
          backToVideo.props.onClick();
                    drainShortTimers();
        }
      }
    }

    // Refresh: an explicit rebuild re-mints tokens. The playing wallpaper
    // must NOT remount — the fresh URL is hot-swapped into the live element
    // so playback position survives and the stale URL cannot strand a seek.
    const layerBeforeRefresh = documentMock.getElementById('wallpaper-engine-dsh-layer');
    const srcBeforeRefresh = layerBeforeRefresh && layerBeforeRefresh.children[0] &&
      layerBeforeRefresh.children[0].src;
    const refreshBtn = buttons.find((b) =>
      Array.isArray(b.children) && b.children.includes('刷新'));
    check('refresh button present', Boolean(refreshBtn));
    if (refreshBtn) {
      refreshBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
      check('refresh forces host rebuild (?refresh=1)',
        fetchCalls.some((u) => u.includes('refresh=1')),
        fetchCalls.join(','));
      const layerAfter = documentMock.getElementById('wallpaper-engine-dsh-layer');
      check('refresh does not remount the playing wallpaper', layerAfter === layerBeforeRefresh);
      const srcAfter = layerAfter && layerAfter.children[0] && layerAfter.children[0].src;
      check('refresh hot-swaps the re-minted URL into the live element',
        srcAfter !== srcBeforeRefresh && /\/media\/tokA-\d+$/.test(String(srcAfter)),
        `${srcBeforeRefresh} → ${srcAfter}`);
      check('no leftover leaving layers after refresh', documentMock.querySelectorAll('.webg-layer').length === 1);
    }

    // Canvas fit + manual crop controls (video wallpaper → row is rendered).
    const fitSelect = collectSelects(tree).find((s) =>
      String(s.props.className || '').includes('webg-fit-select'));
    const adjustBtn = buttons.find((b) =>
      Array.isArray(b.children) && b.children.includes('调整画面'));
    check('fit select + adjust button present (no position select)', Boolean(fitSelect && adjustBtn));
    check('fit defaults to cover', bodyEl.style._props['--webg-fit'] === 'cover',
      bodyEl.style._props['--webg-fit']);
    check('zoom defaults to 1 with no offsets', bodyEl.style._props['--webg-zoom'] === '1' &&
      bodyEl.style._props['--webg-offset-x'] === '0%' && bodyEl.style._props['--webg-offset-y'] === '0%',
      JSON.stringify([bodyEl.style._props['--webg-zoom'], bodyEl.style._props['--webg-offset-x']]));
    if (fitSelect) {
      fitSelect.props.onChange({ target: { value: 'contain' } });
      check('fit switch applies immediately', bodyEl.style._props['--webg-fit'] === 'contain',
        bodyEl.style._props['--webg-fit']);
      check('fit persisted',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).fit === 'contain');
    }

    // Mirror: a coverage-preserving flip, offered in EVERY fit mode.
    {
      const mirrorBtn = buttons.find((b) =>
        Array.isArray(b.children) && b.children.includes('镜像'));
      check('mirror toggle present in the fit row', Boolean(mirrorBtn));
      if (mirrorBtn) {
        mirrorBtn.props.onClick();
        check('mirroring flips the media (scaleX -1)',
          bodyEl.style._props['--webg-mirror'] === '-1',
          bodyEl.style._props['--webg-mirror']);
        check('mirror persisted',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).mirrored === true);
        const onTree = pickerRenders[0]();
        const mirrorOn = collectButtons(onTree).find((b) =>
          Array.isArray(b.children) && b.children.includes('镜像'));
        check('mirror state reflected on the button',
          String(mirrorOn && mirrorOn.props.className).includes('webg-btn--active'));
        if (mirrorOn) mirrorOn.props.onClick();
        check('mirroring toggles back off',
          bodyEl.style._props['--webg-mirror'] === '1');
      }
    }

    // Manual crop: adjust overlay takes the LIVE layer; done puts it back.
    if (adjustBtn) {
      const layerBefore = documentMock.getElementById('wallpaper-engine-dsh-layer');
      adjustBtn.props.onClick();
      const overlay = documentMock.body.children.find((c) => c._classes && c._classes.has('webg-adjust'));
      check('adjust overlay opens with the live layer inside',
        Boolean(overlay) && overlay.children[0] === layerBefore);
      const bar = overlay && overlay.children.find((c) => c._classes && c._classes.has('webg-adjust-bar'));
      const doneBtn = bar && bar.children.find((c) => c.tagName === 'BUTTON');
      check('adjust bar has a Done button', Boolean(doneBtn));
      // Presence FIRST — the guarded interactions below must not be able to
      // vacuously pass if the client stopped attaching any handler.
      const overlayHandlers = overlay && overlay._listeners;
      check('adjust overlay attaches pointer + wheel handlers',
        Boolean(overlayHandlers && overlayHandlers.pointerdown && overlayHandlers.pointermove &&
          overlayHandlers.pointerup && overlayHandlers.wheel));
      check('Esc keydown handler registered on document',
        Boolean(documentMock._listeners.keydown));
      if (overlayHandlers && overlayHandlers.pointerdown) {
        // Gap-free invariant FIRST: at zoom 1 a drag cannot move the media
        // (there is no headroom) — offsets must stay pinned at 0.
        overlayHandlers.pointerdown({ clientX: 500, clientY: 300, target: overlay });
        overlayHandlers.pointermove({ clientX: 700, clientY: 300 });
        overlayHandlers.pointerup({});
        check('drag at zoom 1 stays pinned (no edge gaps)',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).offsetX === 0);
        // Zoom IN creates headroom; wheel-out below 1 clamps back to 1.
        overlayHandlers.wheel({ deltaY: -400, preventDefault() {} });
        const zoomed = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).zoom;
        check('wheel-up zooms in and persists', zoomed > 1, String(zoomed));
        overlayHandlers.wheel({ deltaY: 100000, preventDefault() {} });
        const floored = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
        check('extreme wheel-out clamps at 1 (crop never shrinks below cover)',
          floored.zoom === 1 && floored.offsetX === 0 && floored.offsetY === 0,
          JSON.stringify([floored.zoom, floored.offsetX]));
        // Now a real crop: zoom in, pan right, offsets land within headroom.
        overlayHandlers.wheel({ deltaY: -400, preventDefault() {} });
        overlayHandlers.pointerdown({ clientX: 500, clientY: 300, target: overlay });
        overlayHandlers.pointermove({ clientX: 560, clientY: 300 });
        overlayHandlers.pointerup({});
        const cropped = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
        const pan = (cropped.zoom - 1) * 50;
        check('drag pans within the zoom headroom and persists',
          cropped.offsetX > 0 && cropped.offsetX <= pan,
          JSON.stringify([cropped.zoom, cropped.offsetX]));
        // Esc exits exactly like Done.
        if (documentMock._listeners.keydown) {
          documentMock._listeners.keydown({ key: 'Escape' });
          check('Esc closes the overlay and returns the layer',
            !documentMock.body.children.some((c) => c._classes && c._classes.has('webg-adjust')) &&
              documentMock.getElementById('wallpaper-engine-dsh-layer') === layerBefore);
        }
        // Reset crop: a second session restores 1/0/0 through the button.
        if (documentMock.getElementById('wallpaper-engine-dsh-layer')) {
          const resetTree = pickerRenders[0]();
          const resetBtn = collectButtons(resetTree).find((b) =>
            Array.isArray(b.children) && b.children.includes('重置裁剪'));
          check('reset-crop button appears once crop is non-default', Boolean(resetBtn));
          if (resetBtn) {
            resetBtn.props.onClick();
            const persisted = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
            check('reset restores zoom 1 and zero offsets',
              persisted.zoom === 1 && persisted.offsetX === 0 && persisted.offsetY === 0);
          }
        }
      }
      if (doneBtn && doneBtn._listeners && doneBtn._listeners.click &&
          documentMock.getElementById('wallpaper-engine-dsh-layer') === layerBefore &&
          !documentMock.body.children.some((c) => c._classes && c._classes.has('webg-adjust'))) {
        // Overlay already closed by Esc above — verify Done still works by
        // reopening once more.
        adjustBtn.props.onClick();
        const overlay2 = documentMock.body.children.find((c) => c._classes && c._classes.has('webg-adjust'));
        const bar2 = overlay2 && overlay2.children.find((c) => c._classes && c._classes.has('webg-adjust-bar'));
        const done2 = bar2 && bar2.children.find((c) => c.tagName === 'BUTTON');
        if (done2 && done2._listeners && done2._listeners.click) {
          done2._listeners.click();
          check('done closes the overlay and returns the layer',
            !documentMock.body.children.some((c) => c._classes && c._classes.has('webg-adjust')) &&
              documentMock.getElementById('wallpaper-engine-dsh-layer') === layerBefore);
        }
      }
    }

    // ── Free fit: natural size on a black canvas — shrink below 1 is
    // allowed, an extreme drag keeps a sliver on screen, and leaving free
    // re-seats the crop into the gap-free envelope.
    {
      const freeSelect = collectSelects(tree).find((s) =>
        String(s.props.className || '').includes('webg-fit-select'));
      if (freeSelect) {
        freeSelect.props.onChange({ target: { value: 'free' } });
        check('free fit draws at natural size on a black canvas',
          bodyEl.style._props['--webg-fit'] === 'none' &&
            bodyEl.style._props['--webg-layer-bg'] === '#000',
          JSON.stringify([bodyEl.style._props['--webg-fit'], bodyEl.style._props['--webg-layer-bg']]));
        adjustBtn.props.onClick();
        const overlay = documentMock.body.children.find((c) => c._classes && c._classes.has('webg-adjust'));
        const handlers = overlay && overlay._listeners;
        // Rotation lives here: the bar carries ±90° buttons (free only)…
        const bar = overlay && overlay.children.find((c) => c._classes && c._classes.has('webg-adjust-bar'));
        const barButtons = bar ? bar.children.filter((c) => c.tagName === 'BUTTON') : [];
        check('free adjust bar carries ±90° rotate buttons', barButtons.length === 3,
          String(barButtons.length));
        check('free adjust hint mentions Alt+drag rotation',
          Boolean(bar && bar.children.some((c) => typeof c.textContent === 'string' && c.textContent.includes('旋转'))));
        const cw = barButtons.find((b) => b.textContent === '⟳');
        if (cw && cw._listeners && cw._listeners.click) {
          cw._listeners.click();
          check('rotate button turns the media 90°',
            bodyEl.style._props['--webg-rotate'] === '90deg' &&
              JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).rotation === 90,
            bodyEl.style._props['--webg-rotate']);
        }
        if (handlers && handlers.wheel && handlers.pointerdown) {
          handlers.wheel({ deltaY: 1000000, preventDefault() {} });
          const shrunk = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
          check('free fit shrinks below 1 down to the 0.1 floor',
            shrunk.zoom === 0.1, String(shrunk.zoom));
          handlers.pointerdown({ clientX: 500, clientY: 300, target: overlay });
          handlers.pointermove({ clientX: -5000, clientY: 300 });
          handlers.pointerup({});
          const dragged = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
          const reach = (dragged.zoom + 1) * 50 - 10;
          check('free drag is clamped to keep a sliver on screen',
            Math.abs(dragged.offsetX) <= reach + 1e-9 && dragged.offsetX < -40,
            JSON.stringify([dragged.zoom, dragged.offsetX, reach]));
          // …and Alt+drag swings an arbitrary angle around the centre.
          const before = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).rotation;
          handlers.pointerdown({ clientX: 500, clientY: 300, target: overlay, altKey: true });
          handlers.pointermove({ clientX: 100, clientY: 300 });
          handlers.pointerup({});
          const swung = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).rotation;
          check('Alt+drag rotates by an arbitrary angle',
            Number.isFinite(swung) && Math.abs(swung - before) > 30 && Math.abs(swung - before) < 90,
            `${before} → ${swung}`);
        }
        if (documentMock._listeners.keydown) documentMock._listeners.keydown({ key: 'Escape' });
        // Leaving free re-seats the crop into the gap-free envelope —
        // rotation zeroes, mirroring survives (a flip never breaks coverage).
        const mirrorForSwitch = collectButtons(pickerRenders[0]()).find((b) =>
          Array.isArray(b.children) && b.children.includes('镜像'));
        if (mirrorForSwitch) mirrorForSwitch.props.onClick();
        freeSelect.props.onChange({ target: { value: 'cover' } });
        const reseated = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
        check('switching back to a gap-free fit re-seats the crop (zoom ≥ 1, pan in headroom)',
          reseated.zoom >= 1 && Math.abs(reseated.offsetX) <= (reseated.zoom - 1) * 50 + 1e-9,
          JSON.stringify([reseated.zoom, reseated.offsetX]));
        check('switching back zeroes the rotation',
          bodyEl.style._props['--webg-rotate'] === '0deg' && reseated.rotation === 0,
          bodyEl.style._props['--webg-rotate']);
        check('mirroring survives the mode switch',
          bodyEl.style._props['--webg-mirror'] === '-1' && reseated.mirrored === true);
        const mirrorAfter = collectButtons(pickerRenders[0]()).find((b) =>
          Array.isArray(b.children) && b.children.includes('镜像'));
        if (mirrorAfter) mirrorAfter.props.onClick(); // leave the flow unmirrored
        check('layer background returns to transparent outside free fit',
          bodyEl.style._props['--webg-layer-bg'] === 'transparent');
      }
    }

    // Play/pause: drives the real video element, not just the label.
    const videoEl = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
    check('video starts playing (play() called at mount)', videoEl.playCalled >= 1,
      String(videoEl.playCalled));
    const pauseBtn = buttons.find((b) => Array.isArray(b.children) && b.children.includes('暂停'));
    check('pause button present for a video wallpaper', Boolean(pauseBtn));
    if (pauseBtn) {
      pauseBtn.props.onClick();
      check('pausing calls video.pause()', videoEl.pauseCalled >= 1, String(videoEl.pauseCalled));
      const pausedTree = pickerRenders[0]();
      const playBtn = collectButtons(pausedTree).find((b) =>
        Array.isArray(b.children) && b.children.includes('播放'));
      check('button flips to 播放', Boolean(playBtn));
      if (playBtn) {
        playBtn.props.onClick();
        check('resuming calls video.play() again', videoEl.playCalled >= 2, String(videoEl.playCalled));
      }
    }

    // Veil theme flip via the scrim slider (its onInput calls applyEffects
    // directly): the veil is white in light theme, black in dark theme.
    const sliders = (function collect(t, out) {
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        if (node.type === 'input' && node.props && node.props.type === 'range') out.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(t);
      return out;
    })(tree, []);
    check('four sliders rendered', sliders.length === 4, sliders.length);
    if (sliders.length === 4) {
      // A persisted border of 1.0 (100%) must display as the slider's 90
      // ceiling — the control caps below total washout by design, and an
      // out-of-range value would render inconsistently across browsers.
      check('border slider clamps a persisted 1.0 to its 90 ceiling',
        sliders[2].props.value === '90', sliders[2].props.value);
      const scrimSlider = sliders[1]; // 壁纸模糊, 暗化, 边框, 玻璃
      // Material dark-pinned: theme flips must leave the veil and the
      // mirror untouched — one glass recipe regardless of shell/OS theme.
      emitTheme(true);
      scrimSlider.props.onChange({ target: { value: '25', style: { setProperty() {} } } });
      check('veil stays black under a dark-theme snapshot',
        bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
        bodyEl.style._props['--webg-scrim-color']);
      emitTheme(false);
      scrimSlider.props.onChange({ target: { value: '25', style: { setProperty() {} } } });
      check('theme flip leaves the veil black (no light branch)',
        bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
        bodyEl.style._props['--webg-scrim-color']);

      // Blur>0 complement of the fast path: the filter pipeline engages and
      // the noise overlay comes back with its formula-driven opacity.
      const blurSlider = sliders[0];
      blurSlider.props.onChange({ target: { value: '20', style: { setProperty() {} } } });
      check('blur>0 engages the filter pipeline',
        bodyEl.style._props['--webg-media-filter'] === 'blur(20px) saturate(1.08)',
        bodyEl.style._props['--webg-media-filter']);
      check('noise overlay displayed at blur>0',
        bodyEl.style._props['--webg-noise-display'] === 'block');
      check('noise opacity follows the formula',
        bodyEl.style._props['--webg-noise-opacity'] === (0.02 + 20 * 0.0004).toFixed(4),
        bodyEl.style._props['--webg-noise-opacity']);
      blurSlider.props.onChange({ target: { value: '0', style: { setProperty() {} } } });
      check('back to zero blur restores the fast path',
        bodyEl.style._props['--webg-media-filter'] === 'none' &&
          bodyEl.style._props['--webg-noise-display'] === 'none');

      // Glass slider (index 3) drives the tiered chains. At 40 the T2 chain
      // caps at 10px (a 40px melt reads as milky plastic once the tint sits on
      // top); at 0 the whole glass pipeline collapses to none and the lens
      // gate lifts — displacement without blur amplifies the map's steps.
      const glassSlider = sliders[3];
      glassSlider.props.onChange({ target: { value: '40', style: { setProperty() {} } } });
      check('glass 40 caps the T2 melt at the tier ceiling',
        bodyEl.style._props['--webg-backdrop'] === 'blur(10px) saturate(1.4) brightness(1.1) contrast(0.92)',
        bodyEl.style._props['--webg-backdrop']);
      check('rim strength stays wallpaper-bound (slider-independent)',
        bodyEl.style._props['--webg-rim'] === '0.830',
        bodyEl.style._props['--webg-rim']);
      glassSlider.props.onChange({ target: { value: '0', style: { setProperty() {} } } });
      check('glass 0 collapses the chain to none (no filter pipeline)',
        bodyEl.style._props['--webg-backdrop'] === 'none',
        bodyEl.style._props['--webg-backdrop']);
      check('lens gate lifts at 0 glass', bodyEl.attributes['data-webg-lens'] === undefined);
      glassSlider.props.onChange({ target: { value: '16', style: { setProperty() {} } } });
      check('lens gate returns with the glass', bodyEl.attributes['data-webg-lens'] === '');

      // A non-Chromium UA must never carry the lens, even with the map
      // machinery warm — Safari parses url() in backdrop-filter and then
      // drops the whole chain at render time.
      navigatorMock.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
      glassSlider.props.onChange({ target: { value: '24', style: { setProperty() {} } } });
      check('non-Chromium UA: lens gate off, fixture chain cleared',
        bodyEl.attributes['data-webg-lens'] === undefined &&
          composerFixture.style._props['--webg-lens-chain'] === undefined,
        bodyEl.attributes['data-webg-lens'] + ' ' + composerFixture.style._props['--webg-lens-chain']);
      navigatorMock.userAgent = CHROMIUM_UA;
      glassSlider.props.onChange({ target: { value: '16', style: { setProperty() {} } } });

      // The surface-refraction toggle: off tears the lens down entirely
      // (gate attribute + every inline chain) while the wallpaper keeps
      // playing; on rebuilds it. Lives in the monitor row.
      const toggleLabels = (function collect(t, out) {
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (!node || typeof node !== 'object') return;
          if (node.type === 'label' && Array.isArray(node.children) &&
              node.children.some((c) => c && c.type === 'input' && c.props && c.props.type === 'checkbox')) {
            out.push(node);
          }
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(t);
        return out;
      })(tree, []);
      const lensToggle = toggleLabels.find((n) => n.children.includes('表面折射'));
      check('surface-refraction toggle present', Boolean(lensToggle));
      if (lensToggle) {
        const lensInput = lensToggle.children.find((c) => c && c.type === 'input');
        check('lens toggle starts checked', lensInput.props.checked === true);
        lensInput.props.onChange();
        check('lens off lifts the gate attribute', bodyEl.attributes['data-webg-lens'] === undefined);
        lensInput.props.onChange();
        check('lens on restores the gate attribute', bodyEl.attributes['data-webg-lens'] === '');
      }

      // The machinery itself, exercised on the fixture: the scan mounts a
      // per-view filter and paints the inline chain; the OS RT switch lifts
      // the whole JS gate mid-session and everything tears back down.
      drainShortTimers();
      const lensSlot = composerFixture.__webgLens;
      const lensFilter = lensSlot ? documentMock.getElementById(lensSlot.id) : null;
      check('lens slot mounts on the composer fixture',
        Boolean(lensFilter) && Boolean(lensSlot), String(lensSlot && lensSlot.id));
      check('fixture carries the inline lens chain',
        String(composerFixture.style._props['--webg-lens-chain'] || '').indexOf('url(#' + (lensSlot ? lensSlot.id : '') + ')') >= 0,
        composerFixture.style._props['--webg-lens-chain']);
      const disp = lensFilter && lensFilter.children[1];
      check('displacement scale pins to band * 4',
        Boolean(disp) && disp.attributes.scale === "64",
        disp && disp.attributes.scale);
      windowMock.matchMedia = (q) => ({ matches: String(q).indexOf('reduced-transparency') >= 0 });
      glassSlider.props.onChange({ target: { value: '17', style: { setProperty() {} } } });
      check('reduced-transparency lifts the lens gate', bodyEl.attributes['data-webg-lens'] === undefined);
      check('reduced-transparency clears the fixture chain',
        composerFixture.style._props['--webg-lens-chain'] === undefined);
      windowMock.matchMedia = () => ({ matches: false });
      glassSlider.props.onChange({ target: { value: '16', style: { setProperty() {} } } });
      check('lens gate returns after RT lifts', bodyEl.attributes['data-webg-lens'] === '');
      // The menu branch must feed BOTH consumers: --webg-lens-chain (the rule
      // this stylesheet uses to paint the menu) and the host's
      // --dsw-menu-backdrop-filter. Writing only the host token left the local
      // rule on the plain tier chain and the built map unused.
      check('menu slots write the per-surface chain, not only the host token',
        /else if \(slot\.spec\.menuToken\)[\s\S]{0,700}--webg-lens-chain/.test(code) &&
          /else if \(slot\.spec\.menuToken\)[\s\S]{0,700}--dsw-menu-backdrop-filter/.test(code),
        'menuToken branch');
    }

    // Smart veil math: fire the media's loadeddata so the sampler runs over
    // the fake canvas pixels. Luminance 1.0 (white) in dark theme needs a
    // 0.5 floor → alpha = max(user 0.25, 0.5); a black frame needs none.
    {
      const liveVideo = documentMock.getElementById('wallpaper-engine-dsh-layer') &&
        documentMock.getElementById('wallpaper-engine-dsh-layer').querySelector('video');
      check('video carries a loadeddata sampler hook',
        Boolean(liveVideo && liveVideo._listeners && liveVideo._listeners.loadeddata));
      check('video mount arms a first-frame watchdog',
        timers.some((t) => !t.cleared && !t.fired && t.ms === 6000));
      if (liveVideo && liveVideo._listeners && liveVideo._listeners.loadeddata) {
        const white = new Uint8Array(16 * 16 * 4).fill(255);
        const black = new Uint8Array(16 * 16 * 4); // zeros
        emitTheme(true);
        mockCanvasPixels = white;
        liveVideo._listeners.loadeddata();
        check('bright frame raises the dark-theme veil floor to 0.5',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.5)',
          bodyEl.style._props['--webg-scrim-color']);
        // Adaptive luminosity: the same sample steers the glass itself —
        // bright content dims the melt, raises the clear-variant dim to the
        // HIG 35% ceiling; dark content lifts the melt to the clamp.
        check('bright frame dims the glass (adaptive luminosity)',
          bodyEl.style._props['--webg-glass-brightness'] === '1.05',
          bodyEl.style._props['--webg-glass-brightness']);
        check('bright frame raises the clear-variant dim to the HIG ceiling',
          bodyEl.style._props['--webg-adapt-dim'] === 'rgba(0,0,0,0.35)',
          bodyEl.style._props['--webg-adapt-dim']);
        check('backdrop chain embeds the adaptive brightness',
          bodyEl.style._props['--webg-backdrop'].includes('brightness(1.05)'),
          bodyEl.style._props['--webg-backdrop']);
        mockCanvasPixels = black;
        liveVideo._listeners.loadeddata();
        check('dark frame needs no floor (user scrim stands)',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
          bodyEl.style._props['--webg-scrim-color']);
        check('dark frame earns only a whisper of lift (no grey smoke)',
          bodyEl.style._props['--webg-glass-brightness'] === '1.125',
          bodyEl.style._props['--webg-glass-brightness']);
        check('dark frame drops the clear-variant dim to zero',
          bodyEl.style._props['--webg-adapt-dim'] === 'rgba(0,0,0,0)',
          bodyEl.style._props['--webg-adapt-dim']);
        // Theme flips stay inert over the same frame: the light branch is
        // gone — same black veil, no white flip, no hue tint, dim stays black.
        emitTheme(false);
        liveVideo._listeners.loadeddata();
        check('theme flip leaves the veil black over the same frame',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
          bodyEl.style._props['--webg-scrim-color']);
        check('dim stays black under light-theme snapshot',
          bodyEl.style._props['--webg-adapt-dim'] === 'rgba(0,0,0,0)',
          bodyEl.style._props['--webg-adapt-dim']);
        mockCanvasPixels = null;
      }
    }

    // ── Stale media errors must not touch the CURRENT selection's ladder ──
    // A crossfade-leaving element of an already-switched-away wallpaper can
    // fire error while the NEW wallpaper mounts. Handlers snapshot the id at
    // mount and the ladder ignores non-current ids: no forced refresh, no
    // count inflation, selection intact.
    {
      const webCardEarly = cardByTitle(collectButtons(pickerRenders[0]()), 'Web B');
      check('web card available for the stale-error test', Boolean(webCardEarly));
      if (webCardEarly) {
        webCardEarly.props.onClick(); // 'a' (video) → 'b' (web): the old video leaves
        const leavingVideo = documentMock.querySelectorAll('.webg-layer')
          .map((l) => l.querySelector('video')).find(Boolean);
        check('old video layer still mounted mid-crossfade', Boolean(leavingVideo));
        const fetchesBefore = fetchCalls.length;
        if (leavingVideo && leavingVideo._listeners && leavingVideo._listeners.error) {
          leavingVideo._listeners.error();
        }
        check('stale error does not trigger a recovery refresh',
          fetchCalls.length === fetchesBefore, String(fetchCalls.length - fetchesBefore));
        check('stale error keeps the newly selected wallpaper',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'b');
        const liveLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
        check('stale error keeps the iframe layer intact',
          Boolean(liveLayer && liveLayer.children[0] && liveLayer.children[0].tagName === 'IFRAME'));
        // Settle the crossfade, then switch back so later blocks start clean.
                drainShortTimers();
        const videoCardBack = cardByTitle(collectButtons(pickerRenders[0]()), 'Video A');
        check('video card available to switch back', Boolean(videoCardBack));
        if (videoCardBack) {
          videoCardBack.props.onClick();
                    drainShortTimers();
        }
      }
    }

    // Smart veil toggle present in the monitor row.
    check('smart veil toggle present', JSON.stringify(tree).includes('智能可视'));

    // Decode-failure demotion: fire the video's error handler twice: the
    // first refetches the CURRENT inventory (a plain fetch, NOT ?refresh=1 -
    // forcing a re-mint here would kill every OTHER window's tokens and the
    // two windows would ping-pong recoveries) and remounts; the second
    // demotes video A to its preview still; manual refresh clears the
    // demotion again. The fetch snapshot keeps the first check from passing
    // off the manual-refresh call earlier in the flow (old bug: a whole-
    // history .some() made the check green no matter what the ladder did).
    const demoteVideo = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
    if (demoteVideo && demoteVideo._listeners && demoteVideo._listeners.error) {
      const fetchesBeforeError = fetchCalls.length;
      demoteVideo._listeners.error();
      await new Promise((r) => setTimeout(r, 20));
      const retryFetches = fetchCalls.slice(fetchesBeforeError);
      check('first error refetches the inventory WITHOUT forcing a re-mint',
        retryFetches.length > 0 && !retryFetches.some((u) => u.includes('refresh=1')),
        JSON.stringify(retryFetches));
      const remounted = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
      check('first error remounts a fresh element',
        Boolean(remounted) && remounted !== demoteVideo,
        remounted && remounted.tagName);
      if (remounted && remounted._listeners && remounted._listeners.error) {
        remounted._listeners.error();
        await new Promise((r) => setTimeout(r, 20));
        const after = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
        check('second failure demotes to the preview still (non-decode shape)',
          after && after.tagName === 'IMG' && /\/preview\//.test(after.src || ''),
          after && after.tagName + ' ' + (after.src || ''));
        check('demotion flagged in the status row',
          JSON.stringify(pickerRenders[0]()).includes('媒体无法解码'));
        // Manual refresh retries the video (demotion cleared).
        const treeAfter = pickerRenders[0]();
        const refreshAgain = collectButtons(treeAfter).find((b) =>
          Array.isArray(b.children) && b.children.includes('刷新'));
        if (refreshAgain) {
          refreshAgain.props.onClick();
          await new Promise((r) => setTimeout(r, 20));
          const revived = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
          check('manual refresh clears the demotion and retries the video',
            revived && revived.tagName === 'VIDEO', revived && revived.tagName);

      // Zero-decoded-frames path: the element claims to play (no error
      // event) but decodes nothing - the HEVC-black-screen case. Manual
      // refresh above reset the failure ladder, so this runs it again
      // from the top: hit 1 recovers (fresh remount), hit 2 marks the
      // entry undecodable and hides it.
      {
        const zf = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
        check('zero-frame probe listener attached to playing',
          Boolean(zf && zf._listeners && zf._listeners.playing));
        if (zf && zf._listeners && zf._listeners.playing) {
          zf.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 });
          zf.paused = false;
          zf.currentTime = 3;
          // Hit 1 (count 1): recovers by remounting a FRESH video element,
          // so round 2 must fire on the new element - the stale-guard on
          // the probe rejects the old one by design.
          zf._listeners.playing();
          const probe1 = timers.find((t) => !t.cleared && t.ms === 2000 && !t.fired);
          check('zero-frame probe scheduled 2s after playing', Boolean(probe1));
          if (probe1) probe1.fn();
          const zf2 = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
          check('zero-frame hit 1 remounts a fresh video element',
            Boolean(zf2 && zf2.tagName === 'VIDEO' && zf2 !== zf),
            zf2 && zf2.tagName);
          zf2.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 });
          zf2.paused = false;
          zf2.currentTime = 3;
          zf2._listeners.playing();
          const probe2 = timers.find((t) => !t.cleared && t.ms === 2000 && !t.fired);
          check('zero-frame probe 2 scheduled on the remounted element', Boolean(probe2));
          if (probe2) probe2.fn();
          // The hit-1 recovery is still refreshing the inventory here, so the
          // toolbar renders its "refreshing" label; match the prefix and click
          // through it (the handler is the same onRefresh).
          const clearedLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
          const cleared = clearedLayer && clearedLayer.children[0];
          check('zero-decoded-frames playing hides the entry instead of demoting',
            !cleared, cleared && cleared.tagName);
          const gridAfterHide = pickerRenders[0]();
          check('undecodable wallpaper leaves the grid',
            !cardByTitle(collectButtons(gridAfterHide), 'Video A'));
          const refreshAfterHide = collectButtons(gridAfterHide).find((b) => {
            const text = Array.isArray(b.children) ? b.children.join('') : String(b.children || '');
            return text.startsWith('刷新');
          });
          check('refresh still present after hiding an entry', Boolean(refreshAfterHide));
          if (refreshAfterHide) {
            refreshAfterHide.props.onClick();
            await new Promise((r) => setTimeout(r, 20));
            // The verdict is bound to the file's fingerprint: an unchanged
            // file stays hidden across refreshes instead of replaying the
            // same failure every time the user asks for fresh inventory.
            check('refresh keeps the undecodable entry hidden',
              !cardByTitle(collectButtons(pickerRenders[0]()), 'Video A'));
          }
          // The hide removed the layer; pick a healthy wallpaper so the
          // clear/fade checks below still have something to tear down.
          const healthyCard = cardByTitle(collectButtons(pickerRenders[0]()), 'Web B');
          check('healthy wallpapers survive the refresh', Boolean(healthyCard));
          if (healthyCard) {
            healthyCard.props.onClick();
            drainShortTimers();
          }
        }
      }
        }
      }
    }

    // Clear: graceful fade — scrim/attr outlive the layer until the fade ends.
    const closeCard = cards.find((b) => b.props.title === '关闭壁纸');
    check('close card present', Boolean(closeCard));
    if (closeCard) {
      closeCard.props.onClick();
      check('clear keeps scrim during fade-out', Boolean(documentMock.getElementById('wallpaper-engine-dsh-scrim')));
      check('clear keeps body attribute during fade-out', bodyEl.attributes['data-webg-wallpaper'] === 'on');
      check('clear marks the layer leaving',
        documentMock.querySelectorAll('.webg-layer').some((l) => l._classes.has('webg-layer--leave')));
      const leaveTimers = timers.filter((t) => !t.cleared && t.ms < 1000);
      leaveTimers.forEach((t) => { if (!t.cleared) t.fn(); });
      check('clear removes all layers after fade', documentMock.querySelectorAll('.webg-layer').length === 0);
      check('clear removes scrim after fade', !documentMock.getElementById('wallpaper-engine-dsh-scrim'));
      check('clear removes body attribute after fade', bodyEl.attributes['data-webg-wallpaper'] === undefined);
      // Rotation stays enabled with a ≥2-wallpaper list, but the timer is
      // disarmed once the selection is cleared — the status row must stop
      // claiming "auto-rotating" for a tick that will never come.
      check('cleared wallpaper stops the auto-rotating claim',
        !JSON.stringify(pickerRenders[0]()).includes('自动轮转中'));
    }

    // ── Rotation honesty + the preview-less failure path ──
    // Switching the active list to one holding a single usable wallpaper
    // plays that wallpaper but must not claim auto-rotation (the timer arms
    // at 2+). A playable entry WITHOUT a preview that fails to decode twice
    // clears the selection — never a dead element left on the layer.
    {
      check('armed rotation is reported as auto-rotating',
        JSON.stringify(tree).includes('自动轮转中'));
      const playlistSelect = collectSelects(tree).find((s) =>
        String(s.props.className || '').includes('webg-playlist-select'));
      check('playlist select present', Boolean(playlistSelect));
      if (playlistSelect) {
        playlistSelect.props.onChange({ target: { value: 'g2' } });
        check('lone-wallpaper list plays that wallpaper',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'c');
        check('disarmed rotation is not claimed as auto-rotating',
          !JSON.stringify(pickerRenders[0]()).includes('自动轮转中'));

        const brokenLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
        const brokenVideo = brokenLayer && brokenLayer.querySelector('video');
        check('preview-less video mounted for the lone wallpaper',
          Boolean(brokenVideo) && /tokC-/.test(String(brokenVideo.src || '')));
        if (brokenVideo && brokenVideo._listeners && brokenVideo._listeners.error) {
          brokenVideo._listeners.error(); // first failure → retry with fresh tokens
          await new Promise((r) => setTimeout(r, 20));
          const remounted = documentMock.getElementById('wallpaper-engine-dsh-layer');
          const retryVideo = remounted && remounted.querySelector('video');
          check('first failure retries the live media with fresh tokens',
            Boolean(retryVideo) && /tokC-/.test(String(retryVideo.src || '')) &&
              retryVideo !== brokenVideo);
          if (retryVideo && retryVideo._listeners && retryVideo._listeners.error) {
            retryVideo._listeners.error(); // second failure, no preview → clear
            check('second failure clears the selection',
              JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === '');
            timers.filter((t) => !t.cleared && !t.fired && t.ms < 1000)
              .forEach((t) => { t.fn(); });
            check('cleared preview-less failure leaves no layer behind',
              documentMock.querySelectorAll('.webg-layer').length === 0);
          }
        }
      }
    }

    // ── Smart veil sight for web wallpapers ──
    // The sandboxed iframe's pixels are unreadable, so the wallpaper's
    // PREVIEW still is decoded through a hidden probe and drives the veil
    // floor: a near-black preview raises the light-theme white veil (and a
    // bright one the dark-theme black veil).
    {
      const webAgain = cardByTitle(collectButtons(pickerRenders[0]()), 'Web B');
      check('preview probe target re-renders in the grid', Boolean(webAgain));
      if (webAgain) {
        webAgain.props.onClick();
        const probe = documentMock.getElementById('wallpaper-engine-dsh-preview-probe');
        check('hidden preview probe mounted for the web wallpaper',
          Boolean(probe) && /\/preview\//.test(String(probe.src || '')),
          String(probe && probe.src));
        if (probe && probe._listeners && probe._listeners.load) {
          emitTheme(false);
          mockCanvasPixels = new Uint8Array(16 * 16 * 4); // black preview
          probe._listeners.load();
          check('black preview stays at the user floor (dark-pinned, no floor on the dark side)',
            bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
            bodyEl.style._props['--webg-scrim-color']);
          emitTheme(true);
          mockCanvasPixels = new Uint8Array(16 * 16 * 4).fill(255); // bright preview
          probe._listeners.load();
          check('bright preview raises the dark-theme veil to 0.5',
            bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.5)',
            bodyEl.style._props['--webg-scrim-color']);
          emitTheme(false);
          mockCanvasPixels = null;
        }
      }
    }

    // ── Transient inventory outages are NON-DESTRUCTIVE ──
    // A failed fetch must not wipe the selection, disable rotation, or fade
    // out the playing layer: the success-path bookkeeping would misread an
    // empty inventory (burn the one-time playlist seed, disarm rotation,
    // clear the persisted id). 重试 recovers in place from the same state.
    {
      failFetch = true;
      const outageTree = pickerRenders[0]();
      const outageRefresh = collectButtons(outageTree).find((b) =>
        Array.isArray(b.children) && b.children.includes('刷新'));
      check('refresh button present for the outage test', Boolean(outageRefresh));
      if (outageRefresh) {
        const outageLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
        const elBefore = outageLayer && outageLayer.children[0];
        const srcBefore = elBefore && elBefore.src;
        outageRefresh.props.onClick();
        await new Promise((r) => setTimeout(r, 20));
        const errTree = pickerRenders[0]();
        check('outage surfaces the error UI with the retry button',
          JSON.stringify(errTree).includes('未能连接 Wallpaper Engine:') &&
            collectButtons(errTree).some((b) =>
              Array.isArray(b.children) && b.children.includes('重试')));
        const outageSel = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']);
        check('outage keeps the selection', outageSel.id === 'b');
        check('outage keeps rotation enabled', outageSel.rotationEnabled === true);
        check('outage keeps the playing layer mounted',
          documentMock.querySelectorAll('.webg-layer').length === 1 &&
            documentMock.getElementById('wallpaper-engine-dsh-layer').children[0].tagName === 'IFRAME');
        failFetch = false;
        const retryBtn = collectButtons(errTree).find((b) =>
          Array.isArray(b.children) && b.children.includes('重试'));
        check('retry button is wired to the refresh action', Boolean(retryBtn));
        if (retryBtn) {
          retryBtn.props.onClick();
          await new Promise((r) => setTimeout(r, 20));
          check('retry recovers from the outage',
            !JSON.stringify(pickerRenders[0]()).includes('未能连接'));
          check('selection survives the outage and recovery',
            JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'b');
          const recoveredLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
          const recoveredEl = recoveredLayer && recoveredLayer.children[0];
          check('recovery re-mints the URL and adopts the same element',
            recoveredEl === elBefore &&
              /\/media\/tokB-\d+\//.test(String(recoveredEl && recoveredEl.src)) &&
              String(recoveredEl && recoveredEl.src) !== String(srcBefore),
            String(recoveredEl && recoveredEl.src));
          check('no leftover layers after recovery',
            documentMock.querySelectorAll('.webg-layer').length === 1);
        }
      }
      failFetch = false;
    }


    // ── Watchdog classification: the 6s first-frame watchdog follows the
    // error shape the element reports. A network error (code 2) is NOT decode
    // evidence - a host restart mid-mount must not permanently hide a good
    // wallpaper via a real fingerprint in the undecodable store. A decode-
    // shaped error (code 3) IS: the entry leaves the grid.
    {
      const dogCard = cardByTitle(collectButtons(pickerRenders[0]()), 'Clip C');
      check('Clip C available for the watchdog test', Boolean(dogCard));
      if (dogCard) {
        dogCard.props.onClick();
        await new Promise((r) => setTimeout(r, 20));
        const dogVideo = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
        check('Clip C mounts as a video', Boolean(dogVideo) && dogVideo.tagName === 'VIDEO', dogVideo && dogVideo.tagName);
        if (dogVideo) {
          // The preview-less section already burned Clip C's ladder (two
          // errors, cleared selection). A successful frame resets it.
          if (dogVideo._listeners && dogVideo._listeners.loadeddata) {
            dogVideo._listeners.loadeddata();
          }
          const fetchesBeforeDog = fetchCalls.length;
          dogVideo.error = { code: 2 };
          dogVideo.paused = false;
          const wd = [...timers].reverse().find((t) => !t.cleared && !t.fired && t.ms === 6000);
          check('watchdog timer armed for Clip C', Boolean(wd));
          if (wd) {
            wd.fn();
            await new Promise((r) => setTimeout(r, 20));
            const dogFetches = fetchCalls.slice(fetchesBeforeDog);
            check('watchdog books a NETWORK error as non-decode (plain refetch, no re-mint)',
              dogFetches.length > 0 && !dogFetches.some((u) => u.includes('refresh=1')),
              JSON.stringify(dogFetches));
            const gridAfterNetwork = pickerRenders[0]();
            check('network-shaped failure does NOT hide the entry',
              Boolean(cardByTitle(collectButtons(gridAfterNetwork), 'Clip C')));
            const dogVideo2 = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
            if (dogVideo2 && dogVideo2 !== dogVideo && dogVideo2._listeners && dogVideo2._listeners.error) {
              dogVideo2.error = { code: 3 };
              // Second hit via the error EVENT: the decode classification
              // (code 3/4 -> undecodable) is the same handleMediaFailure(sel,
              // true) call the watchdog makes, but the event timing is
              // deterministic in the sandbox (the re-armed 6s timers race).
              dogVideo2.error = { code: 3 };
              dogVideo2._listeners.error();
              await new Promise((r) => setTimeout(r, 20));
              check('decode-shaped failure (code 3) removes the entry from the grid',
                !cardByTitle(collectButtons(pickerRenders[0]()), 'Clip C'));
            }
            // Restore a selection for the downstream dispose/re-apply
            // sections (Clip C just left the grid as undecodable).
            const restoreCard = cardByTitle(collectButtons(pickerRenders[0]()), 'Web B');
            if (restoreCard) { restoreCard.props.onClick(); }
          }
        }
      }
    }
    // ── Pointer highlight: rim glint + the toggle-off lifecycle ───────────
    // The glint is edge-bound (6px top band + 4px bounce, positioned by the
    // pointer's x); unchecking must tear down listeners AND the inline
    // property unconditionally (the desync class the old !pointerBound
    // guard left open), and the move handler self-guards on the setting.
    {
      let ptrToggle = null;
      (function findPointerToggle(node) {
        if (ptrToggle || !node || typeof node !== 'object') return;
        const isPtrLabel = node.type === 'label' && node.props && typeof node.props.title === 'string' &&
          node.props.title.includes('贴边');
        if (isPtrLabel) {
          const inp = (node.children || []).find((c) => c && c.type === 'input' && c.props && c.props.type === 'checkbox');
          if (inp) { ptrToggle = inp; return; }
        }
        if (Array.isArray(node.children)) node.children.forEach(findPointerToggle);
      })(tree);
      check('pointer toggle located by its label title', Boolean(ptrToggle));
      if (ptrToggle) {
        ptrToggle.props.onChange();
        await new Promise((r) => setTimeout(r, 20));
        check('pointer toggle flips the persisted setting',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).pointerLight === true);
        composerFixture.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 116 });
        documentMock._listeners.pointermove({ clientX: 360, clientY: 20, target: { closest: () => composerFixture } });
        const glint1 = composerFixture.style._props['--webg-pointer-gloss'] || '';
        check('pointer move paints an edge-bound glint (6px top band at x%)',
          glint1.includes('6px') && glint1.includes('at 50.0% 0px') && glint1.includes('* 0.45 * 0.897'),
          glint1.slice(0, 90));
        documentMock._listeners.pointermove({ clientX: 180, clientY: 80, target: { closest: () => composerFixture } });
        const glint2 = composerFixture.style._props['--webg-pointer-gloss'] || '';
        check('glint follows the pointer (x tracks, dims as it sinks)',
          glint2.includes('at 25.0% 0px') && glint2.includes('* 0.45 * 0.586'),
          glint2.slice(0, 90));
        const savedMove = documentMock._listeners.pointermove;
        ptrToggle.props.onChange();
        await new Promise((r) => setTimeout(r, 20));
        check('unchecking flips the setting off',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).pointerLight === false);
        check('unchecking removes the inline glint',
          composerFixture.style._props['--webg-pointer-gloss'] === undefined);
        check('unchecking unbinds the document listeners',
          !documentMock._listeners.pointermove);
        if (savedMove) {
          savedMove({ clientX: 90, clientY: 30, target: { closest: () => composerFixture } });
          check('a late move after unbind paints nothing (self-guard)',
            composerFixture.style._props['--webg-pointer-gloss'] === undefined);
        }
      }
    }

    // ── i18n: default UI is Chinese; switching to English re-renders. ──
    const langSelect = collectSelects(tree).find((s) =>
      String(s.props.className || '').includes('webg-lang-select'));
    check('language selector present', Boolean(langSelect));
    check('default language is Chinese (刷新 button)', buttons.some((b) =>
      Array.isArray(b.children) && b.children.includes('刷新')));
    check('settings section nav label is the short Chinese name',
      registrations.some((r) => {
        const text = typeof r.label === 'function' ? r.label() : r.label;
        return text === '壁纸背景';
      }),
      JSON.stringify(registrations.map((r) => typeof r.label === 'function' ? r.label() : r.label)));
    if (langSelect) {
      langSelect.props.onChange({ target: { value: 'en' } });
      check('language choice persisted',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).lang === 'en');
      const enTree = pickerRenders[0]();
      const enButtons = collectButtons(enTree);
      check('switching to English renders English labels', enButtons.some((b) =>
        Array.isArray(b.children) && b.children.includes('Refresh')));
      check('Chinese labels gone after switch', !enButtons.some((b) =>
        Array.isArray(b.children) && b.children.includes('刷新')));
    }
  }

  // Dispose: every side effect unwinds. (Timers that already FIRED stay
  // cleared:false in this mock — only the still-pending one needs clearing.)
  const pendingRotation = [...timers].reverse().find((t) => t.ms === 300000);
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (e) { check('cleanup does not throw', false, e && e.message); }
  }
  check('style tag removed on dispose', !headEl.children.some((n) => n.tagName === 'STYLE'));
  check('lens svg removed on dispose', !documentMock.getElementById('wallpaper-engine-dsh-lens'));
  check('lens gate removed on dispose', bodyEl.attributes['data-webg-lens'] === undefined);
  check('all layers removed on dispose', documentMock.querySelectorAll('.webg-layer').length === 0);
  check('scrim removed on dispose', !documentMock.getElementById('wallpaper-engine-dsh-scrim'));
  const barAfterDispose = documentMock.querySelector('[class*="_pageBar"][data-natural]');
  check('header wallpaper window removed on dispose',
    !barAfterDispose.children.some((c) => c._classes && c._classes.has('webg-header-window')));
  check('body attribute removed on dispose', bodyEl.attributes['data-webg-wallpaper'] === undefined);
  check('css vars cleared on dispose', Object.keys(bodyEl.style._props).length === 0);
  check('rotation timer cleared on dispose', !pendingRotation || pendingRotation.cleared);
  check('crossfade/clear leave timers cleared on dispose',
    timers.filter((t) => !t.cleared && !t.fired && t.ms < 1000).length === 0,
    String(timers.filter((t) => !t.cleared && !t.fired && t.ms < 1000).length));

  // ── Re-apply after dispose (plugin update WITHOUT page reload) ─────────
  // The module is NOT re-evaluated on update: the old fiber's cleanup set
  // `disposed = true`, and the new fiber's loadInventory must still commit.
  // Regression guard for the 1.0.0 blank-picker bug. ctx2 intentionally
  // carries NO theme service — the client must tolerate a host without one
  // (falls back to prefers-color-scheme / last known state).
  const cleanups2 = [];
  const pickerRenders2 = [];
  const ctx2 = {
    slots: {
      inject: (key, cb) => cb(),
      register: (opts, render) => { pickerRenders2.push(render); },
    },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups2.push(cleanup); },
  };
  let reapplied = false;
  try { exportsObj.apply(ctx2); reapplied = true; } catch (e) { /* asserted below */ }
  check('re-apply after dispose does not throw', reapplied);
  await new Promise((r) => setTimeout(r, 40));
  const tree2 = pickerRenders2.length ? pickerRenders2[0]() : null;
  check('re-applied fiber loads the inventory (no eternal scanning)',
    Boolean(tree2) && !JSON.stringify(tree2).includes('正在扫描'),
    pickerRenders2.length ? 'rendered' : 'no render registered');
  check('re-applied fiber re-mounts the wallpaper',
    documentMock.querySelectorAll('.webg-layer').length >= 1);
  for (const cleanup of cleanups2) {
    try { cleanup(); } catch { /* second dispose asserted no-throw above pattern */ }
  }

  console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, 60);
