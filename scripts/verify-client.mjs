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
 *   - web wallpapers keep crop-adjust but not the object-fit select
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
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributes, k); },
    removeAttribute(k) { if (k === 'id') el._id = ''; delete el.attributes[k]; },
    // Record the last listener per type so tests can fire real handlers
    // (adjust-overlay Done button, pointer pan, keydown Esc).
    addEventListener(type, fn) { el._listeners = el._listeners || {}; el._listeners[type] = fn; },
    removeEventListener(type) { if (el._listeners) delete el._listeners[type]; },
    contains(node) { return walkAll(el, []).includes(node); },
    play() { el.playCalled = (el.playCalled || 0) + 1; return { catch() {} }; },
    pause() { el.pauseCalled = (el.pauseCalled || 0) + 1; },
    ...(tag.toLowerCase() === 'canvas' ? {
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: mockCanvasPixels || new Uint8Array(0) }),
      }),
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
  _listeners: {},
  addEventListener(type, fn) { this._listeners[type] = fn; },
  removeEventListener(type) { delete this._listeners[type]; },
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
      border: 1, // persisted at the slider's ceiling edge
      rotationGroups: [
        { id: 'g1', name: 'My list', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b'] },
        { id: 'g2', name: 'Solo', interval: 5, order: 'sequence', wallpaperIds: ['c'] },
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
      installDir: 'D:/we', total: 3, portableCount: 3,
      playlists: [
        { id: 'pl-0', name: 'WE playlist', order: 'sequence', delay: null, wallpaperIds: ['a', 'b'], total: 2, portableCount: 2 },
      ],
      wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, media: `/we-background/media/tokA-${n}`, preview: `/we-background/preview/pA-${n}` },
        { id: 'b', title: 'Web B', type: 'web', playable: true, media: `/we-background/media/tokB-${n}/index.html`, preview: `/we-background/preview/pB-${n}` },
        // Playable but preview-less — the decode-failure path for it must
        // end in a cleared selection, not a dead element on the layer.
        { id: 'c', title: 'Clip C', type: 'video', playable: true, media: `/we-background/media/tokC-${n}`, preview: null },
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
}
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
  // The veil OPPOSES the text colour: light theme (dark text) veils WHITE,
  // dark theme (light text) veils BLACK — readable over any wallpaper.
  check('scrim veil is white in light theme', props['--webg-scrim-color'] === 'rgba(255,255,255,0.25)',
    props['--webg-scrim-color']);
  check('glass blur css var default', props['--webg-blur'] === '16px', props['--webg-blur']);
  check('media filter is none at zero blur (bit-exact pixels)', props['--webg-media-filter'] === 'none',
    props['--webg-media-filter']);
  check('noise overlay hidden at zero blur', props['--webg-noise-display'] === 'none',
    props['--webg-noise-display']);

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
    {
      const webCard = cardByTitle(cards, 'Web B');
      check('web card found in the grid', Boolean(webCard));
      if (webCard) {
        webCard.props.onClick();
        let settle = [...timers].reverse().find((t) => !t.cleared && !t.fired && t.ms < 1000);
        if (settle) settle.fn();
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
          settle = [...timers].reverse().find((t) => !t.cleared && !t.fired && t.ms < 1000);
          if (settle) settle.fn();
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
      bodyEl.setAttribute('data-ds-dark-theme', '');
      scrimSlider.props.onChange({ target: { value: '25', style: { setProperty() {} } } });
      check('veil flips to black in dark theme',
        bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
        bodyEl.style._props['--webg-scrim-color']);
      bodyEl.removeAttribute('data-ds-dark-theme');
      scrimSlider.props.onChange({ target: { value: '25', style: { setProperty() {} } } });
      check('veil returns to white in light theme',
        bodyEl.style._props['--webg-scrim-color'] === 'rgba(255,255,255,0.25)');

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
    }

    // Smart veil math: fire the media's loadeddata so the sampler runs over
    // the fake canvas pixels. Luminance 1.0 (white) in dark theme needs a
    // 0.5 floor → alpha = max(user 0.25, 0.5); a black frame needs none.
    {
      const liveVideo = documentMock.getElementById('wallpaper-engine-dsh-layer') &&
        documentMock.getElementById('wallpaper-engine-dsh-layer').querySelector('video');
      check('video carries a loadeddata sampler hook',
        Boolean(liveVideo && liveVideo._listeners && liveVideo._listeners.loadeddata));
      if (liveVideo && liveVideo._listeners && liveVideo._listeners.loadeddata) {
        const white = new Uint8Array(16 * 16 * 4).fill(255);
        const black = new Uint8Array(16 * 16 * 4); // zeros
        bodyEl.setAttribute('data-ds-dark-theme', '');
        mockCanvasPixels = white;
        liveVideo._listeners.loadeddata();
        check('bright frame raises the dark-theme veil floor to 0.5',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.5)',
          bodyEl.style._props['--webg-scrim-color']);
        mockCanvasPixels = black;
        liveVideo._listeners.loadeddata();
        check('dark frame needs no floor (user scrim stands)',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.25)',
          bodyEl.style._props['--webg-scrim-color']);
        bodyEl.removeAttribute('data-ds-dark-theme');
        liveVideo._listeners.loadeddata();
        check('dark frame in LIGHT theme raises the white veil to 0.5',
          bodyEl.style._props['--webg-scrim-color'] === 'rgba(255,255,255,0.5)',
          bodyEl.style._props['--webg-scrim-color']);
        mockCanvasPixels = null;
      }
    }

    // Smart veil toggle present in the monitor row.
    check('smart veil toggle present', JSON.stringify(tree).includes('智能可视'));

    // Decode-failure demotion: fire the video's error handler twice → the
    // first triggers a token refresh+remount, the second demotes video A to
    // its preview still; manual refresh clears the demotion again.
    const demoteVideo = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
    if (demoteVideo && demoteVideo._listeners && demoteVideo._listeners.error) {
      demoteVideo._listeners.error();
      await new Promise((r) => setTimeout(r, 20));
      check('first decode error triggers a token refresh+remount',
        fetchCalls.some((u) => u.includes('refresh=1')));
      const remounted = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
      if (remounted && remounted._listeners && remounted._listeners.error) {
        remounted._listeners.error();
        await new Promise((r) => setTimeout(r, 20));
        const after = documentMock.getElementById('wallpaper-engine-dsh-layer').children[0];
        check('second decode error demotes to the preview still',
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
          bodyEl.removeAttribute('data-ds-dark-theme');
          mockCanvasPixels = new Uint8Array(16 * 16 * 4); // black preview
          probe._listeners.load();
          check('black preview raises the light-theme veil to 0.5',
            bodyEl.style._props['--webg-scrim-color'] === 'rgba(255,255,255,0.5)',
            bodyEl.style._props['--webg-scrim-color']);
          bodyEl.setAttribute('data-ds-dark-theme', '');
          mockCanvasPixels = new Uint8Array(16 * 16 * 4).fill(255); // bright preview
          probe._listeners.load();
          check('bright preview raises the dark-theme veil to 0.5',
            bodyEl.style._props['--webg-scrim-color'] === 'rgba(0,0,0,0.5)',
            bodyEl.style._props['--webg-scrim-color']);
          bodyEl.removeAttribute('data-ds-dark-theme');
          mockCanvasPixels = null;
        }
      }
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

  // ── Re-apply after dispose (plugin update WITHOUT page reload) ─────────
  // The module is NOT re-evaluated on update: the old fiber's cleanup set
  // `disposed = true`, and the new fiber's loadInventory must still commit.
  // Regression guard for the 1.0.0 blank-picker bug.
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
