# Attribution and data licences

Everything this project renders comes from open data. No API keys, no accounts.
This file lists what is used, under what licence, and what that requires. The
running apps show a short credit line; this is the long version.

## Code dependencies

| Package | Licence |
| --- | --- |
| CesiumJS | Apache-2.0 |
| **JSBSim** (flight dynamics, as WebAssembly) | **LGPL-2.1** |
| `@0x62/jsbsim-wasm` (the wrapper and build) | MIT |
| Leaflet | BSD-2-Clause |
| React, React-DOM, react-leaflet | MIT |
| Vite, vite-plugin-cesium | MIT |
| adm-zip, csv-parse, yauzl | MIT |
| lucide-react | ISC |

All permissive except JSBSim, which is LGPL-2.1 — the only copyleft component
in the project. The LGPL asks that whoever receives the program can replace the
library with their own build of it. That is satisfied here by construction: the
compiled JSBSim is shipped as its own file, `public/fdm/wasm/jsbsim_wasm.wasm`,
loaded at runtime by URL and never bundled into this project's JavaScript. Drop
in a different build of that file and the simulator uses it. So the LGPL applies
to that file and this project's own code stays MIT.

The aircraft and engine definitions in `public/fdm/aircraft` and
`public/fdm/engine` are this project's own work, written against published
figures rather than adapted from FlightGear's aircraft library — which is why
they are MIT too, and why they were written from scratch rather than copied.

## Geodata

| Source | Used for | Licence | Requires |
| --- | --- | --- | --- |
| **OpenStreetMap** (via Overpass API) | Track centrelines, signals, switches, stations, barriers, airport outlines, the African inventory | ODbL 1.0 | Attribution, **and share-alike on derived databases** |
| **PDOK / Kadaster** 3D Basisvoorziening, Luchtfoto, AHN | Dutch terrain, imagery, buildings, railhead heights | CC BY 4.0 | Attribution |
| **IGN Géoplateforme** BD ORTHO, RGE ALTI | French imagery and runway elevations | Open licence, no fee ([CGU](https://cartes.gouv.fr/cgu)) | Attribution |
| **Re:Earth Terrain** (Copernicus GLO-30, NASADEM, EGM2008) | Global terrain mesh for the flight view | Open, see provider | Attribution |
| **Terrarium elevation tiles** (AWS Open Data) | Elevation profiles for the African corridors | [Mixed per source](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) — SRTM public domain, Copernicus DEM with attribution | Attribution per source |
| **EOX Sentinel-2 cloudless** | Global base imagery in the flight view | CC BY 4.0 | Attribution |
| **Natural Earth** (vectors and populated places) | Africa base map, rivers, city populations | Public domain | Nothing |

## What this means in practice

**Source code** can carry any licence. Nothing above is copyleft for code.

**Generated data files are a different question.** `public/africa/*.geojson`,
`public/ride/*.json` and `public/fly/*.json` are derived from OpenStreetMap, so
under ODbL they are derivative databases and must be offered under ODbL as
well, with attribution. That obligation stops at the data: it does not reach
the program that reads it.

`data/africa/corridors.json` — the concept network, its routing and its
arguments — is this project's own work and is offered under CC BY 4.0.

## Deliberately not used

- **Google Photorealistic 3D Tiles.** Prettier at ground level than anything
  else available, but the terms forbid derivative use, offline caching and
  pre-rendering, which rules out most of what this project does.
- **Esri ArcGIS basemaps.** Widely used from the open tile endpoints, but Esri
  requires a licence for the content, not merely attribution. Replaced with
  self-hosted Natural Earth vectors.
- **CARTO basemaps.** Now require an API key.
