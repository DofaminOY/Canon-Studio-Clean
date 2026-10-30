import { $ , seg } from './dom.js';
import { state } from './state.js';
import { presets, kindOf, isDocument, isJPEG } from './files.js';

// Input constraints and selected output settings.

export function updateOptions() {
  seg('colors', state.settings.color);
  seg('qualities', state.settings.quality);
  seg('orientations', state.settings.orientation);
  seg('presets', state.settings.preset || '');
  $('profileMode').textContent = state.settings.preset ? 'Профиль выбран · контраст 0' : 'Настроено вручную';
  $('profileMode').classList.toggle('custom', !state.settings.preset);
  $('densityValue').textContent = state.settings.density > 0 ? `+${state.settings.density}` : state.settings.density;
  $('contrastValue').textContent = state.settings.contrast > 0 ? `+${state.settings.contrast}` : state.settings.contrast;
  $('density').value = state.settings.density;
  $('contrast').value = state.settings.contrast;
  // Только ориентировочный предпросмотр тоновой коррекции PDF.
  $('pdfCanvas').style.filter = `brightness(${(1 - state.settings.density / 200).toFixed(2)}) contrast(${(1 + state.settings.contrast / 100).toFixed(2)})`;
  $('inkControls').disabled = false; // Качество, контраст и интенсивность доступны всем форматам.
  const pdf = isDocument();
  const pdfIPP = pdf && $('duplex').value === 'simplex' && $('scale').value === 'fit';
  // Все три режима доступны для документов и фотографий.
  $('qualities').classList.remove('disabled');
  document.querySelectorAll('#qualities button').forEach((button) => button.disabled = false);
  $('qualityNotice').textContent = pdf
    ? pdfIPP
      ? 'PDF: IPP-параметр Draft / Standard / High и подготовка страниц в 140 / 220 / 300 DPI.'
      : 'PDF через Windows: качество меняет разрешение подготовленных страниц (140 / 220 / 300 DPI), но физический режим драйвера Canon задаётся отдельно.'
    : 'Фото: IPP-параметр Draft / Standard / High. Приоритет скорости связан с качеством.';
  $('pagesBlock').classList.toggle('hidden', !pdf);
  $('pdfControls').classList.toggle('hidden', !pdf);
  $('currentMode').disabled = !pdf || !state.pdfDocument || state.pdfLoading;
  $('pageFilter').disabled = !pdf;
  $('scale').disabled = !pdf;
  if (!pdf) { document.querySelector('input[name=pageMode][value=all]').checked = true; $('pageFilter').value = 'all'; }
  syncPageMode();
  $('capability').textContent = pdf
    ? pdfIPP
      ? 'PDF / Office: пытаемся применить качество, интенсивность и контраст через IPP (до 40 листов). Если растеризация недоступна, печатаем оригинал через Windows с предупреждением об отсутствии коррекции. Black Only для IPP не действует.'
      : 'PDF / Office: печать через Windows. При коррекции пытаемся подготовить растровый PDF; при сбое печатаем оригинал с предупреждением. Стандартный документ при 0/0 идёт без изменения качества.'
    : 'Фото: качество, цвет, бумага, копии и стороны передаются по IPP. Интенсивность и контраст изменяют изображение до отправки.';
  summary();
}

export function selectedPageMode() {
  return document.querySelector('input[name=pageMode]:checked').value;
}

export function syncPageMode() {
  $('rangeBlock').classList.toggle('hidden', !isDocument() || selectedPageMode() !== 'range');
  summary();
}

// PDF.js рисует одну страницу, а не встроенный просмотрщик Chrome:
// выбранная "текущая" страница всегда соответствует рисунку на экране.

