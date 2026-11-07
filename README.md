# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A DSH bundle that turns the local **Wallpaper Engine** library into a living background for DSH. Video wallpapers play behind the chat UI; web wallpapers render directly. Crossfade, liquid-glass panels, a readability veil that adapts to the wallpaper, manual framing, rotation lists, search, and a bilingual UI live in one dedicated settings section.

## Features

### Wallpaper list

- Lists only types the browser can truly render: video and web wallpapers.
- Scene and application wallpapers are Wallpaper Engine's private `.pkg` format; the browser cannot execute them, so they are not listed.
- Every listed wallpaper actually plays, tagged 视频/网页 (video / web).
- The search box filters by title or Workshop ID.

### Dark material and legibility

- The material is permanently dark. Set the shell theme to dark; the dark material assumes it.
- The veil is always black; even a pitch-black wallpaper cannot swallow the UI.
- The Smart veil samples the wallpaper's brightness and busyness (the standard deviation of luminance) every few seconds and strengthens the veil when a scene drifts too bright or too busy.
- Web wallpaper pixels are unreadable inside the sandbox, so the Smart veil samples their preview image instead.
- The glass body is sampled from the wallpaper: hue from its average colour, chroma capped at 14%. The body lightens as the scene darkens; its alpha follows brightness and busyness together (0.16–0.34).
- The edge is modelled as a lit column: a specular along the top, a bounce along the bottom, darkened side walls, and a dark outer contour. Edge light strengthens as the wallpaper darkens.
- The specular is static by default; the Pointer highlight setting makes it follow the mouse across the composer (repaints each frame, off by default).
- When the composer floats over bright content, an inner dimming layer rises to a 35% ceiling (the HIG value for this case).

### Refraction

- Each pane rasterises its displacement map at its own pixel size and radius; `feDisplacementMap` sits at the end of the filter chain — blur first, then refract.
- Displacement peaks at the rim and decays inward to zero. The edges compress the scene inward; this is where the liquid read comes from.
- A ResizeObserver rebuilds the map when a pane changes size.
- The Surface refraction setting turns the whole lens layer off — plain backdrop blur remains.
- Refraction renders in Chromium-family engines only (see Limitations).

### Tiers and coverage

| Tier | Surfaces | Blur cap |
|---|---|---|
| T1 | Crop-adjust bar | 4px |
| T2 | Composer, menus, dock, new-session button | 10px |
| T3 | Settings dialog, full-page workbenches | 14px |

- Glass belongs to the control layer: message bubbles keep only body and edge light, with no backdrop capture; settings cards soften to a translucent token fill.
- Menus, dialogs, overlay panels and the dock take their own tier; submenus (`role="menu"`) take T2.
- Tooltips take the body tint and the bevel, with no backdrop capture.
- The shell's other floating panels consume the `--dsw-menu-backdrop-filter` token, re-pointed at the same filter chains; ds-harness-remote's `dshRemotePage` gets the dialog treatment; dsh-better-sidebar's bottom panel is T2 light glass.

### Manual framing

1. Pick the base arrangement under 排布: fill, contain, fill-stretch, native, free.
2. Choose 调整画面 to expand the wallpaper full-screen; scroll to zoom, drag to pan.
3. In free mode, rotate freely (±90° buttons or Alt+drag) and zoom between 0.1–4×.
4. Crops keep the picture covering the screen; free mode places the wallpaper on a black canvas and always keeps a sliver in view.
5. 镜像 mirrors the wallpaper, in every arrangement.
6. Esc or 完成 exits and saves; 重置裁剪 restores the defaults.

### Four live sliders

- **Wallpaper blur, Scrim, Borders, Glass** — every change lands instantly and persists.
- Blur renders in place: composition, layout and crop stay identical at every level.
- The Glass slider drives the tiers' blur ceilings (4 / 10 / 14px) and tops out at the heaviest cap. At zero the chains collapse to none; surfaces keep body and edge light.
- The Borders slider drives the glass's own hairline ring: 0.35 is the baseline, the ceiling is roughly 2.6×, and zero removes the ring, leaving the bevels. The host's own control strokes keep their host values.
- Wallpaper blur adds a whisper of dither noise against gradient banding; at zero the media bypasses the filter pipeline entirely.

### Rotation lists

- Create any number of lists, each with its own wallpaper set, interval (1–120 minutes) and order (sequential / random).
- A list auto-rotates only while it holds at least two playable wallpapers; the status line shows whether rotation is running.
- The first run imports the first playable Wallpaper Engine playlist; other playlists import into any list at any time.

### Resource monitor

- A live frame-rate readout with a low-fps hint.
- Optional auto-pause when the page hides or the battery drops below 20%.
- Videos start paused under `prefers-reduced-motion`.

### Bilingual UI

The UI follows the DSH 语言 (language) setting (中文 / English), or a manual choice in the panel.

### Playback-failure recovery

- Switching and closing both crossfade.
- On repeated decode failures: retry once with fresh tokens; then fall back to the preview image with a status-line note; items without a preview clear the selection instead of showing a black screen.
- Re-selecting a demoted wallpaper is a retry: demotion and the failure count clear together.
- 刷新 rescans the library and retries the original media; the playing element swaps its address in place and keeps its progress. Inventory rebuilds in the background reuse the same URLs and never interrupt playback.

## Install

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

