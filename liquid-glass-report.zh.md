# Liquid Glass 实现机理与 Chromium/CSS 复刻报告

> 结论先行：
> 1. Apple 的 Lensin 折射**不是** Snell 折射，而是"SDF 距离场 + 线性重映射"的边缘像素位移，核心只有两个参数：`inputInnerRefractionHeight`（折射带高度）与 `inputInnerRefractionAmount`（位移量）。[来源](https://www.lrdcq.com/me/read.php/read.php/165.htm)
> 2. 实测折射带深度约 **20pt**，64pt 高胶囊峰值位移 **35.5pt**（1–2pt 内缩处），20pt 以外位移为 0；clear 变体的位移量 ≈ **1.3 × 短边半径**，regular ≤ 短边半径。[来源](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md)
> 3. Chromium 已在合成动画路径上**主动禁用** `feDisplacementMap`（backdrop-filter），并且 SVG backdrop 存在 zoom 不缩放、bounds 计算错误等未修 bug → 逐 surface 的 SVG 位移在动画壁纸场景**不安全**。[来源](https://chromium.googlesource.com/chromium/src/+/e0cb253a6f794a3cb0c15a2bbd69150ce7d2b7c1)
> 4. 可行替代：**2–4px 低模糊底 + 边缘环带强模糊（lens ring）+ 1px 渐变高光边 + 深色 scrim**；光学上等价于"边缘被压缩/涂抹"，成本仅比纯 blur 多一个小面积 pass。

证据分级：`[官方]` Apple 文档/WWDC；`[实测]` 第三方对真机/模拟器像素测量；`[逆向]` 私有 API/符号/着色器参数名；`[社区]` 工程经验值；`[推算]` 本报告计算。

---

## 1. 图层模型（自下而上）

Apple 只说过"Liquid Glass 由多层组成，每层持续适应背后内容"，未公布层序与数值 [官方](https://developer.apple.com/videos/play/wwdc2025/219/)。以下层序由私有类结构、CAFilter 参数名与像素测量交叉推断，**精确合成顺序 未确认**。

| # | 层 | 作用 | 典型参数 | 证据 |
|---|---|---|---|---|
| 0 | Backdrop capture | renderserver 侧离屏抓取背后内容，载体是 `CABackdropLayer`（与 UIBlurEffect 同源） | — | [逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm) |
| 1 | Blur | 高斯模糊，压掉背景高频；先模糊后折射 | Apple 未公布半径；复刻取值 8px；clear ≈2px | [逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm) / [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |
| 2 | Lensing / refraction | SDF 法线方向上的像素位移，仅作用于边缘带 | 高度 ≈20pt；位移量 clear ≈1.3×halfMinor，regular ≤ halfMinor | [逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm) / [实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md) |
| 3 | Tint / scrim | 色偏 + 压暗 + 白点提升，保证文字可读 | `tintColor`、`controlTintColor`、`boostWhitePoint`；clear 面色调 0.95x+32 | [逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm) / [实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md) |
| 4 | Specular / highlight | 边缘高光，随几何、交互、设备角度变化 | 顶部峰值 ≈+55/255，7 设备像素内衰减到 +13 | [实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md) |
| 5 | Inner shadow | 沿光轴的边缘内阴影，制造"厚度" | 透射光的 2.4–2.6%，顶部峰值在 7–12pt，侧面在贴边，底部无 | [实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md) |
| 6 | Drop shadow | 外部投影，随背后内容自适应（压文字时变深） | 未公布；大元素更深更散 | [官方](https://developer.apple.com/videos/play/wwdc2025/219/) |
| 7 | Content | 文本/图标，不在滤镜内 | — | [官方](https://developer.apple.com/videos/play/wwdc2025/356/) |

关键结构事实：

- 私有类 `_UIViewGlass` 承载全部配置：`variant / size / smoothness / tintColor / controlTintColor / subvariant / contentLensing / highlightsDisplayAngle / excludingPlatter / excludingForeground / excludingShadow / flexible / boostWhitePoint` —— 这些名字本身就是层模型的证据（高光角度、前景/阴影排除、白点提升）。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)
- 根 layer 被替换为 `_UIMultiLayer`，其下 `CASDFLayer → CASDFElementLayer`，用 `CAMatchProperty` 把源 view 的 bounds/position/cornerRadius/**cornerCurve** 同步进 SDF；`CABackdropLayer` 上挂 `glassBackground` 这个 `CAFilter`。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)
- `cornerCurve` 被匹配 ⇒ 圆角是 continuous corner（squircle），不是正圆。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)
- 一个控件只有**一个**材质面："apply the material directly to the control, not its inner views"；且禁止 glass-on-glass。[官方](https://developer.apple.com/videos/play/wwdc2025/356/)、[官方](https://developer.apple.com/videos/play/wwdc2025/219/)

---

## 2. Lensing / 折射

### 2.1 不是真实折射

`glassBackground` 的可调核心参数只有两个：`inputInnerRefractionHeight`（折射高度，≥0，位移从哪个深度开始）与 `inputInnerRefractionAmount`（折射数量，位移距离）。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)

逆向得到的着色器逻辑（复刻实现，非 Apple 源码）：

```c
float dis = (1.0 - sdf.r) * 50.0 * scale;          // SDF 的 R 通道：0..1 ↔ 距边 50pt..0
if (dis < r_height) {
  float offsetVal = _linear_map(r_height, 0.0, r_height, r_height - r_length, dis);
  float offset    = dis - offsetVal;                // 位移量随 dis 线性变化
  float2 normal   = sdf.gb * 2.0 - 1.0;             // G/B 通道：单位法线
  color = sample(backdrop, coord + normal * offset);
}
```

要点：
- 位移方向取自 **SDF 的法线**，大小是**距离的线性函数**，没有入射角、没有 IOR、没有波长项。`kube.io` 的 Snell 模型是对"看起来像"的物理解释，不是 Apple 的实现。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)、[社区](https://kube.io/blog/liquid-glass-css-svg)
- 没有三通道分离 ⇒ **反编译复刻中不存在色散**；正式实现是否含轻微色散 未确认。
- SDF 只编码 **50pt** 深度（`(1-r)*50`），且 `r_height > 50` 会让条件永不成立 ⇒ **折射带深度的结构上限是 50pt**。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)

### 2.2 高度剖面

不存在解析的超椭圆高度函数；剖面来自 SDF 的等距场，对圆角矩形/连续圆角自然形成"倒角"。实测该剖面**与四分之一圆吻合**：用 height=20、amount=42.5 的四分之一圆，在 3.5–14.5pt 区间内复现 Apple 误差 <0.5pt。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md)

kube.io 给出的四种候选剖面（convex circle / convex squircle `y=(1-(1-x)^4)^(1/4)` / concave / lip）是 web 侧拟合工具，其中 squircle 被认为"让倒角在光学上更薄"。[社区](https://kube.io/blog/liquid-glass-css-svg)

### 2.3 位移量（实测锚点）

300×64pt 胶囊、clear 变体、沿外法线朝内的位移（pt），按内缩分箱 [实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md)：

| 内缩(pt) | 1–2 | 2–3 | 3–4 | 4–6 | 6–8 | 8–10 | 10–13 | 13–16 | 16–20 |
|---|---|---|---|---|---|---|---|---|---|
| 顶边 | 35.5 | 27.1 | 21.7 | 15.8 | 10.3 | 6.8 | 4.0 | 1.8 | 0.1 |
| 端头 | 25.5 | 21.2 | 17.7 | 13.9 | 10.0 | 6.7 | 3.8 | 1.6 | 0.3 |

同一数据给出的缩放律：clear 的 amount ≈ **1.30–1.33 × halfMinor**（46pt 半径→60；32pt 半径→42.5），height 固定 20pt，20pt 以外位移≈0；regular 的 amount ≤ halfMinor（该测量因模糊不可靠，标记 未确认）。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md)

**44 / 200 / 600pt 的数值**（只有两个实测点，其余为两点线性外推 `amount ≈ 1.25×halfMinor + 2.5`，标 未确认）：

| 元素高度 | halfMinor | clear 峰值位移 | regular 峰值位移 | 折射带深度 |
|---|---|---|---|---|
| 44pt | 22 | ≈30pt | ≤22pt | ≈20pt（受 50pt 上限约束） |
| 200pt | 100 | ≈128pt（**未确认**，极可能饱和） | ≤100pt（**未确认**） | ≤50pt（结构上限） |
| 600pt+ | 300 | **未确认**，不应按线性外推 | **未确认** | ≤50pt（结构上限） |

Apple 对尺寸只给定性描述："morph 到更大尺寸时材质变厚，投影更深，lensing/refraction 更明显，光散射更柔"。[官方](https://developer.apple.com/videos/play/wwdc2025/219/)

### 2.4 逐像素还是"模糊边缘带"？

**逐像素的矢量位移，但只在边缘带内**：每个像素按自己的 SDF 法线取偏移样本，带外 `offset=0`（实测 20pt 外位移归零）。它不是模糊，也不是整面折射。SDF 是**按形状缓存**的离屏纹理；形状变化（含 3D 变换动画）会触发重算，实测"卡爆"，Android 复刻每帧重算 SDF 时帧率跌到 15–20fps。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)

---

## 3. Specular（高光）

Apple 只说"环境中的**光源**照在材质上产生随几何变化的 highlight；交互时这些光在空间中移动，让光沿材质轮廓传播；某些情况下光照响应设备运动"——光源数量与角度**未公布、未确认**。[官方](https://developer.apple.com/videos/play/wwdc2025/219/)

私有属性 `highlightsDisplayAngle`（BOOL）证明高光是**显示角度相关**的，与"响应设备运动"一致。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)

实测（iPhone 15 / iOS 27，300×64 胶囊，顶部 7 行、中间 30% 区域的积分亮度，0–255）[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md)：

| 背景 | Apple 真机 | Apple 模拟器 |
|---|---|---|
| 灰 128 | 152 | 78 |
| 黑 | 151 | 94 |
| 海岸 | 156 | 97 |
| 城市 | 134 | 69 |

逐行增量（灰底真机）：**+55 / +39 / +16 / +13**，即顶边第一行 +55/255 ≈ 21.6% 白，7 个设备像素（≈2.3pt）内衰减到 1/4。

沿周长的分布（同一测量的内阴影部分）：顶边最暗处在内缩 **7–12pt**，侧面在**贴边**，**底部没有** ⇒ 与"单一主光来自上方"一致；底部只有暗边没有高光。内阴影强度为透射光的 **2.6%（浅色）/ 2.4%（深色）**。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md)

按压行为：从手指下方开始发光，向整个元素及邻近玻璃扩散。[官方](https://developer.apple.com/videos/play/wwdc2025/219/)

HDR：Apple 的 filter 暴露 `inputMaxHeadroom`、`inputSDRHoldingToneEnabled`、`MaxLuma`/`MaxLumaSDR`，真机高光强度约为模拟器的 **1.6–2.0 倍**（EDR 面板）⇒ 高光是**超出 SDR 白**的。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md)

web 侧结论：**一个主光（顶部）+ 一个环境项**即可，不要做 conic 旋转扫光（社区测量明确说真机是"水平边亮、两侧暗"，不是单一锥形扫光）。[社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md)

---

## 4. Tint / Vibrancy

### 4.1 颜色如何派生

- "Liquid Glass 本身没有颜色，从正后方内容取色"；施色后像"彩色玻璃/染色玻璃"。[官方](https://developer.apple.com/design/human-interface-guidelines/color)
- 选一个颜色会"生成一组色调，映射到元素下方内容的亮度上"；"改变色相、亮度、饱和度，但不偏离原色太多"。[官方](https://developer.apple.com/videos/play/wwdc2025/219/)
- 小元素（toolbar/tabbar）可在明暗间翻转，符号随之变深/变浅；大元素（sidebar/menu）不翻转，且"更不透明"。[官方](https://developer.apple.com/design/human-interface-guidelines/color)
- regular "模糊并调整背景亮度以维持可读性"；clear "高度透明"，需要时加 **35% 不透明度的暗色 dimming 层**。[官方](https://developer.apple.com/design/human-interface-guidelines/materials)

### 4.2 可测的色调传递函数

clear 面的实测线性模型：`out = 0.95 × in + 32`（0–255 编码值），即**压缩 + 抬黑**：纯黑背景被抬到 32（12.5%），白端略压。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md)

另一份社区测量给出 `L_glass ≈ 0.58 × L_backdrop + 34`（黑抬得更狠、亮部几乎不动），与本条斜率不同，二者样本/变体不同，**具体系数 未确认**。[社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md)

tint 的作用量：系统默认 tint 下，黑底上的面色 130，而 tint=0 时 102 ⇒ 相当于 tintAmount ≈ 0.45 的叠加。[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md)

`boostWhitePoint` 属性 + filter 的 `inputMaxHeadroom`/`MaxLuma*` 参数说明：可读性靠**白点提升 + 亮度域压缩**，不是简单压暗。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm)、[实测](https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md)

### 4.3 4×5 颜色矩阵 / 对比度钳制

**未确认**。公开逆向只到 `CAFilter` 参数名与 `glassBackground` 的输入（模糊/曝光/折射/白点/headroom），没有任何公开材料给出 4×5 矩阵或显式对比度 clamp 的系数。[逆向](https://www.lrdcq.com/me/read.php/read.php/165.htm) 可确认的等价行为是：亮度域压缩（斜率 <1）+ 黑位抬升 + 白点提升 + tint 随背景亮度加权。

### 4.4 透明度区间

| 变体 | 深色主题 | 浅色主题 | 来源 |
|---|---|---|---|
| Clear | rgba(28,28,32,.16–.30) | rgba(255,255,255,.12–.40) | [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |
| Regular | ~.62 | — | 同上 |
| Clear 的 dimming 层 | 35% 暗色 | 35% 暗色 | [官方](https://developer.apple.com/design/human-interface-guidelines/materials) |

---

## 5. CSS backdrop-filter + SVG feImage/feDisplacementMap 的已知伪影

### 5.1 Chromium 侧的硬约束

- **合成动画路径禁用 `feDisplacementMap`**：commit `e0cb253a6f794a3cb0c15a2bbd69150ce7d2b7c1`（2026-10-21，Stephen Chenney）"Disable FEDisplacementMap for animated CSS backdrop-filter … The composited animations code path was missed in the earlier CL to disable FEDisplacementMap for backdrop-filter."，Bug 575826638，改 `third_party/blink/renderer/core/animation/compositor_animations.cc`。⇒ 只要 backdrop-filter 参与动画/合成，位移滤镜会被踢出合成路径。[来源](https://chromium.googlesource.com/chromium/src/+/e0cb253a6f794a3cb0c15a2bbd69150ce7d2b7c1)
- "Composited CSS backdrop-filter referencing SVG does not scale with zoom" — 缩放/DPR 变化时位移不跟随。[issue 576324619](https://issues.chromium.org/issues/576324619)（状态 未确认）
- "Computed backdrop filter bounds are still not correct." — backdrop 滤镜区域计算错误，直接表现为边缘裁切/接缝。[issue 448789651](https://issues.chromium.org/issues/448789651)（状态 未确认）
- "backdrop-filter blur not clipped to border box inside a transform-scaled out-of-process iframe" — 变换缩放下不按 border box 裁切。[issue 571674322](https://issues.chromium.org/issues/571674322)（状态 未确认）
- WebKit 侧：`backdrop-filter: url(#svg)` 根本不支持（bug 245510）；同一元素上 `filter:url()` 与 `backdrop-filter` 并存会被忽略（bug 297770）——跨端不可依赖。[社区汇总](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md)

### 5.2 具体伪影与成因

| 伪影 | 成因 | 规避 |
|---|---|---|
| 平铺/重复 | `feImage` 用外部 `href` 在零尺寸 SVG 里静默失败，退化为平铺或空图 | 必须内联 data URL [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |
| 拉伸错位 | `feImage` 默认 `preserveAspectRatio="xMidYMid meet"`，非方形盒会把位移图等比缩放并居中 | 显式 `preserveAspectRatio="none"` + 图尺寸=盒尺寸（设备像素） |
| 接缝/1px 亮线 | 位移采样越过滤镜区域边界，边缘 clamp/透明；filter region 默认只扩 10% | `x="-20%" y="-20%" width="140%" height="140%"`，并让位移图四边留 128 中性带 |
| 色偏/整体滑动 | `color-interpolation-filters` 默认 linearRGB，128 中性点在转换后漂移 | 强制 `color-interpolation-filters="sRGB"` [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |
| 阶梯/带状 | R/G 只有 8 bit，量化步长 = `scale/255` px；`scale` 越大越粗 | 位移图按 `scale` 归一化编码：`R = d/(2·scale)+0.5`；大位移拆多个 pass 或降 `scale` |
| 位移量上限 | 8 bit 通道只能表示 −128..127，且乘以 `scale` | 单 pass 位移不超过 ~64px（`scale≈128` 时留一半余量）[社区](https://kube.io/blog/liquid-glass-css-svg) |
| 每帧重栅格 | 动画壁纸每帧改变 backdrop ⇒ 每个 surface 的 SVG 滤镜每帧重跑；Chromium 无法缓存 | 见 §6：不要给动画区域用 SVG backdrop |
| 形状变化即重建 | 位移图必须按实时盒尺寸重建（ResizeObserver），否则边角各向异性"像融化的塑料" | 固定尺寸或用 §6 的无图方案 [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |
| 整块消失 | 祖先有 `isolation/contain:paint/transform/opacity<1/mask/filter/will-change` 会打断 backdrop root；嵌套 backdrop-filter 被 Chrome 拒绝 | 玻璃层必须是"壁纸的同级、未被变换的兄弟" [社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md) |

---

## 6. 面向 Chromium-only Electron（视频壁纸 + 6 个表面）的推荐

### 6.1 结论

**逐 surface 的 `backdrop-filter: url(#feDisplacementMap)` 不安全**，理由按重要性排序：

1. 合成动画路径被 Chromium 主动禁用该滤镜（§5.1 commit）→ 一旦有过渡/动画就掉回主线程栅格。
2. SVG backdrop 在 zoom/DPR 变化时不缩放（issue 576324619）→ 125%/150% 缩放下位移量错。
3. bounds 计算错误（448789651）→ 边缘接缝，恰好出现在最显眼的圆角处。
4. 视频壁纸每帧使 backdrop 失效 ⇒ 6 个 surface × 每帧一次全盒位移采样，成本与"每帧重跑 6 个全屏滤镜"同阶。
5. 每个 surface 需要自己的位移图（圆角/尺寸不同不能共用一张），ResizeObserver + data URL 重建带来主线程抖动。

**例外**：单个、固定尺寸、不做滤镜动画的"英雄表面"可以试；必须 `filterUnits="userSpaceOnUse"`、图按设备像素、`sRGB`、`preserveAspectRatio="none"`，且不参与任何 filter 过渡。

### 6.2 推荐方案：三层兄弟结构（Tier A，零 SVG）

光学等效原理：Apple 的观感 = 边缘带内"更强的模糊 + 亮度抬升 + 1px 镜面线 + 内侧暗唇"。用"环带强模糊"替代"位移"，视觉上都表现为边缘被压缩/涂抹，且成本只在环带面积上。

```html
<div class="lg">
  <div class="lg__base"></div>   <!-- 底色 + 低模糊 + scrim -->
  <div class="lg__lens"></div>   <!-- 边缘环带强模糊（折射感） -->
  <div class="lg__rim"></div>    <!-- 1px 渐变高光边 -->
  <div class="lg__in"></div>     <!-- 内容 -->
</div>
```

```css
.lg { position: relative; border-radius: 24px; isolation: auto; }
.lg > * { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }

/* 1) 底：低模糊 + 深色 scrim（不奶白的关键：模糊小、饱和度高、scrim 用中性深色） */
.lg__base {
  background: linear-gradient(180deg, rgba(20,20,24,.56), rgba(14,14,18,.64));
  backdrop-filter: blur(3px) saturate(1.55) brightness(1.12) contrast(1.02);
  box-shadow:
    0 14px 34px -10px rgba(0,0,0,.62),
    0 2px 6px rgba(0,0,0,.28),
    inset 0 0 0 1px rgba(255,255,255,.10),      /* 玻璃唇 */
    inset 0 1px 0 rgba(255,255,255,.34),        /* 顶部 glint */
    inset 0 -1px 0 rgba(0,0,0,.30);             /* 底部暗边 */
}

/* 2) 边缘环带：只对 6px 边框区域做一次更强的模糊 → 折射感，成本≈周长×6px */
.lg__lens {
  border: 6px solid transparent;
  backdrop-filter: blur(9px) saturate(1.9) brightness(1.16);
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  opacity: .9;
}

/* 3) 镜面边：1px 渐变，顶部亮、侧面弱、底部几乎无（对应实测的 +55/+39/…/0） */
.lg__rim {
  padding: 1px;
  background: linear-gradient(180deg,
    rgba(255,255,255,.52) 0%,
    rgba(255,255,255,.16) 18%,
    rgba(255,255,255,.06) 46%,
    rgba(255,255,255,.04) 72%,
    rgba(255,255,255,.14) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}

/* 4) 内容：不在任何 filter 元素内，加一层文字阴影兜底 */
.lg__in {
  position: relative; inset: auto; padding: 18px 20px;
  color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.45);
  pointer-events: auto;
}
```

尺寸分档（6 个表面建议值；`[推算]` 基于 §1–§4 的实测比例，非 Apple 公布值）：

| 表面 | 高度 | radius | blur | scrim α（顶/底） | lens 环宽 | lens blur | rim 顶 α | 阴影 |
|---|---|---|---|---|---|---|---|---|
| 小控件 | 44 | 22（capsule） | 2px | .54/.60 | 3px | 7px | .44 | `0 6px 16px -6px rgba(0,0,0,.55)` |
| 面板 | 200 | 24 | 3px | .56/.64 | 6px | 9px | .52 | `0 14px 34px -10px rgba(0,0,0,.62)` |
| 侧栏 | 600+ | 28 | 4px | .58/.66 | 8px | 10px | .54 | `0 20px 52px -14px rgba(0,0,0,.68)` |

### 6.3 可读性保证（任意壁纸）

深色 pin + scrim 的对比度下限可以算出来：白字需要 ≥4.5:1 ⇒ 背景相对亮度 ≤0.183 ⇒ sRGB ≤118。tint 取 (18,18,20)、α=0.62 时，纯白壁纸合成 `255×0.38+18×0.62 ≈ 108`，对比度 ≈5.4:1；α=0.58 时 ≈118，正好卡 4.5:1。**所以 α 下限 0.58，推荐 0.60–0.66**。`[推算]`

再加两道保险：
- `backdrop-filter` 里 `brightness(1.12)` 只抬中间调，白端仍被 clamp，不会破坏上面的推导。
- 文字层加 `text-shadow: 0 1px 2px rgba(0,0,0,.45)`；小字号（<14px）再补 `-webkit-text-stroke: .2px rgba(0,0,0,.25)`。

### 6.4 如果必须看见"位移式"折射

只对一个固定尺寸的英雄表面用 SVG，且遵守：

```html
<svg width="0" height="0" aria-hidden="true">
  <filter id="lg-refract" filterUnits="userSpaceOnUse"
          x="-20%" y="-20%" width="140%" height="140%"
          color-interpolation-filters="sRGB">
    <feImage href="data:image/png;base64,…" preserveAspectRatio="none"
             x="0" y="0" width="320" height="96" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="36"
                       xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>
```

- 位移图按 `d(x) = A·(1-(1-x)^4)^{1/4}` 生成，`A` = 峰值位移，编码 `R = dx/(2·scale)+0.5`、`G = dy/(2·scale)+0.5`、`B = 0.5`。
- `scale` 取 `2A`（如 A=18px → scale=36），8bit 量化步长 0.14px，肉眼不可见。
- 盒尺寸变化时重建图（`ResizeObserver`），并且**不要**对该元素的 `backdrop-filter` 做 transition。
- 与 `blur()` 的组合顺序：`backdrop-filter: blur(2px) url(#lg-refract)`（先模糊后位移，符合 Apple 的"先模糊再折射"）——Chromium 是否接受 url() 与函数混写 未确认，需实测。

### 6.5 性能与工程约束

- 视频壁纸放在**独立 stacking context**（`position:fixed; z-index:0`），玻璃层是它的兄弟，中间不要出现 `transform/filter/opacity<1/contain:paint` 的包裹层——否则 backdrop root 被切断，玻璃直接变透明。[社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md)
- 不要动画 `blur()` 半径（每帧使滤镜缓存失效）；按压反馈只动 scrim 的 `opacity` 与 `transform: scale(.98)`（合成器属性）。
- 6 个表面 = 6 次 `blur(2–4px)` 全盒 + 6 次小面积环带 `blur(7–10px)`；把 radius 控制在 4px 以内，面积越大越要小。
- 圆角用连续圆角更接近 Apple：`border-radius: 24px; corner-shape: squircle;`（Chrome 139+，版本 未确认，需 `@supports` 兜底）。[社区](https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md)
- 验收：DevTools → Rendering → Paint flashing 只应在视频帧与玻璃层闪；125%/150% 缩放下检查位移量（若用了 SVG）；6 表面同屏时用 Performance 面板确认无 "Recalculate style" 抖动。

### 6.6 降级开关

| 预算 | 方案 |
|---|---|
| 充足 | Tier A + `corner-shape: squircle` + 英雄表面 SVG |
| 中 | Tier A（去掉 `.lg__lens`，仅保留 rim + 低模糊） |
| 低 | 纯 `background: rgba(16,16,20,.72)` + 1px rim，无 backdrop-filter |

---

## 参考

1. WWDC25-219 *Meet Liquid Glass* — https://developer.apple.com/videos/play/wwdc2025/219/
2. WWDC25-356 *Get to know the new design system* — https://developer.apple.com/videos/play/wwdc2025/356/
3. HIG Materials — https://developer.apple.com/design/human-interface-guidelines/materials
4. HIG Color（Liquid Glass color）— https://developer.apple.com/design/human-interface-guidelines/color
5. UIGlassEffect API — https://developer.apple.com/documentation/uikit/uiglasseffect
6. Lrdcq《从0逆向探索 iOS26 Liquid Glass 实现原理》— https://www.lrdcq.com/me/read.php/read.php/165.htm
7. Lrdcq《在 Android 中实现液态玻璃效果 GlassView》— https://www.lrdcq.com/me/read.php/166.htm
8. flutter_liquid_glass `refraction-ab/report.md` — https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/refraction-ab/report.md
9. flutter_liquid_glass `glint-hdr-and-inset/report.md` — https://github.com/whynotmake-it/flutter_liquid_glass/blob/8e1e7d649bcc220312ba3d3493cfaf76a91382f2/packages/liquid_glass_renderer/example/tool/results/glass-research/glint-hdr-and-inset/report.md
10. kube.io *Liquid Glass in the Browser* — https://kube.io/blog/liquid-glass-css-svg
11. childrentime/liquid-glass — https://github.com/childrentime/liquid-glass
12. reatom 社区 brief — https://raw.githubusercontent.com/reatom/reatom/ad31b8005f864b00421491dcc6828c901d5e8b54/examples/gallery/docs/liquid-glass-web.md
13. Chromium commit e0cb253（Disable FEDisplacementMap for animated CSS backdrop-filter）— https://chromium.googlesource.com/chromium/src/+/e0cb253a6f794a3cb0c15a2bbd69150ce7d2b7c1
14. Chromium issue 576324619 — https://issues.chromium.org/issues/576324619
15. Chromium issue 448789651 — https://issues.chromium.org/issues/448789651
16. Chromium issue 571674322 — https://issues.chromium.org/issues/571674322
