import { $ , flash } from './dom.js';
import { state } from './state.js';
import { MAX_FILE, kindOf, extOf, isDocument, isPDF, isOffice, isJPEG } from './files.js';
import { api, apiUrl } from './api.js';
import { updateOptions, selectedPageMode, summary } from './settings.js';

// PDF.js is intentionally browser-only; Poppler renders printable pages on server.

export function updatePdfNavigation() {
  const total = state.pdfDocument?.numPages || 0;
  $('pdfPageCount').textContent = total || '?';
  $('pdfCurrentPage').value = state.pdfPageNumber;
  $('pdfCurrentPage').max = total || 10000;
  $('from').max = total || 10000;
  $('to').max = total || 10000;
  $('pageHelp').textContent = total ? `В документе ${total} стр. Диапазон должен быть в пределах 1–${total}.` :
    'Число страниц неизвестно. Можно распечатать ВЕСЬ документ; диапазон и текущая страница доступны после подсчёта.';
  $('pdfCurrentPage').disabled = !total || state.pdfLoading;
  $('pdfPrev').disabled = !total || state.pdfLoading || state.pdfPageNumber <= 1;
  $('pdfNext').disabled = !total || state.pdfLoading || state.pdfPageNumber >= total;
  $('currentMode').disabled = !total || state.pdfLoading;
  if (selectedPageMode() === 'current' && !total) {
    document.querySelector('input[name=pageMode][value=all]').checked = true;
  }
  summary();
}

export function renderPage(number) {
  const documentAtRequest = state.pdfDocument;
  const selectionAtRequest = state.pdfSelectionId;
  state.pdfRenderQueue = state.pdfRenderQueue.catch(() => {}).then(async () => {
    if (!documentAtRequest || selectionAtRequest !== state.pdfSelectionId || state.pdfPageNumber !== number) return;
    const page = await documentAtRequest.getPage(number);
    if (selectionAtRequest !== state.pdfSelectionId || state.pdfPageNumber !== number) return;
    const stage = $('pdfStage');
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, stage.clientWidth - 26);
    const scale = Math.min(1.6, width / base.width);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = $('pdfCanvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
    const context = canvas.getContext('2d');
    if (!context) throw Error('Не удалось открыть Canvas для PDF.');
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    if (selectionAtRequest === state.pdfSelectionId) $('pdfViewerMessage').textContent = `На экране страница ${number} из ${documentAtRequest.numPages}`;
  }).catch((error) => {
    if (selectionAtRequest === state.pdfSelectionId) $('pdfViewerMessage').textContent = `Предпросмотр: ${error.message}`;
  });
}

export function choosePdfPage(pageNumber) {
  if (!state.pdfDocument || state.pdfLoading) return;
  const next = Number(pageNumber);
  if (!Number.isInteger(next) || next < 1 || next > state.pdfDocument.numPages) {
    $('pdfCurrentPage').value = state.pdfPageNumber;
    flash(`Выберите страницу от 1 до ${state.pdfDocument.numPages}.`, 'bad');
    return;
  }
  state.pdfPageNumber = next;
  updatePdfNavigation();
  renderPage(next);
}

export async function preparePDF(file, selection) {
  state.pdfLoading = true;
  state.pdfDocument = null;
  state.pdfPageNumber = 1;
  $('pdfStage').style.display = 'flex';
  $('pdfViewerMessage').textContent = 'Загрузка PDF…';
  updatePdfNavigation();
  try {
    if (!state.pdfjsLib) {
      state.pdfjsLib = await import('/vendor/pdf.mjs');
      state.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    }
    if (selection !== state.pdfSelectionId) return;
    const data = new Uint8Array(await file.arrayBuffer());
    if (selection !== state.pdfSelectionId) return;
    const loaded = await state.pdfjsLib.getDocument({ data }).promise;
    if (selection !== state.pdfSelectionId) { await loaded.destroy(); return; }
    state.pdfDocument = loaded;
    state.pdfLoading = false;
    updatePdfNavigation();
    renderPage(1);
  } catch (error) {
    if (selection !== state.pdfSelectionId) return;
    state.pdfLoading = false;
    state.pdfDocument = null;
    $('pdfStage').style.display = 'none';
    $('pdfViewerMessage').textContent = 'Просмотр недоступен';
    updatePdfNavigation();
    flash(`Не удалось показать PDF: ${error.message}. Можно распечатать весь документ через Windows; диапазон недоступен без подсчёта страниц.`, 'info');
  }
}

export function showPreview(data, pdf) {
  if (state.previewURL) URL.revokeObjectURL(state.previewURL);
  state.previewURL = URL.createObjectURL(data);
  $('imgPreview').style.display = pdf ? 'none' : 'block';
  if (!pdf) $('imgPreview').src = state.previewURL;
  $('openPreview').href = state.previewURL;
}

