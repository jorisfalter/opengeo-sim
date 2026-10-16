// Samples AHN elevation for WGS84 points through the PDOK AHN WCS.
//
// Two coverages matter here. `dtm_05m` is terrain: correct along the open
// track, but on a viaduct it returns the road or water *under* the track, and
// it has nodata under buildings and station roofs. `dsm_05m` is the surface,
// which does carry a bridge deck. The ride builder samples both and uses the
// surface only where OSM says the track is on a bridge.
//
// Two implementation notes keep this dependency-free:
//   * `GEOTIFF:COMPRESSION=None` turns off the default Deflate + floating point
//     predictor, leaving plain float32 strips that are ~60 lines to read.
//   * `subsettingCrs=EPSG:4326` also switches the *output* grid to degrees, so
//     points can be indexed by lat/lon and no RD projection is needed.

const WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';
const NODATA_LIMIT = 1e30;
const METERS_PER_DEGREE_LAT = 111320;

function readTiff(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const little = buffer.toString('ascii', 0, 2) === 'II';
  const u16 = (offset) => view.getUint16(offset, little);
  const u32 = (offset) => view.getUint32(offset, little);
  if (u16(2) !== 42) throw new Error('not a TIFF');
  const tags = new Map();
  const ifd = u32(4);
  const entries = u16(ifd);
  const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = typeSize[type] ?? 4;
    const offset = count * size <= 4 ? entry + 8 : u32(entry + 8);
    const values = [];
    for (let j = 0; j < count; j += 1) {
      const at = offset + j * size;
      if (type === 3) values.push(u16(at));
      else if (type === 4) values.push(u32(at));
      else if (type === 12) values.push(view.getFloat64(at, little));
      else if (type === 11) values.push(view.getFloat32(at, little));
      else values.push(view.getUint8(at));
    }
    tags.set(tag, values);
  }
  const width = tags.get(256)[0];
  const height = tags.get(257)[0];
  if ((tags.get(259)?.[0] ?? 1) !== 1) throw new Error('expected an uncompressed TIFF');
  if ((tags.get(339)?.[0] ?? 1) !== 3 || (tags.get(258)?.[0] ?? 0) !== 32) {
    throw new Error('expected float32 samples');
  }
  const rowsPerStrip = tags.get(278)?.[0] ?? height;
  const stripOffsets = tags.get(273);
  const scale = tags.get(33550);
  const tiepoint = tags.get(33922);
  const data = new Float32Array(width * height);
  for (let strip = 0; strip < stripOffsets.length; strip += 1) {
    const firstRow = strip * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - firstRow);
    for (let i = 0; i < rows * width; i += 1) {
      data[firstRow * width + i] = view.getFloat32(stripOffsets[strip] + i * 4, little);
    }
  }
  return {
    width,
    height,
    data,
    lon0: tiepoint[3],
    lat0: tiepoint[4],
    dLon: scale[0],
    dLat: scale[1],
  };
}

