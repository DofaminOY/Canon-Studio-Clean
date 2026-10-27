# Architectural decisions

1. **Vanilla JavaScript ES modules.** Avoid an unnecessary frontend framework/build tool for this single-page local print manager. HTML, CSS and behavior are separate.
2. **Local Node service.** Windows Print Spooler and LAN IPP require access to the user's PC/network and cannot be moved directly to Vercel functions.
3. **Independent adapters.** Windows queue operations and IPP network operations are isolated for easier device support and mock tests.
4. **Poppler as server PDF rasterizer.** Server PDF.js + Canvas previously threw `Path2D`/`CanvasFillRule` errors. Browser PDF.js remains for interactive preview only; backend page counts and rendering use Poppler utilities.
5. **Sharp tone changes.** Density and contrast are software image processing, not direct Canon ink dosing. Neutral 0/0 means no pixel tone adjustment.
6. **In-memory job queue.** No DB needed initially. History resets on restart; cancellation is best-effort once a job reaches the printer.
7. **Security scope.** Server binds to localhost, checks a per-process session token and does not expose printer commands to other devices. A future remote agent needs proper pairing/authentication and threat review.
