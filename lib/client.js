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
		// Plugin-owned dark mirror, still written for inspection/tooling. The
		// stylesheet no longer keys on it (the material is dark-pinned, so nothing
		// branches); it just reports that the dark recipe is active.
		const DARK_ATTR = "data-webg-dark";
		const LAYER_ID = "wallpaper-engine-dsh-layer";
		const SCRIM_ID = "wallpaper-engine-dsh-scrim";
		const STYLE_TAG_ID = "wallpaper-engine-dsh/styles";
		// Edge-refraction lens (Apple Liquid Glass "lensing"). The displacement map
		// and filter live in a plugin-owned inline <svg>; the body attribute gates
		// the CSS that wires surfaces to it.
		const LENS_ATTR = "data-webg-lens";
		const LENS_SVG_ID = "wallpaper-engine-dsh-lens";
		const LENS_FILTER_ID = "webg-lens";
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
		    navLabel: "壁纸背景",
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
		    autoScrimTitle: "采样壁纸亮度,过亮时自动加强遮罩,保证文字可读",
		    pointerLight: "指针高光",
		    pointerLightTitle: "高光跟着鼠标在玻璃表面移动(默认关闭,开启后每帧重绘该表面)",
		    lens: "表面折射",
		    lensTitle: "按表面尺寸生成折射贴图;关闭后只剩背景模糊,便于对比排查",
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
		    adjustHintZoom: "当前倍数下画面已铺满,先滚轮放大,即可拖动平移",
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
		    navLabel: "Wallpaper",
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
		    pointerLight: "Pointer highlight",
		    pointerLightTitle: "The specular follows the pointer across glass surfaces (off by default; repaints that surface each frame)",
		    lens: "Surface refraction",
		    lensTitle: "Generates a refraction map per surface; off leaves plain backdrop blur, handy for comparison",
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
		    adjustHintZoom: "The picture already fills the screen — zoom in with the wheel to unlock panning",
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
		  scrim: 0.18,
		  border: 0.35,
		  blur: 5, // clearest band of the melt; past ~10 it reads frosted
		  wallpaperBlur: 0,
		  rotationEnabled: false,
		  rotationInterval: 30,
		  rotationGroupId: "",
		  rotationGroups: [],
		  rotationSeeded: false,
		  pauseOnHidden: true,
		  pauseOnBattery: true,
		  autoScrim: true,
		  pointerLight: false, // specular follows the pointer on glass surfaces
		  lens: true, // per-surface displacement map; off = plain backdrop blur
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
		      // The slider tops out at the heaviest tier cap (t3 = 14px). Offering
		      // 40px only created a dead zone: 15-40 changed nothing but the modal
		      // mask blur, so the control promised melt it never delivered.
		      blur: clampNum(o.blur, 0, 14, DEFAULTS.blur),
		      wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
		      rotationEnabled: o.rotationEnabled === true,
		      rotationGroupId: typeof o.rotationGroupId === "string" ? o.rotationGroupId : "",
		      rotationGroups: readRotationGroups(o.rotationGroups, STRINGS[browserLang() || "zh"].defaultGroupBase),
		      rotationSeeded: o.rotationSeeded === true,
		      pauseOnHidden: o.pauseOnHidden !== false,
		      pauseOnBattery: o.pauseOnBattery !== false,
		      autoScrim: o.autoScrim !== false,
		      pointerLight: o.pointerLight === true,
		      lens: o.lens !== false,
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
		      pointerLight: selection.pointerLight,
		      lens: selection.lens !== false,
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
		    // Transient fetch failures are NON-DESTRUCTIVE: the selection, rotation
		    // switches and the playing layer survive the outage untouched, so 重试
		    // simply resumes. The inventory-derived bookkeeping below must NOT run
		    // here — an empty inventory misreads every rotation group as empty,
		    // which would burn the one-time playlist seed, silently disable
		    // rotation, and wipe the persisted selection.
		    selection.loading = false;
		    selection.loaded = true;
		    emit();
		    return;
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
		// One-shot glass wake on a wallpaper switch: bump the registered --webg-rim
		// by 0.22 for a beat, then relax. applyEffects folds the bump into its rim
		// write; nulling the change key forces both passes through despite the key
		// guard. Skipped under prefers-reduced-motion AND without a timer host (the
		// verify sandbox) — a wake without a scheduled relax would wedge --webg-rim
		// at the swollen value.
		function triggerGlassWake() {
		  if (REDUCED_MOTION) return;
		  const sched = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window : null;
		  if (!sched) return;
		  glassWake = true;
		  lastEffectKey = null;
		  applyEffects();
		  if (glassWakeTimer) sched.clearTimeout(glassWakeTimer);
		  glassWakeTimer = sched.setTimeout(() => {
		    glassWake = false;
		    lastEffectKey = null;
		    applyEffects();
		  }, 450);
		}
		function applySelection(id) {
		  if (selection.adjusting) exitAdjust();
		  const prevId = selection.id;
		  selection.id = id || "";
		  if (selection.id !== prevId) {
		    if (demotedToPreview.has(selection.id)) {
		      // Deliberately re-selecting a demoted wallpaper is a retry: drop the
		      // one-way demotion AND its failure count, or the very next hiccup
		      // would climb a stale ladder and clear the wallpaper outright.
		      demotedToPreview.delete(selection.id);
		      mediaFailures.delete(selection.id);
		    }
		    // Brightness evidence belongs to the wallpaper that is showing. Any
		    // switch — video to video, video to web, web to web — drops the previous
		    // sample at once; the new media's first frame (or its preview probe)
		    // refills it. Re-applying the SAME id (token refresh, demotion) keeps the
		    // sample, so a retry does not flash the neutral veil.
		    sampledLuminance = null;
		    sampledColor = null;
		    sampledVariety = 0;
		  }
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
		  // Wallpaper switched to a DIFFERENT id: one glass wake (rim-light swell,
		  // triggerGlassWake above). Same-id re-applies (refresh reissue) never wake.
		  if (selection.id && selection.id !== prevId) triggerGlassWake();
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
		  // Snapshot the wallpaper identity at MOUNT time. The error / zero-frame
		  // handlers below close over the LIVE selection store, so a late error
		  // from a crossfade-leaving element would otherwise be attributed to
		  // whatever wallpaper happens to be selected when the event fires.
		  const snap = { id: sel.id, type: sel.type };
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
		    media.setAttribute("allow", "autoplay");
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
		  attachStillSampling(media, snap);
		  attachMediaError(media, snap);
		  attachMediaHealth(media, snap);
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
		    // The same event proves the bytes decode, so it also clears the failure
		    // ladder (see clearMediaFailures). One event, one listener: the verify
		    // harness's mock keeps a single handler per event type.
		    clearMediaFailures(sel);
		    applyEffects();
		  });
		}

		function handleMediaFailure(sel) {
		  // Stale guard: an error from a crossfade-leaving element of a wallpaper we
		  // already switched away from must not touch the CURRENT selection's failure
		  // ladder — it would inflate its count and can wrongly demote or clear the
		  // wallpaper that is showing now.
		  if (!sel || sel.id !== selection.id) return;
		  const id = sel.id;
		  const count = (mediaFailures.get(id) || 0) + 1;
		  mediaFailures.set(id, count);
		  const w = selection.inventory.wallpapers.find((x) => x.id === id);
		  if (count === 1) {
		    // Maybe just a dead token: refetch fresh URLs and remount. Throttled
		    // PER WALLPAPER - a global window would strand a video whose first
		    // error lands soon after an unrelated recovery (no remount, no second
		    // error, blank layer until a manual refresh).
		    const now = Date.now();
		    if (now - (lastRecoveryAt.get(id) || 0) < 10000) return;
		    lastRecoveryAt.set(id, now);
		    forceRemount = true;
		    loadInventory(true);
		  } else if (w && w.preview && !demotedToPreview.has(id)) {
		    // The media itself is unusable here - fall back to the still preview.
		    demotedToPreview.add(id);
		    applySelection(id);
		  } else {
		    // Unrenderable here with no preview to fall back on (or the entry has
		    // vanished from the inventory entirely): clear the selection rather
		    // than leave a dead element on the layer.
		    applySelection("");
		  }
		}

		function attachMediaError(media, sel) {
		  media.addEventListener("error", () => handleMediaFailure(sel));
		  if (sel.type === "video") attachZeroFrameDetector(media, sel);
		}

		// The ladder must be able to come back down. Without this, two transient
		// errors minutes apart — a token hiccup, a slow disk, a paused decoder —
		// permanently demoted a perfectly good wallpaper for the rest of the session,
		// because only a manual inventory refresh ever cleared the count. A frame
		// that actually arrives proves the bytes are usable, so the count resets.
		// The still preview of an already-demoted wallpaper is NOT media health: it
		// must not clear the ladder that demoted it (it would retry forever).
		function clearMediaFailures(sel) {
		  if (!sel || sel.id !== selection.id) return;
		  if (demotedToPreview.has(sel.id)) return;
		  mediaFailures.delete(sel.id);
		  lastRecoveryAt.delete(sel.id);
		}

		function attachMediaHealth(media, sel) {
		  // Video/image elements prove health through their sampling event
		  // (attachStillSampling), so only the web iframe needs its own listener —
		  // both would otherwise race for the same `load` slot in minimal harnesses.
		  if (!sel || sel.type !== "web") return;
		  media.addEventListener("load", () => clearMediaFailures(sel));
		}

		// Zero-decoded-frames detector: Chromium can report a video as PLAYING
		// without ever decoding a frame - no error event, currentTime advancing,
		// picture permanently black. Typical with HEVC/H.265 content when the
		// machine has no usable hardware decode. getVideoPlaybackQuality exposes
		// the truth (totalVideoFrames stays 0); a genuinely dark wallpaper is
		// unaffected because its frames DO decode. Wired into the same recovery
		// ladder as a media error: first hit retries with fresh tokens, second
		// hit demotes to the preview still (or clears without one).
		function attachZeroFrameDetector(media, sel) {
		  media.addEventListener("playing", () => {
		    // One probe ~2s into claimed playback: enough for even a slow
		    // hardware pipeline to produce its first frames.
		    schedule(() => {
		      // Stale guard: crossfade may have swapped the element out already,
		      // and the probe must never run while the user paused playback.
		      const layer = document.getElementById(LAYER_ID);
		      if (!layer || layer.querySelector("video") !== media) return;
		      if (media.paused || !(media.currentTime > 0)) return;
		      const q = typeof media.getVideoPlaybackQuality === "function"
		        ? media.getVideoPlaybackQuality() : null;
		      const frames = q ? q.totalVideoFrames
		        : (typeof media.webkitDecodedFrameCount === "number"
		          ? media.webkitDecodedFrameCount : null);
		      if (frames === null) return; // no probe available -> cannot detect
		      if (frames === 0) handleMediaFailure(sel);
		      else clearMediaFailures(sel); // decoded frames prove the container works
		    }, 2000);
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
		  const updateHint = () => {
		    // Pan feedback: in the gap-free fits the pan headroom is (zoom-1)*50,
		    // so at zoom 1 dragging is pinned BY DESIGN - say so instead of
		    // leaving a silent no-op that reads as "pan is broken".
		    hint.textContent = isFreeFit() ? S().adjustHintFree
		      : selection.zoom > 1 ? S().adjustHint
		      : S().adjustHintZoom;
		  };
		  updateHint();
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
		    updateHint();
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
		    updateHint();
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
		        schedule(() => {
		          const v = stale.querySelector("video");
		          if (v) { v.pause(); v.removeAttribute("src"); if (typeof v.load === "function") v.load(); }
		          const f = stale.querySelector("iframe");
		          if (f) { f.src = "about:blank"; }
		          stale.remove();
		        }, LEAVE_MS);
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
		      const v = stale.querySelector("video");
		      if (v) { v.pause(); v.removeAttribute("src"); if (typeof v.load === "function") v.load(); }
		      const f = stale.querySelector("iframe");
		      if (f) { f.src = "about:blank"; }
		      stale.remove();
		      if (!document.getElementById(LAYER_ID)) {
		        const s = document.getElementById(SCRIM_ID);
		        if (s) s.remove();
		        document.body.removeAttribute(ACTIVE_ATTR);
		        if (previewProbe) { previewProbe.remove(); previewProbe = null; }
		        sampledLuminance = null;
		        sampledColor = null;
		        clearEffects();
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
		      // Keep the smart veil's preview probe pointed at the showing web
		      // wallpaper (mount and token re-issue alike).
		      if (selection.type === "web") {
		        const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
		        if (w && w.preview) probePreviewLuminance(w.preview);
		      } else if (previewProbe) {
		        previewProbe.remove();
		        previewProbe = null;
		      }
		    }
		}

		// ── Effect application: push the knobs into CSS variables ───────────────────
		// Wallpaper luminance sampled from the live media (null until the first
		// sample). Web wallpapers render in an opaque-origin iframe whose pixels are
		// unreadable — for those, the inventory's PREVIEW still stands in as a
		// brightness proxy (see probePreviewLuminance).
		let sampledLuminance = null;
		// Average frame colour (0..255 channels) sampled alongside the luminance;
		// quantises into the effect change key (16-level colour buckets).
		let sampledColor = null;
		// Luminance spread of the same frame (0 = flat wash, .3+ = busy graphic).
		// Feeds the material's density: a noisy backdrop needs a thicker body than a
		// calm photograph at the same average brightness.
		let sampledVariety = 0;
		// Wallpaper-switch wake state: while true, applyEffects writes --webg-rim
		// with a +0.25 swell folded in; triggerGlassWake clears it after 450ms.
		let glassWake = false;
		let glassWakeTimer = 0;
		let sampleCanvas = null;
		// Snapshot of every input applyEffects reads, from its last full write. The
		// store emits once per second for the FPS readout — without this guard every
		// tick would rewrite all CSS variables and invalidate style for nothing.
		// clearEffects() resets it so the next apply always writes.
		let lastEffectKey = null;
		/** Average Rec.601 luminance and average RGB (all 0..255 scale) of a
		 * drawable media frame, or null. The luminance drives the veil floor and
		 * the glass material's adaptive brightness; the colour average quantises
		 * into the effect change key (16-level buckets). */
		function sampleFrame(media) {
		  try {
		    if (!sampleCanvas) {
		      const c = document.createElement("canvas");
		      if (typeof c.getContext !== "function") return null; // no canvas → no sampling
		      c.width = 16; c.height = 16;
		      sampleCanvas = c;
		    }
		    const g = sampleCanvas.getContext("2d", { willReadFrequently: true });
		    g.drawImage(media, 0, 0, 16, 16);
		    const d = g.getImageData(0, 0, 16, 16).data;
		    if (!d || d.length < 4) return null; // unreadable frame → keep previous sample
		    const count = d.length / 4;
		    let sum = 0, sumR = 0, sumG = 0, sumB = 0, sumSq = 0;
		    for (let i = 0; i < d.length; i += 4) {
		      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
		      sum += l;
		      sumSq += l * l;
		      sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2];
		    }
		    const mean = sum / count;
		    // Luminance spread: a photographed scene sits near .08–.12, a poster or
		    // high-contrast graphic climbs past .25. The glass body reads "busy" and
		    // thickens with it (see materialTokens).
		    const variance = Math.max(0, sumSq / count - mean * mean);
		    return {
		      lum: mean / 255,
		      std: Math.sqrt(variance) / 255,
		      r: sumR / count,
		      g: sumG / count,
		      b: sumB / count,
		    };
		  } catch { return null; /* frame not ready / unreadable → keep previous */ }
		}

		// Hidden preview probe: whenever a web wallpaper is showing, its preview
		// still (same-origin through our route) is decoded here so the smart veil
		// can read the wallpaper's rough brightness even though the sandboxed
		// iframe's own pixels are forever unreadable.
		const PREVIEW_PROBE_ID = "wallpaper-engine-dsh-preview-probe";
		let previewProbe = null;
		function probePreviewLuminance(url) {
		  if (!url) return;
		  if (!previewProbe) {
		    previewProbe = document.createElement("img");
		    previewProbe.id = PREVIEW_PROBE_ID;
		    previewProbe.alt = "";
		    previewProbe.setAttribute("decoding", "async");
		    // Offscreen, invisible, 1px: it exists to be decoded and drawn, nothing
		    // else. Attached to <body> so tooling (and our verify harness) can see it.
		    previewProbe.setAttribute("style",
		      "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none");
		    previewProbe.addEventListener("load", () => {
		      // A GIF preview draws its first frame — plenty for a brightness proxy.
		      const stats = sampleFrame(previewProbe);
		      if (stats !== null && selection.type === "web") {
		        sampledLuminance = stats.lum;
		        sampledColor = { r: stats.r, g: stats.g, b: stats.b };
		        sampledVariety = stats.std || 0;
		        applyEffects();
		      }
		    });
		    document.body.appendChild(previewProbe);
		  }
		  if (previewProbe.getAttribute("src") !== url) previewProbe.src = url;
		}

		function sampleWallpaperLuminance() {
		  if (typeof document === "undefined") return;
		  const layer = document.getElementById(LAYER_ID);
		  const media = layer && (layer.querySelector("video") || layer.querySelector("img"));
		  if (!media) {
		    // Nothing live to sample. A web wallpaper keeps its preview-based
		    // estimate; any other kind has no brightness evidence at all.
		    if (selection.type !== "web") sampledLuminance = null;
		    return;
		  }
		  const stats = sampleFrame(media);
		  if (stats !== null) {
		    sampledLuminance = stats.lum;
		    sampledColor = { r: stats.r, g: stats.g, b: stats.b };
		    // Videos used to write only lum/colour: sampledVariety stayed 0, so the
		    // "busy wallpaper needs a thicker body" term was dead for every video and
		    // only ever fired for web wallpapers' preview probes.
		    sampledVariety = stats.std || 0;
		  }
		}

		// ── Edge refraction (liquid-glass lensing) ────────────────────────────────
		// Per-surface displacement maps live further down (LENS_SURFACES): the old single
		// 256² map stretched to every surface and is gone.

		// ── v3 material body ───────────────────────────────────────────────────────
		// The old fill was white at 4.5%: on a dark wallpaper that is zero, so the
		// surfaces read as coloured plastic wrap rather than glass. The body now has
		// its own hue (from the sampled frame, chroma capped at 14%), its own
		// lightness, and a density that reacts to two independent properties of the
		// backdrop: how BRIGHT it is (bright → thicker, so text keeps its contrast)
		// and how BUSY it is (high-contrast graphics → thicker still; a smooth
		// photograph at the same average brightness needs less material).
		function rgbHue(r, g, b) {
		  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
		  if (!d) return 220;
		  let h;
		  if (max === r) h = ((g - b) / d) % 6;
		  else if (max === g) h = (b - r) / d + 2;
		  else h = (r - g) / d + 4;
		  return (h * 60 + 360) % 360;
		}

		function materialTokens() {
		  const lum = sampledLuminance === null ? 0.35 : sampledLuminance;
		  const c = sampledColor || { r: 104, g: 112, b: 128 };
		  const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
		  const busy = Math.max(0, Math.min(1, (sampledVariety - 0.06) * 4));
		  return {
		    hue: Math.round(rgbHue(c.r, c.g, c.b)),
		    // 5.5%..14%: enough to "take on" the wallpaper, never a colour filter.
		    sat: Math.min(0.14, 0.055 + 0.075 * chroma),
		    // Dark wallpaper lifts the body: a near-black fill over a near-black
		    // scene reads as a hole, not as glass with a body.
		    lightness: 14 + 6 * (1 - lum),
		    tintA: Math.min(0.34, Math.max(0.16, 0.18 + 0.06 * lum + 0.10 * busy)),
		    // Dark wallpaper: stronger rim (the edge is the only thing that can
		    // separate glass from black), softer shadow.
		    rim: 0.70 + 0.20 * (1 - lum),
		    spec: 0.32 + 0.16 * (1 - lum),
		    shadowK: 0.55 + 0.45 * lum,
		    busy,
		    lum,
		  };
		}

		// Tier chains. 0 blur stays a hard `none` (no layer, no cost). Contrast is
		// pulled DOWN on the heavier variants: glass compresses the backdrop's tone
		// range, which is what keeps light text readable over a saturated poster
		// without piling on more fill.
		let lastGlassBright = 1.04;
		function tierChain(tier, blur, bright) {
		  // Single source for the caps: tierBlur, so the plain chain and the
		  // lens split can never drift apart on an edit.
		  const b = tierBlur(tier, blur);
		  if (b <= 0) return "none";
		  if (tier === "t1") {
		    return "blur(" + b + "px) saturate(1.6) brightness(" + bright + ") contrast(1)";
		  }
		  if (tier === "t3") {
		    return "blur(" + b + "px) saturate(1.3) brightness(" + bright + ") contrast(0.9)";
		  }
		  return "blur(" + b + "px) saturate(1.4) brightness(" + bright + ") contrast(0.92)";
		}

		// The blur caps, single-sourced: tierChain consumes this directly and the
		// lens reads the same cap, so plain and lensed surfaces always agree about
		// how melted the backdrop is at a given slider position.
		function tierBlur(tier, blur) {
		  if (blur <= 0) return 0;
		  if (tier === "t1") return Math.min(4, blur);
		  if (tier === "t3") return Math.min(14, Math.max(blur, 6));
		  return Math.min(10, blur);
		}
		// ── Per-surface lenses (v3) ─────────────────────────────────────────────────
		// Timers live behind these two helpers: the client must also load in minimal
		// harnesses (the verify sandbox) that have no window.setTimeout.
		function later(fn, ms) {
		  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
		    return window.setTimeout(fn, ms);
		  }
		  fn();
		  return 0;
		}

		function cancelLater(id) {
		  if (id && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		    window.clearTimeout(id);
		  }
		}

		// One 256² map stretched to every surface gave a 720x116 composer a ~61px
		// refraction band at its ends and ~10px at its top (the bench reproduced it
		// as a horizontal smear). Apple's lensing is per-view geometry; so is this:
		// each hero surface gets a map rasterised at its own pixel size, with the
		// band in absolute px and the radius read from its computed style.
		const LENS_SURFACES = [
		  { sel: "[data-composer-card]", band: 16, tier: "t2" },
		  { sel: "[data-menu-material]", band: 12, tier: "t2", menuToken: true },
		  { sel: '[data-composer-dock] [class*="_panel"]', band: 12, tier: "t2" },
		  // A dialog that wraps an overlay panel must not build a map either: the
		  // panel's ::before carries the melt, and an inherited --webg-lens-chain on
		  // the dialog would hand that pseudo a dialog-sized map whenever the panel's
		  // own slot is between paints (or bails on size).
		  { sel: '[class*="_dialog_"]:not(:has([class$="_overlay"] > [class$="_panel"]))', band: 18, tier: "t3" },
		  { sel: '[class$="_overlay"] > [class$="_panel"]', band: 18, tier: "t3", pseudo: true },
		  { sel: ".webg-adjust-bar", band: 8, tier: "t1" },
		];
		const LENS_SELECTOR = LENS_SURFACES.map((s) => s.sel).join(",");
		let lensSlots = [];
		let lensSlotSeq = 0;
		let lensScanTimer = 0;
		let lensMutator = null;
		let lensResizer = null;
		const lensMapCache = new Map(); // "w,h,r,band" → data URL (≤12 entries)

		// Shared by the rasterizer and the feImage placement so the map's coordinate
		// frame and the image box can never drift apart.
		function lensPad(band) {
		  return Math.max(2, Math.round(band / 2));
		}

		function rasterizeLens(w, h, rad, band) {
		  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
		  const canvas = document.createElement("canvas");
		  if (!canvas || typeof canvas.getContext !== "function") return null;
		  // Maps rasterize at most 700px per side: the displacement field is
		  // low-frequency and feImage stretches it back per surface, so the cap
		  // only bounds the synchronous first-paint cost (a full-size dialog
		  // would otherwise pay a 1400-square pixel pass on the main thread).
		  // The map carries a bounded border: feDisplacementMap samples past the
		  // element box on the last row, and transparent black would read as a
		  // full-strength displacement there.
		  const pad = lensPad(band);
		  const cw = Math.min(700, Math.round(w + pad * 2)), ch = Math.min(700, Math.round(h + pad * 2));
		  canvas.width = cw; canvas.height = ch;
		  const ctx = canvas.getContext("2d");
		  if (!ctx || typeof ctx.createImageData !== "function" || typeof ctx.putImageData !== "function" ||
		      typeof canvas.toDataURL !== "function") return null;
		  const sx = cw / (w + pad * 2), sy = ch / (h + pad * 2);
		  const r = Math.max(0, Math.min(rad, Math.min(w, h) / 2 - 1));
		  const sdf = (x, y) => {
		    // Rounded-rect SDF in CSS px (the map is sampled in CSS px). The normal
		    // comes from this field, so the corner radius is the only shape knob.
		    const qx = Math.abs(x - w / 2) - (w / 2 - r);
		    const qy = Math.abs(y - h / 2) - (h / 2 - r);
		    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
		    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
		  };
		  const img = ctx.createImageData(cw, ch);
		  const data = img.data;
		  for (let y = 0; y < ch; y++) {
		    for (let x = 0; x < cw; x++) {
		      const cx = x / sx - pad, cy = y / sy - pad;
		      // Apple's measured rim-decay profile (report sec.2.3): displacement
		      // peaks at the rim and decays to zero at band depth, (1-d/band)^2.2.
		      // The previous field peaked mid-band and jumped to zero across the band
		      // boundary: the rim stayed sharp, a stretched seam ran through the glass,
		      // and narrow bands hit a saturation plateau - the patchy read.
		      const d = -sdf(cx, cy);
		      const t = Math.max(0, Math.min(1, 1 - d / band)); // 1 at rim, 0 at band depth
		      const wgt = Math.pow(t, 2.2);
		      // Unit inward normal from the exact SDF (|grad sdf| = 1): direction from
		      // geometry, magnitude from the decay alone. Encoded around 128 so offset =
		      // (channel - 0.5) * scale; scale = 2 * peak lives in paintLensSlot.
		      const gx = (sdf(cx + 1, cy) - sdf(cx - 1, cy)) / 2;
		      const gy = (sdf(cx, cy + 1) - sdf(cx, cy - 1)) / 2;
		      const gl = Math.hypot(gx, gy) || 1;
		      const i = (y * cw + x) * 4;
		      data[i]     = 128 - (gx / gl) * wgt * 127;
		      data[i + 1] = 128 - (gy / gl) * wgt * 127;
		      data[i + 2] = 128; // B: unused by the R/G channel selectors
		      data[i + 3] = 255;
		    }
		  }
		  ctx.putImageData(img, 0, 0);
		  return canvas.toDataURL("image/png");
		}

		function surfaceLensMap(w, h, r, band) {
		  const key = [w, h, Math.round(r), band].join(",");
		  const hit = lensMapCache.get(key);
		  if (hit) return hit;
		  const url = rasterizeLens(w, h, r, band);
		  if (!url) return null;
		  lensMapCache.set(key, url);
		  if (lensMapCache.size > 12) lensMapCache.delete(lensMapCache.keys().next().value);
		  return url;
		}

		function lensRoot() {
		  let svg = document.getElementById(LENS_SVG_ID);
		  if (svg) return svg.querySelector("defs");
		  if (typeof document.createElementNS !== "function") return null;
		  const SVG_NS = "http://www.w3.org/2000/svg";
		  svg = document.createElementNS(SVG_NS, "svg");
		  svg.id = LENS_SVG_ID;
		  svg.dataset.plugin = "wallpaper-engine-dsh";
		  svg.setAttribute("aria-hidden", "true");
		  svg.setAttribute("width", "0");
		  svg.setAttribute("height", "0");
		  svg.setAttribute("style",
		    "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none");
		  const defs = document.createElementNS(SVG_NS, "defs");
		  svg.appendChild(defs);
		  document.body.appendChild(svg);
		  return defs;
		}

		function createLensSlot(el, spec) {
		  const defs = lensRoot();
		  if (!defs) return null;
		  const SVG_NS = "http://www.w3.org/2000/svg";
		  const id = "webg-lens-s" + (++lensSlotSeq);
		  const filter = document.createElementNS(SVG_NS, "filter");
		  filter.setAttribute("id", id);
		  filter.setAttribute("x", "-8%");
		  filter.setAttribute("y", "-8%");
		  filter.setAttribute("width", "116%");
		  filter.setAttribute("height", "116%");
		  filter.setAttribute("color-interpolation-filters", "sRGB");
		  const image = document.createElementNS(SVG_NS, "feImage");
		  image.setAttribute("preserveAspectRatio", "none");
		  image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "");
		  image.setAttribute("result", "map");
		  const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
		  disp.setAttribute("in", "SourceGraphic");
		  disp.setAttribute("in2", "map");
		  disp.setAttribute("xChannelSelector", "R");
		  disp.setAttribute("yChannelSelector", "G");
		  // Post-displacement blur: paintLensSlot writes the tier blur share here
		  // on every paint (quadrature pair with the CSS head blur in lensChain).
		  const soften = document.createElementNS(SVG_NS, "feGaussianBlur");
		  soften.setAttribute("stdDeviation", "0.4");
		  filter.appendChild(image);
		  filter.appendChild(disp);
		  filter.appendChild(soften);
		  defs.appendChild(filter);
		  const slot = { id, filter, image, disp, soften, el, spec, w: 0, h: 0 };
		  if (typeof ResizeObserver === "function") {
		    if (!lensResizer) {
		      lensResizer = new ResizeObserver((entries) => {
		        for (const entry of entries) {
		          const target = entry.target;
		          if (target.__webgLensDebounce) cancelLater(target.__webgLensDebounce);
		          target.__webgLensDebounce = later(() => {
		            target.__webgLensDebounce = 0;
		            paintLensSlot(target);
		          }, 140);
		        }
		      });
		    }
		    lensResizer.observe(el);
		  }
		  el.__webgLens = slot;
		  lensSlots.push(slot);
		  return slot;
		}

		// Strips the per-view inline chain so the surface falls back to the CSS tier
		// chain; shared by the small-surface early-outs, the slot-drop sweep and
		// dispose, so a stale filter URL never outlives its map.
		// Corner radius is the map's last free input; read defensively (the surface
		// may be mid-detach).
		function lensRadius(el) {
		  try {
		    return Math.max(0, Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
		      Math.min(el.clientWidth, el.clientHeight) / 2 - 1));
		  } catch { return 0; }
		}

		function clearLensChain(el) {
		  if (!el || !el.style) return;
		  el.style.removeProperty("--webg-lens-chain");
		  if (el.__webgLens) { el.__webgLens.w = 0; el.__webgLens.h = 0; el.__webgLens.r = 0; }
		  el.style.removeProperty("--dsw-menu-backdrop-filter");
		}

		function paintLensSlot(el) {
		  const slot = el.__webgLens;
		  if (!slot) return;
		  const w = Math.round(el.clientWidth);
		  const h = Math.round(el.clientHeight);
		  if (w < 24 || h < 24) { clearLensChain(el); return; }
		  const radius = lensRadius(el);
		  const band = slot.spec.band;
		  const url = surfaceLensMap(w, h, Math.max(0, Math.min(radius, Math.min(w, h) / 2 - 1)), band);
		  if (!url) { clearLensChain(el); return; }
		  const pad = lensPad(band);
		  // Filter region: the backdrop capture must reach as far outside the border
		  // box as the displacement can pull a sample from. Peak displacement is
		  // scale / 2 = band * 2 CSS px; add the post-blur tail. The old fixed
		  // -8% / 116% region was smaller than that on narrow surfaces (band 18 needs
		  // 40px, a 320px menu only had 25.6px), which clipped the refracted rim.
		  // Percentages are relative to the border box (objectBoundingBox units).
		  const reach = band * 2 + 4;
		  const regionX = (reach / w) * 100;
		  const regionY = (reach / h) * 100;
		  slot.filter.setAttribute("x", "-" + regionX.toFixed(2) + "%");
		  slot.filter.setAttribute("y", "-" + regionY.toFixed(2) + "%");
		  slot.filter.setAttribute("width", (100 + regionX * 2).toFixed(2) + "%");
		  slot.filter.setAttribute("height", (100 + regionY * 2).toFixed(2) + "%");
		  slot.image.setAttribute("href", url);
		  slot.image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", url);
		  slot.image.setAttribute("x", String(-pad));
		  slot.image.setAttribute("y", String(-pad));
		  slot.image.setAttribute("width", String(w + pad * 2));
		  slot.image.setAttribute("height", String(h + pad * 2));
		  // feDisplacementMap shifts by scale * (channel/255 - 0.5), so a channel
		  // span of ±127 gives ±scale/2: scale = 4 * band means a 2 * band CSS px
		  // peak at the rim, on the far side of Apple's measured ~1.8x band.
		  slot.disp.setAttribute("scale", String(Math.round(band * 4)));
		  // The filter blur runs after the displacement; as the quadrature pair of
		  // the CSS head blur it lands the surface exactly on its tier blur.
		  const rest = 0.35; // anti-alias only: the tier blur runs after the bend
		  slot.soften.setAttribute("stdDeviation", rest.toFixed(2));
		  const chain = tierChain(slot.spec.tier, selection.blur, lastGlassBright);
		  if (chain === "none") { clearLensChain(el); return; }
		  const filterUrl = " url(#" + slot.id + ")";
		  if (slot.spec.pseudo) {
		    // The material lives on the panel's ::before (containing-block rule), so
		    // the var must be set on the host and inherited by the pseudo.
		    el.style.setProperty("--webg-lens-chain", filterUrl + " " + chain);
		  } else if (slot.spec.menuToken) {
		    // Two consumers, two variables. This stylesheet's menu rule consumes
		    // --webg-lens-chain (the same per-surface variable every other slot
		    // writes); the host's menu child layers consume the --dsw- token. The
		    // old branch wrote ONLY the host token, so the rule that actually paints
		    // the menu fell back to the plain tier chain and the map was never used.
		    el.style.setProperty("--webg-lens-chain", filterUrl + " " + chain);
		    el.style.setProperty("--dsw-menu-backdrop-filter", filterUrl + " " + chain);
		  } else {
		    el.style.setProperty("--webg-lens-chain", filterUrl + " " + chain);
		  }
		  slot.w = w;
		  slot.h = h;
		  slot.r = radius;
		}

		function scanLensSurfaces() {
		  if (typeof document === "undefined" || !document.body) return;
		  if (!document.body.hasAttribute(LENS_ATTR)) return;
		  let found;
		  try { found = document.body.querySelectorAll(LENS_SELECTOR); } catch { return; }
		  for (const el of found) {
		    if (el.__webgLens) {
		      const r = lensRadius(el);
		      if (Math.round(el.clientWidth) !== el.__webgLens.w ||
		          Math.round(el.clientHeight) !== el.__webgLens.h ||
		          r !== el.__webgLens.r) {
		        paintLensSlot(el);
		      }
		      continue;
		    }
		    const spec = LENS_SURFACES.find((s) => {
		      try { return el.matches(s.sel); } catch { return false; }
		    });
		    if (!spec) continue;
		    createLensSlot(el, spec);
		    paintLensSlot(el);
		  }
		  // Drop slots whose surface left the DOM.
		  lensSlots = lensSlots.filter((slot) => {
		    if (slot.el.isConnected) return true;
		    if (lensResizer) lensResizer.unobserve(slot.el);
		    slot.filter.remove();
		    clearLensChain(slot.el);
		    delete slot.el.__webgLens;
		    return false;
		  });
		}

		function scheduleLensScan() {
		  if (lensScanTimer) return;
		  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
		    scanLensSurfaces();
		    return;
		  }
		  lensScanTimer = window.setTimeout(() => {
		    lensScanTimer = 0;
		    scanLensSurfaces();
		  }, 90);
		}

		// A DOM mutation only matters to the lens layer when it can add, remove or
		// re-class a LENS_SURFACES element. Chat streaming mutates classes and text
		// nodes constantly; without this filter every such batch scheduled a 90ms scan
		// that re-ran six querySelectorAll sweeps and read layout of every slot.
		function lensMutationRelevant(records) {
		  for (let i = 0; i < records.length; i++) {
		    const rec = records[i];
		    if (rec.type === "attributes") {
		      const el = rec.target;
		      if (!el || el.nodeType !== 1) continue;
		      if (el.matches && el.matches(LENS_SELECTOR)) return true;
		      // A slot host whose class just changed may have stopped matching.
		      if (el.__webgLens) return true;
		      continue;
		    }
		    const lists = [rec.addedNodes, rec.removedNodes];
		    for (let k = 0; k < lists.length; k++) {
		      const nodes = lists[k];
		      for (let j = 0; j < nodes.length; j++) {
		        const n = nodes[j];
		        if (!n || n.nodeType !== 1) continue; // text nodes are the streaming churn
		        if (n.matches && n.matches(LENS_SELECTOR)) return true;
		        if (n.querySelector && n.querySelector(LENS_SELECTOR)) return true;
		      }
		    }
		  }
		  return false;
		}

		function attachLensWatcher() {
		  if (lensMutator || typeof MutationObserver !== "function" || !document.body) return;
		  lensMutator = new MutationObserver((records) => {
		    if (!document.body.hasAttribute(LENS_ATTR)) return;
		    if (lensMutationRelevant(records)) scheduleLensScan();
		  });
		  lensMutator.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-composer-card", "data-menu-material"] });
		}

		function disposeLenses() {
		  if (lensMutator) { lensMutator.disconnect(); lensMutator = null; }
		  if (lensResizer) { lensResizer.disconnect(); lensResizer = null; }
		  if (lensScanTimer) { cancelLater(lensScanTimer); lensScanTimer = 0; }
		  for (const slot of lensSlots) {
		    slot.filter.remove();
		    clearLensChain(slot.el);
		    delete slot.el.__webgLens;
		  }
		  lensSlots = [];
		  lensMapCache.clear();
		}

		// ── Pointer specular (optional) ─────────────────────────────────────────────
		// Off by default: this repaints one surface per animation frame, which is
		// exactly the "continuous animation" cost the glass budget avoids. When the
		// user turns it on, the specular pools follow the pointer instead of the fixed
		// overhead light — the "illuminated from within" read Apple gives a pressed
		// control, extended to hover. Only the composer participates: it is the one
		// surface large enough for the light to travel visibly.
		let pointerBound = false;
		let pointerCard = null;
		let pointerFrame = 0;
		let pointerX = 0;
		let pointerY = 0;

		function paintPointerLight() {
		  pointerFrame = 0;
		  if (!pointerCard || !pointerCard.style) return;
		  pointerCard.style.setProperty("--webg-pointer-gloss",
		    "radial-gradient(46% 90% at " + pointerX.toFixed(1) + "% " + pointerY.toFixed(1) +
		    "%, hsl(0 0% 100% / calc(var(--webg-spec) * 0.30)), transparent 62%)");
		}

		function releasePointerLight() {
		  if (pointerCard && pointerCard.style) pointerCard.style.removeProperty("--webg-pointer-gloss");
		  pointerCard = null;
		}

		function onPointerLightMove(ev) {
		  const target = ev.target;
		  const card = target && typeof target.closest === "function"
		    ? target.closest("[data-composer-card]")
		    : null;
		  if (card !== pointerCard) {
		    releasePointerLight();
		    pointerCard = card;
		  }
		  if (!card) return;
		  const rect = card.getBoundingClientRect();
		  if (!rect.width || !rect.height) return;
		  pointerX = ((ev.clientX - rect.left) / rect.width) * 100;
		  pointerY = ((ev.clientY - rect.top) / rect.height) * 100;
		  if (typeof requestAnimationFrame !== "function") {
		    paintPointerLight();
		    return;
		  }
		  if (!pointerFrame) pointerFrame = requestAnimationFrame(paintPointerLight);
		}

		function onPointerLightLeave() {
		  if (pointerFrame) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
		  releasePointerLight();
		}

		function stopPointerLight() {
		  if (!pointerBound || typeof document === "undefined") return;
		  document.removeEventListener("pointermove", onPointerLightMove);
		  document.removeEventListener("pointerleave", onPointerLightLeave);
		  pointerBound = false;
		  onPointerLightLeave();
		}

		function syncPointerLight() {
		  const want = Boolean(selection.pointerLight) && Boolean(selection.id);
		  if (want && !pointerBound && typeof document !== "undefined") {
		    document.addEventListener("pointermove", onPointerLightMove, { passive: true });
		    document.addEventListener("pointerleave", onPointerLightLeave, { passive: true });
		    pointerBound = true;
		    return;
		  }
		  if (!want) stopPointerLight();
		}

		function applyEffects() {
		  // A frame can outlive teardown (a slider burst, a scheduled repaint). Once
		  // disposed, every write here would resurrect the dark attr and the vars the
		  // cleanup just removed.
		  if (disposed) return;
		  // The veil darkens bright wallpapers (the dark material serves light text —
		  // this is what makes ANY wallpaper survivable).
		  // Material permanently dark (user decision, 2026-11-06): one glass recipe
		  // regardless of shell/OS theme; the light branch is retired.
		  const dark = true;
		  if (typeof document !== "undefined" && document.body) {
		    if (!(document.body.hasAttribute && document.body.hasAttribute(DARK_ATTR))) {
		      document.body.setAttribute(DARK_ATTR, "");
		    }
		  }
		  // Lens availability. backdrop-filter: url(#id) renders only in
		  // Chromium-family engines; Safari parses the declaration and then drops the
		  // whole chain at render time, so the lens rides an explicit UA gate instead
		  // of @supports (which cannot see the difference). DSH desktop is Electron
		  // (Chromium); the gate mainly keeps DSH-web in Safari/Firefox on the blur
		  // recipe. Evaluated per call, not cached at module load, so the gate tracks
		  // the live UA (and the verify harness can exercise both sides).
		  const lensUaOk = typeof navigator !== "undefined" &&
		    /Chrome|Chromium|Edg\//.test(navigator.userAgent || "");
		  // The OS reduced-transparency switch goes one further than the CSS block:
		  // the lens JS machinery (SVG filters, map rasterization, observers) skips
		  // entirely - the CSS !important neutralizes the visuals already, so
		  // rasterizing maps with zero visual output is pure waste. Evaluated per
		  // call like lensUaOk so a mid-session flip is picked up on the next pass.
		  const lensRt = typeof window !== "undefined" && typeof window.matchMedia === "function" ?
		    window.matchMedia("(prefers-reduced-transparency: reduce)") : null;
		  const lensOn = lensUaOk && selection.lens !== false && Boolean(selection.id) &&
		    selection.blur > 0 && !(lensRt && lensRt.matches);
		  // Attr sync stays above the change-key guard: availability can change on a
		  // tick where no knob moved, and the early return would otherwise leave the
		  // gate unset until the next unrelated slider move.
		  if (typeof document !== "undefined" && document.body) {
		    if (lensOn) {
		      if (!(document.body.hasAttribute && document.body.hasAttribute(LENS_ATTR))) {
		        document.body.setAttribute(LENS_ATTR, "");
		      }
		    } else if (document.body.hasAttribute && document.body.hasAttribute(LENS_ATTR)) {
		      document.body.removeAttribute(LENS_ATTR);
		      disposeLenses();
		    }
		  }
		  const roundedLum = sampledLuminance !== null ? Math.round(sampledLuminance * 100) / 100 : null;
		  // Colour enters the key quantised to 16-level buckets — enough resolution
		  // for a veil tint, coarse enough that per-frame noise never re-spins the
		  // whole variable write.
		  const colorKey = sampledColor
		    ? (sampledColor.r >> 4) + "." + (sampledColor.g >> 4) + "." + (sampledColor.b >> 4)
		    : "";
		  const key = [
		    dark, selection.scrim, selection.border, selection.blur, selection.wallpaperBlur,
		    selection.autoScrim, roundedLum, colorKey, Math.round(sampledVariety * 20),
		    selection.fit, selection.zoom,
		    selection.offsetX, selection.offsetY, selection.rotation, selection.mirrored,
		    lensOn ? 1 : 0,
		  ].join("\u0000");
		  if (key === lastEffectKey) return; // nothing it reads changed → no writes, no reflow
		  lastEffectKey = key;
		  const s = document.body.style;
		  let alpha = selection.scrim;
		  if (selection.autoScrim && sampledLuminance !== null) {
		    // Distance of the wallpaper's brightness from the "comfortable middle"
		    // dark-pinned: only BRIGHT content threatens the light text.
		    const need = Math.min(0.55, Math.max(0, sampledLuminance - 0.5));
		    alpha = Math.max(alpha, Math.round(need * 1000) / 1000);
		  }
		  // The veil is pure black, always — the dark material needs no light-side
		  // flip, no hue tint, nothing. A pitch-black wallpaper still cannot swallow
		  // the UI: black-on-black is exactly the case the autoScrim floor above
		  // cannot help with... and it does not need to: dark text is not what this
		  // material serves (see the dark-pin note at the top of applyEffects).
		  const veilColor = "rgba(0,0,0," + alpha + ")";
		  s.setProperty("--webg-scrim-color", veilColor);
		  s.setProperty("--webg-border-alpha", String(selection.border));
		  // The chain recipe lives in tierChain(): saturation and contrast are fixed
		  // per tier (1.6 / 1.4+0.92 / 1.3+0.9), so the slider only steers how much
		  // melt a surface gets — never how saturated it reads. All three tiers cap
		  // at 14px (tierBlur); the host's 40px frosted recipe is intentionally not
		  // reproduced verbatim, because past ~16px the glass reads frost, not liquid.
		  // Adaptive luminosity — Apple's material self-adjusts to the content
		  // behind it: a bright wallpaper dims the melt a touch, a dark one lifts
		  // it a whisper (a full lift turned near-black backdrops into grey smoke —
		  // the opposite of the clear read Apple's dark glass keeps). No luminance
		  // evidence (null, before the first sample) → the neutral 1.04 base.
		  let glassBright = 1.10;
		  if (sampledLuminance !== null) {
		    // Asymmetric on purpose: bright content may DIM the melt (that helps
		    // the light text), but dark content earns only a whisper of lift.
		    const pull = Math.max(0, sampledLuminance - 0.5) * 0.10;
		    const lift = Math.max(0, 0.5 - sampledLuminance) * 0.05;
		    glassBright = Math.round(Math.max(1.02, Math.min(1.18, 1.10 - pull + lift)) * 1000) / 1000;
		  }
		  // glass-brightness stays a standalone knob for inspection even though the
		  // chain below embeds it — the one value NOT derivable from the sliders.
		  s.setProperty("--webg-glass-brightness", String(glassBright));
		  // The body, the rim and the shadow are all derived from the SAME sampled
		  // frame, so every surface agrees about which way the light comes from and
		  // how dense the glass should be. See materialTokens().
		  lastGlassBright = glassBright;
		  const mat = materialTokens();
		  s.setProperty("--webg-tint-h", String(mat.hue));
		  s.setProperty("--webg-tint-h2", String((mat.hue + 180) % 360));
		  s.setProperty("--webg-tint-s", (mat.sat * 100).toFixed(1) + "%");
		  s.setProperty("--webg-tint-l", mat.lightness.toFixed(1) + "%");
		  s.setProperty("--webg-tint-a", mat.tintA.toFixed(3));
		  s.setProperty("--webg-rim", Math.min(1.15, mat.rim + (glassWake ? 0.22 : 0)).toFixed(3));
		  s.setProperty("--webg-spec", mat.spec.toFixed(3));
		  s.setProperty("--webg-shadow-k", mat.shadowK.toFixed(3));
		  // Three tiers, one chain each: light glass (bars, buttons), regular (menus,
		  // composer, dock), thick (dialogs, full-page overlays).
		  const chainT1 = tierChain("t1", selection.blur, glassBright);
		  const chainT2 = tierChain("t2", selection.blur, glassBright);
		  const chainT3 = tierChain("t3", selection.blur, glassBright);
		  s.setProperty("--webg-chain-t1", chainT1);
		  s.setProperty("--webg-chain-t2", chainT2);
		  s.setProperty("--webg-chain-t3", chainT3);
		  // Shared fallback chain: the second leg of every per-tier fallback
		  // (var(--webg-lens-chain, var(--webg-chain-t2, var(--webg-backdrop, ...)))).
		  s.setProperty("--webg-backdrop", chainT2);
		  // At 0 blur the chains collapse to none: surfaces fall back to their
		  // translucent token fills and the filter pipeline drops out entirely —
		  // the same bit-exact fast path the wallpaper media layer uses.
		  // The lens sits LAST on purpose: backdrop-filter functions compose in
		  // order, and a displacement that runs BEFORE the melt gets its bend
		  // spread across the blur kernel — the refraction ring was there in
		  // code but invisible on screen. Displacing the melted snapshot keeps the
		  // bend crisp; it is the liquid signature. (The per-view filter URL is
		  // appended by paintLensSlot into --webg-lens-chain.)
		  // Clear-variant adaptive dimming (composer + bubbles float over the media
		  // like Apple's "clear" glass): when the wallpaper's brightness threatens
		  // the theme's text, an extra veil layer INSIDE the glass tips the balance
		  // back. HIG Materials caps such a dimming layer at 35% opacity — the curve
		  // reaches exactly that ceiling on a pure-white/pure-black wallpaper. Same
		  // direction as the page veil, gentler, and a 0-alpha layer keeps the
		  // background-image stack size stable for compositing.
		  let dimAlpha = 0;
		  if (sampledLuminance !== null) {
		    const need = Math.max(0, sampledLuminance - 0.5);
		    // 0.7 slope, 0.35 HIG ceiling: the dim tips the balance back only when
		    // the scene actually threatens the light text; 0-alpha keeps the
		    // background-image stack stable for compositing.
		    dimAlpha = Math.round(Math.min(0.35, need * 0.7) * 1000) / 1000;
		  }
		  s.setProperty("--webg-adapt-dim",
		    "rgba(0,0,0," + dimAlpha + ")");
		  // Menu fill is no longer a separate grey: menus use the same tint body as
		  // every other surface (see --webg-tint-*), so the material agrees with
		  // itself whatever the wallpaper does. The accessibility blocks still
		  // override the fill with a solid colour by document order.
		  // Modal masks (settings dialog, image lightbox) read the shell's mask-blur
		  // token — wire it to the glass slider so modals frost the app behind them
		  // instead of showing the wallpaper sharply through a translucent mask.
		  // Capped: a 40px blur on a full-viewport backdrop costs more GPU than the
		  // effect is worth.
		  // Gated on an active selection: this is a HOST token, so masks must not
		  // blur the app while no wallpaper runs. At 0 blur: none - no layer, no cost.
		  s.setProperty("--dsw-mask-blur",
		    selection.id && selection.blur > 0
		      ? "blur(" + Math.min(selection.blur, 20) + "px)"
		      : "none");
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

		  // Write the scrim colour directly too: the scrim is its own layer, and
		  // setting the element style alongside the body variable keeps the veil and
		  // the glass in one frame (no forced layout is involved or needed).
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = veilColor;
		  // Surfaces that appeared since the last pass (a menu opened, a dialog
		  // mounted) get their per-view maps here; the watcher covers the rest.
		  if (lensOn) {
		    attachLensWatcher();
		    // Repaint every live slot: the inline chain embeds the current blur tier
		    // and wallpaper brightness, so a slider move must rewrite it even when
		    // the surface keeps its size.
		    for (const slot of lensSlots) paintLensSlot(slot.el);
		    scheduleLensScan();
		  }
		  syncPointerLight();
		}

		function clearEffects() {
		  lastEffectKey = null;
		  const s = document.body.style;
		  s.removeProperty("--webg-scrim-color");
		  s.removeProperty("--webg-border-alpha");
		  s.removeProperty("--dsw-mask-blur"); // restore the host's own mask token
		  s.removeProperty("--webg-glass-brightness");
		  s.removeProperty("--webg-backdrop");
		  s.removeProperty("--webg-adapt-dim");
		  s.removeProperty("--webg-tint-h");
		  s.removeProperty("--webg-tint-h2");
		  s.removeProperty("--webg-tint-s");
		  s.removeProperty("--webg-tint-l");
		  s.removeProperty("--webg-tint-a");
		  s.removeProperty("--webg-rim");
		  s.removeProperty("--webg-spec");
		  s.removeProperty("--webg-shadow-k");
		  s.removeProperty("--webg-chain-t1");
		  s.removeProperty("--webg-chain-t2");
		  s.removeProperty("--webg-chain-t3");
		  disposeLenses();
		  if (typeof document !== "undefined" && document.body &&
		      document.body.hasAttribute && document.body.hasAttribute(LENS_ATTR)) {
		    document.body.removeAttribute(LENS_ATTR);
		  }
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
		  return React.createElement(React.Fragment, { key: label },
		    React.createElement("span", { className: "webg-hint webg-label" }, label),
		    React.createElement("input", {
		      className: "webg-slider", type: "range",
		      "aria-label": label,
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

		function onTogglePointerLight() {
		  selection.pointerLight = !selection.pointerLight;
		  persistSelection();
		  syncPointerLight();
		  applyEffects();
		  emit();
		}

		function onToggleLens() {
		  selection.lens = !(selection.lens !== false);
		  persistSelection();
		  applyEffects();
		  emit();
		}

		// Range inputs emit one input event per pointer move (~120 Hz). Running the
		// full write path per event — a synchronous localStorage JSON write, ~30 body
		// custom-property writes, then a whole-picker React render — meant three sync
		// passes per move. Mutate the store immediately (applyEffects reads it), and
		// collapse the expensive half to one frame: the last value wins.
		let sliderFrame = 0;
		let sliderDirty = false;
		function flushSliderFrame() {
		  sliderFrame = 0;
		  if (!sliderDirty) return;
		  sliderDirty = false;
		  if (disposed) return; // teardown won the race; do not resurrect body vars
		  persistSelection();
		  applyEffects();
		  emit();
		}
		function scheduleSliderFrame() {
		  sliderDirty = true;
		  if (typeof requestAnimationFrame !== "function") { flushSliderFrame(); return; }
		  if (sliderFrame) return;
		  sliderFrame = requestAnimationFrame(flushSliderFrame);
		}
		function onScrim(pct) { selection.scrim = pct / 100; scheduleSliderFrame(); }
		function onBorder(pct) { selection.border = pct / 100; scheduleSliderFrame(); }
		function onBlur(px) { selection.blur = px; scheduleSliderFrame(); }
		function onWallpaperBlur(px) { selection.wallpaperBlur = px; scheduleSliderFrame(); }

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
		      onChange: (e) => setQuery(e.target.value),
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
		      ? React.createElement("span", { className: "webg-hint webg-grid-empty" },
		          sel.inventory.installDir
		            ? (sel.inventory.total > 0
		                ? t.emptyNoUsable(sel.inventory.total)
		                : t.emptyNoProjects)
		            : t.emptyNoInstall)
		      : filteredList.length === 0
		        ? React.createElement("span", { className: "webg-hint webg-grid-empty" }, t.noMatch(q))
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
		        onChange: (e) => { editing.name = e.target.value; if (!e.nativeEvent || !e.nativeEvent.isComposing) emit(); },
		        onInput: (e) => { editing.name = e.target.value; },
		        onCompositionEnd: (e) => { editing.name = e.target.value; emit(); },
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
		      onChange: (e) => setEditorQuery(e.target.value),
		      onInput: (e) => setEditorQuery(e.target.value),
		    }),
		    React.createElement("div", { className: "webg-editor-grid" },
		      (() => {
		        const eq = editorQuery.trim();
		        const pool = usableList.filter((w) => matchesQuery(w, eq));
		        if (usableList.length === 0) {
		          return React.createElement("span", { className: "webg-hint webg-grid-empty" }, t.noUsable);
		        }
		        if (pool.length === 0) {
		          return React.createElement("span", { className: "webg-hint webg-grid-empty" }, t.noMatch(eq));
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
		      (sel.zoom !== 1 || sel.offsetX !== 0 || sel.offsetY !== 0 || sel.rotation !== 0) &&
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
		      SliderRow(t.glass, 0, 14, 1, sel.blur, onBlur, sel.blur + "px"),
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
		    React.createElement("label", { className: "webg-toggle", title: t.pointerLightTitle },
		      React.createElement("input", {
		        type: "checkbox", checked: sel.pointerLight, onChange: onTogglePointerLight,
		      }),
		      t.pointerLight,
		    ),
		    React.createElement("label", { className: "webg-toggle", title: t.lensTitle },
		      React.createElement("input", {
		        type: "checkbox", checked: sel.lens !== false, onChange: onToggleLens,
		      }),
		      t.lens,
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
		  // in which case nothing switches until the list grows. A cleared
		  // selection (id "") disarms the timer too: claiming rotation there would
		  // report a tick that will never come.
		  const rotating = sel.rotationEnabled && usableCount >= 2 && Boolean(sel.id);
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
		    React.createElement("h2", { className: "webg-heading" }, t.settingsLabel),
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
		  /* color-scheme: normal stops the DSH theme from leaking INTO the sandboxed
		     web-wallpaper iframe. The shell sets color-scheme: dark on <html> in the
		     dark theme; that value propagates to embedded documents, and at least one
		     official wallpaper (CORSAIR Collection, an Angular app) never paints
		     under an inherited dark scheme — a solid white page instead. The value
		     "normal" restores the neutral default; a wallpaper that opts into a
		     scheme via its own styles still wins. */
		  .webg-layer .webg-media {
		    position: absolute;
		    inset: 0;
		    width: 100%;
		    height: 100%;
		    max-width: none; max-height: none;
		    color-scheme: normal;
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
		    /* Desktop: the shell titlebar strip is a window-drag region and the
		       union drag region ignores z-order - without no-drag, drags starting
		       near the top of the adjust overlay move the WINDOW instead of
		       panning, and the bar's Done button stops receiving clicks. */
		    -webkit-app-region: no-drag;
		    app-region: no-drag;
		  }
		  .webg-adjust:active { cursor: grabbing; }
		  .webg-adjust .webg-layer { position: absolute; z-index: 0; }
		  /* The adjust bar rides the same glass recipe as the host surfaces
		     (layers, edge speculars, chain var) — the plugin's own reference
		     rendering of the material. It only exists while a wallpaper runs, so
		     the body-level glass vars are always present; the fallbacks below are
		     just for out-of-context reads. */
		  .webg-adjust-bar {
		    position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
		    z-index: 1; cursor: default; -webkit-app-region: no-drag; app-region: no-drag;
		    display: flex; align-items: center; gap: 12px;
		    padding: 8px 8px 8px 14px; border-radius: 12px;
		    background-color: var(--webg-body, rgba(17, 19, 24, 0.4));
		    background-image: var(--webg-glass-layers, none);
		    background-size: var(--webg-glass-sizes, 100% 100%);
		    background-repeat: var(--webg-glass-repeats, no-repeat);
		    color: var(--dsw-alias-label-primary, inherit);
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t1, var(--webg-backdrop, blur(20px))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t1, var(--webg-backdrop, blur(20px))));
		    box-shadow: var(--webg-glass-shadow, 0 4px 16px rgba(0, 0, 0, 0.18));
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
		    transition: background 300ms ease;
		  }

		  /* While active: transparent frame + sidebar. The host's border tokens
		     keep their host values — they feed every elevated control (the shell's
		     0.5px elevation stroke on menus/cards/buttons, terminal frames, row
		     separators) at 0.04-0.06 alpha by design; pushing them to
		     wallpaper-visible strength outlined every one of those controls in
		     chalk. The borders slider instead scales the RIM on the plugin's own
		     glass surfaces: the hairline-ring entries of --webg-glass-shadow are
		     coupled to --webg-border-alpha (host-level at the 0.35 default, up to
		     ~2.6x at the ceiling for busy wallpapers, gone at zero). */
		  body[${ACTIVE_ATTR}] {
		    --dsw-alias-bg-base: transparent;
		    --dsw-alias-settings-card-fill: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%, transparent);
		    --dsw-specific-sidebar-fill: transparent;
		  }
		  /* Host border tiers above hairline read as chalk over glass: the shell
		     tunes l2/l3/l4 (dark 0.12/0.16/0.20 white) against opaque panels, and
		     while a wallpaper runs every surface behind those strokes is glass.
		     The strong tiers step down one notch; the hairline tiers (l1,
		     l2-darkmode-thin) keep host values. Measured anchor: the settings
		     account cards draw a 1px white-0.20 (l4) stroke that read as a bright
		     frame over the glass panel. */
		  body[${ACTIVE_ATTR}] {
		    --dsw-alias-border-l2: rgba(255, 255, 255, 0.08);
		    --dsw-alias-border-l3: rgba(255, 255, 255, 0.10);
		    --dsw-alias-border-l4: rgba(255, 255, 255, 0.13);
		  }


		  /* ── Liquid glass material ─────────────────────────────────────────────
		     Apple's material (HIG Materials, WWDC25 sessions 219/356) reads as
		     glass through three cues, all reproduced here:
		     1. the backdrop melt — one filter chain, written by applyEffects as
		        --webg-backdrop, consumed by every surface (the five hand-copied
		        declarations this replaces used to drift apart on edits);
		     2. an asymmetric edge specular — the top bevel catches ~3x the
		        light of the sides; make the four edges equal and the surface
		        flattens into an outlined box. The rim/specular alphas follow the
		        sampled wallpaper (darker scene, stronger edges);
		     3. adaptive luminosity — --webg-glass-brightness follows the sampled
		        wallpaper luminance; the clear-variant surfaces additionally get
		        --webg-adapt-dim, the HIG "35% dimming layer" treatment for glass
		        floating over media (capped at exactly that 0.35);
		     Surface roles follow the HIG variants: the composer is "clear" glass
		     floating over the media (thin fill + adaptive dim); bubbles take a
		     denser body instead of the dim layer. Menus / dock / dialogs are
		     "regular" chrome glass (deep fills + full material). Menus join the
		     material too: their fill rides the wallpaper-tinted body rather than
		     a separate grey — the earlier "keep shell chrome only" caution
		     predated the material system, and flat grey read as a dead panel,
		     not glass. */

		  /* Material pieces, defined once per theme. The dim veil is a uniform
		     colour layer -- a plain colour cannot sit in background-image, so
		     it rides a degenerate gradient. */
		  body[${ACTIVE_ATTR}] {
		    --webg-dim-veil: linear-gradient(var(--webg-adapt-dim, rgba(0, 0, 0, 0)), var(--webg-adapt-dim, rgba(0, 0, 0, 0)));
		  }

		  /* Registered custom properties: the fluidity layer. --webg-rim (glass
		     thickness, drives every bevel/ring/contour via calc) and --webg-adapt-dim
		     (the adaptive dim layer) are transitionable, so slider moves, theme-adjacent
		     re-writes and the wallpaper-switch wake glide instead of snapping.
		     Engines without @property keep today's stepwise behaviour. */
		  @property --webg-rim { syntax: '<number>'; inherits: true; initial-value: 0.58; }
		  @property --webg-adapt-dim { syntax: '<color>'; inherits: true; initial-value: rgba(0, 0, 0, 0); }
		  /* Material permanently dark (user decision, 2026-11-06): one glass recipe,
		     whatever the shell or OS theme says. The stack: hot top
		     bevel → cool subsurface glow (dispersion hint) → bottom catch → hairline
		     ring + dark outer contour (the thickness sandwich, both riding the
		     borders slider) → near + ambient drops. */
		  body[${ACTIVE_ATTR}] {
		    /* v3 material tokens, written by applyEffects() from ONE sampled frame.
		       The body is a dark, low-chroma tint of the wallpaper's own hue — the
		       old recipe filled with white at 4.5%, which is literally nothing over
		       a dark wallpaper, so surfaces read as coloured plastic wrap. Rim,
		       specular and shadow scale from the same evidence, so every surface
		       agrees about the light and how thick it should look. These are the
		       neutral night defaults, used before the first sample lands. */
		    --webg-tint-h: 220;
		    --webg-tint-h2: 40;
		    --webg-tint-s: 8%;
		    --webg-tint-l: 14%;
		    --webg-tint-a: 0.18;
		    --webg-rim: 0.72;
		    --webg-spec: 0.32;
		    --webg-shadow-k: 0.8;
		    --webg-k: 1;
		    --webg-body: hsl(var(--webg-tint-h) var(--webg-tint-s) var(--webg-tint-l) / calc(var(--webg-tint-a) * var(--webg-k)));
		    /* The gloss: a whisper of sky at the top, a cool floor at the bottom.
		       It is a body gradient (under the content), not a backdrop effect. */
		    --webg-gloss: linear-gradient(180deg,
		      hsl(0 0% 100% / calc(0.07 * var(--webg-rim))),
		      hsl(0 0% 100% / calc(0.02 * var(--webg-rim))) 22%,
		      hsl(0 0% 100% / 0) 46%,
		      hsl(220 40% 3% / calc(0.16 * (1.2 - var(--webg-rim)))));
		    /* Specular: four pools driven by one light direction (overhead). The
		       corners take the two bright arcs, the centre a soft band, and the
		       bottom a cool return — the same read as Apple's two rim lights, the
		       second at 0.8× the first. */
		    --webg-spec-gloss:
		      radial-gradient(22% 38% at 1% -6%, hsl(0 0% 100% / calc(var(--webg-spec) * 0.34)), transparent 58%),
		      radial-gradient(22% 38% at 99% -6%, hsl(0 0% 100% / calc(var(--webg-spec) * 0.30)), transparent 58%),
		      radial-gradient(56% 13% at 50% -5%, hsl(0 0% 100% / calc(var(--webg-spec) * 0.18)), transparent 64%),
		      radial-gradient(46% 18% at 50% 104%, hsl(var(--webg-tint-h2) 40% 88% / calc(var(--webg-spec) * 0.14)), transparent 66%);
		    --webg-pointer-gloss: none;
		    /* Layer order: dim veil, FOUR specular pools, gloss, pointer gloss
		       = 7 layers. The sizes/repeats lists must match the stack one entry per layer:
		       a short list cycles from the start, so the fourth specular radial would
		       pick up a neighbour's size and tile one gradient across the surface as
		       bright squares. */
		    --webg-glass-layers: var(--webg-dim-veil), var(--webg-spec-gloss), var(--webg-gloss), var(--webg-pointer-gloss);
		    --webg-glass-sizes: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%;
		    --webg-glass-repeats: no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat;
		    /* The bevel: a lit round column, not a uniform outline. Top specular
		       (1px hard + a 3px decay so the edge has a falloff instead of reading
		       as a sticker), a bottom return bounce, dark side walls, an inner
		       hairline, and a dark outer contour that separates the glass from a
		       bright backdrop. */
		    --webg-bevel:
		      inset 0 1px 0 hsl(0 0% 100% / calc(0.50 * var(--webg-rim))),
		      inset 0 2px 2px -1px hsl(0 0% 100% / calc(0.26 * var(--webg-rim))),
		      inset 0 7px 13px -9px hsl(0 0% 100% / calc(0.34 * var(--webg-rim))),
		      inset 0 2px 3px -2px hsl(220 40% 3% / calc(0.42 * (1.2 - var(--webg-rim)))),
		      inset 0 0 18px -11px hsl(0 0% 100% / calc(0.22 * var(--webg-rim))),
		      inset 0 -1px 0 hsl(0 0% 100% / calc(0.24 * var(--webg-rim))),
		      inset 1px 0 0 hsl(220 25% 6% / 0.14),
		      inset -1px 0 0 hsl(220 25% 6% / 0.14),
		      inset 0 0 2px 1px hsl(220 40% 4% / calc(0.30 * (1.2 - var(--webg-rim)))),
		      inset 0 0 0 0.5px hsl(0 0% 100% / calc(0.09 * var(--webg-rim) * var(--webg-border-alpha, 0.35) / 0.35)),
		      0 0 0 0.5px hsl(220 22% 4% / calc(0.45 * var(--webg-border-alpha, 0.35) / 0.35));
		    /* Elevation: four steps. Contact is tight and always present; mid and
		       far drops carry the wallpaper's hue so the shadow belongs to the
		       scene instead of punching a grey hole in it. */
		    --webg-e0:
		      0 1px 2px hsl(220 30% 2% / calc(0.20 * var(--webg-shadow-k))),
		      0 0 0 0.5px hsl(220 22% 4% / 0.45);
		    --webg-e1:
		      var(--webg-e0),
		      0 6px 18px -6px hsl(var(--webg-tint-h) 30% 3% / calc(0.28 * var(--webg-shadow-k)));
		    --webg-e2:
		      var(--webg-e1),
		      0 22px 56px -14px hsl(var(--webg-tint-h) 35% 3% / calc(0.38 * var(--webg-shadow-k)));
		    --webg-e3:
		      var(--webg-e2),
		      0 44px 96px -28px hsl(var(--webg-tint-h) 40% 2% / calc(0.42 * var(--webg-shadow-k)));
		    --webg-glass-shadow: var(--webg-bevel), var(--webg-e1);
		    --webg-panel-shadow: var(--webg-bevel), var(--webg-e2);
		    --webg-deep-shadow: var(--webg-bevel), var(--webg-e3);
		    --dsw-specific-input-major: rgba(255, 255, 255, 0.045);
		    --dsw-specific-bubble: rgba(255, 255, 255, 0.04);
		  }

		  /* Composer card: the regular tier, and the main lensing hero. Body tint +
		     laid-on gloss + four specular pools + the bevel stack, over the t2 chain
		     (or the per-view lens filter once paintLensSlot has measured it). */
		  body[${ACTIVE_ATTR}] [data-composer-card] {
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    box-shadow: var(--webg-glass-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }

		  /* Message bubbles are CONTENT, not chrome — HIG: glass belongs to the
		     control layer, never to the content layer. No backdrop filter and no
		     lens: killing the melt is what keeps text behind a bubble crisp, and the
		     bubble's own tint carries the legibility instead. Denser body (k 1.45),
		     edge light only. The question-reply card is excluded here and styled
		     below, because the host ships it with no radius or fill of its own. */
		  body[${ACTIVE_ATTR}] [class*="_bubble"]:not(:has([class*="_question"])) {
		    --webg-k: 1.45;
		    background-color: var(--webg-body);
		    background-image: var(--webg-spec-gloss), var(--webg-gloss);
		    background-size: 100% 100%, 100% 100%;
		    background-repeat: no-repeat, no-repeat;
		    -webkit-backdrop-filter: none;
		    backdrop-filter: none;
		    box-shadow: var(--webg-bevel), var(--webg-e0);
		  }

		  /* Question-reply card (the host's QuestionReplyView): radius + fill only.
		     It has no surface styling of its own, so without this rule our fill
		     painted a square-cornered rectangle behind the Q&A text. */
		  body[${ACTIVE_ATTR}] [class*="_bubble"]:has([class*="_question"]) {
		    --webg-k: 1.5;
		    border-radius: var(--dsw-radius-xl, 16px);
		    background-color: var(--webg-body);
		    background-image: var(--webg-gloss);
		    background-size: 100% 100%;
		    background-repeat: no-repeat;
		    -webkit-backdrop-filter: none;
		    backdrop-filter: none;
		    box-shadow: var(--webg-bevel);
		  }

		  /* Composer controls, Apple's control tiers over media (WWDC25 session
		     356): a neutral affordance on glass is "clear" liquid glass; the
		     primary action is "prominent" tinted glass — the tint stays dominant
		     for the glyph's contrast, the glass reads through the translucency and
		     the edge light. Scoped under [data-composer-card] (authored in shell
		     source, survives rebuilds); the module classes themselves are hashed
		     and shift every shell update. Too small for the lens map's stretch, so
		     both ride the plain melt. */
		  body[${ACTIVE_ATTR}] [data-composer-card] [class$="_add"] {
		    background-color: color-mix(in srgb, var(--dsw-specific-selector) 40%, transparent);
		    background-image: var(--webg-spec-gloss), var(--webg-gloss);
		    background-size: 100% 100%, 100% 100%;
		    background-repeat: no-repeat, no-repeat;
		    -webkit-backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    box-shadow: var(--webg-bevel), var(--webg-e0);
		  }
		  body[${ACTIVE_ATTR}] [data-composer-card] [class$="_add"]:hover:not(:disabled) {
		    background-color: color-mix(in srgb, var(--dsw-specific-selector) 65%, transparent);
		  }
		  body[${ACTIVE_ATTR}] [data-composer-card] [class$="_primary"] {
		    background-color: color-mix(in srgb, var(--dsw-alias-button-info-fill) 85%, transparent);
		    background-image: var(--webg-spec-gloss), var(--webg-gloss);
		    background-size: 100% 100%, 100% 100%;
		    background-repeat: no-repeat, no-repeat;
		    -webkit-backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    box-shadow: var(--webg-bevel), 0 2px 8px -2px hsl(220 30% 2% / calc(0.30 * var(--webg-shadow-k)));
		  }
		  body[${ACTIVE_ATTR}] [data-composer-card] [class$="_primary"]:hover:not(:disabled) {
		    background-color: color-mix(in srgb, var(--dsw-alias-button-info-hover) 85%, transparent);
		  }
		  /* The sidebar new-session button joins the clear control tier: the same
		     recipe as the composer "+" — token colour-mix, grain + sheen, plain
		     melt (too small for the lens band), the small-control shadow stack.
		     The host .5px l3 border stays host. The shell collapsed variant must
		     keep its bare icon, so a documented-order override strips everything
		     back under a collapsed root. */
		  body[${ACTIVE_ATTR}] [class$="_newSession"] {
		    background-color: color-mix(in srgb, var(--dsw-alias-button-elevated-fill) 42%, transparent);
		    background-image: var(--webg-spec-gloss), var(--webg-gloss);
		    background-size: 100% 100%, 100% 100%;
		    background-repeat: no-repeat, no-repeat;
		    -webkit-backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    backdrop-filter: var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01));
		    box-shadow: var(--webg-bevel), var(--webg-e0);
		  }
		  body[${ACTIVE_ATTR}] [class$="_newSession"]:hover:not(:disabled) {
		    background-color: color-mix(in srgb, var(--dsw-alias-button-floating-hover) 65%, transparent);
		  }
		  body[${ACTIVE_ATTR}] [class*="_collapsed"] [class$="_newSession"] {
		    background-color: transparent;
		    background-image: none;
		    -webkit-backdrop-filter: none;
		    backdrop-filter: none;
		    box-shadow: none;
		  }

		  /* Menu + queue-dock surface repair (wallpaper active). The shell's
		     menu primitive parks fill and blur on a child layer while the
		     surface element itself is isolated - an isolated ancestor forms a
		     backdrop root, so the blur only samples the panel interior.
		     Same on the queue dock panel (:before carries the blur). An
		     element's OWN backdrop-filter ignores its own isolation, so the
		     filter moves onto the surface element. The fill rides the blur
		     element from the wallpaper-tinted body token, no separate grey:
		     glass levels stay usable at every slider position. These surfaces
		     now carry the full material too — the earlier "menus keep the
		     shell's chrome" caution predates the material system, and flat grey
		     read as a dead panel, not glass. */
		  body[${ACTIVE_ATTR}] { --dsw-menu-surface-fill: var(--webg-body); }
		  body[${ACTIVE_ATTR}] [data-menu-material],
		  body[${ACTIVE_ATTR}] [data-composer-dock] [class*="_panel"] {
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    box-shadow: var(--webg-panel-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }

		  /* Token-level unification: the shell's OTHER floating panels (anchored
		     lists, stat/usage panels, rosters, menu child layers) consume the host
		     pair --dsw-specific-menu (fill — slider-adaptive through
		     menu-surface-fill above) + --dsw-menu-backdrop-filter (the host's fixed
		     blur(40px) saturate(150%)). Their hashed module classes are out of
		     stable-selector reach, but the token is not: wire it to the same chain
		     the glass slider drives, so ALL floating chrome melts at one strength
		     and takes the lens with it. (macOS: html[data-platform=darwin]
		     re-asserts --dsw-specific-menu at higher specificity — desktop-vibrant
		     is host territory there anyway; Windows/browser builds are unaffected.) */
		  body[${ACTIVE_ATTR}] {
		    --dsw-menu-backdrop-filter: var(--webg-chain-t2, var(--webg-backdrop, blur(40px) saturate(150%)));
		    /* The same panels paint their own fill from --dsw-specific-menu. Leaving
		       it at the host value stacks an opaque rectangle on top of the glass and
		       reads as a second, inset panel. Clear it so the glass body is the only
		       fill. */
		    --dsw-specific-menu: transparent;
		  }
		  body[${ACTIVE_ATTR}][${LENS_ATTR}] {
		    --dsw-menu-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t2, blur(40px) saturate(150%)));
		  }

		  /* Coverage: the two floating surfaces the token pass does not reach.
		     Tooltips are read for a second and then gone — a backdrop capture per
		     tooltip buys nothing legible, so they take the content-layer recipe
		     (body tint + bevel, no blur, no lens) and keep the host's own radius.
		     Submenus that lack the menu material are real menus and get the T2
		     glass; :not() keeps the main menu from painting itself twice. */
		  body[${ACTIVE_ATTR}] [role="tooltip"] {
		    background-color: var(--webg-body);
		    background-image: var(--webg-spec-gloss), var(--webg-gloss);
		    background-size: 100% 100%, 100% 100%;
		    background-repeat: no-repeat, no-repeat;
		    -webkit-backdrop-filter: none;
		    backdrop-filter: none;
		    box-shadow: var(--webg-bevel), var(--webg-e0);
		  }
		  body[${ACTIVE_ATTR}] [role="menu"]:not([data-menu-material]) {
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.4)));
		    backdrop-filter: var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.4)));
		    box-shadow: var(--webg-panel-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }

		  /* Settings modal and sibling dialogs: the shell paints dialogs on
		     an opaque layer-2 panel. While a wallpaper is active, dialogs
		     join the glass system - the mask behind them already frosts the
		     app (the mask blur token is wired to the glass slider in
		     applyEffects). color-mix keeps the host hue at 80% opacity, and the
		     panel now carries the full material (sheen + edge stack + grain) -
		     the showcase surface of the system.
		     Two CSS-module naming conventions must both be caught: the infix
		     form [class*="_dialog_"] (compounds like _dialogHeader lack the
		     trailing underscore and are correctly skipped) and the suffix form
		     [class$="_panel"] — but ONLY as a DIRECT child of an overlay
		     container ([class$="_overlay"] > [class$="_panel"]): the settings
		     window and lightbox panels are the overlay's flex children, while
		     third-party sections nest their own hash_panel wrappers deep inside
		     the settings content (a descendant rule glassed those empty inner
		     wrappers into visible grey slabs). Menus are excluded: they keep
		     their own slider-adaptive fill. */
		  body[${ACTIVE_ATTR}] [class*="_dialog_"] {
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    box-shadow: var(--webg-deep-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }
		  /* The filter is the part that makes its host the containing block for fixed
		     and absolutely positioned descendants. A dialog that WRAPS an overlay
		     panel must not get it: the panel's ::before already carries the melt, and
		     third-party settings sections inside that panel anchor fixed layers to the
		     viewport (the "bili 设置" blanking documented below). Dialogs with no
		     overlay panel inside keep the filter on the element itself. */
		  body[${ACTIVE_ATTR}] [class*="_dialog_"]:not(:has([class$="_overlay"] > [class$="_panel"])) {
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		  }

		  /* Overlay window panels (the settings window, the lightbox) carry the
		     melt on a ::before layer instead of on the panel itself.
		     backdrop-filter makes its host the CONTAINING BLOCK for fixed and
		     absolutely positioned descendants (Filter Effects spec) — the panel
		     hosts every third-party settings section, and billion-context's
		     "bili 设置" anchors fixed layers to the viewport: the moment the
		     panel became their containing block its whole tree laid out wrong
		     and the dialog went blank (one stray icon left). A ::before carries
		     tint + material + the chain but is nobody's ancestor, so content
		     anchors exactly as the host built it. The panel keeps its host
		     position: relative + z-index: 1 — its own stacking context, so the
		     -1 pseudo paints above the (now transparent) panel fill and below
		     the content. Wallpaper-off restores the host's opaque fill, so the
		     transparent override must ride the active attribute. */
		  body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material]) {
		    position: relative;
		    background-color: transparent;
		    box-shadow: var(--webg-panel-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }
		  body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material])::before {
		    content: ""; position: absolute; inset: 0; z-index: -1;
		    border-radius: inherit;
		    background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 80%, transparent);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		  }

		  /* Third-party full-page surfaces. The wallpaper transparency turns
		     --dsw-alias-bg-base into a hole-puncher: any consumer expecting the
		     host's opaque base becomes see-through and the chrome behind shows
		     through sharply. ds-harness-remote's .dshRemotePage (stable, non-hashed
		     class prefix — same convention as this plugin's webg-*) is the known
		     case; dense content floating above the app gets the dialog treatment:
		     deep fill + full material + the shared chain, not a hole. The melt
		     rides a ::before layer (same containment reasoning as the overlay
		     window panels: the page hosts third-party content whose fixed layers
		     must keep anchoring to the viewport — and the page is position:fixed
		     with a z-index, so it is already its own stacking context and the
		     -1 pseudo paints above its transparent fill, below its content). */
		  body[${ACTIVE_ATTR}] .dshRemotePage {
		    background-color: transparent;
		    box-shadow: var(--webg-panel-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }
		  body[${ACTIVE_ATTR}] .dshRemotePage::before {
		    content: ""; position: absolute; inset: 0; z-index: -1;
		    border-radius: inherit;
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    backdrop-filter: var(--webg-lens-chain, var(--webg-chain-t3, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01))));
		    box-shadow: var(--webg-deep-shadow, 0 24px 64px rgba(0, 0, 0, 0.4));
		  }

		  /* Bottom workbench dock (dsh-better-sidebar's editor/terminal panel).
		     Direction (user decision, 2026-11-06): LIGHT glass, not raw. The old
		     "directly transparent" version made a half-screen slab read as a hole,
		     and on a bright wallpaper the tab labels lost their ground. It now
		     carries the t2 chain with a thinner body (k 0.8) — enough material to
		     read as a panel, still clearly the wallpaper underneath.
		     Its own settings document [data-dsh-bottom-panel] as the public
		     custom-CSS hook, so the attribute is a stable, sanctioned selector. */
		  body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] {
		    --webg-k: 0.8;
		    background-color: var(--webg-body);
		    background-image: var(--webg-glass-layers);
		    background-size: var(--webg-glass-sizes);
		    background-repeat: var(--webg-glass-repeats);
		    -webkit-backdrop-filter: var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01)));
		    backdrop-filter: var(--webg-chain-t2, var(--webg-backdrop, blur(12px) saturate(1.5) brightness(1.04) contrast(1.01)));
		    box-shadow: var(--webg-panel-shadow, 0 12px 40px rgba(0, 0, 0, 0.14));
		  }
		  body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBar"],
		  body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBarPlus"] {
		    background-color: transparent;
		    background-image: none;
		    box-shadow: none;
		  }
		  /* Motion: everything here is gated by prefers-reduced-motion. The wake
		     (see triggerGlassWake) swells the registered --webg-rim once per
		     wallpaper switch; webg-bar-in springs the crop bar in; the registered
		     custom properties make edge/dim changes glide instead of snapping. */
		  @keyframes webg-bar-in {
		    from { opacity: 0; transform: translateY(6px) scale(0.98); }
		    to { opacity: 1; transform: none; }
		  }
		  @media (prefers-reduced-motion: no-preference) {
		    body[${ACTIVE_ATTR}] [data-composer-card],
		    body[${ACTIVE_ATTR}] [class*="_bubble"],
		    body[${ACTIVE_ATTR}] [data-menu-material],
		  body[${ACTIVE_ATTR}] [data-composer-dock] [class*="_panel"],
		  body[${ACTIVE_ATTR}] [class*="_dialog_"],
		  body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material]),
		  body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material])::before,
		  body[${ACTIVE_ATTR}] [class$="_newSession"],
		  body[${ACTIVE_ATTR}] .dshRemotePage,
		  body[${ACTIVE_ATTR}] .dshRemotePage::before,
		  body[${ACTIVE_ATTR}] [data-dsh-bottom-panel],
		  body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBar"],
		  body[${ACTIVE_ATTR}] .webg-adjust-bar {
		      transition: background-color 180ms ease, box-shadow 180ms ease, --webg-adapt-dim 600ms ease;
		    }
		    /* Glass thickness glides: the registered --webg-rim eases instead of snapping. */
		    body { transition: --webg-rim 700ms ease; }
		    .webg-adjust-bar { animation: webg-bar-in 240ms ease-out backwards; }
		  }

		  /* Edge refraction — the lensing signature (Chromium only; the UA gate
		     that sets ${LENS_ATTR} never flips in Safari/Firefox, where url() in
		     backdrop-filter parses and then silently kills the whole chain).
		     v3: every hero surface owns a filter built at its own pixel size, and
		     paintLensSlot() hands it to the surface through --webg-lens-chain. That
		     is why there is no shared #webg-lens selector block here any more: a
		     single stretched map gave a 720px composer a ~61px band at its ends and
		     ~10px at its top. Content surfaces (bubbles) and the dock stay off the
		     lens on purpose — their area is small or their text is dense. */

		  /* Windows desktop: the window-controls strip is an opaque host
		     overlay (titleBarOverlay colour, fed from the renderer-measured
		     palette). Blend the wallpaper up into it with a short fade from
		     the overlay's own colour, scoped
		     to the desktop marker html[data-windows-titlebar] (absent in
		     browsers) and off in fullscreen. The fade is dark, always. */
		  body { --webg-titlebar-fill: #1b1b1c; }
		  html[data-windows-titlebar]:not([data-fullscreen]) body[${ACTIVE_ATTR}] .webg-scrim::before {
		    content: ""; position: absolute; top: 0; left: 0; right: 0;
		    height: var(--dsh-windows-titlebar-height, 40px);
		    background: linear-gradient(var(--webg-titlebar-fill, #1b1b1c), transparent);
		  }

		  /* Accessibility: prefers-reduced-transparency (Windows transparency
		     effects off, macOS Reduce transparency). Glass off, surfaces back
		     to solid fills; the wallpaper stays, legibility carried by the
		     veil and the solids. Selectors mirror the glass rules above so
		     this block wins by document order; backdrop-filter re-asserts with
		     !important because the lens block above carries higher specificity
		     (two body attributes) that order alone cannot beat. */
		  @media (prefers-reduced-transparency: reduce) {
		    body[${ACTIVE_ATTR}] {
		      --dsw-specific-input-major: #26272c;
		      --dsw-specific-bubble: #26272c;
		      --dsw-menu-surface-fill: #43454a;
		      --dsw-mask-blur: none !important;
		      /* The glass body becomes a solid: no tint alpha, no gloss, no
		         specular pools. This is the "frostier" read Apple's Reduce
		         Transparency asks for, not a slightly clearer one. */
		      --webg-body: #26272c;
		      --webg-spec-gloss: none;
		      --webg-gloss: none;
		      --webg-pointer-gloss: none;
		      /* !important: the lens-variant token override above carries higher
		         specificity than this block's selector can match without it. */
		      --dsw-alias-settings-card-fill: var(--dsw-alias-bg-layer-2);
		      --dsw-menu-backdrop-filter: none !important;
		    }
		    body[${ACTIVE_ATTR}] [data-composer-card],
		    body[${ACTIVE_ATTR}] [class*="_bubble"],
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_add"],
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_primary"],
		    body[${ACTIVE_ATTR}] [data-menu-material],
		    body[${ACTIVE_ATTR}] [role="menu"]:not([data-menu-material]),
		    body[${ACTIVE_ATTR}] [role="tooltip"],
		    body[${ACTIVE_ATTR}] [data-composer-dock] [class*="_panel"],
		    body[${ACTIVE_ATTR}] [class*="_dialog_"],
		    body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material]),
		    body[${ACTIVE_ATTR}] [data-dsh-bottom-panel],
		    body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBar"],
		    body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBarPlus"],
		    body[${ACTIVE_ATTR}] [class$="_newSession"],
		    body[${ACTIVE_ATTR}] [class$="_newSession"]:hover:not(:disabled),
		    body[${ACTIVE_ATTR}] .webg-adjust-bar {
		      -webkit-backdrop-filter: none !important;
		      backdrop-filter: none !important;
		      background-image: none;
		      box-shadow: var(--dsw-elevation-soft, 0 3px 8px rgba(0, 0, 0, 0.08));
		    }
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_add"],
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_add"]:hover:not(:disabled) {
		      background-color: var(--dsw-specific-selector);
		    }
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_primary"],
		    body[${ACTIVE_ATTR}] [data-composer-card] [class$="_primary"]:hover:not(:disabled) {
		      background-color: var(--dsw-alias-button-info-fill);
		    }
		    body[${ACTIVE_ATTR}] [class$="_newSession"],
		    body[${ACTIVE_ATTR}] [class$="_newSession"]:hover:not(:disabled) {
		      background-color: var(--dsw-alias-button-elevated-fill);
		    }
		    body[${ACTIVE_ATTR}] [class*="_dialog_"],
		    /* Overlay window panels carry their material on a ::before layer
		       (containing-block safety — see the glass section): under reduced
		       transparency the whole layer is removed and the panel's own solid
		       fill above takes over. The tab strip, which returns to its opaque host fill. */
		    body[${ACTIVE_ATTR}] [class$="_overlay"] > [class$="_panel"]:not([data-menu-material])::before,
		    body[${ACTIVE_ATTR}] .dshRemotePage::before {
		      content: none;
		    }
		    body[${ACTIVE_ATTR}] .dshRemotePage {
		      background-color: var(--dsw-alias-bg-layer-2);
		    }
		    body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBar"],
		    body[${ACTIVE_ATTR}] [data-dsh-bottom-panel] [class$="_tabBarPlus"] {
		      background-color: var(--dsw-alias-bg-layer-1);
		    }
		  }

		  /* Accessibility: prefers-contrast (Windows/macOS "increase contrast").
		     A different axis from reduced-transparency: the blur may stay, but
		     the fills go near-opaque and the hairline ring steps up to a real
		     border so text contrast no longer depends on the backdrop. */
		  @media (prefers-contrast: more) {
		    body[${ACTIVE_ATTR}] {
		      --dsw-specific-input-major: rgba(38, 39, 44, 0.96);
		      --dsw-specific-bubble: rgba(38, 39, 44, 0.94);
		      --dsw-menu-surface-fill: rgba(64, 66, 71, 0.97);
		      /* Same near-opaque body for the v3 surfaces, so every fill agrees
		         instead of only the token-driven ones. */
		      --webg-body: rgb(38, 40, 45);
		      --webg-tint-a: 0.97;
		      --webg-spec-gloss: none;
		      --dsw-alias-settings-card-fill: var(--dsw-alias-bg-layer-2);
		      --webg-glass-shadow:
		        inset 0 0 0 1px rgba(255, 255, 255, 0.4),
		        0 1px 2px rgba(0, 0, 0, 0.3),
		        0 12px 40px rgba(0, 0, 0, 0.35);
		      --webg-panel-shadow:
		        inset 0 0 0 1px rgba(255, 255, 255, 0.4),
		        0 1px 2px rgba(0, 0, 0, 0.3),
		        0 12px 40px rgba(0, 0, 0, 0.35);
		      --webg-deep-shadow:
		        inset 0 0 0 1px rgba(255, 255, 255, 0.4),
		        0 1px 2px rgba(0, 0, 0, 0.3),
		        0 12px 40px rgba(0, 0, 0, 0.35);
		    }
		    body[${ACTIVE_ATTR}] [class$="_newSession"],
		    body[${ACTIVE_ATTR}] [class$="_newSession"]:hover:not(:disabled) {
		      background-color: var(--dsw-alias-button-elevated-fill);
		    }
		  }

		  /* ── Picker chrome (token-driven, theme-aware) ── */
		  /* padding-top lifts the first row off the settings-section divider so the
		     search/language row breathes; gap keeps every row evenly spaced.
		     Type scale follows the shell: 14px body → 13px controls → 12px hints. */
		  .webg-picker { display: flex; flex-direction: column; gap: 12px; padding-top: 10px; max-width: 900px; }
		  /* Page heading mirrors the shell's own section headings (18px/600, no
		     margins) — the sidebar label is the short nav name, this carries the
		     full product name. */
		  .webg-heading { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
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
		  .webg-grid-empty {
		    grid-column: 1 / -1;
		    display: flex; align-items: center; justify-content: center;
		    padding: 24px 12px; text-align: center;
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
		// The client runner (dsh-cordis-client-runner) rejects ctx.get() of any
		// service this plugin does not declare. slots registers the settings section,
		// locale drives the bilingual UI, theme drives the veil/scheme reactions.
		const inject = ["slots", "locale", "theme"];

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

		  // 0b. Theme: the shell theme service is still subscribed ("theme/change")
		  //     so the shell can rely on the binding, but the MATERIAL is dark-pinned
		  //     — a flip only re-runs applyEffects(), whose change key makes it a
		  //     no-op. Same for the OS prefers-color-scheme fallback.
		  const themeSvc = typeof ctx.get === "function" ? ctx.get("theme") : undefined;
		  if (themeSvc && typeof themeSvc.getTheme === "function") {
		    if (typeof ctx.on === "function") {
		      try {
		        ctx.on("theme/change", () => { applyEffects(); });
		      } catch { /* event bus unavailable → static theme */ }
		    }
		  } else if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		    try {
		      const mq = window.matchMedia("(prefers-color-scheme: dark)");
		      if (typeof mq.addEventListener === "function") {
		        const onScheme = () => { applyEffects(); };
		        mq.addEventListener("change", onScheme);
		        if (typeof ctx.effect === "function") {
		          ctx.effect(() => () => mq.removeEventListener("change", onScheme));
		        }
		      }
		    } catch { /* no matchMedia → static */ }
		  }

		  // OS reduced-transparency flips re-run the effects: the lens JS gate
		  // (lensOn) reads the media query on every applyEffects pass.
		  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		    try {
		      const rtMq = window.matchMedia("(prefers-reduced-transparency: reduce)");
		      if (typeof rtMq.addEventListener === "function") {
		        const onRt = () => { applyEffects(); };
		        rtMq.addEventListener("change", onRt);
		        if (typeof ctx.effect === "function") {
		          ctx.effect(() => () => rtMq.removeEventListener("change", onRt));
		        }
		      }
		    } catch { /* no matchMedia -> static */ }
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
		      return () => {
		        tag.remove();
		        // The lens <svg defs> is created lazily by applyEffects, long after
		        // this fiber registered — pull it down here so teardown is total.
		        const lens = document.getElementById(LENS_SVG_ID);
		        if (lens) lens.remove();
		      };
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
		        sampledLuminance = null;
		        sampledColor = null;
		        if (previewProbe) { previewProbe.remove(); previewProbe = null; }
		        if (glassWakeTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		          window.clearTimeout(glassWakeTimer);
		          glassWakeTimer = 0; glassWake = false;
		        }
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
		        document.body.removeAttribute(DARK_ATTR);
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

		  // Nav icon: the settings sidebar hardcodes icons by section id
		  // (account/models/plugins/...) and falls back to a gear for every
		  // plugin-registered section; nav rows expose no per-row hook (no
		  // data-id, class names are module-suffixed), so the icon is swapped
		  // in place: watch for nav rows whose label text is ours and replace
		  // the default gear SVG with the plugin wallpaper glyph. The gear's
		  // class attribute is copied so the shell's sizing styles still apply,
		  // and a dataset guard keeps the swap idempotent across re-renders.
		  const NAV_ICON_SVG =
		    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
		    '<rect x="2" y="2" width="12" height="12" rx="2"/>' +
		    '<circle cx="5.8" cy="5.8" r="1.1"/>' +
		    '<path d="M14 10l-3.33-3.33L3.33 14"/></svg>';
		  const styleNavIcon = () => {
		    if (typeof document.querySelectorAll !== "function") return;
		    for (const row of document.querySelectorAll('button[class*="navCell"]')) {
		      if (row.dataset && row.dataset.webgNavIcon) continue;
		      if (row.textContent !== S().navLabel) continue;
		      const gear = row.querySelector("svg");
		      if (!gear) continue;
		      row.dataset.webgNavIcon = "1";
		      const tpl = document.createElement("span");
		      tpl.innerHTML = NAV_ICON_SVG;
		      const svg = tpl.firstChild;
		      const cls = gear.getAttribute && gear.getAttribute("class");
		      if (cls) svg.setAttribute("class", cls);
		      gear.replaceWith(svg);
		    }
		  };
		  // 4. Own settings section — NOT a row inside General. The settings dialog
		  //    enumerates every registered settings.section slot for its nav
		  //    (settings-general and settings-plugins register theirs the same way),
		  //    so the picker renders as a full page with its own sidebar entry,
		  //    ordered after the built-in sections (general 0, plugins 15).
		  if (ctx.slots) {
		    ctx.slots.inject("settings.section", () =>
		      ctx.slots.register(
		        { name: "settings.section", id: "we-background", order: 20, label: () => S().navLabel },
		        () => React.createElement(WallpaperPicker),
		      ),
		    );
		  }

		  // 4b. Drive the nav icon swap (defined above): the settings dialog mounts
		  //     its nav only while open. Chat streaming mutates the body subtree
		  //     continuously, so sweep only when a mutation can have touched a nav
		  //     cell — a sweep per batch was hundreds of querySelectorAll calls a
		  //     second for a gear that only exists inside the settings nav.
		  //     Disposed with the plugin fiber.
		  const navTouched = (records) => {
		    for (const rec of records) {
		      const nodes = [rec.target];
		      if (rec.addedNodes) for (const n of rec.addedNodes) nodes.push(n);
		      if (rec.removedNodes) for (const n of rec.removedNodes) nodes.push(n);
		      for (const n of nodes) {
		        if (!n) continue;
		        const el = n.nodeType === 1 ? n : n.parentElement;
		        if (!el) continue;
		        if (el.closest && el.closest('button[class*="navCell"]')) return true;
		        if (el.querySelector && el.querySelector('button[class*="navCell"]')) return true;
		      }
		    }
		    return false;
		  };
		  if (ctx.effect && typeof MutationObserver === "function" && typeof document !== "undefined") {
		    ctx.effect(() => {
		      const mo = new MutationObserver((records) => {
		        if (navTouched(records)) styleNavIcon();
		      });
		      mo.observe(document.body, { childList: true, subtree: true });
		      styleNavIcon();
		      return () => mo.disconnect();
		    });
		  }

		  loadInventory(false);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
