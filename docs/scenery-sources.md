# Where the ground comes from, and where it could come from next

The simulator's one defensible advantage is ground resolution. It does not draw
a global satellite layer; it streams national open orthophoto, which in the
covered countries is one to two orders of magnitude sharper than what a
commercial simulator ships. The measured contrast: Infinite Flight advertises
15 m per pixel worldwide, PDOK serves the Netherlands at about 8 cm. At 15 m a
house is four pixels. At 8 cm you can count the roof tiles.

That advantage has a mirror image, and it is the reason this document exists.
Outside the covered rectangles the globe falls back to Sentinel-2 at 10 m, and
the product becomes an ordinary browser flight simulator with two aeroplanes.
Coverage breadth is therefore worth more than a third aeroplane.

## What is wired in today

| Region | Service | Stated resolution |
| --- | --- | --- |
| France | IGN BD ORTHO, Géoplateforme WMTS | 20 cm |
| Switzerland | swisstopo SWISSIMAGE | 10 cm |
| Netherlands | Kadaster/PDOK luchtfoto RGB | ~8 cm |
| Flanders | Vlaanderen OMW WMTS | 25 cm |
| South Tyrol | Autonome Provinz Bozen, Aerial 2023 | — |
| Austria | basemap.at bmaporthofoto30cm | 30 cm |
| Germany, 14 states | thirteen Land WMS services (Berlin shares Brandenburg's) | 10–40 cm |
| Spain | PNOA máxima actualidad, IDEE WMTS | 25 cm |
| Portugal, mainland | DGT Ortofotos 2018, WMS | 25 cm |

Germany was added on 2026-11-17, after the survey below turned into a bug
report: standing at Wiesbaden the ground was a pale grey-brown smear, which
turned out to be two separate faults stacked on each other. There was no
German imagery at all, and the French layer was stretching its zoom-12 world
mosaic over the gap. Both are written up in `flight-view.md`, under "A third
thing the no-data tile does, which is worse" and "Germany, which is thirteen
services".

## What is available (the German rows are now wired in)

Measured on 2026-11-10. For each service one tile was fetched over a point
inside its coverage, with `Origin: https://opengeo.ai-tigers.com` on the
request, and the response body decoded. A service is listed here only if it
answered 200, returned a decodable image, and carried an
`Access-Control-Allow-Origin` header — without that header the browser cannot
use it at all, whatever the licence says. The standard deviation of the pixel
values is given because it separates a photograph from a flat no-data sheet: a
canned tile measures 0, the photographs below measure 15 to 72.

| Region | Endpoint / layer | Protocol | GSD | Tile | σ |
| --- | --- | --- | --- | --- | --- |
| Luxembourg | `wmts1.geoportail.lu` `ortho_latest` | WMTS, z/x/y on `GLOBAL_WEBMERCATOR_4_V3` | — | 32 kB | 63.0 |
| Wallonia | `geoservices.wallonie.be` `ORTHO_LAST` | WMS 1.3.0, EPSG:3857 | — | 491 kB | 45.5 |
| DE North Rhine-Westphalia | `www.wms.nrw.de/geobasis/wms_nw_dop` `nw_dop_rgb` | WMS | 10 cm | 481 kB | 36.5 |
| DE Bavaria | `geoservices.bayern.de/od/wms/dop/v1/dop40` `by_dop40c` | WMS | 40 cm | 643 kB | 48.3 |
| DE Baden-Württemberg | `owsproxy.lgl-bw.de` `IMAGES_DOP_20_RGB` | WMS | 20 cm | 224 kB | 35.5 |
| DE Hesse | `gds-srv.hessen.de` `he_dop20_rgb` | WMS | 20 cm | 495 kB | 20.1 |
| DE Lower Saxony | `opendata.lgln.niedersachsen.de` `ni_dop20` | WMS | 20 cm | 574 kB | 37.6 |
| DE Rhineland-Palatinate | `geo4.service24.rlp.de/wms/rp_dop20.fcgi` `rp_dop20` | WMS | 20 cm | 232 kB | 25.4 |
| DE Schleswig-Holstein | `dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD` `sh_dop20_rgb` | WMS | 20 cm | 322 kB | 20.9 |
| DE Saxony | `geodienste.sachsen.de` `sn_dop_020` | WMS | 20 cm | 462 kB | 35.4 |
| DE Saxony-Anhalt | `geodatenportal.sachsen-anhalt.de` `lsa_lvermgeo_dop20_2` | WMS | 20 cm | 318 kB | 17.5 |
| DE Thuringia | `geoproxy.geoportal-th.de` `th_dop` | WMS | 20 cm | 656 kB | 44.1 |
| DE Mecklenburg-Vorpommern | `geodaten-mv.de/dienste/adv_dop` `mv_dop` | WMS | 20 cm | 613 kB | 41.3 |
| DE Brandenburg **and Berlin** | `isk.geobasis-bb.de/mapproxy/dop20c` `bebb_dop20c` | WMS | 20 cm | 368 kB | 44.5 |
| DE Saarland | `geoportal.saarland.de/freewms/dop2016` `sl_dop2016` | WMS | 2016 vintage | 431 kB | 23.8 |
| Spain | `ign.es/wmts/pnoa-ma` `OI.OrthoimageCoverage` | WMTS, GoogleMapsCompatible | — | 22 kB | 38.1 |
| Czechia | `ags.cuzk.cz` `ORTOFOTO_WM` | ArcGIS tile, z/y/x | — | 42 kB | 45.8 |
| Poland | `mapy.geoportal.gov.pl` `ORTOFOTOMAPA` | WMTS, `EPSG:3857:{z}` | — | 10 kB | 45.0 |
| Estonia | `tiles.maaamet.ee` `foto@GMC` | **TMS — y is flipped** | — | 12 kB | 33.4 |
| Portugal | `ortos.dgterritorio.gov.pt` `ortoSat2023` | WMS | satellite | 226 kB | 44.3 |
| Japan | `cyberjapandata.gsi.go.jp/xyz/seamlessphoto` | XYZ | — | 23 kB | 38.2 |
| United States | `basemap.nationalmap.gov` `USGSImageryOnly` | ArcGIS tile, z/y/x | — | 17 kB | 20.3 |
| Australia (NSW) | `maps.six.nsw.gov.au` `NSW_Imagery` | ArcGIS tile, z/y/x | — | 22 kB | 72.0 |

Fourteen of Germany's sixteen states answer without a key. The two holes are
Hamburg and Bremen, and they are real holes rather than an oversight here:
Brandenburg's service is a joint Berlin–Brandenburg one and covers Berlin
(verified over Tegel, σ 15.5), but it answers a sheet of pure white over
Hamburg, so a neighbour's service does not quietly fill in a city state.

## What is not available

| Region | What happened |
| --- | --- |
| Germany, nationwide (BKG DOP20) | `wms_dop` and `wmts_dop` both answer **403** on `sgx.` and `sg.geodatenzentrum.de`. A free registration reportedly returns a token embedded in the URL path, and one such token would replace all fourteen state services with a single uniform 20 cm layer. **This is the one decision worth taking before writing any code.** |
| DE Hamburg, DE Bremen | No working endpoint found; every candidate 404s. |
| Denmark | `api.dataforsyningen.dk` serves capabilities but answers 403 on GetMap. Needs a free Dataforsyningen token. |
| Norway | `opencache.statkart.no` is unreachable from this host (`No route to host`). Worth retrying from elsewhere before concluding anything. |
| Slovenia | `storitve.eprostor.gov.si` resets the connection. |
| Slovakia | `zbgisws.skgeodesy.sk` 404 on every WMTS form tried. |
| New Zealand | `basemaps.linz.govt.nz` 400 — requires an API key. |
| Catalonia | ICGC 500; moot, since PNOA covers it. |
| Lombardy, Trentino | Service renamed or DNS gone. Italy has no national open ortho; it is region by region. |

## Before any of this is wired in

Four things were deliberately **not** measured, and each can still sink a
candidate:

1. **Maximum zoom.** One tile at z16 proves the service answers. It does not
   prove it answers at z18, which is where the runway has to be sharp.
2. **No-data behaviour.** This is not a detail here — it is the bug that
   painted the Mediterranean white for weeks, and the Berlin–Brandenburg
   service was already caught answering pure white outside its coverage.
   Each new layer needs its out-of-coverage answer decoded before it gets a
   rectangle, and `ImageryLayer.colorToAlpha` has one colour slot per layer.
3. **Licence and attribution.** Several of these carry different licences
   (`dl-de/zero-2.0` for NRW, `CC BY 4.0` for Bavaria and
   Mecklenburg-Vorpommern, `dl-de/by-2-0` for Baden-Württemberg among the ones
   seen in passing, none verified against the service's own metadata). Every
   one needs its line in `ATTRIBUTION` in `src/fly/providers.js`.
4. **Rate limits.** A WMS reprojects on every request and has no tile cache
   behind it, so fifteen WMS layers behave very differently from fifteen WMTS
   layers under a flying aeroplane. The German states are all WMS.

## Why Germany first

Separately measured on the same day, through OpenSEO: the cheapest search terms
in this category are native-language head terms in exactly the countries where
the open orthophoto is sharp. `flugsimulator` is 9,900 searches a month in
Germany at keyword difficulty 10; `simulateur de vol` is 3,600 in France at 0;
the English `flight simulator` is 60 to 94. Germany is at once the largest
imagery gap and the cheapest audience, which is an unusually clean argument for
doing one thing next.

## A hostname that stopped being the hostname

North Rhine-Westphalia is 10 cm imagery over Düsseldorf, Cologne, Dortmund
and Essen, and on 22 November 2026 it was not there at all: a flight over
Düsseldorf showed the Sentinel-2 base, ten metres a pixel, smeared.

Nothing was wrong with the service. On 16 November 2026 the state renewed the
certificate for `wms.nrw.de` and put only `www.wms.nrw.de` in the subject
alternative name, so the bare host now fails hostname verification and every
browser refuses the connection before a request is made:
`ERR_CERT_COMMON_NAME_INVALID`, 68 of them in one pass over the airport.
Under `www.` the same service answers in about 200 ms with a real photograph
at every zoom to 19.

Two things worth keeping from this. A TLS failure is invisible from inside the
page — the fetch fails opaquely, the layer has no ancestor that loaded, and
the layer beneath it simply shows through, which looks exactly like a slow
connection and is how this was reported. And the check is one line per host:

```sh
echo | openssl s_client -connect $h:443 -servername $h -verify_hostname $h \
  -verify_return_error 2>&1 >/dev/null | grep -i 'verify error'
```

Run over all 22 imagery hosts this project uses, North Rhine-Westphalia was
the only one failing.

## A mosaic that does not stop at the border

PDOK's aerial photography reaches several kilometres into Germany before it
ends, on a curved coverage edge rather than on the frontier. Because it is
8 cm against North Rhine-Westphalia's 10, it used to sit on top of the German
layers — which put that edge straight across Weeze airport, half the runway
in a Dutch winter image and half in a German summer one, with a white seam
between them.

Resolution is the wrong tie-break between two countries. The stack now puts
the Netherlands and Flanders *under* the thirteen German services, so a
state's own photography wins over a neighbour's overspill. Nothing is lost on
the Dutch side: asked for ground at Gennep, Nijmegen, Venlo or Enschede, both
North Rhine-Westphalia and Lower Saxony answer the same 667-byte sheet of
pure 255,255,255 that the no-data key already removes, and PDOK shows
through. Measured from 2,600 m over EDLV, the seam went from 1.27% of the
frame to none of it.

## Spain, from one service

PNOA máxima actualidad, through the WMTS of the Infraestructura de Datos
Espaciales de España: 25 cm over the whole country including the Balearics
and the Canaries, CC BY 4.0, keyless, CORS open, 70 to 100 ms a tile. The
INSPIRE WMS serves the same ground with proper transparency outside it, and
takes 4 to 30 seconds a tile, which is not a service you can fly over.

Its pyramid fuses PNOA with a Sentinel-2 base, so outside Spain it answers
with stretched satellite rather than with a gap — there is no no-data colour
to key, and the layer has to be told where the country is. That was measured:
walking a real-versus-stretched test west to east for every tenth of a degree
of latitude. `docs/flight-view.md`, "Spain, and a border measured by walking
it", has the method and what it cost to get wrong.

## Portugal, and the layer that was not the obvious one

Added on 2026-11-24. DGT publishes two orthophoto services, and the one this
file pointed at for a year is the wrong one of the two.

The row in the survey above says `ortos.dgterritorio.gov.pt` `ortoSat2023`,
which is OrtoSat2023: a cloudless Pléiades-Neo mosaic of the mainland, 30 cm,
flown — or rather orbited — in 2023. It answers, it is quick enough, and the
layer that host serves under that name draws every tree in Portugal bright
red. It is the false-colour product. The true-colour one lives on a different
hostname under a different layer name, `geo.dgterritorio.gov.pt/wms/ortosat2023`
with `ortoSat2023-CorVerdadeira`, which no amount of reading the first
service's capabilities would have told you.

Looking for that turned up the better layer. DGT's OGC API lists its whole
orthophoto archive — 1995, 2004-06, 2007, 2010, 2012, 2015, 2018 and the 2023
satellite — and the 2018 one is **aerial photography at 25 cm**, the
country's own regular coverage, with a WMS of its own at
`geo.dgterritorio.gov.pt/wms/ortos2018`, layer `Ortos2018-RGB`. Compared side
by side over Lisbon, Cascais and Évora it is sharper than the satellite
mosaic — the threshold markings and the parked aeroplanes are crisp rather
than soft — and it answers in 0.2 to 0.5 s a tile against 0.4 to 0.8. Both
are CC BY 4.0 with an attribution condition, in their own SNIG records, and
both answer `Access-Control-Allow-Origin: *`.

So Portugal flies on five-year-old aerial photography rather than on
two-year-old satellite. Runways do not move, and the trade was sharpness.

Three things made it an afternoon's work rather than Spain's week:

- **It stops at its own border.** Beyond the coverage this service answers a
  667-byte sheet of pure 255,255,255 — measured over Badajoz, over the
  Atlantic and over Madeira, 100% white in all three. That is the same canned
  no-data tile Germany and PDOK serve, and the key that already removes it
  needed no changes. PNOA needed a measured coverage mask precisely because
  it does *not* do this: it falls back to Sentinel-2 and there is no colour
  to key.
- **It speaks EPSG:3857 and JPEG.** The OGC API - Maps endpoint, which is
  what DGT's own documentation points at, is PNG only — 60 kB a tile against
  10 to 13 — and it answers 500 to any bbox with a decimal point in it, which
  is every tile a map client will ever ask for. The WMS has neither problem.
- **Both banks of the Minho are now photographed twice**, once by each
  country. Portugal is added above Spain in the stack, so over Portuguese
  ground the Portuguese photograph wins and where it has none Spain shows
  through.

What is still missing is Madeira and the Azores: DGT's mainland coverage is
the mainland, and out there the islands are Sentinel-2. Madeira has its own
1:2000 orthophotography of 2018-19 in the SNIG catalogue, which is the next
thing to try if anyone wants to fly into Funchal.
