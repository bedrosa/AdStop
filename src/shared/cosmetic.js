import { domainMatches } from './settings.js';

export function matchesScope(hostname, include, exclude) {
  const matches = domain => domain.includes('*') ? new RegExp(`(^|\\.)${domain.split('*').map(part => part.replaceAll('.', '\\.')).join('[^.]+')}$`, 'i').test(hostname) : domainMatches(hostname, domain);
  return (!include.length || include.some(matches)) && !exclude.some(matches);
}

export function selectCosmetic(data, hostname, customCss = '') {
  const applicable = data.rules.filter(rule => matchesScope(hostname, rule.i, rule.x));
  const exceptions = new Set(applicable.filter(rule => rule.e).map(rule => rule.s));
  const disabled = data.exceptions.filter(rule => matchesScope(hostname, rule.i, rule.x));
  const all = disabled.some(rule => rule.kind === 'all');
  const generic = all || disabled.some(rule => rule.kind === 'generic');
  const specific = all || disabled.some(rule => rule.kind === 'specific');
  const selectors = applicable.filter(rule => !rule.e && !exceptions.has(rule.s) && !(rule.i.length ? specific : generic)).map(rule => ({ s: rule.s, extended: Boolean(rule.extended) }));
  for (const line of customCss.split('\n')) {
    const split = line.indexOf('##');
    if (split > 0 && domainMatches(hostname, line.slice(0, split).trim())) selectors.push({ s: line.slice(split + 2).trim(), extended: false });
  }
  return [...new Map(selectors.map(rule => [rule.s, rule])).values()];
}