export function buildSettings() {
  return {
    type: kindOf(state.chosenFile?.name) || '', name: state.chosenFile?.name || '', printer: $('printer').value,
    color: state.settings.color, quality: state.settings.quality,
    copies: $('copies').value, duplex: $('duplex').value, orientation: state.settings.orientation,
    paper: $('paper').value, scale: isDocument() ? $('scale').value : 'fit',
    // Для сервера «текущая» = обычный диапазон N–N.
    pages: isDocument() ? (selectedPageMode() === 'current' ? 'range' : selectedPageMode()) : 'all',
    filter: isDocument() ? $('pageFilter').value : 'all',
    from: isDocument() && selectedPageMode() === 'current' ? String(state.pdfPageNumber) : $('from').value,
    to: isDocument() && selectedPageMode() === 'current' ? String(state.pdfPageNumber) : $('to').value,
    density: String(state.settings.density), contrast: String(state.settings.contrast),
  };
}

export function checkSettings(o) {
  if (!['portrait', 'landscape'].includes(o.orientation)) return 'Выбери ориентацию печати.';
  const copies = Number(o.copies);
  if (!Number.isInteger(copies) || copies < 1 || copies > 10) return 'Копий должно быть от 1 до 10.';
  if (isDocument()) {
    const total = state.pdfDocument?.numPages || 0;
    if (total > 10000) return 'Документ содержит больше 10 000 страниц: печать заблокирована.';
    // Плохой предпросмотр или ошибки PDF.js не блокируют печать всего файла.
    // Диапазон без проверки всё равно запрещён (чтобы не печатать страницы 2–13 из 3).
    if (!total) {
      if (o.pages !== 'all' || o.filter !== 'all') {
        return 'Номера страниц неизвестны: доступны только «Все страницы» без фильтра.';
      }
      return '';
    }
    const first = o.pages === 'range' ? Number(o.from) : 1;
    const last = o.pages === 'range' ? Number(o.to) : total;
    if (o.pages === 'range') {
      if (!/^\d+$/.test(o.from) || !/^\d+$/.test(o.to) ||
          !Number.isInteger(first) || !Number.isInteger(last)) return 'Укажи целые номера страниц.';
      if (first < 1 || first > last || last > total) {
        return `В документе ${total} стр. Разрешены страницы от 1 до ${total}.`;
      }
    }
    const count = Array.from({ length: last - first + 1 }, (_, i) => first + i)
      .filter((n) => o.filter === 'all' || (o.filter === 'odd' ? n % 2 === 1 : n % 2 === 0)).length;
    if (!count) return 'После выбора чётных/нечётных страниц диапазон пуст.';
    // При больших объёмах сервер переключится на драйвер Windows,
    // а не будет блокировать кнопку печати.
  }
  if (isJPEG() && state.preparing) return 'Подготовка предпросмотра…';
  return '';
}

export function summary() {
  const o = buildSettings();
  const invalid = state.chosenFile ? checkSettings(o) : '';
  const total = state.pdfDocument?.numPages || 0;
  const pages = isDocument()
    ? selectedPageMode() === 'current' ? `текущая стр. ${state.pdfPageNumber} из ${total || '?'}`
      : o.pages === 'range' ? `стр. ${o.from || '?'}–${o.to || '?'} из ${total || '?'}`
        : `все ${total || '?'} стр.` : 'одно изображение';
  $('summary').textContent = state.chosenFile
    ? `${o.name} · ${pages} · ${o.copies} коп. · ${o.color === 'monochrome' ? 'ч/б' : 'цвет'} · ${o.paper} · ${o.orientation === 'landscape' ? 'альбомная' : 'книжная'} · ${o.duplex === 'simplex' ? '1 сторона' : '2 стороны'} · качество ${o.quality} · интенсивность ${state.settings.density} · контраст ${state.settings.contrast}`
    : 'Выбери документ или фотографию.';
  const errorBox = $('pageError');
  errorBox.textContent = invalid;
  errorBox.classList.toggle('hidden', !invalid);
  $('print').disabled = !state.agentConnected || !state.chosenFile || !o.printer || state.busy || state.preparing || !!invalid || (isJPEG() && !state.preparedJPEG);
  $('browserPrint').disabled = !state.chosenFile;
  $('cancel').disabled = !state.activeTaskId || !state.taskCanCancel;
  return invalid;
}
