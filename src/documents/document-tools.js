// Чтение PDF, преобразование офисных файлов и подготовка изображений.
// pdfjs-dist и sharp устанавливаются через npm install.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { fileKind, IMAGE_EXTENSIONS } from './print-utils.js';
import { applyToneSharp, createPopplerTempPdf, popplerPdfInfo } from './print-effects.js';

const execFileAsync = promisify(execFile);
const IMAGE_SET = new Set(IMAGE_EXTENSIONS);

// Проверяем реальные сигнатуры, а не только расширение / Content-Type.
export function checkFileSignature(bytes, name) {
  const kind = fileKind(name);
  const extension = name.split('.').pop().toLowerCase();
  if (!kind) throw Error('Этот формат файла не поддерживается.');
  if (bytes.length === 0) throw Error('Файл пустой.');
  if (bytes.length < 5 && !['txt', 'csv'].includes(extension)) throw Error('Файл слишком маленький.');
  const head = bytes.subarray(0, 16);
  const starts = (hex) => head.subarray(0, hex.length / 2).toString('hex') === hex;
  if (kind === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw Error('Это не PDF-файл.');
  }
  if (extension === 'jpg' || extension === 'jpeg') {
    if (!starts('ffd8ff')) throw Error('Неверная сигнатура JPEG.');
  }
  if (extension === 'png' && !starts('89504e470d0a1a0a')) throw Error('Неверная сигнатура PNG.');
  if (extension === 'gif' && !['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString())) throw Error('Неверная сигнатура GIF.');
  if (extension === 'bmp' && !starts('424d')) throw Error('Неверная сигнатура BMP.');
  if (extension === 'webp' && !(head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP')) {
    throw Error('Неверная сигнатура WebP.');
  }
  if (['tif', 'tiff'].includes(extension) && ![ '49492a00', '4d4d002a', '49492b00', '4d4d002b' ].some(starts)) {
    throw Error('Неверная сигнатура TIFF.');
  }
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(extension) && !starts('504b')) {
    throw Error('Файл Office/ODF должен быть ZIP-контейнером.');
  }
  if (['doc', 'xls', 'ppt'].includes(extension) && !starts('d0cf11e0a1b11ae1')) {
    throw Error('Неверная сигнатура старого файла Office.');
  }
  if (extension === 'rtf' && !head.toString('ascii').startsWith('{\\rtf')) throw Error('Неверная сигнатура RTF.');
  if (kind === 'image' && !IMAGE_SET.has(extension)) throw Error('Неподдерживаемое изображение.');
  return kind;
}

// Количество страниц вычисляется из самого содержимого, а не из полей формы.
export async function countPdfPages(bytes) {
  const temp = await createPopplerTempPdf(bytes);
  try {
    return (await popplerPdfInfo(temp.input)).pages;
  } finally {
    await temp.cleanup();
  }
}

// Конвертация обычного TXT в PDF без LibreOffice. PDFKit использует системный
// шрифт Windows с кириллицей; в отличие от встроенных PDF-шрифтов это
// не превращает русский / украинский текст в квадраты.
export async function convertTextToPdf(bytes) {
  const candidates = [
    process.env.CANON_TEXT_FONT,
    process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts', 'arial.ttf'),
    process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts', 'segoeui.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ].filter(Boolean);
  let font = null;
  for (const candidate of candidates) {
    try { await fs.access(candidate); font = candidate; break; } catch { /* Следующий шрифт. */ }
  }
  if (!font) throw Error('Не найден шрифт для печати TXT. Укажи CANON_TEXT_FONT с путём к TTF.');

  let text;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('windows-1251').decode(bytes); }
  }
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  if (text.length > 650000) throw Error('TXT слишком большой для подготовки PDF.');
  const { default: PDFDocument } = await import('pdfkit');
  const pdf = new PDFDocument({ size: 'A4', margin: 45, compress: true,
    info: { Title: 'Canon Studio TXT document', Author: 'Canon Studio' },
  });
  const chunks = [];
  return new Promise((resolve, reject) => {
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      pdf.font(font).fontSize(10).fillColor('#111111').text(text || ' ', {
        lineGap: 3, breakLine: true,
      });
      pdf.end();
    } catch (error) { reject(error); }
  });
}

