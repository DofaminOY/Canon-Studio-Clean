import { MAX_UPLOAD_BYTES } from '../documents/print-utils.js';
import { TOKEN } from '../config.js';
import { allowedOrigin, safeLoopbackHost } from './origins.js';

// Explicit response/stream limits and same-origin session guard.

export function reply(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

export function bodyOf(req, max = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let rejected = false;
    req.on('data', (piece) => {
      if (rejected) return;
      length += piece.length;
      if (length > max) {
        rejected = true;
        reject(Error('Файл превышает лимит 20 МБ.'));
        // Drain instead of destroying the socket so client gets JSON response.
        return;
      }
      chunks.push(piece);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!rejected) reject(error); });
    req.on('aborted', () => { if (!rejected) reject(Error('Передача файла прервана.')); });
  });
}

export function postAllowed(req) {
  return safeLoopbackHost(req.headers.host) && req.headers['x-canon-token'] === TOKEN &&
    (!req.headers.origin || allowedOrigin(req.headers.origin));
}
