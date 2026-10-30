import { randomUUID } from 'node:crypto';
import { MAX_UPLOAD_BYTES, validateSettings, validatePages, fileKind } from '../documents/print-utils.js';
import { checkFileSignature, countPdfPages, convertOfficeToPdf, convertImageToJpeg, convertTextToPdf } from '../documents/document-tools.js';
import { reply, bodyOf } from '../http/helpers.js';
import { getPrinters, getJobs, removeJob } from '../printers/windows.js';
import { ippCancel, ippGetJob } from '../printers/ipp.js';
import { executeTask } from './print-engine.js';
import { currentTask, pendingUpload, recentTasks, setCurrentTask, setPendingUpload, keepTask, update, publicTask } from './store.js';

// Request validation and cancellation. No HTTP server listeners here.

export async function handlePrint(req, res, url) {
  if (currentTask || pendingUpload) return reply(res, 409, { error: 'Другое задание ещё передаётся.' });
  setPendingUpload(true);
  try {
    const options = validateSettings(Object.fromEntries(url.searchParams));
    const names = await getPrinters();
    if (!names.includes(options.printer)) return reply(res, 400, { error: 'Выбранный Canon не найден в Windows.' });
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return reply(res, 413, { error: 'Файл превышает 20 МБ.' });
    const original = await bodyOf(req);
    checkFileSignature(original, options.name);
    if (options.type !== fileKind(options.name)) return reply(res, 400, { error: 'Тип файла не совпадает с расширением.' });

    let bytes = original;
    let printType = options.type;
    let pageCount = 1;
    let pageWarning = null;
    // Сервер повторно проверяет страницы. Если PDF.js не смог разобрать PDF,
    // это не должно блокировать печать ВСЕГО документа через Windows.
    if (printType === 'office') {
      if (/\.txt$/i.test(options.name)) {
        bytes = await convertTextToPdf(original);
      } else {
        bytes = await convertOfficeToPdf(original, options.name);
      }
      printType = 'pdf';
    }
    if (printType === 'pdf') {
      try {
        pageCount = await countPdfPages(bytes);
      } catch (error) {
        pageCount = null;
        pageWarning = error.message;
      }
    } else {
      // Конвертируем изображения (включая PNG/TIFF/GIF/WebP/BMP) в JPEG для IPP.
      bytes = await convertImageToJpeg(original, options);
    }
    const range = validatePages(options, pageCount);
    const directPdf = options.duplex === 'simplex' && options.scale === 'fit';
    const needsTone = options.quality !== 'standard' || options.density !== 0 || options.contrast !== 0;
    // При больших документах используем драйвер Windows вместо блокировки.
    // Если коррекция не сможет выполниться, пользователь получит предупреждение.
    const id = randomUUID();
    const filename = options.name.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 110);
    const task = {
      id, fileName: filename, type: printType, totalPages: pageCount,
      pagesSelected: range.selected, options, printer: options.printer,
      pdfTag: `canon-studio-${id}`, started: Date.now(), status: 'sending',
      message: 'Задание подготовлено.',
      warning: pageWarning ? 'Подсчёт страниц недоступен: ' + pageWarning +
        '. При выборе всех страниц попробуем печать через Windows.' : null,
      cancelRequested: false,
      child: null, rendererChild: null, httpRequest: null, windowsJobId: null, ippJobId: null, ippJobIds: [],
    };
    setCurrentTask(task);
    keepTask(task);
    reply(res, 202, { task: publicTask(task) });
    void executeTask(task, bytes);
  } finally {
    setPendingUpload(false);
  }
}

export async function cancelTask(id) {
  const task = recentTasks.find((t) => t.id === id);
  if (!task) throw Error('Задание не найдено.');
  if (!publicTask(task).canCancel) return publicTask(task);

  const sending = ['sending', 'spooling'].includes(task.status);
  task.cancelRequested = true;
  update(task, 'cancel-requested', 'Запрошена остановка передачи; проверяем задания принтера…');
  if (task.child) task.child.kill();
  if (task.rendererChild) task.rendererChild.kill();
  if (task.httpRequest) task.httpRequest.destroy(Error('Отмена пользователем.'));

  let windowsRemoved = false;
  let windowsError = '';
  if (task.windowsJobId) {
    try { await removeJob(task.printer, task.windowsJobId); windowsRemoved = true; }
    catch (error) { windowsError = error.message; }
  }

  const ids = [...new Set(task.ippJobIds?.length ? task.ippJobIds :
    (task.ippJobId ? [task.ippJobId] : []))];
  if (ids.length) {
    const accepted = [];
    const failed = [];
    for (const jobId of ids) {
      try {
        await ippCancel(jobId);
        accepted.push(jobId);
      } catch (error) {
        let reason = error.message;
        try {
          const job = await ippGetJob(jobId);
          if (job.state === 9) reason = 'уже завершено';
          else if (job.state === 7) reason = 'уже отменено';
          else if (job.state === 8) reason = 'прервано принтером';
        } catch { /* Принтер уже мог удалить задание из памяти. */ }
        failed.push(`№${jobId}: ${reason}`);
      }
    }
    let confirmation = '';
    if (accepted.length) {
      try {
        const last = await ippGetJob(accepted.at(-1));
        if (last.state === 7) confirmation = 'Последнее задание подтверждено как отменённое.';
        else if (last.state === 9) confirmation = 'Последнее задание уже завершено.';
        else confirmation = 'Физическая остановка ещё не подтверждена.';
      } catch {
        confirmation = 'Canon не вернул состояние последнего задания.';
      }
    }
    update(task, accepted.length ? 'cancel-requested' : 'unavailable',
      `Canon принял Cancel-Job для ${accepted.length}/${ids.length} IPP-заданий. ${confirmation}` +
      (failed.length ? ` Не удалось: ${failed.slice(0, 4).join('; ')}` : '') +
      ' Уже напечатанные страницы не отменяются.');
  } else if (windowsRemoved) {
    update(task, 'cancel-requested', 'Windows принял удаление задания; завершение отмены не подтверждено.');
  } else if (sending) {
    update(task, 'cancel-requested', 'Передача остановлена. Если Canon уже получил данные без IPP job-id, адресная отмена невозможна.' +
      (windowsError ? ' Windows: ' + windowsError : ''));
  } else {
    update(task, 'unavailable', 'Задание уже отправлено, но IPP/Windows job-id отсутствует. Отмена невозможна.' +
      (windowsError ? ' Windows: ' + windowsError : ''));
  }
  return publicTask(task);
}
