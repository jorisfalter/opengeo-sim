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

## What is available and not wired in

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
| DE North Rhine-Westphalia | `wms.nrw.de/geobasis/wms_nw_dop` `nw_dop_rgb` | WMS | 10 cm | 481 kB | 36.5 |
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
