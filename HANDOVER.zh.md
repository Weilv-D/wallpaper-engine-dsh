# 交接文档

`wallpaper-engine-dsh` v2.3.6 —— 把本机 Wallpaper Engine 壁纸库变成 DSH Web GUI 的动态背景，并给外壳浮层换上一套"液态玻璃"材质。

这份文档写给接手的人：运行时是什么样、为什么这样设计、哪里容易坏、坏了先看哪里。**"怎么读代码"在 `READING.zh.md`；"怎么发版"在 `RELEASING.zh.md`；材质公式的调研依据在 `liquid-glass-report.zh.md`。**

---

## 1. 边界

- 只读本机 Wallpaper Engine 安装目录；只监听 loopback；不联网、不上报。
- 只渲染 `video` 与 `web` 两类壁纸；`scene` / `application`（`.pkg`）在清单阶段就被过滤。
- 不修改 DSH 外壳代码，只通过 CSS 变量、`data-*` 属性、`backdrop-filter` 与设置分区接入。
- 浏览器半区是零依赖单文件 bundle；宿主半区零运行时依赖。

两个半区通过 `/we-background/*` 通信：

```
┌──────────────────────────── DSH Web GUI (Chromium) ────────────────────────────┐
│  外壳（React/CSS Modules）                                                      │
│    ├─ 本插件 client：固定图层 + 遮罩 + CSS 变量 + 设置分区                      │
│    └─ 网页壁纸：<iframe sandbox="allow-scripts">（不透明源）                    │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                                   │ 同源 HTTP（loopback）
┌──────────────────────────────────┴─────────────────────────────────────────────┐
│  本插件 host（Node / Cordis）                                                   │
│    /we-background/inventory · /media/<token>… · /preview/<token>                │
│    → Steam 库 → project.json → 文件字节                                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 宿主半区（`lib/index.js` + `lib/core.js`）

### 2.1 发现

`discover()` 依次尝试：

1. Windows 注册表 `HKCU\Software\Valve\Steam` 的 `SteamPath`（`reg.exe`，5 s 超时，非 Windows 直接跳过）；
2. 每个 Steam 根下的 `steamapps/libraryfolders.vdf`，解析出现代 `"0" { path … }` 与旧式 `"1" "D:\SteamLibrary"` 两种格式；
3. 一组常见安装路径（`C:\Program Files (x86)\Steam`、`D:\SteamLibrary` 等）作为兜底。

安装目录的判定标准是 `steamapps/common/wallpaper_engine/<wallpaper32.exe | Wallpaper Engine.app>` 存在；库根是"包含该安装目录"的 Steam 库。发现结果缓存 10 分钟。

### 2.2 清单

`core.buildInventoryFrom()` 枚举：

- `<install>/projects/defaultprojects`、`<install>/projects/myprojects`
- `<library>/steamapps/workshop/content/431960`

每个目录读 `project.json`，要求 `file` 是非空字符串且解析后仍在项目目录内；`preview` 同样做包含性检查。类型取 `project.json` 的 `type`（合法值内），否则按扩展名推断。只保留 `video` / `web`。

壁纸条目形状：

```json
{
  "id": "workshop 文件夹名",
  "title": "标题或文件夹名",
  "type": "video | web",
  "playable": true,
  "media": "/we-background/media/<token>[/<入口相对路径>]",
  "preview": "/we-background/preview/<token>"
}
```

网页壁纸的 `media` 指向**入口文件本身**（如 `/media/<token>/index.html`），这样文档内的相对路径按浏览器规则解析；视频壁纸是裸 token。`playable` 要求入口文件存在且令牌签发成功。

播放列表从 `<install>/config.json` 读取（现代 `general.playlists[]` 与旧式 `selectedwallpapers.<monitor>.playlist`），条目经路径/工坊 id/文件夹名三级解析，只保留可播放项；`unresolvedCount` 记录没解析出来的条目数。

### 2.3 路由

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET/HEAD | `/we-background/inventory[?refresh=1]` | JSON；`refresh=1` 重签全部令牌后重建 |
| GET/HEAD/OPTIONS | `/we-background/media/<token>[/<rel…>]` | 入口文件或项目内子资源；支持 Range |
| GET/HEAD/OPTIONS | `/we-background/preview/<token>` | 预览图；无子资源、无目录形式 |

- 令牌是 72 位随机 `base64url`，按 `<id>:media` / `<id>:preview` 复用。TTL 重建**不换令牌**（正在播放的视频流不会被打断），只有显式 `refresh=1` 才全量重签，旧 URL 立即失效。
- 子资源只允许 `media` 且该条目有 `rootDir`；`..`、空段、反斜杠一律 403；词法包含检查之后还有 `realpath` 兜底（防符号链接逃逸）。
- 响应头：`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Accept-Ranges: bytes`；HTML/SVG 额外带 `Content-Security-Policy: sandbox allow-scripts`。
- `Access-Control-Allow-Origin: *` 只加在 media/preview：网页壁纸在沙箱 iframe 里是不透明源，取自己的子资源在浏览器看来是跨域。令牌本身就是能力边界。
- Range 只接受单段 `bytes=a-b`；多段/非法值按 RFC 9110 §14.2 忽略并回 200；不可满足回 416 + `Content-Range: bytes */size`。短读（文件在 stat 与 open 之间缩小）会销毁响应，避免客户端挂着等。

### 2.4 缓存与生命周期

- 清单缓存 30 s；发现缓存 10 min；并发构建合并为一次（强制刷新会等当前构建结束再重建）。
- `createRouteRegistrar()` 返回 disposer：注销路由、清空令牌、realpath 缓存、两个缓存。
- `apply()` 在 `webServer` 实例上挂 `__weBackgroundDispose` 标记：加载器 0.2.2-rc.1 会把同一个 patch 组合两次，第二次注册会命中 webServer 的重复路由保护。标记让第二次 `apply()` 直接返回同一个 disposer；真正卸载后标记删除，再次 `apply()` 重新注册。
- `cordis.patch.yml` 里的 `insert` 行是唯一挂载路径。空的 bundle 行不会应用包主入口（v2.3.5 曾因此报 "no components"）。

---

## 3. 浏览器半区（`src/client.js`）

### 3.1 状态

模块级 `selection` 是唯一状态源；`subscribe/emit` 驱动 React 设置页与 DOM 图层。持久化键 `wallpaper-engine-dsh:selection`；另有 `wallpaper-engine-dsh:undecodable`（带 schema 标记 `{ v: 1, marks: { id: "size:mtimeMs" } }`，上限 500；刷新不清空，指纹变化才解除；没有 `v` 标记的旧记录——裸 id 数组或 2.3.9 的无标记对象——在加载时整体丢弃，因为无法证明磁盘上的字节仍是当初失败的那份，文件可能在插件外被重新编码；记为 `*` 的判定（宿主无法给出指纹时写入）只在拿不到指纹时生效，宿主能识别文件后由 `releaseUnverifiableVerdicts()` 在加载时释放并删除；仍然播不了的文件会被失败阶梯在数秒内重新标记）。

| 组 | 字段 | 说明 |
| --- | --- | --- |
| 选择 | `id` | 当前壁纸 id |
| 运行时 | `url` `type` `playing` `loading` `adjusting` `fps` | 不持久化 |
| 可读性 | `scrim` `autoScrim` `blur` `border` `wallpaperBlur` | 滑杆与开关 |
| 材质 | `lens` `pointerLight` | 折射与指针高光 |
| 轮播 | `rotationEnabled` `rotationGroupId` `rotationGroups` `rotationSeeded` | 组内含 `interval` / `order` / `wallpaperIds` |
| 资源 | `pauseOnHidden` `pauseOnBattery` | |
| 取景 | `fit` `zoom` `offsetX` `offsetY` `rotation` `mirrored` | `rotation` 仅 free |
| 其它 | `lang` | `auto` / `zh` / `en` |

`readPersisted()` 对每个字段做范围钳制（例如 `blur` 只接受 0–14）；`clampCrop()` 在存储创建时把旧版本可能留下的越界取景重新收进当前 fit 模式允许的信封。

### 3.2 图层

`syncLayers()` 比较 `type|id`：

- 新壁纸：创建 `.webg-layer`（`position: fixed; z-index: -2`），内部放 `video`（muted/loop/playsinline）、`iframe`（`sandbox="allow-scripts"`、`allow="autoplay"`、`referrerpolicy="no-referrer"`）或 `img`；创建 `.webg-scrim`（`z-index: -1`，纯黑遮罩）；旧层淡出 520 ms 后移除（`LEAVE_MS = 640` 兜底）。
- 同一壁纸：`refreshLiveMediaUrls()` 原位换 `src`（视频保留 `currentTime`）。
- 清空：淡出后移除 scrim、`data-webg-wallpaper` 与全部变量。

网页壁纸挂载前会先用 1 px 离屏图探测预览图平均亮度，作为"首帧到达前"的可读性证据。

### 3.3 采样与可读性

- 视频/图片：`sampleFrame()` 画到 16×16 canvas，取 Rec.601 平均亮度、标准差、平均 RGB。触发点：`loadeddata` / `load`，以及 2.5 s 轮询（视频中途变亮也能抬遮罩）。
- 网页壁纸：预览图探测（`probePreviewLuminance`），因为 iframe 内容不可读。
- `materialTokens()` 用亮度与"花杂度"（标准差）算体色与边光；`applyEffects()` 写变量：

| 变量 | 公式/来源 |
| --- | --- |
| `--webg-tint-h` / `-h2` | 平均色色相 / 互补色相 |
| `--webg-tint-s` | `min(14%, 5.5% + 7.5%×chroma)` |
| `--webg-tint-l` | `14% + 6%×(1−lum)` |
| `--webg-tint-a` | `clamp(0.16, 0.34, 0.18 + 0.06×lum + 0.10×busy)` |
| `--webg-rim` | `min(1.15, 0.70 + 0.20×(1−lum) + wake 0.22)` |
| `--webg-spec` | `0.32 + 0.16×(1−lum)` |
| `--webg-shadow-k` | `0.55 + 0.45×lum` |
| `--webg-scrim-color` | 黑，α = `max(scrim, min(0.55, lum−0.5))`；仅 `autoScrim` 开启，关闭时 α = `scrim` |
| `--webg-adapt-dim` | 黑，α = `min(0.35, max(0, lum−0.5)×0.7)` |
| `--webg-glass-brightness` | `clamp(1.02, 1.18, 1.10 − 0.10×max(0,lum−0.5) + 0.05×max(0,0.5−lum))` |

`applyEffects()` 用变化 key 提前返回（采样量化到 16 级色相/20 级花杂度、旋钮、取景、透镜开关）。`clearEffects()` 必须与写点一一对应。

### 3.4 失败阶梯

`handleMediaFailure(sel, decodeFailure)`：

1. 第一次错误：10 s 节流内只重挂一次，并**非强制地**重拉当前清单（`loadInventory(false)`——强制 `refresh=1` 会重签全局令牌，把其他窗口正在播放的 URL 全部杀掉，两个窗口会互相触发恢复形成乒乓）；
2. 第二次若判定为解码类失败（`MediaError.code` 为 3 解码错误 / 4 源不支持，或零帧检测器发现"在播放但解不出帧"）：把 id → 文件指纹（`size:mtimeMs`，来自清单条目）写入持久化的"无法解码"映射（`wallpaper-engine-dsh:undecodable`，最多 500 条），条目立即从网格与轮转列表消失；若它正在显示，切到下一个轮转候选，没有候选就清空图层；
3. 其他重复失败：若存在预览图，降级为静态预览（`demotedToPreview`）；没有预览则清空。

"康复"路径：采样成功（视频 `loadeddata`、图片 `load`）或网页 iframe `load` 时 `clearMediaFailures()` 清零计数；零帧检测器在播放 2 s 后仍解码不出任何帧时按解码失败处理，解出帧则清零。降级标记只在"切到另一张壁纸再切回来"（id 变化）或点"刷新"（`onRefresh()` 清空降级与失败计数后重载）时解除；"无法解码"不参与刷新清除——`isUndecodable` 只在当前文件指纹与记录一致时生效，文件被替换或重新编码后自动回到网格；记录为 `*`（宿主当时给不出指纹）的判定只在拿不到指纹时隐藏，清单一旦带上指纹，`releaseUnverifiableVerdicts()` 会在加载时删除它，仍然失败的条目由阶梯写入真实指纹。升级后首次加载会丢弃没有 schema 标记的旧记录（裸 id 数组或 2.3.9 的无标记对象）：这类记录无法证明磁盘上的字节仍是当初失败的那份，文件若已在插件外修好，一次加载即可回归；仍损坏的条目会在数秒内被失败阶梯重新标记。对**当前正显示**的已降级壁纸再点一次不会重试——id 没有变化。

另有一条兜底 `attachFirstFrameWatchdog`：视频挂载 6 s 后仍在图层上，且已经报错或者在播放却没有画面（`readyState < 2` 或 `videoWidth === 0`），就按解码失败计入阶梯；若元素带 error，则按其真实形状分类——code 1/2（网络形）不算解码证据，只有 code 3/4 才写「无法解码」。它覆盖 Chromium 既不触发 `error` 也不触发 `playing` 的静默黑屏——没有这条，重试请求一旦失败，图层会一直黑着而条目仍留在网格里。

### 3.5 其它运行时

- 轮播：列表来自 WE 播放列表（一次性播种：只有找到 ≥2 张可播放项的 WE 播放列表才消耗机会，找不到时以后每次加载重试；用户手建过列表同样视为已消耗，此后删光列表不自动导入），也可手建/编辑；顺序或随机，间隔 1–1440 分钟（预设 1/5/10/30/60/120）；定时器是一次性 setTimeout，随每次切换重建；手动修改间隔会立即重置倒计时。
- 自动暂停：标签页隐藏、电量低于 20% 且未充电；`prefers-reduced-motion` 时默认不播放。
- FPS：rAF 每秒统计一次，写入 `selection.fps`；隐藏标签页时 rAF 自然停摆。

---

## 4. 玻璃系统

这是插件的核心，也是历次修复最集中的地方。

**一条判据决定什么上玻璃：它是不是浮在内容之上。**

| 层 | 处理 | 成员 |
| --- | --- | --- |
| 页面层 | 不画材质，直接透出壁纸 | 对话页、轨迹页、右侧栏、设置页内容区 |
| 浮层 | 玻璃（按面积取 T1–T3） | 输入卡、菜单/下拉、底部工作台、对话框、浮层窗口面板、取景调整条 |
| 瞬时提示 | 只着色，不采样背景 | tooltip |

页面层只改令牌、不盖材质：页面本身就是背景，再盖一层等于把壁纸挡掉。浮层必须和背后断开才读得清，所以用 `backdrop-filter` 采样壁纸，再压体色与边光。tooltip 读一眼就走，为它逐帧采样背景不划算，退到「体色 + 斜面、无模糊」。

新增表面先问它在哪一层，再决定要不要材质；不要按「看起来该不该黑」逐页特判。分档见 §4.3，覆盖清单见 §4.5。

### 4.1 层序

```
壁纸层（z −2）
  └─ 黑色遮罩（z −1，α 由采样与 scrim 决定）
       └─ 外壳内容（z ≥ 0）
            └─ 玻璃表面：体色 + 7 层背景 + backdrop-filter（+ 每面位移图）
