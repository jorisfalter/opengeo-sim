// Open data for the Alps. No keys, no usage caps, CORS everywhere.
//
// Terrain is a global quantized-mesh set built from Copernicus/NASADEM and
// blended with the EGM2008 geoid, which matters here: heights come out as
// ellipsoidal, the same datum Cesium renders in, so an airport placed at its
// surveyed altitude lands where it should.
import {
  Cesium3DTileset,
  CesiumTerrainProvider,
  Color,
  ImageryLayer,
  Rectangle,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';

const TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const IGN_WMTS = 'https://data.geopf.fr/wmts';
const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const PDOK_3D = 'https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections';
const PDOK_WMTS = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0';
const VL_WMTS = 'https://geo.api.vlaanderen.be/OMW/wmts';
const SWISSIMAGE =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg';
const SOUTH_TYROL =
  'https://geoservices.buergernetz.bz.it/mapproxy/p_bz-Orthoimagery/wmts' +
  '/Aerial-2023-RGB/EPSG_3857/{z}/{x}/{y}.png';
// basemap.at numbers its tiles row before column, so this is {z}/{y}/{x} and
// not the {z}/{x}/{y} every other service here uses. Asking the usual way
// answers 404 on every tile, which looks exactly like no coverage at all.
const BASEMAP_AT =
  'https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg';

export const ATTRIBUTION =
  '© Re:Earth Terrain (Copernicus/NASADEM) · © IGN BD ORTHO & RGE ALTI, Géoplateforme · ' +
  '© swisstopo SWISSIMAGE · © Kadaster/PDOK CC BY 4.0 · ' +
  '© Autonome Provinz Bozen – Südtirol, Orthofoto 2023 CC BY 4.0 · ' +
  '© GeoBasis-DE: NW, NI, HE, RP, SL, BW, BY, TH, SN, ST, BB/BE, MV, SH — ' +
  'dl-de/by-2-0 and CC BY 4.0 · ' +
  'Data source: basemap.at CC BY 4.0 · ' +
  '© EOX Sentinel-2 cloudless CC BY 4.0 · © OpenStreetMap contributors ODbL · ' +
  '© OpenFlights routes and airlines ODbL';

// Mainland France. It is a rectangle and France is not, so the layer is also
// requested over Switzerland, Italy, Belgium and a good deal of the
// Mediterranean — and outside its coverage IGN does not answer with nothing.
//
// What it answers with has changed, and the old answer was still being keyed
// out here long after it stopped arriving. This was measured rather than
// argued about: 30 tiles at zoom 13 and 14, over Belgium, Luxembourg,
// Germany, Switzerland, Italy, Andorra, Spain, England and four stretches of
// open water, were fetched and decoded. Fourteen came back 404. Fourteen came
// back a canned 1,651-byte JPEG that is pure 255,255,255 in every pixel. Two
// were the coverage edge, 60% and 92% white. **Not one was grey.** The
// highest share of the old no-data grey in any tile was 0.038%, which is
// JPEG noise on a real photograph.
//
// So the grey key was keying a colour that no longer exists, while the colour
// that does exist painted a white sheet over the sea off Marseille — visible
// from 1,800 ft with the horizon in the frame, because the far field is drawn
// at zoom 13 to 15 and that is exactly the band where IGN serves white rather
// than 404. Below zoom 13 it has a global mosaic and the sea is blue; at zoom
// 16 and up it 404s and Cesium simply shows the layer underneath.
//
// The key is therefore white now, with the same tight threshold PDOK's layer
// has used all along for the same canned tile. What that costs was measured
// too: in real French imagery, pure 255,255,255 is absent from concrete,
// runways, white roofs, greenhouses and the Camargue salt pans — all exactly
// 0.0000% — and peaks at 1.35% of a tile on the snowfield below the Aiguille
// du Midi. Those pixels turn transparent and show Sentinel-2 underneath,
// which over the Vallée Blanche is also snow.
const FRANCE = Rectangle.fromDegrees(-5.3, 41.3, 9.7, 51.2);
const SWITZERLAND = Rectangle.fromDegrees(5.9, 45.75, 10.55, 47.85);
// The Netherlands plus a margin, so Cesium does not ask PDOK for tiles it has
// no business holding.
export const NETHERLANDS = [50.6, 3.1, 53.7, 7.4];
const NL_RECTANGLE = Rectangle.fromDegrees(3.1, 50.6, 7.4, 53.7);
// Flanders, as its own aerial service draws it. Wallonia is not in it, so the
// rectangle stops where the coverage does and Cesium never asks for a tile the
// service answers with an error.
const VL_RECTANGLE = Rectangle.fromDegrees(2.53, 50.685, 5.92, 51.52);
// South Tyrol, with a little margin on a province that is 10.38–12.48 E and
// 46.22–47.10 N. Beyond it the service answers with a 334-byte transparent
// PNG rather than a grey slab, so nothing has to be keyed out: the layer
// simply stops where the province does.
const SOUTH_TYROL_RECTANGLE = Rectangle.fromDegrees(10.3, 46.15, 12.55, 47.15);
// Austria, likewise with a margin. Outside its coverage basemap.at answers
// 404, which Cesium treats as no tile once the error event is swallowed — so
// this one needs no colour keying either.
const AT_RECTANGLE = Rectangle.fromDegrees(9.4, 46.3, 17.2, 49.1);
// Germany, state by state, because there is no other way in.
//
// BKG publishes a nationwide DOP20 and it answers 403 on both of its
// hostnames; the free registration puts a token in the URL path, which is a
// key, and this file has none. What the Laender publish instead is thirteen
// separate WMS services -- fourteen states, since Berlin shares Brandenburg's
// -- and together they cover everything except Hamburg and Bremen.
//
// Three measurements on 2026-11-17 decided the shape of this, one tile per
// service over a point inside each state:
//
//   - PNG with TRANSPARENT=TRUE returns a genuinely transparent tile outside
//     each state's border, which would make the stacking below exact. It also
//     costs 58 to 179 kB a tile against 8 to 39 kB for JPEG. Five to twelve
//     times the bytes, under a moving aeroplane, is not a trade worth making.
//   - So JPEG -- and outside its coverage every one of the thirteen answers a
//     sheet of pure 255,255,255, the same canned no-data tile IGN and PDOK
//     serve. The states' bounding boxes overlap heavily and that white key is
//     exactly what makes the overlaps resolve: each layer paints only where
//     it has photography and lets the one beneath through everywhere else.
//   - What the key costs in real German imagery: 0.000% of pixels over the
//     Frankfurt and Duesseldorf aprons, 0.093% over Munich's, 0.004% over the
//     Straelen glasshouses, 0.000% over the Garzweiler pit and over the
//     Feldberg and Nebelhorn snowfields. The one exception is the Zugspitze
//     glacier at 8.4%, where the pixels that go transparent reveal
//     Sentinel-2, which up there is also snow.
//
// Hesse is the odd one out: its service draws nothing below zoom 16, a scale
// limit at their end. It needs no special handling, because what it returns
// below that limit is the same 667-byte sheet of white, keyed out like any
// other gap -- Hesse simply appears as you come down through zoom 16.
//
// None of these carries a minimumLevel, and that is deliberate twice over.
// Cesium does not skip a layer below its minimum level, it clamps the request
// up to it: one zoom-3 terrain tile with a minimum of 13 would ask for four
// thousand tiles of North Rhine-Westphalia at once. But letting the level
// follow the terrain is not free either — measured from the cockpit at
// Wiesbaden, twelve coarse tiles of Lower Saxony, a hundred and fifty
// kilometres up the horizon, cost 1.7 MB between them, because a WMS asked
// for a ten-kilometre square renders a ten-kilometre square. So the floor is
// enforced the third way, with blankBelow: no request at all under zoom 13,
// where Sentinel-2 is finer than these would be anyway.
const GERMANY = [
  // www., and it has to be: on 16 November 2026 North Rhine-Westphalia
  // renewed the certificate for wms.nrw.de with only www.wms.nrw.de in it, so
  // the bare name now fails hostname verification and every browser refuses
  // the connection outright — ERR_CERT_COMMON_NAME_INVALID, 68 of them in one
  // pass over Düsseldorf. Nothing to do with the service, which answers in
  // 200 ms under the other name.
  ['NW', 'www.wms.nrw.de/geobasis/wms_nw_dop', 'nw_dop_rgb', 5.86, 50.32, 9.47, 52.54],
  ['NI', 'opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms', 'ni_dop20', 6.44, 51.29, 11.60, 53.90],
  ['HE', 'www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows', 'he_dop20_rgb', 7.77, 49.39, 10.24, 51.66],
  ['RP', 'geo4.service24.rlp.de/wms/rp_dop20.fcgi', 'rp_dop20', 6.11, 48.96, 8.51, 50.95],
  ['SL', 'geoportal.saarland.de/freewms/dop2016', 'sl_dop2016', 6.35, 49.11, 7.41, 49.64],
  ['BW', 'owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C', 'IMAGES_DOP_20_RGB', 7.51, 47.53, 10.50, 49.80],
  ['BY', 'geoservices.bayern.de/od/wms/dop/v1/dop40', 'by_dop40c', 8.97, 47.27, 13.84, 50.57],
  ['TH', 'www.geoproxy.geoportal-th.de/geoproxy/services/DOP20', 'th_dop', 9.87, 50.20, 12.66, 51.65],
  ['SN', 'geodienste.sachsen.de/wms_geosn_dop-rgb/guest', 'sn_dop_020', 11.87, 50.16, 15.05, 51.69],
  ['ST', 'www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest', 'lsa_lvermgeo_dop20_2', 10.56, 50.93, 13.19, 53.05],
  ['BB', 'isk.geobasis-bb.de/mapproxy/dop20c/service/wms', 'bebb_dop20c', 11.26, 51.35, 14.77, 53.56],
  ['MV', 'www.geodaten-mv.de/dienste/adv_dop', 'mv_dop', 10.59, 53.10, 14.42, 54.69],
  ['SH', 'dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD', 'sh_dop20_rgb', 7.86, 53.35, 11.32, 55.06],
];

// The canned no-data tile, pure white, served by IGN and by PDOK alike.
const NODATA = Color.WHITE;
// Tight: ±1 per channel. The tile is exactly 255,255,255, so nothing wider is
// needed and anything wider starts eating real highlights.
const NODATA_THRESHOLD = 0.004;
// basemap.at does the same thing in white: beyond its coverage, and at the
// coarse levels you see from altitude, it answers with a sheet of 253,253,253
// flecked with 255. Keying it out is only safe if real snow never lands
// there, so that was measured rather than assumed: over the Pasterze, the
// Hintertux, the Dachstein and the Ötztal at 30 cm, 0.02% of pixels at most
// come within ±6 of it, and three of the four never exceed 254 in any
// channel. The threshold below is ±3.
const AT_NODATA = Color.fromBytes(254, 254, 254);
const AT_THRESHOLD = 0.012;

// A one-pixel transparent tile. Cesium, when an imagery request fails, does
// not fall through to the layer underneath -- it draws the nearest ancestor
// that layer does have, stretched. Handing it a blank ancestor is how a layer
// is told to stop at its own coverage.
const BLANK = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
})();

