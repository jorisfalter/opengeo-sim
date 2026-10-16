#!/usr/bin/env node
// Copies the JSBSim WebAssembly build next to the app.
//
// The package points at its own files with `new URL(..., import.meta.url)`,
// which a bundler has to guess at. Serving them from public/ instead means the
// loader is handed two plain URLs and there is nothing left to guess.
import { copyFile, mkdir, readdir } from 'node:fs/promises';

const from = new URL('../node_modules/@0x62/jsbsim-wasm/dist/wasm/', import.meta.url);
const to = new URL('../public/fdm/wasm/', import.meta.url);

await mkdir(to, { recursive: true });
const files = (await readdir(from)).filter((name) => /\.(mjs|wasm)$/.test(name));
for (const name of files) {
  await copyFile(new URL(name, from), new URL(name, to));
}
console.log(`fdm/wasm: ${files.join(', ')}`);
