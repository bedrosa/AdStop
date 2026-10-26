import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { defaults, normalizeDomain, settingsRules, validateSettings, siteEnabled } from '../src/shared/settings.js';
import { matchesScope, selectCosmetic } from '../src/shared/cosmetic.js';
import { cleanPlayerResponse, isPlayerUrl, isAdblockFailure, rewritePlayerRequest } from '../src/shared/youtube.js';
import { parseLists, preprocess, splitRules } from '../scripts/filter-tools.mjs';
import { netflix } from '../src/shared/netflix.js';

test('normaliza dominios sin aceptar rutas ni protocolos ajenos a la web', () => {
  assert.equal(normalizeDomain(' https://WWW.Ejemplo.com/ '), 'www.ejemplo.com');
  assert.equal(normalizeDomain('mañana.es'), 'xn--maana-pta.es');
  for (const value of ['https://ejemplo.com/login', 'javascript:alert(1)', 'https://uno.com@otro.com', 'uno.com?x=1', '*.com', 'uno.com:8000']) assert.throws(() => normalizeDomain(value));
});

test('las excepciones incluyen subdominios sin permitir dominios con prefijos parecidos', () => {
  const settings = { ...defaults, allowlist: ['ejemplo.com'] };
  assert.equal(siteEnabled(settings, 'sub.ejemplo.com'), false);
  assert.equal(siteEnabled(settings, 'falsoejemplo.com'), true);
  assert.equal(siteEnabled({ ...settings, enabled: false }, 'otra.com'), false);
});

test('los controles de streaming permiten desactivar cada plataforma', () => {
  const settings = validateSettings({ ...defaults, disabledPlatforms: ['netflix', 'disney', 'netflix'] });
  assert.deepEqual(settings.disabledPlatforms, ['disney', 'netflix']);
  assert.equal(siteEnabled(settings, 'www.netflix.com'), false);
  assert.equal(siteEnabled(settings, 'www.disneyplus.com'), false);
  assert.equal(siteEnabled(settings, 'www.primevideo.com'), true);
  assert.ok(settingsRules(settings).some(rule => rule.action.type === 'allowAllRequests' && rule.condition.requestDomains.includes('netflix.com')));
  assert.throws(() => validateSettings({ ...defaults, disabledPlatforms: ['desconocida'] }));
  const previous = { ...defaults };
  delete previous.disabledPlatforms;
  assert.deepEqual(validateSettings(previous).disabledPlatforms, []);
});

test('Netflix conserva el contrato de los descriptores y las propiedades del contenido', () => {
  const result = vm.runInNewContext(`
    (${netflix.toString()})();
    const object = {};
    const returned = Object.defineProperty(object, 'adBreaks', { value: [1], configurable: true });
    Object.defineProperty(object, 'currentAdBreak', { value: 'anuncio' });
    Object.defineProperty(object, 'getAdBreaks', { value: () => ['anuncio'] });
    Object.defineProperty(object, 'title', { value: 'Contenido' });
    ({ same: returned === object, empty: object.adBreaks.length === 0, noCurrent: object.currentAdBreak === undefined, getter: object.getAdBreaks(), title: object.title });
  `);
  assert.equal(result.same, true);
  assert.equal(result.empty, true);
  assert.equal(result.noCurrent, true);
  assert.equal(result.getter, undefined);
  assert.equal(result.title, 'Contenido');
});

test('valida ajustes y limita el contenido de los filtros CSS', () => {
  assert.deepEqual(validateSettings({ ...defaults, allowlist: ['UNO.COM', 'uno.com'] }).allowlist, ['uno.com']);
  assert.throws(() => validateSettings({ ...defaults, enabled: 'true' }));
  assert.throws(() => validateSettings({ ...defaults, allowlist: ['dominio.com/ruta'] }));
  assert.throws(() => validateSettings({ ...defaults, customCss: 'uno.com##.anuncio{color:red}' }));
  assert.throws(() => validateSettings({ ...defaults, customCss: 'uno.com##.anuncio/*' }));
  assert.equal(validateSettings({ ...defaults, customCss: 'uno.com##.anuncio' }).customCss, 'uno.com##.anuncio');
});

