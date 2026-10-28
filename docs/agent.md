# Canon Studio Agent 1.0 — first secure Windows installer preview

## What is implemented

- The locally served site (`http://127.0.0.1:3177`) includes **Show pairing code** and **Revoke all sites**.
- Pairing codes are random eight-digit codes, one-time only, expire after five minutes, and are not available to cross-origin pages.
- A single explicitly configured HTTPS origin can exchange that code for a random, memory-only, origin-bound session (12 hours maximum). Repeated invalid guesses are rate-limited.
- All privileged remote API calls require the paired session token; CORS permission by itself no longer grants printer control.
- Full existing local routes, IPP, Windows Spooler, PDF/photo processing, queues and cancellation are preserved.
- Windows tray launcher starts embedded Node.js without an interactive terminal, with a user-scoped configuration file and a Start Menu shortcut.
- Inno Setup packaging sources and a Windows GitHub Actions build workflow are included.

## Build on Windows x64

1. Install Node.js 22+ x64 and Inno Setup 6 **on the build computer**. End users don't need them.
2. `npm install` and `npm run check` and `npm test`.
3. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1`.
4. The unsigned installer is generated at `dist\installer\CanonStudioAgent-Setup.exe` when build tools and dependency installations succeed.
5. On a clean Windows test VM, install the agent to the current user's profile; verify shortcuts, tray icon, browser link, Windows Spooler, IPP and PDF.

Inno Setup compiles on Windows, not on the Linux test container. No signed/production installer has yet been produced or physically tested.

## Connecting the cloud website

1. Install/run Canon Studio Agent on the **same Windows computer** as the browser.
2. Open the local page `http://127.0.0.1:3177` and click **Показать код подключения**.
3. Open `https://canon-studio-clean.vercel.app` and click **Подключить локальный агент**.
4. Grant any required browser localhost/network permission and enter the eight-digit code.
5. Select a Windows printer and explicitly confirm each print job.
6. To revoke access, go back to the local page and click **Отключить все сайты**, or exit the tray program.

The pairing code is never transmitted via Vercel. The selected file goes from the browser directly to the local agent on the same computer, not to the Vercel server. If the browser disallows HTTPS-to-loopback access, use the local page instead. No remote printing from a second device is implemented.

## Security / compatibility constraints

- The agent binds only to `127.0.0.1`; there is no inbound Internet listener or open remote management API.
- Host and allowed origin are validated; no wildcard CORS or secret in the Vercel deployment.
- Tokens and PINs are ephemeral and lost on agent restart. The current version has a single paired session per allowed origin.
- The Windows tray writes `settings.json` in `%APPDATA%\CanonStudioAgent` (not the repository) and owns only its own child Node process.
- `settings.json` lets the local user select the allowed website origin and the IP of their Canon device. Restart agent after edits. No automatic arbitrary LAN scanning is implemented yet.
- Windows printer enumeration still supports the tested Canon TS5350i series only; generic USB/Wi-Fi printer drivers and automatic provisioning are subsequent milestones.
- Poppler, SumatraPDF and LibreOffice are NOT bundled into this preview installer. Their availability and third-party license terms must be reviewed before a fully self-contained public installer; without them some document paths are limited.
- The unsigned installer can trigger Windows SmartScreen warnings. Sign it and test on a clean Windows installation before public release.
- An `npm audit` high-severity advisory in the earlier dependency set has not been verified resolved; run `npm audit` before shipping.

## Planned follow-ups

1. Interactive Windows printer selection and capability discovery (replace hard-coded model list after testing more devices).
2. Windows-native tray/installer UI polish, native logs, genuine per-job confirmation and stronger pairing UI (avoid browser prompt).
3. Automated installer signing, update verification and release workflow.
4. Optional remote print relay with authenticated users, device-bound keys and explicit per-printer consent.