export async function renderJPEG(requestId) {
  try {
    const original = state.chosenFile;
    if (!original || !isJPEG()) return;
    state.previewController?.abort();
    const controller = new AbortController();
    state.previewController = controller;
    const query = new URLSearchParams({ name: original.name, color: state.settings.color,
      density: String(state.settings.density), contrast: String(state.settings.contrast) });
    if (!state.agentConnected) {
      if (requestId === state.generation) {
        state.preparedJPEG = original;
        showPreview(original, false);
      }
      return;
    }
    const response = await fetch(apiUrl('/api/preview-image?' + query), {
      method: 'POST', headers: { 'X-Canon-Token': state.token }, body: original, signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Error(data.error || `HTTP ${response.status}`);
    }
    const jpeg = await response.blob();
    if (requestId !== state.generation) return;
    state.preparedJPEG = jpeg; // Только для предпросмотра. Печатаем исходник через sharp на сервере.
    showPreview(jpeg, false);
  } catch (error) {
    if (error.name !== 'AbortError' && requestId === state.generation) {
      state.preparedJPEG = null;
      flash(`Изображение: ${error.message}`, 'bad');
    }
  } finally {
    if (requestId === state.generation) { state.preparing = false; summary(); }
  }
}

export function updateJPEG() {
  if (!isJPEG()) return;
  clearTimeout(state.previewTimer);
  state.previewController?.abort();
  state.generation += 1;
  state.preparedJPEG = null;
  state.preparing = true;
  summary();
  const requestId = state.generation;
  state.previewTimer = setTimeout(() => { void renderJPEG(requestId); }, 320);
}

export async function prepareOfficePreview(file, selection) {
  state.pdfLoading = true;
  updatePdfNavigation();
  $('pdfViewerMessage').textContent = 'Преобразование документа через LibreOffice…';
  try {
    if (!state.agentConnected) {
      state.pdfLoading = false;
      state.pdfDocument = null;
      $('pdfStage').style.display = 'none';
      updatePdfNavigation();
      $('pdfViewerMessage').textContent = 'Для просмотра Office подключите агент.';
      flash('Файл выбран. Office-документы требуют локального агента для просмотра и печати с настройками.', 'info');
      return;
    }
    const response = await fetch(apiUrl('/api/preview-office?name=' + encodeURIComponent(file.name)), {
      method: 'POST', headers: { 'X-Canon-Token': state.token }, body: file,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Error(data.error || `HTTP ${response.status}`);
    }
    const pdfBlob = await response.blob();
    if (selection !== state.pdfSelectionId) return;
    showPreview(pdfBlob, true);
    await preparePDF(pdfBlob, selection);
  } catch (error) {
    if (selection !== state.pdfSelectionId) return;
    state.pdfLoading = false;
    state.pdfDocument = null;
    updatePdfNavigation();
    $('pdfViewerMessage').textContent = 'Просмотр недоступен — печать всех страниц разрешена';
    $('pageHelp').textContent = 'Не удалось определить страницы. Печать всего документа доступна. Для TXT/Office при печати требуется LibreOffice.';
    flash(`Предпросмотр не удался: ${error.message}. Печать всего документа остаётся доступна, если LibreOffice сможет его преобразовать.`, 'info');
    summary();
  }
}

export function selectFile(file) {
  if (!file) return;
  if (!kindOf(file.name)) { flash('Неподдерживаемый формат файла.', 'bad'); return; }
  if (file.size > MAX_FILE || file.size === 0) { flash('Размер файла: от 1 байта до 20 МБ.', 'bad'); return; }
  state.chosenFile = file;
  clearTimeout(state.previewTimer);
  state.previewController?.abort();
  state.generation += 1;
  state.pdfSelectionId += 1;
  const selection = state.pdfSelectionId;
  const oldDocument = state.pdfDocument;
  state.pdfDocument = null;
  state.pdfLoading = false;
  state.pdfPageNumber = 1;
  document.querySelector('input[name=pageMode][value=all]').checked = true;
  $('from').value = '';
  $('to').value = '';
  $('from').max = '10000';
  $('to').max = '10000';
  if (oldDocument) void oldDocument.destroy().catch(() => {});
  state.preparedJPEG = null;
  state.preparing = false;
  $('emptyUpload').classList.add('hidden');
  $('replace').classList.remove('hidden');
  $('filename').textContent = file.name;
  $('format').textContent = extOf(file.name).toUpperCase();
  $('size').textContent = `${(file.size / 1024 / 1024).toFixed(2)} МБ`;
  $('pdfStage').style.display = isDocument() ? 'flex' : 'none';
  if (isDocument()) {
    $('imgPreview').style.display = 'none';
    if (isPDF()) { showPreview(file, true); void preparePDF(file, selection); }
    else void prepareOfficePreview(file, selection);
  } else updateJPEG();
  updateOptions();
  flash('Файл выбран. Перед печатью проверяем формат и страницы.', 'info');
}
