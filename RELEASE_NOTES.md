# Polotno v0.5.2

Automatic updates now work wherever Polotno is installed.

## Changes

- **Updates for any install folder.** 0.5.0 and 0.5.1 only recognised an installation in the default folder (`%LOCALAPPDATA%\Polotno`). Installed anywhere else, for example on another drive, the app took itself for the portable version and never checked for updates. Now an installation is recognised by the uninstaller next to the program, so updates work in any folder.

If you installed 0.5.0 or 0.5.1 into a folder of your own, install this version by hand once, over the old one (the installer remembers your folder). From then on updates arrive by themselves.

## Downloads

- `Polotno_0.5.2_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type and updates itself.
- `Polotno_0.5.2_x64-portable.exe`: portable executable, no installation required, no automatic updates.
- `SHA256SUMS.txt`: checksums for both executables. `latest.json` and `.sig` are for the updater.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.5.2_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
