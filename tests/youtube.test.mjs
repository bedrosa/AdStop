import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile('src/content/youtube.js', 'utf8');

function fixture() {
  const state = { showing: true, disabled: false, visible: true, clicks: 0 };
  const button = { get disabled() { return state.disabled; }, getClientRects: () => state.visible ? [1] : [], click: () => { state.clicks++; } };
  const player = { classList: { contains: () => state.showing }, querySelector: () => button };
  const original = { fetch: () => {}, Request: class {}, XMLHttpRequest: class {}, Response: class {}, JSON: { parse: JSON.parse, stringify: JSON.stringify }, ytInitialPlayerResponse: { adSlots: [1], playabilityStatus: { status: 'UNPLAYABLE' } } };
  const document = { querySelector: () => state.playerMissing ? null : player, addEventListener: (name, callback) => { state.navigate = callback; } };
  const context = vm.createContext({ ...original, document, setInterval: callback => { state.tick = callback; } });
  context.window = context;
  vm.runInContext(source, context);
  return { state, context, original };
}

test('el módulo de YouTube conserva las API, las respuestas y los descriptores originales', () => {
  const { state, context, original } = fixture();
  for (const key of Object.keys(original)) assert.equal(context[key], original[key], key);
  const descriptor = Object.getOwnPropertyDescriptor(context, 'ytInitialPlayerResponse');
  assert.equal(descriptor.get, undefined);
  assert.equal(descriptor.value, original.ytInitialPlayerResponse);
  assert.deepEqual(original.ytInitialPlayerResponse.adSlots, [1]);
  assert.equal(original.ytInitialPlayerResponse.playabilityStatus.status, 'UNPLAYABLE');
  state.showing = false;
  for (let i = 0; i < 100; i++) state.tick();
  assert.equal(state.clicks, 0);
});

test('pulsa el salto visible durante un anuncio y al navegar entre vídeos', () => {
  const { state } = fixture();
  state.tick();
  assert.equal(state.clicks, 1);
  state.navigate();
  assert.equal(state.clicks, 2);
});

test('no pulsa controles ocultos, deshabilitados, fuera de un anuncio o sin reproductor', () => {
  for (const scenario of ['hidden', 'disabled', 'content', 'missing']) {
    const { state } = fixture();
    if (scenario === 'hidden') state.visible = false;
    if (scenario === 'disabled') state.disabled = true;
    if (scenario === 'content') state.showing = false;
    if (scenario === 'missing') state.playerMissing = true;
    state.tick();
    assert.equal(state.clicks, 0, scenario);
  }
});
