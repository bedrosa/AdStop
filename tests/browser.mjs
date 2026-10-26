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
const server = createServer(async (request, response) => {
  requests.push({ host: request.headers.host, url: request.url });
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (request.url === '/playback.webm') {
    response.writeHead(200, { 'content-type': 'video/webm' }).end(await readFile('tests/fixtures/playback.webm'));
    return;
  }
  if (request.url.startsWith('/youtubei/v1/')) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requestBody: body ? JSON.parse(body) : null, adPlacements: [{ ad: true }], adSlots: [1], playerAds: [1], auxiliaryUi: { messageRenderers: { bkaEnforcementMessageViewModel: { title: 'Aviso antibloqueo' }, notificationRenderer: { title: 'Notificación' } } }, videoDetails: { title: 'Contenido de prueba' }, streamingData: { formats: [] } }));
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
  await worker.evaluate(() => {
    const original = chrome.action.setIcon.bind(chrome.action);
    globalThis.adstopIcons = {};
    chrome.action.setIcon = async details => {
      await original(details);
      globalThis.adstopIcons[details.tabId ?? 'default'] = details.path;
    };
  });
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
  await check('el icono cambia a gris al pausar o permitir una web y vuelve a rojo al reactivar', async () => {
    const waitForIcon = expected => worker.evaluate(async ({ tabId, expected }) => {
      const deadline = Date.now() + 5000;
      while (globalThis.adstopIcons[tabId]?.[32] !== expected) {
        if (Date.now() > deadline) throw new Error(`Icono inesperado: ${JSON.stringify(globalThis.adstopIcons[tabId])}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }, { tabId, expected });
    await save(initial.settings);
    await waitForIcon('icons/32.png');
    const allowed = await ui.evaluate(url => chrome.runtime.sendMessage({ type: 'toggleSite', url }), page.url());
    assert.equal(allowed.ok, true, allowed.error);
    await waitForIcon('icons/32-off.png');
    for (let reload = 0; reload < 3; reload++) {
      await worker.evaluate(tabId => { delete globalThis.adstopIcons[tabId]; }, tabId);
      await page.reload();
      await waitForIcon('icons/32-off.png');
    }
    await save(initial.settings);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#power').getAttribute('aria-pressed') === 'true');
    await popup.locator('#power').click();
    await popup.waitForFunction(() => !document.querySelector('#power').disabled && document.querySelector('#power').classList.contains('off'));
    await waitForIcon('icons/32-off.png');
    await worker.evaluate(tabId => { delete globalThis.adstopIcons[tabId]; }, tabId);
    await page.reload();
    await waitForIcon('icons/32-off.png');
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector('#power').disabled && document.querySelector('#power').classList.contains('off'));
    await popup.locator('#power').click();
    await popup.waitForFunction(() => !document.querySelector('#power').disabled && !document.querySelector('#power').classList.contains('off'));
    await waitForIcon('icons/32.png');
    await popup.close();
    await save({ ...initial.settings, allowlist: ['permitida.adstop.test'] });
    await waitForIcon('icons/32.png');
    await page.goto(`http://permitida.adstop.test:${port}/`);
    await waitForIcon('icons/32-off.png');
    await page.goto(`http://www.adstop.test:${port}/`);
    await waitForIcon('icons/32.png');
    await save({ ...initial.settings, enabled: false });
    await waitForIcon('icons/32-off.png');
    assert.equal(await worker.evaluate(() => globalThis.adstopIcons.default[32]), 'icons/32-off.png');
    await worker.evaluate(tabId => { delete globalThis.adstopIcons[tabId]; }, tabId);
    await page.reload();
    await waitForIcon('icons/32-off.png');
    await save(initial.settings);
    await waitForIcon('icons/32.png');
    assert.deepEqual(await ui.evaluate(() => chrome.action.getBadgeBackgroundColor({})), [82, 96, 120, 255]);
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
    assert.equal(await page.evaluate(() => window.__adstopYoutube), undefined);
    assert.equal(await page.evaluate(() => window.ytInitialPlayerResponse.adPlacements), undefined);
    const data = await page.evaluate(async () => {
      const fetched = await (await fetch('/youtubei/v1/player')).json();
      const watch = await (await fetch('/youtubei/v1/get_watch?prettyPrint=false')).json();
      const xhr = await new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('GET', '/youtubei/v1/player');
        request.responseType = 'json';
        request.onload = () => resolve(request.response);
        request.send();
      });
      return { fetched, watch, xhr };
    });
    for (const [transport, response] of Object.entries(data)) {
      assert.equal(response.adPlacements, undefined, `${transport}: ${JSON.stringify(response)}`);
      assert.equal(response.playerAds, undefined, `${transport}: ${JSON.stringify(response)}`);
      assert.equal(response.videoDetails.title, 'Contenido de prueba');
      assert.equal(response.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel, undefined);
      assert.equal(response.auxiliaryUi.messageRenderers.notificationRenderer.title, 'Notificación');
    }
  });
  await check('YouTube conserva las pruebas de JSON y fetch sintéticos sin alterar sus datos', async () => {
    const result = await page.evaluate(async () => {
      const text = '{"adPlacements":[1],"adSlots":[2],"playerAds":[3],"number":4}';
      const parsed = JSON.parse(text, (key, value) => key === 'number' ? value + 1 : value);
      const synthetic = await new Response(text).json();
      const request = new Request(`data:application/json,${encodeURIComponent(text)}`);
      Object.defineProperty(request, 'url', { value: `${location.origin}/youtubei/v1/player` });
      const bait = await (await fetch(request)).json();
      return { parsed, synthetic, bait, nativeParse: JSON.parse.toString().includes('[native code]'), nativeFetch: Function.prototype.toString.call(fetch).includes('[native code]'), nativeXhr: Function.prototype.toString.call(XMLHttpRequest.prototype.open).includes('[native code]') };
    });
    assert.deepEqual(result.parsed, { adPlacements: [1], adSlots: [2], playerAds: [3], number: 5 });
    for (const value of [result.synthetic, result.bait]) assert.deepEqual(value, { adPlacements: [1], adSlots: [2], playerAds: [3], number: 4 });
    assert.equal(result.nativeParse, true);
    assert.equal(result.nativeFetch, true);
    assert.equal(result.nativeXhr, true);
  });
  await check('YouTube resuelve la comprobación publicitaria con un script local', async () => {
    const loaded = await page.evaluate(() => new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'http://static.doubleclick.net/instream/ad_status.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.append(script);
    }));
    assert.equal(loaded, true);
    assert.equal(await page.evaluate(() => window.google_ad_status), 1);
    assert.equal(requests.some(request => request.host.startsWith('static.doubleclick.net')), false);
  });
  await check('YouTube cierra el aviso antibloqueo y reanuda el reproductor sin cerrar otros diálogos', async () => {
    await page.evaluate(() => {
      const player = document.querySelector('#movie_player');
      player.playVideo = () => { window.adstopPlaybackResumed = true; };
      const unrelated = document.createElement('div');
      unrelated.id = 'notification-dialog';
      unrelated.setAttribute('role', 'dialog');
      unrelated.textContent = 'Notificaciones';
      document.body.append(unrelated);
      const message = document.createElement('ytd-enforcement-message-view-model');
      message.textContent = 'Los bloqueadores de anuncios no se permiten en YouTube';
      const close = document.createElement('button');
      close.id = 'dismiss-button';
      close.textContent = 'Cerrar';
      close.onclick = () => { message.remove(); };
      message.append(close);
      document.body.append(message);
    });
    await page.waitForFunction(() => window.adstopPlaybackResumed && !document.querySelector('ytd-enforcement-message-view-model'));
    assert.equal(await page.locator('#notification-dialog').isVisible(), true);
  });
  await check('YouTube salta anuncios sin alterar la velocidad ni el audio del contenido', async () => {
    await page.evaluate(() => {
      const video = document.querySelector('video');
      Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
      video.playbackRate = 1.25;
      video.muted = false;
      document.querySelector('#movie_player').classList.add('ad-showing');
      document.querySelector('button').onclick = () => {
        window.adstopSkipped = true;
        document.querySelector('#movie_player').classList.remove('ad-showing');
      };
    });
    await page.waitForFunction(() => window.adstopSkipped === true);
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.25);
    assert.equal(await page.locator('video').evaluate(video => video.muted), false);
    await page.locator('video').evaluate(video => { delete video.duration; });
  });
  await check('YouTube reproduce fotogramas reales después del salto y de cambiar de vídeo', async () => {
    await page.bringToFront();
    await page.evaluate(async () => {
      const video = document.querySelector('video');
      video.src = '/playback.webm';
      video.loop = true;
      video.muted = true;
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= 5);
    const before = await page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    await page.waitForFunction(before => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= before + 5, before);
    await page.evaluate(async () => {
      const old = document.querySelector('video');
      const next = old.cloneNode();
      old.pause();
      old.replaceWith(next);
      next.muted = true;
      next.playbackRate = 1;
      document.querySelector('#movie_player').classList.add('ad-showing');
      await next.play();
    });
    await page.waitForFunction(() => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= 5);
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
    await page.locator('video').evaluate(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    await page.locator('#movie_player').evaluate(player => player.classList.remove('ad-showing'));
  });
  await check('YouTube recupera el error visible mientras la reproducción continúa de fondo', async () => {
    for (const modern of [false, true]) {
      const broken = await context.newPage();
      await broken.goto(`http://www.youtube.com:${port}/watch?v=error-video`);
      await broken.bringToFront();
      await broken.evaluate(async modern => {
        const player = document.querySelector('#movie_player');
        player.getPlayerResponse = () => ({ videoDetails: { videoId: 'error-video' }, playabilityStatus: { status: 'OK' } });
        player.loadVideoById = (id, position) => { window.adstopErrorRecovery = { id, position }; };
        const error = document.createElement(modern ? 'yt-playability-error-supported-renderers' : 'div');
        if (modern) {
          error.id = 'error-screen';
          const watch = document.createElement('ytd-watch-flexy');
          watch.append(error);
          document.body.append(watch);
        } else {
          error.className = 'ytp-error-content-wrap';
          player.append(error);
          player.classList.add('ytp-error');
        }
        error.textContent = 'Se ha producido un problema. Vuelve a intentarlo más tarde. 282054944';
        const video = player.querySelector('video');
        video.src = '/playback.webm';
        video.muted = true;
        await video.play();
      }, modern);
      await broken.waitForFunction(() => window.adstopErrorRecovery?.id === 'error-video');
      const recovery = await broken.evaluate(() => window.adstopErrorRecovery);
      assert.ok(recovery.position >= 1, JSON.stringify(recovery));
      assert.equal(await broken.locator(modern ? '#error-screen' : '.ytp-error-content-wrap').isVisible(), true);
      await broken.close();
    }
  });
  await check('YouTube reintenta el bloqueo y adapta las solicitudes reales del mismo vídeo', async () => {
    await page.evaluate(() => {
      const player = document.querySelector('#movie_player');
      player.getPlayerResponse = () => ({ videoDetails: { videoId: 'video-1' }, playabilityStatus: { status: 'UNPLAYABLE', errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ navigationEndpoint: { commandMetadata: { webCommandMetadata: { webPageType: 'WEB_PAGE_TYPE_UNKNOWN', url: 'https://support.google.com/youtube/answer/3037019' } } } }] } } } } });
      player.loadVideoById = (id, position) => { window.adstopReloadedVideo = { id, position }; };
    });
    await page.waitForFunction(() => window.adstopReloadedVideo?.id === 'video-1');
    const data = await page.evaluate(async () => {
      const body = JSON.stringify({ videoId: 'video-1', context: { client: { clientName: 'WEB' } }, playbackContext: { contentPlaybackContext: { signatureTimestamp: 123 } } });
      const fetchResponse = await (await fetch(new Request(`${location.origin}/youtubei/v1/player`, { method: 'POST', body }))).json();
      const watch = await (await fetch('/youtubei/v1/get_watch', { method: 'POST', body })).json();
      const xhr = await new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('POST', '/youtubei/v1/player');
        request.responseType = 'json';
        request.onload = () => resolve(request.response);
        request.send(body);
      });
      const other = await (await fetch('/youtubei/v1/player', { method: 'POST', body: body.replace('video-1', 'video-2') })).json();
      const license = await (await fetch('/youtubei/v1/player/get_drm_license', { method: 'POST', body })).json();
      return { fetchResponse, watch, xhr, other, license };
    });
    for (const response of [data.fetchResponse, data.watch, data.xhr]) {
      assert.equal(response.requestBody.context.client.clientScreen, 'CHANNEL');
      assert.equal(response.requestBody.playbackContext.contentPlaybackContext.signatureTimestamp, 123);
      assert.equal(response.adPlacements, undefined);
    }
    assert.equal(data.other.requestBody.context.client.clientScreen, undefined);
    assert.equal(data.license.requestBody.context.client.clientScreen, undefined);
    assert.deepEqual(data.license.adSlots, [1]);
    await page.evaluate(() => { delete document.querySelector('#movie_player').getPlayerResponse; });
  });
  await check('YouTube recupera el 282054944 detenido, sin metadatos ni reproducción de fondo', async () => {
    for (const modern of [false, true]) {
      const stopped = await context.newPage();
      await stopped.goto(`http://www.youtube.com:${port}/watch?v=stopped-video`);
      await stopped.bringToFront();
      await stopped.evaluate(modern => {
        const player = document.querySelector('#movie_player');
        player.getPlayerResponse = () => ({ playabilityStatus: { status: 'ERROR' } });
        if (modern) player.querySelector('video').remove();
        player.loadVideoById = (id, position) => {
          window.adstopStoppedRecovery = { id, position };
          (async () => {
            const response = await (await fetch('/youtubei/v1/player', { method: 'POST', body: JSON.stringify({ videoId: id, context: { client: { clientName: 'WEB' } }, playbackContext: { contentPlaybackContext: { referer: location.href } } }) })).json();
            window.adstopRecoveryBody = response.requestBody;
            const video = player.querySelector('video') || player.appendChild(document.createElement('video'));
            video.src = '/playback.webm';
            video.muted = false;
            await video.play();
            document.querySelector('.ytp-error-content-wrap, #error-screen').remove();
            player.classList.remove('ytp-error');
            window.adstopStoppedReady = true;
          })().catch(error => { window.adstopStoppedFailure = error.message; });
        };
        const error = document.createElement(modern ? 'yt-playability-error-supported-renderers' : 'div');
        error.textContent = 'Se ha producido un error. Vuelve a intentarlo más tarde. 282054944';
        if (modern) {
          error.id = 'error-screen';
          const watch = document.createElement('ytd-watch-flexy');
          watch.append(error);
          document.body.append(watch);
        } else {
          error.className = 'ytp-error-content-wrap';
          player.append(error);
          player.classList.add('ytp-error');
        }
      }, modern);
      await stopped.waitForFunction(() => window.adstopStoppedReady || window.adstopStoppedFailure);
      const result = await stopped.evaluate(() => ({ recovery: window.adstopStoppedRecovery, body: window.adstopRecoveryBody, error: window.adstopStoppedFailure }));
      assert.equal(result.error, undefined);
      assert.deepEqual(result.recovery, { id: 'stopped-video', position: 0 });
      assert.equal(result.body.context.client.clientScreen, 'CHANNEL');
      assert.match(result.body.playbackContext.contentPlaybackContext.lactMilliseconds, /^\d+$/);
      assert.equal(result.body.playbackContext.contentPlaybackContext.referer, `${stopped.url()}#reloadxhr`);
      await stopped.waitForFunction(() => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames >= 5);
      assert.equal(await stopped.locator('video').evaluate(video => video.muted), false);
      await stopped.close();
    }
  });
  await check('el módulo de YouTube evita duplicar scriptlets y respeta su interruptor', async () => {
    let scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.ok(scripts.find(script => script.id === 'scriptlets').excludeMatches.includes('*://*.youtube.com/*'));
    assert.equal((await save({ ...initial.settings, youtube: false })).ok, true);
    scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.equal(scripts.some(script => script.id === 'youtube'), false);
    assert.equal((scripts.find(script => script.id === 'scriptlets').excludeMatches || []).includes('*://*.youtube.com/*'), false);
    assert.equal((await save(initial.settings)).ok, true);
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
