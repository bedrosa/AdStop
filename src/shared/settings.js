export const defaults = {
  enabled: true,
  cosmetic: true,
  scriptlets: true,
  youtube: true,
  twitch: true,
  extended: true,
  allowlist: [],
  blockedDomains: [],
  customCss: ''
};

export function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function normalizeDomain(value) {
  const text = value.trim();
  if (!text) throw new Error('Escribe un dominio');
  let url;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    throw new Error(`Dominio no valido: ${text}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || host.length > 253) {
    throw new Error(`Dominio no valido: ${text}`);
  }
  return host;
}

export function validateSettings(input) {
  const value = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof defaults[key] === 'boolean') {
      if (typeof input[key] !== 'boolean') throw new Error(`Opcion no valida: ${key}`);
      value[key] = input[key];
    }
  }
  for (const key of ['allowlist', 'blockedDomains']) {
    if (!Array.isArray(input[key]) || input[key].length > 2000 || input[key].some(item => typeof item !== 'string')) {
      throw new Error('Puedes guardar hasta 2000 dominios por lista');
    }
    value[key] = [...new Set(input[key].map(normalizeDomain))].sort();
  }
  if (typeof input.customCss !== 'string' || input.customCss.length > 100000) throw new Error('La lista de elementos es demasiado larga');
  for (const line of input.customCss.split('\n').map(item => item.trim()).filter(Boolean)) {
    const split = line.indexOf('##');
    if (split <= 0) throw new Error('Usa dominio##selector en cada filtro de elementos');
    normalizeDomain(line.slice(0, split));
    const selector = line.slice(split + 2);
    if (!selector || /[{}\r\n]|\/\*|@import|:style\(|:remove\(/i.test(selector)) throw new Error('El filtro debe contener un selector CSS sin declaraciones');
  }
  value.customCss = input.customCss.trim();
  return value;
}

export function siteEnabled(settings, hostname) {
  return settings.enabled && !settings.allowlist.some(domain => domainMatches(hostname, domain));
}

export function settingsRules(settings) {
  let id = 1;
  const rules = [];
  if (!settings.enabled) {
    rules.push({ id: id++, priority: 1000000000, action: { type: 'allowAllRequests' }, condition: { resourceTypes: ['main_frame', 'sub_frame'], urlFilter: '|http' } });
  }
  for (const domain of settings.allowlist) {
    rules.push({ id: id++, priority: 1000000000, action: { type: 'allowAllRequests' }, condition: { resourceTypes: ['main_frame', 'sub_frame'], requestDomains: [domain] } });
  }
  for (const domain of settings.blockedDomains) {
    rules.push({ id: id++, priority: 1000000, action: { type: 'block' }, condition: { requestDomains: [domain], excludedResourceTypes: ['main_frame'] } });
  }
  return rules;
}
