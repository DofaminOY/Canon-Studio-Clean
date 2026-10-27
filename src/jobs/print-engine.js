import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pdfPrintSettings, jpegIPPSettings } from '../documents/print-utils.js';
import { renderPdfPageJpeg, prepareRasterPdf, selectedPdfPages, createPopplerTempPdf, popplerPdfInfo } from '../documents/print-effects.js';
import { getJobs, removeJob, getSumatra } from '../printers/windows.js';
import { ippAttr, ippInt, ippBody, sendIPP, ippCancel } from '../printers/ipp.js';
import { update, sleep, releaseTask } from './store.js';
import { MAX_RASTER_SHEETS } from '../config.js';

// Print engine: PDF via Windows/Sumatra or rasterized Poppler+IPP; JPEG via IPP.

export async function monitorPdfJob(task) {
  for (let i = 0; i < 24 && !task.windowsJobId; i++) {
    if (task.status === 'error' || task.status === 'cancelled') break;
    try {
      const jobs = await getJobs(task.printer);
      const job = jobs.find((j) => j.document.toLowerCase().includes(task.pdfTag.toLowerCase()));
      if (job) {
        task.windowsJobId = job.id;
        if (task.cancelRequested) await removeJob(task.printer, job.id);
        break;
      }
    } catch { /* Некоторые драйверы не показывают имя документа. */ }
    await sleep(500);
  }
}

export async function runPDF(task, file) {
  const temp = path.join(os.tmpdir(), `${task.pdfTag}.pdf`);
  const o = task.options;
  const changePixels = o.density !== 0 || o.contrast !== 0 || o.quality !== 'standard';
  let fileForPrint = file;
  let printOptions = o;

  // В SumatraPDF нет параметра Draft/High. Если пользователь меняет тон или
  // качество — растеризуем выбранные страницы с нужным DPI и тоном, затем
  // печатаем через Windows. Так работают duplex и специальные масштабы.
  if (changePixels && task.totalPages != null) {
    try {
      fileForPrint = await prepareRasterPdf(
        file,
        o,
        (page, index, total) => update(task, 'spooling',
          `Коррекция PDF: страница ${page} (${index}/${total})…`),
        () => task.cancelRequested,
        (child) => { task.rendererChild = child; },
      );
      // В новый PDF уже вошли только выбранные страницы.
      printOptions = { ...o, pages: 'all', filter: 'all', from: '', to: '' };
    } catch (error) {
      if (task.cancelRequested) throw error;
      // Если Poppler не установлен или не смог прочитать PDF,
      // сохраняем резервный путь через драйвер Windows с предупреждением.
      task.warning = 'Коррекция интенсивности / контраста / качества не применена: ' +
        error.message + '. Печатаем исходный документ через драйвер Windows.';
      update(task, 'spooling', task.warning);
    }
  } else if (changePixels && task.totalPages == null) {
    task.warning = 'Не удалось определить число страниц: тоновая коррекция и специальное качество не применены. ' +
      'Отправляем оригинал драйверу Windows.';
  }

  if (task.cancelRequested) {
    update(task, 'cancelled', 'Подготовка PDF отменена.');
    return;
  }

  fs.writeFileSync(temp, fileForPrint);
  try {
    const settings = pdfPrintSettings(printOptions);
    if (task.cancelRequested) { update(task, 'cancelled', 'Задание отменено до передачи.'); return; }
    update(task, 'spooling', 'Подготавливается PDF и создаётся задание Windows…');
    const monitor = monitorPdfJob(task);
    const sumatra = getSumatra();
    const child = spawn(sumatra, ['-print-to', task.printer, '-print-settings', settings, temp], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    task.child = child;
    let errorOutput = '';
    child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + chunk.toString()).slice(-1500); });
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), 120000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    if (task.cancelRequested) {
      if (task.windowsJobId) {
        try { await removeJob(task.printer, task.windowsJobId); } catch { /* Могло уже исчезнуть из очереди. */ }
      }
      update(task, 'cancelled', 'Процесс передачи остановлен. Если лист уже печатается, отмена может быть поздней.');
      return;
    }
    if (exit.code !== 0) throw Error(`SumatraPDF: код ${exit.code ?? 'нет'}; ${errorOutput.trim() || 'проверь драйвер Canon и путь SumatraPDF.'}`);
    update(task, 'submitted', (task.warning ? 'ВНИМАНИЕ: ' + task.warning + ' ' : '') +
      'PDF передан драйверу Windows; завершение печати не подтверждено.');
    // Небольшая пауза, чтобы успеть обнаружить наше задание в очереди.
    await Promise.race([monitor, sleep(2500)]);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* Файл ОС может ещё удерживаться. */ }
    task.child = null;
  }
}