function libreOfficePath() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
    process.platform !== 'win32' && '/usr/bin/libreoffice',
    process.platform !== 'win32' && '/usr/bin/soffice',
  ].filter(Boolean);
  return candidates;
}

export async function convertOfficeToPdf(bytes, filename) {
  // Используем отдельный профиль и временную папку для каждой конвертации.
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'canon-office-'));
  try {
    const extension = filename.split('.').pop().toLowerCase();
    const input = path.join(folder, `document.${extension}`);
    const output = path.join(folder, 'document.pdf');
    await fs.writeFile(input, bytes);
    const officeCandidates = libreOfficePath();
    let executable = null;
    for (const candidate of officeCandidates) {
      try { await fs.access(candidate); executable = candidate; break; } catch { /* Следующий путь. */ }
    }
    if (!executable) throw Error('Для печати TXT/Word/Excel/PowerPoint нужен LibreOffice. Установи: winget install -e --id TheDocumentFoundation.LibreOffice (затем перезапусти Canon Studio).');
    const profile = pathToFileURL(path.join(folder, 'lo-profile')).href;
    await execFileAsync(executable, [
      `-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', folder, input,
    ], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    let pdf;
    try { pdf = await fs.readFile(output); }
    catch { throw Error('LibreOffice не смог создать PDF из этого файла.'); }
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw Error('LibreOffice вернул некорректный PDF.');
    return pdf;
  } finally {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}


// sharp не декодирует BMP во всех сборках. Поддерживаем стандартные
// несжатые Windows BMP с 24/32 битами самостоятельно.
function decodeBitmap(buffer) {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') throw Error('Неверный BMP.');
  const offset = buffer.readUInt32LE(10);
  const dibSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const height = Math.abs(signedHeight);
  const planes = buffer.readUInt16LE(26);
  const bits = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (dibSize < 40 || planes !== 1 || width < 1 || height < 1 ||
      width * height > 30_000_000 || ![24, 32].includes(bits) || compression !== 0) {
    throw Error('Поддерживаются только несжатые BMP 24/32 бит.');
  }
  const stride = Math.floor((width * bits + 31) / 32) * 4;
  if (offset + stride * height > buffer.length) throw Error('BMP повреждён или обрезан.');
  const pixels = Buffer.alloc(width * height * 4);
  const step = bits / 8;
  for (let y = 0; y < height; y++) {
    const sourceY = signedHeight > 0 ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const src = offset + sourceY * stride + x * step;
      const dst = (y * width + x) * 4;
      pixels[dst] = buffer[src + 2];
      pixels[dst + 1] = buffer[src + 1];
      pixels[dst + 2] = buffer[src];
      pixels[dst + 3] = 255;
    }
  }
  return { pixels, width, height };
}

export async function convertImageToJpeg(bytes, options, preview = false) {
  // Первый кадр анимированного GIF/TIFF. Ограничение защищает от огромных изображений.
  const isBmp = bytes.subarray(0, 2).toString('ascii') === 'BM';
  const bmp = isBmp ? decodeBitmap(bytes) : null;
  let image = bmp
    ? sharp(bmp.pixels, { raw: { width: bmp.width, height: bmp.height, channels: 4 } })
    : sharp(bytes, { failOn: 'error', limitInputPixels: 30_000_000, animated: false });
  image = image.rotate().flatten({ background: '#ffffff' });
  const metadata = await image.metadata();
  if (!IMAGE_SET.has(metadata.format) && !(isBmp && metadata.format === 'raw')) {
    // sharp использует имена tiff, jpeg и т.п. — они входят в IMAGE_SET.
    throw Error(`Формат изображения ${metadata.format} не поддерживается обработчиком.`);
  }
  if (preview) image = image.resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true });
  if (options.color === 'monochrome') image = image.greyscale();
  // Единая формула с PDF: при 0/0 результат НЕ светлеет и НЕ темнеет.
  image = await applyToneSharp(image, options);
  const jpeg = await image.jpeg({ quality: preview ? 80 : 92 }).toBuffer();
  if (jpeg.length > 20 * 1024 * 1024) throw Error('Подготовленное изображение превышает 20 МБ.');
  return jpeg;
}
