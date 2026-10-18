import { defaults } from '../shared/settings.js';

const toggles = ['enabled', 'cosmetic', 'scriptlets', 'youtube', 'twitch', 'extended'];
const lists = ['allowlist', 'blockedDomains'];
const message = document.querySelector('#message');
const save = document.querySelector('#save');
let current;

async function request(value) {
  const result = await chrome.runtime.sendMessage(value);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function feedback(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}

function render() {
  const { metadata, settings, extendedActive } = current;
  for (const key of toggles) document.getElementById(key).checked = settings[key];
  for (const key of lists) document.getElementById(key).value = settings[key].join('\n');
  document.querySelector('#customCss').value = settings.customCss;
  document.querySelector('#coverage').textContent = !settings.enabled ? 'La protección está pausada' : extendedActive ? 'Cobertura ampliada activa' : 'Cobertura base activa';
  document.querySelector('#filter-date').textContent = `Actualización de listas: ${new Date(metadata.updatedAt).toLocaleString('es-ES')}`;
  document.querySelector('#version').textContent = metadata.version;
  document.querySelector('#sources').replaceChildren(...metadata.sources.map(source => {
    const element = document.createElement('div');
    element.className = 'source';
    const link = document.createElement('a');
    link.href = source.homepage;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.name;
    const license = document.createElement('small');
    license.textContent = source.license;
    element.append(link, license);
    return element;
  }));
}

function readForm() {
  const settings = { ...current.settings };
  for (const key of toggles) settings[key] = document.getElementById(key).checked;
  for (const key of lists) settings[key] = document.getElementById(key).value.split('\n').map(line => line.trim()).filter(Boolean);
  settings.customCss = document.querySelector('#customCss').value;
  for (const line of settings.customCss.split('\n').filter(line => line.trim())) {
    const index = line.indexOf('##');
    if (index < 1 || !CSS.supports(`selector(${line.slice(index + 2)})`)) throw new Error(`Selector CSS no válido: ${line}`);
  }
  return settings;
}

document.querySelector('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  save.disabled = true;
  try {
    current = await request({ type: 'save', settings: readForm() });
    render();
    feedback('Cambios guardados. Recarga las webs abiertas para aplicarlos por completo.');
  } catch (error) {
    feedback(error.message, true);
  } finally {
    save.disabled = false;
  }
});

document.querySelector('#refresh').addEventListener('click', async () => {
  try {
    await request({ type: 'refresh' });
    feedback('Cuota revisada. Recarga esta página para ver las cifras actualizadas.');
  } catch (error) {
    feedback(error.message, true);
  }
});

document.querySelector('#export').addEventListener('click', async () => {
  try {
    const result = await request({ type: 'status' });
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'adstop-settings', version: 1, settings: result.settings }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adstop-ajustes.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    feedback(error.message, true);
  }
});

document.querySelector('#import').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 200000) throw new Error('El archivo de ajustes es demasiado grande');
    const imported = JSON.parse(await file.text());
    if (imported.format !== 'adstop-settings' || imported.version !== 1 || !imported.settings) throw new Error('El archivo no es una copia de ajustes de AdStop');
    current = await request({ type: 'save', settings: { ...defaults, ...imported.settings } });
    render();
    feedback('Ajustes importados. Recarga las webs abiertas para aplicarlos.');
  } catch (error) {
    feedback(error.message, true);
  } finally {
    event.target.value = '';
  }
});

try {
  current = await request({ type: 'status' });
  render();
} catch (error) {
  feedback(error.message, true);
  save.disabled = true;
}
