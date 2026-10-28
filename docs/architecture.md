# Architecture & development guide

## Request flow

```text
Browser (public/assets/js)
  -> http/router.js + helpers.js
      -> jobs/requests.js -> documents/* validation
          -> jobs/print-engine.js
              -> printers/ipp.js          (JPEG or processed short PDF)
              -> printers/windows.js      (PDF via SumatraPDF)
          -> jobs/store.js                (in-memory status and cancel)
```

## Responsibilities

`index.html` is markup, CSS owns layout, JS feature files own client logic. The backend routers know HTTP but not PDF details. `jobs/requests.js` validates requests; `print-engine.js` does printing; `documents/` does format transformation and tone effects. `printers/` owns platform/protocol adapters.

## Main invariants

1. Browser preview is **advisory**; server always checks supplied file, format, page ranges and printer name.
2. If page count cannot be determined, only **all pages** may print. No guessed ranges.
3. No print without POST from the local session token. The server binds `127.0.0.1` only.
4. Never report **physically printed** when device/driver confirms only **accepted** or **submitted**.
5. Temporary document data must be cleaned after conversion. Do not log document contents.
6. Cancelling a submitted job is best effort. Never silently retry a partially accepted multi-page IPP task.
7. When Poppler correction fails, original PDF may print via Windows, but client must show explicit correction warning.

## Extending device support

Currently `validateSettings` and `getPrinters` whitelist Canon TS5350i. Add a printer capabilities adapter and tests first; do not remove the whitelist without also verifying IPP formats, media, color, duplex and cancel semantics.

## QA before release

```powershell
npm run check
npm test
npm audit
```

Manually test with a **single sheet** for PDF standard, corrected PDF, image, TXT, duplex, and cancellation. Run cross-browser responsive checks. Test on actual Windows; Linux mocks cannot certify the Windows spooler.

## Vercel and local agent

`vercel.json` builds static `public/` assets; it does not deploy the Node.js printer engine. `connection.js` switches between the browser-only experience and an explicitly initiated loopback-agent connection. The browser can select files without an agent. PDF.js browser modules are copied to `public/vendor` by `npm run build:web` and are served by the local router under the same URLs. Unsupported Office browser preview requires an agent/desktop application.

The Node.js agent listens only at loopback. `/api/health` is used for manual availability checks and `/api/discovery` lists installed printers and tests the *configured* IPP endpoint only. Cross-origin requests are accepted only from exactly one trusted HTTPS origin supplied via `CANON_STUDIO_ALLOWED_ORIGIN`; CSRF token + Origin checks protect POST operations. Browser LNA permission is separately required. A remote computer/mobile on a different network cannot directly reach this loopback address — a separately authenticated relay would be necessary.

The cloud UI MUST NOT silently scan private networks or expose arbitrary printer IP configuration. Do not wildcard CORS or publish the agent port to the Internet.
