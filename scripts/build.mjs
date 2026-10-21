import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { FilterConverter, Filter, DNR_CONVERTER_VERSION } from '@adguard/dnr-converter';
import { scriptlets } from '@adguard/scriptlets';
import { parseLists, splitRules } from './filter-tools.mjs';
import { makeIcons } from './icons.mjs';
import { netflix } from '../src/shared/netflix.js';

const lock = JSON.parse(await readFile('filters/lock.json', 'utf8'));
const entries = [['local', await readFile('filters/local.txt', 'utf8')]];
for (const source of lock.sources) {
  const content = await readFile(`filters/upstream/${source.id}.txt`, 'utf8');
  if (createHash('sha256').update(content).digest('hex') !== source.sha256) throw new Error(`La fuente ${source.id} no coincide con su huella`);
  entries.push([source.id, content]);
}
const twitchSource = await readFile('vendor/twitch.js', 'utf8');
if (createHash('sha256').update(twitchSource).digest('hex') !== lock.twitch.bundledSha256) throw new Error('El modulo de Twitch no coincide con su huella');

const parsed = parseLists(entries);
const converter = new FilterConverter();
const [result] = await converter.convert([new Filter(1, parsed.network.join('\n'))], {
  combine: true,
  withSourceMap: true,
  maxNumberOfRules: 200000,
  maxNumberOfRegexpRules: 950,
  resourcesPath: '/redirects'
});
const converted = await result.ruleset.getDeclarativeRules();
const deduped = [...new Map(converted.map(rule => {
  const { id, ...content } = rule;
  return [JSON.stringify(content), rule];
})).values()].map((rule, index) => ({ ...rule, id: index + 1 }));
const { core, extended } = splitRules(deduped);

const functions = new Map();
const scriptRules = [];
for (const rule of parsed.scripts) {
  if (rule.e && !rule.name) {
    scriptRules.push(rule);
    continue;
  }
  try {
    if (!functions.has(rule.name)) {
      const fn = rule.name === 'netflix' ? netflix : scriptlets.getScriptletFunction(rule.name);
      if (!fn) throw new Error('Scriptlet no disponible en la biblioteca');
      functions.set(rule.name, fn.toString());
    }
    scriptRules.push(rule);
  } catch (error) {
    parsed.skipped.push({ source: rule.source, rule: [rule.name, ...rule.args].join(', '), reason: error.message });
  }
}
const scriptletSource = `
import { matchesScope } from './src/shared/cosmetic.js';
const functions = {${[...functions].map(([name, fn]) => `${JSON.stringify(name)}: ${fn}`).join(',\n')}};
const rules = ${JSON.stringify(scriptRules)};
const matched = rules.filter(rule => matchesScope(location.hostname, rule.i, rule.x));
const exceptions = matched.filter(rule => rule.e);
for (const rule of matched) {
  if (rule.e || exceptions.some(exception => !exception.name || (exception.name === rule.name && (!exception.args.length || JSON.stringify(exception.args) === JSON.stringify(rule.args))))) continue;
  try {
    functions[rule.name]({ name: rule.name, args: rule.args, engine: 'extension', verbose: false, uniqueId: 'adstop-' + rule.name + JSON.stringify(rule.args) }, rule.args);
  } catch {}
}
`;

const metadata = {
  version: JSON.parse(await readFile('package.json', 'utf8')).version,
  updatedAt: lock.downloadedAt,
  coreRules: core.length,
  extendedRules: extended.length,
  networkRules: deduped.length,
  cosmeticRules: parsed.cosmetics.rules.length,
  scriptletRules: scriptRules.filter(rule => !rule.e).length,
  scriptletFunctions: functions.size,
  skippedRules: parsed.skipped.length,
  conversionErrors: result.errors.length,
  excludedActions: 0,
  converter: { name: '@adguard/dnr-converter', version: DNR_CONVERTER_VERSION },
  sources: lock.sources.map(({ name, homepage, license, sha256 }) => ({ name, homepage, license, sha256 })),
  twitch: lock.twitch
};

