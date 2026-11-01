# Third-party notices

Polotno itself is released under the [MIT License](LICENSE). It bundles or links the following third-party components, which keep their own licenses.

## Fonts (shipped in `src/fonts/`, embedded in the executable)

| Component | Files | License |
|---|---|---|
| [Inter](https://github.com/rsms/inter), © The Inter Project Authors | `inter-*-wght-normal.woff2` | SIL Open Font License 1.1, see [`src/fonts/INTER-LICENSE.txt`](src/fonts/INTER-LICENSE.txt) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © The JetBrains Mono Project Authors | `jetbrains-mono-*-wght-normal.woff2` | SIL Open Font License 1.1, see [`src/fonts/JETBRAINS-MONO-LICENSE.txt`](src/fonts/JETBRAINS-MONO-LICENSE.txt) |

The fonts are the unmodified variable-weight Latin and Cyrillic subsets from the official packages. Under the OFL they may be bundled with software, but not sold on their own.

## Runtime (compiled into the executable)

| Component | License |
|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) 2 and the official plugins `dialog`, `opener`, `single-instance`, `window-state`, `updater`, `process` | MIT or Apache-2.0 |
| [serde](https://github.com/serde-rs/serde), [serde_json](https://github.com/serde-rs/json) | MIT or Apache-2.0 |
| [base64](https://github.com/marshallpierce/rust-base64) | MIT or Apache-2.0 |
| [reqwest](https://github.com/seanmonstar/reqwest), [rustls](https://github.com/rustls/rustls) (link previews, updates) | MIT or Apache-2.0 (rustls also ISC) |
| [ring](https://github.com/briansmith/ring) (cryptography for rustls) | Apache-2.0 AND ISC |
| [zip](https://github.com/zip-rs/zip2) (`.polotno` container) | MIT |
| [windows](https://github.com/microsoft/windows-rs) (PDF previews via `Windows.Data.Pdf`) | MIT or Apache-2.0 |

These crates pull in further dependencies, all under permissive licenses (mostly MIT / Apache-2.0); the full list is in `src-tauri/Cargo.lock`.

## Not bundled

- **Microsoft Edge WebView2 Runtime** draws the interface. It is part of Windows and is not shipped with Polotno; if it is missing, the installer downloads Microsoft's bootstrapper, which is covered by Microsoft's own terms.
- **NSIS** builds the installer; its runtime code inside the installer is under the zlib/libpng license.
