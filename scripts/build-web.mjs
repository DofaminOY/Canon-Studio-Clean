import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One source tree: publish browser assets, never bundle Windows/IPP server code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'public', 'vendor');
const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
fs.mkdirSync(vendor, { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  const input = path.join(pdfjs, name);
  if (!fs.existsSync(input)) throw Error(`Отсутствует ${name}: сначала npm install`);
  fs.copyFileSync(input, path.join(vendor, name));
}
console.log('Web assets готовы в public/. Только статические файлы попадут на Vercel.');
