# wallpaper-engine-dsh

[English](README.md) | [中文](README.zh.md)

A DSH bundle that renders your local **Wallpaper Engine** Video/Web wallpapers as the **live background of the DSH web GUI** (`dsh web`) — with crossfade transitions, an iOS-style liquid-glass treatment, four tuning sliders, and user-defined rotation lists.

Built with a security-first, test-backed architecture:

- **Pure logic layer** (`lib/core.js`) — VDF parsing, discovery, containment — covered by unit tests.
- **Host layer** (`lib/index.js`) — Cordis plugin serving inventory + media over same-origin HTTP.
- **Browser layer** (`src/client.js` → `lib/client.js`) — behind-body rendering + settings UI.
- **Zero model tokens** — no tools, no prompt text; pure UI bundle.

## Why only Video and Web wallpapers?

| WE type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | WE's own 3D engine | ❌ native shaders/objects |
| **Video** | a plain media file | ✅ plays in `<video>` |
| **Web** | HTML + assets | ✅ loads in a sandboxed `<iframe>` |
| **Application** | an injected external window | ❌ |

Unlike simpler integrations, **multi-file Web wallpapers work here**: the host serves a wallpaper's bundled sub-assets (`js`/`css`/images) from inside its project directory, with strict containment checks.

## Architecture

```
┌───────────────────────────── DSH web ─────────────────────────────┐
│  Browser half (lib/client.js)                                     │
│    settings.general.item slot → picker UI (grid, sliders, lists)  │
│    fixed layer behind the app frame → <video> / sandboxed iframe  │
└──────────────▲────────────────────────────────────────────────────┘
               │ same-origin HTTP
┌──────────────┴────────────────────────────────────────────────────┐
│  Host half (lib/index.js, Cordis plugin, inject: ['webServer'])    │
│    GET /we-background/inventory[?refresh=1]  JSON + cached 30 s    │
│    GET /we-background/media/<token>[/asset…] Range + containment   │
│    GET /we-background/preview/<token>        preview image         │
└──────────────▲────────────────────────────────────────────────────┘
               │ pure functions
┌──────────────┴────────────────────────────────────────────────────┐
│  Core (lib/core.js) — tested                                      │
│    VDF parser · Steam discovery · project validation · playlists  │
│    Range parsing · path containment · MIME                        │
└───────────────────────────────────────────────────────────────────┘
```

## Security model

- **Random tokens, not encoded paths.** Media URLs carry a 72-bit random token minted per inventory build; knowing a filesystem path grants nothing. Rebuilding the inventory re-mints every token.
- **Double containment.** `project.json`-declared files must resolve inside their project directory, and web-wallpaper sub-assets must resolve inside the project dir (`..` → 403).
- **Sandboxed web wallpapers.** Third-party wallpaper JS runs in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) and `referrerpolicy="no-referrer"` — an opaque origin that cannot touch DSH storage, cookies, or APIs.
- **Loopback + nosniff.** All responses are same-origin with `X-Content-Type-Options: nosniff`.
- Only enumerated files are ever served; there is no arbitrary-file route.

## Install

```sh
dsh plugin --profile web add wallpaper-engine-dsh
```

or from a checkout:

```sh
git clone https://github.com/Weilv-D/wallpaper-engine-dsh.git
dsh plugin --profile web add link:<absolute path to the cloned folder>
```

Restart `dsh web`, then open **Settings → General → 壁纸背景 (Wallpaper Engine)**.

## Usage

1. Pick a Video/Web wallpaper from the thumbnail grid — it crossfades in behind the app. Scene/Application wallpapers are not embeddable and are hidden.
2. **暂停/播放** pauses a video wallpaper; **关闭** clears it; **刷新** forces the host to rescan (new Workshop subscriptions appear without a page reload).
3. Four sliders tune the blend live: **壁纸模糊** (blur the wallpaper itself), **暗化** (scrim), **边框** (hairline contrast), **玻璃** (frosted-glass panels).
4. **轮播列表**: create any number of rotation lists, each with its own wallpapers, interval (1–120 min) and order (顺序/随机); enable **自动轮转** on one. On first run, your first playable WE playlist is imported automatically; **从 WE 播放列表导入** pulls any other playlist into the editor.
5. The choice persists in `localStorage`. Switch DSH between light/dark themes freely — every surface reads design tokens and follows along; on busy wallpapers raise **暗化/边框** until text is comfortable.

`prefers-reduced-motion` is respected: video wallpapers start paused.

## Limitations

- Scene and Application wallpapers cannot be embedded in a browser (they stay WE's desktop job) — hidden from picker and rotation.
- Sandboxed web wallpapers get an opaque origin: wallpapers that need `localStorage`/IndexedDB persistence across loads won't persist. (Deliberate — same-origin wallpaper JS could otherwise drive the DSH API.)
- Steam discovery covers Windows (registry + libraryfolders.vdf + probes), macOS and Linux (standard Steam roots). Exotic layouts may not be found.
- The glass effect rides DSH design tokens; a shell redesign that renames tokens degrades the frosting gracefully (transparency stays, blur may drop).

## Development

```sh
npm install        # prepare hook builds lib/client.js automatically
npm test           # unit tests for the pure core (node:test)
npm run build      # regenerate lib/client.js from src/client.js
npm run verify     # boot the emitted bundle in a vm sandbox and assert behaviour
```

`lib/core.js` and `lib/index.js` are plain ESM — no build step. `lib/client.js` is a **compiled artifact**; edit `src/client.js` and rebuild. `npm run prepublishOnly` runs the full gate: test → build → verify.

## Releasing

Publishing runs in GitHub Actions (`.github/workflows/publish.yml`) through npm **Trusted Publishing (OIDC)** — no npm token is stored anywhere:

1. Bump `version` in `package.json` and push.
2. Create a GitHub Release whose tag is `v<version>` (must match `package.json`).
3. The workflow runs the full gate, asserts tag ↔ version, and publishes with `--provenance`.

One-time npm setup: package → **Settings → Trusted Publisher → GitHub Actions** (repo `Weilv-D/wallpaper-engine-dsh`, workflow `publish.yml`). The very first version must be published manually once (see README.zh.md §发布 for details) before trusted publishing can be linked.
