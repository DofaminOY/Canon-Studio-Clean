import { $, flash } from './dom.js';
import { state } from './state.js';
import { speedOf, qualityOf, presets } from './files.js';
import { api } from './api.js';
import { initConnectionMode, setConnected, connectAgent, discoverPrinters, openBrowserPrint } from './connection.js';
import { updateOptions, syncPageMode, summary } from './settings.js';
import { selectFile, choosePdfPage, updateJPEG } from './preview.js';
import { loadPrinters, loadStatus, loadQueue, loadTasks, sendPrint, cancelCurrent } from './printers.js';

// Wire browser events once, then initialise the local session.
initConnectionMode();
$('connectAgent').addEventListener('click', () => void connectAgent());
$('searchDevices').addEventListener('click', () => void discoverPrinters());
$('browserPrint').addEventListener('click', openBrowserPrint);
$('choose').addEventListener('click', () => $('file').click());
$('replaceButton').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (event) => selectFile(event.target.files?.[0]));
$('drop').addEventListener('dragover', (event) => { event.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (event) => {
  event.preventDefault(); $('drop').classList.remove('over'); selectFile(event.dataTransfer?.files?.[0]);
});
document.querySelectorAll('#colors button').forEach((button) => button.addEventListener('click', () => {
  state.settings.color = button.dataset.value; updateOptions(); updateJPEG();
}));
document.querySelectorAll('#qualities button').forEach((button) => button.addEventListener('click', () => {
  state.settings.quality = button.dataset.value; state.settings.speed = speedOf[state.settings.quality]; updateOptions();
}));
document.querySelectorAll('#speeds button').forEach((button) => button.addEventListener('click', () => {
  state.settings.speed = button.dataset.value; state.settings.quality = qualityOf[state.settings.speed]; updateOptions();
}));
document.querySelectorAll('#presets button').forEach((button) => button.addEventListener('click', () => {
  state.settings.density = presets[button.dataset.value]; updateOptions(); updateJPEG();
}));
for (const name of ['density', 'contrast']) $(name).addEventListener('input', (event) => {
  state.settings[name] = Number(event.target.value); updateOptions(); updateJPEG();
});
document.querySelectorAll('input[name=pageMode]').forEach((el) => el.addEventListener('change', syncPageMode));
$('pdfPrev').addEventListener('click', () => choosePdfPage(state.pdfPageNumber - 1));
$('pdfNext').addEventListener('click', () => choosePdfPage(state.pdfPageNumber + 1));
$('pdfCurrentPage').addEventListener('change', (event) => choosePdfPage(event.target.value));
for (const name of ['from', 'to', 'copies', 'paper', 'pageFilter']) $(name).addEventListener('input', summary);
for (const name of ['duplex', 'scale']) $(name).addEventListener('change', updateOptions);
$('printer').addEventListener('change', () => { summary(); void loadQueue(); });
$('refresh').addEventListener('click', () => { void loadPrinters().then(loadQueue); void loadStatus(); });
$('refreshQueue').addEventListener('click', () => {
  void Promise.all([loadQueue(true), loadTasks()]);
});
$('print').addEventListener('click', () => void sendPrint());
$('cancel').addEventListener('click', () => void cancelCurrent());

(async () => {
  if (state.mode === 'web') {
    // Static web mode has no server API. Never request localhost without a click.
    updateOptions();
    return;
  }
  try { state.token = (await api('/api/config')).token; setConnected(true); }
  catch (error) { flash(`Сервер не отвечает: ${error.message}`, 'bad'); return; }
  updateOptions();
  await loadPrinters();
  await Promise.all([loadStatus(), loadTasks(), loadQueue()]);
  setInterval(() => { void loadTasks(); }, 1500);
  setInterval(() => { void loadQueue(); }, 6000);
  setInterval(() => { if (!state.busy) void loadStatus(); }, 10000);
})();
