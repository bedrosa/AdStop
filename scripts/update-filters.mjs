import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const sources = JSON.parse(await readFile('filters/sources.json', 'utf8'));
const staging = 'filters/.incoming';
await mkdir(staging, { recursive: true });
const lock = { downloadedAt: new Date().toISOString(), sources: [] };

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status} al descargar ${url}`);
  const text = await response.text();
  if (text.length < 100 || text.length > 15000000 || /<!doctype html/i.test(text)) {
    throw new Error(`Contenido inesperado en ${url}`);
  }
  return text;
}

try {
  for (const source of sources) {
    const text = await download(source.url);
    if (!text.includes('\n') || !text.includes('!')) throw new Error(`Lista no reconocida ${source.id}`);
    await writeFile(`${staging}/${source.id}.txt`, text);
    lock.sources.push({ ...source, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });
    console.log(`${source.name}: ${text.split('\n').length} lineas`);
  }
  const revision = 'f8f86706daf90daa534b26bce5b2f01238667d5f';
  const twitchUrl = `https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/${revision}/vaft/vaft-ublock-origin.js`;
  const twitch = await download(twitchUrl);
  const { code } = await transform(twitch.slice(twitch.indexOf('\n') + 1), {
    legalComments: 'none', target: 'chrome121', minifyWhitespace: true
  });
  await writeFile(`${staging}/twitch.js`, code);
  await writeFile(`${staging}/LICENSE-twitch.txt`, await download(`https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/${revision}/LICENSE`));
  await writeFile(`${staging}/LICENSE`, await download('https://raw.githubusercontent.com/piedotorg/pie-adblock-rules/main/LICENSE'));
  lock.twitch = { url: twitchUrl, revision, license: 'MIT', sha256: createHash('sha256').update(twitch).digest('hex'), bundledSha256: createHash('sha256').update(code).digest('hex') };
  await mkdir('filters/upstream', { recursive: true });
  await mkdir('vendor', { recursive: true });
  for (const source of sources) await rename(`${staging}/${source.id}.txt`, `filters/upstream/${source.id}.txt`);
  await rename(`${staging}/twitch.js`, 'vendor/twitch.js');
  await rename(`${staging}/LICENSE-twitch.txt`, 'vendor/LICENSE-twitch.txt');
  await rename(`${staging}/LICENSE`, 'LICENSE');
  await writeFile('filters/lock.json', JSON.stringify(lock, null, 2) + '\n');
  console.log('Fuentes actualizadas y verificadas');
} finally {
  await rm(staging, { recursive: true, force: true });
}
