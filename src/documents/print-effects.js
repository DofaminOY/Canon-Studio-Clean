import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Единая формула коррекции тона для фотографий и страниц документов.
// При 0/0 изображение остаётся неизменным (gain=1, bias=0).

export const MAX_RASTER_PAGES = 40;
export const MAX_RASTER_PDF_BYTES = 80 * 1024 * 1024;

export function toneLookup(options = {}) {
  const density = Number(options.density ?? 0);
  const contrast = Number(options.contrast ?? 0);

  if (!Number.isInteger(density) || Math.abs(density) > 50 ||
      !Number.isInteger(contrast) || Math.abs(contrast) > 50) {
    throw new Error('Интенсивность и контрастность должны быть от -50 до +50.');
  }

  if (density === 0 && contrast === 0) return null;

  // Таблица 256 значений вместо вычисления формулы для каждого пикселя.
  // Контраст изменяет кривую средних тонов, не окрашивая белую бумагу.
  // Интенсивность регулирует «покрытие» цветом: белый всегда остаётся белым.
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    const x = value / 255;
    const smooth = x * x * (3 - 2 * x);
    const curved = x + (contrast / 50) * (smooth - x);
    const ink = (1 - curved) * (1 + density / 100);
    lut[value] = Math.round(Math.max(0, Math.min(255, 255 * (1 - ink))));
  }
  return lut;
}

export async function applyToneSharp(image, options) {
  const lut = toneLookup(options);
  if (!lut) return image;

  const { default: sharp } = await import('sharp');
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  // После flatten() прозрачности нет. Тонируем только цветовые каналы.
  const colorChannels = info.channels === 2 || info.channels === 4
    ? info.channels - 1 : info.channels;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    for (let channel = 0; channel < colorChannels; channel++) {
      data[offset + channel] = lut[data[offset + channel]];
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  });
}

export function selectedPdfPages(options, pageCount) {
  const from = options.pages === 'range' ? Number(options.from) : 1;
  const to = options.pages === 'range' ? Number(options.to) : pageCount;

  if (!Number.isInteger(from) || !Number.isInteger(to) ||
      from < 1 || from > to || to > pageCount) {
    throw new Error(`В документе ${pageCount} стр. Допустимый диапазон: 1–${pageCount}.`);
  }

  const pages = [];
  for (let page = from; page <= to; page++) {
    if (options.filter === 'odd' && page % 2 === 0) continue;
    if (options.filter === 'even' && page % 2 === 1) continue;
    pages.push(page);
  }

  if (!pages.length) throw new Error('По выбранному фильтру нет страниц для печати.');
  return pages;
}

export function rasterDpi(quality) {
  const dpi = { draft: 140, standard: 220, high: 300 }[quality];
  if (!dpi) throw new Error('Неизвестный режим качества.');
  return dpi;
}

// Poppler преобразует PDF в JPEG в отдельном процессе. PDF.js используется
// только для чтения метаданных (число страниц / размеры), но НЕ для рисования.
// Это устраняет несовместимые вызовы CanvasRenderingContext2D.fill/clip(Path2D).
export function locatePdftoppm() {
  const filename = process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm';
  const explicit = process.env.POPPLER_BIN?.trim();
  if (explicit) {
    const candidate = fsSync.existsSync(explicit) && fsSync.statSync(explicit).isDirectory()
      ? path.join(explicit, filename) : explicit;
    if (!fsSync.existsSync(candidate)) {
      throw new Error(`Poppler не найден по POPPLER_BIN: ${candidate}`);
    }
    return candidate;
  }

  if (process.platform === 'win32') {
    const locations = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', filename),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'poppler', 'Library', 'bin', filename),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'poppler', 'Library', 'bin', filename),
      path.join('C:\\', 'poppler', 'Library', 'bin', filename),
    ].filter(Boolean);

    // winget может установить ZIP-пакет не в PATH. Ищем только в ожидаемых
    // каталогах WinGet, без рекурсивного сканирования всего диска.
    const packageRoots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'WinGet', 'Packages'),
    ].filter(Boolean);
    for (const root of packageRoots) {
      try {
        for (const entry of fsSync.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/poppler/i.test(entry.name)) continue;
          const folder = path.join(root, entry.name);
          locations.push(path.join(folder, 'Library', 'bin', filename));
          for (const nested of fsSync.readdirSync(folder, { withFileTypes: true })) {
            if (nested.isDirectory() && /poppler/i.test(nested.name)) {
              locations.push(path.join(folder, nested.name, 'Library', 'bin', filename));
            }
          }
        }
      } catch { /* Может не быть прав на папку, используем PATH. */ }
    }
    const installed = locations.find(candidate => fsSync.existsSync(candidate));
    if (installed) return installed;
  }
  return filename; // Поиск в PATH (в том числе Linux/macOS).
}

