# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A DSH bundle that turns your local **Wallpaper Engine** library into the live background of the DSH web GUI (`dsh web`). Video wallpapers play behind the chat, web wallpapers render in place, and everything in between — crossfade transitions, liquid-glass panels, a legibility veil that adapts to any wallpaper, manual framing, rotation lists, search, and a bilingual UI — is controlled from its own dedicated settings section.

## Features

**The library, rendered live.** The grid lists every wallpaper the browser can genuinely render — video and web wallpapers. Scene and application wallpapers are Wallpaper Engine's private `.pkg` scene packages; since no browser can execute them, they are filtered out rather than offered as degraded stills. Everything listed plays for real, badged Video or Web, and a search box narrows large libraries by title or workshop id instantly.

**Legibility on any wallpaper.** Text stays readable by construction, not by luck. The material is permanently dark — one glass recipe, whatever the shell or OS light/dark setting says — and the veil is always black, so a pitch-black wallpaper can never swallow the UI (pair the shell with its dark theme, which the dark material assumes). On top of that, a Smart veil samples the wallpaper's brightness and its busyness (the standard deviation of luminance) every few seconds and strengthens the veil when a scene drifts too bright or too noisy for light-on-dark text (web wallpapers' pixels are unreadable inside the sandbox, so their preview still stands in as the sample). The glass is no longer a white haze over a base fill but a body sampled from the wallpaper: hue from its average colour, chroma capped at 14% (any more and it reads as coloured plastic), lightness 9%, alpha set by brightness and busyness together (0.20–0.46) — so a deep-space scene gets a thin, directional smoke while a poster thickens automatically and presses the colour blocks beneath it down. The edge is modelled as a lit round column rather than a uniform outline: a 1px specular on the top edge, then a 2px decay, a 7px inner reflection and a 0.5px inner hairline, a bounce along the bottom edge, darkened side walls, and a dark outer contour. A single overhead light lays four specular pools (brightest at the corners, a soft band across the top centre, a cool return at the bottom); their strength falls as the wallpaper darkens. They are static by default — the Pointer highlight setting lets the specular follow the mouse across the composer (it repaints that surface every frame, off by default). Refraction is now per surface: each pane rasterises its displacement map at its own pixel size and radius and runs it before the blur chain, rebuilt by a ResizeObserver when the shape changes — the old single 256px map stretched across every surface pushed the composer's refraction band to about 61px at its ends and left it near 10px at the top, so the thickness never matched. Elevation has four steps: e0 contact, e1 near, e2 mid, e3 far, with the mid and far drops carrying the wallpaper's hue so the shadow belongs to the scene instead of punching a grey hole; on a dark scene shadows are all but invisible, and the layering is carried by edge light, body and specular instead. Glass comes in three tiers: T1 for small pieces such as the new-session button and the composer's + (blur capped at 4px, saturate 1.6), T2 for the composer, menus and the bottom dock (10px, 1.4), T3 for the settings dialog and full-page workbenches (14px, 1.3, with contrast flattened to 0.9). Content layers no longer wear glass: message bubbles, settings cards and hover toolbars keep only body and edge light, with no `backdrop-filter` — Apple's rule is that glass belongs to the control layer. The bottom dock rises to T2 light glass with a body 0.8× thinner. The composer and bubbles are treated as the HIG "clear" variant floating over media: when the sampled brightness threatens the theme's text, an inner dimming layer rises up to the 35% ceiling the HIG specifies for that case. The material also reaches surfaces the plugin does not restyle by hand: the shell's other anchored panels consume its `--dsw-menu-backdrop-filter` token, re-pointed at the same tiered chains, and third-party full-page surfaces (ds-harness-remote's `dshRemotePage`, dsh-better-sidebar's `data-dsh-bottom-panel`) get the dialog treatment. The material moves: a registered custom property makes thickness changes glide, every wallpaper switch breathes one rim-light swell through the crossfade, the crop bar springs in, and `prefers-reduced-motion` turns all of it off. Coverage hangs off semantic hooks: menus, the composer, dialogs, overlay panels, the dock and the new-session button each take their tier; submenus (`role="menu"`) take the T2 glass; tooltips get the body tint and the bevel but no backdrop capture — they are read for a second, and a blur is not worth an offscreen pass there. Everything reverts to the host look when the wallpaper is off.

