# opengeo-sim

Two browser simulators whose scenery is not a download but a live stream of
national open geodata.

- **`ride.html`** — a cab ride from Amsterdam Centraal to Sloterdijk or
  Lelylaan, over PDOK terrain, 8 cm aerial photography and LoD 2.2 buildings,
  with the track itself built from the ProRail import in OpenStreetMap and
  heights sampled from AHN at 1 m.
- **`fly.html`** — a light jet **you fly yourself**, on **JSBSim**:
  FlightGear's flight dynamics engine, compiled to WebAssembly and running at
  120 Hz, on a PC-24 model written for this project and checked against the
  published figures. Start on the runway at Chambéry-Savoie, on the 18.6%
  slope at Courchevel Altiport, or anywhere on earth — the terrain and the
  satellite imagery are global, and the two Alpine runways are built from OSM
  outlines and IGN elevations. Keyboard, mouse yoke or gamepad; the autopilot
  is a button, not the default.

No API keys. Every service used answers without an account.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

The generated geometry is committed, so both pages work immediately. To rebuild
it:

```bash
npm run build:ride -- --ride ams-centraal-sloterdijk
npm run build:airport -- --airport lflj
```

The flight model can be flown without a browser, which is how it was tuned:

```bash
npm run test:fdm                          # take-off, climb to FL410, cruise, stall
node scripts/fly-check.mjs lflb 22        # autopilot: Chambéry to a stop at Courchevel
node scripts/fly-check.mjs lflb 9 manual  # hand-flown, through the same axes you use
```

## Deploy your own

The built site is static files and nothing else — no server, no database, no
account, no API key. Every service it talks to answers an anonymous browser,
so your copy is as complete as the one it was forked from.

```bash
npm run build                      # -> dist/, serve it from anywhere
```

If it is served from a subdirectory — which is what GitHub Pages hands a fork
at `yourname.github.io/opengeo-sim/` — tell the build where it will live, and
the data, scenery and flight model follow:

```bash
npm run build -- --base=/opengeo-sim/
```

Then check it the way a browser does, not the way `curl` does:

```bash
npm run check:deploy -- https://your-host.example
```

The repository carries a GitHub Actions workflow that does the subdirectory
build and publishes it to Pages: enable Pages in your fork's settings, then run
**Actions → Publish to GitHub Pages**. It is manual on purpose, so a fork never
has a failing build it did not ask for.

The reference deployment runs behind nginx on loopback and a Cloudflare tunnel
at `opengeo.ai-tigers.com`, with `rsync -a --delete dist/` into the served
directory. Two MIME traps are worth knowing before you serve this yourself, because both
got past a green `curl`:

- A `types { application/wasm wasm; }` block in the nginx server **replaces**
  the entire inherited MIME map rather than adding to it, so every file —
  the HTML, the ES modules, everything — went out as
  `application/octet-stream`, and a browser will not execute a module with
  that type. nginx 1.24 already maps `.wasm`, so the right amount of
  configuration there was none.
- nginx does not know `.mjs`, and the WebAssembly loader is one. Nothing in
  the HTML links to it, so only loading the page in a real browser found it.

The check covers both, plus gzip, and takes a cache-busting query string
because Cloudflare will happily cache a wrong content type for thirty days.

## Why this exists

FlightGear ships the world as a pre-generated download: uniform, offline and
ageing. Commercial simulators look better and are closed. This takes the third
road — the scenery is whatever the national mapping agency published most
recently, fetched while you fly over it. Where a country publishes LiDAR and
20 cm orthophotography, that is what you see; elsewhere it falls back to global
30 m terrain and 10 m satellite imagery.

What follows from that is a pipeline rather than an asset library:

- `scripts/overpass.mjs` — OpenStreetMap geometry, cached, mirror-rotating.
- `scripts/dem.mjs` — elevation from the public Terrarium tiles, with its own
  PNG decoder so there is no dependency to install.
- `scripts/ahn.mjs` — Dutch AHN heights through the PDOK WCS.
- `scripts/build-ride.mjs` — a railway's centreline, curvature, cant, signals
  and vertical profile from OSM plus AHN.
- `scripts/build-airport.mjs` — runway and apron geometry from OSM outlines
  plus the IGN elevation service.

## Documentation

| | |
| --- | --- |
| `docs/ride-view.md` | How the cab ride is built, and what it gets wrong |
| `docs/flight-view.md` | The same for the flight view, the JSBSim model and its validation |
| `docs/cabride-demo-plan.md` | The research behind the rail side (in Dutch) |
| `docs/licensing.md` | Code is MIT, data keeps its own licence; the full reasoning |
| `ATTRIBUTION.md` | Every source, its licence, and what it requires |

## Status

Both views work and neither is finished.

The flight side is a simulator rather than a demo: you have the controls from
the first frame, you can begin anywhere in the world, and the autopilot will
fly the Chambéry–Courchevel valley and land if you ask it to.
`scripts/fly-check.mjs` verifies both, headless, on the built page. Every
airfield on earth is a start: 28,338 of them from OurAirports, including the
thousands whose runway ends were never surveyed and are laid out from the
runway number. Buildings, trees and aerial photography at 8 to 25 cm cover the
Alpine valleys and the corridor from Amsterdam to Hasselt. What is missing is
weather, a cockpit you can look around, a second aeroplane — and multiplayer,
which is the reason the paths above are relative.

The rail view has no cab interior and no sound. The parts that are genuinely
solid across both are the data pipeline and the terrain handling — the geoid
offsets, the clipping of road decks, the surveyed runway slope, and the
three-source ground feed that keeps the aeroplane out of the mountainside.

Licensing is deliberate rather than incidental: MIT code, ODbL for the data
derived from OpenStreetMap, CC BY for our own, and JSBSim's LGPL kept to its
own replaceable file. `docs/licensing.md` has the reasoning.
