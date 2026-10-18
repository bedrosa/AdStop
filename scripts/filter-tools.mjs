import { RuleParser, RawRuleConverter, QuoteUtils } from '@adguard/agtree';

export function preprocess(text) {
  const stack = [];
  const lines = [];
  const enabled = new Set(['env_mv3', 'env_chromium', 'ext_ubol']);
  const condition = expression => expression.trim().split(/\s*\|\|\s*/).some(group => group.split(/\s*&&\s*/).every(token => {
    const name = token.trim();
    if (/^version\s*>=/.test(name)) return true;
    return name.startsWith('!') ? !enabled.has(name.slice(1)) : enabled.has(name);
  }));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!#if ')) {
      stack.push({ parent: stack.every(item => item.active), active: condition(line.slice(5)) });
    } else if (line === '!#else') {
      if (!stack.length) throw new Error('Condicional sin apertura');
      stack.at(-1).active = !stack.at(-1).active;
    } else if (line === '!#endif') {
      if (!stack.pop()) throw new Error('Condicional sin apertura');
    } else if (stack.every(item => item.parent && item.active) && line && !line.startsWith('!') && !line.startsWith('[')) {
      lines.push(line);
    }
  }
  if (stack.length) throw new Error('Condicional sin cierre');
  return lines;
}

export function parseLists(entries) {
  const network = [];
  const cosmetics = { rules: [], exceptions: [] };
  const scripts = [];
  const skipped = [];
  const seen = new Set();
  for (const [source, text] of entries) {
    for (const line of preprocess(text)) {
      if (seen.has(line)) continue;
      seen.add(line);
      try {
        for (const converted of RawRuleConverter.convertToAdg(line).result) {
          const rule = RuleParser.parse(converted);
          if (rule.category === 'Network') {
            const cosmeticException = line.match(/^@@\|\|([^/^$*]+)\^?\$(generichide|ghide|elemhide|ehide|specifichide|shide)$/);
            if (cosmeticException) {
              cosmetics.exceptions.push({ i: [cosmeticException[1]], x: [], kind: /^(ghide|generichide)$/.test(cosmeticException[2]) ? 'generic' : /^(shide|specifichide)$/.test(cosmeticException[2]) ? 'specific' : 'all' });
            }
            network.push(converted);
            continue;
          }
          if (rule.category !== 'Cosmetic') continue;
          const domains = rule.domains.children;
          if (domains.some(domain => !/^[a-z0-9.*_-]+$/i.test(domain.value))) {
            skipped.push({ source, rule: line, reason: 'Dominio especial no compatible' });
            continue;
          }
          const scope = { i: domains.filter(domain => !domain.exception).map(domain => domain.value), x: domains.filter(domain => domain.exception).map(domain => domain.value), e: rule.exception };
          if (rule.type === 'ElementHidingRule') {
            const s = rule.body.selectorList.value;
            if (/[{}]|:style\(/.test(s)) throw new Error('Selector con declaraciones');
            cosmetics.rules.push({ ...scope, s, extended: rule.separator.value.includes('?') || s.includes(':remove(') });
          } else if (rule.type === 'ScriptletInjectionRule') {
            for (const parameters of rule.body.children) {
              const values = parameters.children.map(value => QuoteUtils.removeQuotesAndUnescape(value.value));
              scripts.push({ ...scope, name: values[0] || '', args: values.slice(1), source });
            }
          } else {
            skipped.push({ source, rule: line, reason: 'Regla extendida o inyeccion no compatible' });
          }
        }
      } catch (error) {
        skipped.push({ source, rule: line, reason: error.message });
      }
    }
  }
  return { network, cosmetics, scripts, skipped };
}

export function splitRules(rules, budget = 30000) {
  const exceptions = rules.filter(rule => ['allow', 'allowAllRequests'].includes(rule.action.type));
  const blocking = rules.filter(rule => !['allow', 'allowAllRequests'].includes(rule.action.type));
  if (exceptions.length > budget) throw new Error('Las excepciones superan el presupuesto base');
  const ordered = [...exceptions, ...blocking];
  return { core: ordered.slice(0, budget), extended: ordered.slice(budget) };
}
