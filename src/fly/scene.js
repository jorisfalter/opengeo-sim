// Cesium scene for the flight view: global terrain, satellite base, French
// orthophoto on top, and the atmosphere turned up because at 3000 m over the
// Alps the haze is half of what you see.
import { Ion, JulianDate, Viewer } from 'cesium';
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
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.maximumScreenSpaceError = 1.5; // sharper terrain, we are low and fast
  scene.fog.enabled = true;
  scene.fog.density = 0.00012;
  scene.skyAtmosphere.show = true;
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  scene.msaaSamples = 4;
  scene.postProcessStages.fxaa.enabled = true;
  viewer.clock.currentTime = JulianDate.fromIso8601(time);
  viewer.cesiumWidget.creditContainer.classList.add('fly-credits');
  viewer.camera.frustum.fov = (75 * Math.PI) / 180;

  return { viewer, scene, terrain };
}