/** Makes a provider answer blank below `floor`, so nothing coarser is stretched. */
function blankBelow(provider, floor) {
  const inner = provider.requestImage.bind(provider);
  provider.requestImage = (x, y, level, request) =>
    level < floor ? Promise.resolve(BLANK) : inner(x, y, level, request);
  return provider;
}

export const terrainProvider = () =>
  CesiumTerrainProvider.fromUrl(TERRAIN, { requestVertexNormals: true });

/** Global 10 m base so the horizon keeps going past the French border. */
export function baseLayer() {
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: EOX,
      maximumLevel: 14,
      credit: 'Sentinel-2 cloudless by EOX',
    }),
  );
}

/** BD ORTHO, 20 cm over France — this is what makes the valleys read. */
export function orthoLayer() {
  const layer = new ImageryLayer(
    // IGN answers zoom 13 and up with BD ORTHO or with nothing, which is what
    // this layer is for. At zoom 12 and below it answers something else
    // entirely: a global mosaic, served as readily over Cologne, Warsaw and
    // Milan as over Paris. That is not a curiosity, because the rectangle
    // below reaches to 9.7 E and a failed tile is drawn from its ancestor --
    // so a 404 over Wiesbaden at zoom 16 did not reveal Sentinel-2
    // underneath, it stretched IGN's zoom-12 world mosaic across the
    // windscreen. Measured there on 2026-11-17 it shifted the ground by 54,
    // 49 and 60 counts per channel and turned western Germany pale grey.
    blankBelow(
      new WebMapTileServiceImageryProvider({
        url:
          `${IGN_WMTS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS` +
          '&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM' +
          '&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}',
        layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
        style: 'normal',
        format: 'image/jpeg',
        tileMatrixSetID: 'PM',
        tilingScheme: new WebMercatorTilingScheme(),
        maximumLevel: 19,
        rectangle: FRANCE,
        credit: 'IGN BD ORTHO',
      }),
      13,
    ),
  );
  layer.brightness = 1.04;
  layer.saturation = 1.06;
  layer.colorToAlpha = NODATA;
  layer.colorToAlphaThreshold = NODATA_THRESHOLD;
  return layer;
}