```

`body` 上的三个属性是全局开关：`data-webg-wallpaper`（有壁纸）、`data-webg-lens`（折射开启且当前环境可用）。曾经还有一个 `data-webg-dark` 暗色镜像属性，材质改为永久暗色后无消费者，已随本次修复退役。

### 4.2 体色与边光

材质是"暗色玻璃"，不跟随外壳明暗主题：

- 体色：色相取自壁纸平均色，彩度上限 14%，亮度 14–20%，透明度 0.16–0.34。画面越暗，体色越亮（避免在白字下变成纯黑）。
- 边光：顶部 1 px 镜面高光、2 px 衰减、7 px 内反射、底部反弹光、两侧暗墙、外圈暗轮廓；亮度随壁纸变暗而增强（暗画面上玻璃边缘更"厚"）。
- 高光:4 个径向光池(左上/右上/中上/底部互补色),加一层 180° 的体色渐变(顶部一丝天光、底部冷色地面)。层序固定为调光层、4 个光池、体色渐变、指针贴边光(顶带 + 底部回弹)共 8 层;`--webg-glass-sizes` / `-repeats` 必须与层数一一对应,短列表会从头部循环,把第 4 个光池铺成亮方块。
- 阴影：斜面（11 条 inset/近距阴影）+ e0–e3 高度层 + 三种投影（glass/panel/deep）。

### 4.3 三档滤镜链

| 档 | 使用场景 | 模糊上限 | 饱和/对比 |
| --- | --- | --- | --- |
| T1 | 取景调整条 | `min(4, glass)` | 1.6 / 1 |
| T2 | 输入卡、菜单、队列坞、新建会话、底栏 | `min(10, glass)` | 1.4 / 0.92 |
| T3 | 设置弹窗、浮层窗口、远程页 | `min(14, max(glass, 6))` | 1.3 / 0.9 |

玻璃滑杆 0–14（上限即最重档的上限）。滑杆为 0 时整条链为 `none`，只剩体色与边光。T3 在滑杆 1 时就会到 6 px，避免"设置弹窗完全没有模糊"。

### 4.4 透镜管线

1. `paintLensSlot()` 读取表面 `clientWidth/Height` 与左上圆角（钳制到 `min(w,h)/2−1`）。
2. `rasterizeLens(w, h, r, band)` 在 canvas 上按 `w+2pad` 光栅化圆角矩形 SDF（`pad = max(2, round(band/2))`），法线用中心差分，权重 `t^2.2`；RG 通道编码 `128 − n×127`，A=255；输出 PNG data URL。单边上限 700 px；缓存 12 条。
3. `createLensSlot()` 为每个表面建一个 `<filter>`：`color-interpolation-filters="sRGB"`、`feImage preserveAspectRatio="none"`（内联 data URL，外链会静默失败）、`feDisplacementMap` 用 R/G、后接 `feGaussianBlur`。
4. `paintLensSlot()` 把 `feImage` 放到 `(−pad, −pad)`、尺寸 `(w+2pad, h+2pad)`，`scale = 4×band`（峰值 `2×band` px），滤波区域按 `reach = 2×band + 4` 逐面换算成百分比——窄表面上固定 `-8%` 会小于峰值。
5. 滤镜链是 `url(#per-surface-filter) <tierChain>`：**先折射，后模糊**。这保证位移在模糊把它抹平之前发生（"bend first, melt after"）。
6. 结果写进 `--webg-lens-chain`；菜单还额外写 `--dsw-menu-backdrop-filter`（外壳的子层消费它）。

重建触发：`ResizeObserver`（每目标独立去抖 140 ms）、`MutationObserver`（只对可能影响透镜表面的变更派发，去抖 90 ms）、窗口尺寸/圆角变化。清理：`disposeLenses()` 移除全部 filter、变量与观察者。

门控：`lensOn = Chromium UA && lens 开关 && 有壁纸 && glass > 0 && !prefers-reduced-transparency`。Safari/Firefox 解析 `url()` 后会丢掉整条链，所以按 UA 直接退回纯模糊。

### 4.5 表面覆盖

| 表面 | 选择器 | 档 | 透镜 | 载体 |
| --- | --- | --- | --- | --- |
| 输入卡 | `[data-composer-card]` | T2 | band 16 | 元素自身 |
| 菜单 | `[data-menu-material]` | T2 | band 12 | 元素自身 + 两个变量 |
| 队列坞面板 | `[data-composer-dock] [class*="_panel"]` | T2 | band 12 | 元素自身 |
| 设置弹窗 | `[class*="_dialog_"]:not(:has([class$="_overlay"] > [class$="_panel"]))` | T3 | band 18 | 元素自身 |
| 浮层窗口面板 | `[class$="_overlay"] > [class$="_panel"]` | T3 | band 18 | `::before` |
| 取景调整条 | `.webg-adjust-bar` | T1 | band 8 | 元素自身 |
| 子菜单 | `[role="menu"]:not([data-menu-material])` | T2 | 无 | 元素自身 |
| 工具提示 | `[role="tooltip"]` | — | 无 | 体色 + 斜面，无模糊 |
| 新建会话 | `[class$="_newSession"]` | T2 | 无 | 元素自身 |
| 底栏工作台 | `[data-dsh-bottom-panel]` | T2（体色 k=0.8） | 无 | 元素自身 |
| 插件页页头 | `[class*="_pageBar"][data-natural]` | — | 无 | 壁纸窗口（`syncHeaderWindow`，栏内绝对定位、`z-index:-1`） |
| 远程页 | `.dshRemotePage` | T3 | 无 | `::before` |
| 消息气泡 | `[class*="_bubble"]` | — | 无 | 体色 + 边光（内容层，不做背景采样） |
| 轨迹页账本 | `div[data-conversation-composer-overlay]:has([data-trajectory-scroll])` | — | 无 | 仅令牌作用域（`--dsw-alias-bg-layer-1: transparent`），页面不再补材质 |
| 右侧栏「开始」页胶囊 | `[data-sidebar-right-guide]`、`[data-sidebar-right-guide-entry]` | — | 无 | 仅令牌作用域；胶囊保留宿主 `.5px` 边框与悬停/展开填充 |
| 底栏工作台空态卡 | `[data-dsh-bottom-panel] [class*="_paneCard"]` | — | 无 | 仅令牌作用域；工作台自身仍是 T2 轻玻璃，卡保留边框与悬停填充 |

**插件页页头为什么用“壁纸窗口”：** 宿主用 `.pageBar[data-natural]::before` 作为页头的绘制层，背景读 `--dsw-alias-bg-base`；插件把该令牌设为 `transparent` 后，页头全透明，滚过的内容会从吸顶栏里透出来。CSS 没有“透明且遮挡”的解法：`backdrop-filter` 只是把背景重新上色（擦不掉），给滚动容器加 `clip-path` 又会把吸顶栏一起裁掉。因此插件在栏内挂一个窗口：`syncHeaderWindow()` 把当前媒体复制进 `.webg-header-window`（高度取 `--plugin-header-paint-height`，`overflow:hidden`，`z-index:-1`），内部 `.webg-header-frame` 按“视口尺寸、减去栏的偏移”摆放，克隆的 `.webg-media` 与原层共用同一套 `object-fit`/裁剪/镜像/模糊样式，像素位置一致；窗口还复制了原层的画布底色（`.webg-header-frame` 的 `--webg-layer-bg`）、同一张抖动噪点（`::after`）和同色的遮罩（`.webg-header-veil` 读 `--webg-scrim-color`），所以暗化与模糊都随页面壁纸实时变化、逐像素对齐；视频克隆静音循环并每秒对齐 `currentTime`，web 壁纸退回预览图；窗口级 scroll/resize 监听(rAF 合帧)在 bar 未吸顶的滚动段即时重锚定条带，不再依赖 1 Hz 定时器追赶。窗口在栏的堆叠上下文里绘制于滚动行之上、标题与标签之下，宿主的 `::after` 分隔线仍在最上层；无栏或无选中壁纸时移除。

**为什么有的表面把滤镜放在 `::before`：** `backdrop-filter` 会让元素成为固定/绝对后代的包含块。设置弹窗里装着第三方分区，billion-context 的 "bili 设置"把固定层锚到视口，滤镜一旦落在面板上，整棵树会错位甚至空白。`::before` 承载材质、不做任何人的祖先，内容锚定不受影响。同理适用于 `.dshRemotePage`。设置弹窗自身只有在**不包含**浮层窗口面板时才把滤镜放在元素上。

**轨迹页为什么要改令牌、而不是盖一层材质：** 会话里的「轨迹」页是宿主的全页账本，它给自己的根容器（`.eciBTa_root`）画的是**面板令牌** `--dsw-alias-bg-layer-1`，而聊天页画的是**页面令牌** `--dsw-alias-bg-base`（`.an3WzG_root`）。插件只把页面令牌设为 `transparent`，所以壁纸一动，聊天页透出壁纸、轨迹页仍是整块 `#232324`。

- **为什么不能在外壳层全局改。** `--dsw-alias-bg-layer-1` 是全应用真实面板的填充（浮层宿主、检查器、diff 块），把它透明化等于到处挖洞，只能在视图内作用域处理。
- **做法。** 把令牌**作用域在视图根上**，靠自定义属性继承把工具栏、分栏、表格、详情、概览一起带透明：直接填充与 `color-mix` 混色合计二十余处声明读的都是它（混色的那几处会变成对应颜色的半透明版，仍可读），页面其余部分保持宿主面板不变。页面自己**不画任何材质**——对话页的根同样不画底（`.an3WzG_root` 要的 `bg-base` 被激活规则换成透明），所以两页看到的是同一件东西：壁纸加全局遮罩。
- **三处例外要单独补。** ①工具栏开关的 6px 圆钮与搜索框聚焦底色把令牌当**控件填充**用（前者透明即消失、开关状态读不出来；后者透明会把聚焦反过来），各补一个 `color-mix`；②**程序源码**面板用 `!important` 把同一令牌当代码底，透明后代码会浮在壁纸上，改回宿主代码底色 `--dsw-alias-markdown-code-block`（同样 `!important`），与别处代码块一致；③请求边界那枚 5px 圆点原本用页面色在轨道上「截断」出 2px 间隙，页面没有颜色就无处可画，环被显式钉成 `transparent`——圆点变成压在线上的一颗珠，0.5px 轨道尺度上损失可忽略，同时防止 `layer-1` 将来变回实色时冒出一圈暗晕。
- **为什么不加 `backdrop-filter`。** 根容器带 `isolation:isolate`（成为 backdrop root，伪元素采到的是空背景），而且它是自己吸顶工具栏和时间轴视口换算的锚点，落滤镜有包含块风险；壁纸太吵就调全局遮罩滑杆，和别的页是同一个旋钮。
- **为什么不给工具栏补材质。** 工具栏虽然写 `position:sticky`，但它是根容器里的非滚动兄弟节点（纵向滚动只发生在账本的 `[data-trajectory-scroll]` 里），透明后不会有行从它下面滑过去。
- **定位依据。** 选择器只用宿主的功能性 data 属性（视图根 `data-conversation-composer-overlay`，账本滚动区 `data-trajectory-scroll`），不碰哈希类名；这条契约连同上面三处例外都在 `scripts/verify-client.mjs` 里有对应断言。

**同一条判据的第二次应用：右侧栏「开始」页。** 同一个令牌也铺在右侧栏「开始」页的入口胶囊上——宿主的 `.p2k40q_entry` 与终端提供方的 `-4GESq_entry` 都是「`.5px` 边框 + `--dsl-guide-entry-radius` 圆角 + `background: var(--dsw-alias-bg-layer-1)`」三件套。列本身的底是页面令牌（已透明），于是胶囊成了那列里唯一的实心块；壁纸一亮就是一堆黑色药丸。两处胶囊共用宿主属性 `data-sidebar-right-guide-entry`（清点过整个 app 包：只有这两个包产出胶囊，且都带该属性）。但「更多工具」那张卡是例外：它是菜单触发器锚点上的一枚裸 `button`，内联构造、没有这个属性，第一版只按属性作用域时它是唯一还剩黑色底的一张。所以插件把令牌同时作用域在**容器** `data-sidebar-right-guide` 上（每张卡都在容器内，「更多工具」也在），属性选择器保留作第二锚点，供提供方在容器外渲染的胶囊使用。边框与悬停/展开填充照旧。仍然不全局改的理由与本段第一条相同：清点显示 `layer-1` 在二十来个包里几乎全是控件与面板填充（输入框、表头、预览、提示），那才是不能挖的洞。

**同一条判据的第三次应用：底栏工作台的空态卡。** 底栏工作台（dsh-better-sidebar 的编辑器/终端面板）本身是浮在页面上的一层，按判据走 T2 轻玻璃，这一点不变。但它空态时铺的那排「开一个标签」卡——文件、Git、任务管理、侧边对话、终端——是工作台**内部**的导航面，不是又一层浮层，却同样读 `--dsw-alias-bg-layer-1` 当填充，于是每张都是实心块。它们的渲染是 `button.paneCard`，内联构造、**没有任何 data 属性**，所以这里只能按类名后缀 `[class*="_paneCard"]` 定位；作用域仍挂在 `[data-dsh-bottom-panel]`（该属性由插件自己的设置文档当作公开自定义入口，稳定），工作台的输入框、菜单壳同样用这个令牌，不能整块透明。工作台的标签条早有一条把 `_tabBar` 与 `_tabBarPlus` 底色清掉的规则，空态卡是它漏掉的最后一块。

### 4.6 无障碍与平台

- `prefers-reduced-transparency: reduce`：玻璃全部转实色（`#26272c`），移除模糊、高光、透镜与 `::before` 材质；壁纸仍在，可读性由遮罩与实色承担。
- `prefers-contrast: more`：保留模糊，但填充接近不透明，边线升级为真实边框。
- `prefers-reduced-motion: no-preference` 才启用过渡：背景/阴影 180 ms、`--webg-adapt-dim` 600 ms、`--webg-rim` 700 ms、调整条 240 ms 入场。
- Windows 桌面：标题栏是宿主的不透明覆盖层，用 `html[data-windows-titlebar]:not([data-fullscreen])` 下的 `.webg-scrim::before` 做深色渐变过渡，高度取 `var(--dsh-windows-titlebar-height, 40px)`。
- macOS：侧栏由宿主原生 vibrancy 负责，插件不覆盖。宿主在 `html[data-platform=darwin]` 下以更高优先级重新声明 `--dsw-specific-menu`，桌面端的菜单填充仍归宿主。

---

## 5. 构建、验证、发布

```sh
npm install        # prepare 钩子触发一次 build
npm test           # core 16 + host 14
npm run build      # src/client.js → lib/client.js
npm run verify     # 在 vm + DOM mock 中加载产物并断言行为
```

- 构建只做三件事：剥离文件头 banner、把函数体包进 `window.__ModuleLoader__.load({ id, factory })`、整体缩进两个 tab。没有转译、没有压缩。
- CI 在 `npm test → build → verify` 之后执行 `git diff --exit-code lib/client.js`：提交的产物必须能由源码精确重建。
- `verify-client.mjs` 是产物级回归网：mock DOM、跑 `apply()`、断言样式变量、图层、透镜、清理。它刻意让 `addEventListener` 每个事件类型只保留一个监听器——同一事件挂两个处理器会静默覆盖。
- 发布：`npm run release`（或 `:minor` / `:major`）。脚本做预检 → 门禁 → 升版本打标签推送；GitHub Actions 用 OIDC 发布到 npm，脚本再确认 `latest` 并打印 Release 地址。策略见 `RELEASING.zh.md`。

---

## 6. 设计决策记录

| 决策 | 原因 |
| --- | --- |
| 材质永远暗色，不跟随外壳明暗 | 壁纸亮度不可控；暗色玻璃 + 黑色遮罩是唯一稳定的白字底。主题服务仍订阅，但只触发一次无操作的重算 |
| 体色薄（α 0.16–0.34），边光厚 | 2026-11 的改版方向：让壁纸透出来，靠边光与体色梯度读出"玻璃"，而不是靠不透明度 |
| 先折射、后模糊 | 模糊在前会把位移的高频细节抹掉，边缘读不出"弯"；位移必须作用在原始背景上 |
| 位移峰值 `2×band` | Apple 实测约 `1.8×band`；取 2 倍是"看得见但不夸张"的折中，且小于单次 `feDisplacementMap` 的 64 px 安全上限 |
| 菜单也上完整材质 | 旧版"菜单保留外壳 chrome"在材质系统里读起来像死灰面板；菜单是浮层，应该和输入卡同一套语言 |
| 浮层窗口的滤镜放 `::before` | `backdrop-filter` 的包含块语义会破坏第三方分区里的固定层；`::before` 没有后代 |
| 折射只做 Chromium | Safari/Firefox 解析 `url()` 后丢弃整条链，宁可退回纯模糊也不让画面消失 |
| 玻璃滑杆上限 14 | 三档上限就是 4/10/14；15–40 只改变模态遮罩，属于"承诺了却没有交付"的死区 |
| 令牌 TTL 稳定、显式刷新才重签 | 后台重建不能打断正在播放的视频流；显式刷新才让旧 URL 失效 |
| `insert` 行是唯一挂载路径 + `apply()` 幂等 | 空 bundle 行不应用包主入口；加载器会重复组合 patch，重复注册会命中路由保护 |

---

## 7. 已知限制与风险

| 项 | 现状 | 影响/建议 |
| --- | --- | --- |
| 中间调对比度 | 亮度 0.9 时约 6.9:1，0.75 时约 3.9:1，0.6 时约 2.7:1（默认 scrim 0.18） | 暗化滑杆是用户的调节杠杆；不要再压低默认 scrim，否则中间调更差 |
| CORS 通配 | media/preview 带 `ACAO: *`，无 Origin 校验 | 令牌是能力边界；loopback 是网络边界。不要移除（会破坏沙箱 iframe 的子资源加载） |
| `class$=` 选择器 | 只在类名是 class 属性最后一个 token 时命中 | 外壳改类名顺序会失配；扩大匹配范围会把无关面板玻璃化，属于已知取舍 |
| 外壳令牌重命名 | 玻璃读 `--dsw-*` 令牌 | 重构后会退化为普通半透明；README 已列为限制 |
| `.dshRemotePage` | 依赖约定类名，不是正式契约 | 远程页改类名会失去材质 |
| 轨迹页账本 | 靠宿主 data 属性定位（`data-conversation-composer-overlay` + `data-trajectory-scroll`），不是版式契约 | 宿主改这两个属性的落点、或给轨迹页加自带输入框（根上不再有 `data-conversation-composer-overlay`）就失配；失配时退回原来的整块 `#232324`，不会破版 |
| 右侧栏开始页胶囊 | 靠宿主属性 `[data-sidebar-right-guide]` / `[data-sidebar-right-guide-entry]` 定位，不是版式契约 | 属性改名、或新贡献者把胶囊渲染到容器外且不用该属性时，胶囊退回实心面板色（宿主外观），不破版 |
| 轨迹页边界圆点 | 圆点用 2px 页面色环「截断」轨道（`box-shadow` 读 `layer-1`） | 页面透明后环无色，5px 点与 0.5px 轨道相接；插件把环显式钉成透明，避免 `layer-1` 将来变回实色时多出一圈暗晕 |
| 轨迹页控件与代码底 | 靠宿主类名 `[class*="_controlThumb"]`、`[class*="_search"]`、`[class*="_programSource"]` 定位 | 宿主改类名后：开关圆钮随令牌透明而消失、搜索聚焦失去底色、程序源码底随令牌透明（代码直接浮在壁纸上）；都只影响该页观感，不破版 |
| 底栏工作台空态卡 | 卡片是内联 `button`，没有 data 属性，只能靠类名后缀 `[class*="_paneCard"]` 定位 | dsh-better-sidebar 改类名或换 CSS Modules 命名方案时，卡片退回实心面板色（宿主外观），工作台玻璃与边框不受影响，不破版 |
| `:has()` | 依赖 Chromium 105+ | DSH Web 与 Electron 桌面都满足；纯 Safari 用户本来也没有透镜 |
| GPU 成本 | 每个透镜表面 = 一次全盒背景模糊 + 一次 SVG 位移；最多 6 类表面 | 低端机可让用户关"表面折射"或降玻璃滑杆 |
| 视频编码 | H.265/HEVC 多数机器解不了 | 第二次解码类失败即记为"无法解码"并从网格移除；判定绑定文件指纹（`size:mtimeMs`），刷新不复活，转码替换文件后自动恢复；转码 H.264/VP9 可解 |
| 网页壁纸音频 | 沙箱文档音频受限 | 交互前静音；依赖 WE 系统音频输入的壁纸无信号 |
| 场景/应用壁纸 | 不支持 | `.pkg` 由 WE 自己渲染，浏览器无法接管 |

---

## 8. 交接清单

**一周内需要知道的：**

1. 改浏览器行为只动 `src/client.js`，然后 `npm run build`；`lib/client.js` 是产物。
2. 改宿主只动 `lib/index.js` / `lib/core.js`；`test/host.test.mjs` 用真实 HTTP 服务器覆盖安全边界。
3. 任何"看不见壁纸"的问题，先看 `/we-background/inventory` 与 iframe 的入口 URL。
4. 任何"玻璃不对"的问题，先确认三件事：采样有没有跑、`--webg-tint-*` 有没有写、选择器有没有命中。
5. 任何"布局炸了/弹窗空白"的问题，先找 `backdrop-filter` 是否落在了带固定后代的容器上。
6. 发布前跑一次 `node scripts/release.mjs check`；它会做预检与全部门禁但不改工作区。

**症状 → 第一现场：**

| 症状 | 先看 |
| --- | --- |
| 设置页空 | `/we-background/inventory`、`loadInventory` 的 error 分支、`installDir` |
| 壁纸黑屏 | `syncLayers`、media URL、`<iframe>` 控制台、子资源 403 |
| 切换瞬间闪暗/闪亮 | `applySelection` 的采样复位与首帧时序（设计内） |
| 菜单没有模糊 | `--webg-lens-chain` 是否写在菜单元素上；`[data-menu-material]` 是否命中 |
| 设置弹窗空白 | `backdrop-filter` 的包含块问题；`:has()` 排除规则 |
| 透镜没效果 | UA、`prefers-reduced-transparency`、`glass > 0`、`data-webg-lens` |
| 轨迹页仍是整块深灰（或反过来全白） | `body[data-webg-wallpaper]` 在不在；视图根还有没有 `data-conversation-composer-overlay`、滚动区还有没有 `data-trajectory-scroll`；`--dsw-alias-bg-layer-1` 是否被作用域规则覆盖 |
| 右侧栏「开始」页仍是深色胶囊 | 容器 `[data-sidebar-right-guide]` 与条目属性在不在；该元素背景是否仍读 `--dsw-alias-bg-layer-1` |
| 底栏工作台空态卡仍是深色胶囊 | `[data-dsh-bottom-panel]` 在不在；卡片的 class 里还有没有 `_paneCard` 后缀；该元素背景是否仍读 `--dsw-alias-bg-layer-1` |
| 发布失败 | 标签/版本一致性、OIDC 权限、Actions 日志 |

---

## 9. 术语

| 词 | 含义 |
| --- | --- |
| 体色（body） | 玻璃的底色，`hsl()` + 透明度 |
| 遮罩（scrim / veil） | 壁纸与内容之间的黑色层，保证文字可读 |
| 档（tier） | T1/T2/T3 三套滤镜强度，对应不同浮层 |
| 带（band） | 折射影响区的宽度，单位 CSS px |
| 边光（rim） | 顶部镜面高光与边缘亮线 |
| 斜面（bevel） | 一组 inset 阴影，模拟玻璃厚度 |
| 光池（specular pool） | 4 个径向高光 |
| 唤醒（wake） | 切换壁纸时边光短暂增强（`--webg-rim` +0.22，约 450 ms 后回落） |
| 降级（demote） | 视频反复失败后改用预览图 |
| 无法解码（undecodable） | 解码类失败第二次后写入的持久化映射（id → 文件指纹）；条目从网格与轮转中移除，刷新不清空，指纹变化（文件被替换/重新编码）后恢复 |
| 令牌（token） | 72 位随机串，替代文件路径出现在 URL 里 |
