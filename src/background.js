import { defaults, domainMatches, exceptionDomains, settingsRules, siteEnabled, validateSettings } from './shared/settings.js';
import { selectCosmetic } from './shared/cosmetic.js';
import { observeBlockedRequests, pageStats, refreshBadges, setDynamicBlockingRules, totalBlocked } from './blocked.js';
import { streamingPlatforms } from './shared/platforms.js';
import { refreshIcons, setIcon } from './toolbar.js';

let settings;
let metadata;
let cosmeticData;
let initialization;
let mutations = Promise.resolve();
const cssCache = new Map();

async function registerScripts(value) {
  const excludeMatches = exceptionDomains(value).flatMap(domain => [`*://${domain}/*`, `*://*.${domain}/*`]);
  const desired = [];
  for (const [id, enabled, matches] of [
    ['scriptlets', value.scriptlets, ['http://*/*', 'https://*/*']],
    ['youtube', value.youtube, ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']],
    ['twitch', value.twitch, ['*://*.twitch.tv/*']]
  ]) {
    if (value.enabled && enabled) desired.push({ id, js: [`content/${id}.js`], matches, excludeMatches, runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true });
  }
  const current = await chrome.scripting.getRegisteredContentScripts();
  const remove = current.filter(script => !desired.some(item => item.id === script.id)).map(script => script.id);
  if (remove.length) await chrome.scripting.unregisterContentScripts({ ids: remove });
  const update = desired.filter(script => current.some(item => item.id === script.id));
  const add = desired.filter(script => !current.some(item => item.id === script.id));
  if (update.length) await chrome.scripting.updateContentScripts(update);
  if (add.length) await chrome.scripting.registerContentScripts(add);
}

async function applySettings(value) {
  const previous = await chrome.declarativeNetRequest.getDynamicRules();
  const rules = settingsRules(value);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: previous.map(rule => rule.id), addRules: rules });
  setDynamicBlockingRules(rules);
  const all = ['core', 'extended'];
  if (!value.enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: all });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['core'], disableRulesetIds: value.extended ? [] : ['extended'] });
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    if (value.extended && metadata.extendedRules && !enabled.includes('extended')) {
      const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
      if (available >= metadata.extendedRules) {
        try {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['extended'] });
        } catch (error) {
          await chrome.storage.local.set({ ruleWarning: `No se pudo activar la cobertura ampliada: ${error.message}` });
        }
      } else {
        await chrome.storage.local.set({ ruleWarning: 'El navegador ha alcanzado su límite de filtros. La protección básica sigue activa' });
      }
    }
  }
  await registerScripts(value);
  await chrome.action.setBadgeText({ text: value.enabled ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#526078' });
  await refreshBadges(value.enabled);
  await refreshIcons(value);
}

function initialize() {
  if (!initialization) {
    initialization = (async () => {
      const stored = await chrome.storage.local.get('settings');
      settings = validateSettings({ ...defaults, ...stored.settings });
      metadata = await (await fetch(chrome.runtime.getURL('data/metadata.json'))).json();
      await applySettings(settings);
      await chrome.storage.local.set({ settings });
    })().catch(error => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

async function status() {
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  return { settings, metadata, totalBlocked: await totalBlocked(), enabledRules: (enabled.includes('core') ? metadata.coreRules : 0) + (enabled.includes('extended') ? metadata.extendedRules : 0), extendedActive: enabled.includes('extended') };
}

async function save(value) {
  const next = validateSettings(value);
  const previous = settings;
  try {
    await applySettings(next);
    await chrome.storage.local.set({ settings: next });
    settings = next;
    cssCache.clear();
    return await status();
  } catch (error) {
    await applySettings(previous);
    throw error;
  }
}

async function handle(message, sender) {
  await initialize();
  if (sender.id !== chrome.runtime.id) throw new Error('Origen no permitido');
  if (message.type === 'cosmetic' && sender.tab) {
    const url = new URL(sender.url);
    const top = new URL(sender.tab.url || sender.url);
    if (!['http:', 'https:'].includes(url.protocol) || !settings.cosmetic || !siteEnabled(settings, url.hostname) || !siteEnabled(settings, top.hostname)) return { selectors: [] };
    if (!cosmeticData) cosmeticData = await (await fetch(chrome.runtime.getURL('data/cosmetic.json'))).json();
    if (!cssCache.has(url.hostname)) {
      if (cssCache.size >= 100) cssCache.clear();
      cssCache.set(url.hostname, selectCosmetic(cosmeticData, url.hostname, settings.customCss));
    }
    return { selectors: cssCache.get(url.hostname) };
  }
  if (message.type === 'insertCss' && sender.tab) {
    const url = new URL(sender.url);
    const top = new URL(sender.tab.url || sender.url);
    if (!settings.cosmetic || !siteEnabled(settings, url.hostname) || !siteEnabled(settings, top.hostname)) return {};
    if (typeof message.css !== 'string' || message.css.length > 5000000) throw new Error('Hoja de estilos no valida');
    await chrome.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, css: message.css, origin: 'USER' });
    return {};
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Esta operacion solo esta disponible en AdStop');
  if (message.type === 'status') return { ...await status(), page: await pageStats(message.tabId) };
  if (message.type === 'pageStats') return { page: await pageStats(message.tabId), totalBlocked: await totalBlocked() };
  if (message.type === 'save') return save(message.settings);
  if (message.type === 'toggleSite') {
    const hostname = new URL(message.url).hostname;
    const excluded = settings.allowlist.some(domain => domainMatches(hostname, domain));
    const platform = streamingPlatforms.find(item => item.domains.some(domain => domainMatches(hostname, domain)) && settings.disabledPlatforms.includes(item.id));
    return save({
      ...settings,
      disabledPlatforms: platform ? settings.disabledPlatforms.filter(id => id !== platform.id) : settings.disabledPlatforms,
      allowlist: excluded ? settings.allowlist.filter(domain => !domainMatches(hostname, domain)) : platform ? settings.allowlist : [...settings.allowlist, hostname]
    });
  }
  if (message.type === 'refresh') {
    await applySettings(settings);
    return status();
  }
  throw new Error('Operacion no reconocida');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return false;
  const work = () => handle(message, sender);
  const result = ['save', 'toggleSite', 'refresh'].includes(message.type) ? (mutations = mutations.catch(() => {}).then(work)) : work();
  result.then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true;
});

async function start() {
  try {
    await initialize();
  } catch (error) {
    await chrome.storage.local.set({ startupError: error.message });
    await chrome.action.setBadgeText({ text: '!' });
  }
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  initialize().then(() => mutations.catch(() => {})).then(() => setIcon(settings, details.tabId, details.url)).catch(error => console.error('No se pudo actualizar el icono de AdStop', error));
});
observeBlockedRequests(initialize);
