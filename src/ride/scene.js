// Cesium scene: open Dutch geodata, no Ion assets, no token.
import {
  Cesium3DTileStyle,
  ClippingPolygon,
  ClippingPolygonCollection,
  Ion,
  JulianDate,
  ShadowMode,
  Viewer,
} from 'cesium';
import { aerialLayer, buildingTileset, groundTileset, terrainProvider } from './pdok.js';

// Nothing here comes from Cesium ion, so the bundled demo token is never used.
Ion.defaultAccessToken = '';

export async function createScene(container, { time }) {
  const terrain = await terrainProvider();
  const viewer = new Viewer(container, {
    terrainProvider: terrain,
    baseLayer: aerialLayer(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
  });

  const { scene } = viewer;
  scene.globe.depthTestAgainstTerrain = true;
  // The aerial photo already carries the light it was flown in, so shading the
  // globe a second time only crushes the track bed to black. The 3D tiles are
  // lit by the scene light either way, which is what gives the buildings depth.
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  scene.fog.enabled = true;
  scene.fog.density = 0.0004;
  scene.skyAtmosphere.show = true;
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  scene.msaaSamples = 4;
  scene.postProcessStages.fxaa.enabled = true;
  // A fixed clock drives the sun position; the ride runs on its own timer.
  viewer.clock.currentTime = JulianDate.fromIso8601(time);
  viewer.cesiumWidget.creditContainer.classList.add('ride-credits');

  const [buildings, ground] = await Promise.all([buildingTileset(), groundTileset()]);
  // LoD 2.2 buildings have no textures. Plain white reads as an architect's
  // model, so they get a warm grey with a little height-based variation.
  buildings.style = new Cesium3DTileStyle({
    color: "color('#c9c1b4')",
  });
  buildings.shadows = ShadowMode.DISABLED;
  ground.shadows = ShadowMode.DISABLED;
  ground.show = false; // the aerial drape is the default ground
  scene.primitives.add(buildings);
  scene.primitives.add(ground);

  return { viewer, scene, terrain, layers: { buildings, ground } };
}

/** Cuts the rail corridor out of a tileset, so the track is not inside it. */
export function clipCorridor(tileset, positions) {
  tileset.clippingPolygons = new ClippingPolygonCollection({
    polygons: [new ClippingPolygon({ positions })],
  });
}

/** Cuts the given corridors out of the globe (used for road viaducts). */
export function clipGlobe(globe, polygons) {
  if (!polygons.length) return;
  globe.clippingPolygons = new ClippingPolygonCollection({
    polygons: polygons.map((positions) => new ClippingPolygon({ positions })),
  });
}
