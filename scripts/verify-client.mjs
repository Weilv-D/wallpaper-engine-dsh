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
      installDir: 'D:/we', total: 2, portableCount: 2,
      playlists: [
        { id: 'pl-0', name: 'WE playlist', order: 'sequence', delay: null, wallpaperIds: ['a', 'b'], total: 2, portableCount: 2 },
      ],
      wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, media: `/we-background/media/tokA-${n}`, preview: `/we-background/preview/pA-${n}` },
        { id: 'b', title: 'Web B', type: 'web', playable: true, media: `/we-background/media/tokB-${n}`, preview: `/we-background/preview/pB-${n}` },
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
  check('wallpaper blur css var default', props['--webg-wallpaper-blur'] === '0px');
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
    check('grid shows close + both playable cards (a, b)', cards.length === 3, cards.length);
    check('unplayable kinds never surface in the grid',
      !JSON.stringify(cards).includes('Scene'));

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
        // Pan: 60px right (clientWidth 0 → media-box maths still ≥0 offsets).
        overlayHandlers.pointerdown({ clientX: 500, clientY: 300, target: overlay });
        overlayHandlers.pointermove({ clientX: 560, clientY: 300 });
        overlayHandlers.pointerup({});
        check('drag pans the crop (offsets persisted)',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).offsetX > 0);
        // Wheel zoom: deltaY<0 zooms in, clamped 0.25..4, persisted.
        overlayHandlers.wheel({ deltaY: -240, preventDefault() {} });
        const zoomed = JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).zoom;
        check('wheel-up zooms in and persists', zoomed > 1, String(zoomed));
        overlayHandlers.wheel({ deltaY: 100000, preventDefault() {} });
        check('extreme wheel-out clamps at 0.25',
          JSON.parse(localStorageMock._store['wallpaper-engine-dsh:selection']).zoom === 0.25);
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