test('las reglas personales respetan las excepciones y no bloquean la navegación principal', () => {
  const rules = settingsRules({ ...defaults, enabled: false, allowlist: ['uno.com'], blockedDomains: ['ads.uno.com'] });
  assert.equal(rules[0].action.type, 'allowAllRequests');
  assert.ok(rules[1].priority > rules[2].priority);
  assert.deepEqual(rules[2].condition.excludedResourceTypes, ['main_frame']);
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
});

test('los condicionales de las listas no ejecutan ambas ramas', () => {
  assert.deepEqual(preprocess('!#if env_mv3\nuno\n!#if env_firefox\nno\n!#else\ndos\n!#endif\n!#else\nno\n!#endif'), ['uno', 'dos']);
  assert.throws(() => preprocess('!#if env_mv3\nuno'));
});

test('convierte sintaxis de uBlock con argumentos escapados y excepciones', () => {
  const parsed = parseLists([['test', "uno.com##+js(set, valor, false)\nuno.com#@#+js(set, valor, false)\nuno.com##.anuncio:has-text(Publicidad)\n||ads.uno.com^\nuno.com##.banner\nuno.com##.banner"]]);
  assert.equal(parsed.scripts.length, 2);
  assert.equal(parsed.scripts[0].name, 'ubo-set');
  assert.deepEqual(parsed.scripts[0].args, ['valor', 'false']);
  assert.equal(parsed.scripts[1].e, true);
  assert.equal(parsed.cosmetics.rules.length, 2);
  assert.equal(parsed.cosmetics.rules[0].extended, true);
  assert.equal(parsed.network.length, 1);
  assert.equal(parsed.skipped.length, 0);
});

test('aplica ámbitos y excepciones cosméticas antes de construir la hoja de estilos', () => {
  const parsed = parseLists([['test', '##.anuncio\nuno.com#@#.anuncio\nuno.com##.banner\n~sub.uno.com##.general\n@@||dos.com^$generichide']]);
  assert.deepEqual(selectCosmetic(parsed.cosmetics, 'uno.com').map(rule => rule.s), ['.banner', '.general']);
  assert.deepEqual(selectCosmetic(parsed.cosmetics, 'sub.uno.com').map(rule => rule.s), ['.banner']);
  assert.deepEqual(selectCosmetic(parsed.cosmetics, 'dos.com').map(rule => rule.s), []);
  assert.equal(matchesScope('sub.uno.com', ['uno.*'], []), true);
  assert.equal(matchesScope('falsouno.com', ['uno.com'], []), false);
});

test('conserva todas las excepciones de red en el conjunto base', () => {
  const block = id => ({ id, action: { type: 'block' } });
  const allow = { id: 4, action: { type: 'allow' } };
  const { core, extended } = splitRules([block(1), block(2), block(3), allow], 2);
  assert.deepEqual(core.map(rule => rule.id), [4, 1]);
  assert.deepEqual(extended.map(rule => rule.id), [2, 3]);
});

test('YouTube conserva el contenido y retira solo las claves publicitarias previstas', () => {
  const value = { adPlacements: [1], adSlots: [2], playerAds: [3], streamingData: { url: 'contenido' }, videoDetails: { title: 'Título' }, response: { playerResponse: { adPlacements: [4], videoDetails: { title: 'Otro' } } } };
  cleanPlayerResponse(value);
  assert.equal(value.adPlacements, undefined);
  assert.equal(value.response.playerResponse.adPlacements, undefined);
  assert.equal(value.streamingData.url, 'contenido');
  assert.equal(value.videoDetails.title, 'Título');
  assert.equal(isPlayerUrl('/youtubei/v1/player?key=uno', 'https://www.youtube.com'), true);
  assert.equal(isPlayerUrl('https://falsoyoutube.com/youtubei/v1/player', 'https://www.youtube.com'), false);
  assert.equal(isPlayerUrl('/youtubei/v1/player_settings', 'https://www.youtube.com'), false);
  assert.equal(isPlayerUrl('/youtubei/v1/get_watch?prettyPrint=false', 'https://www.youtube.com'), true);
  assert.equal(isPlayerUrl('/youtubei/v1/player/get_drm_license', 'https://www.youtube.com'), false);
  assert.equal(isPlayerUrl('data:application/json,{}', 'https://www.youtube.com'), false);
});

