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
		/** Crossfade settle time before a leaving layer is detached. */
		const LEAVE_MS = CROSSFADE_MS + 120;
		/** Battery at or below this level (and discharging) auto-pauses playback. */
		const BATTERY_SAVER_LEVEL = 0.2;
		/** Below this FPS the picker shows a performance hint. */
		const LOW_FPS = 24;

		// Respect the OS "reduce motion" preference: start paused rather than
		// autoplaying a video loop at someone who asked for less motion.
		const REDUCED_MOTION = typeof window !== "undefined" &&
		  typeof window.matchMedia === "function" &&
		  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		// ── i18n ─────────────────────────────────────────────────────────────────────
		const STRINGS = {
		  zh: {
		    settingsLabel: "壁纸背景 (Wallpaper Engine)",
		    scanning: "正在扫描 Wallpaper Engine…",
		    connError: "未能连接 Wallpaper Engine:",
		    retry: "重试",
		    refreshing: "刷新中…",
		    refresh: "刷新",
		    pause: "暂停",
		    play: "播放",
		    close: "关闭",
		    searchPlaceholder: "搜索壁纸(标题或 ID)…",
		    matched: (m, n) => "匹配 " + m + " / " + n + " 张",
		    emptyNoInstall: "未检测到 Wallpaper Engine — 请确认已通过 Steam 安装",
		    emptyNoUsable: (n) => "已发现 " + n + " 张壁纸,但都缺少可播放内容或预览图",
		    emptyNoProjects: "未在任何项目目录中发现壁纸(默认项目/我的项目/创意工坊)",
		    noMatch: (q) => "没有匹配「" + q + "」的壁纸",
		    closeCard: "✕ 关闭",
		    closeTitle: "关闭壁纸",
		    noPreview: "无预览",
		    badgeVideo: "视频",
		    badgeWeb: "网页",
		    rotationList: "轮播列表",
		    selectList: "— 选择轮播列表 —",
		    noLists: "— 暂无轮播列表 —",
		    groupOption: (name, count, interval) => name + "(" + count + " 可用 · " + interval + " 分钟)",
		    newList: "新建",
		    editList: "编辑",
		    deleteList: "删除",
		    name: "名称",
		    interval: "间隔",
		    order: "顺序",
		    sequence: "顺序",
		    random: "随机",
		    minutes: (m) => m + " 分钟",
		    filterPlaceholder: "搜索以筛选…",
		    noUsable: "没有可用壁纸",
		    selectedCount: (n) => "已选 " + n + " 个",
		    importPlaylist: "从 WE 播放列表导入…",
		    playlistOption: (name, count) => name + "(" + count + " 可播放)",
		    save: "保存",
		    cancel: "取消",
		    autoRotate: "自动轮转",
		    intervalTitle: "当前列表的切换间隔",
		    needList: "请先选择或新建一个轮播列表",
		    needTwo: "当前列表至少需要 2 张可用壁纸",
		    wallpaperBlur: "壁纸模糊",
		    scrim: "暗化",
		    border: "边框",
		    glass: "玻璃",
		    pauseOnHidden: "页面隐藏时暂停",
		    pauseOnBattery: "低电量时暂停",
		    autoScrim: "智能可视",
		    autoScrimTitle: "采样壁纸亮度,过亮或过暗时自动加强遮罩,保证文字可读",
		    fpsTitle: "页面当前渲染帧率",
		    lowFpsHint: "帧率偏低,可尝试暂停视频、增大壁纸模糊或换用静态壁纸",
		    language: "语言",
		    langAuto: "自动",
		    fit: "排布",
		    fitCover: "填充",
		    fitContain: "适应",
		    fitFill: "拉伸",
		    fitNone: "原始",
		    fitFree: "自由",
		    adjust: "调整画面",
		    adjustDone: "完成",
		    adjustHint: "拖动平移 · 滚轮缩放 · Esc 或点「完成」退出",
		    adjustHintFree: "拖动平移 · 滚轮缩放 · Alt+拖动旋转 · Esc 或点「完成」退出",
		    mirror: "镜像",
		    rotateCcw: "⟲",
		    rotateCw: "⟳",
		    rotateCcwTitle: "逆时针旋转 90°",
		    rotateCwTitle: "顺时针旋转 90°",
		    resetCrop: "重置裁剪",
		    statusGroup: (name, total, usable, interval, order) =>
		      "列表「" + name + "」:" + total + " 项 · " + usable + " 可用 · 每 " + interval + " 分钟 · " + order,
		    statusUsable: (n) => n + " 张可用壁纸",
		    autoRotating: "自动轮转中",
		    autoPaused: "已自动暂停",
		    confirmDelete: (name) => "删除轮播列表「" + name + "」?",
		    defaultGroupName: (n) => "轮播列表 " + n,
		    defaultGroupBase: "轮播列表",
		    iframeTitle: "Wallpaper Engine 网页壁纸",
		    decodeFallback: "媒体无法解码,已改用预览图",
		  },
		  en: {
		    settingsLabel: "Wallpaper Engine",
		    scanning: "Scanning Wallpaper Engine…",
		    connError: "Could not reach Wallpaper Engine: ",
		    retry: "Retry",
		    refreshing: "Refreshing…",
		    refresh: "Refresh",
		    pause: "Pause",
		    play: "Play",
		    close: "Close",
		    searchPlaceholder: "Search wallpapers (title or ID)…",
		    matched: (m, n) => m + " / " + n + " matched",
		    emptyNoInstall: "Wallpaper Engine not found — make sure it is installed via Steam",
		    emptyNoUsable: (n) => "Found " + n + " wallpapers, but none have playable media or a preview image",
		    emptyNoProjects: "No wallpapers found in any project folder (defaults / my projects / workshop)",
		    noMatch: (q) => "No wallpapers match \"" + q + "\"",
		    closeCard: "✕ Close",
		    closeTitle: "Clear wallpaper",
		    noPreview: "No preview",
		    badgeVideo: "Video",
		    badgeWeb: "Web",
		    rotationList: "Rotation list",
		    selectList: "— Select a list —",
		    noLists: "— No lists yet —",
		    groupOption: (name, count, interval) => name + "(" + count + " usable · " + interval + " min)",
		    newList: "New",
		    editList: "Edit",
		    deleteList: "Delete",
		    name: "Name",
		    interval: "Interval",
		    order: "Order",
		    sequence: "Sequence",
		    random: "Random",
		    minutes: (m) => m + " min",
		    filterPlaceholder: "Filter…",
		    noUsable: "No usable wallpapers",
		    selectedCount: (n) => n + " selected",
		    importPlaylist: "Import from WE playlist…",
		    playlistOption: (name, count) => name + "(" + count + " playable)",
		    save: "Save",
		    cancel: "Cancel",
		    autoRotate: "Auto-rotate",
		    intervalTitle: "Switch interval for the current list",
		    needList: "Create or select a rotation list first",
		    needTwo: "The list needs at least 2 usable wallpapers",
		    wallpaperBlur: "Wallpaper blur",
		    scrim: "Scrim",
		    border: "Borders",
		    glass: "Glass",
		    pauseOnHidden: "Pause when tab hidden",
		    pauseOnBattery: "Pause on low battery",
		    autoScrim: "Smart veil",
		    autoScrimTitle: "Samples wallpaper brightness and strengthens the veil when needed so text stays readable",
		    fpsTitle: "Current page frame rate",
		    lowFpsHint: "Low frame rate — try pausing the video, raising wallpaper blur, or using a still wallpaper",
		    language: "Language",
		    langAuto: "Auto",
		    fit: "Fit",
		    fitCover: "Cover",
		    fitContain: "Contain",
		    fitFill: "Stretch",
		    fitNone: "Original",
		    fitFree: "Free",
		    adjust: "Adjust",
		    adjustDone: "Done",
		    adjustHint: "Drag to pan · wheel to zoom · Esc or Done to exit",
		    adjustHintFree: "Drag to pan · wheel to zoom · Alt+drag to rotate · Esc or Done to exit",
		    mirror: "Mirror",
		    rotateCcw: "⟲",
		    rotateCw: "⟳",
		    rotateCcwTitle: "Rotate 90° counterclockwise",
		    rotateCwTitle: "Rotate 90° clockwise",
		    resetCrop: "Reset crop",
		    statusGroup: (name, total, usable, interval, order) =>
		      "List \"" + name + "\": " + total + " items · " + usable + " usable · every " + interval + " min · " + order,
		    statusUsable: (n) => n + " usable wallpapers",
		    autoRotating: "Auto-rotating",
		    autoPaused: "Auto-paused",
		    confirmDelete: (name) => "Delete rotation list \"" + name + "\"?",
		    defaultGroupName: (n) => "Rotation list " + n,
		    defaultGroupBase: "Rotation list",
		    iframeTitle: "Wallpaper Engine web wallpaper",
		    decodeFallback: "Media cannot be decoded here — showing the preview image",
		  },
		};

		/** Language the DSH shell reports via its locale service (null = unknown). */
		let shellLang = null;

		function browserLang() {
		  if (typeof navigator !== "undefined" && navigator.language) {
		    return String(navigator.language).toLowerCase().startsWith("zh") ? "zh" : "en";
		  }
		  return null;
		}

		function resolveLang() {
		  if (selection.lang === "zh" || selection.lang === "en") return selection.lang;
		  return shellLang || browserLang() || "zh";
		}

		/** Current string table. */
		function S() {
		  return STRINGS[resolveLang()];
		}

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
		  pauseOnHidden: true,
		  pauseOnBattery: true,
		  autoScrim: true,
		  lang: "auto",
		  fit: "cover",
		  zoom: 1,
		  offsetX: 0,
		  offsetY: 0,
		  rotation: 0, // free-fit only; degrees, positive = clockwise
		  mirrored: false, // horizontal flip, available in every fit mode
		};

		const FIT_MODES = ["cover", "contain", "fill", "none", "free"];

		// ── Persisted selection ─────────────────────────────────────────────────────
		function clampNum(v, lo, hi, fallback) {
		  return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : fallback;
		}

		function readRotationGroups(raw, baseName) {
		  if (!Array.isArray(raw)) return [];
		  const groups = [];
		  for (const g of raw) {
		    if (!g || typeof g !== "object") continue;
		    const id = typeof g.id === "string" && g.id ? g.id : "";
		    if (!id) continue;
		    groups.push({
		      id,
		      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : baseName,
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
		      rotationGroups: readRotationGroups(o.rotationGroups, STRINGS[browserLang() || "zh"].defaultGroupBase),
		      rotationSeeded: o.rotationSeeded === true,
		      pauseOnHidden: o.pauseOnHidden !== false,
		      pauseOnBattery: o.pauseOnBattery !== false,
		      autoScrim: o.autoScrim !== false,
		      lang: o.lang === "zh" || o.lang === "en" ? o.lang : "auto",
		      fit: FIT_MODES.indexOf(o.fit) >= 0 ? o.fit : DEFAULTS.fit,
		      // Older builds could persist unclamped crops — clampCrop() at store
		      // creation re-seats both into the envelope the CURRENT fit mode
		      // allows (free: zoom ≥ 0.1 with keep-visible pans; others: gap-free).
		      zoom: clampNum(o.zoom, 0.1, 4, DEFAULTS.zoom),
		      offsetX: clampNum(o.offsetX, -300, 300, DEFAULTS.offsetX),
		      offsetY: clampNum(o.offsetY, -300, 300, DEFAULTS.offsetY),
		      rotation: clampNum(o.rotation, -1080, 1080, DEFAULTS.rotation),
		      mirrored: o.mirrored === true,
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
		  adjusting: false, // crop-adjust overlay open (not persisted)
		  playing: !REDUCED_MOTION,
		  loading: false,
		  rotationTimer: null,
		  // Reasons playback is auto-paused (hidden tab / low battery). Distinct from
		  // the user's play/pause choice: effective playback = playing && no reasons.
		  autoPauseReasons: new Set(),
		  fps: null, // last sampled frames-per-second, null when unsampled
		  // Live draft of the group being created/edited (null when editor closed).
		  editing: null,
		  inventory: { installDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
		  loaded: false,
		};
		// Re-seat any persisted crop into the envelope the persisted fit mode
		// allows before the first render.
		clampCrop();

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
		      pauseOnHidden: selection.pauseOnHidden,
		      pauseOnBattery: selection.pauseOnBattery,
		      autoScrim: selection.autoScrim,
		      lang: selection.lang,
		      fit: selection.fit,
		      zoom: selection.zoom,
		      offsetX: selection.offsetX,
		      offsetY: selection.offsetY,
		      rotation: selection.rotation,
		      mirrored: selection.mirrored,
		    }));
		  } catch { /* storage full / blocked → session-only state, not fatal */ }
		}

		// ── Wallpaper predicates ─────────────────────────────────────────────────────
		// Renderable kinds ONLY — scene/application wallpapers are .pkg scene
		// packages the browser cannot render (their live animation is Wallpaper
		// Engine's desktop job), so they are filtered out of the grid entirely
		// rather than offered as degraded preview stills. A wallpaper is selectable
		// exactly when it is playable (real media renders live); preview-only
		// entries exist in the inventory for the decode-fallback lookup but are
		// never offered in the grid.
		function isPlayable(w) {
		  return Boolean(w && w.playable && (w.type === "video" || w.type === "web"));
		}

		function selectableInventory() {
		  return selection.inventory.wallpapers.filter(isPlayable);
		}

		// ── Inventory ────────────────────────────────────────────────────────────────
		// Monotonic token for in-flight inventory fetches: a fetch that started
		// before a newer one must not commit its (older) state afterwards, and a
		// fetch still in flight at dispose must not commit anything at all — its
		// applySelection call would re-arm the rotation timer on a torn-down store.
		let inventoryEpoch = 0;
		let disposed = false;

		async function loadInventory(forceRefresh) {
		  const epoch = ++inventoryEpoch;
		  selection.loading = true;
		  emit();
		  try {
		    const res = await fetch(forceRefresh ? INVENTORY_URL + "?refresh=1" : INVENTORY_URL, { cache: "no-store" });
		    if (!res.ok) throw new Error("inventory HTTP " + res.status);
		    const data = await res.json();
		    if (disposed || epoch !== inventoryEpoch) return;
		    selection.inventory = {
		      installDir: data.installDir || null,
		      wallpapers: Array.isArray(data.wallpapers) ? data.wallpapers : [],
		      total: data.total || 0,
		      portableCount: data.portableCount || 0,
		      playlists: Array.isArray(data.playlists) ? data.playlists : [],
		      error: null,
		    };
		  } catch (err) {
		    if (disposed || epoch !== inventoryEpoch) return;
		    selection.inventory = {
		      installDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [],
		      error: String(err && err.message ? err.message : err),
		    };
		  }
		  if (disposed || epoch !== inventoryEpoch) return;
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
		  // Rotation bookkeeping. A chosen list is never migrated away from — a
		  // list with fewer than 2 usable wallpapers simply keeps rotation
		  // disarmed (the timer needs a pair to alternate), and a hand-picked
		  // wallpaper outside the active list keeps playing until the next
		  // rotation tick brings the list back around.
		  if (selection.rotationEnabled && !selection.rotationGroupId) {
		    const usable = firstUsableGroup();
		    if (usable) selection.rotationGroupId = usable.id;
		    else selection.rotationEnabled = false;
		    persistSelection();
		  }

		  // Drop a selection whose wallpaper vanished or became unusable.
		  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && isPlayable(w))) {
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
		  const byId = new Map(selection.inventory.wallpapers.map((w) => [w.id, w]));
		  const ids = Array.isArray(source.wallpaperIds)
		    ? source.wallpaperIds.filter((id) => isPlayable(byId.get(id)))
		    : [];
		  if (ids.length < 2) return false;
		  selection.rotationGroups.push({
		    id: nextGroupId(),
		    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : S().defaultGroupBase,
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
		  // Default names must stay unique even after deletions: take the smallest
		  // free index instead of count+1.
		  const taken = new Set(selection.rotationGroups.map((g) => g.name));
		  let n = 1;
		  while (taken.has(S().defaultGroupName(n))) n++;
		  selection.editing = {
		    id: nextGroupId(),
		    name: S().defaultGroupName(n),
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
		    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : S().defaultGroupBase,
		    interval: clampNum(draft.interval, 1, 1440, DEFAULTS.rotationInterval),
		    order: draft.order === "random" ? "random" : "sequence",
		    wallpaperIds: Array.isArray(draft.wallpaperIds)
		      ? [...new Set(draft.wallpaperIds.filter((x) => typeof x === "string" && x))]
		      : [],
		  };
		  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
		  else selection.rotationGroups.push(cleaned);
		  selection.rotationGroupId = cleaned.id;
		  selection.editing = null;
		  if (selection.rotationEnabled && !rotationCandidates().some((w) => w.id === selection.id)) {
		    const first = rotationCandidates()[0];
		    if (first) {
		      applySelection(first.id);
		      return;
		    }
		    // Saved list has nothing usable — keep the current wallpaper and simply
		    // stop rotation instead of clearing the screen.
		    selection.rotationEnabled = false;
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
		  const usable = new Set(selectableInventory().map((w) => w.id));
		  selection.editing.wallpaperIds = [...new Set(playlist.wallpaperIds.filter((id) => usable.has(id)))];
		  emit();
		}

		function applySelection(id) {
		  if (selection.adjusting) exitAdjust();
		  selection.id = id || "";
		  persistSelection();
		  const w = selection.id
		    ? selection.inventory.wallpapers.find((x) => x.id === selection.id)
		    : null;
		  if (isPlayable(w) && !demotedToPreview.has(selection.id)) {
		    selection.url = w.media;
		    selection.type = w.type; // "video" | "web"
		  } else if (isPlayable(w) && w.preview) {
		    // Playable wallpaper demoted after repeated media failures (an
		    // undecodable container) — its preview still is the graceful fallback.
		    selection.url = w.preview;
		    selection.type = "image";
		  } else {
		    selection.url = null;
		    selection.type = null;
		  }
		  syncRotationTimer();
		  emit();
		}

		// ── Auto-pause (resource monitor) ───────────────────────────────────────────
		function setAutoPause(reason, on) {
		  const had = selection.autoPauseReasons.size > 0;
		  if (on) selection.autoPauseReasons.add(reason);
		  else selection.autoPauseReasons.delete(reason);
		  if ((selection.autoPauseReasons.size > 0) !== had) emit();
		}

		function effectivePlaying() {
		  return selection.playing && selection.autoPauseReasons.size === 0;
		}

		// Latest known battery state (null until getBattery resolves). Kept at module
		// scope so re-enabling the toggle can re-evaluate immediately instead of
		// waiting for the next battery event.
		let batteryState = null;
		function applyBatteryPause() {
		  if (!batteryState || !selection.pauseOnBattery) return;
		  setAutoPause("battery",
		    !batteryState.charging && batteryState.level <= BATTERY_SAVER_LEVEL);
		}

		// ── Behind-body layer: wallpaper + scrim, with crossfade ────────────────────
		// Set by a media error handler to force a remount with fresh URLs; cleared
		// once the remount happens.
		let forceRemount = false;
		// Per-wallpaper recovery timestamps: the first error for a wallpaper may
		// just be a stale token; a SECOND error for the same id means the bytes are
		// unusable — demote it to its preview instead of looping forever.
		const lastRecoveryAt = new Map(); // wallpaperId → last recovery timestamp
		const mediaFailures = new Map(); // wallpaperId → consecutive failure count
		const demotedToPreview = new Set(); // wallpaperIds now rendered as stills

		function buildMedia(sel) {
		  let media;
		  if (sel.type === "video") {
		    media = document.createElement("video");
		    media.src = sel.url;
		    media.autoplay = effectivePlaying();
		    media.loop = true;
		    media.muted = true;
		    media.setAttribute("playsinline", "");
		    media.className = "webg-media";
		  } else if (sel.type === "web") {
		    // Sandboxed opaque origin: wallpaper JS runs but cannot touch DSH
		    // storage or APIs.
		    media = document.createElement("iframe");
		    media.src = sel.url;
		    media.setAttribute("sandbox", "allow-scripts");
		    media.setAttribute("referrerpolicy", "no-referrer");
		    media.setAttribute("frameborder", "0");
		    media.setAttribute("scrolling", "no");
		    media.setAttribute("title", S().iframeTitle);
		    media.className = "webg-media";
		  } else {
		    // Static fallback: a playable wallpaper demoted after repeated media
		    // failures — its preview still beats a black screen.
		    media = document.createElement("img");
		    media.src = sel.url;
		    media.alt = "";
		    media.draggable = false;
		    media.setAttribute("decoding", "async");
		    media.className = "webg-media";
		  }
		  attachStillSampling(media, sel);
		  attachMediaError(media, sel);
		  return media;
		}

		function attachStillSampling(media, sel) {
		  const type = sel && sel.type;
		  // Web wallpapers cannot be sampled — the sandboxed iframe's origin is
		  // opaque, so its pixels are unreadable. Only video/img frames feed the
		  // smart veil.
		  if (type !== "video" && type !== "image") return;
		  media.addEventListener(type === "video" ? "loadeddata" : "load", () => {
		    sampleWallpaperLuminance();
		    applyEffects();
		  });
		}

		function attachMediaError(media, sel) {
		  media.addEventListener("error", () => {
		    const id = sel.id;
		    const count = (mediaFailures.get(id) || 0) + 1;
		    mediaFailures.set(id, count);
		    const w = selection.inventory.wallpapers.find((x) => x.id === id);
		    if (count === 1) {
		      // Maybe just a dead token: refetch fresh URLs and remount. Throttled
		      // PER WALLPAPER — a global window would strand a video whose first
		      // error lands soon after an unrelated recovery (no remount, no second
		      // error, blank layer until a manual refresh).
		      const now = Date.now();
		      if (now - (lastRecoveryAt.get(id) || 0) < 10000) return;
		      lastRecoveryAt.set(id, now);
		      forceRemount = true;
		      loadInventory(true);
		    } else if (w && w.preview && !demotedToPreview.has(id)) {
		      // The media itself is unusable here — fall back to the still preview.
		      demotedToPreview.add(id);
		      applySelection(id);
		    } else {
		      // Unrenderable here with no preview to fall back on (or the entry has
		      // vanished from the inventory entirely): clear the selection rather
		      // than leave a dead element on the layer.
		      applySelection("");
		    }
		  });
		}

		// ── Manual crop: drag-to-pan / wheel-to-zoom in an adjust overlay ───────────
		// The layer normally sits at z-index -2 behind the entire app, so it can
		// never receive pointer events. Adjust mode moves the LIVE layer node into a
		// topmost transparent overlay — the user edits the real thing, WYSIWYG.
		//
		// Crop geometry is chosen by the fit mode. The four object-fit modes keep a
		// GAP-FREE invariant: the media box covers the viewport exactly at zoom 1,
		// zoom floors at 1, pan is clamped to ±(zoom−1)/2·100 %, and rotation is
		// forced to 0 — a rotated rectangle cannot cover the screen, so turning
		// belongs to free mode only. Mirroring is allowed everywhere: a flip is
		// symmetric and never breaks coverage. The "free" mode drops the gap-free
		// invariant on purpose: the media sits at natural size on a black canvas,
		// zoom runs 0.1–4×, rotation is arbitrary, and pan is only clamped to keep
		// a sliver (≥10 % of the box) on screen so the wallpaper can never be
		// dragged entirely out of sight.
		function clampCrop() {
		  if (!isFreeFit()) selection.rotation = 0;
		  else {
		    // Keep the stored angle canonical (−180, 180]: Alt+drag can accumulate
		    // several full turns, and persisting raw degrees would come back from
		    // storage truncated at the ±1080 read clamp — a DIFFERENT visual angle.
		    // Modulo keeps every equivalent representation identical on disk.
		    selection.rotation = ((selection.rotation + 180) % 360 + 360) % 360 - 180;
		  }
		  selection.zoom = Math.round(Math.min(4, Math.max(isFreeFit() ? 0.1 : 1, selection.zoom)) * 100) / 100;
		  if (isFreeFit()) {
		    // Content spans ±zoom·50 % of the box around its centre; the pan offset
		    // shifts it by its own % of the box. Rotation expands the projected
		    // extent by k = |cos θ| + |sin θ| (up to √2 at 45°). |offset| ≤
		    // (zoom·k+1)·50 − 10 keeps ≥10 % of the media visible in both axes.
		    const rad = selection.rotation * Math.PI / 180;
		    const k = Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
		    const reach = (selection.zoom * k + 1) * 50 - 10;
		    selection.offsetX = Math.min(reach, Math.max(-reach, selection.offsetX));
		    selection.offsetY = Math.min(reach, Math.max(-reach, selection.offsetY));
		    return;
		  }
		  const pan = (selection.zoom - 1) * 50;
		  selection.offsetX = Math.min(pan, Math.max(-pan, selection.offsetX));
		  selection.offsetY = Math.min(pan, Math.max(-pan, selection.offsetY));
		}

		function isFreeFit() {
		  return selection.fit === "free";
		}

		let adjustOverlay = null;
		let adjustCleanup = null;

		function exitAdjust() {
		  if (!adjustOverlay) return;
		  const layer = document.getElementById(LAYER_ID);
		  if (adjustCleanup) adjustCleanup();
		  if (layer) document.body.appendChild(layer); // move back behind the app
		  adjustOverlay.remove();
		  adjustOverlay = null;
		  adjustCleanup = null;
		  selection.adjusting = false;
		  persistSelection();
		  emit();
		}

		function enterAdjust() {
		  const layer = document.getElementById(LAYER_ID);
		  if (!layer || adjustOverlay) return;
		  const overlay = document.createElement("div");
		  overlay.className = "webg-adjust";
		  overlay.appendChild(layer); // moves the live node into the overlay

		  const bar = document.createElement("div");
		  bar.className = "webg-adjust-bar";
		  const hint = document.createElement("span");
		  hint.className = "webg-adjust-hint";
		  hint.textContent = isFreeFit() ? S().adjustHintFree : S().adjustHint;
		  const done = document.createElement("button");
		  done.type = "button";
		  done.className = "webg-btn webg-btn--primary";
		  done.textContent = S().adjustDone;
		  bar.appendChild(hint);
		  // Free fit only: a rotated rectangle cannot cover the screen, so turning
		  // exists solely where exposed edges are allowed. ±90° buttons cover the
		  // common cases; arbitrary angles come from Alt+drag below.
		  if (isFreeFit()) {
		    for (const dir of [-90, 90]) {
		      const rot = document.createElement("button");
		      rot.type = "button";
		      rot.className = "webg-btn";
		      rot.textContent = dir < 0 ? S().rotateCcw : S().rotateCw;
		      rot.title = dir < 0 ? S().rotateCcwTitle : S().rotateCwTitle;
		      rot.addEventListener("click", () => {
		        selection.rotation += dir;
		        clampCrop();
		        applyEffects();
		        persistSelection();
		      });
		      bar.appendChild(rot);
		    }
		  }
		  bar.appendChild(done);
		  overlay.appendChild(bar);
		  document.body.appendChild(overlay);
		  adjustOverlay = overlay;
		  selection.adjusting = true;

		  // translate() in the transform list is applied AFTER scale() (right-to-
		  // left), so pan deltas are independent of zoom: dx px = dx/width %.
		  let drag = null;
		  // Alt+drag (free fit): swing the media around the overlay's centre —
		  // the angle delta between pointer positions becomes the rotation delta.
		  let rot = null; // { a0: starting pointer angle, base: starting rotation }
		  const centerAngle = (e) => {
		    const cx = (overlay.clientWidth || 1) / 2;
		    const cy = (overlay.clientHeight || 1) / 2;
		    return Math.atan2(e.clientY - cy, e.clientX - cx);
		  };
		  const onPointerDown = (e) => {
		    if (e.target === done || bar.contains(e.target)) return;
		    if (e.altKey && isFreeFit()) {
		      rot = { a0: centerAngle(e), base: selection.rotation };
		    } else {
		      drag = { x: e.clientX, y: e.clientY };
		    }
		    // Capture for EITHER gesture: pointer moves must keep arriving even
		    // when the cursor leaves the window mid-swing.
		    if (overlay.setPointerCapture && e.pointerId !== undefined) {
		      try { overlay.setPointerCapture(e.pointerId); } catch {}
		    }
		  };
		  const onPointerMove = (e) => {
		    if (rot) {
		      selection.rotation = rot.base + (centerAngle(e) - rot.a0) * 180 / Math.PI;
		      clampCrop();
		      applyEffects();
		      return;
		    }
		    if (!drag) return;
		    // translate % refers to the media box, which is the viewport exactly —
		    // divide the pixel delta by it so the content tracks the cursor 1:1.
		    const w = overlay.clientWidth || 1;
		    const h = overlay.clientHeight || 1;
		    selection.offsetX += ((e.clientX - drag.x) / w) * 100;
		    selection.offsetY += ((e.clientY - drag.y) / h) * 100;
		    clampCrop(); // mode envelope: gap-free pan headroom, or free keep-visible
		    drag = { x: e.clientX, y: e.clientY };
		    applyEffects();
		  };
		  const endPointer = () => {
		    if (rot) { rot = null; persistSelection(); return; }
		    if (!drag) return;
		    drag = null;
		    persistSelection();
		  };
		  const onPointerUp = endPointer;
		  // pointercancel (touch gesture takeover): end the drag without losing the
		  // current offsets — otherwise drag stays "stuck" until the next pointerup.
		  const onPointerCancel = endPointer;
		  const onWheel = (e) => {
		    if (typeof e.preventDefault === "function") e.preventDefault();
		    // clampCrop enforces the mode's zoom floor: the gap-free modes never
		    // zoom below 1 (a shrunken box floating in empty space is not a crop)
		    // and tightening zoom re-clamps the pan so zooming back to 1 pulls the
		    // framing home; free mode shrinks down to 0.1× on its black canvas.
		    selection.zoom *= Math.exp(-(e.deltaY || 0) * 0.0012);
		    clampCrop();
		    applyEffects();
		    persistSelection();
		  };
		  const onKey = (e) => { if (e.key === "Escape") exitAdjust(); };
		  const onDone = () => exitAdjust();

		  overlay.addEventListener("pointerdown", onPointerDown);
		  overlay.addEventListener("pointermove", onPointerMove);
		  overlay.addEventListener("pointerup", onPointerUp);
		  overlay.addEventListener("pointercancel", onPointerCancel);
		  overlay.addEventListener("wheel", onWheel, { passive: false });
		  done.addEventListener("click", onDone);
		  document.addEventListener("keydown", onKey);

		  adjustCleanup = () => {
		    overlay.removeEventListener("pointerdown", onPointerDown);
		    overlay.removeEventListener("pointermove", onPointerMove);
		    overlay.removeEventListener("pointerup", onPointerUp);
		    overlay.removeEventListener("pointercancel", onPointerCancel);
		    overlay.removeEventListener("wheel", onWheel);
		    done.removeEventListener("click", onDone);
		    document.removeEventListener("keydown", onKey);
		  };
		  emit();
		}

		function resetCrop() {
		  selection.zoom = 1;
		  selection.offsetX = 0;
		  selection.offsetY = 0;
		  selection.rotation = 0; // framing geometry home; mirroring keeps its own toggle
		  persistSelection();
		  applyEffects();
		  emit();
		}

		// Crossfade/clear leave timers: tracked so dispose can cancel them instead of
		// letting them fire on torn-down nodes afterwards.
		const pendingTimers = new Set();
		function schedule(fn, ms) {
		  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
		    fn();
		    return null;
		  }
		  const token = window.setTimeout(() => {
		    pendingTimers.delete(token);
		    fn();
		  }, ms);
		  pendingTimers.add(token);
		  return token;
		}

		/**
		 * Swap re-minted URLs into the LIVE media element instead of remounting.
		 * An explicit refresh re-mints every token, so the element's old URL is
		 * already dead — the next seek or buffer-miss would 404 on it and trigger
		 * a full recovery restart. Hot-swapping keeps the element identity (and
		 * for video, the playback position) intact across the token change.
		 */
		function refreshLiveMediaUrls(layer) {
		  const video = layer.querySelector("video");
		  if (video && video.getAttribute("src") !== selection.url) {
		    const at = video.currentTime;
		    video.src = selection.url;
		    if (at > 0) {
		      video.addEventListener("loadedmetadata", () => {
		        try { video.currentTime = at; } catch { /* not seekable yet */ }
		      }, { once: true });
		    }
		  }
		  const img = layer.querySelector("img");
		  if (img && img.getAttribute("src") !== selection.url) img.src = selection.url;
		  const frame = layer.querySelector("iframe");
		  if (frame && frame.getAttribute("src") !== selection.url) frame.src = selection.url;
		}

		function syncLayers() {
		  const existing = document.getElementById(LAYER_ID);

		  if (selection.url) {
		    // Key by wallpaper id, NOT by media URL: inventory rebuilds re-mint
		    // tokens, so a URL-keyed comparison would reload the playing video on
		    // every refresh. A genuinely dead URL is recovered via forceRemount.
		    const wantKey = selection.type + "|" + selection.id;
		    const gotKey = existing && existing.dataset.webgKey;

		    if (existing && gotKey === wantKey && !forceRemount) {
		      // Same wallpaper — adopt any re-minted URL, then only play/pause may
		      // have changed.
		      refreshLiveMediaUrls(existing);
		    } else {
		      forceRemount = false;
		      // Crossfade: the new layer fades in over the old one; the old layer
		      // surrenders the id FIRST so getElementById resolves to the new one.
		      if (existing) existing.removeAttribute("id");
		      const node = document.createElement("div");
		      node.id = LAYER_ID;
		      node.className = "webg-layer webg-layer--enter";
		      node.dataset.webgKey = wantKey;
		      node.appendChild(buildMedia(selection));
		      document.body.appendChild(node);
		      void node.offsetHeight; // style flush so the enter transition runs
		      node.classList.remove("webg-layer--enter");
		      if (existing) {
		        existing.classList.add("webg-layer--leave");
		        const stale = existing;
		        schedule(() => stale.remove(), LEAVE_MS);
		      }
		    }
		    const node = document.getElementById(LAYER_ID);
		    const video = node && node.querySelector("video");
		    if (video) {
		      if (effectivePlaying()) { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {} }
		      else video.pause();
		    }
		  } else if (existing) {
		    // Clearing: fade out, then tear down scrim + frame transparency when the
		    // fade completes — unless a new wallpaper was applied meanwhile.
		    existing.removeAttribute("id");
		    existing.classList.add("webg-layer--leave");
		    const stale = existing;
		    schedule(() => {
		      stale.remove();
		      if (!document.getElementById(LAYER_ID)) {
		        const s = document.getElementById(SCRIM_ID);
		        if (s) s.remove();
		        document.body.removeAttribute(ACTIVE_ATTR);
		      }
		    }, LEAVE_MS);
		  }

		  // Scrim: present while a wallpaper is active. On clear it outlives the
		  // layer until the fade-out finishes, so the veil fades WITH the wallpaper.
		  if (selection.url) {
		    const scrim = document.getElementById(SCRIM_ID);
		    if (!scrim) {
		      const s = document.createElement("div");
		      s.id = SCRIM_ID;
		      s.className = "webg-scrim";
		      document.body.appendChild(s);
		    }
		    document.body.setAttribute(ACTIVE_ATTR, "on");
		  }
		}

		// ── Effect application: push the knobs into CSS variables ───────────────────
		// Wallpaper luminance sampled from the live media (null until the first
		// sample; iframes of web wallpapers can never be sampled — opaque origin).
		let sampledLuminance = null;
		let sampleCanvas = null;
		// Snapshot of every input applyEffects reads, from its last full write. The
		// store emits once per second for the FPS readout — without this guard every
		// tick would rewrite all CSS variables AND force a synchronous layout for
		// nothing. clearEffects() resets it so the next apply always writes.
		let lastEffectKey = null;

		/** Average Rec.601 luminance (0..1) of the current video/img, or null. */
		function sampleWallpaperLuminance() {
		  if (typeof document === "undefined") return;
		  const layer = document.getElementById(LAYER_ID);
		  const media = layer && (layer.querySelector("video") || layer.querySelector("img"));
		  if (!media) { sampledLuminance = null; return; }
		  try {
		    if (!sampleCanvas) {
		      const c = document.createElement("canvas");
		      if (typeof c.getContext !== "function") return; // no canvas → no sampling
		      c.width = 16; c.height = 16;
		      sampleCanvas = c;
		    }
		    const g = sampleCanvas.getContext("2d", { willReadFrequently: true });
		    g.drawImage(media, 0, 0, 16, 16);
		    const d = g.getImageData(0, 0, 16, 16).data;
		    if (!d || d.length < 4) return; // unreadable frame → keep previous sample
		    let sum = 0;
		    for (let i = 0; i < d.length; i += 4) {
		      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
		    }
		    sampledLuminance = sum / (d.length / 4) / 255;
		  } catch { /* frame not ready / unreadable → keep the previous sample */ }
		}

		function applyEffects() {
		  // The veil OPPOSES the text colour: dark theme (light text) darkens bright
		  // wallpapers, light theme (dark text) brightens dark ones — either way the
		  // text side wins. This is what makes ANY wallpaper survivable.
		  const dark = Boolean(document.body.hasAttribute && document.body.hasAttribute("data-ds-dark-theme"));
		  const key = [
		    dark, selection.scrim, selection.border, selection.blur, selection.wallpaperBlur,
		    selection.autoScrim, sampledLuminance, selection.fit, selection.zoom,
		    selection.offsetX, selection.offsetY, selection.rotation, selection.mirrored,
		  ].join("\u0000");
		  if (key === lastEffectKey) return; // nothing it reads changed → no writes, no reflow
		  lastEffectKey = key;
		  const s = document.body.style;
		  let alpha = selection.scrim;
		  if (selection.autoScrim && sampledLuminance !== null) {
		    // Distance of the wallpaper's brightness from the "comfortable middle"
		    // towards the text colour's weakness, mapped to a veil-alpha floor.
		    const need = dark
		      ? Math.min(0.55, Math.max(0, sampledLuminance - 0.5))
		      : Math.min(0.55, Math.max(0, 0.5 - sampledLuminance));
		    alpha = Math.max(alpha, Math.round(need * 1000) / 1000);
		  }
		  const veilColor = "rgba(" + (dark ? "0,0,0" : "255,255,255") + "," + alpha + ")";
		  s.setProperty("--webg-scrim-color", veilColor);
		  s.setProperty("--webg-border-alpha", String(selection.border));
		  s.setProperty("--webg-blur", selection.blur + "px");
		  // The glass "colour melt" scales with blur radius: 0 blur → no melt.
		  s.setProperty("--webg-saturate", String(1.15 + selection.blur * 0.028));
		  s.setProperty("--webg-glass-brightness", "1.04");
		  // At 0 blur, keep the media OUT of the filter pipeline entirely: even
		  // blur(0px) forces an extra raster/compositing pass, and the noise overlay
		  // would still occupy a layer at opacity 0. filter:none + display:none keep
		  // the pixels bit-exact and the layer list minimal.
		  s.setProperty("--webg-media-filter",
		    selection.wallpaperBlur > 0
		      ? "blur(" + selection.wallpaperBlur + "px) saturate(1.08)"
		      : "none");
		  s.setProperty("--webg-noise-display", selection.wallpaperBlur > 0 ? "block" : "none");
		  // Dither-noise strength scales with blur: invisible at 0, ~4% at 60px.
		  s.setProperty("--webg-noise-opacity",
		    selection.wallpaperBlur > 0 ? (0.02 + selection.wallpaperBlur * 0.0004).toFixed(4) : "0");
		  // Canvas fit: object-fit base mode plus the user's manual crop — pan
		  // offsets (percent of the media box) and zoom, applied as a transform so
		  // no remount is ever needed while dragging. "free" draws at natural size
		  // (object-fit: none) and paints the layer black, so exposed edges read as
		  // a canvas instead of whatever sits behind the app frame.
		  s.setProperty("--webg-fit", selection.fit === "free" ? "none" : selection.fit);
		  s.setProperty("--webg-layer-bg", selection.fit === "free" ? "#000" : "transparent");
		  s.setProperty("--webg-zoom", String(selection.zoom));
		  s.setProperty("--webg-offset-x", selection.offsetX + "%");
		  s.setProperty("--webg-offset-y", selection.offsetY + "%");
		  s.setProperty("--webg-rotate", selection.rotation + "deg");
		  s.setProperty("--webg-mirror", selection.mirrored ? "-1" : "1");

		  // Write the scrim colour directly too, then force a synchronous layout, so
		  // slider feedback lands on this frame even on stalled compositors.
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = veilColor;
		  if (document.body && document.body.offsetHeight !== undefined) {
		    void document.body.offsetHeight;
		  }
		}

		function clearEffects() {
		  lastEffectKey = null;
		  const s = document.body.style;
		  s.removeProperty("--webg-scrim-color");
		  s.removeProperty("--webg-border-alpha");
		  s.removeProperty("--webg-blur");
		  s.removeProperty("--webg-saturate");
		  s.removeProperty("--webg-glass-brightness");
		  s.removeProperty("--webg-media-filter");
		  s.removeProperty("--webg-noise-display");
		  s.removeProperty("--webg-noise-opacity");
		  s.removeProperty("--webg-fit");
		  s.removeProperty("--webg-layer-bg");
		  s.removeProperty("--webg-zoom");
		  s.removeProperty("--webg-offset-x");
		  s.removeProperty("--webg-offset-y");
		  s.removeProperty("--webg-rotate");
		  s.removeProperty("--webg-mirror");
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = "";
		}

		// ── Settings picker ─────────────────────────────────────────────────────────
		function SliderRow(label, min, max, step, value, onInput, suffix) {
		  // A Fragment of three cells — the surrounding .webg-effects grid keeps
		  // every slider starting and ending at the same x regardless of how wide
		  // the label text is (壁纸模糊 vs 暗化 vs Wallpaper blur…).
		  // --webg-p feeds the filled-track gradient; updated inline while dragging
		  // so the fill tracks the thumb even between re-renders.
		  const pct = ((value - min) / (max - min)) * 100;
		  const set = (e) => {
		    const v = Number(e.target.value);
		    if (e.target.style && typeof e.target.style.setProperty === "function") {
		      e.target.style.setProperty("--webg-p", String(((v - min) / (max - min)) * 100));
		    }
		    onInput(v);
		  };
		  return React.createElement(React.Fragment, null,
		    React.createElement("span", { className: "webg-hint webg-label" }, label),
		    React.createElement("input", {
		      className: "webg-slider", type: "range",
		      min: String(min), max: String(max), step: String(step),
		      value: String(value),
		      style: { "--webg-p": String(pct) },
		      // React normalizes onChange on range inputs to the DOM input event —
		      // it fires CONTINUOUSLY while dragging. Registering onInput too would
		      // run the handler twice per tick.
		      onChange: set,
		    }),
		    React.createElement("span", { className: "webg-hint webg-value" }, suffix),
		  );
		}

		function typeBadge(w, t) {
		  if (w.type === "video") return t.badgeVideo;
		  return t.badgeWeb;
		}

		function matchesQuery(w, q) {
		  if (!q) return true;
		  const needle = q.toLowerCase();
		  return (w.title || "").toLowerCase().includes(needle) || (w.id || "").toLowerCase().includes(needle);
		}

		/** Preview <img>, or the "no preview" placeholder — shared by grid + editor. */
		function PreviewMedia(w, t) {
		  return w.preview
		    ? React.createElement("img", {
		        src: w.preview, alt: w.title, loading: "lazy", decoding: "async",
		        onError: (e) => { e.target.style.display = "none"; },
		      })
		    : React.createElement("span", { className: "webg-card-placeholder" }, t.noPreview);
		}

		function ThumbCard(w, selected, onClick, t) {
		  return React.createElement("button", {
		    key: w.id,
		    className: "webg-card" + (selected ? " webg-card--selected" : ""),
		    type: "button",
		    onClick: onClick,
		    title: w.title + "(" + typeBadge(w, t) + ")",
		  },
		  PreviewMedia(w, t),
		  React.createElement("span", { className: "webg-card-type" }, typeBadge(w, t)),
		  React.createElement("span", { className: "webg-card-title" }, w.title),
		  );
		}

		/** Preset switch intervals offered by the rotation UI (minutes). */
		const ROTATION_INTERVALS = [1, 5, 10, 30, 60, 120];

		/**
		 * <option> list for an interval select. A persisted interval outside the
		 * preset steps (imported groups, hand-edited storage) still gets a matching
		 * option — otherwise the select would silently display the first preset
		 * instead of reality.
		 */
		function intervalOptions(current, t) {
		  return [...new Set([...ROTATION_INTERVALS, current])]
		    .sort((x, y) => x - y)
		    .map((minutes) => React.createElement("option", {
		      key: minutes, value: String(minutes),
		    }, t.minutes(minutes)));
		}

		// ── Picker actions (module scope) ────────────────────────────────────────────
		// Every control mutates the shared selection store and emits; none closes
		// over React state, so they live outside the component — stable across
		// re-renders (the picker re-renders once per second for the FPS readout)
		// and testable without mounting anything.

		function onTogglePlay() { selection.playing = !selection.playing; emit(); }

		function onClear() { applySelection(""); }

		function onRefresh() {
		  // A manual refresh also retries wallpapers previously demoted to their
		  // preview after decode failures.
		  demotedToPreview.clear();
		  mediaFailures.clear();
		  lastRecoveryAt.clear();
		  loadInventory(true);
		}

		function onLangChange(e) {
		  selection.lang = e.target.value;
		  persistSelection();
		  emit();
		}

		function onGroupChange(e) {
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
		}

		function onToggleRotation() {
		  selection.rotationEnabled = !selection.rotationEnabled;
		  // The checkbox is disabled without a usable group, so a group id always
		  // exists here when enabling.
		  if (selection.rotationEnabled &&
		      !rotationCandidates().some((w) => w.id === selection.id)) {
		    const first = rotationCandidates()[0];
		    if (first) { applySelection(first.id); return; }
		  }
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function onGroupInterval(e) {
		  const group = activeRotationGroup();
		  if (!group) return;
		  group.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval);
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function onDeleteGroup() {
		  const group = activeRotationGroup();
		  if (!group) return;
		  if (typeof window !== "undefined" && typeof window.confirm === "function") {
		    if (!window.confirm(S().confirmDelete(group.name))) return;
		  }
		  deleteGroup(group.id);
		}

		function onTogglePauseOnHidden() {
		  selection.pauseOnHidden = !selection.pauseOnHidden;
		  if (selection.pauseOnHidden) {
		    // Re-enabling while already hidden must re-apply the reason — the
		    // visibilitychange listener only fires on CHANGES.
		    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
		      setAutoPause("hidden", true);
		    }
		  } else {
		    setAutoPause("hidden", false);
		  }
		  persistSelection();
		  emit();
		}

		function onTogglePauseOnBattery() {
		  selection.pauseOnBattery = !selection.pauseOnBattery;
		  if (selection.pauseOnBattery) applyBatteryPause(); // re-evaluate NOW
		  else setAutoPause("battery", false);
		  persistSelection();
		  emit();
		}

		function onToggleAutoScrim() {
		  selection.autoScrim = !selection.autoScrim;
		  persistSelection();
		  applyEffects();
		  emit();
		}

		function onScrim(pct) { selection.scrim = pct / 100; persistSelection(); applyEffects(); emit(); }
		function onBorder(pct) { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); }
		function onBlur(px) { selection.blur = px; persistSelection(); applyEffects(); emit(); }
		function onWallpaperBlur(px) { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); }

		function onFit(e) {
		  selection.fit = FIT_MODES.indexOf(e.target.value) >= 0 ? e.target.value : "cover";
		  // Re-seat the crop into the new mode's envelope: leaving free for a
		  // gap-free mode pulls zoom back up to 1, reins the pan in and zeroes the
		  // rotation; the other direction only ever relaxes bounds, so the framing
		  // carries over. Mirroring survives every switch — a flip never breaks
		  // coverage.
		  clampCrop();
		  persistSelection();
		  applyEffects();
		  emit();
		}

		function onToggleMirror() {
		  selection.mirrored = !selection.mirrored;
		  persistSelection();
		  applyEffects();
		  emit();
		}

		// ── Picker sections (presentational; every input arrives as an argument) ────
		// WallpaperPicker composes these in a fixed order. Each one owns exactly one
		// visual row/block of the settings panel and produces the same DOM the old
		// monolithic render did.

		function SearchRow(t, sel, query, setQuery, matched, total) {
		  return React.createElement("div", { className: "webg-row" },
		    React.createElement("input", {
		      className: "webg-text webg-search", type: "search",
		      placeholder: t.searchPlaceholder,
		      value: query,
		      onInput: (e) => setQuery(e.target.value),
		    }),
		    query.trim() && React.createElement("span", { className: "webg-hint" },
		      t.matched(matched, total)),
		    React.createElement("label", { className: "webg-lang" },
		      React.createElement("span", { className: "webg-hint" }, t.language),
		      React.createElement("select", {
		        className: "webg-select webg-lang-select",
		        value: sel.lang,
		        onChange: onLangChange,
		      },
		      React.createElement("option", { value: "auto" }, t.langAuto),
		      React.createElement("option", { value: "zh" }, "中文"),
		      React.createElement("option", { value: "en" }, "English"),
		      ),
		    ),
		  );
		}

		function WallpaperGrid(t, sel, usableList, filteredList, q) {
		  return React.createElement("div", { className: "webg-grid" },
		    React.createElement("button", {
		      className: "webg-card" + (sel.id ? "" : " webg-card--selected"),
		      type: "button",
		      onClick: onClear,
		      title: t.closeTitle,
		    },
		    React.createElement("span", { className: "webg-card-close" }, t.closeCard),
		    ),
		    usableList.length === 0
		      ? React.createElement("span", { className: "webg-hint" },
		          sel.inventory.installDir
		            ? (sel.inventory.total > 0
		                ? t.emptyNoUsable(sel.inventory.total)
		                : t.emptyNoProjects)
		            : t.emptyNoInstall)
		      : filteredList.length === 0
		        ? React.createElement("span", { className: "webg-hint" }, t.noMatch(q))
		        : filteredList.map((w) => ThumbCard(w, w.id === sel.id, () => applySelection(w.id), t)),
		  );
		}

		function ActionRow(t, sel) {
		  return React.createElement("div", { className: "webg-row" },
		    React.createElement("button", {
		      className: "webg-btn", type: "button",
		      onClick: onTogglePlay, disabled: !sel.url || sel.type !== "video",
		    }, sel.playing ? t.pause : t.play),
		    React.createElement("button", {
		      className: "webg-btn", type: "button",
		      onClick: onClear, disabled: !sel.id,
		    }, t.close),
		    React.createElement("button", {
		      className: "webg-btn", type: "button",
		      onClick: onRefresh, disabled: sel.loading,
		    }, sel.loading ? t.refreshing : t.refresh),
		  );
		}

		function RotationListRow(t, sel, groups) {
		  return React.createElement("div", { className: "webg-row webg-playlist-row" },
		    React.createElement("span", { className: "webg-hint webg-label" }, t.rotationList),
		    React.createElement("select", {
		      className: "webg-select webg-playlist-select",
		      value: sel.rotationGroupId,
		      onChange: onGroupChange,
		      disabled: groups.length === 0,
		    },
		    React.createElement("option", { value: "" }, groups.length ? t.selectList : t.noLists),
		    ...groups.map((g) => React.createElement("option", {
		      key: g.id, value: g.id,
		    }, t.groupOption(g.name, groupWallpapers(g).length, g.interval))),
		    ),
		    React.createElement("button", {
		      className: "webg-btn", type: "button", onClick: startCreateGroup,
		    }, t.newList),
		    React.createElement("button", {
		      className: "webg-btn", type: "button",
		      onClick: () => startEditGroup(sel.rotationGroupId),
		      disabled: !sel.rotationGroupId,
		    }, t.editList),
		    React.createElement("button", {
		      className: "webg-btn", type: "button",
		      onClick: onDeleteGroup,
		      disabled: !sel.rotationGroupId,
		    }, t.deleteList),
		  );
		}

		/** One toggleable wallpaper chip inside the group editor. */
		function EditorCard(w, editing, t) {
		  const checked = editing.wallpaperIds.indexOf(w.id) >= 0;
		  return React.createElement("button", {
		    key: w.id,
		    className: "webg-editor-card" + (checked ? " webg-editor-card--checked" : ""),
		    type: "button",
		    title: w.title + "(" + typeBadge(w, t) + ")",
		    onClick: () => {
		      const i = editing.wallpaperIds.indexOf(w.id);
		      if (i >= 0) editing.wallpaperIds.splice(i, 1);
		      else editing.wallpaperIds.push(w.id);
		      emit();
		    },
		  },
		  PreviewMedia(w, t),
		  checked && React.createElement("span", { className: "webg-editor-check" }, "✓"),
		  );
		}

		function GroupEditorPanel(t, sel, usableList, editorQuery, setEditorQuery) {
		  const editing = sel.editing;
		  return React.createElement("div", { className: "webg-editor" },
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("span", { className: "webg-hint webg-label" }, t.name),
		      React.createElement("input", {
		        className: "webg-text", type: "text",
		        value: editing.name,
		        onInput: (e) => { editing.name = e.target.value; emit(); },
		      }),
		    ),
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("span", { className: "webg-hint webg-label" }, t.interval),
		      React.createElement("select", {
		        className: "webg-select",
		        value: String(editing.interval),
		        onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
		      },
		      ...intervalOptions(editing.interval, t)),
		      React.createElement("span", { className: "webg-hint webg-label" }, t.order),
		      React.createElement("select", {
		        className: "webg-select webg-playlist-select",
		        value: editing.order,
		        onChange: (e) => { editing.order = e.target.value; emit(); },
		      },
		      React.createElement("option", { value: "sequence" }, t.sequence),
		      React.createElement("option", { value: "random" }, t.random),
		      ),
		    ),
		    React.createElement("input", {
		      className: "webg-text", type: "search",
		      placeholder: t.filterPlaceholder,
		      value: editorQuery,
		      onInput: (e) => setEditorQuery(e.target.value),
		    }),
		    React.createElement("div", { className: "webg-editor-grid" },
		      (() => {
		        const eq = editorQuery.trim();
		        const pool = usableList.filter((w) => matchesQuery(w, eq));
		        if (usableList.length === 0) {
		          return React.createElement("span", { className: "webg-hint" }, t.noUsable);
		        }
		        if (pool.length === 0) {
		          return React.createElement("span", { className: "webg-hint" }, t.noMatch(eq));
		        }
		        return pool.map((w) => EditorCard(w, editing, t));
		      })(),
		    ),
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("span", { className: "webg-hint" }, t.selectedCount(editing.wallpaperIds.length)),
		      sel.inventory.playlists.length > 0 && React.createElement("select", {
		        className: "webg-select webg-playlist-select",
		        value: "",
		        onChange: (e) => {
		          const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
		          if (p) importPlaylistIntoDraft(p);
		        },
		      },
		      React.createElement("option", { value: "" }, t.importPlaylist),
		      ...sel.inventory.playlists.map((p) => React.createElement("option", {
		        key: p.id, value: p.id,
		      }, t.playlistOption(p.name, p.portableCount || 0))),
		      ),
		    ),
		    React.createElement("div", { className: "webg-row" },
		      React.createElement("button", {
		        className: "webg-btn webg-btn--primary", type: "button",
		        onClick: saveEditingGroup,
		      }, t.save),
		      React.createElement("button", {
		        className: "webg-btn", type: "button",
		        onClick: cancelEditGroup,
		      }, t.cancel),
		    ),
		  );
		}

		function RotationControlsRow(t, sel, group, usableCount) {
		  return React.createElement("div", { className: "webg-row webg-rotation-row" },
		    React.createElement("label", { className: "webg-toggle" },
		      React.createElement("input", {
		        type: "checkbox",
		        checked: sel.rotationEnabled,
		        onChange: onToggleRotation,
		        disabled: !sel.rotationGroupId || usableCount < 2,
		      }),
		      t.autoRotate,
		    ),
		    React.createElement("select", {
		      className: "webg-select webg-rotation-interval",
		      value: String(group ? group.interval : DEFAULTS.rotationInterval),
		      onChange: onGroupInterval,
		      disabled: !sel.rotationEnabled || !sel.rotationGroupId || usableCount < 2,
		      title: t.intervalTitle,
		    },
		    ...intervalOptions(group ? group.interval : DEFAULTS.rotationInterval, t)),
		    !sel.rotationGroupId && React.createElement("span", { className: "webg-hint" }, t.needList),
		    sel.rotationGroupId && usableCount < 2 && React.createElement("span", { className: "webg-hint" }, t.needTwo),
		  );
		}

		function EffectsPanel(t, sel) {
		  return React.createElement(React.Fragment, null,
		    // The fit select covers all wallpaper types: for video/stills it picks
		    // the object-fit base mode, and "free" additionally unlocks shrink +
		    // off-edge dragging for every kind — an iframe ignores object-fit, but
		    // the zoom/pan transform applies to it the same way. The manual crop
		    // (drag / wheel in the adjust overlay) is a plain CSS transform and
		    // applies to EVERY kind, so 调整画面 / 重置裁剪 are always available.
		    React.createElement("div", { className: "webg-row webg-fit-row" },
		      React.createElement("span", { className: "webg-hint webg-label" }, t.fit),
		      React.createElement("select", {
		        className: "webg-select webg-fit-select",
		        value: sel.fit,
		        onChange: onFit,
		      },
		      ...[t.fitCover, t.fitContain, t.fitFill, t.fitNone, t.fitFree].map((label, i) =>
		        React.createElement("option", { key: FIT_MODES[i], value: FIT_MODES[i] }, label),
		      )),
		      // Mirror is a coverage-preserving flip: valid in EVERY fit mode and
		      // for every wallpaper kind (the transform applies to iframes too).
		      React.createElement("button", {
		        className: "webg-btn" + (sel.mirrored ? " webg-btn--active" : ""),
		        type: "button",
		        onClick: onToggleMirror,
		      }, t.mirror),
		      React.createElement("button", {
		        className: "webg-btn", type: "button", onClick: enterAdjust,
		        disabled: sel.adjusting,
		      }, t.adjust),
		      (sel.zoom !== 1 || sel.offsetX !== 0 || sel.offsetY !== 0) &&
		        React.createElement("button", {
		          className: "webg-btn", type: "button", onClick: resetCrop,
		        }, t.resetCrop),
		    ),
		    React.createElement("div", { className: "webg-effects" },
		      SliderRow(t.wallpaperBlur, 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
		      SliderRow(t.scrim, 0, 90, 5, Math.min(90, Math.round(sel.scrim * 100)), onScrim,
		        Math.round(sel.scrim * 100) + "%"),
		      SliderRow(t.border, 0, 90, 5, Math.min(90, Math.round(sel.border * 100)), onBorder,
		        Math.round(sel.border * 100) + "%"),
		      SliderRow(t.glass, 0, 40, 1, sel.blur, onBlur, sel.blur + "px"),
		    ),
		  );
		}

		function MonitorRow(t, sel) {
		  return React.createElement("div", { className: "webg-row webg-monitor-row" },
		    React.createElement("label", { className: "webg-toggle" },
		      React.createElement("input", {
		        type: "checkbox", checked: sel.pauseOnHidden, onChange: onTogglePauseOnHidden,
		      }),
		      t.pauseOnHidden,
		    ),
		    React.createElement("label", { className: "webg-toggle" },
		      React.createElement("input", {
		        type: "checkbox", checked: sel.pauseOnBattery, onChange: onTogglePauseOnBattery,
		      }),
		      t.pauseOnBattery,
		    ),
		    React.createElement("label", { className: "webg-toggle", title: t.autoScrimTitle },
		      React.createElement("input", {
		        type: "checkbox", checked: sel.autoScrim, onChange: onToggleAutoScrim,
		      }),
		      t.autoScrim,
		    ),
		    sel.fps !== null && React.createElement("span", {
		      className: "webg-hint webg-fps" + (sel.fps < LOW_FPS ? " webg-fps--low" : ""),
		      title: t.fpsTitle,
		    }, sel.fps + " fps"),
		  );
		}

		function StatusRow(t, sel, group, usableCount, usableTotal) {
		  // "Auto-rotating" is claimed only when the timer is genuinely armed —
		  // rotation may be enabled on a list with fewer than 2 usable wallpapers,
		  // in which case nothing switches until the list grows.
		  const rotating = sel.rotationEnabled && usableCount >= 2;
		  return React.createElement("div", { className: "webg-row" },
		    React.createElement("span", { className: "webg-hint" },
		      (group
		        ? t.statusGroup(group.name, group.wallpaperIds.length, usableCount, group.interval,
		            group.order === "random" ? t.random : t.sequence)
		        : t.statusUsable(usableTotal)) +
		      (rotating ? " · " + t.autoRotating : "") +
		      (sel.autoPauseReasons.size > 0 ? " · " + t.autoPaused : "") +
		      (sel.id && demotedToPreview.has(sel.id) ? " · " + t.decodeFallback : "") +
		      (sel.inventory.installDir ? " · " + sel.inventory.installDir : "")),
		  );
		}

		function WallpaperPicker() {
		  const sel = useStore();
		  const [query, setQuery] = React.useState("");
		  const [editorQuery, setEditorQuery] = React.useState("");
		  const t = S();

		  if (!sel.loaded) {
		    return React.createElement("div", { className: "webg-picker" },
		      React.createElement("span", { className: "webg-hint" }, t.scanning));
		  }
		  if (sel.inventory.error) {
		    return React.createElement("div", { className: "webg-picker" },
		      React.createElement("div", { className: "webg-error" },
		        t.connError + sel.inventory.error),
		      React.createElement("button", {
		        className: "webg-btn", type: "button", onClick: onRefresh, disabled: sel.loading,
		      }, sel.loading ? t.refreshing : t.retry));
		  }

		  const usableList = selectableInventory();
		  const q = query.trim();
		  const filteredList = usableList.filter((w) => matchesQuery(w, q));
		  const groups = sel.rotationGroups;
		  const group = activeRotationGroup();
		  const usableCount = rotationCandidates().length;
		  const editing = sel.editing;

		  return React.createElement("div", { className: "webg-picker" },
		    SearchRow(t, sel, query, setQuery, filteredList.length, usableList.length),
		    WallpaperGrid(t, sel, usableList, filteredList, q),
		    ActionRow(t, sel),
		    RotationListRow(t, sel, groups),
		    editing && GroupEditorPanel(t, sel, usableList, editorQuery, setEditorQuery),
		    RotationControlsRow(t, sel, group, usableCount),
		    sel.id && EffectsPanel(t, sel),
		    sel.id && MonitorRow(t, sel),
		    sel.id && sel.fps !== null && sel.fps < LOW_FPS && sel.type === "video" &&
		      React.createElement("div", { className: "webg-row" },
		        React.createElement("span", { className: "webg-hint" }, t.lowFpsHint)),
		    StatusRow(t, sel, group, usableCount, usableList.length),
		  );
		}

		// ── Styles ──────────────────────────────────────────────────────────────────
		// Everything reads DSH design tokens (--dsw-*) so the UI blends into the
		// shell and follows light/dark theme switches automatically.
		const CSS = `
		  /* Wallpaper layers: fixed, sunk below the app frame, crossfading. The
		     background paints black only in the "free" fit mode, where the media
		     can be dragged off the edges and the exposed area reads as a canvas. */
		  .webg-layer {
		    position: fixed; inset: 0; z-index: -2; overflow: hidden;
		    pointer-events: none; opacity: 1;
		    background: var(--webg-layer-bg, transparent);
		    transition: opacity ${CROSSFADE_MS}ms ease;
		  }
		  .webg-layer--enter { opacity: 0; }
		  .webg-layer--leave { opacity: 0; }
		  /* The media box is ALWAYS exactly the layer. Blur must never re-frame the
		     content: enlarging the box for overscan made object-fit:cover scale the
		     picture up to fill the bigger box, silently cropping the wallpaper's
		     four edges — and once cropped, no zoom could bring them back. Instead the
		     Gaussian's natural edge fade (≤ one blur radius, under the veil and the
		     UI chrome) is accepted. A slight saturate keeps blurred colours from
		     washing out. */
		  .webg-layer .webg-media {
		    position: absolute;
		    inset: 0;
		    width: 100%;
		    height: 100%;
		    max-width: none; max-height: none;
		    object-fit: var(--webg-fit, cover);
		    object-position: center;
		    display: block;
		    background: transparent; border: 0;
		    filter: var(--webg-media-filter, none);
		    /* Manual crop: the transform list is ordered pan → rotate → zoom →
		       mirror. translate comes first so pan offsets stay screen-aligned no
		       matter the rotation; mirror is innermost so the flip happens in the
		       media's own axes. */
		    transform: translate(var(--webg-offset-x, 0%), var(--webg-offset-y, 0%))
		      rotate(var(--webg-rotate, 0deg)) scale(var(--webg-zoom, 1))
		      scaleX(var(--webg-mirror, 1));
		    transform-origin: center center;
		  }

		  /* Crop-adjust overlay: topmost, transparent — only its hint bar is chrome.
		     The live layer is moved INSIDE, so editing is what-you-see. */
		  .webg-adjust {
		    position: fixed; inset: 0; z-index: 2147483000;
		    cursor: grab; touch-action: none;
		  }
		  .webg-adjust:active { cursor: grabbing; }
		  .webg-adjust .webg-layer { position: absolute; z-index: 0; }
		  .webg-adjust-bar {
		    position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
		    z-index: 1; cursor: default;
		    display: flex; align-items: center; gap: 12px;
		    padding: 8px 8px 8px 14px; border-radius: 12px;
		    background: var(--dsw-alias-bg-overlay, rgba(30, 32, 38, 0.85));
		    color: var(--dsw-alias-label-primary, inherit);
		    backdrop-filter: blur(20px);
		    -webkit-backdrop-filter: blur(20px);
		    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
		    font-size: 12px; white-space: nowrap;
		  }

		  /* Gaussian blur alone shows banding on smooth gradients; a whisper of
		     fractal noise over the layer dithers it away (iOS does the same inside
		     its frosted materials). display:none at zero blur — no layer, no cost. */
		  .webg-layer::after {
		    content: ""; position: absolute; inset: 0; pointer-events: none;
		    display: var(--webg-noise-display, none);
		    opacity: var(--webg-noise-opacity, 0);
		    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="120" height="120" filter="url(%23n)"/></svg>');
		    background-size: 120px 120px;
		    mix-blend-mode: overlay;
		  }

		  /* Scrim: above the wallpaper (-1 > -2), below the UI. */
		  .webg-scrim {
		    position: fixed; inset: 0; z-index: -1;
		    pointer-events: none;
		    background: var(--webg-scrim-color, rgba(0, 0, 0, 0.25));
		    transition: background 120ms linear;
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
		      inset 0 1px 0 rgba(255, 255, 255, 0.32),
		      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
		      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
		      0 12px 40px rgba(0, 0, 0, 0.12);
		  }

		  /* ── Picker chrome (token-driven, theme-aware) ── */
		  /* padding-top lifts the first row off the settings-section divider so the
		     search/language row breathes; gap keeps every row evenly spaced.
		     Type scale follows the shell: 14px body → 13px controls → 12px hints. */
		  .webg-picker { display: flex; flex-direction: column; gap: 12px; padding-top: 10px; }
		  .webg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
		  .webg-hint { font-size: 12px; opacity: 0.7; color: var(--dsw-alias-label-tertiary, inherit); }
		  .webg-error {
		    font-size: 13px;
		    color: var(--dsw-alias-state-error-primary, #d44);
		  }
		  .webg-label { white-space: nowrap; }
		  .webg-value { min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }

		  .webg-btn {
		    cursor: pointer;
		    padding: 4px 12px;
		    border-radius: 6px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
		    color: var(--dsw-alias-label-primary, inherit);
		    font-size: 12px;
		    transition: background-color 120ms ease, border-color 120ms ease;
		  }
		  /* Ghost-button hover rides the shell's own interactive-hover token. */
		  .webg-btn:hover:not(:disabled) {
		    background: var(--dsw-alias-interactive-bg-hover,
		      var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.2)));
		    border-color: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.5));
		  }
		  .webg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
		  /* brand-primary is monochrome (near-black light / near-white dark). The
		     shell's brand-primary-INVERT token aliases the same shade as brand-
		     primary itself in both themes (no contrast), so anything sitting ON a
		     brand-primary fill takes its contrast colour from the inverted label
		     ramp instead — near-white on the dark light-theme fill, dark bluish-800
		     on the near-white dark-theme fill. */
		  body {
		    --webg-on-brand: var(--dsw-alias-label-primary-inverted,
		      var(--dsw-alias-label-primary-foreground, rgb(249, 250, 251)));
		  }
		  .webg-btn--primary {
		    background: var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    border-color: transparent;
		    color: var(--webg-on-brand);
		  }
		  .webg-btn--primary:hover:not(:disabled) {
		    background: var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    opacity: 0.85;
		  }
		  /* Toggle-style button showing an engaged state (e.g. 镜像): brand fill
		     with the contrasting on-brand label. */
		  .webg-btn--active {
		    background: var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    border-color: transparent;
		    color: var(--webg-on-brand);
		  }

		  .webg-select, .webg-text {
		    padding: 5px 10px;
		    border-radius: 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
		    color: var(--dsw-alias-label-primary, inherit);
		    font-size: 13px;
		    transition: border-color 120ms ease, background-color 120ms ease;
		  }
		  /* Custom select: drop the OS chrome, draw our own chevron (mid-gray reads
		     on both light and dark themes), roomier hit area, shell-style focus. */
		  .webg-select {
		    -webkit-appearance: none;
		    appearance: none;
		    padding-right: 28px;
		    cursor: pointer;
		    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="%23888" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
		    background-repeat: no-repeat;
		    background-position: right 10px center;
		  }
		  .webg-select:hover:not(:disabled), .webg-text:hover:not(:disabled) {
		    border-color: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.5));
		  }
		  .webg-select:focus-visible, .webg-text:focus-visible {
		    outline: 2px solid var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    outline-offset: 1px;
		  }
		  .webg-select:disabled { opacity: 0.45; cursor: not-allowed; }
		  .webg-text { flex: 1; min-width: 0; }
		  .webg-search { max-width: 320px; }
		  .webg-lang { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
		  .webg-playlist-select { flex: 1; min-width: 0; }
		  .webg-rotation-interval { margin-left: auto; }
		  .webg-toggle {
		    display: inline-flex; align-items: center; gap: 6px;
		    accent-color: var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    font-size: 13px; cursor: pointer;
		  }

		  /* Custom range slider (Chromium): slim filled track + ringed thumb instead
		     of the default chunky control. --webg-p (0–100) drives the fill. */
		  .webg-slider {
		    -webkit-appearance: none;
		    appearance: none;
		    width: 100%; height: 22px; margin: 0;
		    background: transparent; cursor: pointer;
		  }
		  .webg-slider::-webkit-slider-runnable-track {
		    height: 4px; border-radius: 2px;
		    background: linear-gradient(to right,
		      var(--dsw-alias-brand-primary, rgb(15, 17, 21)) 0%,
		      var(--dsw-alias-brand-primary, rgb(15, 17, 21)) calc(var(--webg-p, 0) * 1%),
		      var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35)) calc(var(--webg-p, 0) * 1%));
		  }
		  .webg-slider::-webkit-slider-thumb {
		    -webkit-appearance: none;
		    width: 14px; height: 14px; border-radius: 50%;
		    margin-top: -5px; /* centers the 14px thumb on the 4px track */
		    background: var(--webg-on-brand);
		    border: 2.5px solid var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
		    transition: transform 120ms ease;
		  }
		  .webg-slider:hover::-webkit-slider-thumb,
		  .webg-slider:focus-visible::-webkit-slider-thumb { transform: scale(1.18); }
		  .webg-slider:focus-visible { outline: none; }
		  /* Effects grid: one shared grid across all slider rows, so every slider
		     starts and ends at the same x no matter how wide its label is. */
		  .webg-effects {
		    display: grid;
		    grid-template-columns: max-content 1fr 3.2em;
		    gap: 8px 10px;
		    align-items: center;
		  }
		  .webg-effects .webg-label { white-space: nowrap; }
		  .webg-effects .webg-value { text-align: right; }

		  .webg-monitor-row { gap: 14px; }
		  .webg-fps { font-variant-numeric: tabular-nums; }
		  .webg-fps--low { color: var(--dsw-alias-state-warn-primary, #b93); opacity: 1; }

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
		    outline: 2px solid var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    outline-offset: -2px;
		  }
		  .webg-card-close {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 12px; color: var(--dsw-alias-label-secondary, #888);
		  }
		  .webg-card-type {
		    position: absolute; top: 4px; right: 4px; padding: 1px 6px; border-radius: 4px;
		    font-size: 10px; line-height: 1.5;
		    color: #fff; background: rgba(0, 0, 0, 0.5);
		  }
		  .webg-card-title {
		    position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
		    font-size: 11px; line-height: 1.2; color: #fff;
		    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
		    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
		    text-align: left;
		  }
		  .webg-card-placeholder {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 11px; opacity: 0.55;
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
		    outline: 2px solid var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    outline-offset: -2px;
		  }
		  .webg-editor-check {
		    position: absolute; top: 4px; left: 4px; width: 18px; height: 18px;
		    border-radius: 4px;
		    background: var(--dsw-alias-brand-primary, rgb(15, 17, 21));
		    color: var(--webg-on-brand);
		    font-size: 12px; line-height: 18px; text-align: center;
		  }
		`;

		// ── Plugin exports ──────────────────────────────────────────────────────────
		const inject = ["slots"];

		function apply(ctx) {
		  // A plugin UPDATE re-applies this module WITHOUT re-evaluating it: the old
		  // fiber's cleanup has already set `disposed = true`, which would make the
		  // new fiber's loadInventory return forever (blank picker, no wallpaper).
		  // Every apply starts a fresh lifecycle.
		  disposed = false;

		  // 0. Language: follow the shell's locale service when present, and react
		  //    to its change events. Everything is optional — without the service
		  //    the browser language decides, and the manual override always wins.
		  const localeSvc = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
		  if (localeSvc && typeof localeSvc.getLocale === "function") {
		    try {
		      const snap = localeSvc.getLocale();
		      if (snap && snap.active) shellLang = snap.active === "en" ? "en" : "zh";
		    } catch { /* keep browser fallback */ }
		  }
		  if (typeof ctx.on === "function") {
		    try {
		      ctx.on("locale/change", (snap) => {
		        const next = snap && snap.active === "en" ? "en" : "zh";
		        if (next !== shellLang) { shellLang = next; emit(); }
		      });
		    } catch { /* event bus unavailable → static language */ }
		  }

		  // 1. Styles: owned by the fiber — injected on apply, REMOVED on dispose.
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
		      // Luminance sampler: re-reads the wallpaper periodically so a bright
		      // scene arriving mid-video re-raises the veil. (rAF-free: 2.5 s is
		      // plenty for legibility, and an idle timer costs ~nothing.)
		      let samplerId = null;
		      if (typeof window !== "undefined" && typeof window.setInterval === "function") {
		        samplerId = window.setInterval(() => {
		          sampleWallpaperLuminance();
		          applyEffects();
		        }, 2500);
		      }
		      // A theme switch flips the veil colour immediately (black ↔ white).
		      let observer = null;
		      if (typeof MutationObserver === "function") {
		        observer = new MutationObserver(() => applyEffects());
		        observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
		      }
		      return () => {
		        // Stop any in-flight inventory fetch from committing state (and
		        // re-arming the rotation timer) after teardown began.
		        disposed = true;
		        unsubLayers();
		        unsubEffects();
		        // Close the crop-adjust overlay if it is open (moves the layer back,
		        // removes the bar and its listeners) before tearing layers down.
		        exitAdjust();
		        if (samplerId !== null) window.clearInterval(samplerId);
		        if (observer) observer.disconnect();
		        sampledLuminance = null;
		        clearRotationTimer();
		        // Cancel pending crossfade/clear timers so they never fire on
		        // torn-down nodes after dispose.
		        for (const token of [...pendingTimers]) {
		          if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		            window.clearTimeout(token);
		          }
		        }
		        pendingTimers.clear();
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

		  // 3. Resource monitor: auto-pause on hidden tab / low battery, FPS meter.
		  if (ctx.effect && typeof document !== "undefined" &&
		      typeof document.addEventListener === "function") {
		    ctx.effect(() => {
		      const onVisibility = () => {
		        if (!selection.pauseOnHidden) return;
		        setAutoPause("hidden", document.visibilityState === "hidden");
		      };
		      document.addEventListener("visibilitychange", onVisibility);
		      onVisibility();
		      return () => {
		        document.removeEventListener("visibilitychange", onVisibility);
		        setAutoPause("hidden", false);
		      };
		    });
		  }
		  if (ctx.effect && typeof navigator !== "undefined" &&
		      typeof navigator.getBattery === "function") {
		    ctx.effect(() => {
		      let battery = null;
		      let cancelled = false;
		      const update = () => {
		        if (!battery) return;
		        batteryState = { charging: battery.charging, level: battery.level };
		        applyBatteryPause();
		      };
		      navigator.getBattery().then((b) => {
		        if (cancelled) return;
		        battery = b;
		        b.addEventListener("chargingchange", update);
		        b.addEventListener("levelchange", update);
		        update();
		      }).catch(() => {});
		      return () => {
		        cancelled = true;
		        if (battery) {
		          battery.removeEventListener("chargingchange", update);
		          battery.removeEventListener("levelchange", update);
		        }
		        batteryState = null;
		        setAutoPause("battery", false);
		      };
		    });
		  }
		  if (ctx.effect && typeof window !== "undefined" &&
		      typeof window.requestAnimationFrame === "function") {
		    ctx.effect(() => {
		      // FPS sampler: counts rAF callbacks once per second. rAF stops by
		      // itself in hidden tabs, so the meter idles exactly when the page does.
		      let running = true;
		      let rafId = 0;
		      let frames = 0;
		      let window0 = 0;
		      const loop = (t) => {
		        if (!running) return;
		        frames++;
		        if (window0 === 0) window0 = t;
		        else if (t - window0 >= 1000) {
		          selection.fps = Math.round((frames * 1000) / (t - window0));
		          frames = 0;
		          window0 = t;
		          emit();
		        }
		        rafId = window.requestAnimationFrame(loop);
		      };
		      rafId = window.requestAnimationFrame(loop);
		      return () => {
		        running = false;
		        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(rafId);
		        selection.fps = null;
		      };
		    });
		  }

		  // 4. Settings row (this slot is NOT the overlay; safe to register into).
		  if (ctx.slots) {
		    ctx.slots.inject("settings.general.item", () =>
		      ctx.slots.register(
		        { name: "settings.general.item", id: "we-background", order: 500, label: S().settingsLabel },
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
