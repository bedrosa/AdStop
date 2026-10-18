import { streamingPlatforms } from '../shared/platforms.js';

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
  document.querySelector('#streaming-platforms').replaceChildren(...streamingPlatforms.map(platform => {
    const label = document.createElement('label');
    label.className = 'platform-row';
    const name = document.createElement('span');
    name.textContent = platform.name;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `platform-${platform.id}`;
    input.setAttribute('role', 'switch');
    input.checked = !(settings.disabledPlatforms || []).includes(platform.id);
    label.append(name, input);
    return label;
  }));
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
  settings.disabledPlatforms = streamingPlatforms.filter(platform => !document.getElementById(`platform-${platform.id}`).checked).map(platform => platform.id);
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

document.querySelector('#reload-extension').addEventListener('click', () => chrome.runtime.reload());

try {
  current = await request({ type: 'status' });
  render();
  if (!Array.isArray(current.settings.disabledPlatforms)) {
    feedback('Hay una actualización pendiente. Recarga AdStop para utilizar estos ajustes.', true);
    document.querySelector('#reload-extension').hidden = false;
    save.disabled = true;
  }
} catch (error) {
  feedback(error.message, true);
  save.disabled = true;
}