test('la recuperación de YouTube distingue el bloqueo de los errores de cuenta y los captchas', () => {
  const response = { playabilityStatus: { status: 'UNPLAYABLE', errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ navigationEndpoint: { commandMetadata: { webCommandMetadata: { webPageType: 'WEB_PAGE_TYPE_UNKNOWN', url: 'https://support.google.com/youtube/answer/3037019' } } } }] } } } } };
  assert.equal(isAdblockFailure(response), true);
  for (const status of ['OK', 'LOGIN_REQUIRED', 'AGE_CHECK_REQUIRED', 'ERROR']) assert.equal(isAdblockFailure({ ...response, playabilityStatus: { ...response.playabilityStatus, status } }), false);
  response.playabilityStatus.errorScreen.playerErrorMessageRenderer.playerCaptchaViewModel = {};
  assert.equal(isAdblockFailure(response), false);
  delete response.playabilityStatus.errorScreen.playerErrorMessageRenderer.playerCaptchaViewModel;
  response.playabilityStatus.errorScreen.playerErrorMessageRenderer.subreason.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url = 'https://example.com/3037019';
  assert.equal(isAdblockFailure(response), false);
});

test('los reintentos modifican solo el cuerpo del vídeo afectado y conservan el resto del contexto', () => {
  const body = { videoId: 'video-1', context: { client: { clientName: 'WEB', clientScreen: 'WATCH', userAgent: 'Navegador' }, user: { lockedSafetyMode: true } }, playbackContext: { contentPlaybackContext: { signatureTimestamp: 12345 } }, attestationRequest: { token: 'token' } };
  const text = JSON.stringify(body);
  assert.equal(rewritePlayerRequest(text, 'video-1', ''), text);
  assert.equal(rewritePlayerRequest(text, 'otro-video', 'channel'), text);
  assert.equal(rewritePlayerRequest('{', 'video-1', 'channel'), '{');
  const channel = JSON.parse(rewritePlayerRequest(text, 'video-1', 'channel'));
  assert.equal(channel.context.client.clientScreen, 'CHANNEL');
  assert.match(channel.playbackContext.contentPlaybackContext.lactMilliseconds, /^\d+$/);
  assert.deepEqual(channel, { ...body, context: { ...body.context, client: { ...body.context.client, clientScreen: 'CHANNEL' } }, playbackContext: { contentPlaybackContext: { signatureTimestamp: 12345, lactMilliseconds: channel.playbackContext.contentPlaybackContext.lactMilliseconds } } });
  const second = JSON.parse(rewritePlayerRequest(text, 'video-1', 'lactmilli'));
  assert.equal(second.params, '8AUB');
  assert.match(second.playbackContext.contentPlaybackContext.lactMilliseconds, /^\d+$/);
  assert.equal(second.playbackContext.contentPlaybackContext.signatureTimestamp, 12345);
  assert.equal(body.context.client.clientScreen, 'WATCH');
  assert.equal(rewritePlayerRequest(JSON.stringify({ ...body, context: { client: { clientName: 'WEB_REMIX' } } }), 'video-1', 'channel'), JSON.stringify({ ...body, context: { client: { clientName: 'WEB_REMIX' } } }));
});

test('los reintentos identifican la recarga sin duplicar el marcador ni modificar el contexto original', () => {
  const body = { videoId: 'video-1', context: { client: { clientName: 'WEB' } }, playbackContext: { contentPlaybackContext: { referer: 'https://www.youtube.com/watch?v=video-1', signatureTimestamp: 123 } } };
  const first = rewritePlayerRequest(JSON.stringify(body), 'video-1', 'channel');
  const second = JSON.parse(rewritePlayerRequest(first, 'video-1', 'lactmilli'));
  assert.equal(second.playbackContext.contentPlaybackContext.referer, 'https://www.youtube.com/watch?v=video-1#reloadxhr');
  assert.equal(second.playbackContext.contentPlaybackContext.signatureTimestamp, 123);
  assert.equal(body.playbackContext.contentPlaybackContext.referer, 'https://www.youtube.com/watch?v=video-1');
  assert.equal(second.params, '8AUB');
});

