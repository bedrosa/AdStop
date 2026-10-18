import test from 'node:test';
import assert from 'node:assert/strict';

test('registra bloqueos por página sin duplicados y conserva la sesión del proceso', async () => {
  const stored = {};
  const local = {};
  const closed = new Set();
  let badgeError;
  const badges = new Map();
  const events = {};
  const event = name => ({ addListener: listener => { events[name] = listener; } });
  globalThis.chrome = {
    runtime: { getURL: value => `chrome-extension://test/${value}` },
    storage: { local: {
      get: async key => ({ [key]: local[key] }),
      set: async value => Object.assign(local, structuredClone(value))
    }, session: {
      get: async key => ({ [key]: structuredClone(stored[key]) }),
      set: async value => Object.assign(stored, structuredClone(value)),
      remove: async key => { delete stored[key]; }
    } },
    action: { setBadgeText: async ({ tabId, text }) => {
      if (closed.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
      if (badgeError) throw badgeError;
      badges.set(tabId, text);
    } },
    tabs: {
      onRemoved: event('removed'), query: async () => [{ id: 10 }, { id: 11 }],
      get: async tabId => {
        if (closed.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        return { id: tabId };
      }
    },
    webNavigation: { onBeforeNavigate: event('navigate') },
    declarativeNetRequest: { DYNAMIC_RULESET_ID: '_dynamic', onRuleMatchedDebug: event('matched') }
  };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const errors = [];
  console.error = (...values) => errors.push(values);
  globalThis.fetch = async () => ({ json: async () => ({ core: [20, 21], extended: [40] }) });
  try {
    const tracker = await import('../src/blocked.js?process=first');
    tracker.setDynamicBlockingRules([{ id: 1, action: { type: 'block' } }, { id: 2, action: { type: 'allow' } }]);
    tracker.observeBlockedRequests(async () => {});
    const matched = (requestId, ruleId, rulesetId = '_dynamic', tabId = 10) => events.matched({ request: { tabId, requestId, url: 'https://ads.ejemplo.com/anuncio?dato=privado' }, rule: { ruleId, rulesetId } });
    matched('uno', 1);
    matched('uno', 20, 'core');
    matched('permitido', 2);
    matched('cabeceras', 22, 'core');
    matched('otro', 40, 'extended', 11);
    assert.deepEqual(await tracker.pageStats(10), { total: 1, domains: [{ domain: 'ads.ejemplo.com', count: 1 }], other: 0 });
    assert.equal((await tracker.pageStats(11)).total, 1);
    matched('dos', 21, 'core');
    assert.equal((await tracker.pageStats(10)).total, 2);
    assert.equal(badges.get(10), '2');
    assert.equal(await tracker.totalBlocked(), 3);
    assert.deepEqual(local, { blockedTotal: 3 });
    assert.equal(JSON.stringify(stored).includes('privado'), false);
    events.navigate({ tabId: 10, frameId: 1 });
    assert.equal((await tracker.pageStats(10)).total, 2);
    const restarted = await import('../src/blocked.js?process=restarted');
    assert.equal((await restarted.pageStats(10)).total, 2);
    assert.equal(await restarted.totalBlocked(), 3);
    restarted.observeBlockedRequests(async () => {});
    events.navigate({ tabId: 10, frameId: 0 });
    assert.deepEqual(await restarted.pageStats(10), { total: 0, domains: [], other: 0 });
    assert.equal((await restarted.pageStats(11)).total, 1);
    events.removed(11);
    assert.equal((await restarted.pageStats(11)).total, 0);
    assert.equal(await restarted.totalBlocked(), 3);
    await restarted.refreshBadges(false);
    assert.equal(badges.get(10), 'OFF');
    closed.add(11);
    await restarted.refreshBadges(true);
    events.navigate({ tabId: 11, frameId: 0 });
    await restarted.pageStats(11);
    matched('cerrada', 20, 'core', 11);
    assert.equal(await restarted.totalBlocked(), 4);
    events.removed(11);
    await restarted.pageStats(11);
    badgeError = new Error('Error real de permisos');
    await assert.rejects(restarted.refreshBadges(true), /Error real de permisos/);
    badgeError = undefined;
    for (const key of Object.keys(stored)) delete stored[key];
    const browserRestarted = await import('../src/blocked.js?process=browser-restarted');
    assert.equal((await browserRestarted.pageStats(10)).total, 0);
    assert.equal(await browserRestarted.totalBlocked(), 4);
    assert.deepEqual(errors, []);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
    delete globalThis.chrome;
  }
});