/**
 * PDOK aerial photography over the Netherlands: 8 cm, which is four times finer
 * than IGN's and twenty times finer than Sentinel-2. Keyless and CC BY 4.0,
 * the same service the cab ride already flies over.
 */
export function dutchAerialLayer() {
  const provider = new WebMapTileServiceImageryProvider({
    url:
      `${PDOK_WMTS}?service=WMTS&request=GetTile&version=1.0.0&layer=Actueel_orthoHR` +
      '&style=default&format=image/jpeg&tilematrixset=OGC:1.0:GoogleMapsCompatible' +
      '&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}',
    layer: 'Actueel_orthoHR',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'OGC:1.0:GoogleMapsCompatible',
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 19,
    rectangle: NL_RECTANGLE,
    credit: 'PDOK luchtfoto',
  });
  provider.errorEvent.addEventListener(() => {});
  const layer = new ImageryLayer(provider);
  // PDOK's rectangle is a box and the Netherlands is not, so Belgian Limburg
  // gets tiles too — and outside its coverage PDOK answers with a tile that is
  // pure white, which paints a blank sheet over Hasselt and Lommel. Keying
  // that one colour out is what reveals the layers underneath. The threshold
  // is tighter than the grey ones because this is exactly 255,255,255 and
  // nothing in a real aerial photo is.
  layer.colorToAlpha = NODATA;
  layer.colorToAlphaThreshold = NODATA_THRESHOLD;
  layer.brightness = 1.04;
  layer.saturation = 1.04;
  return layer;
}

