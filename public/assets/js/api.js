// Standard JSON API wrapper. Errors are shown in the user interface.

export async function api(url, opts = {}) {
  const response = await fetch(url, opts);
  let data;
  try { data = await response.json(); } catch { throw Error(`Ответ сервера: HTTP ${response.status}.`); }
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
