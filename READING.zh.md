# 阅读规范

这份文件回答一个问题：**拿到这个仓库，按什么顺序读、带着哪些前提读、改完之后怎样确认没读错。**

面向两类读者：第一次接手的人，以及在这份代码上工作的自动化代理。行号以 v2.3.6 为准；函数名比行号稳定，优先按函数名检索。

---

## 0. 五分钟地图

| 路径 | 角色 | 手写 | 说明 |
| --- | --- | --- | --- |
| `src/client.js` | 浏览器半区的全部逻辑 + 样式 | 是 | **唯一前端源**，约 4,000 行 |
| `lib/client.js` | 浏览器半区的构建产物 | 否 | 由 `scripts/build-client.mjs` 生成，**不要手改** |
| `lib/index.js` | 宿主半区：HTTP 路由、令牌、缓存 | 是 | Node 侧，没有 `src/` 对应文件 |
| `lib/core.js` | 纯逻辑：Steam 发现、`project.json`、Range、MIME | 是 | 不碰 IO，全部由调用方注入 |
| `test/core.test.mjs` | 纯逻辑单测 | 是 | 15 个用例 |
| `test/host.test.mjs` | 真实 HTTP 集成测试 | 是 | 11 个用例，走真实 loopback 服务器 |
| `scripts/build-client.mjs` | 源码 → 产物的包装器 | 是 | 只做 banner 剥离、模块包装、缩进 |
| `scripts/verify-client.mjs` | 产物的行为验证 | 是 | 在 `vm` + DOM mock 里跑真实 bundle |
| `scripts/release.mjs` | 发布门禁与推送 | 是 | 见 `RELEASING.zh.md` |
| `cordis.patch.yml` | 插件挂载行 | 是 | **唯一的挂载入口** |
| `liquid-glass-report.zh.md` | 液态玻璃调研底稿 | 是 | 证据分级；材质公式的依据 |
| `README.zh.md` / `README.md` | 用户文档 | 是 | 描述"已经发布的行为"，不是设计稿 |

依赖方向是单向的：

```
lib/core.js  ←  lib/index.js          （宿主：纯逻辑 ← HTTP 接线）
src/client.js →  lib/client.js        （浏览器：源码 → 构建产物）
```

两边**不共享代码**。宿主与浏览器之间只有一条契约：`/we-background/*` 上的 JSON 与文件字节。不要试图在 `src/client.js` 里 `require` 宿主的任何东西，也不要把渲染决策塞回宿主。

---

## 1. 先建立三个心智模型

### 1.1 两个半区

- **宿主半区**（Node）：发现 Wallpaper Engine、枚举壁纸、发令牌、提供字节流。它不知道玻璃长什么样，也不做任何视觉决策。
- **浏览器半区**（Web）：拿清单、建图层、采样壁纸、算材质、写 CSS 变量、渲染设置页。它不读磁盘，也不知道 Steam 在哪。

排障时先判断问题落在哪一半：清单为空 → 宿主；清单有但画面黑 → 浏览器；画面有但玻璃不对 → 材质/CSS。

### 1.2 一条状态主线

浏览器半区只有一个模块级状态对象 `selection`（`src/client.js:365`）。React 设置页和 DOM 图层都订阅它（`subscribe` / `emit` / `useStore`）。

**DOM 只由两个函数写：**

- `syncLayers()`：决定壁纸层的存在、类型、交叉淡入与清除；
- `applyEffects()`：把旋钮与采样结果写成 CSS 变量。

其他所有函数（滑块、轮播、失败处理、取景）只改 `selection`，然后 `emit()` 或 `persistSelection()`。看到第三处直接写 DOM 的代码，基本可以判定是 bug 或历史遗留。

### 1.3 一条材质主线

```
壁纸像素 → sampleFrame（16×16） → sampledLuminance / sampledColor / sampledVariety
        → materialTokens() → applyEffects() 写变量 → CSS 变量 → 各表面规则
```

玻璃"不对"时，先定位是哪一段：采样没跑（亮度一直是默认 0.35）、令牌算错、变量没写、还是 CSS 选择器没命中。四段的排查手段完全不同。

---

## 2. 推荐阅读顺序

按依赖读，不要从第一行读到第四千行。

