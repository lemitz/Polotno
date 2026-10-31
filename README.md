<p align="center">
  <img src="docs/images/logo.png" width="128" alt="Polotno logo">
</p>

<h1 align="center">Polotno</h1>

<p align="center">
  An infinite causal-semantic canvas for Windows 10/11: one person's second brain.<br>
  Cards, cause-and-effect links, groups and semantic zoom on a single surface. Local files only. No accounts, no cloud, no telemetry, no nonsense.
</p>

<p align="center">
  <a href="https://github.com/lemitz/Polotno/releases"><img src="https://img.shields.io/badge/version-0.4.1-8b8cff" alt="Version 0.4.1"></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-0078d4" alt="Windows 10 / 11 x64">
  <img src="https://img.shields.io/badge/built%20with-Tauri%202-24c8db" alt="Tauri 2">
  <img src="https://img.shields.io/badge/frame%20rate-up%20to%20260%20FPS-b7ff00" alt="Up to 260 FPS">
  <img src="https://img.shields.io/badge/telemetry-none-2ea043" alt="No telemetry">
</p>

<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  Try it in the browser first: <a href="https://kobyla.by/polotno.html">kobyla.by/polotno.html</a>
</p>

---

Note apps show you either the details or the big picture. Polotno («canvas» in Russian) puts both on one surface. From far away you see the whole project as a structure, at medium zoom the working cards and their links, up close the full texts and media, right on the canvas, with no modes to switch. Links are causal first: A requires B, B leads to C. It is made for one person who needs to see a project whole and in detail at the same time, so there is no sharing, no collaboration and no kanban for the sake of kanban.

