import { ExtendedCss } from '@adguard/extended-css';

async function apply() {
  const result = await chrome.runtime.sendMessage({ type: 'cosmetic' });
  if (!result.ok || !result.selectors.length) return;
  const selectors = result.selectors.filter(rule => !rule.extended).map(rule => rule.s).filter(selector => {
    try {
      return CSS.supports(`selector(${selector})`);
    } catch {
      return false;
    }
  });
  if (selectors.length) await chrome.runtime.sendMessage({ type: 'insertCss', css: selectors.map(selector => `${selector}{display:none!important}`).join('\n') });
  const extended = result.selectors.filter(rule => rule.extended).map(rule => `${rule.s}{display:none!important}`);
  if (extended.length) new ExtendedCss({ cssRules: extended }).apply();
}

apply().catch(() => {});
