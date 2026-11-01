# Polotno v0.5.3

Dragging no longer gets stuck on link cards.

## Changes

- **Link cards can be dragged by their preview.** Before, grabbing a link card by its preview (which covers most of the card) started the browser's own link drag instead of moving the card: the card jerked a few pixels and stopped, and in the desktop app the canvas could stay unresponsive to dragging until the window lost focus. Now the whole card drags as usual, and a plain click on the link still opens it.
- The browser's own drag-and-drop is disabled inside the canvas (files from Explorer are still accepted). A drag interrupted by the window losing focus is ended cleanly.

Installed copies of 0.5.2 offer this update by themselves a few seconds after start.

## Downloads

- `Polotno_0.5.3_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type and updates itself.
- `Polotno_0.5.3_x64-portable.exe`: portable executable, no installation required, no automatic updates.
- `SHA256SUMS.txt`: checksums for both executables. `latest.json` and `.sig` are for the updater.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.5.3_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
