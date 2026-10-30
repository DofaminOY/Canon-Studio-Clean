// Проверка параметров и выбор способа печати. Не зависит от Windows.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 10000;

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'];
export const OFFICE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp'];
export const ALLOWED_EXTENSIONS = ['pdf', ...IMAGE_EXTENSIONS, ...OFFICE_EXTENSIONS];
export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const PAPER = Object.freeze({
  A4: 'iso_a4_210x297mm',
  A5: 'iso_a5_148x210mm',
  Letter: 'na_letter_8.5x11in',
});

export function fileKind(filename) {
  const extension = String(filename || '').split('.').pop().toLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (OFFICE_EXTENSIONS.includes(extension)) return 'office';
  return null;
}

export function validateSettings(input) {
  const type = String(input.type || '');
  const name = String(input.name || '');
  const color = String(input.color || '');
  const quality = String(input.quality || '');
  const printer = String(input.printer || '');
  const duplex = String(input.duplex || '');
  const paper = String(input.paper || '');
  const orientation = String(input.orientation || 'portrait');
  const scale = String(input.scale || '');
  const pages = String(input.pages || 'all');
  const filter = String(input.filter || 'all');
  const copies = Number(input.copies);
  const from = String(input.from || '').trim();
  const to = String(input.to || '').trim();
  const density = Number(input.density ?? 0);
  const contrast = Number(input.contrast ?? 0);

  if (fileKind(name) !== type) throw Error('Формат документа не совпадает с именем файла.');
  if (!['color', 'monochrome'].includes(color)) throw Error('Некорректный режим цвета.');
  if (!['draft', 'standard', 'high'].includes(quality)) throw Error('Некорректное качество.');
  if (!['simplex', 'duplexlong', 'duplexshort'].includes(duplex)) throw Error('Некорректный двусторонний режим.');
  if (!Object.hasOwn(PAPER, paper)) throw Error('Неподдерживаемый формат бумаги.');
  if (!['portrait', 'landscape'].includes(orientation)) throw Error('Некорректная ориентация печати.');
  if (!['fit', 'shrink', 'noscale'].includes(scale)) throw Error('Некорректный масштаб.');
  if (!['all', 'range'].includes(pages)) throw Error('Некорректный выбор страниц.');
  if (!['all', 'odd', 'even'].includes(filter)) throw Error('Некорректный фильтр страниц.');
  if (!Number.isInteger(copies) || copies < 1 || copies > 10) throw Error('Копий должно быть от 1 до 10.');
  if (!Number.isInteger(density) || density < -50 || density > 50) throw Error('Интенсивность: от -50 до +50.');
  if (!Number.isInteger(contrast) || contrast < -50 || contrast > 50) throw Error('Контрастность: от -50 до +50.');
  if (!/^Canon TS5350i series(?: HTTP)?$/i.test(printer)) throw Error('Выбери Canon TS5350i из списка.');
  if (type === 'image' && (pages !== 'all' || filter !== 'all')) throw Error('Изображение печатается как одна страница.');
  if (type === 'image' && scale !== 'fit') throw Error('Масштаб фотографии задаёт принтер.');

  if (pages === 'range') {
    if (!/^\d{1,5}$/.test(from) || !/^\d{1,5}$/.test(to)) throw Error('Укажи целые номера первой и последней страницы.');
    if (Number(from) < 1 || Number(to) < Number(from) || Number(to) > MAX_PAGES) {
      throw Error(`Диапазон должен быть от 1 до ${MAX_PAGES}, начало не больше конца.`);
    }
  }

  return { type, name, color, quality, printer, duplex, paper, orientation, scale, pages, filter, copies, from, to, density, contrast };
}

// САМАЯ ВАЖНАЯ ПРОВЕРКА: вызывается на сервере после чтения реального PDF.
export function validatePages(options, count) {
  if (options.type === 'image') return { from: 1, to: 1, selected: 1 };
  // Если предварительный просмотр не смог определить число страниц,
  // можно передать ВЕСЬ PDF через драйвер Windows. Точный диапазон и
  // нечётные/чётные страницы без проверки запрещены.
  if (count == null) {
    if (options.pages !== 'all' || options.filter !== 'all') {
      throw Error('Количество страниц не определено: доступна только печать всего документа.');
    }
    return { from: null, to: null, selected: null };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_PAGES) {
    throw Error(`Недопустимое число страниц (ожидается 1–${MAX_PAGES}).`);
  }
  const start = options.pages === 'range' ? Number(options.from) : 1;
  const end = options.pages === 'range' ? Number(options.to) : count;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end || end > count) {
    throw Error(`В документе ${count} стр. Допустимый диапазон: 1–${count}.`);
  }
  let selected = 0;
  for (let page = start; page <= end; page++) {
    if (options.filter === 'all' || (options.filter === 'odd' && page % 2 === 1) ||
        (options.filter === 'even' && page % 2 === 0)) selected++;
  }
  if (!selected) throw Error('По заданному диапазону и фильтру нет страниц для печати.');
  return { from: start, to: end, selected };
}

export function pdfPrintSettings(options) {
  const parts = [];
  if (options.pages === 'range') parts.push(`${options.from}-${options.to}`);
  if (options.filter !== 'all') parts.push(options.filter);
  parts.push(`${options.copies}x`, options.color, options.duplex, options.orientation || 'portrait', `paper=${options.paper}`,
    options.scale, 'ignore-pdf-print-settings');
  return parts.join(',');
}

export function jpegIPPSettings(options) {
  return {
    quality: { draft: 3, standard: 4, high: 5 }[options.quality],
    media: PAPER[options.paper],
    orientation: options.orientation === 'landscape' ? 4 : 3,
    sides: { simplex: 'one-sided', duplexlong: 'two-sided-long-edge', duplexshort: 'two-sided-short-edge' }[options.duplex],
  };
}
