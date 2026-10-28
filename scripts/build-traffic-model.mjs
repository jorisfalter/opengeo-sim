#!/usr/bin/env node
// The aeroplane the other traffic is drawn as.
//
//   npm run build:model
//
// There is no model in this project and there cannot be a downloaded one: an
// aircraft model carries its own licence, and this distribution is MIT with a
// handful of open data sets named in docs/licensing.md. So this writes one —
// a low-poly airliner, a hundred-odd triangles, flat shaded and white so that
// the entity's own colour can tint it an airline's livery.
//
// It is authored here nose along +Z, because that is the readable way to
// write the geometry down, and then turned to face -Z, which is where glTF
// says forward is and what Cesium's heading expects.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Roughly an A320: 37 m long, 36 m span, 12 m tall.
const NOSE = 18.5;
const TAIL = -18.5;
const R = 1.9; // fuselage radius

const faces = []; // each: array of 3+ vertices, wound counter-clockwise

/** A ring of points around the fuselage axis at this station. */
const ring = (z, r, lift = 0) =>
  [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return [Math.cos(a) * r, Math.sin(a) * r + lift, z];
  });

/** Joins two rings into a band of quads. */
function band(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    const j = (i + 1) % a.length;
    faces.push([a[i], a[j], b[j], b[i]]);
  }
}

const stations = [
  [NOSE, 0.25],
  [NOSE - 3, 1.35],
  [NOSE - 7, R],
  [TAIL + 11, R],
  [TAIL + 4, 1.5, 0.9],
  [TAIL, 0.45, 1.9],
];
for (let i = 0; i + 1 < stations.length; i += 1) {
  const [z0, r0, lift0 = 0] = stations[i];
  const [z1, r1, lift1 = 0] = stations[i + 1];
  band(ring(z0, r0, lift0), ring(z1, r1, lift1));
}

/** A flat panel with thickness, given its outline in a plane. */
function plate(points, thickness, axis) {
  const half = thickness / 2;
  const up = axis === 'y' ? [0, half, 0] : [half, 0, 0];
  const top = points.map((p) => [p[0] + up[0], p[1] + up[1], p[2] + up[2]]);
  const bottom = points.map((p) => [p[0] - up[0], p[1] - up[1], p[2] - up[2]]);
  faces.push(top);
  faces.push([...bottom].reverse());
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    faces.push([top[i], top[j], bottom[j], bottom[i]]);
  }
}

// Wings, swept back, one each side. Root at the fuselage, tip outboard and aft.
for (const side of [1, -1]) {
  plate(
    [
      [side * 1.7, -0.6, 4.5],
      [side * 17.8, -0.1, -7.5],
      [side * 17.8, -0.1, -9.6],
      [side * 1.7, -0.6, -6.5],
    ].map((p) => (side > 0 ? p : [p[0], p[1], p[2]])),
    0.7,
    'y',
  );
  // Engine, slung under and ahead of the wing.
  const ex = side * 7.6;
  band(ring(0.5, 1.25).map((p) => [p[0] + ex, p[1] - 2.6, p[2]]),
       ring(-4.5, 1.1).map((p) => [p[0] + ex, p[1] - 2.6, p[2]]));
  // Tailplane.
  plate(
    [
      [side * 1.2, 0.9, TAIL + 6.5],
      [side * 6.6, 1.2, TAIL + 2.4],
      [side * 6.6, 1.2, TAIL + 1.2],
      [side * 1.2, 0.9, TAIL + 3.5],
    ],
    0.45,
    'y',
  );
}

// Fin.
plate(
  [
    [0, 1.4, TAIL + 7.5],
    [0, 7.6, TAIL + 2.2],
    [0, 7.6, TAIL + 0.6],
    [0, 1.4, TAIL + 0.5],
  ],
  0.5,
  'x',
);

// ---- to triangles, flat shaded ------------------------------------------
const positions = [];
const normals = [];
const indices = [];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// Half a turn about the vertical, (x, y, z) -> (-x, y, -z): a rotation and
// not a mirror, so the winding and the normals come through unharmed.
//
// It puts the nose on -Z, which is where glTF says forward is. Cesium turns a
// glTF's Y-up into its own Z-up, so the model's -Z lands on +Y of the frame
// that heading, pitch and roll are measured in — and that frame, as
// aircraft.js found out the hard way, is x to the right, y forward, z up.
const turned = faces.map((face) => face.map(([x, y, z]) => [-x, y, -z]));
for (const face of turned) {
  const n = cross(sub(face[1], face[0]), sub(face[2], face[0]));
  const len = Math.hypot(...n) || 1;
  const unit = n.map((v) => v / len);
  const first = positions.length / 3;
  for (const point of face) {
    positions.push(...point);
    normals.push(...unit);
  }
  for (let i = 1; i + 1 < face.length; i += 1) indices.push(first, first + i, first + i + 1);
}

// ---- glb ----------------------------------------------------------------
const posBytes = Buffer.from(new Float32Array(positions).buffer);
const normBytes = Buffer.from(new Float32Array(normals).buffer);
const idxBytes = Buffer.from(new Uint16Array(indices).buffer);
/**
 * Chunks are padded to four bytes, and *what* with matters: the spec says the
 * JSON chunk is padded with spaces and the binary chunk with zeroes. Padding
 * the JSON with zero bytes writes a file that looks right, reports the right
 * length, and fails to parse — the model simply never appeared, with nothing
 * thrown to say why.
 */
const pad = (buffer, fill = 0, to = 4) => {
  const over = buffer.length % to;
  if (over === 0) return buffer;
  const tail = Buffer.alloc(to - over, fill);
  return Buffer.concat([buffer, tail]);
};
const parts = [pad(posBytes), pad(normBytes), pad(idxBytes)];
const bin = Buffer.concat(parts);
let offset = 0;
const views = parts.map((part, i) => {
  const view = { buffer: 0, byteOffset: offset, byteLength: [posBytes, normBytes, idxBytes][i].length };
  offset += part.length;
  return view;
});
const bounds = (list, stride, at) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = at; i < list.length; i += stride) {
    lo = Math.min(lo, list[i]);
    hi = Math.max(hi, list[i]);
  }
  return [lo, hi];
};
const [minX, maxX] = bounds(positions, 3, 0);
const [minY, maxY] = bounds(positions, 3, 1);
const [minZ, maxZ] = bounds(positions, 3, 2);

const gltf = {
  asset: { version: '2.0', generator: 'opengeo-sim build-traffic-model' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'airliner' }],
  meshes: [{
    primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    name: 'airliner',
  }],
  materials: [{
    name: 'skin',
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0.15,
      roughnessFactor: 0.55,
    },
    doubleSided: true,
  }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { ...views[0], target: 34962 },
    { ...views[1], target: 34962 },
    { ...views[2], target: 34963 },
  ],
  buffers: [{ byteLength: bin.length }],
};

const json = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
const chunk = (data, type) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
};
const jsonChunk = chunk(json, 0x4e4f534a);
const binChunk = chunk(bin, 0x004e4942);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);

const out = resolve(process.argv[2] ?? 'public/fly/airliner.glb');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.concat([header, jsonChunk, binChunk]));
console.log(
  `${out} — ${(12 + jsonChunk.length + binChunk.length) / 1024 | 0} kB, ` +
    `${indices.length / 3} driehoeken, ${(maxZ - minZ).toFixed(1)} m lang, ${(maxX - minX).toFixed(1)} m spanwijdte`,
);