for (const browser of ['chromium', 'firefox']) {
  const out = `dist/${browser}`;
  for (const directory of ['content', 'data', 'rules', 'icons', 'licenses']) await mkdir(`${out}/${directory}`, { recursive: true });
  await build({
    entryPoints: { background: 'src/background.js', popup: 'src/ui/popup.js', options: 'src/ui/options.js' },
    outdir: out, bundle: true, format: 'esm', target: 'chrome128', minifyWhitespace: true, legalComments: 'none', charset: 'utf8'
  });
  for (const name of ['youtube', 'cosmetic']) {
    await build({ entryPoints: [`src/content/${name}.js`], outfile: `${out}/content/${name}.js`, bundle: true, format: 'iife', target: 'chrome128', minifyWhitespace: true, legalComments: 'none', charset: 'utf8' });
  }
  await build({ stdin: { contents: scriptletSource, resolveDir: process.cwd(), sourcefile: 'scriptlet-rules.js' }, outfile: `${out}/content/scriptlets.js`, bundle: true, format: 'iife', target: 'chrome128', minifyWhitespace: true, legalComments: 'none', charset: 'utf8' });
  await writeFile(`${out}/content/twitch.js`, twitchSource);
  for (const file of ['popup.html', 'options.html', 'style.css', 'theme.js']) await cp(`src/ui/${file}`, `${out}/${file}`);
  await writeFile(`${out}/rules/core.json`, JSON.stringify(core));
  await writeFile(`${out}/rules/extended.json`, JSON.stringify(extended));
  await writeFile(`${out}/data/blocking-rules.json`, JSON.stringify(Object.fromEntries([['core', core], ['extended', extended]].map(([id, rules]) => [id, rules.filter(rule => rule.action.type === 'block' || rule.action.redirect?.extensionPath?.startsWith('/redirects/')).map(rule => rule.id)]))));
  await writeFile(`${out}/data/cosmetic.json`, JSON.stringify(parsed.cosmetics));
  await writeFile(`${out}/data/metadata.json`, JSON.stringify(metadata, null, 2) + '\n');
  await cp('LICENSE', `${out}/licenses/GPL-3.0.txt`);
  await cp('vendor/LICENSE-twitch.txt', `${out}/licenses/Twitch-MIT.txt`);
  await cp('THIRD_PARTY_NOTICES.md', `${out}/licenses/THIRD_PARTY_NOTICES.md`);
  await cp('node_modules/@adguard/scriptlets/dist/redirect-files', `${out}/redirects`, { recursive: true });
  await cp('src/redirects', `${out}/redirects`, { recursive: true });
  await makeIcons(`${out}/icons`);
  const manifest = {
    manifest_version: 3,
    name: 'AdStop',
    version: metadata.version,
    description: 'Bloquea anuncios y rastreadores con filtros de EasyList, uBlock Origin y Pie',
    minimum_chrome_version: '128',
    permissions: ['storage', 'scripting', 'declarativeNetRequest', 'declarativeNetRequestFeedback', 'webNavigation'],
    host_permissions: ['http://*/*', 'https://*/*'],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_title: 'AdStop', default_popup: 'popup.html', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    options_ui: { page: 'options.html', open_in_tab: true },
    content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content/cosmetic.js'], run_at: 'document_start', all_frames: true }],
    declarative_net_request: { rule_resources: [{ id: 'core', enabled: true, path: 'rules/core.json' }, { id: 'extended', enabled: false, path: 'rules/extended.json' }] },
    web_accessible_resources: [{ resources: ['redirects/*'], matches: ['http://*/*', 'https://*/*'] }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" }
  };
  if (browser === 'firefox') {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = { gecko: { id: 'adstop@adstop.local', strict_min_version: '140.0', data_collection_permissions: { required: [] } } };
  }
  await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${browser}: ${metadata.networkRules} reglas de red, ${metadata.cosmeticRules} filtros visuales y ${metadata.scriptletRules} scriptlets`);
}

await mkdir('reports', { recursive: true });
await writeFile('reports/filters.json', JSON.stringify({ ...metadata, limitations: result.limitations.map(error => error.message), errors: result.errors.map(error => error.message), skipped: parsed.skipped }, null, 2) + '\n');
console.log(`Informe: reports/filters.json (${metadata.conversionErrors} errores de conversion, ${metadata.skippedRules} reglas no compatibles)`);
