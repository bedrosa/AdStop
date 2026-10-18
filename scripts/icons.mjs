import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

export async function makeIcons(directory) {
  const svg = await readFile('src/ui/logo.svg');
  const inactive = Buffer.from(svg.toString().replace('#df2537', '#737780'));
  await writeFile(`${directory}/logo.svg`, svg);
  for (const size of [16, 32, 48, 128]) {
    await sharp(svg).resize(size, size).png().toFile(`${directory}/${size}.png`);
    await sharp(inactive).resize(size, size).png().toFile(`${directory}/${size}-off.png`);
  }
}