// PDF page information is read by Poppler, not PDF.js/Canvas on the server.
// This avoids the CanvasFillRule/Path2D incompatibilities in Node.
export async function popplerPdfInfo(input, pageNumber = null) {
  const exe = path.join(path.dirname(locatePdftoppm()), process.platform === 'win32' ? 'pdfinfo.exe' : 'pdfinfo');
  const args = pageNumber == null ? [input] : ['-f', String(pageNumber), '-l', String(pageNumber), '-box', input];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(exe, args, {
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    throw new Error('Poppler pdfinfo: ' + String(error.stderr || error.message).trim());
  }
  const match = stdout.match(/^Pages:\s*(\d+)/m);
  const count = match ? Number(match[1]) : null;
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new Error('Poppler не смог определить корректное количество страниц PDF.');
  }
  if (pageNumber == null) return { pages: count };
  const pattern = new RegExp('^Page\\s+' + pageNumber + '\\s+size:\\s*([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts', 'm');
  const sizes = stdout.match(pattern);
  if (!sizes) {
    throw new Error('Poppler не смог определить размер страницы ' + pageNumber);
  }
  return { pages: count, width: Number(sizes[1]), height: Number(sizes[2]) };
}

export async function createPopplerTempPdf(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canon-poppler-'));
  const input = path.join(dir, 'input.pdf');
  try {
    await fs.writeFile(input, bytes);
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    input,
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// Отдельный Poppler-процесс, один выбранный лист, без оболочки shell.
async function convertPageWithPoppler(input, pageNumber, dpi, outputPrefix, onChild) {
  const program = locatePdftoppm();
  const argumentsList = [
    '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile',
    '-cropbox', '-r', String(dpi), '-jpeg', '-jpegopt', 'quality=96,optimize=y',
    input, outputPrefix,
  ];
  await new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    let timedOut = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onChild?.(null);
      if (error) reject(error);
      else resolve();
    };
    const child = spawn(program, argumentsList, {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], shell: false,
    });
    onChild?.(child);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 90000);
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString('utf8')).slice(-3000);
    });
    child.on('error', error => {
      const message = error.code === 'ENOENT'
        ? 'Poppler не установлен: команда pdftoppm недоступна. Установи Poppler через winget, открой новый терминал или укажи POPPLER_BIN.'
        : `Не удалось запустить Poppler: ${error.message}`;
      done(new Error(message));
    });
    child.on('close', (code, signal) => {
      if (code !== 0) {
        done(new Error(timedOut
          ? 'Превышено время подготовки страницы в Poppler (90 секунд).'
          : `Poppler не смог подготовить страницу ${pageNumber}: ${stderr.trim() || `код ${code}, сигнал ${signal || '-'}`}`));
      } else done();
    });
  });
}

// Страница PDF -> JPEG через Poppler, затем яркость/контраст через sharp.
// «page» нужен лишь для размера листа. Путь input — временный PDF.
export async function renderPdfPageJpeg(options, input, pageNumber, onChild = null) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw Error('Неверный номер PDF-страницы.');
  const dpi = rasterDpi(options.quality);
  const pageInfo = await popplerPdfInfo(input, pageNumber);
  const width = Math.ceil(pageInfo.width * dpi / 72);
  const height = Math.ceil(pageInfo.height * dpi / 72);
  if (width < 1 || height < 1 || width * height > 14_000_000) {
    throw new Error('Страница слишком велика для выбранного качества. Уменьши качество.');
  }

  const outputPrefix = path.join(path.dirname(input), `page-${pageNumber}`);
  const output = `${outputPrefix}.jpg`;
  try {
    await convertPageWithPoppler(input, pageNumber, dpi, outputPrefix, onChild);
    const stat = await fs.stat(output);
    if (stat.size < 4 || stat.size > 20 * 1024 * 1024) {
      throw new Error('Poppler создал слишком большой или пустой JPEG.');
    }
    const { default: sharp } = await import('sharp');
    let image = sharp(await fs.readFile(output), { failOn: 'error' });
    if (options.color === 'monochrome') image = image.greyscale();
    image = await applyToneSharp(image, options);
    const jpegQuality = { draft: 83, standard: 91, high: 96 }[options.quality];
    const jpeg = await image.jpeg({ quality: jpegQuality }).toBuffer();
    const metadata = await sharp(jpeg).metadata();
    if (jpeg.length > 20 * 1024 * 1024) {
      throw new Error('Одна подготовленная страница превышает 20 МБ.');
    }
    return {
      jpeg, width: metadata.width, height: metadata.height,
      colorSpace: metadata.channels === 1 ? 'DeviceGray' : 'DeviceRGB',
      pageWidth: pageInfo.width, pageHeight: pageInfo.height,
    };
  } finally {
    await fs.unlink(output).catch(() => {});
  }
}