1. **常量**（`src/client.js:37-65`）：属性名、元素 id、`CROSSFADE_MS` / `LEAVE_MS`、`LOW_FPS`。这些是全局契约。
2. **默认值与持久化**（`274-422`）：`DEFAULTS`、`readPersisted()`、`selection`、`persistSelection()`。先知道"有哪些旋钮"。
3. **`applySelection()`**（`704-746`）：一次壁纸切换到底改了什么（url/type/采样复位/轮播/唤醒）。
4. **`syncLayers()`**（`1179-1269`）：图层如何挂载、交叉淡入、失败重挂、清除。这是"看不见壁纸"的第一现场。
5. **`applyEffects()`**（`1891-2096`）：所有 CSS 变量的写点、变化 key、镜头开关、媒体滤镜。**这是全文件最该精读的函数。**
6. **材质与透镜**（`1398-1818`）：`materialTokens` → `tierChain` → `rasterizeLens` → `paintLensSlot` → `scanLensSurfaces`。按这个顺序读，正好是数据流。
7. **CSS**（`2759-3693`）：先读每段前的块注释，再用选择器 grep。不要通读。
8. **设置页**（`2137-2754`）：只在改 UI 时读；它是纯展示层，输入都来自参数。
9. **`apply()`**（`3701-3992`）：生命周期、effect 清理、观察者、设置分区注册。改生命周期前必读。
10. **宿主**：`lib/index.js` 从头到尾读一遍（不到 500 行）；`lib/core.js` 按问题查（解析、包含性、Range）。

---

## 3. 不变量

改代码前逐条对照；违反其中一条，通常会在某个平台或某次重建后炸。

| # | 不变量 | 违反后的症状 |
| --- | --- | --- |
| I1 | `lib/client.js` 永远由 `npm run build` 生成，CI 会校验工作区干净 | CI 红；发布包与源码不一致 |
| I2 | 宿主不做视觉决策，浏览器不读磁盘 | 分层腐化，测试无法覆盖 |
| I3 | `selection` 是唯一状态源；DOM 只由 `syncLayers` / `applyEffects` 写 | 状态与画面不同步，刷新后回跳 |
| I4 | 每个写出的 CSS 变量都必须有消费者；每个消费的变量都要有写点或回退 | 死代码（审计里已清过一轮） |
| I5 | 透镜滤镜链里 `url(#…)` 在前、`blur()` 在后（先折射，后模糊） | 折射被模糊抹平，看起来"没效果" |
| I6 | 位移图已含 `pad`，`feImage` 按 1:1 放；滤镜区域必须 ≥ `2×band+4` px | 边缘被裁、出现暗边或接缝 |
| I7 | 令牌即能力：72 位随机、只暴露清单内的文件、词法 + realpath 双重包含 | 任意文件读取 |
| I8 | 所有用户可见文案进 `STRINGS`，zh/en 键集合必须一致 | `verify` 的键集合检查失败 |
| I9 | 代码注释用英文，文档用中文；注释解释"为什么" | 审查时无法判断历史决策 |
| I10 | 时间常量集中（`CROSSFADE_MS`、`LEAVE_MS`、去抖 90/140 ms） | 动画与清理互相踩踏 |

---

## 4. 命名与注释约定

- CSS 变量统一 `--webg-*`；宿主令牌统一 `--dsw-*`。写宿主令牌的地方都是"适配外壳"，不是插件自有材质。
- DOM 属性统一 `data-webg-*`：`data-webg-wallpaper`（激活）、`data-webg-dark`（暗色镜像）、`data-webg-lens`（透镜开启）。
- 元素 id 统一 `wallpaper-engine-dsh-*`。
- 函数名前缀表达职责：`read*`（纯解析）、`apply*`（写 DOM/变量）、`sync*`（对齐状态）、`attach*`（绑事件）、`scan*`（发现表面）、`paint*`（重绘单个表面）。
- 注释里出现"暂时""先这样"时，通常意味着有一个未记录的约束；改之前先找对应提交或本文档的决策记录。

---

## 5. 修改闭环

1. **定位阶段**：宿主 / 状态 / 图层 / 材质 / CSS / 设置页。
2. **改源码**：浏览器改 `src/client.js`；宿主改 `lib/index.js` 或 `lib/core.js`。
3. **跑门禁**：
   ```sh
   npm test          # 26 个用例
   npm run build     # 生成 lib/client.js
   npm run verify    # 在 vm + DOM mock 里跑产物
   ```
