import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const resultsRoot = path.resolve('test-results');
await mkdir(resultsRoot, { recursive: true });
const profile = await mkdtemp(path.join(resultsRoot, 'chromium-'));
const requests = [];
const checks = [];
const server = createServer((request, response) => {
  requests.push({ host: request.headers.host, url: request.url });
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (request.url.startsWith('/youtubei/v1/')) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ adPlacements: [{ ad: true }], adSlots: [1], playerAds: [1], videoDetails: { title: 'Contenido de prueba' }, streamingData: { formats: [] } }));
    return;
  }
  if (request.url.startsWith('/resource.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }).end('window.adstopResourceLoaded = true');
    return;
  }
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end('window.ytInitialPlayerResponse = {adPlacements:[1],adSlots:[2],playerAds:[3],videoDetails:{title:"Contenido"}}; window.adstopContentLoaded = true;');
    return;
  }
  const isVideo = /youtube\.com|twitch\.tv/.test(request.headers.host);
  response.writeHead(200, { 'content-type': 'text/html', ...(isVideo ? {} : { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'none'; connect-src *" }) });
  response.end('<!doctype html><html lang="es"><head><title>AdStop Fixture</title><script src="/fixture.js"></script></head><body><h1>Contenido de prueba</h1><div class="adsbygoogle" id="ad">Publicidad</div><div id="personal">Elemento personal</div><div id="movie_player"><video></video><button class="ytp-ad-skip-button">Saltar</button></div></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let context;

async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`Correcto: ${name}`);
}

try {
  const extensionPath = path.resolve('dist/chromium');
  const launchOptions = {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-proxy-server', '--host-resolver-rules=MAP *.adstop.test 127.0.0.1, MAP ads.doubleclick.net 127.0.0.1, MAP www.youtube.com 127.0.0.1, MAP www.twitch.tv 127.0.0.1, MAP www.netflix.com 127.0.0.1, MAP tune.pk 127.0.0.1'],
    viewport: { width: 1200, height: 900 }
  };
  context = await chromium.launchPersistentContext(profile, launchOptions);
  let worker;
  try {
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  } catch (error) {
    const diagnostics = await context.newPage();
    await diagnostics.goto('chrome://extensions/');
    console.log(await diagnostics.evaluate(() => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, resolve))));
    throw error;
  }
  const id = new URL(worker.url()).host;
  const ui = await context.newPage();
  const uiErrors = [];
  ui.on('pageerror', error => uiErrors.push(error.message));
  await ui.goto(`chrome-extension://${id}/options.html`);
  const startup = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  assert.equal(startup.ok, true, startup.error);
  await ui.waitForFunction(() => document.querySelector('#version').textContent !== '');
  const status = () => ui.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  const save = settings => ui.evaluate(settings => chrome.runtime.sendMessage({ type: 'save', settings }), settings);
  const initial = await status();
  const metadata = JSON.parse(await readFile('dist/chromium/data/metadata.json', 'utf8'));
  await check('carga de la extensión y cuota ampliada', async () => {
    assert.equal(initial.ok, true);
    assert.equal(initial.enabledRules, metadata.networkRules);
    assert.ok(metadata.scriptletRules > 1000);
    const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.deepEqual(registered.map(script => script.id).sort(), ['scriptlets', 'twitch', 'youtube']);
  });

  const page = await context.newPage();
  await page.goto(`http://www.adstop.test:${port}/`);
  const tabId = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url).id), page.url());
  const stats = () => ui.evaluate(tabId => chrome.runtime.sendMessage({ type: 'pageStats', tabId }), tabId);
  await page.waitForFunction(() => window.adstopContentLoaded === true);
  await check('oculta anuncios con una política CSP que prohíbe estilos inline', async () => {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#ad')).display === 'none');
    assert.equal(await page.locator('h1').isVisible(), true);
  });
  const tryRequest = () => page.evaluate(url => fetch(url).then(() => true, () => false), `http://ads.doubleclick.net:${port}/resource.js?${Date.now()}`);
  await check('bloquea solicitudes reales antes de llegar al servidor', async () => {
    assert.equal((await stats()).page.total, 0);
    assert.equal(await tryRequest(), false);
    assert.equal(requests.some(request => request.host.startsWith('ads.doubleclick.net')), false);
    assert.deepEqual((await stats()).page, { total: 1, domains: [{ domain: 'ads.doubleclick.net', count: 1 }], other: 0 });
    assert.equal(await ui.evaluate(tabId => chrome.action.getBadgeText({ tabId }), tabId), '1');
  });
  await check('el contador distingue solicitudes y pestañas', async () => {
    await tryRequest();
    await tryRequest();
    assert.equal((await stats()).page.total, 3);
    const other = await context.newPage();
    await other.goto(`http://www.adstop.test:${port}/otra`);
    const otherId = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url).id), other.url());
    const otherStats = await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: 'pageStats', tabId }), otherId);
    assert.equal(otherStats.page.total, 0);
    assert.equal((await stats()).page.total, 3);
    await other.close();
  });
  await check('una excepción restaura recursos y filtros visuales', async () => {
    const result = await save({ ...initial.settings, allowlist: ['adstop.test'] });
    assert.equal(result.ok, true, result.error);
    await page.reload();
    await page.waitForFunction(() => window.adstopContentLoaded === true);
    assert.equal(await page.locator('#ad').isVisible(), true);
    assert.equal(await tryRequest(), true);
    assert.equal((await stats()).page.total, 0);
  });
  await check('los dominios personales se bloquean con reglas dinámicas', async () => {
    const result = await save({ ...initial.settings, blockedDomains: ['static.adstop.test'] });
    assert.equal(result.ok, true, result.error);
    await page.reload();
    const loaded = await page.evaluate(url => fetch(url).then(() => true, () => false), `http://static.adstop.test:${port}/resource.js`);
    assert.equal(loaded, false);
    assert.deepEqual((await stats()).page, { total: 1, domains: [{ domain: 'static.adstop.test', count: 1 }], other: 0 });
  });
  await check('los elementos personales se ocultan al recargar', async () => {
    const result = await save({ ...initial.settings, customCss: 'adstop.test###personal' });
    assert.equal(result.ok, true, result.error);
    await page.reload();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#personal')).display === 'none');
  });
  await check('el interruptor general desactiva filtros y scripts', async () => {
    const result = await save({ ...initial.settings, enabled: false });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.enabledRules, 0);
    await page.reload();
    assert.equal(await page.locator('#ad').isVisible(), true);
    assert.equal(await tryRequest(), true);
    assert.equal((await stats()).page.total, 0);
    assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
    assert.equal((await save(initial.settings)).ok, true);
  });
  await check('una configuración inválida conserva los ajustes anteriores', async () => {
    const result = await save({ ...initial.settings, allowlist: ['dominio.com/ruta'] });
    assert.equal(result.ok, false);
    assert.deepEqual((await status()).settings.allowlist, []);
  });
  await check('los scriptlets de las listas se ejecutan y respetan sus ámbitos', async () => {
    await page.goto(`http://tune.pk:${port}/`);
    assert.equal(await page.evaluate(() => window.ad_blocker), false);
    await page.goto(`http://www.adstop.test:${port}/`);
    assert.equal(await page.evaluate(() => window.ad_blocker), undefined);
  });
  await check('YouTube limpia respuesta inicial, fetch y XMLHttpRequest', async () => {
    await page.goto(`http://www.youtube.com:${port}/watch?v=adstop-test`);
    await page.waitForFunction(() => window.adstopContentLoaded === true);
    assert.equal(await page.evaluate(() => window.__adstopYoutube), true);
    assert.equal(await page.evaluate(() => window.ytInitialPlayerResponse.adPlacements), undefined);
    const data = await page.evaluate(async () => {
      const fetched = await (await fetch('/youtubei/v1/player')).json();
      const xhr = await new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('GET', '/youtubei/v1/player');
        request.responseType = 'json';
        request.onload = () => resolve(request.response);
        request.send();
      });
      return { fetched, xhr };
    });
    for (const [transport, response] of Object.entries(data)) {
      assert.equal(response.adPlacements, undefined, `${transport}: ${JSON.stringify(response)}`);
      assert.equal(response.playerAds, undefined, `${transport}: ${JSON.stringify(response)}`);
      assert.equal(response.videoDetails.title, 'Contenido de prueba');
    }
  });
  await check('YouTube salta anuncios y restaura velocidad y audio', async () => {
    await page.evaluate(() => {
      const video = document.querySelector('video');
      Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
      video.playbackRate = 1.25;
      video.muted = false;
      document.querySelector('#movie_player').classList.add('ad-showing');
      document.querySelector('button').onclick = () => { window.adstopSkipped = true; };
    });
    await page.waitForFunction(() => window.adstopSkipped === true && document.querySelector('video').muted);
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 16);
    await page.locator('#movie_player').evaluate(player => player.classList.remove('ad-showing'));
    await page.waitForFunction(() => !document.querySelector('video').muted && document.querySelector('video').playbackRate === 1.25);
  });
  await check('el módulo de Twitch se instala al inicio y puede desactivarse', async () => {
    await page.goto(`http://www.twitch.tv:${port}/adstop-test`);
    assert.equal(await page.evaluate(() => window.twitchAdSolutionsVersion), 24);
    assert.equal(typeof await page.evaluate(() => typeof window.simulateAds), 'string');
    const result = await save({ ...initial.settings, twitch: false });
    assert.equal(result.ok, true, result.error);
    await page.reload();
    assert.equal(await page.evaluate(() => window.twitchAdSolutionsVersion), undefined);
    assert.equal((await save(initial.settings)).ok, true);
  });
  await check('ajustes y plataformas desde la interfaz', async () => {
    await ui.reload();
    await ui.waitForFunction(() => document.querySelector('#version').textContent !== '');
    await ui.locator('#allowlist').fill('permitida.adstop.test');
    await ui.locator('#save').click();
    await ui.waitForFunction(() => document.querySelector('#message').textContent.startsWith('Cambios guardados'));
    assert.deepEqual((await status()).settings.allowlist, ['permitida.adstop.test']);
    assert.equal(await ui.locator('#export, #import, #import-file').count(), 0);
    assert.ok(await ui.locator('#streaming-platforms input').count() >= 20);
    assert.equal(await ui.locator('#streaming-platforms > .platform-row').count(), 24);
    assert.equal(await ui.locator('#streaming-platforms #youtube').count(), 1);
    assert.equal(await ui.locator('#streaming-platforms #twitch').count(), 1);
    await ui.locator('#youtube').uncheck();
    await ui.locator('#twitch').uncheck();
    await ui.locator('#platform-netflix').uncheck();
    await ui.locator('#platform-disney').uncheck();
    await ui.locator('#save').click();
    await ui.waitForFunction(() => !document.querySelector('#save').disabled);
    assert.deepEqual((await status()).settings.disabledPlatforms, ['disney', 'netflix']);
    assert.equal((await status()).settings.youtube, false);
    assert.equal((await status()).settings.twitch, false);
    await save(initial.settings);
    await ui.reload();
    await ui.waitForFunction(() => document.querySelector('#version').textContent !== '');
    assert.deepEqual(uiErrors, []);
    assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await ui.screenshot({ path: path.join(resultsRoot, 'options.png'), fullPage: true });
    await ui.setViewportSize({ width: 390, height: 844 });
    assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await ui.screenshot({ path: path.join(resultsRoot, 'options-mobile.png'), fullPage: true });
  });
  await check('Netflix aplica su filtro y respeta el control por plataforma', async () => {
    await page.goto(`http://www.netflix.com:${port}/watch/1`);
    assert.equal(await page.evaluate(() => {
      const data = {};
      const result = Object.defineProperty(data, 'adBreaks', { value: [1], configurable: true });
      return result === data && data.adBreaks.length === 0;
    }), true);
    assert.equal(await tryRequest(), false);
    assert.equal((await save({ ...initial.settings, disabledPlatforms: ['netflix'] })).ok, true);
    await page.reload();
    assert.equal(await page.evaluate(() => Object.defineProperty({}, 'adBreaks', { value: [1] }).adBreaks.length), 1);
    assert.equal(await tryRequest(), true);
    const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.ok(registered.every(script => script.excludeMatches.includes('*://*.netflix.com/*')));
    assert.equal((await save(initial.settings)).ok, true);
  });
  await check('el popup actualiza los contadores sin mostrar dominios publicitarios', async () => {
    await page.goto(`http://www.adstop.test:${port}/`);
    await tryRequest();
    const popup = await context.newPage();
    popup.on('pageerror', error => uiErrors.push(error.message));
    await popup.setViewportSize({ width: 356, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#blocked-count').textContent === '1');
    assert.equal(await popup.locator('#total-count').textContent(), (await status()).totalBlocked.toLocaleString('es-ES'));
    assert.equal(await popup.locator('#blocked-list, #blocked-empty').count(), 0);
    assert.equal((await popup.locator('body').textContent()).includes('ads.doubleclick.net'), false);
    assert.equal(await popup.locator('#network-count, #cosmetic-count').count(), 0);
    assert.equal(await popup.locator('#enabled').count(), 0);
    assert.equal(await popup.locator('#power').isDisabled(), false);
    assert.deepEqual(uiErrors, []);
    await tryRequest();
    await popup.waitForFunction(() => document.querySelector('#blocked-count').textContent === '2');
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#blocked-count').textContent === '2');
    const domains = ['one.adstop.test', 'two.adstop.test', 'three.adstop.test', 'four.adstop.test', 'five.adstop.test'];
    assert.equal((await save({ ...initial.settings, blockedDomains: domains })).ok, true);
    await page.evaluate(async ({ domains, port }) => {
      await Promise.all(domains.map(domain => fetch(`http://${domain}:${port}/resource.js`).catch(() => {})));
    }, { domains, port });
    await popup.waitForFunction(() => document.querySelector('#blocked-count').textContent === '7');
    const popupText = await popup.locator('body').textContent();
    assert.ok(domains.every(domain => !popupText.includes(domain)));
    const accumulated = (await status()).totalBlocked;
    await popup.waitForFunction(total => document.querySelector('#total-count').textContent === total, accumulated.toLocaleString('es-ES'));
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await popup.screenshot({ path: path.join(resultsRoot, 'popup.png'), fullPage: true, animations: 'disabled' });
    const popupHeight = await popup.locator('body').evaluate(body => body.scrollHeight);
    assert.ok(popupHeight <= 600, `El popup ocupa ${popupHeight} pixeles`);
    await page.reload();
    await popup.waitForFunction(() => document.querySelector('#blocked-count').textContent === '0');
    assert.equal((await status()).totalBlocked, accumulated);
    await save(initial.settings);
    await popup.close();
  });
  await check('el modo oscuro se comparte entre popup y ajustes y se conserva al abrirlos', async () => {
    const before = await status();
    const popup = await context.newPage();
    popup.on('pageerror', error => uiErrors.push(error.message));
    await popup.setViewportSize({ width: 356, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await popup.locator('.theme-moon').isVisible(), true);
    assert.equal(await popup.locator('.theme-sun').isVisible(), false);
    await ui.locator('#allowlist').fill('sin-guardar.adstop.test');
    await popup.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await ui.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await popup.locator('.theme-sun').isVisible(), true);
    assert.equal(await popup.locator('.theme-moon').isVisible(), false);
    assert.equal(await popup.locator('#theme-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await popup.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(20, 20, 22)');
    assert.equal(await ui.locator('#allowlist').inputValue(), 'sin-guardar.adstop.test');
    await popup.reload();
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await popup.locator('#site-status').filter({ hasText: /Listo|Protección/ }).waitFor();
    await popup.screenshot({ path: path.join(resultsRoot, 'popup-dark.png'), fullPage: true });
    await ui.setViewportSize({ width: 1200, height: 900 });
    await ui.screenshot({ path: path.join(resultsRoot, 'options-dark.png'), fullPage: true });
    await ui.setViewportSize({ width: 390, height: 844 });
    assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await ui.screenshot({ path: path.join(resultsRoot, 'options-dark-mobile.png'), fullPage: true });
    await ui.getByRole('button', { name: 'Activar modo claro' }).click();
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await popup.locator('.theme-moon').isVisible(), true);
    await ui.locator('#theme-toggle').focus();
    await ui.keyboard.press('Space');
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const after = await status();
    assert.deepEqual(after.settings, before.settings);
    assert.equal(after.totalBlocked, before.totalBlocked);
    assert.deepEqual(uiErrors, []);
    await popup.close();
  });
  await check('una actualización pendiente muestra cómo recargar AdStop', async () => {
    const outdated = await context.newPage();
    await outdated.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async message => {
        const result = await send(message);
        if (message.type === 'status') delete result.page;
        return result;
      };
      chrome.runtime.reload = () => { window.adstopReloadRequested = true; };
    });
    await outdated.goto(`chrome-extension://${id}/popup.html`);
    await outdated.locator('#reload-extension').waitFor({ state: 'visible' });
    assert.ok((await outdated.locator('#error').textContent()).includes('actualización pendiente'));
    assert.equal(await outdated.locator('#power').isDisabled(), true);
    await outdated.locator('#reload-extension').click();
    assert.equal(await outdated.evaluate(() => window.adstopReloadRequested), true);
    await outdated.close();
  });
  await check('el total acumulado se conserva al cerrar y volver a abrir el navegador', async () => {
    const accumulated = (await status()).totalBlocked;
    assert.ok(accumulated > 0);
    await context.close();
    context = await chromium.launchPersistentContext(profile, launchOptions);
    const restored = await context.newPage();
    await restored.goto(`chrome-extension://${id}/options.html`);
    const result = await restored.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
    assert.equal(result.ok, true, result.error);
    assert.equal(result.totalBlocked, accumulated);
    assert.deepEqual(result.page, { total: 0, domains: [], other: 0 });
    await restored.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await restored.getByRole('button', { name: 'Activar modo claro' }).isVisible(), true);
  });
  await writeFile(path.join(resultsRoot, 'browser-checks.json'), JSON.stringify({ browser: await context.browser().version(), checks, livePlatformsTested: false }, null, 2));
  console.log(`${checks.length} comprobaciones de navegador superadas`);
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  if (!profile.startsWith(resultsRoot + path.sep)) throw new Error('Perfil temporal fuera del directorio de pruebas');
  await rm(profile, { recursive: true, force: true });
}
