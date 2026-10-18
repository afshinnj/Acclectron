# Acclectron 1.0.4

- Fixed renderer bindings for management menus, invoice defaults, settings navigation and dashboard events.
- Updated Electron to 44.9.0 and refreshed dependencies; pinned the artifact downloader to remove the vulnerable legacy proxy dependency chain. Requires Node.js 24 for development and packaging.
- Corrected PDF margin options and validated printer copy counts.
- Added isolated renderer and invoice PDF checks to release automation, including verification of the portable package contents.
- Rebuilt portable and Windows installer packages from the corrected source.

Automated PDF tests cover A4, A5, 80 mm and 58 mm in both orientations. Physical printer output and installation on a clean Windows machine require separate acceptance checks.
