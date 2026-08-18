window.__ModuleLoader__.load({
	id: "wallpaper-engine-dsh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		const SETTINGS_KEY = "wallpaper-engine-dsh:selection";
		const INVENTORY_URL = "/we-background/inventory";
		const ACTIVE_ATTR = "data-webg-wallpaper";
		const LAYER_ID = "wallpaper-engine-dsh-layer";
		const SCRIM_ID = "wallpaper-engine-dsh-scrim";
		const STYLE_TAG_ID = "wallpaper-engine-dsh/styles";
		const CROSSFADE_MS = 520;

		// Respect the OS "reduce motion" preference: start paused rather than
		// autoplaying a video loop at someone who asked for less motion.
		const REDUCED_MOTION = typeof window !== "undefined" &&
		  typeof window.matchMedia === "function" &&
		  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		// ── Defaults ─────────────────────────────────────────────────────────────────
		const DEFAULTS = {
		  scrim: 0.25,
		  border: 0.35,
		  blur: 16,
		  wallpaperBlur: 0,
		  rotationEnabled: false,
		  rotationInterval: 30,
		  rotationGroupId: "",
		  rotationGroups: [],
		  rotationSeeded: false,
		};

		// ── Persisted selection ─────────────────────────────────────────────────────
		function clampNum(v, lo, hi, fallback) {
		  return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : fallback;
		}

		// Rotation groups are user-defined carousel lists: each holds wallpaper ids
		// picked from the inventory, its own switch interval (minutes) and order.
		// Fully client-side (localStorage) — rotation never depends on Wallpaper
		// Engine's own config.json playlist paths.
		function readRotationGroups(raw) {
		  if (!Array.isArray(raw)) return [];
		  const groups = [];
		  for (const g of raw) {
		    if (!g || typeof g !== "object") continue;
		    const id = typeof g.id === "string" && g.id ? g.id : "";
		    if (!id) continue;
		    groups.push({
		      id,
		      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : "轮播列表",
		      interval: clampNum(g.interval, 1, 1440, DEFAULTS.rotationInterval),
		      order: g.order === "random" ? "random" : "sequence",
		      wallpaperIds: Array.isArray(g.wallpaperIds)
		        ? g.wallpaperIds.filter((x) => typeof x === "string" && x)
		        : [],
		    });
		  }
		  return groups;
		}

		function readPersisted() {
		  try {
		    const raw = localStorage.getItem(SETTINGS_KEY);
		    if (!raw) return { id: "", ...DEFAULTS };
		    const o = JSON.parse(raw);
		    return {
		      id: typeof o.id === "string" ? o.id : "",
		      scrim: clampNum(o.scrim, 0, 1, DEFAULTS.scrim),
		      border: clampNum(o.border, 0, 1, DEFAULTS.border),
		      blur: clampNum(o.blur, 0, 40, DEFAULTS.blur),
		      wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
		      rotationEnabled: o.rotationEnabled === true,
		      rotationGroupId: typeof o.rotationGroupId === "string" ? o.rotationGroupId : "",
		      rotationGroups: readRotationGroups(o.rotationGroups),
		      rotationSeeded: o.rotationSeeded === true,
		    };
		  } catch {
		    return { id: "", ...DEFAULTS };
		  }
		}

		// ── Shared selection store (React picker + DOM layer both read it) ──────────
		const selection = {
		  ...readPersisted(),
		  url: null,
		  type: null,
		  playing: !REDUCED_MOTION,
		  loading: false,
		  rotationTimer: null,
		  // Live draft of the group being created/edited (null when editor closed).
		  editing: null,
		  inventory: { installDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
		  loaded: false,
		};

		const listeners = new Set();
		function emit() { for (const fn of [...listeners]) fn(); }
		function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

		function useStore() {
		  const [, setTick] = React.useState(0);
		  React.useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
		  return selection;
		}

		function persistSelection() {
		  try {
		    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
		      id: selection.id,
		      scrim: selection.scrim,
		      border: selection.border,
		      blur: selection.blur,
		      wallpaperBlur: selection.wallpaperBlur,
		      rotationEnabled: selection.rotationEnabled,
		      rotationGroupId: selection.rotationGroupId,
		      rotationGroups: selection.rotationGroups,
		      rotationSeeded: selection.rotationSeeded,
		    }));
		  } catch { /* storage full / blocked → session-only state, not fatal */ }
		}

		// ── Inventory ────────────────────────────────────────────────────────────────
		async function loadInventory(forceRefresh) {
		  selection.loading = true;
		  emit();
		  try {
		    const res = await fetch(forceRefresh ? INVENTORY_URL + "?refresh=1" : INVENTORY_URL, { cache: "no-store" });
		    if (!res.ok) throw new Error("inventory HTTP " + res.status);
		    const data = await res.json();
		    selection.inventory = {
		      installDir: data.installDir || null,
		      wallpapers: Array.isArray(data.wallpapers) ? data.wallpapers : [],
		      total: data.total || 0,
		      portableCount: data.portableCount || 0,
		      playlists: Array.isArray(data.playlists) ? data.playlists : [],
		      error: null,
		    };
		  } catch (err) {
		    selection.inventory = {
		      installDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [],
		      error: String(err && err.message ? err.message : err),
		    };
		  }
		  selection.loading = false;
		  selection.loaded = true;

		  // Seed a first rotation group from a playable WE playlist (once only, so
		  // deleting every list stays respected across reloads).
		  if (!selection.rotationGroups.length && !selection.rotationSeeded) {
		    selection.rotationSeeded = true;
		    seedGroupsFromPlaylists();
		    persistSelection();
		  }
		  if (selection.rotationGroupId && !activeRotationGroup()) {
		    selection.rotationGroupId = "";
		    persistSelection();
		  }
		  if (selection.rotationEnabled) {
		    if (!selection.rotationGroupId) {
		      const usable = firstUsableGroup();
		      if (usable) selection.rotationGroupId = usable.id;
		      else selection.rotationEnabled = false;
		    } else if (rotationCandidates().length < 2) {
		      const usable = firstUsableGroup();
		      if (usable && usable.id !== selection.rotationGroupId) selection.rotationGroupId = usable.id;
		      else if (!usable) selection.rotationEnabled = false;
		    }
		    persistSelection();
		  }

		  // Drop a selection whose wallpaper vanished or stopped being playable.
		  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && isPlayable(w))) {
		    selection.id = "";
		    persistSelection();
		  }
		  if (selection.rotationEnabled && selection.id && !rotationCandidates().some((w) => w.id === selection.id)) {
		    selection.id = "";
		    persistSelection();
		  }
		  if (!selection.id && selection.rotationEnabled) {
		    const first = rotationCandidates()[0];
		    if (first) selection.id = first.id;
		  }
		  applySelection(selection.id);
		  emit();
		}

		function isPlayable(w) {
		  return Boolean(w && w.playable && (w.type === "video" || w.type === "web"));
		}

		function playableInventory() {
		  return selection.inventory.wallpapers.filter(isPlayable);
		}

		// ── Rotation groups ─────────────────────────────────────────────────────────
		function activeRotationGroup() {
		  return selection.rotationGroups.find((g) => g.id === selection.rotationGroupId) || null;
		}

		function groupWallpapers(group) {
		  if (!group || !Array.isArray(group.wallpaperIds)) return [];
		  const byId = new Map(selection.inventory.wallpapers.map((w) => [w.id, w]));
		  return group.wallpaperIds.map((id) => byId.get(id)).filter(isPlayable);
		}

		function rotationCandidates() {
		  return groupWallpapers(activeRotationGroup());
		}

		function firstUsableGroup() {
		  return selection.rotationGroups.find((g) => groupWallpapers(g).length >= 2) || null;
		}

		function seedGroupsFromPlaylists() {
		  const source = selection.inventory.playlists.find((p) => (p.portableCount || 0) >= 2);
		  if (!source) return false;
		  const ids = Array.isArray(source.wallpaperIds) ? source.wallpaperIds.filter((id) => {
		    const w = selection.inventory.wallpapers.find((x) => x.id === id);
		    return isPlayable(w);
		  }) : [];
		  if (ids.length < 2) return false;
		  selection.rotationGroups.push({
		    id: nextGroupId(),
		    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "轮播列表",
		    interval: DEFAULTS.rotationInterval,
		    order: source.order === "random" ? "random" : "sequence",
		    wallpaperIds: ids,
		  });
		  selection.rotationGroupId = selection.rotationGroups[selection.rotationGroups.length - 1].id;
		  return true;
		}

		function nextGroupId() {
		  return "grp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		}

		function nextRotationWallpaper() {
		  const list = rotationCandidates();
		  if (list.length < 2) return null;
		  const group = activeRotationGroup();
		  if (group && group.order === "random") {
		    const candidates = list.filter((w) => w.id !== selection.id);
		    return candidates[Math.floor(Math.random() * candidates.length)] || null;
		  }
		  const current = list.findIndex((w) => w.id === selection.id);
		  return list[(current + 1 + list.length) % list.length] || null;
		}

		function clearRotationTimer() {
		  if (selection.rotationTimer === null) return;
		  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		    window.clearTimeout(selection.rotationTimer);
		  }
		  selection.rotationTimer = null;
		}

		function syncRotationTimer() {
		  clearRotationTimer();
		  if (!selection.rotationEnabled || !selection.id) return;
		  if (rotationCandidates().length < 2) return;
		  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
		  const group = activeRotationGroup();
		  const minutes = group ? group.interval : DEFAULTS.rotationInterval;
		  selection.rotationTimer = window.setTimeout(() => {
		    selection.rotationTimer = null;
		    if (!selection.rotationEnabled || !selection.id) return;
		    const next = nextRotationWallpaper();
		    if (next) applySelection(next.id);
		  }, minutes * 60 * 1000);
		}

		// ── Rotation group CRUD (draft-based editor) ────────────────────────────────
		function startEditGroup(id) {
		  const group = selection.rotationGroups.find((g) => g.id === id);
		  if (!group) return;
		  selection.editing = JSON.parse(JSON.stringify(group));
		  emit();
		}

		function startCreateGroup() {
		  selection.editing = {
		    id: nextGroupId(),
		    name: "轮播列表 " + (selection.rotationGroups.length + 1),
		    interval: DEFAULTS.rotationInterval,
		    order: "sequence",
		    wallpaperIds: [],
		  };
		  emit();
		}

		function saveEditingGroup() {
		  const draft = selection.editing;
		  if (!draft) return;
		  const idx = selection.rotationGroups.findIndex((g) => g.id === draft.id);
		  const cleaned = {
		    id: draft.id,
		    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "轮播列表",
		    interval: clampNum(draft.interval, 1, 1440, DEFAULTS.rotationInterval),
		    order: draft.order === "random" ? "random" : "sequence",
		    wallpaperIds: Array.isArray(draft.wallpaperIds)
		      ? draft.wallpaperIds.filter((x) => typeof x === "string" && x)
		      : [],
		  };
		  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
		  else selection.rotationGroups.push(cleaned);
		  selection.rotationGroupId = cleaned.id;
		  selection.editing = null;
		  if (selection.rotationEnabled && !rotationCandidates().some((w) => w.id === selection.id)) {
		    const first = rotationCandidates()[0];
		    applySelection(first ? first.id : "");
		    return;
		  }
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function cancelEditGroup() {
		  selection.editing = null;
		  emit();
		}

		function deleteGroup(id) {
		  const idx = selection.rotationGroups.findIndex((g) => g.id === id);
		  if (idx < 0) return;
		  selection.rotationGroups.splice(idx, 1);
		  if (selection.rotationGroupId === id) {
		    selection.rotationGroupId = "";
		    if (selection.rotationEnabled) {
		      const fallback = firstUsableGroup();
		      if (fallback) selection.rotationGroupId = fallback.id;
		      else selection.rotationEnabled = false;
		    }
		  }
		  if (selection.editing && selection.editing.id === id) selection.editing = null;
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function importPlaylistIntoDraft(playlist) {
		  if (!selection.editing || !playlist || !Array.isArray(playlist.wallpaperIds)) return;
		  const playable = new Set(playableInventory().map((w) => w.id));
		  selection.editing.wallpaperIds = playlist.wallpaperIds.filter((id) => playable.has(id));
		  emit();
		}

		function applySelection(id) {
		  selection.id = id || "";
		  persistSelection();
		  const w = selection.id
		    ? selection.inventory.wallpapers.find((x) => x.id === selection.id)
		    : null;
		  if (!w || !isPlayable(w)) {
		    selection.url = null;
		    selection.type = null;
		  } else {
		    selection.url = w.media;
		    selection.type = w.type;
		  }
		  syncRotationTimer();
		  emit();
		}

		// ── Behind-body layer: wallpaper + scrim, with crossfade ────────────────────
		function buildMedia(sel) {
		  const media = sel.type === "video"
		    ? document.createElement("video")
		    : document.createElement("iframe");
		  if (sel.type === "video") {
		    media.src = sel.url;
		    media.autoplay = !REDUCED_MOTION;
		    media.loop = true;
		    media.muted = true;
		    media.setAttribute("playsinline", "");
		    media.className = "webg-media";
		  } else {
		    // SECURITY: sandboxed, opaque origin. allow-scripts alone runs the
		    // wallpaper's animation but denies it DSH's localStorage/cookies/APIs.
		    media.src = sel.url;
		    media.setAttribute("sandbox", "allow-scripts");
		    media.setAttribute("referrerpolicy", "no-referrer");
		    media.setAttribute("frameborder", "0");
		    media.setAttribute("scrolling", "no");
		    media.setAttribute("title", "Wallpaper Engine web wallpaper");
		    media.className = "webg-media webg-iframe";
		  }
		  return media;
		}

		function syncLayers() {
		  const existing = document.getElementById(LAYER_ID);

		  if (selection.url) {
		    const wantKey = selection.type + "\u0000" + selection.url;
		    const gotKey = existing && existing.dataset.webgKey;

		    if (existing && gotKey === wantKey) {
		      // Same wallpaper — only play/pause may have changed.
		    } else {
		      // Crossfade: keep the old layer alive while the new one fades in on
		      // top, then remove the old one after the transition settles. The old
		      // layer surrenders the id FIRST — getElementById must resolve to the
		      // new layer for the play/pause step below.
		      if (existing) existing.removeAttribute("id");
		      const node = document.createElement("div");
		      node.id = LAYER_ID;
		      node.className = "webg-layer webg-layer--enter";
		      node.dataset.webgKey = wantKey;
		      node.appendChild(buildMedia(selection));
		      document.body.appendChild(node);
		      // Force a style flush so the enter transition actually runs.
		      void node.offsetHeight;
		      node.classList.remove("webg-layer--enter");
		      if (existing) {
		        existing.classList.add("webg-layer--leave");
		        const stale = existing;
		        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
		          window.setTimeout(() => stale.remove(), CROSSFADE_MS + 120);
		        } else {
		          stale.remove();
		        }
		      }
		    }
		    const node = document.getElementById(LAYER_ID);
		    const video = node && node.querySelector("video");
		    if (video) {
		      if (selection.playing) { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {} }
		      else video.pause();
		    }
		  } else if (existing) {
		    existing.classList.add("webg-layer--leave");
		    const stale = existing;
		    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
		      window.setTimeout(() => stale.remove(), CROSSFADE_MS + 120);
		    } else {
		      stale.remove();
		    }
		  }

		  // Scrim: always present while a wallpaper is active.
		  const scrim = document.getElementById(SCRIM_ID);
		  if (selection.url) {
		    if (!scrim) {
		      const s = document.createElement("div");
		      s.id = SCRIM_ID;
		      s.className = "webg-scrim";
		      document.body.appendChild(s);
		    }
		    document.body.setAttribute(ACTIVE_ATTR, "on");
		  } else {
		    if (scrim) scrim.remove();
		    document.body.removeAttribute(ACTIVE_ATTR);
		  }
		}

		// ── Effect application: push the knobs into CSS variables ───────────────────
		function applyEffects() {
		  const s = document.body.style;
		  s.setProperty("--webg-scrim-color", "rgba(0,0,0," + selection.scrim + ")");
		  s.setProperty("--webg-border-alpha", String(selection.border));
		  s.setProperty("--webg-blur", selection.blur + "px");
		  // The glass "colour melt" scales with blur radius: 0 blur → no melt.
		  s.setProperty("--webg-saturate", String(1.15 + selection.blur * 0.028));
		  s.setProperty("--webg-glass-brightness", "1.04");
		  s.setProperty("--webg-wallpaper-blur", selection.wallpaperBlur + "px");
		  // Scaling compensates the transparent fringe CSS blur reveals at edges.
		  s.setProperty("--webg-wallpaper-scale", (1 + selection.wallpaperBlur * 0.006).toFixed(4));

		  // Write the scrim colour directly too, then force a synchronous layout, so
		  // slider feedback lands on this frame even on stalled compositors.
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = "rgba(0,0,0," + selection.scrim + ")";
		  if (document.body && document.body.offsetHeight !== undefined) {
		    void document.body.offsetHeight;
		  }
		}

		function clearEffects() {
		  const s = document.body.style;
		  s.removeProperty("--webg-scrim-color");
		  s.removeProperty("--webg-border-alpha");
		  s.removeProperty("--webg-blur");
		  s.removeProperty("--webg-saturate");
		  s.removeProperty("--webg-glass-brightness");
		  s.removeProperty("--webg-wallpaper-blur");
		  s.removeProperty("--webg-wallpaper-scale");
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = "";
		}

		// ── Settings picker ─────────────────────────────────────────────────────────
		function SliderRow(label, min, max, step, value, onInput, suffix) {
		  return React.createElement("div", { className: "webg-row webg-slider-row" },
		    React.createElement("span", { className: "webg-hint webg-label" }, label),
		    React.createElement("input", {
		      className: "webg-slider", type: "range",
		      min: String(min), max: String(max), step: String(step),
		      value: String(value),
		      // onInput fires continuously while dragging (onChange may wait for
		      // release) — that is what makes the visual feedback instant.
		      onInput: (e) => onInput(Number(e.target.value)),
		      onChange: (e) => onInput(Number(e.target.value)),
		    }),
		    React.createElement("span", { className: "webg-hint webg-value" }, suffix),
		  );
		}

		function ThumbCard(w, selected, onClick) {
		  return React.createElement("button", {
		    key: w.id,
		    className: "webg-card" + (selected ? " webg-card--selected" : ""),
		    type: "button",
		    onClick: onClick,
		    title: w.title,
		  },
		  w.preview
		    ? React.createElement("img", {
		        src: w.preview, alt: w.title, loading: "lazy",
		        onError: (e) => { e.target.style.display = "none"; },
		      })
		    : React.createElement("span", { className: "webg-card-placeholder" }, "无预览"),
		  React.createElement("span", { className: "webg-card-type" }, w.type === "video" ? "视频" : "网页"),
		  React.createElement("span", { className: "webg-card-title" }, w.title),
		  );
		}

		function WallpaperPicker() {
		  const sel = useStore();
		  const onTogglePlay = () => { selection.playing = !selection.playing; emit(); };
		  const onClear = () => applySelection("");
		  const onRefresh = () => loadInventory(true);
		  const onGroupChange = (e) => {
		    selection.rotationGroupId = e.target.value;
		    if (selection.rotationEnabled) {
		      const first = rotationCandidates()[0];
		      if (first) applySelection(first.id);
		      else applySelection("");
		      return;
		    }
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  const onToggleRotation = () => {
		    selection.rotationEnabled = !selection.rotationEnabled;
		    if (selection.rotationEnabled) {
		      if (!selection.rotationGroupId) {
		        const usable = firstUsableGroup();
		        if (usable) selection.rotationGroupId = usable.id;
		      }
		      if (!rotationCandidates().some((w) => w.id === selection.id)) {
		        const first = rotationCandidates()[0];
		        if (first) { applySelection(first.id); return; }
		      }
		    }
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  const onGroupInterval = (e) => {
		    const group = activeRotationGroup();
		    if (!group) return;
		    group.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval);
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  const onDeleteGroup = () => {
		    const group = activeRotationGroup();
		    if (!group) return;
		    if (typeof window !== "undefined" && typeof window.confirm === "function") {
		      if (!window.confirm("删除轮播列表「" + group.name + "」?")) return;
		    }
		    deleteGroup(group.id);
		  };

		  const onScrim = (pct) => { selection.scrim = pct / 100; persistSelection(); applyEffects(); emit(); };
		  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); };
		  const onBlur = (px) => { selection.blur = px; persistSelection(); applyEffects(); emit(); };
		  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); };

		  if (!sel.loaded) {
		    return React.createElement("div", { className: "webg-picker" },
		      React.createElement("span", { className: "webg-hint" }, "正在扫描 Wallpaper Engine…"));
		  }
		  if (sel.inventory.error) {
		    return React.createElement("div", { className: "webg-picker" },
		      React.createElement("div", { className: "webg-error" },
		        "未能连接 Wallpaper Engine:" + sel.inventory.error),
		      React.createElement("button", {
		        className: "webg-btn", type: "button", onClick: onRefresh, disabled: sel.loading,
		      }, sel.loading ? "刷新中…" : "重试"));
		  }

		  const playableList = playableInventory();
		  const groups = sel.rotationGroups;
		  const group = activeRotationGroup();
		  const candidates = rotationCandidates();
		  const playableCount = candidates.length;
		  const editing = sel.editing;
		  const INTERVALS = [1, 5, 10, 30, 60, 120];

		  return React.createElement("div", { className: "webg-picker" },
		    React.createElement("div", { className: "webg-grid" },
		      React.createElement("button", {
		        className: "webg-card" + (sel.id ? "" : " webg-card--selected"),
		        type: "button",
		        onClick: onClear,
		        title: "关闭壁纸",
		      },
		      React.createElement("span", { className: "webg-card-close" }, "✕ 关闭"),
		      ),
		      playableList.length === 0
		        ? React.createElement("span", { className: "webg-hint" },
		            sel.inventory.total > 0
		              ? "已发现 " + sel.inventory.total + " 张壁纸,但没有可嵌入的 Video/Web 类型"
		              : "未发现壁纸 — 请先在 Wallpaper Engine 中订阅 Video/Web 类型")
		        : playableList.map((w) => ThumbCard(w, w.id === sel.id, () => applySelection(w.id))),
		    ),
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: onTogglePlay, disabled: !sel.url || sel.type !== "video",
		      }, sel.playing ? "暂停" : "播放"),
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: onClear, disabled: !sel.id,
		      }, "关闭"),
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: onRefresh, disabled: sel.loading,
		      }, sel.loading ? "刷新中…" : "刷新"),
		    ),
		    // ── Rotation groups ──
		    React.createElement("div", { className: "webg-row webg-playlist-row" },
		      React.createElement("span", { className: "webg-hint webg-label" }, "轮播列表"),
		      React.createElement("select", {
		        className: "webg-select webg-playlist-select",
		        value: sel.rotationGroupId,
		        onChange: onGroupChange,
		        disabled: groups.length === 0,
		      },
		      React.createElement("option", { value: "" }, groups.length ? "— 选择轮播列表 —" : "— 暂无轮播列表 —"),
		      ...groups.map((g) => React.createElement("option", {
		        key: g.id, value: g.id,
		      }, g.name + "(" + groupWallpapers(g).length + " 可播放 · " + g.interval + " 分钟)")),
		      ),
		      React.createElement("button", {
		        className: "webg-btn", type: "button", onClick: startCreateGroup,
		      }, "新建"),
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: () => startEditGroup(sel.rotationGroupId),
		        disabled: !sel.rotationGroupId,
		      }, "编辑"),
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: onDeleteGroup,
		        disabled: !sel.rotationGroupId,
		      }, "删除"),
		    ),
		    editing && React.createElement("div", { className: "webg-editor" },
		      React.createElement("div", { className: "webg-row" },
		        React.createElement("span", { className: "webg-hint webg-label" }, "名称"),
		        React.createElement("input", {
		          className: "webg-text", type: "text",
		          value: editing.name,
		          onInput: (e) => { editing.name = e.target.value; emit(); },
		        }),
		      ),
		      React.createElement("div", { className: "webg-row" },
		        React.createElement("span", { className: "webg-hint webg-label" }, "间隔"),
		        React.createElement("select", {
		          className: "webg-select",
		          value: String(editing.interval),
		          onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
		        },
		        ...INTERVALS.map((minutes) =>
		          React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
		        )),
		        React.createElement("span", { className: "webg-hint webg-label" }, "顺序"),
		        React.createElement("select", {
		          className: "webg-select webg-playlist-select",
		          value: editing.order,
		          onChange: (e) => { editing.order = e.target.value; emit(); },
		        },
		        React.createElement("option", { value: "sequence" }, "顺序"),
		        React.createElement("option", { value: "random" }, "随机"),
		        ),
		      ),
		      React.createElement("div", { className: "webg-editor-grid" },
		        playableInventory().length === 0
		          ? React.createElement("span", { className: "webg-hint" }, "没有可播放的 Video/Web 壁纸")
		          : playableInventory().map((w) => {
		              const checked = editing.wallpaperIds.indexOf(w.id) >= 0;
		              return React.createElement("button", {
		                key: w.id,
		                className: "webg-editor-card" + (checked ? " webg-editor-card--checked" : ""),
		                type: "button",
		                title: w.title,
		                onClick: () => {
		                  const i = editing.wallpaperIds.indexOf(w.id);
		                  if (i >= 0) editing.wallpaperIds.splice(i, 1);
		                  else editing.wallpaperIds.push(w.id);
		                  emit();
		                },
		              },
		              w.preview
		                ? React.createElement("img", {
		                    src: w.preview, alt: w.title, loading: "lazy",
		                    onError: (e) => { e.target.style.display = "none"; },
		                  })
		                : React.createElement("span", { className: "webg-card-placeholder" }, "无预览"),
		              checked && React.createElement("span", { className: "webg-editor-check" }, "✓"),
		              );
		            }),
		      ),
		      React.createElement("div", { className: "webg-row" },
		        React.createElement("span", { className: "webg-hint" }, "已选 " + editing.wallpaperIds.length + " 个"),
		        sel.inventory.playlists.length > 0 && React.createElement("select", {
		          className: "webg-select webg-playlist-select",
		          value: "",
		          onChange: (e) => {
		            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
		            if (p) importPlaylistIntoDraft(p);
		          },
		        },
		        React.createElement("option", { value: "" }, "从 WE 播放列表导入…"),
		        ...sel.inventory.playlists.map((p) => React.createElement("option", {
		          key: p.id, value: p.id,
		        }, p.name + "(" + (p.portableCount || 0) + " 可播放)")),
		        ),
		      ),
		      React.createElement("div", { className: "webg-row" },
		        React.createElement("button", {
		          className: "webg-btn webg-btn--primary", type: "button",
		          onClick: saveEditingGroup,
		        }, "保存"),
		        React.createElement("button", {
		          className: "webg-btn", type: "button",
		          onClick: cancelEditGroup,
		        }, "取消"),
		      ),
		    ),
		    React.createElement("div", { className: "webg-row webg-rotation-row" },
		      React.createElement("label", { className: "webg-rotation-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.rotationEnabled,
		          onChange: onToggleRotation,
		          disabled: !sel.rotationGroupId || playableCount < 2,
		        }),
		        "自动轮转",
		      ),
		      React.createElement("select", {
		        className: "webg-select webg-rotation-interval",
		        value: String(group ? group.interval : DEFAULTS.rotationInterval),
		        onChange: onGroupInterval,
		        disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2,
		        title: "当前列表的切换间隔",
		      },
		      ...INTERVALS.map((minutes) =>
		        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
		      )),
		      !sel.rotationGroupId && React.createElement("span", { className: "webg-hint" }, "请先选择或新建一个轮播列表"),
		      sel.rotationGroupId && playableCount < 2 && React.createElement("span", { className: "webg-hint" }, "当前列表至少需要 2 个可播放壁纸"),
		    ),
		    sel.id && React.createElement(React.Fragment, null,
		      SliderRow("壁纸模糊", 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
		      SliderRow("暗化", 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
		      SliderRow("边框", 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%"),
		      SliderRow("玻璃", 0, 40, 1, sel.blur, onBlur, sel.blur + "px"),
		    ),
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("span", { className: "webg-hint" },
		        (group
		          ? "列表「" + group.name + "」:" + group.wallpaperIds.length + " 项 · " + playableCount + " 可播放 · 每 " + group.interval + " 分钟 · " + (group.order === "random" ? "随机" : "顺序")
		          : playableList.length + " 个可播放壁纸") +
		        (sel.rotationEnabled ? " · 自动轮转中" : "")),
		    ),
		  );
		}

		// ── Styles ──────────────────────────────────────────────────────────────────
		// Everything reads DSH design tokens (--dsw-*) so the UI blends into the
		// shell and follows light/dark theme switches automatically.
		const CSS = `
		  /* Wallpaper layers: fixed, sunk below the app frame, crossfading. */
		  .webg-layer {
		    position: fixed; inset: 0; z-index: -2; overflow: hidden;
		    pointer-events: none; opacity: 1;
		    transition: opacity ${CROSSFADE_MS}ms ease;
		  }
		  .webg-layer--enter { opacity: 0; }
		  .webg-layer--leave { opacity: 0; }
		  .webg-layer .webg-media {
		    width: 100%; height: 100%; object-fit: cover; display: block;
		    background: transparent; border: 0;
		    filter: blur(var(--webg-wallpaper-blur, 0px));
		    transform: scale(var(--webg-wallpaper-scale, 1));
		    transform-origin: center;
		  }

		  /* Scrim: above the wallpaper (-1 > -2), below the UI. */
		  .webg-scrim {
		    position: fixed; inset: 0; z-index: -1;
		    pointer-events: none;
		    background: var(--webg-scrim-color, rgba(0, 0, 0, 0.25));
		  }

		  /* While active: transparent frame + sidebar, higher border contrast. */
		  body[${ACTIVE_ATTR}] {
		    --dsw-alias-bg-base: transparent;
		    --dsw-specific-sidebar-fill: transparent;
		    --dsw-alias-border-l1: rgba(180, 180, 180, var(--webg-border-alpha, 0.35));
		    --dsw-alias-border-l2: rgba(180, 180, 180, var(--webg-border-alpha, 0.35));
		    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--webg-border-alpha, 0.35));
		  }

		  /* Light-scheme text ramp: grays were tuned against a near-white page and
		     lose contrast over busy wallpapers — push them darker while active. */
		  body[${ACTIVE_ATTR}]:not([data-ds-dark-theme]) {
		    --dsw-alias-label-primary: rgb(0, 0, 0);
		    --dsw-alias-label-primary-dimmed: rgb(10, 10, 12);
		    --dsw-alias-label-secondary: rgb(40, 42, 46);
		    --dsw-alias-label-tertiary: rgb(70, 73, 79);
		    --dsw-alias-label-caption: rgb(110, 114, 120);
		    --dsw-alias-label-dimmed: rgb(50, 52, 56);
		  }

		  /* iOS liquid glass: opaque conversation surfaces become frosted glass.
		     Transparency rides the design tokens the surfaces already read;
		     backdrop-filter still needs element selectors ([data-composer-card] is
		     authored in the shell source and survives rebuilds; bubbles fall back to
		     the module-CSS suffix convention and degrade gracefully). */
		  body[${ACTIVE_ATTR}] {
		    --dsw-specific-input-major: rgba(255, 255, 255, 0.15);
		    --dsw-specific-bubble: rgba(255, 255, 255, 0.12);
		  }
		  body[data-ds-dark-theme][${ACTIVE_ATTR}] {
		    --dsw-specific-input-major: rgba(255, 255, 255, 0.06);
		    --dsw-specific-bubble: rgba(255, 255, 255, 0.05);
		  }
		  body[${ACTIVE_ATTR}] [data-composer-card],
		  body[${ACTIVE_ATTR}] [class*="_bubble"] {
		    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
		    -webkit-backdrop-filter: blur(var(--webg-blur, 16px)) saturate(var(--webg-saturate, 1.8)) brightness(var(--webg-glass-brightness, 1.04)) contrast(1.01);
		    backdrop-filter: blur(var(--webg-blur, 16px)) saturate(var(--webg-saturate, 1.8)) brightness(var(--webg-glass-brightness, 1.04)) contrast(1.01);
		    box-shadow:
		      inset 0 1px 0 rgba(255, 255, 255, var(--webg-glass-highlight, 0.32)),
		      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
		      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
		      0 12px 40px rgba(0, 0, 0, var(--webg-glass-shadow, 0.12));
		  }

		  /* ── Picker chrome (token-driven, theme-aware) ── */
		  .webg-picker { display: flex; flex-direction: column; gap: 10px; }
		  .webg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
		  .webg-hint { font-size: 0.8em; opacity: 0.7; color: var(--dsw-alias-label-tertiary, inherit); }
		  .webg-error {
		    font-size: 0.85em;
		    color: var(--dsw-alias-state-error-primary, #d44);
		  }
		  .webg-label { min-width: 28px; }
		  .webg-value { min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }

		  .webg-btn {
		    cursor: pointer;
		    padding: 4px 12px;
		    border-radius: 6px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
		    color: var(--dsw-alias-label-primary, inherit);
		    font-size: 0.85em;
		    transition: background-color 120ms ease, border-color 120ms ease;
		  }
		  .webg-btn:hover:not(:disabled) {
		    background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.2));
		    border-color: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.5));
		  }
		  .webg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
		  .webg-btn--primary {
		    background: var(--dsw-alias-brand-primary, #3964fe);
		    border-color: transparent;
		    color: #fff;
		  }
		  .webg-btn--primary:hover:not(:disabled) {
		    background: var(--dsw-alias-brand-primary-hover, #4f74ff);
		  }

		  .webg-select, .webg-text {
		    padding: 4px 8px;
		    border-radius: 6px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
		    color: var(--dsw-alias-label-primary, inherit);
		    font-size: 0.85em;
		  }
		  .webg-text { flex: 1; min-width: 0; }
		  .webg-playlist-select { flex: 1; min-width: 0; }
		  .webg-rotation-interval { margin-left: auto; }
		  .webg-rotation-toggle { display: inline-flex; align-items: center; gap: 6px; accent-color: var(--dsw-alias-brand-primary, #3964fe); }

		  .webg-slider { flex: 1; accent-color: var(--dsw-alias-brand-primary, #3964fe); }
		  .webg-slider-row { display: flex; align-items: center; gap: 8px; }

		  /* Wallpaper thumbnail grid. */
		  .webg-grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		    gap: 8px; max-height: 300px; overflow-y: auto; padding: 2px;
		  }
		  .webg-card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    aspect-ratio: 16 / 9; display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		    transition: transform 140ms ease, box-shadow 140ms ease, outline-color 140ms ease;
		  }
		  .webg-card:hover {
		    transform: translateY(-2px);
		    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
		  }
		  .webg-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
		  .webg-card--selected {
		    outline: 2px solid var(--dsw-alias-brand-primary, #3964fe);
		    outline-offset: -2px;
		  }
		  .webg-card-close {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.8em; color: var(--dsw-alias-label-secondary, #888);
		  }
		  .webg-card-type {
		    position: absolute; top: 4px; right: 4px;
		    padding: 1px 6px; border-radius: 4px;
		    font-size: 0.65em; line-height: 1.5;
		    color: #fff; background: rgba(0, 0, 0, 0.5);
		  }
		  .webg-card-title {
		    position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
		    font-size: 0.7em; line-height: 1.2; color: #fff;
		    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
		    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
		    text-align: left;
		  }
		  .webg-card-placeholder {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.72em; opacity: 0.55;
		  }

		  /* Rotation group editor. */
		  .webg-editor {
		    display: flex; flex-direction: column; gap: 8px;
		    padding: 10px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 10px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.08));
		  }
		  .webg-editor-grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		    gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px;
		  }
		  .webg-editor-card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    aspect-ratio: 16 / 10; display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		    transition: transform 140ms ease;
		  }
		  .webg-editor-card:hover { transform: translateY(-1px); }
		  .webg-editor-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
		  .webg-editor-card--checked {
		    outline: 2px solid var(--dsw-alias-brand-primary, #3964fe);
		    outline-offset: -2px;
		  }
		  .webg-editor-check {
		    position: absolute; top: 4px; left: 4px; width: 18px; height: 18px;
		    border-radius: 4px; background: var(--dsw-alias-brand-primary, #3964fe); color: #fff;
		    font-size: 12px; line-height: 18px; text-align: center;
		  }
		`;

		// ── Plugin exports ──────────────────────────────────────────────────────────
		const inject = ["slots"];

		function apply(ctx) {
		  // 1. Styles: owned by the fiber — injected on apply, REMOVED on dispose
		  //    (a module-level injection would leak styling past plugin stop).
		  if (ctx.effect && typeof document !== "undefined") {
		    ctx.effect(() => {
		      let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]");
		      if (!tag) {
		        tag = document.createElement("style");
		        tag.dataset.plugin = "wallpaper-engine-dsh";
		        tag.dataset.pluginCss = STYLE_TAG_ID;
		        tag.textContent = CSS;
		        document.head.appendChild(tag);
		      }
		      return () => { tag.remove(); };
		    });
		  }

		  // 2. Behind-body layers + effect knobs, synced to the selection store.
		  if (ctx.effect && typeof document !== "undefined") {
		    ctx.effect(() => {
		      const unsubLayers = subscribe(syncLayers);
		      const unsubEffects = subscribe(applyEffects);
		      syncLayers();
		      applyEffects();
		      return () => {
		        unsubLayers();
		        unsubEffects();
		        clearRotationTimer();
		        // Remove EVERY layer instance (a crossfade-leaving layer has no id).
		        const doomed = document.querySelectorAll(".webg-layer");
		        for (const node of [...doomed]) node.remove();
		        const scrim = document.getElementById(SCRIM_ID);
		        if (scrim) scrim.remove();
		        clearEffects();
		        document.body.removeAttribute(ACTIVE_ATTR);
		      };
		    });
		  }

		  // 3. Settings row (this slot is NOT the overlay; safe to register into).
		  if (ctx.slots) {
		    ctx.slots.inject("settings.general.item", () =>
		      ctx.slots.register(
		        { name: "settings.general.item", id: "we-background", order: 500, label: "壁纸背景 (Wallpaper Engine)" },
		        () => React.createElement(WallpaperPicker),
		      ),
		    );
		  }

		  loadInventory(false);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
