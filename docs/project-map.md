# Project map

- `src/index.js` — startup only
- `src/config.js` — local binding, IP, limits, token
- `src/http/router.js` — static/API HTTP routes
- `src/http/helpers.js` — JSON, body limit and origin
- `src/printers/windows.js` — PowerShell + Sumatra path
- `src/printers/ipp.js` — IPP serializer and client
- `src/protocol/ipp-parser.js` — IPP decoder
- `src/jobs/store.js` — active/history task state
- `src/jobs/requests.js` — submit, validate, cancel
- `src/jobs/print-engine.js` — PDF/JPEG print flows
- `src/documents/document-tools.js` — file checking/conversions
- `src/documents/print-effects.js` — Poppler/Sharp tone
- `src/documents/print-utils.js` — settings and page validation
- `public/assets/js/*` — feature-specific frontend JS modules
- `public/assets/css/main.css` — responsive UI
- `tests/*` — automated regression checks
