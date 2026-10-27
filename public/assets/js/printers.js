import { $ , flash, simpleBlock, makeJob } from './dom.js';
import { state } from './state.js';
import { isDocument, isJPEG } from './files.js';
import { api } from './api.js';
import { buildSettings, checkSettings, summary } from './settings.js';

// Printer listing, polling, submission and cancel interaction.

export async function loadPrinters() {
  try {
    const result = await api('/api/printers');
    const previous = $('printer').value;
    $('printer').replaceChildren();
    if (!result.printers.length) $('printer').append(new Option('Canon не найден. Проверь службу Spooler.', ''));
    else for (const name of result.printers) $('printer').append(new Option(name, name));
    const preferred = result.printers.find((name) => name === previous)
      || result.printers.find((name) => name.toLowerCase() === 'canon ts5350i series');
    if (preferred) $('printer').value = preferred;
    summary();
  } catch (error) {
    $('printer').replaceChildren(new Option('Список принтеров недоступен', ''));
    flash(`Windows: ${error.message}`, 'bad'); summary();
  }
}

export async function loadStatus() {
  try {
    const data = await api('/api/status');
    $('dot').classList.add('online');
    $('connection').textContent = data.state;
    $('deviceInfo').textContent = `${data.model} · ${data.jobs} в очереди IPP · ${data.accepting ? 'принимает задания' : 'приём остановлен'}`;
  } catch {
    $('dot').classList.remove('online');
    $('connection').textContent = 'Нет ответа по Wi-Fi';
    $('deviceInfo').textContent = 'Проверь подключение к принтеру в локальной сети';
  }
}

export async function loadQueue(announce = false) {
  const target = $('queue');
  if (announce) {
    $('refreshQueue').disabled = true;
    $('refreshQueue').textContent = '↻ Обновляем…';
  }
  const printer = $('printer').value;
  if (!printer) {
    target.replaceChildren(simpleBlock('Сначала выберите очередь Canon.'));
    if (announce) {
      $('refreshQueue').disabled = false;
      $('refreshQueue').textContent = '↻ Обновить очередь';
      flash('Сначала выберите принтер Canon.', 'info');
    }
    return;
  }
  try {
    const data = await api('/api/jobs?printer=' + encodeURIComponent(printer));
    target.replaceChildren();
    if (!data.jobs.length) target.append(simpleBlock('Очередь Windows пуста. IPP-задания смотри в истории ниже.'));
    if (announce) flash(`Очередь Windows обновлена: ${data.jobs.length} заданий. Список IPP-заданий — в истории Canon Studio.`, 'good');
    for (const job of data.jobs) {
      target.append(makeJob(job.document, `№ ${job.id} · ${job.status} · ${job.pagesPrinted}/${job.totalPages || '?'} стр.`,
        'Отменить №' + job.id, () => void cancelQueueJob(printer, job)));
    }
  } catch (error) {
    target.replaceChildren(simpleBlock(`Не удалось прочитать очередь: ${error.message}`));
    if (announce) flash(`Очередь: ${error.message}`, 'bad');
  } finally {
    if (announce) {
      $('refreshQueue').disabled = false;
      $('refreshQueue').textContent = '↻ Обновить очередь';
    }
  }
}

export async function cancelQueueJob(printer, job) {
  if (!confirm(`Удалить из очереди Canon задание №${job.id} «${job.document}»?`)) return;
  try {
    const data = await api('/api/jobs/cancel', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Canon-Token': state.token },
      body: JSON.stringify({ printer, id: job.id }) });
    flash(data.message, 'good');
  } catch (error) { flash(error.message, 'bad'); }
  await loadQueue();
}

export async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    const target = $('history'); target.replaceChildren();
    if (!data.tasks.length) target.append(simpleBlock('Заданий пока нет.'));
    for (const task of data.tasks) {
      target.append(makeJob(task.fileName, `${task.status}${task.warning ? ' · ВНИМАНИЕ: ' + task.warning : ''} · ${task.message} · ${task.type.toUpperCase()}${task.windowsJobId ? ` · Windows №${task.windowsJobId}` : ''}${task.ippJobId ? ` · IPP №${task.ippJobId}` : ''}`));
    }
    if (state.activeTaskId) {
      const item = data.tasks.find((task) => task.id === state.activeTaskId);
      if (item) {
        state.busy = ['sending', 'spooling', 'cancel-requested'].includes(item.status) && data.active === item.id;
        $('cancel').disabled = !item.canCancel;
        const type = item.status === 'error' ? 'bad' : item.warning ? 'info' : item.status === 'submitted' || item.status === 'cancelled' ? 'good' : 'info';
        flash(item.message, type);
        if (['submitted', 'error', 'cancelled'].includes(item.status)) state.activeTaskId = item.canCancel ? item.id : null;
      }
      summary();
    }
  } catch { /* Небольшой сбой опроса не должен стирать текущие настройки. */ }
}

export async function sendPrint() {
  if (!state.chosenFile || state.busy || state.preparing || !$('printer').value) return;
  const o = buildSettings();
  const problem = checkSettings(o);
  if (problem) { flash(problem, 'bad'); return; }
  if (isJPEG() && !state.preparedJPEG) { flash('Подожди предпросмотра фотографии.', 'bad'); return; }
  const unknownPages = isDocument() && !(state.pdfDocument?.numPages > 0);
  const warning = unknownPages
    ? '\nЧисло страниц неизвестно: будет отправлен ВЕСЬ документ. Продолжить?'
    : '';
  if (!confirm(`Отправить «${state.chosenFile.name}» на ${o.printer}?\n${o.pages === 'range' ? `Страницы ${o.from}–${o.to}; ` : ''}${o.copies} коп.${warning}`)) return;
  state.busy = true;
  summary();
  flash('Отправляю документ на локальный сервер…', 'info');
  const query = new URLSearchParams(o);
  try {
    const data = await api('/api/print?' + query, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Canon-Token': state.token },
      body: state.chosenFile,
    });
    state.activeTaskId = data.task.id;
    flash('Задание принято нашей программой. Передача принтеру выполняется…', 'info');
    await loadTasks();
  } catch (error) { state.busy = false; flash(error.message, 'bad'); }
  finally { summary(); }
}

export async function cancelCurrent() {
  if (!state.activeTaskId) { flash('Нет активного задания для отмены.', 'info'); return; }
  if (!confirm('Попытаться остановить передачу/удалить это задание? Уже напечатанные страницы останутся.')) return;
  try {
    const result = await api('/api/task/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Canon-Token': state.token },
      body: JSON.stringify({ id: state.activeTaskId }),
    });
    flash(result.task.message, 'info');
    await Promise.all([loadTasks(), loadQueue()]);
  } catch (error) { flash(error.message, 'bad'); }
}
