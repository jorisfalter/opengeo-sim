# Can this be open source?

Short answer: yes, and nothing in the stack stands in the way. The longer
answer is that two licence families run through the project and they behave
differently, so it is worth keeping them apart deliberately rather than
discovering the difference after publishing.

## Code: free choice, with one condition

Almost every dependency is permissive — Apache-2.0 (Cesium), BSD-2 (Leaflet),
MIT (React, Vite, the zip and CSV readers), ISC (lucide). None of those is
copyleft, so the project's own code can be MIT, Apache-2.0 or BSD without
conflict. This repository uses MIT.

The exception is **JSBSim**, the flight dynamics engine, which is **LGPL-2.1**.
This is the one place where a dependency's licence asks something of the
project, so it is worth being precise about what:

- The LGPL is not the GPL. It does **not** require the surrounding program to
  be LGPL. What it requires is that whoever receives the program is able to
  swap in their own build of the library.
- That is why the compiled JSBSim is shipped as a **separate file**,
  `public/fdm/wasm/jsbsim_wasm.wasm`, loaded at runtime by URL
  (`scripts/sync-wasm.mjs` copies it out of `node_modules` at build time). It
  is never bundled into the application JavaScript. Replace that file and the
  simulator runs on the replacement — which is exactly the freedom the LGPL
  asks for, satisfied by construction rather than by paperwork.
- The practical obligations: keep the LGPL notice with that file, say where the
  JSBSim source is, and do not strip the ability to replace it. All three are
  met, and `ATTRIBUTION.md` carries the statement.

What would *not* work is taking aircraft definitions out of FlightGear's
library: those are GPL, and shipping them would pull the GPL over the whole
distribution. That is the reason `public/fdm/aircraft/pc24/pc24.xml` and
`public/fdm/engine/fj44.xml` were written from published performance figures
instead of adapted from an existing model. Writing them took an afternoon and
keeps the project MIT; it is the single most consequential licensing decision in
the repository.

## Data: ODbL is the one that actually constrains

OpenStreetMap is published under the Open Database Licence, which is
share-alike — but share-alike *on databases*, and that distinction is the whole
game:

- A **produced work** — a rendered map, a screenshot, the running app — needs
  attribution and nothing else. Every map image this project makes falls here.
- A **derived database** — `public/africa/existing.geojson`, the ride
  centrelines in `public/ride/*.json`, the airport geometry in
  `public/fly/*.json` — has to be offered under ODbL in turn.

What ODbL never touches is the source code that reads the data. A repository
with MIT code and ODbL data files is normal and unambiguous, as long as it says
so. That is what `LICENSE` and `ATTRIBUTION.md` do here.

Everything else is attribution-only: PDOK and the Dutch height models under
CC BY 4.0, IGN's French imagery and elevations under the open licence with no
fee, swisstopo free including commercial use, Sentinel-2 cloudless under
CC BY 4.0, and Natural Earth in the public domain with no conditions at all.

## What had to be changed before publishing

**Esri basemap tiles had to go.** The ArcGIS World Shaded Relief and boundary
layers are reachable without a key and are used all over the web, but Esri's
terms require a licence for the content, not merely attribution. The Africa map
now draws its base from Natural Earth vectors that the repository ships itself
— public domain, no service to depend on, and it loads faster.

**CARTO's label layer** had already started demanding an API key, which is its
own kind of warning: a basemap you do not host is a dependency you do not
control.

**Google's Photorealistic 3D Tiles were never used**, which in hindsight was
the single most useful licensing decision in the project. Their terms forbid
derivative use, offline caching and pre-rendering. Every alternative chosen
instead — PDOK, IGN, swisstopo, Natural Earth — turned out to be both freer and,
for the Netherlands and France, higher resolution.

## FlightGear, and why none of it is here

JSBSim is the library, designed to be linked, and taking it is the supported
path. FlightGear around it is **GPL**, and GPL code in an MIT project makes the
whole thing GPL. So nothing from FlightGear is in this repository: not aircraft
definitions, not scenery code, not the `apt.dat` airport database. The PC-24
and its engine were written from published performance figures and validated
against them in `scripts/test-fdm.mjs`.

The distinction is worth stating because it is easy to blur. Linking a library
that was written to be linked is one thing; copying someone's content out of a
GPL distribution is another, and only the first is open to an MIT project.

## Checklist before making the repository public

- [x] Rename the package. Done: the simulators live in `opengeo-sim`, which
      borrows nobody's product name.
- [ ] Ship the LGPL text next to `public/fdm/wasm/jsbsim_wasm.wasm` and link
      the upstream JSBSim source from the README, so the replaceability the
      LGPL asks for is stated as well as true.
- [ ] Decide what to commit. The generated data files are large and take hours
      to rebuild; committing them with an ODbL notice is friendlier than making
      every visitor run 54 Overpass queries. The `.gitignore` currently excludes
      the ride data and keeps the Africa data — make that deliberate.
- [ ] Keep the credit lines in the UI. They are a licence condition for CC BY
      and ODbL, not decoration.
- [ ] No keys to leak: every service used here is keyless, which is worth
      preserving as a design rule rather than an accident.
- [ ] Say in the README that the corridor concept is an opinion backed by
      screening data, not a plan. It will be read as a plan otherwise.
