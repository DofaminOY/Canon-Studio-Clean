# Canon Studio 4.2 — Agent Pairing + Windows Installer Preview

## What's new
- Explicit website-to-agent pairing with local one-time 8-digit code (5-minute expiration)
- Rate-limited PIN guesses, 12-hour origin-bound sessions, revocation
- Cross-origin APIs now deny printer status and print requests before pairing
- Local Windows tray runner with first-run printer IP settings stored in AppData
- Inno Setup installer source and build script with embedded Node runtime
- GitHub Actions manual workflow for an unsigned Windows installer artifact
- Regression and security tests; see docs/agent.md

## Installation on top of 4.1
1. Unpack the archive into the root of your existing Canon-Studio-Clean checkout, retaining .git and package-lock.json.
2. Run `npm install`, `npm run check`, `npm run build:web`, `npm test`.
3. Test local printing on Windows before publishing.
4. Commit the source and package-lock.json; push to main.
5. Run the manual `Build Windows Agent Preview` GitHub Actions workflow to generate the unsigned .exe on Windows.

## Remaining work
- Unsigned preview, not tested on a physical Windows printer
- Poppler/SumatraPDF/LibreOffice not yet bundled for public redistribution
- Windows printer discovery restricted to Canon TS5350i; more device support planned
- Remote printing from another computer not implemented
- No guarantee of a bypass for browser local-network restrictions
