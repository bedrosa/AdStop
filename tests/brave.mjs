import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath = process.env.ADSTOP_BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
await access(executablePath);
const resultsRoot = path.resolve('test-results');
await mkdir(resultsRoot, { recursive: true });
const profile = await mkdtemp(path.join(resultsRoot, 'brave-'));
const extensionPath = path.resolve('dist/chromium');
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': request.url.startsWith('/resource') ? 'application/json' : 'text/html' });
  response.end(request.url.startsWith('/resource') ? '{}' : '<!doctype html><html lang="es"><title>AdStop Brave</title><link rel="icon" href="data:,"><h1>Prueba de AdStop</h1></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'] });
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 20000, predicate: worker => worker.url().startsWith('chrome-extension://') });
  const id = new URL(worker.url()).host;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/options.html`);
  const request = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  const initial = await request({ type: 'status' });
  assert.equal(initial.ok, true, initial.error);
  assert.equal(initial.enabledRules, initial.metadata.networkRules);
  await worker.evaluate(() => {
    const original = chrome.action.setIcon.bind(chrome.action);
    globalThis.adstopIcons = {};
    chrome.action.setIcon = async details => {
      await original(details);
      globalThis.adstopIcons[details.tabId ?? 'default'] = details.path;
    };
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const tabId = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url).id), page.url());
  const fetchResource = () => page.evaluate(url => fetch(url).then(() => true, () => false), `http://127.0.0.1:${port}/resource?${Date.now()}`);
  assert.equal(await fetchResource(), true);
  assert.equal((await request({ type: 'save', settings: { ...initial.settings, blockedDomains: ['127.0.0.1'] } })).ok, true);
  await page.reload();
  assert.equal(await fetchResource(), false);
  const stats = await request({ type: 'pageStats', tabId });
  assert.deepEqual(stats.page, { total: 1, domains: [{ domain: '127.0.0.1', count: 1 }], other: 0 });
  assert.equal(await ui.evaluate(tabId => chrome.action.getBadgeText({ tabId }), tabId), '1');
  assert.equal((await request({ type: 'save', settings: { ...initial.settings, blockedDomains: ['127.0.0.1'], allowlist: ['127.0.0.1'] } })).ok, true);
  assert.equal(await worker.evaluate(tabId => globalThis.adstopIcons[tabId][32], tabId), 'icons/32-off.png');
  await worker.evaluate(tabId => { delete globalThis.adstopIcons[tabId]; }, tabId);
  await page.reload();
  await worker.evaluate(async tabId => {
    const deadline = Date.now() + 5000;
    while (globalThis.adstopIcons[tabId]?.[32] !== 'icons/32-off.png') {
      if (Date.now() > deadline) throw new Error('El icono no se mantiene gris al recargar');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }, tabId);
  assert.equal(await fetchResource(), true);
  assert.equal((await request({ type: 'pageStats', tabId })).page.total, 0);
  assert.equal((await request({ type: 'save', settings: { ...initial.settings, enabled: false } })).enabledRules, 0);
  assert.equal(await worker.evaluate(() => globalThis.adstopIcons.default[32]), 'icons/32-off.png');
  await page.reload();
  assert.equal(await fetchResource(), true);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await ui.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await popup.reload();
  await popup.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await ui.getByRole('button', { name: 'Activar modo claro' }).click();
  await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal((await request({ type: 'save', settings: initial.settings })).ok, true);
  await context.route('https://www.youtube.com/watch?v=adstop-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube de prueba</title><div id="movie_player"><video></video></div>' }));
  await page.goto('https://www.youtube.com/watch?v=adstop-test');
  const youtube = await page.evaluate(async () => {
    const text = '{"adPlacements":[1],"adSlots":[2],"playerAds":[3]}';
    const request = new Request(`data:application/json,${encodeURIComponent(text)}`);
    Object.defineProperty(request, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
    const synthetic = await (await fetch(request)).json();
    const probe = await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://static.doubleclick.net/instream/ad_status.js';
      script.onload = () => resolve(window.google_ad_status);
      script.onerror = () => resolve(false);
      document.head.append(script);
    });
    return { parsed: JSON.parse(text), synthetic, probe };
  });
  assert.deepEqual(youtube.parsed, { adPlacements: [1], adSlots: [2], playerAds: [3] });
  assert.deepEqual(youtube.synthetic, youtube.parsed);
  assert.equal(youtube.probe, false);
  await context.route('https://www.youtube.com/playback.webm', route => route.fulfill({ contentType: 'video/webm', path: 'tests/fixtures/playback.webm' }));
  await page.bringToFront();
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    video.src = '/playback.webm';
    video.loop = true;
    video.muted = true;
    video.playbackRate = 1.25;
    const skip = document.createElement('button');
    skip.className = 'ytp-ad-skip-button';
    skip.textContent = 'Saltar';
    skip.onclick = () => document.querySelector('#movie_player').classList.remove('ad-showing');
    document.querySelector('#movie_player').append(skip);
    document.querySelector('#movie_player').classList.add('ad-showing');
    await video.play();
  });
  await page.waitForFunction(() => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= 5);
  const frames = await page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
  await page.waitForFunction(frames => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= frames + 5, frames);
  await page.waitForFunction(() => !document.querySelector('#movie_player').classList.contains('ad-showing'));
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.25);
  assert.equal((await request({ type: 'save', settings: { ...initial.settings, youtube: false } })).ok, true);
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.equal(scripts.some(script => script.id === 'youtube'), false);
  assert.equal((scripts.find(script => script.id === 'scriptlets').excludeMatches || []).includes('*://*.youtube.com/*'), false);
  await writeFile(path.join(resultsRoot, 'brave-checks.json'), JSON.stringify({ browser: await context.browser().version(), checks: ['Instalación', 'Listas completas', 'Bloqueo dinámico', 'Excepciones', 'Pausa general', 'Modo oscuro compartido y guardado', 'Icono gris al desactivar', 'YouTube con los filtros de las listas', 'Decodificación real de vídeo tras saltar un anuncio sin alterar su velocidad', 'Interruptor de YouTube conserva las listas'], livePlatformsTested: false }, null, 2));
  console.log('Brave: bloqueo, ajustes, iconos y reproducción de YouTube comprobados');
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  if (!profile.startsWith(resultsRoot + path.sep)) throw new Error('Perfil temporal fuera del directorio de pruebas');
  await rm(profile, { recursive: true, force: true });
}