This is the desktop build of the canvas that lives on [kobyla.by](https://kobyla.by/artifacts/polotno). The interface is the same single HTML file with no dependencies. The desktop layer adds what a browser can't do well: data in a real file on disk, a native file type, rendering at the monitor's refresh rate and a proper window. It is built on [Tauri 2](https://tauri.app), so it uses the WebView2 runtime that already ships with Windows instead of bundling a browser engine. The installer is 1.4 MB.

<p align="center">
  <img src="docs/images/canvas.png" width="49%" alt="A canvas with cards and labelled causal links">
  <img src="docs/images/detail.png" width="49%" alt="Close-up: a selected card with its links highlighted">
</p>
<p align="center">
  <img src="docs/images/zoomed-out.png" width="49%" alt="Semantic zoom: far away, cards turn into large titles">
  <img src="docs/images/shortcuts.png" width="49%" alt="The keyboard shortcuts panel">
</p>

## Features

**Canvas**
- Infinite canvas with smooth pan and zoom toward the cursor (4% to 300%), drawn with `translate3d` on `requestAnimationFrame`
- **Semantic zoom** with four levels of detail: full cards → large titles → coloured blocks with headlines → dots. Hover a card far away to see its contents in a tooltip; double-click it to fly there
- Minimap with the current view; drag it to move around
- Cards and links outside the screen are skipped when rendering; a still canvas draws no frames at all

**Cards**
- Eight types: text, Markdown (own lightweight renderer), link, image, video, audio, YouTube, file
- Double-click the background to create a card, double-click a title or text to edit it in place
- `Ctrl+V` turns whatever is on the clipboard into a card: a link, a YouTube video (embedded), an image, plain text (the first line becomes the title)
- Drag files from Explorer onto the canvas: images are downscaled to WebP, `.md` and `.txt` become text cards, other files up to 16 MB are embedded
- Resize from the corner, collapse and expand long texts, duplicate (`Ctrl+D`), select with `Shift+click` or a `Shift`+drag box

**Links and groups**
- Drag from a dot on a card's edge to another card to link them, or into empty space to create a linked card right there
- Every link can have a label (double-click it), the links of a selected card are highlighted
- Groups (`Ctrl+G`): a named frame around cards. Drag the frame to move everything inside; drop a card into a frame to add it, drag it out to remove it

**Canvases and files**
- Several canvases (projects) in one workspace, switched from the menu next to the logo
- The workspace is saved automatically to `%APPDATA%\by.kobyla.polotno\workspace.json`, through a temporary file, so a crash mid-save never leaves a broken file. Pending changes are written before the window closes
- Own file type **`.polotno`**: `Ctrl+S` saves the workspace through the system dialog, `Ctrl+O` opens one. Opening a file asks whether to replace the current workspace or add its canvases next to yours
- Double-click a `.polotno` file in Explorer to open it. Single instance: if Polotno is already running, the file goes to the open window
- `.polotno` is plain JSON in the same format as the export on kobyla.by, so canvases move between the site and the app both ways
- Undo and redo (`Ctrl+Z` / `Ctrl+Shift+Z`), up to 100 steps per canvas

**Everything else**
- Frame rate follows the monitor (about 260 FPS on a 260 Hz display), with a cap at 260 FPS; above that, e.g. on 360 Hz monitors, frames are paced to 260 on average
- The window remembers its size, position and maximized state; the first start is maximized
- External links open in your default browser; embedded files are saved through a dialog
- The browser context menu, `F5` and `Ctrl+R` / `Ctrl+P` are disabled, so the app behaves like an app
- No telemetry and no update checks. The network is only used for what you put on the canvas: YouTube previews and embeds, remote images

## Keyboard shortcuts

| Action | Keys |
|---|---|
| New card | double-click the background, `N` |
| Edit a title or text | double-click it |
| Fly to a card from far away | double-click it |
| Paste text, a link, an image | `Ctrl+V` |
| Pan | `Space` + drag, middle mouse button, drag the background |
| Zoom toward the cursor | mouse wheel, `+` / `-` |
| Link two cards | drag from a dot on the card's edge |
| Select several cards | `Shift+click`, `Shift` + drag a box |
| Group / ungroup | `Ctrl+G` / `Ctrl+Shift+G` |
| Rename a group | double-click its tab |
| Select all / duplicate / delete | `Ctrl+A` / `Ctrl+D` / `Del` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Fit everything / 100% | `1` / `0` |
| Save to a `.polotno` file / open one | `Ctrl+S` / `Ctrl+O` |
| All shortcuts | `?` |

## Installation

Every build produces two flavours:

- **Installer**: `Polotno_<version>_x64-setup.exe` (NSIS). Installs per-user into `%LOCALAPPDATA%\Polotno`, no admin rights needed, registers the `.polotno` file type and adds a Start menu shortcut. Available in English and Russian.
- **Portable**: `Polotno_<version>_x64-portable.exe`, a single executable. It keeps the workspace in `%APPDATA%\by.kobyla.polotno` too, but doesn't register the file type.

Grab them from the [Releases](https://github.com/lemitz/Polotno/releases) page or [build from source](#building-the-installer). Polotno needs the WebView2 Runtime, which is already present on Windows 11 and up-to-date Windows 10 systems; the installer takes care of it if it's missing. The binaries are not code-signed, so Windows SmartScreen may warn the first time: *More info* → *Run anyway*.

On first start you get four demo canvases that describe Polotno itself. To bring canvases over from the website, press *Download JSON* on [kobyla.by/polotno.html](https://kobyla.by/polotno.html) and open the file in the app with `Ctrl+O`.

### About the frame rate

WebView2 renders in step with the monitor, so on a 260 Hz display Polotno runs at 260 FPS and on a 165 Hz one at 165. The page itself caps rendering at 260 FPS (`FRAME_MS` in `src/index.html`). The usual Chromium switches for an unlocked frame rate, `--disable-frame-rate-limit` and `--disable-gpu-vsync`, **don't work in WebView2** and actually drop it to 60 FPS: the first one never reaches the GPU process, the second one switches to a 60 Hz fallback timer. That's why they are off.

The WebView2 switches can be overridden without a rebuild through the `POLOTNO_WEBVIEW_ARGS` environment variable, for example `--remote-debugging-port=9222` to attach Chrome DevTools to the running app.

## Development

Requirements:

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) stable
- The usual [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows (MSVC build tools with the Windows SDK, WebView2)

```bash
npm install
npx tauri dev        # run the desktop app; edits to src/index.html reload the window
```

`src/index.html` also works as a plain web page: without Tauri it falls back to `localStorage` and browser downloads, exactly like on kobyla.by. Open it from any static server to work on the canvas without Rust.

## Building the installer

```bash
npx tauri build
```

- Installer: `src-tauri/target/release/bundle/nsis/Polotno_<version>_x64-setup.exe`
- Portable executable: `src-tauri/target/release/polotno.exe`

The release profile is tuned for size (`opt-level = "s"`, LTO, symbols stripped). The icons are generated from `src/favicon.svg` with `npx tauri icon src/favicon.svg -o src-tauri/icons` (then delete the `android` and `ios` folders and `icon.icns`).

The [Windows workflow](.github/workflows/release.yml) runs for pull requests to `main`, version tags and manual dispatches. It checks that the npm, Rust and Tauri versions match (and match the tag), builds the installer and the portable executable, and uploads both plus `SHA256SUMS.txt` as the `polotno-windows` artifact. **Only a pushed version tag publishes a GitHub Release**, with the text from [`RELEASE_NOTES.md`](RELEASE_NOTES.md):

```bash
git tag -a v0.4.1 -m "Polotno v0.4.1"
git push origin v0.4.1
```

The version lives in three places that must agree: `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

## Project structure

```
src/
  index.html               the whole canvas: styles, markup and script, no dependencies
  fonts/                   Inter and JetBrains Mono (woff2) with their licenses
  favicon.svg              logo, also the source of the app icons
src-tauri/
  src/main.rs              window creation and WebView2 switches, workspace file, file read/write
                           commands, .polotno from the command line, single instance
  tauri.conf.json          window, .polotno file association, NSIS installer
  capabilities/            permissions granted to the main window
  icons/                   app icons generated from favicon.svg
docs/images/               screenshots for this README
.github/workflows/         Windows build and release
```

The split is deliberate: the Rust side knows nothing about cards or links. It reads and writes text and bytes, creates the window and forwards file paths from Explorer. Everything about the canvas lives in `src/index.html`, which stays a drop-in replacement for `polotno.html` on the website.

## Tech stack

[Tauri 2](https://tauri.app) · Rust · vanilla HTML, CSS and JavaScript · WebView2 · [Inter](https://rsms.me/inter/) · [JetBrains Mono](https://www.jetbrains.com/lp/mono/) · NSIS

## License

Polotno is released under the [MIT License](LICENSE). The bundled fonts keep their own license (SIL Open Font License 1.1); see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

<p align="center">
  <img src="https://img.shields.io/badge/Made%20with-AI-8b5cf6" alt="Made with AI"><br>
  <sub>This project was built with the help of AI tools.</sub>
</p>
