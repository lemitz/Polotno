# Polotno v0.5.0

A big update of the Windows app: several windows, attachments of any size, backups, previews, exports, other views of the canvas, link suggestions, a WebGL renderer for huge canvases and automatic updates.

## What's new

- **Several windows.** Any canvas opens in its own window from the canvas menu, so canvases can sit on different monitors. Each canvas is now stored in its own file, so windows never overwrite each other.
- **Search** (`Ctrl+F`) over titles, texts, link previews, file names, link labels and group names, with matches highlighted on the canvas; optionally across all canvases.
- **Backups** (`Ctrl+H`): snapshots at start-up and every 10 minutes when something changed; restore one canvas as a copy or roll everything back.
- **Link and PDF previews**: page title, description and picture for links (stored locally); first page and page count for PDFs, rendered by Windows.
- **Attachments as files**: pictures, video, audio, PDF and other files are copied into the attachments folder instead of being embedded, with no size limit. `.polotno` is now a zip with the workspace and its attachments; old JSON `.polotno` files still open.
- **Presentation mode** (`P`): walk the causal route like slides, full screen.
- **Export**: PNG and SVG of the whole canvas or the selection (or a group), Markdown for Obsidian, JSON for kobyla.by.
- **Other views** (`Shift+1…4`): list, timeline and graph, plus "lay out the canvas like the graph".
- **Link suggestions** (`L`): heuristic hints for links you haven't made yet, each with a reason.
- **WebGL rendering for huge canvases**: far zoom on canvases with 150+ cards is drawn by the GPU. On 3,000 cards panning went from about 20 FPS to about 250 FPS; close zoom on the same canvas went from 42 to 133 FPS.
- **Automatic updates** for the installed version, signed and verified. This is the first release that has them: from now on new versions arrive by themselves.

## Upgrading from 0.4.1

Install over the old version. On first start the workspace is split into per-canvas files (the old file is kept as `workspace.v041.json`) and embedded pictures move into the attachments folder.

## Downloads

- `Polotno_0.5.0_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type and updates itself.
- `Polotno_0.5.0_x64-portable.exe`: portable executable, no installation required, no automatic updates.
- `SHA256SUMS.txt`: checksums for both executables. `latest.json` and `.sig` are for the updater.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.5.0_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
