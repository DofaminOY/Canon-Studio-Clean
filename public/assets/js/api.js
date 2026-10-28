// A single API used by the bundled local UI and the cloud UI after explicit pairing.
let baseUrl = '';
export function setApiBase(value = '') {
  baseUrl = value;
}
export function getApiBase() { return baseUrl; }
export async function api(url, opts = {}) {
  const response = await fetch(baseUrl + url, opts);
  let data;
  try { data = await response.json(); } catch { throw Error(`Ответ сервера: HTTP ${response.status}.`); }
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
export function apiUrl(url) { return baseUrl + url; }
