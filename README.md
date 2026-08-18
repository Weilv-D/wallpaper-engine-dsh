# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

A DSH bundle that turns your local **Wallpaper Engine** library into the live background of the DSH web GUI (`dsh web`). Video wallpapers play behind the chat, web wallpapers render in place, and scene/application wallpapers join in as still images — with crossfade transitions, liquid-glass panels, rotation lists, search, a resource monitor, and a bilingual UI.

## Features

- **Whole-library browsing** — video and web wallpapers render live; scene and application wallpapers show their preview as a static background. Everything with a preview or playable file is selectable, badged by type (Video / Web / Still).
- **Search** — filter the grid instantly by title or workshop id.
- **Rotation lists** — any number of carousel lists, each with its own wallpapers, interval (1–120 min) and order (sequence/random). Your first playable Wallpaper Engine playlist is imported automatically; others can be imported into any list.
- **Four live sliders** — Wallpaper blur, Scrim, Borders, Glass — all instant and persisted.
- **Legibility on any wallpaper** — the veil opposes the text colour (white veil in light theme, black in dark) and a Smart veil toggle samples the wallpaper's brightness every few seconds, automatically strengthening the veil when a scene gets too bright or too dark for the current theme. Dropdowns, menus, and dialogs keep DSH's opaque surfaces untouched.
- **Manual crop** — pick a base layout (Cover/Contain/Stretch/Original), then frame it yourself: **Adjust** opens the live wallpaper fullscreen where you drag to pan and scroll to zoom; **Reset crop** restores it.
- **Resource monitor** — FPS readout with a low-framerate hint, plus auto-pause when the tab is hidden or the battery runs low (both optional).
- **Bilingual** — the settings UI follows the shell's Language preference (Chinese/English), with a manual override in the picker.
- **Crossfade** — wallpaper switches and clearing fade smoothly instead of snapping.

## Install

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

Or from a checkout (live-linked for development):

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<absolute path to the cloned folder>
```

Restart `dsh web`, then open **Settings → General → Wallpaper Engine**.

## Usage

1. Pick a wallpaper from the thumbnail grid — it fades in behind the app. Use the search box to narrow large libraries.
2. **Pause/Play** controls video playback; **Close** fades the wallpaper out; **Refresh** rescans the library (new workshop subscriptions appear without reloading the page).
3. Tune the blend with the sliders. On busy wallpapers, raise **Scrim** and **Borders** until text is comfortable; the UI follows DSH's light/dark theme automatically. The **Fit** row sets the base layout for video and still wallpapers — **Adjust** then lets you pan and zoom the crop directly on the canvas.
4. Create rotation lists with **New**, fill them from the grid or import a WE playlist, then enable **Auto-rotate**.
5. The resource row shows the current frame rate and offers two auto-pause switches. `prefers-reduced-motion` starts videos paused.
6. The Language control switches the picker between Chinese and English; on Auto it follows the shell setting.

Your selection persists in the browser's `localStorage`.

## How it works

The bundle has two halves:

- A **host plugin** discovers the Wallpaper Engine install (Steam registry entry, `libraryfolders.vdf`, standard probe paths across Windows/macOS/Linux), enumerates projects from the default/my-projects folders and the workshop, and serves a JSON inventory plus the media bytes over same-origin routes:
  - `GET /we-background/inventory[?refresh=1]`
  - `GET /we-background/media/<token>[/asset…]` — with HTTP Range support for video seeking; web wallpapers can fetch their bundled sub-assets
  - `GET /we-background/preview/<token>`
- A **browser plugin** renders the chosen wallpaper on a fixed layer behind the app frame, contributes the settings UI, and keeps every effect on DSH design tokens so themes apply cleanly. Wallpaper blur is clipped overscan (no content warping) with a whisper of dither noise to keep gradients band-free; a video the browser cannot decode falls back to the wallpaper's preview image. Scene and application wallpapers can only show their workshop preview — the bundle reads each preview's pixel size and presents low-resolution ones as sharp centered art over a blurred copy of themselves, instead of a mushy fullscreen stretch.

The host answers from a 30-second inventory cache with stable per-wallpaper tokens (an in-flight stream is never killed by a background rebuild); discovery is resolved asynchronously and cached for ten minutes. The bundle registers no model tools and adds no prompt text.

## Limitations

- Scene and application wallpapers render as still images; their live animation remains Wallpaper Engine's desktop job.
- Web wallpapers run isolated from the page's storage, so ones that persist state across loads won't keep it.
- The glass effect reads DSH design tokens; if a future shell redesign renames them, frosting degrades to plain transparency.

## Development

```sh
npm install        # builds lib/client.js via the prepare hook
npm test           # unit tests for the pure core (node:test)
npm run build      # regenerate lib/client.js from src/client.js
npm run verify     # boot the emitted bundle in a vm sandbox and assert behaviour
```

Layout: `lib/core.js` (pure, tested logic), `lib/index.js` (host plugin), `src/client.js` (browser source) → `lib/client.js` (built artifact; do not hand-edit). `npm run prepublishOnly` runs the full gate: test → build → verify.

## Releasing

Releases publish automatically via GitHub Actions and npm Trusted Publishing (OIDC, no stored tokens). One command does everything locally:

```sh
npm run release          # patch bump; also release:minor / release:major
```

It bumps `version`, commits, tags `v<version>`, and pushes both. The tag push triggers the publish workflow: full gate → tag ↔ version check → `npm publish --provenance` → the GitHub Release is created automatically with generated notes.
