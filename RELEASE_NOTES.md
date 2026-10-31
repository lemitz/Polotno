# Polotno v0.4.1

First Windows 10/11 x64 release of Polotno, the infinite causal-semantic canvas from [kobyla.by](https://kobyla.by/artifacts/polotno), as a desktop app.

## What's inside

- The same canvas as on the website: cards of eight types, causal links with labels, groups, semantic zoom, minimap, paste anything with `Ctrl+V`, undo and redo, several canvases in one workspace. The four demo canvases open on first start.
- **Data on disk.** The workspace is saved automatically to `%APPDATA%\by.kobyla.polotno\workspace.json` with atomic writes; pending changes are written before the window closes. No 5 MB browser storage limit: embedded files up to 16 MB each.
- **`.polotno` file type.** `Ctrl+S` saves the workspace through the system dialog, `Ctrl+O` opens one; double-clicking a `.polotno` file in Explorer opens it in the running window. The format is the same JSON as the export on kobyla.by.
- **Frame rate up to 260 FPS.** Rendering follows the monitor's refresh rate, capped at 260 FPS.
- The window remembers its size and position; links open in the default browser.

## Downloads

- `Polotno_0.4.1_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type.
- `Polotno_0.4.1_x64-portable.exe`: portable executable, no installation required.
- `SHA256SUMS.txt`: checksums for both executables.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.4.1_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
