import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile('src/shared/youtube.js', 'utf8')).replaceAll('export function ', 'function ') + (await readFile('src/content/youtube.js', 'utf8')).replace(/^import[^\n]+\n/, '');

function fixture() {
  const state = { now: 100000, rendered: 20, reloads: [], sent: [], showing: false };
  const video = { currentTime: 42, currentSrc: 'blob:contenido', videoWidth: 1280, paused: false, ended: false, seeking: false, muted: false, playbackRate: 1.25, duration: 120, getVideoPlaybackQuality: () => ({ totalVideoFrames: state.rendered, droppedVideoFrames: 0 }) };
  state.response = { videoDetails: { videoId: 'video-1' }, playabilityStatus: { status: 'OK' } };
  const skip = { disabled: false, getClientRects: () => [1], click: () => { state.showing = false; } };
  const player = { querySelector: selector => selector === 'video' ? video : skip, classList: { contains: () => state.showing }, getPlayerResponse: () => state.response, loadVideoById: (...args) => state.reloads.push(args) };
  const document = { visibilityState: 'visible', querySelector: selector => selector === '#movie_player, #player' ? player : null, addEventListener() {} };
  class Xhr {
    open(method, url) { this.method = method; this.url = url; }
    send(body) { state.sent.push({ method: this.method, url: this.url, body }); }
    addEventListener() {}
    get responseText() { return '{}'; }
    get response() { return {}; }
  }
  const context = vm.createContext({ Request, Response, URL, Headers, XMLHttpRequest: Xhr, document, location: { href: 'https://www.youtube.com/watch?v=video-1' }, Date: class extends Date { static now() { return state.now; } }, setInterval: fn => { state.tick = fn; }, fetch: async (...args) => { state.sent.push(args); return new Response('{}'); } });
  context.window = context;
  vm.runInContext(source, context);
  return { state, video, document, context };
}

function block(state) {
  state.response.playabilityStatus = { status: 'UNPLAYABLE', errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ navigationEndpoint: { commandMetadata: { webCommandMetadata: { webPageType: 'WEB_PAGE_TYPE_UNKNOWN', url: 'https://support.google.com/youtube/answer/3037019' } } } }] } } } };
}

test('el salto no altera el audio ni la velocidad del contenido que empieza tras el anuncio', () => {
  const { state, video } = fixture();
  state.showing = true;
  state.tick();
  assert.equal(state.showing, false);
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1.25);
  state.tick();
  assert.equal(state.reloads.length, 0);
});

test('el vídeo congelado se recarga en su posición con un máximo de dos intentos', () => {
  const { state, video } = fixture();
  state.tick();
  state.now += 6001;
  video.currentTime += 6;
  state.tick();
  assert.deepEqual(state.reloads, [['video-1', 48]]);
  for (let i = 0; i < 4; i++) {
    state.tick();
    state.now += 16000;
    video.currentTime += 6;
    state.tick();
  }
  assert.equal(state.reloads.length, 2);
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1.25);
});

test('no recarga una pausa, búsqueda, pestaña oculta, anuncio ni un vídeo que sigue dibujando fotogramas', () => {
  for (const scenario of ['paused', 'seeking', 'hidden', 'ad', 'frames']) {
    const { state, video, document } = fixture();
    state.tick();
    state.now += 7000;
    video.currentTime += 7;
    if (scenario === 'paused') video.paused = true;
    if (scenario === 'seeking') video.seeking = true;
    if (scenario === 'hidden') document.visibilityState = 'hidden';
    if (scenario === 'ad') state.showing = true;
    if (scenario === 'frames') state.rendered += 30;
    state.tick();
    assert.deepEqual(state.reloads, [], scenario);
  }
});

test('un bloqueo reintenta el mismo vídeo sin bucles y vuelve a empezar al navegar a otro', () => {
  const { state } = fixture();
  block(state);
  state.tick();
  state.tick();
  assert.equal(state.reloads.length, 1);
  state.now += 15001;
  state.tick();
  state.now += 15001;
  state.tick();
  assert.equal(state.reloads.length, 2);
  state.response.videoDetails.videoId = 'video-2';
  state.tick();
  assert.deepEqual(state.reloads.at(-1), ['video-2', 42]);
});

test('la recuperación respeta los errores ajenos al aviso y los captchas', () => {
  for (const scenario of ['login', 'captcha', 'availability']) {
    const { state } = fixture();
    block(state);
    if (scenario === 'login') state.response.playabilityStatus.status = 'LOGIN_REQUIRED';
    if (scenario === 'captcha') state.response.playabilityStatus.errorScreen.playerErrorMessageRenderer.playerCaptchaViewModel = {};
    if (scenario === 'availability') delete state.response.playabilityStatus.errorScreen;
    state.tick();
    assert.deepEqual(state.reloads, [], scenario);
  }
});

test('la recuperación adapta fetch y XHR solo para el vídeo y las rutas afectadas', async () => {
  const { state, context } = fixture();
  const text = JSON.stringify({ videoId: 'video-1', context: { client: { clientName: 'WEB' } }, playbackContext: { contentPlaybackContext: {} } });
  await context.fetch('/youtubei/v1/player', { method: 'POST', body: text });
  assert.equal(state.sent.at(-1)[1].body, text);
  block(state);
  state.tick();
  await context.fetch('/youtubei/v1/get_watch', { method: 'POST', body: text });
  assert.equal(JSON.parse(state.sent.at(-1)[1].body).context.client.clientScreen, 'CHANNEL');
  await context.fetch('/youtubei/v1/player/get_drm_license', { method: 'POST', body: text });
  assert.equal(state.sent.at(-1)[1].body, text);
  const request = new Request('https://example.com/test', { method: 'POST', body: text });
  Object.defineProperty(request, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
  await context.fetch(request);
  assert.equal(state.sent.at(-1).length, 1);
  const xhr = new context.XMLHttpRequest();
  xhr.open('POST', '/youtubei/v1/player');
  xhr.send(text);
  assert.equal(JSON.parse(state.sent.at(-1).body).context.client.clientScreen, 'CHANNEL');
  xhr.open('POST', '/youtubei/v1/log_event');
  xhr.send(text);
  assert.equal(state.sent.at(-1).body, text);
  state.now += 15001;
  state.tick();
  await context.fetch('/youtubei/v1/player', { method: 'POST', body: text });
  assert.equal(JSON.parse(state.sent.at(-1)[1].body).params, '8AUB');
});