async function fetchCoverage(coverage, box) {
  const url =
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${coverage}` +
    '&format=image/tiff&GEOTIFF:COMPRESSION=None' +
    '&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326' +
    `&subset=Lat(${box.south.toFixed(6)},${box.north.toFixed(6)})` +
    `&subset=Long(${box.west.toFixed(6)},${box.east.toFixed(6)})`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AHN WCS ${coverage}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 16) throw new Error(`AHN WCS ${coverage}: empty response`);
  return readTiff(buffer);
}

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

// Values in a square window around a point, nodata dropped. The DTM has nodata
// under buildings, so an empty window is normal and handled by the caller.
function windowValues(raster, point, halfLat, halfLon) {
  const values = [];
  const colFrom = Math.floor((point.lon - halfLon - raster.lon0) / raster.dLon);
  const colTo = Math.ceil((point.lon + halfLon - raster.lon0) / raster.dLon);
  const rowFrom = Math.floor((raster.lat0 - point.lat - halfLat) / raster.dLat);
  const rowTo = Math.ceil((raster.lat0 - point.lat + halfLat) / raster.dLat);
  for (let row = Math.max(0, rowFrom); row <= Math.min(raster.height - 1, rowTo); row += 1) {
    for (let col = Math.max(0, colFrom); col <= Math.min(raster.width - 1, colTo); col += 1) {
      const value = raster.data[row * raster.width + col];
      if (Number.isFinite(value) && Math.abs(value) < NODATA_LIMIT) values.push(value);
    }
  }
  return values;
}

// Splits the point list so one WCS request covers a bounded box: a 5 km route
// then needs ~20 requests instead of one per point.
function chunk(points, maxSpanDegrees) {
  const chunks = [];
  let current = [];
  let box = null;
  for (const point of points) {
    const next = box
      ? {
          south: Math.min(box.south, point.lat),
          north: Math.max(box.north, point.lat),
          west: Math.min(box.west, point.lon),
          east: Math.max(box.east, point.lon),
        }
      : { south: point.lat, north: point.lat, west: point.lon, east: point.lon };
    if (
      current.length &&
      (next.north - next.south > maxSpanDegrees || next.east - next.west > maxSpanDegrees)
    ) {
      chunks.push({ points: current, box });
      current = [point];
      box = { south: point.lat, north: point.lat, west: point.lon, east: point.lon };
      continue;
    }
    current.push(point);
    box = next;
  }
  if (current.length) chunks.push({ points: current, box });
  return chunks;
}

/**
 * Samples one AHN coverage ('dtm_05m' or 'dsm_05m') at WGS84 points.
 * Returns metres NAP, or null where the window holds only nodata.
 *
 * `halfWindow` is half the side of the sampling square in metres and `pick` the
 * percentile taken from it: a median for ground, and something lower on a
 * bridge deck where the window can still catch catenary or a passing train.
 */
export async function sampleAhn(points, options = {}) {
  const {
    coverage = 'dtm_05m',
    halfWindow = 1.5,
    pick = 0.5,
    margin = 25,
    maxSpan = 0.004,
    onProgress,
  } = options;
  const heights = new Array(points.length).fill(null);
  const chunks = chunk(points, maxSpan);
  let index = 0;
  let done = 0;
  for (const part of chunks) {
    const midLat = (part.box.south + part.box.north) / 2;
    const lonScale = METERS_PER_DEGREE_LAT * Math.cos((midLat * Math.PI) / 180);
    const box = {
      south: part.box.south - margin / METERS_PER_DEGREE_LAT,
      north: part.box.north + margin / METERS_PER_DEGREE_LAT,
      west: part.box.west - margin / lonScale,
      east: part.box.east + margin / lonScale,
    };
    const raster = await fetchCoverage(coverage, box);
    const halfLat = halfWindow / METERS_PER_DEGREE_LAT;
    const halfLon = halfWindow / lonScale;
    for (const point of part.points) {
      heights[index] = percentile(windowValues(raster, point, halfLat, halfLon), pick);
      index += 1;
    }
    done += 1;
    onProgress?.(done, chunks.length);
  }
  return heights;
}

/** Fills null gaps by linear interpolation between the nearest known samples. */
export function fillGaps(values) {
  const out = [...values];
  const first = out.findIndex((value) => value !== null);
  if (first === -1) return out;
  for (let i = 0; i < first; i += 1) out[i] = out[first];
  const last = out.length - 1 - [...out].reverse().findIndex((value) => value !== null);
  for (let i = last + 1; i < out.length; i += 1) out[i] = out[last];
  let gapStart = -1;
  for (let i = first; i <= last; i += 1) {
    if (out[i] === null && gapStart === -1) gapStart = i;
    if (out[i] !== null && gapStart !== -1) {
      const before = out[gapStart - 1];
      const after = out[i];
      const span = i - gapStart + 1;
      for (let j = gapStart; j < i; j += 1) {
        out[j] = before + ((after - before) * (j - gapStart + 1)) / span;
      }
      gapStart = -1;
    }
  }
  return out;
}

/** Moving-median filter: kills single-pixel spikes without rounding off ramps. */
export function medianFilter(values, halfWidth) {
  return values.map((_, i) => {
    const from = Math.max(0, i - halfWidth);
    const to = Math.min(values.length - 1, i + halfWidth);
    const window = values.slice(from, to + 1).filter((value) => value !== null);
    if (!window.length) return values[i];
    const sorted = [...window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
}