// Сборка PDF с изображениями страниц без лишних зависимостей.
// PDF использует JPEG XObject (DCTDecode), поэтому не сжимает фото повторно.
export function buildRasterPdf(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    throw new Error('Нет страниц для формирования PDF.');
  }

  const objects = new Array(3 + pages.length * 3);
  const kids = [];

  for (let i = 0; i < pages.length; i++) {
    const item = pages[i];
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const w = Number(item.pageWidth);
    const h = Number(item.pageHeight);

    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 ||
        !Buffer.isBuffer(item.jpeg) || item.jpeg.length < 4 ||
        item.jpeg[0] !== 0xff || item.jpeg[1] !== 0xd8 ||
        !['DeviceRGB', 'DeviceGray'].includes(item.colorSpace)) {
      throw new Error(`Некорректная страница растрового PDF №${i + 1}.`);
    }

    kids.push(`${pageId} 0 R`);
    const fw = w.toFixed(3);
    const fh = h.toFixed(3);

    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fw} ${fh}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`, 'ascii',
    );

    const commands = Buffer.from(`q\n${fw} 0 0 ${fh} 0 0 cm\n/Im0 Do\nQ\n`, 'ascii');
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${commands.length} >>\nstream\n`, 'ascii'),
      commands,
      Buffer.from('endstream', 'ascii'),
    ]);

    objects[imageId] = Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${item.width} ` +
        `/Height ${item.height} /ColorSpace /${item.colorSpace} ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${item.jpeg.length} >>\nstream\n`,
        'ascii',
      ),
      item.jpeg,
      Buffer.from('\nendstream', 'ascii'),
    ]);
  }

  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii');
  objects[2] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`,
    'ascii',
  );

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  let position = parts[0].length;

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = position;
    const obj = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, 'ascii'),
      objects[id],
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    parts.push(obj);
    position += obj.length;
    if (position > MAX_RASTER_PDF_BYTES) {
      throw new Error('Подготовленный PDF превысил 80 МБ. Уменьши диапазон или качество.');
    }
  }

  const xrefStart = position;
  const xref = [
    `xref\n0 ${objects.length}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  ];
  parts.push(Buffer.from(xref.join(''), 'ascii'));
  return Buffer.concat(parts);
}

// Для двухстороннего друка и специальных масштабов сначала формируем PDF
// с откорректированными изображениями выбранных страниц, затем печатаем через Windows.
export async function prepareRasterPdf(
  bytes, options, onProgress = () => {}, isCancelled = () => false, onChild = null,
) {
  const temp = await createPopplerTempPdf(bytes);
  try {
    const { pages: count } = await popplerPdfInfo(temp.input);
    const pages = selectedPdfPages(options, count);
    if (pages.length > MAX_RASTER_PAGES) {
      throw new Error(`Для коррекции PDF можно выбрать не больше ${MAX_RASTER_PAGES} страниц.`);
    }
    const rendered = [];
    for (let i = 0; i < pages.length; i++) {
      if (isCancelled()) throw new Error('Подготовка PDF отменена пользователем.');
      const number = pages[i];
      onProgress(number, i + 1, pages.length);
      rendered.push(await renderPdfPageJpeg(options, temp.input, number, onChild));
    }
    if (isCancelled()) throw new Error('Подготовка PDF отменена пользователем.');
    return buildRasterPdf(rendered);
  } finally {
    await temp.cleanup();
  }
}
