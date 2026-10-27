# Canon Studio 4.0 — local print manager

Node.js 22+ | Windows 10/11 | Canon TS5350i series | IPP / Windows Print Spooler

**Local-only application.** Runs at `http://127.0.0.1:3177`, does not print from Vercel cloud. Printer must be on the same Wi-Fi network. Do not expose the local server to the public internet.

## Install

```powershell
npm install
npm run check
npm test
npm start
```

Open `http://127.0.0.1:3177`. Browser cache: Ctrl+F5.

### External tools on Windows

- Canon TS5350i driver + Print Spooler service (must be Running)
- SumatraPDF executable for PDF/Office print via Windows
- Poppler (`pdftoppm.exe`) for PDF tone adjustment or rasterized JPEG IPP
- LibreOffice for DOC/DOCX/ODT/XLS/XLSX/ODS/PPT/PPTX conversions; TXT uses PDFKit

`POPPLER_BIN` can point to Poppler's `Library\bin` folder. Winget installation: `winget install -e --id oschwartz10612.Poppler`.

Windows session example:

```powershell
$env:CANON_IP = '192.168.2.28'
$env:POPPLER_BIN = 'C:\your-poppler-path\Library\bin'
$env:SUMATRA_PDF_PATH = 'C:\your-SumatraPDF-path\SumatraPDF.exe'
npm start
```

## Architecture

- `public/index.html` — semantic, responsive HTML only (no inline JavaScript)
- `public/assets/css/main.css` — layout and responsive styles
- `public/assets/js/app.js` — event composition/initialization
- `public/assets/js/{state,files,api,dom,settings,preview,printers}.js` — frontend feature modules
- `src/index.js` — minimal server startup
- `src/config.js` — central configuration
- `src/http/` — allowlisted static assets, API routing, local-session protection
- `src/printers/` — IPP protocol and Windows Print Spooler adapters
- `src/jobs/` — tasks lifecycle, validation, print engine, cancellation
- `src/documents/` — supported formats, PDF conversion, Poppler+Sharp effects
- `src/protocol/ipp-parser.js` — IPP response parser
- `tests/` — local automated regression and API smoke tests

## Safety and functionality

- Input files limited to 20 MB; server validates types, pages, print settings and printer selection.
- Printing only starts after confirmation; active tasks are in memory and lost on restart.
- `Print-Job` via IPP is device-specific; a submitted job is not proof of a physically completed print.
- Ink percent is unknown because the device does not expose it via the current IPP attributes.
- Printer enumeration is currently limited to Canon TS5350i series; universal printers are not supported.
- For PDF with tone/quality adjustment: Poppler renders pages, Sharp applies tone; one-sided small jobs use direct IPP, other modes Windows/SumatraPDF.
- Fallback to printing uncorrected PDF is explicitly reported to the user.
- Some complex PDFs may lose searchable text during rasterization. Do not process sensitive documents on a shared or public host.

## Diagnostics

```powershell
Get-Service Spooler
pdftoppm -v
Get-Printer | Select-Object Name
npm audit
```

**Tests are not a physical printer certification.** Verify single-sheet PDF, TXT, image, cancellation, paper sizes and duplex on your device before a release.

## First-time GitHub use

The ZIP deliberately excludes `node_modules`, backups, update ZIPs, private files and Git history. `npm install` will create `package-lock.json`; **commit that lockfile** to the repository to lock dependency versions. Before the first public push, choose a license and check `npm audit` findings. The included `.github/workflows/ci.yml` runs syntax and integration tests on Ubuntu with Poppler; Windows driver printing remains a manual acceptance test.

To inspect an old local project before deleting previously generated backups:

```powershell
.\scripts\cleanup-old.ps1 -OldProject 'G:\IT\Node.JS\canon_TS5350i Studio\_canon_studio_v2'
```

To actually delete **only the listed backups/update ZIPs** after validating the new release:

```powershell
.\scripts\cleanup-old.ps1 -OldProject 'G:\IT\Node.JS\canon_TS5350i Studio\_canon_studio_v2' -Apply
```

The cleanup script never deletes your existing `src`, `public`, `package.json` or files of unknown origin.
