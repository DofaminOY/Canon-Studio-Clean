import { $, flash, simpleBlock } from './dom.js';
import { state } from './state.js';
import { api, setApiBase } from './api.js';
import { summary } from './settings.js';

const LOOPBACK_AGENT = 'http://127.0.0.1:3177';

export function isLocalPage(hostname = typeof location === 'undefined' ? '127.0.0.1' : location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function updateConnectionUI() {
  const online = state.agentConnected;
  $('agentConnection').textContent = online
    ? 'Локальный агент подключён. Полный режим печати доступен.'
    : 'Агент не подключён. Файлы остаются на устройстве; доступен просмотр и печать через браузер.';
  $('connectAgent').textContent = online ? '↻ Проверить подключение' : 'Подключить локальный агент';
  $('searchDevices').disabled = !online;
  $('refresh').disabled = !online;
  $('refreshQueue').disabled = !online;
  $('printer').disabled = !online;
  $('browserPrint').disabled = !state.chosenFile;
  if (!online) {
    $('dot').classList.remove('online');
    $('connection').textContent = 'Режим браузера';
    $('deviceInfo').textContent = 'Нет подключения к локальному агенту';
    $('printer').replaceChildren(new Option('Подключите агент для поиска принтеров', ''));
    $('queue').replaceChildren(simpleBlock('Очередь доступна после подключения локального агента.'));
    $('history').replaceChildren(simpleBlock('История агента недоступна в режиме браузера.'));
  }
  summary();
}

export function initConnectionMode() {
  state.mode = isLocalPage() ? 'local' : 'web';
  updateConnectionUI();
  $('localPairingTools').classList.toggle('hidden', state.mode !== 'local');
}

export function setConnected(connected) {
  state.agentConnected = connected;
  updateConnectionUI();
}

export async function connectAgent() {
  // Intentional user gesture: never scan localhost automatically from the public website.
  $('connectAgent').disabled = true;
  $('agentConnection').textContent = 'Проверяем локальный агент…';
  try {
    const base = state.mode === 'local' ? '' : LOOPBACK_AGENT;
    const response = await fetch(base + '/api/health', {
      method: 'GET', mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (health.service !== 'canon-studio-agent' || health.ok !== true) throw Error('Неизвестный локальный сервис.');
    setApiBase(base);
    if (state.mode === 'web') {
      // Consent: the code can be obtained only from the local UI on this computer.
      const code = window.prompt('Откройте http://127.0.0.1:3177 в другой вкладке, нажмите «Показать код подключения» и введите 8 цифр сюда:');
      if (code === null) throw Error('Подключение отменено пользователем.');
      if (!/^\d{8}$/.test(code.trim())) throw Error('Нужен восьмизначный код Agent.');
      const result = await fetch(base + '/api/pairing', {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
        signal: AbortSignal.timeout(6000),
      });
      const paired = await result.json();
      if (!result.ok || !paired.token) throw Error(paired.error || 'Не удалось подтвердить код.');
      state.token = paired.token;
    } else {
      const config = await api('/api/config');
      if (!config.token) throw Error('Агент не выдал локальный сеанс.');
      state.token = config.token;
    }
    setConnected(true);
    const { loadPrinters, loadStatus, loadQueue, loadTasks } = await import('./printers.js');
    await loadPrinters();
    await Promise.all([loadStatus(), loadQueue(), loadTasks()]);
    if (state.chosenFile && state.chosenFile.name.match(/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i)) {
      const { updateJPEG } = await import('./preview.js');
      updateJPEG();
    }
    flash('Локальный агент найден. Проверены принтеры Windows и состояние Canon.', 'good');
  } catch (error) {
    setApiBase('');
    state.token = '';
    setConnected(false);
    flash('Агент недоступен или доступ запрещён браузером: ' + error.message +
      '. Запустите Canon Studio на своём ПК и разрешите доступ к локальной сети. Для Vercel установите CANON_STUDIO_ALLOWED_ORIGIN.', 'info');
  } finally {
    $('connectAgent').disabled = false;
  }
}

export async function discoverPrinters() {
  if (!state.agentConnected) return flash('Сначала подключите локальный агент.', 'info');
  $('searchDevices').disabled = true;
  try {
    const info = await api('/api/discovery');
    const { loadPrinters, loadStatus } = await import('./printers.js');
    await Promise.all([loadPrinters(), loadStatus()]);
    $('agentConnection').textContent = `${info.printers.length} установленных принтеров Windows. ` +
      (info.configuredIPP.online ? 'Настроенный Canon доступен по IPP.' : 'Настроенный Canon по IPP не отвечает.');
    flash(info.printers.length ? 'Список принтеров обновлён.' :
      'Установленных принтеров нет. Добавьте принтер в настройках Windows и повторите поиск.', 'info');
  } catch (error) {
    flash(`Поиск принтеров: ${error.message}`, 'bad');
  } finally {
    $('searchDevices').disabled = !state.agentConnected;
  }
}

export function openBrowserPrint() {
  const file = state.chosenFile;
  if (!file) return flash('Сначала выберите файл.', 'info');
  const extension = file.name.split('.').pop().toLowerCase();
  const url = URL.createObjectURL(file);
  if (['pdf','jpg','jpeg','png','webp','gif','bmp','txt'].includes(extension)) {
    const tab = window.open(url, '_blank');
    if (!tab) flash('Браузер заблокировал новую вкладку. Разрешите всплывающие окна для сайта.', 'bad');
    else flash('Файл открыт. Используйте Ctrl+P и выберите принтер в системном диалоге. Настройки Canon Studio в этом режиме не применяются.', 'info');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    flash('Офисный документ сохранён. Откройте его в Word/LibreOffice и распечатайте либо подключите агент.', 'info');
  }
  // Do not revoke immediately: the newly opened tab/download still needs the blob.
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// These actions exist only in the locally served UI, never reveal pairing codes over Vercel.
export async function showLocalPairCode() {
  if (state.mode !== 'local') return;
  try {
    const result = await api('/api/pairing/code');
    $('pairCodeText').textContent = `Код: ${result.code} (5 минут)`;
  } catch (error) { flash('Не удалось получить код: ' + error.message, 'bad'); }
}

export async function revokePairings() {
  if (state.mode !== 'local') return;
  if (!confirm('Отключить все ранее подключённые сайты?')) return;
  try {
    await api('/api/pairing/revoke', { method: 'POST' });
    $('pairCodeText').textContent = 'Все подключения отозваны';
    flash('Доступ сайтов к этому Agent отключён.', 'good');
  } catch (error) { flash(error.message, 'bad'); }
}