**Manual framing.** Pick a base layout — Cover, Contain, Stretch, Original, or Free — then frame the shot yourself. **Adjust** opens the live wallpaper fullscreen: scroll to zoom, drag to pan. In the seamless layouts the picture already fills the screen at 100% — zoom in with the wheel first and panning unlocks (the hint bar says so). In the first four layouts the crop is clamped so the image always fills the screen with no exposed edges; **Free** places the wallpaper at natural size on a black canvas where it can be dragged anywhere, zoomed from 0.1× to 4×, and rotated to any angle (±90° buttons or Alt+drag), with just enough kept on screen that it can never be dragged out of sight. **Mirror** flips the wallpaper horizontally and works in every layout — a flip never exposes an edge. Esc or Done finishes, the framing persists, and **Reset crop** restores the default in one click. Web wallpapers take the same select and the same zoom/pan/rotate framing — the transform applies to the iframe directly.

**Four live sliders.** Wallpaper blur, Scrim, Borders, and Glass — every change lands instantly and persists. Blur renders in place: composition, layout, and crop stay identical at every blur level, and within one blur radius of the screen edge the picture fades softly into the veil beneath the UI chrome. A whisper of dither noise keeps smooth gradients band-free; at zero blur the media bypasses the filter pipeline entirely for bit-exact pixels. The Glass slider drives the three tiers' blur ceilings (4/10/14px) and the body's thickness, and gates the refraction lens; saturation and contrast are fixed per tier (1.6 / 1.4 with 0.92 / 1.3 with 0.90) — flattening the backdrop's contrast is what quiets a busy wallpaper, since deepening the body alone turns it into dead grey, and the chain no longer reproduces the host recipe verbatim. The same slider scales the edge-specular strength (thicker glass catches more light); at zero the whole glass filter chain collapses to none and the surfaces keep only body and edge light. The Borders slider drives the glass's own hairline rim: the 0.35 default is a host-level ring, the ceiling roughly triples it for busy wallpapers, and zero removes the rim leaving only the bevels — the host's own control strokes (menus, cards, buttons) keep their host values and are no longer brightened.

**Rotation lists.** Build any number of carousel lists, each with its own wallpapers, interval (1–120 min), and order (sequence or random). Auto-rotate arms once the active list holds at least two usable wallpapers; the status row always reports whether rotation is actually running. Your first playable Wallpaper Engine playlist is imported automatically on first run; any other playlist can be imported into any list.

**Resource monitor.** A live FPS readout with a low-framerate hint, plus optional auto-pause when the tab is hidden or the battery runs low. `prefers-reduced-motion` starts videos paused.

**Bilingual.** The UI follows the shell's Language setting (Chinese/English) with a manual override in the picker.

**Resilient playback.** Switches and clears crossfade smoothly. Media that repeatedly fails to decode retries once with fresh tokens, then falls back to the preview still with a note in the status row; an entry with nothing to fall back on is cleared rather than left on a dead layer — and the next Refresh retries the live media. Refresh re-issues every URL and swaps it into the live element in place, so playback position survives. Background inventory rebuilds reuse the same URLs and never touch a playing stream.

## Install

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