export async function runJPEG(task, data) {
  const o = task.options;
  const spec = jpegIPPSettings(o);
  const extra = [
    ippAttr(0x42, 'requesting-user-name', 'CanonStudio'),
    ippAttr(0x42, 'job-name', `CanonStudio-${task.id.slice(0, 8)}`),
    ippAttr(0x49, 'document-format', 'image/jpeg'),
    Buffer.from([2]),
    ippInt(0x23, 'print-quality', spec.quality),
    ippAttr(0x44, 'print-color-mode', o.color),
    ippInt(0x21, 'copies', o.copies),
    ippAttr(0x44, 'sides', spec.sides),
    ippAttr(0x44, 'media', spec.media),
  ];
  update(task, 'sending', 'JPEG передаётся по IPP…');
  const response = await sendIPP(ippBody(2, extra, data), task, 60000);
  task.httpRequest = null;
  const id = response.attributes['job-id']?.[0];
  if (Number.isInteger(id) && id > 0) task.ippJobId = id;
  if (task.cancelRequested) {
    if (task.ippJobId) {
      await ippCancel(task.ippJobId);
      update(task, 'cancelled', 'Команда Cancel-Job отправлена принтеру. Уже напечатанное не отменить.');
    } else {
      update(task, 'cancelled', 'Передача прекращена, но идентификатор IPP-задания не получен. Проверь принтер.');
    }
    return;
  }
  update(task, 'submitted', 'Принтер принял JPEG по IPP. Завершение печати не подтверждено.');
}
// Poppler преобразует выбранные PDF-страницы в JPEG перед IPP-печатью.
// PDF.js остаётся только для чтения номеров/размеров страниц.
// Качество передаётся принтеру параметром print-quality = 3/4/5.

export async function runPDFWithQuality(task, bytes) {
  const o = task.options;
  if (o.duplex !== 'simplex' || o.scale !== 'fit') {
    throw Error('IPP PDF предназначен для односторонней печати с подгонкой по листу.');
  }

  const temp = await createPopplerTempPdf(bytes);
  try {
    const { pages: count } = await popplerPdfInfo(temp.input);
    if (count !== task.totalPages) {
      throw Error('Число страниц изменилось после проверки PDF.');
    }
    const pages = selectedPdfPages(o, count);
    const sheets = pages.length * o.copies;
    if (sheets > MAX_RASTER_SHEETS) {
      throw Error(`При прямом IPP-печати максимум ${MAX_RASTER_SHEETS} листов с учётом копий.`);
    }

    const spec = jpegIPPSettings(o);
    let sent = 0;

    for (let copy = 1; copy <= o.copies; copy++) {
      for (const pageNumber of pages) {
        if (task.cancelRequested) {
          update(task, 'cancelled', 'Оставшиеся страницы не отправлены.');
          return;
        }

        update(task, 'sending', `Подготовка страницы ${pageNumber}, копия ${copy}/${o.copies}…`);
        const raster = await renderPdfPageJpeg(
          o, temp.input, pageNumber,
          (child) => { task.rendererChild = child; },
        );

        if (task.cancelRequested) {
          update(task, 'cancelled', 'Передача остановлена до следующей страницы.');
          return;
        }

        const extra = [
          ippAttr(0x42, 'requesting-user-name', 'CanonStudio'),
          ippAttr(0x42, 'job-name', `CanonStudio-${task.id.slice(0, 8)}-p${pageNumber}-c${copy}`),
          ippAttr(0x49, 'document-format', 'image/jpeg'),
          Buffer.from([2]),
          ippInt(0x23, 'print-quality', spec.quality),
          ippAttr(0x44, 'print-color-mode', o.color),
          ippInt(0x21, 'copies', 1),
          ippAttr(0x44, 'sides', 'one-sided'),
          ippAttr(0x44, 'media', spec.media),
        ];

        update(task, 'sending', `Отправка ${sent + 1}/${sheets}: стр. ${pageNumber}; ` +
          `качество ${o.quality}; интенсивность ${o.density}; контраст ${o.contrast}`);

        const response = await sendIPP(ippBody(2, extra, raster.jpeg), task, 60000);
        task.httpRequest = null;
        const id = response.attributes['job-id']?.[0];
        if (Number.isInteger(id) && id > 0) {
          task.ippJobId = id;
          task.ippJobIds.push(id);
        }
        sent++;
        if (sent < sheets) await sleep(350);
      }
    }

    update(task, task.cancelRequested ? 'cancelled' : 'submitted',
      task.cancelRequested
        ? 'Передача остановлена. Ранее отправленные листы могут печататься.'
        : `Отправлено ${sent} страниц с коррекцией через IPP. Завершение печати не подтверждено.`);
  } finally {
    await temp.cleanup();
  }
}

export async function executeTask(task, bytes) {
  try {
    if (task.type === 'pdf') {
      const o = task.options;
      const changePixels = o.quality !== 'standard' || o.density !== 0 || o.contrast !== 0;
      const canDirectIPP = changePixels && task.totalPages != null &&
        task.pagesSelected * o.copies <= MAX_RASTER_SHEETS &&
        o.duplex === 'simplex' && o.scale === 'fit';
      if (canDirectIPP) {
        try {
          await runPDFWithQuality(task, bytes);
        } catch (error) {
          // Не повторяем все страницы, если принтер уже принял хотя бы одну.
          if (task.cancelRequested || task.ippJobIds.length > 0) throw error;
          task.warning = 'Растеризация / печать PDF через IPP не удалась: ' + error.message +
            '. Попытка печати через драйвер Windows.';
          await runPDF(task, bytes);
        }
      } else {
        // Стандартный PDF без коррекции передаём SumatraPDF напрямую.
        // Не нужна растеризация или дополнительные зависимости.
        await runPDF(task, bytes);
      }
    } else {
      await runJPEG(task, bytes);
    }
  } catch (error) {
    if (task.cancelRequested) update(task, 'cancelled', 'Передача остановлена. Проверь очередь: документ мог уже попасть в принтер.');
    else update(task, 'error', error.message);
  } finally {
    task.httpRequest = null;
    task.rendererChild = null;
    releaseTask(task);
  }
}