/**
 * Flanders at 25 cm, from the Flemish government's own winter orthomosaic.
 * It fills the half of our corridor PDOK does not reach, and it is polite
 * about the border: over the Netherlands it answers with a fully transparent
 * tile rather than a blank one, so the two layers simply stack.
 *
 * Two things the capabilities document had to settle: the pyramid is called
 * GoogleMapsVL (plain web mercator under another name) and the style must be
 * empty — asking for 'default' is refused with a 400.
 */
export function flemishLayer() {
  const provider = new WebMapTileServiceImageryProvider({
    url:
      `${VL_WMTS}?service=WMTS&request=GetTile&version=1.0.0&layer=omwrgb25vl` +
      '&style=&format=image/png&tilematrixset=GoogleMapsVL' +
      '&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}',
    layer: 'omwrgb25vl',
    style: '',
    format: 'image/png',
    tileMatrixSetID: 'GoogleMapsVL',
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 19,
    rectangle: VL_RECTANGLE,
    credit: 'Orthofoto Vlaanderen',
  });
  provider.errorEvent.addEventListener(() => {});
  const layer = new ImageryLayer(provider);
  layer.brightness = 1.04;
  layer.saturation = 1.04;
  return layer;
}

/**
 * Dutch buildings as LoD 2.2 3D Tiles — real roof shapes from BAG footprints
 * and AHN heights, streamed for the whole country. Nothing to build and
 * nothing to store: this is what the Alps would need a week of work to match.
 */