Or from a checkout (live-linked for development):

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<absolute path to the cloned folder>
```

Restart `dsh web`, open **Settings** from the sidebar, and pick **Wallpaper**.

## Usage

1. Pick a wallpaper from the thumbnail grid — it fades in behind the app. Use the search box to narrow large libraries.
2. **Pause/Play** controls video playback; **Close** fades the wallpaper out; **Refresh** rescans the library — new workshop subscriptions appear without reloading the page, and any demoted wallpaper retries its live media.
3. Tune the blend with the sliders. On busy wallpapers, raise **Scrim** and **Borders** until text is comfortable; Smart veil handles it automatically when enabled. The UI follows DSH's light/dark theme on its own.
4. Use the **Fit** row for the base layout, then **Adjust** to pan and zoom the crop directly on the canvas.
5. Create rotation lists with **New**, fill them from the grid or import a WE playlist, then enable **Auto-rotate**.
6. The resource row shows the current frame rate and the two auto-pause switches.

Your selection and every knob persist in the browser's `localStorage`.

## Desktop

The desktop shell and the browser share the same frontend and the same injection pipeline; the `platform: "web"` declaration works as-is, with no separate desktop package.

- **Windows**: the main window is opaque and the wallpaper renders at the DOM layer. The window-controls strip at the top is an opaque host-owned overlay; the plugin blends the wallpaper into it with a short fade in the overlay's own colour, and the fade switches off in fullscreen.
- **macOS**: the shell sidebar is the system's native vibrant material, so what shows behind the wallpaper there is the system material rather than the wallpaper itself — host behaviour.
- **With system transparency effects off** (`prefers-reduced-transparency`), all glass and blur falls back to solid surfaces; the wallpaper stays, and legibility is carried by the veil and the solids. With **increase contrast** on (`prefers-contrast: more`), the glass fills go near-opaque and the hairline ring steps up to a solid border, while the blur itself stays.

## How it works

The bundle has two halves:

- A **host plugin** discovers the Wallpaper Engine install (Steam registry entry, `libraryfolders.vdf`, standard probe paths across Windows/macOS/Linux), enumerates projects from the default/my-projects folders and the workshop, keeps only the browser-renderable kinds, and serves a JSON inventory plus the media bytes over same-origin routes:
  - `GET /we-background/inventory[?refresh=1]`
  - `GET /we-background/media/<token>[/<entry file or asset>…]` — with HTTP Range support for video seeking. Web wallpapers are addressed at their entry file (e.g. `…/media/<token>/index.html`), so the document URL mirrors the project directory and the wallpaper's own relative references (scripts, styles, images, fetches) resolve exactly where Wallpaper Engine would resolve them. Media responses carry `Access-Control-Allow-Origin: *` so wallpapers inside the sandboxed iframe (an opaque origin) can still `fetch()` their own assets.
  - `GET /we-background/preview/<token>`
- A **browser plugin** renders the chosen wallpaper on a fixed layer behind the app frame, contributes the settings UI, and keeps every effect on DSH design tokens so themes apply cleanly.

Media serving is defensive by design: tokens are unguessable 72-bit values, stable across inventory rebuilds (an in-flight stream is never killed by a background refresh) and re-minted only on an explicit refresh; sub-asset paths are contained lexically and re-verified against the real filesystem so symlinks cannot escape their wallpaper directory; HTML and SVG responses carry a `sandbox` CSP so they can never execute against the DSH origin; the wallpaper iframe additionally pins a neutral `color-scheme`, so the shell's dark-theme scheme never leaks into — and breaks — third-party wallpaper apps; the wildcard CORS on media only lets a caller who already knows a token read bytes it could already request — the token stays the capability, and the server is loopback-only; and responses that would come up short destroy themselves rather than truncate silently. The host answers from a 30-second inventory cache, resolves discovery asynchronously off the request path, and caches it for ten minutes. The bundle registers no model tools and adds no prompt text.

## Limitations

- Scene and application wallpapers are not listed: they are Wallpaper Engine's private `.pkg` scene packages, and their live animation can only be rendered by Wallpaper Engine itself on the desktop.
- Web wallpapers run isolated from the page's storage, so ones that persist state across loads won't keep it.
- Web wallpapers with sound may stay silent until you interact with the page — browsers gate audio in sandboxed documents on a user gesture, and wallpapers that rely on Wallpaper Engine's system-audio feed (visualizers) have no signal to draw from.
- Video codecs are bounded by what the browser can decode. H.264/AVC, VP8/VP9, and AV1 play natively; workshop videos compressed with H.265/HEVC cannot be software-decoded on most machines — previously a solid black screen, now detected as "playing but zero decoded frames" and automatically demoted to the preview still with a status note. Transcoding to H.264 mp4 or VP9 webm restores full playback.
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
