import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function inside(x, y, points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if ((points[i][1] > y) !== (points[j][1] > y) && x < (points[j][0] - points[i][0]) * (y - points[i][1]) / (points[j][1] - points[i][1]) + points[i][0]) result = !result;
  }
  return result;
}

export async function makeIcons(directory) {
  for (const size of [16, 32, 48, 128]) {
    const data = Buffer.alloc(size * (size * 4 + 1));
    const shield = [[0.5, 0.14], [0.8, 0.26], [0.76, 0.59], [0.67, 0.73], [0.5, 0.85], [0.33, 0.73], [0.24, 0.59], [0.2, 0.26]];
    const mark = [[0.45, 0.32], [0.57, 0.32], [0.68, 0.64], [0.56, 0.64], [0.53, 0.55], [0.44, 0.55], [0.41, 0.64], [0.3, 0.64]];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sum = [0, 0, 0, 0];
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
          const u = (x + (dx + 0.5) / 4) / size;
          const v = (y + (dy + 0.5) / 4) / size;
          const roundX = Math.max(0.15 - u, u - 0.85, 0);
          const roundY = Math.max(0.15 - v, v - 0.85, 0);
          let color = [15, 24, 43, roundX * roundX + roundY * roundY > 0.0225 ? 0 : 255];
          if (inside(u, v, shield)) color = [70, 224, 174, 255];
          if (inside(u, v, mark)) color = [15, 24, 43, 255];
          for (let channel = 0; channel < 4; channel++) sum[channel] += color[channel] / 16;
        }
        const offset = y * (size * 4 + 1) + 1 + x * 4;
        for (let channel = 0; channel < 4; channel++) data[offset + channel] = Math.round(sum[channel]);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    await writeFile(`${directory}/${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]));
  }
}
