# Security and privacy

## What Polotno promises, and what it does not

Polotno is a second brain, so what you put on a canvas can be very personal. It is built so that your canvases **stay on your computer**:

- There is no account, cloud sync, telemetry, analytics or crash reporting. Canvases, attachments and backups are files in `%APPDATA%\by.kobyla.polotno` and nowhere else.
- The network is used only for link previews (the app downloads the page and its picture when you paste a link or press *Load preview*), YouTube thumbnails and the player, and the update check. The fonts ship with the app.
- The installed version checks `latest.json` on GitHub Releases a few seconds after start. An update is installed only if its minisign signature matches the public key in `tauri.conf.json`. The portable version never checks.
- Opening a `.polotno` file unpacks its attachments only into the attachments folder, under safe names, and never overwrites an existing file. Canvas ids and attachment names are checked before they become file names.

What Polotno does **not** do:

- Nothing is **encrypted**. Canvases and backups are plain JSON, attachments are plain copies of the original files. Anyone who can read your Windows profile can read them; protect it with a password and disk encryption.
- **Deleting is not instant.** Backups keep the last 40 snapshots plus one per day for 30 days, and an attachment is removed only when no canvas and no backup refers to it anymore.
- **`.polotno` and JSON exports** are ordinary files with everything in them, attachments included. Share them only with people you mean to.
- **Files from other people** deserve the same care as any download. *Open* on an attachment starts it with the program Windows assigns to its type, so an attachment inside someone else's `.polotno` is exactly as safe as the same file from an email. A canvas you open can also show pictures and YouTube thumbnails from the internet, which tells those servers your IP address.
- Link previews are fetched by the app from any address you paste, including addresses on your local network.
- The binaries are **not code-signed**. Check a download against `SHA256SUMS.txt` from the same release.

## Reporting a problem

The canvas page can read and write files through the app, so a script that gets into it has the same power as Polotno itself. If you find a way for a crafted `.polotno` or `.json` file, a link preview or a web page to run script in the app, for a canvas to read or write files outside the data folder and the paths you pick yourself, for the app to send data off the computer without you asking, or for an unsigned update to be installed, please report it **privately** through [GitHub security advisories](https://github.com/lemitz/Polotno/security/advisories/new) rather than a public issue. Do not attach real canvases or backups to any report.
