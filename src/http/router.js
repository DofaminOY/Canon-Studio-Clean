import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HOST, PORT, ROOT, TOKEN, PRINTER_IP } from '../config.js';
import { reply, bodyOf, postAllowed } from './helpers.js';
import { getPrinters, getJobs, removeJob } from '../printers/windows.js';
import { sendIPP, ippBody } from '../printers/ipp.js';
import { MAX_UPLOAD_BYTES, fileKind } from '../documents/print-utils.js';
import { checkFileSignature, convertImageToJpeg, convertTextToPdf, convertOfficeToPdf } from '../documents/document-tools.js';
import { currentTask, recentTasks, publicTask } from '../jobs/store.js';
import { handlePrint, cancelTask } from '../jobs/requests.js';

// Routes preserve the v3.2 frontend API. The server binds only to localhost.
export function createServer() {
  return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" });
      return res.end(html);
    }

    // Frontend assets: only explicitly constrained paths under public/assets.
    if (req.method === 'GET' && /^\/assets\/(css|js)\/[a-z-]+\.(css|js)$/.test(url.pathname)) {
      const relative = url.pathname.substring(1);
      const base = path.join(ROOT, 'public', 'assets');
      const filename = path.resolve(ROOT, 'public', relative);
      if (!filename.startsWith(base + path.sep) || !fs.existsSync(filename)) {
        return reply(res, 404, { error: 'Ресурс не найден.' });
      }
      res.writeHead(200, {
        'Content-Type': filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      });
      return fs.createReadStream(filename).pipe(res);
    }

    // Локальные модули PDF.js: открываем только два заранее известных файла.
    if (req.method === 'GET' && (url.pathname === '/vendor/pdf.mjs' || url.pathname === '/vendor/pdf.worker.mjs')) {
      const name = url.pathname === '/vendor/pdf.mjs' ? 'pdf.mjs' : 'pdf.worker.mjs';
      const modulePath = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', name);
      if (!fs.existsSync(modulePath)) {
        return reply(res, 503, { error: 'Не установлен pdfjs-dist. Выполни: npm install pdfjs-dist@5.4.530' });
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      return fs.createReadStream(modulePath).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return reply(res, 200, { token: TOKEN, ip: PRINTER_IP, limit: MAX_UPLOAD_BYTES });
    }
    if (req.method === 'GET' && url.pathname === '/api/printers') {
      return reply(res, 200, { printers: await getPrinters() });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const parsed = await sendIPP(ippBody(11), null, 7000);
      const a = parsed.attributes;
      const first = (key, fallback = null) => a[key]?.[0] ?? fallback;
      return reply(res, 200, {
        online: true, model: first('printer-make-and-model', 'Canon TS5350i'),
        state: ({ 3: 'Готов', 4: 'Печатает', 5: 'Остановлен' })[first('printer-state')] || 'Неизвестно',
        jobs: first('queued-job-count', 0), accepting: first('printer-is-accepting-jobs', false),
        reasons: a['printer-state-reasons'] || [], ink: 'Уровень неизвестен',
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      return reply(res, 200, { active: currentTask?.id || null, tasks: recentTasks.slice(0, 6).map(publicTask) });
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const printer = String(url.searchParams.get('printer') || '');
      if (!(await getPrinters()).includes(printer)) return reply(res, 400, { error: 'Выбери установленный Canon.' });
      return reply(res, 200, { jobs: await getJobs(printer) });
    }
    if (req.method === 'POST') {
      if (!postAllowed(req)) return reply(res, 403, { error: 'Запрос запрещён: требуется сеанс Canon Studio.' });
      if (url.pathname === '/api/preview-image') {
        const name = String(url.searchParams.get('name') || '');
        if (fileKind(name) !== 'image') return reply(res, 400, { error: 'Нужен файл изображения.' });
        const body = await bodyOf(req);
        checkFileSignature(body, name);
        const density = Number(url.searchParams.get('density') || 0);
        const contrast = Number(url.searchParams.get('contrast') || 0);
        const color = String(url.searchParams.get('color') || 'color');
        if (!Number.isInteger(density) || Math.abs(density) > 50 ||
            !Number.isInteger(contrast) || Math.abs(contrast) > 50 ||
            !['color', 'monochrome'].includes(color)) {
          return reply(res, 400, { error: 'Неверные параметры изображения.' });
        }
        const jpeg = await convertImageToJpeg(body, { color, density, contrast }, true);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(jpeg);
      }
      if (url.pathname === '/api/preview-office') {
        const name = String(url.searchParams.get('name') || '');
        if (fileKind(name) !== 'office') return reply(res, 400, { error: 'Нужен офисный документ.' });
        const body = await bodyOf(req);
        checkFileSignature(body, name);
        const pdf = /\.txt$/i.test(name) ? await convertTextToPdf(body) : await convertOfficeToPdf(body, name);
        // До печати браузер получит PDF для перелистывания и подсчёта страниц.
        if (pdf.length > MAX_UPLOAD_BYTES) return reply(res, 413, { error: 'PDF после преобразования больше 20 МБ.' });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
        return res.end(pdf);
      }
      if (url.pathname === '/api/print') return await handlePrint(req, res, url);
      if (url.pathname === '/api/task/cancel') {
        const payload = JSON.parse((await bodyOf(req, 5000)).toString('utf8'));
        return reply(res, 200, { task: await cancelTask(String(payload.id || '')) });
      }
      if (url.pathname === '/api/jobs/cancel') {
        const payload = JSON.parse((await bodyOf(req, 5000)).toString('utf8'));
        const printer = String(payload.printer || '');
        const id = Number(payload.id);
        if (!(await getPrinters()).includes(printer) || !Number.isInteger(id) || id < 1) {
          return reply(res, 400, { error: 'Некорректное задание печати.' });
        }
        const jobs = await getJobs(printer);
        if (!jobs.some((j) => j.id === id)) return reply(res, 404, { error: 'Задание уже отсутствует в очереди.' });
        await removeJob(printer, id);
        return reply(res, 200, { message: `Windows принял команду удаления задания №${id}.` });
      }
    }
    reply(res, 404, { error: 'Ресурс не найден.' });
  } catch (error) {
    reply(res, error.message.includes('20 МБ') ? 413 : /В документе|Диапазон|неверн|Ошибк|используется|LibreOffice|Провер|Файл|страниц|файл|Некоррект|Подготов|формат/i.test(error.message) ? 400 : 500, { error: error.message });
  }
});
}
