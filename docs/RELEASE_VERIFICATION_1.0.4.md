# Release verification: Acclectron 1.0.4

Date: 2026-10-18. Platform: Windows x64, Node.js 24.18.0, Electron 44.9.0, electron-builder 26.17.0.

## Completed

- JavaScript syntax checks passed.
- All 110 Node tests passed, including four new print layout tests.
- Official npm registry audit returned zero vulnerabilities, including development/build dependencies. The lockfile uses sharp 0.35.5 and @electron/get 5.1.0; the downloader override removes the vulnerable legacy proxy dependency chain. Installation was also checked with `npm ci --dry-run --ignore-scripts`.
- The official Electron archive matched the SHA-256 supplied by the installed Electron npm package before extraction.
- Renderer smoke tests passed against source, portable application files and the installer's app.asar. Each packaged test compared 43 application source files with the working source.
- Each renderer run verified 15 menu routes, dashboard/database content and the product edit modal using an isolated SQLite database/profile.
- Each renderer run exercised the invoice PDF button through secured IPC for A4, A5, 80 mm and 58 mm in portrait and landscape. PDF headers, nonempty output and actual page dimensions were checked. Thermal paper remains portrait as intended.
- Portable ZIP, SHA-256 and release manifest were rebuilt. The ZIP hash matched its manifest.
- Windows NSIS installer was rebuilt. Its embedded archive passed the 7-Zip integrity test. The reported trailing-data warning is expected for this executable wrapper; all 126 payload files passed.
- CI and `npm run release` now run renderer tests before packaging and repeat them against both packaged applications. CI also audits dependencies and uploads the installer with a checksum.

## Artifacts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Acclectron-1.0.4-portable.zip | 397525652 | `989b5795d4a7c163877d9e8a90196561e798c11fd44dbe041c017abc05c99978` |
| Acclectron-Setup-1.0.4.exe | 305216704 | `1feb8f1b78c9532bc840440f9ef7563119080b7581467f5a1d4a6760f27709f6` |

## Acceptance checks requiring a target environment

These results do not certify physical printer output, a clean Windows installation/upgrade or a full business-day workflow. The installer is unsigned because no signing certificate is configured. PDF tests validate generation and dimensions, not a visual review of every invoice layout. AI inference is outside this smoke test and its status is simulated as unavailable.

Application tests used isolated fixtures and did not modify the user's accounting database. Local diagnostics are under `.tmp-ui-smoke/`; runtime data and diagnostic logs are excluded from this release commit.
