import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

await mkdir('releases', { recursive: true });
const version = JSON.parse(await readFile('package.json', 'utf8')).version;

async function collect(directory, prefix = '', omit = new Set()) {
  const files = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (omit.has(entry.name) || entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await collect(fullPath, name + '/', omit));
    else if (entry.isFile()) files[name] = new Uint8Array(await readFile(fullPath));
  }
  return files;
}

for (const browser of ['chromium', 'firefox']) {
  const files = await collect(`dist/${browser}`, '', new Set(['_metadata']));
  files['INSTALACION.txt'] = strToU8(browser === 'chromium' ? 'Descomprime este ZIP y carga su carpeta desde chrome://extensions o brave://extensions con Modo de desarrollador y Cargar descomprimida. El codigo fuente esta en AdStop-Source.zip, junto a este paquete.\n' : 'Descomprime este ZIP y selecciona manifest.json desde about:debugging, Este Firefox, Cargar complemento temporal. Para instalacion permanente se necesita firma de Mozilla. El codigo fuente esta en AdStop-Source.zip.\n');
  const filename = `releases/AdStop-${browser}-${version}.zip`;
  await writeFile(filename, zipSync(files, { level: 6 }));
  console.log(filename);
}
const source = {};
for (const directory of ['src', 'scripts', 'tests', 'filters', 'vendor', '.github', 'reports']) {
  Object.assign(source, await collect(directory, `${directory}/`, new Set(['.incoming'])));
}
for (const file of ['package.json', 'package-lock.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'actualizar.cmd', '.gitignore', '.gitattributes']) {
  source[file] = new Uint8Array(await readFile(file));
}
await writeFile('releases/AdStop-Source.zip', zipSync(source, { level: 6 }));
console.log('releases/AdStop-Source.zip');
