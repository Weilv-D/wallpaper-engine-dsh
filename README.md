# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

A DSH bundle that turns your local **Wallpaper Engine** library into the live background of the DSH web GUI (`dsh web`). Video wallpapers play behind the chat, web wallpapers render in place, and everything in between — crossfade transitions, liquid-glass panels, a legibility veil that adapts to any wallpaper, manual framing, rotation lists, search, and a bilingual UI — is controlled from a single settings row.

## Features

**The library, rendered live.** The grid lists every wallpaper the browser can genuinely render — video and web wallpapers. Scene and application wallpapers are Wallpaper Engine's private `.pkg` scene packages; since no browser can execute them, they are filtered out rather than offered as degraded stills. Everything listed plays for real, badged Video or Web, and a search box narrows large libraries by title or workshop id instantly.

**Legibility on any wallpaper.** Text stays readable by construction, not by luck. The veil always opposes the text colour — black in the dark theme, white in the light theme — so neither a pitch-black nor a pure-white wallpaper can swallow the UI. On top of that, a Smart veil samples the wallpaper's brightness every few seconds and automatically strengthens the veil when a scene drifts too bright (or too dark) for the current theme; it also strengthens the border contrast and the glass frosting on the same evidence. Dropdowns, menus, and dialogs sit on DSH's opaque surfaces and are never affected.

**Manual framing.** Pick a base layout — Cover, Contain, Stretch, or Original — then frame the shot yourself. **Adjust** opens the live wallpaper fullscreen: drag to pan, scroll to zoom (0.25×–4×), Esc or Done to finish. The framing persists per selection, and **Reset crop** restores the default in one click.

**Four live sliders.** Wallpaper blur, Scrim, Borders, and Glass — every change lands instantly and persists. Wallpaper blur uses clipped overscan, so blurring never warps or shifts the image; a whisper of dither noise keeps smooth gradients band-free; and at zero blur the media bypasses the filter pipeline entirely for bit-exact pixels.

**Rotation lists.** Build any number of carousel lists, each with its own wallpapers, interval (1–120 min), and order (sequence or random). Your first playable Wallpaper Engine playlist is imported automatically on first run; any other playlist can be imported into any list.

**Resource monitor.** A live FPS readout with a low-framerate hint, plus optional auto-pause when the tab is hidden or the battery runs low. `prefers-reduced-motion` starts videos paused.

**Bilingual.** The UI follows the shell's Language setting (Chinese/English) with a manual override in the picker.

**Resilient playback.** Switches and clears crossfade smoothly. A video the browser cannot decode retries once with fresh tokens, then falls back to its preview still with a note in the status row — and the next Refresh retries the live media. Inventory rebuilds re-issue URLs in the background without ever interrupting a playing stream.

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
2. **Pause/Play** controls video playback; **Close** fades the wallpaper out; **Refresh** rescans the library — new workshop subscriptions appear without reloading the page, and any demoted wallpaper retries its live media.
3. Tune the blend with the sliders. On busy wallpapers, raise **Scrim** and **Borders** until text is comfortable; Smart veil handles it automatically when enabled. The UI follows DSH's light/dark theme on its own.
4. Use the **Fit** row for the base layout, then **Adjust** to pan and zoom the crop directly on the canvas.
5. Create rotation lists with **New**, fill them from the grid or import a WE playlist, then enable **Auto-rotate**.
6. The resource row shows the current frame rate and the two auto-pause switches.

Your selection and every knob persist in the browser's `localStorage`.

## How it works

The bundle has two halves:

- A **host plugin** discovers the Wallpaper Engine install (Steam registry entry, `libraryfolders.vdf`, standard probe paths across Windows/macOS/Linux), enumerates projects from the default/my-projects folders and the workshop, keeps only the browser-renderable kinds, and serves a JSON inventory plus the media bytes over same-origin routes:
  - `GET /we-background/inventory[?refresh=1]`
  - `GET /we-background/media/<token>[/asset…]` — with HTTP Range support for video seeking; web wallpapers can fetch their bundled sub-assets
  - `GET /we-background/preview/<token>`
- A **browser plugin** renders the chosen wallpaper on a fixed layer behind the app frame, contributes the settings UI, and keeps every effect on DSH design tokens so themes apply cleanly.

Media serving is defensive by design: tokens are unguessable 72-bit values, stable across inventory rebuilds (an in-flight stream is never killed by a background refresh) and re-minted only on an explicit refresh; sub-asset paths are contained lexically and re-verified against the real filesystem so symlinks cannot escape their wallpaper directory; HTML and SVG responses carry a `sandbox` CSP so they can never execute against the DSH origin; and responses that would come up short destroy themselves rather than truncate silently. The host answers from a 30-second inventory cache, resolves discovery asynchronously off the request path, and caches it for ten minutes. The bundle registers no model tools and adds no prompt text.

## Limitations

- Scene and application wallpapers are not listed: they are Wallpaper Engine's private `.pkg` scene packages, and their live animation can only be rendered by Wallpaper Engine itself on the desktop.
- Web wallpapers run isolated from the page's storage, so ones that persist state across loads won't keep it.
- The glass effect reads DSH design tokens; if a future shell redesign renames them, frosting degrades to plain transparency.

## Development

```sh
npm install        # builds lib/client.js via the prepare hook
npm test           # unit tests for the pure core + wire-level host integration
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
