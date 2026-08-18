# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

一个 DSH bundle：把本机 **Wallpaper Engine** 壁纸库变成 DSH web GUI(`dsh web`)的动态背景。视频壁纸在聊天界面背后播放，网页壁纸原地渲染，场景/应用壁纸以预览图作为静态背景——带交叉淡入、液态玻璃面板、轮播列表、搜索和资源监控。

## 功能

- **全库浏览** —— 视频与网页壁纸动态渲染；场景与应用壁纸显示预览图作为静态背景。凡是有预览图或可播放文件的壁纸都可选用，按类型标注角标（视频 / 网页 / 静态）。
- **搜索** —— 按标题或创意工坊 ID 即时筛选网格。
- **轮播列表** —— 可建任意多个列表，各自拥有壁纸集合、切换间隔（1–120 分钟）和顺序（顺序/随机）。首次运行自动导入第一个可播放的 Wallpaper Engine 播放列表，其余列表可随时导入。
- **四个实时滑杆** —— 壁纸模糊、暗化、边框、玻璃，即时生效并持久保存。
- **画布排布** —— 视频与静态壁纸支持填充/适应/拉伸/原始四种排布和五向对齐。
- **资源监控** —— 帧率读数与低帧率提示，页面隐藏或电量不足时自动暂停（均可开关）。
- **中英双语** —— 设置界面跟随 DSH 的"语言"偏好自动切换，也可在面板内手动指定。
- **交叉淡入** —— 切换与关闭都平滑过渡，不生硬跳变。

## 安装

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

或从源码检出安装（便于开发，改动即时生效）:

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<克隆文件夹的绝对路径>
```

重启 `dsh web`，打开 **设置 → 通用 → 壁纸背景 (Wallpaper Engine)**。

## 使用

1. 从缩略图网格选择壁纸，它会在界面背后淡入。壁纸库较大时用搜索框快速定位。
2. **暂停/播放** 控制视频播放；**关闭** 淡出壁纸；**刷新** 重新扫描壁纸库，新订阅的创意工坊壁纸无需刷新页面即可出现。
3. 用滑杆调节融合效果。壁纸太花时调高 **暗化** 和 **边框** 直到文字清晰；界面跟随 DSH 明暗主题自动适配。**排布/对齐** 一行设置视频与静态壁纸在画布上的摆放（填充/适应/拉伸/原始，五个锚点）。
4. 用 **新建** 创建轮播列表，从网格挑选或导入 WE 播放列表，然后开启 **自动轮转**。
5. 资源行显示当前帧率，并提供两个自动暂停开关。系统开启 `prefers-reduced-motion` 时视频默认暂停。
6. "语言"控件在中英文之间切换面板；选"自动"则跟随 DSH 的语言设置。

选择持久化在浏览器的 `localStorage` 中。

## 工作原理

bundle 分为两半：

- **宿主插件** 负责发现 Wallpaper Engine 安装位置（Steam 注册表项、`libraryfolders.vdf`、Windows/macOS/Linux 标准探测路径），从默认项目、我的项目和创意工坊目录枚举壁纸，并通过同源路由提供 JSON 清单与媒体数据：
  - `GET /we-background/inventory[?refresh=1]`
  - `GET /we-background/media/<token>[/资源…]` —— 支持 HTTP Range，视频可拖动进度；网页壁纸可加载其打包的子资源
  - `GET /we-background/preview/<token>`
- **浏览器插件** 把选中的壁纸渲染在应用框架之下的固定层，提供设置界面，所有视觉效果都读 DSH 设计令牌，主题切换自然生效。壁纸模糊采用裁边式超采样（内容不变形），叠加微量抖动噪声消除渐变色带；浏览器解不了的视频会自动改用该壁纸的预览图。

清单由宿主缓存 30 秒，媒体令牌按壁纸稳定复用（后台重建不会掐断播放中的流）；安装发现异步执行并缓存 10 分钟。本插件不注册模型工具，不占用 prompt。

## 限制

- 场景与应用壁纸以静态图呈现，其动态渲染仍是 Wallpaper Engine 桌面的职责。
- 网页壁纸与页面存储隔离，需要跨加载保存状态的壁纸无法保留状态。
- 玻璃效果读 DSH 设计令牌；若未来外壳重构重命名令牌，磨砂会退化为普通半透明。

## 开发

```sh
npm install        # prepare 钩子自动构建 lib/client.js
npm test           # 纯核心层单元测试(node:test)
npm run build      # 从 src/client.js 重新生成 lib/client.js
npm run verify     # 在 vm 沙箱中启动产物并断言行为
```

目录结构：`lib/core.js`（纯逻辑，有测试）、`lib/index.js`（宿主插件）、`src/client.js`（浏览器源码）→ `lib/client.js`（构建产物，请勿手改）。`npm run prepublishOnly` 执行完整门禁：test → build → verify。

## 发布

发布由 GitHub Actions 通过 npm Trusted Publishing(OIDC,无需存储令牌)自动完成。本地只需一条命令:

```sh
npm run release          # 补丁版本;另有 release:minor / release:major
```

它会提升版本号、提交、打 `v<版本号>` 标签并一并推送。标签推送触发发布工作流:完整门禁 → 校验标签与版本一致 → `npm publish --provenance` → 自动创建带更新说明的 GitHub Release。
