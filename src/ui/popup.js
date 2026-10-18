import { siteEnabled } from '../shared/settings.js';

let current;
let tab;
let blockSnapshot;
let needsReload = false;
const error = document.querySelector('#error');
const power = document.querySelector('#power');

async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) {
    if (message.type === 'pageStats' && result.error === 'Operacion no reconocida') {
      requireReload();
      throw new Error('Hay una actualización pendiente. Recarga AdStop para activar el contador.');
    }
    throw new Error(result.error);
  }
  return result;
}

function requireReload() {
  needsReload = true;
  error.textContent = 'Hay una actualización pendiente. Recarga AdStop para activar el contador.';
  document.querySelector('#reload-extension').hidden = false;
  document.querySelector('#blocked-empty').textContent = 'El contador estará disponible al recargar AdStop';
  power.disabled = true;
}

function render() {
  const { settings } = current;
  let hostname;
  try {
    const url = new URL(tab?.url);
    if (['http:', 'https:'].includes(url.protocol)) hostname = url.hostname;
  } catch {}
  const active = hostname && siteEnabled(settings, hostname);
  document.querySelector('#hostname').textContent = hostname || 'Página del navegador';
  power.disabled = needsReload || !hostname || !settings.enabled;
  power.classList.toggle('off', !active);
  power.setAttribute('aria-pressed', String(Boolean(active)));
  document.querySelector('#site-status').textContent = !settings.enabled ? 'Protección pausada' : !hostname ? 'Listo para navegar' : active ? 'Protección activa' : 'Web permitida';
  document.querySelector('#site-help').textContent = !hostname ? 'Abre una web para controlar su protección.' : !settings.enabled ? 'Activa la protección general para continuar.' : active ? 'Pulsa para permitir anuncios en esta web.' : 'Pulsa para volver a bloquear en esta web.';
  renderBlocks();
}

function renderBlocks() {
  document.querySelector('#total-count').textContent = (current.totalBlocked || 0).toLocaleString('es-ES');
  const page = current.page || { total: 0, domains: [], other: 0 };
  const snapshot = JSON.stringify(page);
  if (snapshot === blockSnapshot) return;
  blockSnapshot = snapshot;
  document.querySelector('#blocked-count').textContent = page.total.toLocaleString('es-ES');
  const entries = [...page.domains];
  if (page.other) entries.push({ domain: 'Otros dominios', count: page.other });
  const list = document.querySelector('#blocked-list');
  const scrollTop = list.scrollTop;
  list.replaceChildren(...entries.map(entry => {
    const row = document.createElement('li');
    const domain = document.createElement('span');
    domain.textContent = entry.domain;
    domain.title = entry.domain;
    const count = document.createElement('strong');
    count.textContent = entry.count.toLocaleString('es-ES');
    row.append(domain, count);
    return row;
  }));
  list.scrollTop = scrollTop;
  document.querySelector('#blocked-empty').hidden = page.total > 0;
}

async function mutate(message, reload) {
  power.disabled = true;
  error.textContent = '';
  try {
    current = await request(message);
    if (reload && tab?.id) await chrome.tabs.reload(tab.id);
    Object.assign(current, await request({ type: 'pageStats', tabId: tab?.id }));
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    render();
  }
}

power.addEventListener('click', () => mutate({ type: 'toggleSite', url: tab.url }, true));
document.querySelector('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#reload-extension').addEventListener('click', () => chrome.runtime.reload());

try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  current = await request({ type: 'status', tabId: tab?.id });
  render();
  if (!current.page || !Number.isSafeInteger(current.totalBlocked)) requireReload();
} catch (cause) {
  error.textContent = cause.message;
}

let refreshing = false;
setInterval(async () => {
  if (!current || needsReload || refreshing) return;
  refreshing = true;
  try {
    Object.assign(current, await request({ type: 'pageStats', tabId: tab?.id }));
    renderBlocks();
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    refreshing = false;
  }
}, 1000);
