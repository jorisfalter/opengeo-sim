// Cesium scene for the flight view: global terrain, satellite base, French
// orthophoto on top, and the atmosphere turned up because at 3000 m over the
// Alps the haze is half of what you see.
import { Ion, JulianDate, RequestScheduler, Viewer } from 'cesium';
import {
  baseLayer,
  dutchAerialLayer,
  flemishLayer,
  orthoLayer,
  swissLayer,
  terrainProvider,
} from './providers.js';

Ion.defaultAccessToken = '';

export async function createScene(container, { time }) {
  const terrain = await terrainProvider();
  const viewer = new Viewer(container, {
    // ?pixels=1 keeps the drawing buffer so a test can read the rendered
    // image back. It costs a copy every frame, so it is off unless asked for.
    contextOptions: new URLSearchParams(location.search).has('pixels')
      ? { webgl: { preserveDrawingBuffer: true } }
      : undefined,
    terrainProvider: terrain,
    baseLayer: baseLayer(),
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
  viewer.imageryLayers.add(orthoLayer());
  viewer.imageryLayers.add(swissLayer());
  viewer.imageryLayers.add(dutchAerialLayer());
  viewer.imageryLayers.add(flemishLayer());
  // Cesium limits itself to six requests per host, which is an HTTP/1 rule.
  // Every service we use speaks HTTP/2, where a dozen streams share a single
  // connection — so the tiles arrive in half the wall-clock time at no extra
  // cost to the server. Twelve rather than thirty: these are public services.
  RequestScheduler.maximumRequestsPerServer = 12;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  // Detail is set per frame in main.js: sharp near the ground, relaxed at
  // height, because the tile count grows with the square of this number and
  // nobody can see 20 cm orthophotography from eight kilometres up.
  scene.globe.maximumScreenSpaceError = 1.5;
  // Flying a circuit should not re-download the field you just took off from.
  // A tile is a few hundred kB at most; a thousand of them is a fair trade on
  // a desktop, a quarter of that on a phone.
  const phone = window.matchMedia('(pointer: coarse)').matches;
  scene.globe.tileCacheSize = phone ? 250 : 1000;
  scene.fog.enabled = true;
  scene.fog.density = 0.00012;
  // Distance is where the tile budget goes. Cesium already relaxes detail into
  // the fog; doubling the factor relaxes it further, and in a cockpit at speed
  // the far field is a blur of haze anyway.
  scene.fog.screenSpaceErrorFactor = 4;
  scene.skyAtmosphere.show = true;
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  scene.msaaSamples = 4;
  scene.postProcessStages.fxaa.enabled = true;
  viewer.clock.currentTime = JulianDate.fromIso8601(time);
  viewer.cesiumWidget.creditContainer.classList.add('fly-credits');
  viewer.camera.frustum.fov = (75 * Math.PI) / 180;

  return { viewer, scene, terrain };
}
