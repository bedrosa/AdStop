const pages = new Map();
let blockingIndex;
let dynamicIds = new Set();
let pending = Promise.resolve();
let lifetimeTotal = 0;
let lifetimeLoaded;

async function loadTotal() {
  lifetimeLoaded ||= chrome.storage.local.get('blockedTotal').then(stored => {
    lifetimeTotal = Number.isSafeInteger(stored.blockedTotal) && stored.blockedTotal >= 0 ? stored.blockedTotal : 0;
  });
  await lifetimeLoaded;
  return lifetimeTotal;
}

export async function totalBlocked() {
  await pending;
  return loadTotal();
}

async function setTabBadge(tabId, text) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
  } catch (error) {
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    throw error;
  }
}

function enqueue(operation) {
  const result = pending.then(operation);
  pending = result.catch(error => console.error('No se pudo actualizar el registro de bloqueos', error));
  return result;
}

async function loadPage(tabId) {
  if (!pages.has(tabId)) {
    const key = `blocked:${tabId}`;
    const stored = await chrome.storage.session.get(key);
    pages.set(tabId, stored[key] || { total: 0, domains: [], other: 0, seen: [] });
  }
  return pages.get(tabId);
}

export function setDynamicBlockingRules(rules) {
  dynamicIds = new Set(rules.filter(rule => rule.action.type === 'block').map(rule => rule.id));
}

export async function pageStats(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return { total: 0, domains: [], other: 0 };
  await pending;
  const page = await loadPage(tabId);
  return { total: page.total, domains: page.domains.map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)), other: page.other };
}

export async function refreshBadges(enabled) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    const page = await loadPage(tab.id);
    await setTabBadge(tab.id, enabled ? page.total ? page.total > 999 ? '999+' : String(page.total) : '' : 'OFF');
  }));
}

export function observeBlockedRequests(initialize) {
  chrome.webNavigation.onBeforeNavigate.addListener(details => {
    if (details.frameId !== 0 || details.tabId < 0) return;
    enqueue(async () => {
      pages.delete(details.tabId);
      await chrome.storage.session.remove(`blocked:${details.tabId}`);
      await setTabBadge(details.tabId, null);
    });
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    enqueue(async () => {
      pages.delete(tabId);
      await chrome.storage.session.remove(`blocked:${tabId}`);
    });
  });
  chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(info => {
    if (info.request.tabId < 0 || !/^https?:/.test(info.request.url)) return;
    enqueue(async () => {
      await initialize();
      let blocked;
      if (info.rule.rulesetId === chrome.declarativeNetRequest.DYNAMIC_RULESET_ID) {
        blocked = dynamicIds.has(info.rule.ruleId);
      } else {
        if (!blockingIndex) {
          const data = await (await fetch(chrome.runtime.getURL('data/blocking-rules.json'))).json();
          blockingIndex = new Map(Object.entries(data).map(([id, rules]) => [id, new Set(rules)]));
        }
        blocked = blockingIndex.get(info.rule.rulesetId)?.has(info.rule.ruleId);
      }
      if (!blocked) return;
      const page = await loadPage(info.request.tabId);
      if (page.seen.includes(info.request.requestId)) return;
      const domain = new URL(info.request.url).hostname;
      page.seen.push(info.request.requestId);
      if (page.seen.length > 2000) page.seen.shift();
      page.total++;
      const entry = page.domains.find(([host]) => host === domain);
      if (entry) entry[1]++;
      else if (page.domains.length < 200) page.domains.push([domain, 1]);
      else page.other++;
      await loadTotal();
      lifetimeTotal++;
      await chrome.storage.local.set({ blockedTotal: lifetimeTotal });
      await chrome.storage.session.set({ [`blocked:${info.request.tabId}`]: page });
      await setTabBadge(info.request.tabId, page.total > 999 ? '999+' : String(page.total));
    });
  });
}
