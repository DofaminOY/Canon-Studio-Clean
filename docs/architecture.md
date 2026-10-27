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

## Vercel

Vercel can host the frontend separately, but its cloud functions **cannot** directly reach an arbitrary local printer at `192.168.x.x` and cannot use desktop SumatraPDF or the user's Windows Spooler. A separate local agent with explicit pairing/authentication would be required. Do not expose this localhost server on the public network as a shortcut.
