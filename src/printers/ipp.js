import http from 'node:http';
import { PRINTER_IP } from '../config.js';
import { parseIPPResponse } from '../protocol/ipp-parser.js';

// IPP protocol encoder/client. Never called from the browser.

export function attrString(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  if (bytes.length > 65535) throw Error('Слишком длинный IPP-атрибут.');
  const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function ippAttr(tag, name, value) {
  return Buffer.concat([Buffer.from([tag]), attrString(name), attrString(value)]);
}

export function ippInt(tag, name, value) {
  const n = Buffer.alloc(4); n.writeInt32BE(value);
  const key = Buffer.from(name, 'utf8');
  const len = Buffer.alloc(2); len.writeUInt16BE(key.length);
  return Buffer.concat([Buffer.from([tag]), len, key, Buffer.from([0, 4]), n]);
}

export function ippBody(operation, extra = [], file = null) {
  const uri = `ipp://${PRINTER_IP}:631/ipp/print`;
  return Buffer.concat([
    Buffer.from([1, 1, 0, operation, 0, 0, 0, 1, 1]),
    ippAttr(0x47, 'attributes-charset', 'utf-8'),
    ippAttr(0x48, 'attributes-natural-language', 'en'),
    ippAttr(0x45, 'printer-uri', uri),
    ...extra,
    Buffer.from([3]),
    ...(file ? [file] : []),
  ]);
}

export function sendIPP(body, task = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: PRINTER_IP, port: 631, path: '/ipp/print', method: 'POST', agent: false, timeout,
      headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length, Connection: 'close' },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const data = Buffer.concat(chunks);
        if (response.statusCode !== 200 || !String(response.headers['content-type']).includes('application/ipp') || data.length < 8) {
          reject(Error(`Сервер Canon ответил HTTP ${response.statusCode} вместо IPP.`)); return;
        }
        const parsed = parseIPPResponse(data);
        if (parsed.status >= 0x0100) {
          reject(Error(`IPP отклонил команду: 0x${parsed.status.toString(16).padStart(4, '0')}`)); return;
        }
        resolve(parsed);
      });
    });
    if (task) task.httpRequest = request;
    request.on('timeout', () => request.destroy(Error('Принтер не ответил вовремя.')));
    request.on('error', reject);
    request.end(body);
  });
}

export async function ippCancel(id) {
  if (!Number.isInteger(id) || id <= 0) throw Error('Некорректный IPP job-id.');
  const body = ippBody(0x08, [
    ippInt(0x21, 'job-id', id),
    ippAttr(0x42, 'requesting-user-name', 'CanonStudio'),
  ]);
  return sendIPP(body, null, 10000);
}
