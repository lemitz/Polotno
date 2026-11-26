# Polotno v0.6.0

This release hardens external links and link previews, and adds regression coverage for workspace files, storage paths and backups.

## Security and link previews

- **External URLs are validated before navigation.** Markdown links and link cards accept only credential-free `http:`, `https:` or `mailto:` URLs. Control characters and whitespace are rejected, and desktop clicks are intercepted so untrusted anchors cannot navigate the app's WebView; approved links go through the system opener.
- **Link previews are protected against SSRF.** Preview URLs must be credential-free HTTP(S), DNS results are checked and pinned to public addresses, and proxy settings are bypassed. Redirects are followed manually and every hop is revalidated, preventing redirects to localhost, private, link-local, reserved or other non-public IPv4/IPv6 addresses. Redirect count and response sizes are bounded.
- **Preview images must be verified raster formats.** The MIME type and file signature must match supported PNG, JPEG, GIF, WebP or AVIF data before the image is stored. SVG and other unsupported image types are not persisted, preventing active SVG content from being treated as a safe preview.

## Storage and backup fixes and tests

- `.polotno` import now has regression tests for legacy JSON compatibility, malformed ZIPs, invalid UTF-8, normal workspace and attachment entries, and rejection of traversal or nested attachment paths.
- Store and path tests cover valid project IDs and reject unsafe project and backup IDs. Atomic-write tests verify successful replacement, preserve existing data on failures, and ensure temporary files are cleaned up.
- Backup tests verify retention of the newest 40 snapshots plus one per recent day, and confirm that restoring a workspace keeps a complete pre-restore snapshot that can itself be restored. The retention logic avoids keeping older same-day snapshots as extra daily entries.

## Previous release: v0.5.3

Dragging no longer gets stuck on link cards.

- Link cards can be dragged by their preview; a plain click still opens the link.
- The browser's own drag-and-drop is disabled inside the canvas (files from Explorer are still accepted). A drag interrupted by the window losing focus is ended cleanly.

At the time, installed copies of 0.5.2 offered v0.5.3 by themselves a few seconds after start.

## Downloads from v0.5.3

- `Polotno_0.5.3_x64-setup.exe`: per-user NSIS installer, no admin rights needed; registers the `.polotno` file type and updates itself.
- `Polotno_0.5.3_x64-portable.exe`: portable executable, no installation required, no automatic updates.
- `SHA256SUMS.txt`: checksums for both executables. `latest.json` and `.sig` are for the updater.

The binaries are not code-signed, so Windows SmartScreen may show a warning. Polotno requires the Microsoft Edge WebView2 Runtime (included on Windows 11 and most up-to-date Windows 10 systems; the installer installs it if needed).

To verify a download in PowerShell, run `Get-FileHash .\Polotno_0.5.3_x64-setup.exe -Algorithm SHA256` and compare the result with `SHA256SUMS.txt`.
