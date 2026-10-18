import { siteEnabled } from './shared/settings.js';

export async function setIcon(value, tabId, url) {
  const hostname = url && /^https?:/.test(url) ? new URL(url).hostname : undefined;
  const active = hostname ? siteEnabled(value, hostname) : value.enabled;
  const suffix = active ? '' : '-off';
  const details = { path: { 16: `icons/16${suffix}.png`, 32: `icons/32${suffix}.png` } };
  if (Number.isInteger(tabId)) details.tabId = tabId;
  try {
    await chrome.action.setIcon(details);
  } catch (error) {
    if (!Number.isInteger(tabId)) throw error;
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    throw error;
  }
}

export async function refreshIcons(value) {
  await setIcon(value);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => setIcon(value, tab.id, tab.url)));
}