test('YouTube retira solo el aviso antibloqueo del reproductor y conserva otros mensajes y errores', () => {
  const response = { auxiliaryUi: { messageRenderers: { bkaEnforcementMessageViewModel: { title: 'Aviso' }, notificationRenderer: { title: 'Notificación' } } }, playabilityStatus: { status: 'LOGIN_REQUIRED', errorScreen: { playerErrorMessageRenderer: { reason: 'Inicia sesión' } } } };
  cleanPlayerResponse(response);
  assert.equal(response.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel, undefined);
  assert.equal(response.auxiliaryUi.messageRenderers.notificationRenderer.title, 'Notificación');
  assert.equal(response.playabilityStatus.status, 'LOGIN_REQUIRED');
  assert.equal(response.playabilityStatus.errorScreen.playerErrorMessageRenderer.reason, 'Inicia sesión');
});

test('la comprobación publicitaria de YouTube usa un recurso local limitado al módulo activo', () => {
  const rules = settingsRules(defaults);
  const probe = rules.find(rule => rule.action.redirect?.extensionPath === '/redirects/youtube-ad-status.js');
  assert.ok(probe);
  assert.deepEqual(probe.condition.resourceTypes, ['script']);
  assert.deepEqual(probe.condition.initiatorDomains, ['youtube.com', 'youtube-nocookie.com']);
  const pattern = new RegExp(probe.condition.regexFilter);
  assert.equal(pattern.test('https://static.doubleclick.net/instream/ad_status.js?test=1'), true);
  assert.equal(pattern.test('https://static.doubleclick.net/instream/anuncio.js'), false);
  assert.equal(pattern.test('https://falsostatic.doubleclick.net/instream/ad_status.js'), false);
  assert.equal(settingsRules({ ...defaults, youtube: false }).some(rule => rule.action.redirect), false);
  assert.equal(settingsRules({ ...defaults, enabled: false }).some(rule => rule.action.redirect), false);
});

test('Twitch distingue segmentos publicitarios y mantiene los del directo', async () => {
  const source = await readFile('vendor/twitch.js', 'utf8');
  const context = vm.createContext({ document: { location: { hostname: 'www.twitch.tv' } } });
  const instrumented = source.replace(/const ourTwitchAdSolutionsVersion\s*=/, 'globalThis.testApi = { declareOptions, stripAdSegments, getStreamUrlForResolution }; return; const ourTwitchAdSolutionsVersion =');
  vm.runInContext(instrumented, context);
  context.testApi.declareOptions(context);
  const playlist = '#EXTM3U\n#EXT-X-DATERANGE:ID="stitched-ad"\n#EXTINF:2.0,ad\nhttps://video.test/anuncio.ts\n#EXTINF:2.0,live\nhttps://video.test/directo.ts\n#EXT-X-TWITCH-PREFETCH:https://video.test/prefetch.ts';
  const stream = { NumStrippedAdSegments: 0 };
  const cleaned = context.testApi.stripAdSegments(playlist, false, stream);
  assert.equal(context.AdSegmentCache.has('https://video.test/anuncio.ts'), true);
  assert.equal(context.AdSegmentCache.has('https://video.test/directo.ts'), false);
  assert.equal(cleaned.includes('#EXT-X-TWITCH-PREFETCH:'), false);
  assert.equal(stream.IsStrippingAdSegments, true);
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60\nhttps://video.test/720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://video.test/1080.m3u8';
  assert.equal(context.testApi.getStreamUrlForResolution(master, { Resolution: '1920x1080', FrameRate: '60' }), 'https://video.test/1080.m3u8');
});
