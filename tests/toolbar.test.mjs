import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/settings.js';
import { refreshIcons, setIcon } from '../src/toolbar.js';

test('el icono refleja la protección de cada web y la pausa general sin fallar por pestañas cerradas', async () => {
  const icons = new Map();
  const closed = new Set();
  let failure;
  globalThis.chrome = {
    action: { setIcon: async details => {
      if (closed.has(details.tabId)) throw new Error(`No tab with id: ${details.tabId}`);
      if (failure) throw failure;
      icons.set(details.tabId, details.path);
    } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://web.test/' }, { id: 2, url: 'https://sub.permitida.test/' }, { id: 3, url: 'https://www.netflix.com/' }],
      get: async tabId => {
        if (closed.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        return { id: tabId };
      }
    }
  };
  try {
    const settings = { ...defaults, allowlist: ['permitida.test'], disabledPlatforms: ['netflix'] };
    await refreshIcons(settings);
    assert.equal(icons.get(undefined)[16], 'icons/16.png');
    assert.equal(icons.get(1)[32], 'icons/32.png');
    assert.equal(icons.get(2)[32], 'icons/32-off.png');
    assert.equal(icons.get(3)[32], 'icons/32-off.png');
    await setIcon(settings, 2, 'https://web.test/');
    assert.equal(icons.get(2)[16], 'icons/16.png');
    await refreshIcons({ ...settings, enabled: false });
    assert.ok([...icons.values()].every(paths => paths[16] === 'icons/16-off.png'));
    closed.add(2);
    await refreshIcons(settings);
    failure = new Error('Permiso denegado');
    await assert.rejects(setIcon(settings, 1, 'https://web.test/'), /Permiso denegado/);
    await assert.rejects(setIcon(settings), /Permiso denegado/);
  } finally {
    delete globalThis.chrome;
  }
});
