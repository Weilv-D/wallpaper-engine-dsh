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
 *   - crossfade keeps two layers until the leave timer settles
 *   - rotation timer advances and wraps within the user-defined group
 *   - scene wallpapers never appear in the picker grid
 *   - 刷新 calls /we-background/inventory?refresh=1
 *   - dispose tears down every layer, the scrim, timers and effects
 *
 * Exits non-zero on the first failed assertion class (CI-friendly).
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
    // Only style-tag lookups are used; head has at most the one we inject.
    if (sel.startsWith('style')) {
      return headEl.children.find((n) => n.tagName === 'STYLE') || null;
    }
    return bodyEl.querySelector(sel);
  },
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  head: headEl,
  body: bodyEl,
};

const timers = [];
const windowMock = {
  __ModuleLoader__: null, // installed below
  matchMedia: () => ({ matches: false }),
  setTimeout: (fn, ms) => {
    const token = { fn, ms, cleared: false };
    timers.push(token);
    return token;
  },
  clearTimeout: (token) => { if (token) token.cleared = true; },
  confirm: () => true,
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

const fetchCalls = [];
const fetchMock = (url) => {
  fetchCalls.push(String(url));
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      installDir: 'D:/we', total: 3, portableCount: 2,
      playlists: [
        { id: 'pl-0', name: 'WE playlist', order: 'sequence', delay: null, wallpaperIds: ['a', 'b'], total: 2, portableCount: 2 },
      ],
      wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, media: '/we-background/media/tokA', preview: null },
        { id: 'b', title: 'Web B', type: 'web', playable: true, media: '/we-background/media/tokB', preview: null },
        { id: 'c', title: 'Scene C', type: 'scene', playable: false, media: null, preview: null },
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

// ── Async assertions after the inventory resolves ───────────────────────────
setTimeout(async () => {
  const layer = documentMock.getElementById('wallpaper-engine-dsh-layer');
  check('wallpaper layer mounted under body', Boolean(layer));
  const media = layer && layer.children[0];
  check('video element for a video wallpaper', media && media.tagName === 'VIDEO', media && media.tagName);
  check('video is muted + looping', Boolean(media && media.muted && media.loop));
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

    // Crossfade: the old layer is leaving, the new one holds the id.
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

    const leaveTimer = timers.find((t) => !t.cleared && t.ms < 1000);
    if (leaveTimer) leaveTimer.fn();
    check('leaving layer removed after crossfade', documentMock.querySelectorAll('.webg-layer').length === 1);

    const wrapTimer = timers.find((t) => !t.cleared && t.ms === 300000);
    if (wrapTimer) {
      wrapTimer.fn();
      check('rotation wraps back to a',
        JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).id === 'a');
    }
  }

  // Picker: renders, scene wallpaper excluded, refresh hits ?refresh=1.
  check('picker render function registered', pickerRenders.length > 0);
  if (pickerRenders.length) {
    let renderError = null;
    let tree = null;
    try { tree = pickerRenders[0](); } catch (e) { renderError = e && e.stack || e; }
    check('picker renders without throwing', !renderError, renderError);
    if (tree) {
      const buttons = [];
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        if (node.type === 'button') buttons.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree);
      const cards = buttons.filter((b) => String(b.props.className || '').startsWith('webg-card'));
      check('grid shows close + 2 playable cards', cards.length === 3, cards.length);
      check('scene wallpaper excluded from grid', !JSON.stringify(cards).includes('Scene C'));

      const refreshBtn = buttons.find((b) =>
        Array.isArray(b.children) && b.children.includes('刷新'));
      check('refresh button present', Boolean(refreshBtn));
      if (refreshBtn) {
        refreshBtn.props.onClick();
        await new Promise((r) => setTimeout(r, 20));
        check('refresh forces host rebuild (?refresh=1)',
          fetchCalls.some((u) => u.includes('refresh=1')),
          fetchCalls.join(','));
      }
    }
  }

  // Dispose: every side effect unwinds. (Timers that already FIRED stay
  // cleared:false in this mock — only the still-pending one needs clearing.)
  check('two fiber effects registered (style + layers)', cleanups.length === 2, cleanups.length);
  const pendingRotation = [...timers].reverse().find((t) => t.ms === 300000);
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (e) { check('cleanup does not throw', false, e && e.message); }
  }
  check('style tag removed on dispose', !headEl.children.some((n) => n.tagName === 'STYLE'));
  check('all layers removed on dispose', documentMock.querySelectorAll('.webg-layer').length === 0);
  check('scrim removed on dispose', !documentMock.getElementById('wallpaper-engine-dsh-scrim'));
  check('body attribute removed on dispose', bodyEl.attributes['data-webg-wallpaper'] === undefined);
  check('css vars cleared on dispose', Object.keys(bodyEl.style._props).length === 0);
  check('rotation timer cleared on dispose', pendingRotation && pendingRotation.cleared);

  console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, 60);
