#!/usr/bin/env node
// Checks a deployed site the way a browser does: are the MIME types right?
//
//   node scripts/deploy-check.mjs https://opengeo.ai-tigers.com
//
// This exists because a `types { application/wasm wasm; }` block in nginx
// does not add a type, it REPLACES the entire inherited map — so every file,
// including the HTML and the ES modules, went out as application/octet-stream
// and the browser refused to run any of it. curl said 200 the whole time.
const base = (process.argv[2] ?? 'https://opengeo.ai-tigers.com').replace(/\/$/, '');
const bust = `?v=${Date.now()}`;

const page = await fetch(`${base}/fly.html${bust}`);
const html = await page.text();
const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
const checks = [
  ['/fly.html', 'text/html'],
  ['/fdm/wasm/jsbsim_wasm.wasm', 'application/wasm'],
  ['/fdm/aircraft/pc24/pc24.xml', /xml/],
  ['/fly/lflj.json', 'application/json'],
  // The WebAssembly loader is an .mjs, which nginx 1.24 does not know either;
  // nothing in the HTML links to it, so it has to be named here or the check
  // passes while the simulator refuses to start.
  ['/fdm/wasm/jsbsim_wasm.mjs', /javascript/],
  ...assets.map((path) => [path, path.endsWith('.css') ? 'text/css' : /javascript/]),
];

let bad = 0;
for (const [path, want] of checks) {
  const res = await fetch(`${base}${path}${bust}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  const ok = res.ok && (want instanceof RegExp ? want.test(type) : type === want);
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FOUT'} ${String(res.status).padEnd(4)} ${type.padEnd(26)} ${path}`);
}
console.log(bad ? `\n${bad} bestand(en) met een verkeerd type — de browser weigert die.` : '\nAlle typen goed.');
process.exit(bad ? 1 : 0);
