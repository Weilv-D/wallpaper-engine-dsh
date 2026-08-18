# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

一个 DSH bundle：把本机 **Wallpaper Engine** 的 Video/Web 壁纸渲染成 **DSH web GUI(`dsh web`)的实时背景**——带交叉淡入过渡、iOS 风格液态玻璃效果、四个调节滑杆和用户自定义轮播列表。

架构安全优先、测试兜底:

- **纯逻辑层**(`lib/core.js`)—— VDF 解析、安装发现、路径约束，全部被单元测试覆盖。
- **宿主层**(`lib/index.js`)—— Cordis 插件，通过同源 HTTP 提供清单与媒体。
- **浏览器层**(`src/client.js` → `lib/client.js`)—— 界面背后渲染 + 设置面板。
- **零模型 token** —— 不注册工具、不注入 prompt，纯 UI bundle。

## 为什么只有 Video 和 Web 壁纸?

| WE 类型 | 渲染方 | 可移植到 DSH? |
|---|---|---|
| **Scene** | WE 自有 3D 引擎 | ❌ 原生 shader/模型 |
| **Video** | 普通媒体文件 | ✅ `<video>` 直接播放 |
| **Web** | HTML + 资源 | ✅ 沙箱 `<iframe>` 加载 |
| **Application** | 注入的外部窗口 | ❌ |

与更简单的集成不同,**多文件 Web 壁纸在这里可以正常工作**:宿主会服务项目目录内打包的子资源(`js`/`css`/图片),并做严格的路径约束检查。

## 架构

```
┌───────────────────────────── DSH web ─────────────────────────────┐
│  浏览器半端(lib/client.js)                                       │
│    settings.general.item 槽位 → 选择器 UI(网格、滑杆、列表)      │
│    应用框架之下的固定层 → <video> / 沙箱 iframe                   │
└──────────────▲────────────────────────────────────────────────────┘
               │ 同源 HTTP
┌──────────────┴────────────────────────────────────────────────────┐
│  宿主半端(lib/index.js,Cordis 插件,inject: ['webServer'])       │
│    GET /we-background/inventory[?refresh=1]  JSON,缓存 30 秒       │
│    GET /we-background/media/<token>[/资源…]  Range + 路径约束      │
│    GET /we-background/preview/<token>        预览图                │
└──────────────▲────────────────────────────────────────────────────┘
               │ 纯函数
┌──────────────┴────────────────────────────────────────────────────┐
│  核心层(lib/core.js)—— 有测试                                    │
│    VDF 解析 · Steam 发现 · 项目校验 · 播放列表                    │
│    Range 解析 · 路径约束 · MIME                                   │
└───────────────────────────────────────────────────────────────────┘
```

## 安全模型

- **随机 token,不是路径编码。** 媒体 URL 携带每次构建清单时铸造的 72 位随机 token;知道文件系统路径没有任何用处。重建清单会重新铸造全部 token,旧 URL 即刻失效。
- **双重路径约束。** `project.json` 声明的文件必须解析在项目目录内;Web 壁纸的子资源同样必须解析在项目目录内(`..` 穿越返回 403)。
- **Web 壁纸沙箱化。** 第三方壁纸 JS 运行在 `sandbox="allow-scripts"`(不含 `allow-same-origin`)且 `referrerpolicy="no-referrer"` 的 iframe 中——不透明源,无法触碰 DSH 的存储、Cookie 或 API。
- **回环 + nosniff。** 全部响应同源,携带 `X-Content-Type-Options: nosniff`。
- 只有被枚举过的文件可被服务,不存在任意文件路由。

## 安装

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

或从源码检出安装:

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<克隆文件夹的绝对路径>
```

重启 `dsh web`,打开 **设置 → 通用 → 壁纸背景 (Wallpaper Engine)**。

## 使用

1. 从缩略图网格选择 Video/Web 壁纸——它会在界面背后淡入。Scene/Application 类型无法嵌入,已从网格隐藏。
2. **暂停/播放** 控制视频壁纸;**关闭** 清除壁纸;**刷新** 强制宿主重新扫描(新订阅的创意工坊壁纸无需刷新页面即可出现)。
3. 四个滑杆实时调节融合效果:**壁纸模糊**(模糊壁纸本体)、**暗化**(文字遮罩)、**边框**(分隔线对比度)、**玻璃**(面板磨砂)。
4. **轮播列表**:可建任意多个列表,各自拥有壁纸集合、切换间隔(1–120 分钟)和顺序(顺序/随机);在目标列表上开启 **自动轮转**。首次运行会自动导入第一个可播放的 WE 播放列表;编辑器里的 **从 WE 播放列表导入** 可拉入任意其他列表。
5. 选择持久化在 `localStorage`。可自由切换 DSH 明暗主题——所有表面都读设计令牌,自动跟随;壁纸太花时调高 **暗化/边框** 直到文字清晰。

尊重系统 `prefers-reduced-motion`:开启减弱动态效果时,视频壁纸默认暂停。

## 限制

- Scene 与 Application 壁纸无法嵌入浏览器(桌面渲染仍是 WE 的本职),已从选择器和轮播中隐藏。
- 沙箱中的 Web 壁纸使用不透明源:依赖 `localStorage`/IndexedDB 跨加载持久化的壁纸无法保存状态。(刻意为之——否则同源壁纸 JS 可以驱动 DSH API。)
- Steam 发现覆盖 Windows(注册表 + libraryfolders.vdf + 探测)、macOS 与 Linux(标准 Steam 目录)。非常规安装布局可能找不到。
- 玻璃效果依托 DSH 设计令牌;若外壳重构重命名令牌,效果会优雅降级(透明度保留,模糊可能消失)。

## 开发

```sh
npm install        # prepare 钩子自动构建 lib/client.js
npm test           # 纯核心层单元测试(node:test)
npm run build      # 从 src/client.js 重新生成 lib/client.js
npm run verify     # 在 vm 沙箱中启动产物并断言行为
```

`lib/core.js` 与 `lib/index.js` 是纯 ESM,无构建步骤。`lib/client.js` 是**编译产物**:请编辑 `src/client.js` 后重新构建。`npm run prepublishOnly` 会跑完整门禁:test → build → verify。