4. **补验证**：只要改了浏览器半区的可观察行为，就在 `scripts/verify-client.mjs` 里加一条 `check(...)`。它是这套代码唯一的产物级回归网。
5. **提交前确认** `git diff --exit-code lib/client.js` 为空（CI 也查这一条）。

`npm run verify` 不是单元测试：它把真实产物装进 `vm`，用一套 DOM mock 跑 `apply()`，再断言变量、图层、清理行为。mock 的 `addEventListener` **每个事件类型只保留一个监听器**——这是刻意的，用来暴露"同一事件挂两个处理器"的写法。挂第二个 `loadeddata` 会静默覆盖第一个，采样就不会跑（审计修复时踩过）。

---

## 6. 常见误读

这些是审计与修复过程中被证伪或容易读错的点，先看结论可以少走弯路。

- **`@property` 的继承会触发过渡。** `--webg-adapt-dim` 注册为 `inherits: true`，在 `body` 上改值，后代的 `transition` 会正常触发。"过渡是死的"是误判。
- **位移图没有被拉伸。** `rasterizeLens` 直接按 `w+2pad` 光栅化；只有超过 700 px 上限时才降采样再放大。
- **`-8%/116%` 的滤镜区域**曾经小于窄表面上的位移峰值，但实测没有出现透明渗边；现行实现按 `reach = 2×band+4` 逐面计算，属于预防性修正。
- **`backdrop-filter` 会让元素成为固定/绝对后代的包含块。** 这是设置弹窗"变空白"的根因；承载第三方内容的容器必须把滤镜放到 `::before` 上。
- **`[class$="_panel"]` 只在类名是 class 属性的最后一个 token 时命中。** 外壳改类名顺序就会失配；这是已知脆弱点，不要随意扩大到 `[class*="_panel"]`（会把无关面板也玻璃化）。
- **沙箱 iframe 是不透明源。** 网页壁纸取自己的子资源在浏览器看来是跨域，所以媒体响应必须带 `Access-Control-Allow-Origin: *`；这不是疏忽。
- **菜单需要两个变量。** 插件自己的菜单规则消费 `--webg-lens-chain`，外壳的子层消费 `--dsw-menu-backdrop-filter`；`menuToken` 分支两个都写。
- **`disposed` 会在 `apply()` 开头复位。** 插件更新会复用模块实例，不复位的话新 fiber 的 `loadInventory` 永远返回。

---

## 7. 不要做的事

- 不要手改 `lib/client.js`；不要提交与 `npm run build` 不一致的产物。
- 不要新增运行时依赖：产物是零依赖的单文件 bundle，构建脚本也不装包。
- 不要移动或删除 `cordis.patch.yml` 里的 `insert` 行——它是唯一的挂载路径。
- 不要在承载第三方固定层的容器上直接加 `backdrop-filter`。
- 不要逐帧改模糊半径（`blur()` 半径变化会重建滤镜，代价高）。
- 不要在清单/日志/错误信息里输出绝对路径；wire 上的错误一律泛化。
- 不要把 `scene` / `application` 壁纸放进清单：浏览器渲染不了 `.pkg`。

---

## 8. 排障入口

| 症状 | 先看 |
| --- | --- |
| 设置页空、无壁纸 | `/we-background/inventory` 是否 200；`installDir` 是否为空；`loadInventory` 的 error 分支 |
| 壁纸黑屏 / 空白 iframe | 网页壁纸的 media URL 是否带入口文件名；子资源 403/404；`sandbox` 与控制台 CSP |
| 切换壁纸后一瞬间过暗/过亮 | 采样复位（`applySelection`）与首帧时间；这是设计内的中性过渡 |
| 玻璃发灰、没有色相 | 采样是否在跑（视频 `loadeddata`、网页预览 probe）；`--webg-tint-*` 是否写入 |
| 菜单没有模糊 | `--webg-lens-chain` 是否写在该元素上；`[data-menu-material]` 是否命中 |
| 设置弹窗空白 | 是否有 `backdrop-filter` 落在了带固定后代的容器上 |
| 透镜完全没效果 | UA 是否 Chromium；`prefers-reduced-transparency`；玻璃滑杆是否为 0 |
| 发布失败 | 标签与 `package.json` 版本是否一致；OIDC 权限；见 `RELEASING.zh.md` |

更完整的运行时说明见 `HANDOVER.zh.md`；材质公式的依据见 `liquid-glass-report.zh.md`。