Or install from a source checkout (handy for development; changes take effect live):

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<absolute path to the clone>
```

Restart `dsh web`, open 设置 from the session list sidebar, and pick **壁纸背景**.

## Usage

1. Pick a wallpaper from the thumbnail grid; it fades in behind the UI. Use search for large libraries.
2. **暂停/播放** controls video; **关闭** fades it out; **刷新** rescans the library.
3. Tune the blend with the sliders. Raise **暗化** and **边框** until text reads clearly. With the Smart veil on, this is automatic.
4. 排布 sets the base arrangement; 调整画面 pans with the mouse and zooms with the wheel.
5. Create a rotation list with **新建**, pick wallpapers or import a WE playlist, then enable **自动轮转**.
6. The resource row shows the frame rate and the two auto-pause switches.

All choices and adjustments persist in the browser's `localStorage`.

## Desktop

Desktop shares the browser's frontend and injection pipeline. The `dsh.client` manifest declares `platform: "web"`; no separate desktop package is needed.

- **Windows**: the main window is opaque; the wallpaper renders in the DOM layer. The host owns a solid overlay strip for the window controls; the plugin blends the wallpaper into it with a short fade in a pinned dark tone (`#1b1b1c`), disabled in fullscreen.
- **macOS**: the shell sidebar is the system's native vibrant material. When the wallpaper plays behind it, the system material shows instead of the wallpaper.
- With transparency effects off (`prefers-reduced-transparency`), glass and blur revert to solid surfaces; the wallpaper stays, and the veil plus the solids carry legibility.
- Switching on increased contrast (`prefers-contrast: more`) turns the glass body near-opaque and the hairline ring into a real border; blur itself stays.

## How it works

The bundle has two halves:

- **Host plugin**: discovers the Wallpaper Engine install (Steam registry keys, `libraryfolders.vdf`, standard Windows/macOS/Linux paths), enumerates the default projects, my projects and Workshop directories, keeps only browser-renderable types, and serves data over same-origin routes:
  - `GET /we-background/inventory[?refresh=1]`
  - `GET /we-background/media/<token>[/<entry file or sub-resource>…]` — HTTP Range supported, so video seeking works. A web wallpaper's URL points straight at its entry file; relative references inside the wallpaper resolve per Wallpaper Engine's own rules. Media responses carry `Access-Control-Allow-Origin: *`, so sandboxed iframes can read their own resources.
  - `GET /we-background/preview/<token>`
- **Browser plugin**: renders the selected wallpaper on a fixed layer below the app frame and contributes the settings UI. Every effect reads DSH design tokens.

Media service hardening:

- Tokens are unguessable 72-bit random values; they stay stable across inventory rebuilds and regenerate only on an explicit refresh.
- Sub-resource paths pass a lexical containment check, then a real-filesystem recheck; symlinks cannot point outside the wallpaper directory.
- HTML and SVG responses carry a `sandbox` CSP and cannot execute as the DSH origin.
- Wallpaper iframes pin a neutral `color-scheme`; the shell's dark theme cannot leak into third-party wallpapers.
- The CORS wildcard only lets the token holder read files it could already request; the whole service listens on loopback only.
- Truncated-length responses terminate instead of ending silently short.
- The inventory caches for 30 seconds on the host; install discovery runs off the request path and caches for 10 minutes.
- The plugin registers no model tools and occupies no prompt.

## Limitations

- Scene and application wallpapers are not listed: they are Wallpaper Engine's private `.pkg` packages, which a browser cannot execute.
- Web wallpapers are storage-isolated; wallpapers that save state across loads cannot keep it.
- Web wallpapers with sound stay silent until you interact with the page (sandboxed audio autoplay rules); wallpapers depending on Wallpaper Engine's system audio input have no signal to draw.
- Video codecs follow the browser's decoder support: H.264, VP8, VP9 and AV1 play directly; H.265/HEVC cannot software-decode on most machines. When a video claims to play but decodes no frames, it demotes to the preview image with a status-line note. Transcode to an H.264 mp4 or a VP9 webm for full playback.
- The glass reads DSH design tokens; if a shell refactor renames them, the glass degrades to a plain translucent fill.
- Surface refraction renders in Chromium-family engines only: Safari and Firefox parse `backdrop-filter: url()` and then drop the whole chain, so the plugin gates it by UA and falls back to plain blur. The Electron desktop is unaffected.

## Development

```sh
npm install        # the prepare hook builds lib/client.js
npm test           # core unit tests + host integration tests
npm run build      # rebuild lib/client.js from src/client.js
npm run verify     # boots the bundle in a vm sandbox and asserts behaviour
```

- `lib/core.js`: pure logic, unit-tested.
- `lib/index.js`: host plugin.
- `src/client.js`: browser source; the build artifact is `lib/client.js`, do not hand-edit it.
- `npm run prepublishOnly` runs the full gate: test → build → verify.
- The liquid-glass research brief (layer model, refraction profile, Chromium constraints, evidence-graded) lives in `liquid-glass-report.zh.md`.

## Releases

Publishing runs on GitHub Actions through npm Trusted Publishing (OIDC), no stored token. Locally one command suffices:

```sh
npm run release          # patch bump; also release:minor / release:major
```

It bumps the version, commits, tags `v<version>` and pushes both. The tag push triggers the publish workflow: full gate → tag/version match → `npm publish --provenance` → an automatic GitHub Release with notes.
