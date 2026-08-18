/**
 * verify-client.mjs — smoke-verify the EMITTED bundle (lib/client.js).
 *
 * Boots the real artifact in a node:vm sandbox under the DSH module-loader
 * contract, drives apply() with a mock slots/effect context, and asserts the
 * behavioural contract end to end:
 *   - module envelope (id, exports, Symbol.toStringTag)
 *   - settings.general.item slot registration
 *   - style tag lifecycle (injected on apply, REMOVED on dispose)
 *   - wallpaper + scrim layers under <body>, body attribute, CSS variables
 *   - web wallpapers get a sandboxed iframe (allow-scripts only)
 *   - scene wallpapers with a preview render as a static <img>
 *   - scene wallpapers without a preview stay unselectable
 *   - refresh does NOT remount the playing wallpaper (token churn tolerated)
 *   - crossfade keeps two layers until the leave timer settles
 *   - clearing fades out gracefully (scrim outlives the layer until the fade
 *     completes) instead of tearing everything down instantly
 *   - rotation timer advances and wraps within the user-defined group
 *   - 刷新 calls /we-background/inventory?refresh=1
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
    appendChild(c) { el.children.push(c); c._parent = el; return c; },
    remove() {
      const p = el._parent;
      if (p) {
        const i = p.children.indexOf(el);
        if (i >= 0) p.children.splice(i, 1);
        el._parent = null;
      }
    },
    setAttribute(k, v) { el.attributes[k] = String(v); },
    removeAttribute(k) { if (k === 'id') el._id = ''; delete el.attributes[k]; },
    addEventListener() {},
    removeEventListener() {},
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
      return all.filter((n) => n.tagName === tagName);
    },
  };
  return el;
}

const headEl = makeEl('head');
const bodyEl = makeEl('body');
const documentMock = {
  createElement: (t) => makeEl(t),
  getElementById: (id) =>
    walkAll(bodyEl, []).concat(walkAll(headEl, [])).find((n) => n._id === id) || null,
  querySelector: (sel) => {
    if (sel.startsWith('style')) {
      return headEl.children.find((n) => n.tagName === 'STYLE') || null;
    }
    return bodyEl.querySelector(sel);
  },
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
  head: headEl,
  body: bodyEl,
};

const timers = [];
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
      rotationGroups: [
        { id: 'g1', name: 'My list', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b', 'c'] },
      ],
      rotationSeeded: true,
    }),
  },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = String(v); },
};

// Token churn: every fetch hands out FRESH media URLs (as the host does when
// it re-mints tokens on each inventory rebuild), so the test can prove the
// client does not reload the playing wallpaper just because URLs changed.
let fetchCount = 0;
const fetchCalls = [];
const fetchMock = (url) => {
  fetchCalls.push(String(url));
  const n = ++fetchCount;
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      installDir: 'D:/we', total: 4, portableCount: 2,
      playlists: [
        { id: 'pl-0', name: 'WE playlist', order: 'sequence', delay: null, wallpaperIds: ['a', 'b'], total: 2, portableCount: 2 },
      ],
      wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, media: `/we-background/media/tokA-${n}`, preview: null },
        { id: 'b', title: 'Web B', type: 'web', playable: true, media: `/we-background/media/tokB-${n}`, preview: null },
        { id: 'c', title: 'Scene C', type: 'scene', playable: false, media: null, preview: null },
        { id: 'd', title: 'Scene D', type: 'scene', playable: false, media: null, preview: `/we-background/preview/tokD-${n}` },
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
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

check('module registered with __ModuleLoader__', cap.handoff && cap.handoff.id === 'wallpaper-engine-dsh', cap.handoff && cap.handoff.id);

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
check('inject declares slots', JSON.stringify(exportsObj.inject) === '["slots"]');
check('Symbol.toStringTag is Module', Object.prototype.toString.call(exportsObj) === '[object Module]');

// ── apply() with a mock Cordis ctx ──────────────────────────────────────────
const registrations = [];
const cleanups = [];
const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => {
    registrations.push({ key: opts.name, id: opts.id, label: opts.label, order: opts.order });
    pickerRenders.push(render);
  },
};
const ctx = {
  slots,
  effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
};

let thrown = null;
try { exportsObj.apply(ctx); } catch (e) { thrown = e && e.stack || e; }
check('apply() does not throw', !thrown, thrown);
check('registers settings.general.item row',
  registrations.some((r) => r.key === 'settings.general.item' && r.id === 'we-background'),
  JSON.stringify(registrations));
check('style tag injected on apply', headEl.children.some((n) => n.tagName === 'STYLE'));
check('initial fetch hits inventory', fetchCalls.includes('/we-background/inventory'), fetchCalls.join(','));

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

  const props = bodyEl.style._props;
  check('scrim css var default', props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)', props['--webg-scrim-color']);
  check('glass blur css var default', props['--webg-blur'] === '16px', props['--webg-blur']);
  check('wallpaper blur css var default', props['--webg-wallpaper-blur'] === '0px');

  // Rotation: 5-minute timer from the group, fires → 'b' (web wallpaper).
  const rotationTimer = timers.find((t) => !t.cleared && t.ms === 300000);
  check('rotation timer scheduled (5 min)', Boolean(rotationTimer));
  if (rotationTimer) {
    rotationTimer.fn();
    check('rotation advanced to web wallpaper b',
      JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'b');

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

    const leaveTimer = [...timers].reverse().find((t) => !t.cleared && t.ms < 1000);
    if (leaveTimer) leaveTimer.fn();
    check('leaving layer removed after crossfade', documentMock.querySelectorAll('.webg-layer').length === 1);

    const wrapTimer = [...timers].reverse().find((t) => !t.cleared && t.ms === 300000);
    if (wrapTimer) {
      wrapTimer.fn();
      check('rotation wraps back to a',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'a');
      // Settle the b→a crossfade so later layer-count checks start clean.
      const wrapLeave = [...timers].reverse().find((t) => !t.cleared && t.ms < 1000);
      if (wrapLeave) wrapLeave.fn();
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
    check('grid shows close + 3 usable cards (a, b, static d)', cards.length === 4, cards.length);
    check('scene wallpaper without preview stays unselectable', !JSON.stringify(cards).includes('Scene C'));
    check('scene wallpaper with preview is selectable (静态)',
      cards.some((b) => b.props.title === 'Scene D(静态)'));

    // Refresh: inventory rebuilds hand out fresh tokens, but the playing
    // wallpaper must NOT remount (same id → same layer element).
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
      check('media src kept across refresh (no reload)', layerAfter.children[0].src === srcBeforeRefresh,
        `${srcBeforeRefresh} → ${layerAfter.children[0].src}`);
      check('no leftover leaving layers after refresh', documentMock.querySelectorAll('.webg-layer').length === 1);
    }

    // Canvas fit/position controls (video wallpaper → row is rendered).
    const fitSelect = collectSelects(tree).find((s) =>
      String(s.props.className || '').includes('webg-fit-select'));
    const posSelect = collectSelects(tree).find((s) =>
      String(s.props.className || '').includes('webg-position-select'));
    check('fit + position selects present for video wallpaper', Boolean(fitSelect && posSelect));
    check('fit defaults to cover', bodyEl.style._props['--webg-fit'] === 'cover',
      bodyEl.style._props['--webg-fit']);
    check('position defaults to center', bodyEl.style._props['--webg-position'] === 'center',
      bodyEl.style._props['--webg-position']);
    if (fitSelect) {
      fitSelect.props.onChange({ target: { value: 'contain' } });
      check('fit switch applies immediately', bodyEl.style._props['--webg-fit'] === 'contain',
        bodyEl.style._props['--webg-fit']);
      check('fit persisted',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).fit === 'contain');
    }
    if (posSelect) {
      posSelect.props.onChange({ target: { value: 'top' } });
      check('position switch applies immediately', bodyEl.style._props['--webg-position'] === 'top',
        bodyEl.style._props['--webg-position']);
    }

    // Static wallpaper: selecting scene D renders its preview as an <img>.
    const staticCard = cards.find((b) => b.props.title === 'Scene D(静态)');
    if (staticCard) {
      staticCard.props.onClick();
      const staticLayer = documentMock.getElementById('wallpaper-engine-dsh-layer');
      const img = staticLayer && staticLayer.children[0];
      check('static wallpaper renders as an image', img && img.tagName === 'IMG', img && img.tagName);
      check('static wallpaper uses the preview url', img && /\/preview\//.test(img.src || ''), img && img.src);
      check('static image carries no sandbox/iframe semantics', img && !img.attributes.sandbox);
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
    }

    // ── i18n: default UI is Chinese; switching to English re-renders. ──
    const langSelect = collectSelects(tree).find((s) =>
      String(s.props.className || '').includes('webg-lang-select'));
    check('language selector present', Boolean(langSelect));
    check('default language is Chinese (刷新 button)', buttons.some((b) =>
      Array.isArray(b.children) && b.children.includes('刷新')));
    check('settings row label is Chinese',
      registrations.some((r) => r.label === '壁纸背景 (Wallpaper Engine)'),
      JSON.stringify(registrations.map((r) => r.label)));
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
  check('four fiber effects registered (style/layers/visibility/fps)', cleanups.length === 4, cleanups.length);
  const pendingRotation = [...timers].reverse().find((t) => t.ms === 300000);
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (e) { check('cleanup does not throw', false, e && e.message); }
  }
  check('style tag removed on dispose', !headEl.children.some((n) => n.tagName === 'STYLE'));
  check('all layers removed on dispose', documentMock.querySelectorAll('.webg-layer').length === 0);
  check('scrim removed on dispose', !documentMock.getElementById('wallpaper-engine-dsh-scrim'));
  check('body attribute removed on dispose', bodyEl.attributes['data-webg-wallpaper'] === undefined);
  check('css vars cleared on dispose', Object.keys(bodyEl.style._props).length === 0);
  check('rotation timer cleared on dispose', !pendingRotation || pendingRotation.cleared);
  check('crossfade/clear leave timers cleared on dispose',
    timers.filter((t) => !t.cleared && !t.fired && t.ms < 1000).length === 0,
    String(timers.filter((t) => !t.cleared && !t.fired && t.ms < 1000).length));

  console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, 60);