export const dutchBuildings = () =>
  Cesium3DTileset.fromUrl(`${PDOK_3D}/gebouwen/3dtiles?f=json`, {
    maximumScreenSpaceError: 16,
    skipLevelOfDetail: true,
    preferLeaves: true,
  });

/**
 * South Tyrol at 20 cm, from the province's own 2023 orthomosaic — the one
 * layer that makes Bolzano, the Dolomites and the Vinschgau read as ground
 * rather than as 10 m satellite mush. CC BY 4.0 per the dataset's own
 * metadata record, and CORS is answered for our origin.
 *
 * The URL ends in .png because that is the path MapProxy publishes, but a
 * tile with imagery on it comes back as JPEG. Cesium goes by the content
 * type, so both are fine.
 */
export function southTyrolLayer() {
  const provider = new UrlTemplateImageryProvider({
    url: SOUTH_TYROL,
    maximumLevel: 19,
    rectangle: SOUTH_TYROL_RECTANGLE,
    credit: 'Orthofoto Südtirol 2023',
  });
  provider.errorEvent.addEventListener(() => {});
  const layer = new ImageryLayer(provider);
  layer.brightness = 1.03;
  layer.saturation = 1.04;
  return layer;
}

/**
 * Austria at 30 cm, from basemap.at — Innsbruck in its valley, Zell am See,
 * Salzburg. Open Government Data Austria, CC BY 4.0, which is why the
 * attribution carries their wording verbatim ("Data source: basemap.at").
 */
export function austrianLayer() {
  const provider = new UrlTemplateImageryProvider({
    url: BASEMAP_AT,
    maximumLevel: 19,
    rectangle: AT_RECTANGLE,
    credit: 'Data source: basemap.at',
  });
  provider.errorEvent.addEventListener(() => {});
  const layer = new ImageryLayer(provider);
  layer.colorToAlpha = AT_NODATA;
  layer.colorToAlphaThreshold = AT_THRESHOLD;
  layer.brightness = 1.03;
  layer.saturation = 1.04;
  return layer;
}

/**
 * SWISSIMAGE, 10 cm, over Switzerland. It goes on top of the IGN layer because
 * it is the best imagery available there, and because it carries the frontier
 * across without a seam.
 *
 * It used to key a grey no-data tile out as well, and that key is gone for the
 * same reason the French one changed: swisstopo no longer serves it. Twenty-
 * four tiles at zoom 14 and 17, spread over the parts of this rectangle that
 * are French, Italian, German and Austrian, all came back as real photographs
 * — none a no-data sheet. The key was therefore dissolving nothing but real
 * pixels: up to 0.94% of a tile, and 1.39% over Bern, which is inside
 * Switzerland and never had a no-data tile to begin with.
 */
export function swissLayer() {
  const layer = new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: SWISSIMAGE,
      maximumLevel: 18,
      rectangle: SWITZERLAND,
      credit: 'swisstopo SWISSIMAGE',
    }),
  );
  layer.brightness = 1.02;
  return layer;
}

/**
 * The thirteen German services, coarse to fine in the only sense that matters
 * here: they do not overlap in coverage, only in bounding box, and the white
 * key sorts that out. Ten of the thirteen are 20 cm, NRW is 10 and Bavaria 40.
 */
export function germanLayers() {
  return GERMANY.map(([code, host, name, west, south, east, north]) => {
    const layer = new ImageryLayer(
      blankBelow(
        new WebMapServiceImageryProvider({
          url: `https://${host}`,
          layers: name,
          parameters: {
            version: '1.3.0',
            format: 'image/jpeg',
            transparent: false,
            styles: '',
          },
          tilingScheme: new WebMercatorTilingScheme(),
          tileWidth: 256,
          tileHeight: 256,
          rectangle: Rectangle.fromDegrees(west, south, east, north),
          maximumLevel: 19,
          credit: `GeoBasis-DE/${code}`,
        }),
        13,
      ),
    );
    layer.colorToAlpha = NODATA;
    layer.colorToAlphaThreshold = NODATA_THRESHOLD;
    return layer;
  });
}

