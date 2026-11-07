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
