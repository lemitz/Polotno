# Polotno v0.5.1

A small fix for the presentation mode.

## Changes

- **The presentation bar keeps the same width on every slide.** Before, it grew and shrank with the caption, so the *Back* and *Next* buttons jumped around under the mouse. Now the bar is a fixed width, a long caption is cut with an ellipsis (hover it to read it in full), and the slide counter takes a constant space.

Installed copies of 0.5.0 offer this update by themselves a few seconds after start.

## Downloads

- `Polotno_0.5.1_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type and updates itself.
- `Polotno_0.5.1_x64-portable.exe`: portable executable, no installation required, no automatic updates.
- `SHA256SUMS.txt`: checksums for both executables. `latest.json` and `.sig` are for the updater.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.5.1_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
