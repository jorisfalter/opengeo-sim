// Elevation sampling from the public Terrarium tiles on AWS — global, keyless,
// no quota. Heights are encoded in the pixels: (R * 256 + G + B / 256) - 32768.
//
// PNG decoding is done here rather than pulled in as a dependency: these tiles
// are 8-bit RGB without interlacing, so it is a chunk walk, one inflate and the
// five standard scanline filters.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TILE_SIZE = 256;
const cache = new Map();

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('expected 8-bit samples');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported colour type ${data[9]}`);
      if (data[12] !== 0) throw new Error('interlaced PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let pos = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(row * stride, (row + 1) * stride);
    const prior = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// S3 drops connections now and then when a few thousand tiles are pulled in a
// row; a handful of retries costs nothing and saves the whole run.
async function fetchTile(z, x, y, key) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(`${TILES}/${z}/${x}/${y}.png`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`terrarium ${key}: ${lastError.message}`);
}

async function tile(z, x, y, cacheDir) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const file = resolve(cacheDir, `${z}/${x}/${y}.png`);
  let buffer;
  if (existsSync(file)) {
    buffer = await readFile(file);
  } else {
    buffer = await fetchTile(z, x, y, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buffer);
  }
  const image = decodePng(buffer);
  cache.set(key, image);
  return image;
}

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

/** Elevation in metres at one point, bilinear between pixels. */
export async function elevationAt(lat, lon, { zoom = 10, cacheDir = 'data/dem' } = {}) {
  const fx = lonToX(lon, zoom) * TILE_SIZE;
  const fy = latToY(lat, zoom) * TILE_SIZE;
  const px = Math.floor(fx);
  const py = Math.floor(fy);
  const image = await tile(zoom, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE), cacheDir);
  const at = (ix, iy) => {
    const cx = Math.max(0, Math.min(TILE_SIZE - 1, ix - Math.floor(px / TILE_SIZE) * TILE_SIZE));
    const cy = Math.max(0, Math.min(TILE_SIZE - 1, iy - Math.floor(py / TILE_SIZE) * TILE_SIZE));
    const offset = (cy * image.width + cx) * image.channels;
    const r = image.pixels[offset];
    const g = image.pixels[offset + 1];
    const b = image.pixels[offset + 2];
    return r * 256 + g + b / 256 - 32768;
  };
  const tx = fx - px;
  const ty = fy - py;
  return (
    at(px, py) * (1 - tx) * (1 - ty) +
    at(px + 1, py) * tx * (1 - ty) +
    at(px, py + 1) * (1 - tx) * ty +
    at(px + 1, py + 1) * tx * ty
  );
}

/** Elevation profile along a polyline, sampled every `step` metres. */
export async function profile(points, { step = 2000, zoom = 10, cacheDir = 'data/dem' } = {}) {
  const EARTH = 6371008.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const distance = (a, b) => {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.sqrt(h));
  };
  const out = [];
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const span = distance(a, b);
    const count = Math.max(1, Math.round(span / step));
    for (let k = 0; k < count; k += 1) {
      const t = k / count;
      const lon = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      out.push({
        s: travelled + span * t,
        lon,
        lat,
        h: await elevationAt(lat, lon, { zoom, cacheDir }),
      });
    }
    travelled += span;
  }
  const last = points.at(-1);
  out.push({
    s: travelled,
    lon: last[0],
    lat: last[1],
    h: await elevationAt(last[1], last[0], { zoom, cacheDir }),
  });
  return out;
}
