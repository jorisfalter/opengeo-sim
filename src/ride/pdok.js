// Open Dutch geodata used by the ride view. No API key, no usage cap, CC BY 4.0,
// and every endpoint sends Access-Control-Allow-Origin: *, so the browser can
// stream all of it directly.
import {
  Cesium3DTileset,
  CesiumTerrainProvider,
  ImageryLayer,
  Rectangle,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';

const OGC_3D = 'https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections';
const WMTS = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0';

export const ATTRIBUTION =
  '© Kadaster/PDOK (3D Basisvoorziening, luchtfoto, AHN) CC BY 4.0 · © OpenStreetMap contributors ODbL';

// The Netherlands plus a margin; keeps Cesium from requesting tiles that the
// service does not cover.
const NL = Rectangle.fromDegrees(3.1, 50.6, 7.4, 53.7);

/** AHN-derived terrain as quantized mesh, up to zoom 15. */
export const terrainProvider = () =>
  CesiumTerrainProvider.fromUrl(`${OGC_3D}/digitaalterreinmodel/quantized-mesh`, {
    requestVertexNormals: true,
  });

/** Aerial photography, 8 cm where available. */
export function aerialLayer() {
  const provider = new WebMapTileServiceImageryProvider({
    url:
      `${WMTS}?service=WMTS&request=GetTile&version=1.0.0&layer=Actueel_orthoHR` +
      '&style=default&format=image/jpeg&tilematrixset=OGC:1.0:GoogleMapsCompatible' +
      '&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}',
    layer: 'Actueel_orthoHR',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: 'OGC:1.0:GoogleMapsCompatible',
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 20,
    rectangle: NL,
    credit: ATTRIBUTION,
  });
  provider.errorEvent.addEventListener((error) => {
    console.warn('PDOK aerial tile failed', error?.message ?? error);
  });
  const layer = new ImageryLayer(provider);
  layer.brightness = 1.06;
  layer.contrast = 1.04;
  layer.saturation = 1.05;
  return layer;
}

/** LoD 2.2 buildings from BAG geometry plus AHN heights. */
export const buildingTileset = () =>
  Cesium3DTileset.fromUrl(`${OGC_3D}/gebouwen/3dtiles?f=json`, {
    maximumScreenSpaceError: 12,
    skipLevelOfDetail: true,
    preferLeaves: true,
  });

/** BGT ground plane: roads, water, rail beds. Alternative to the aerial drape. */
export const groundTileset = () =>
  Cesium3DTileset.fromUrl(`${OGC_3D}/terreinen/3dtiles?f=json`, {
    maximumScreenSpaceError: 16,
    skipLevelOfDetail: true,
  });
