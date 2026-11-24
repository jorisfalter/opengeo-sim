// Cesium scene for the flight view: global terrain, satellite base, French
// orthophoto on top, and the atmosphere turned up because at 3000 m over the
// Alps the haze is half of what you see.
import { Ion, JulianDate, PostProcessStage, RequestScheduler, Viewer } from 'cesium';
import {
  austrianLayer,
  canaryLayer,
  portugueseLayer,
  baseLayer,
  dutchAerialLayer,
  flemishLayer,
  germanLayers,
  orthoLayer,
  southTyrolLayer,
  spanishLayer,
  swissLayer,
  terrainProvider,
} from './providers.js';

Ion.defaultAccessToken = '';

// A sharpening pass, clamped to its own neighbourhood.
//
// Not what makes the world sharp — that is the drawing buffer, set in
// createScene below. This is the thing you reach for once the buffer is
// right and the nearest twenty metres are still magnifying a 20 cm
// photograph two and a half times: it cannot put back detail that was
// never in the data, only make the edges that are there read harder.
//
// The clamp is what separates it from a plain unsharp mask. An unsharp mask
// is free to push a pixel past anything around it, and that bright rim it
// leaves along every edge is the halo that makes sharpened pictures look
// sharpened. Holding the result inside the range of the four neighbours lets
// it steepen an edge and never overshoot one — the same trick AMD's RCAS
// uses. A flat sky has lo == hi == c, so it comes out untouched.
const SHARPEN = `
uniform sampler2D colorTexture;
uniform float amount;
in vec2 v_textureCoordinates;
void main() {
  vec2 px = 1.0 / czm_viewport.zw;
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  vec3 n = texture(colorTexture, v_textureCoordinates + vec2(0.0, px.y)).rgb;
  vec3 s = texture(colorTexture, v_textureCoordinates - vec2(0.0, px.y)).rgb;
  vec3 e = texture(colorTexture, v_textureCoordinates + vec2(px.x, 0.0)).rgb;
  vec3 w = texture(colorTexture, v_textureCoordinates - vec2(px.x, 0.0)).rgb;
  vec3 lo = min(min(n, s), min(e, w));
  vec3 hi = max(max(n, s), max(e, w));
  vec3 sharp = c + (c - (n + s + e + w) * 0.25) * amount;
  out_FragColor = vec4(clamp(sharp, min(lo, c), max(hi, c)), 1.0);
}
`;



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
  const params = new URLSearchParams(location.search);
  const phone = window.matchMedia('(pointer: coarse)').matches;

  // ---- how many pixels the world is drawn with ----------------------------
  //
  // Cesium draws at CSS pixels by default and lets the browser blow the canvas
  // up to the screen's own. On a retina display that is a quarter of the
  // pixels, stretched: measured here on a 2x screen, an 800x457 canvas had an
  // 800x457 drawing buffer behind it and was shown at 1600x914. The head-up
  // display is text and stays crisp through all of that; the world is a
  // texture and turns to mush. That is the whole of "it looks pixelated once
  // you have landed" — the orthophoto is 20 cm, and from eye height on a
  // runway one screen pixel covers 15 cm of ground at fifteen metres ahead,
  // so there is nothing wrong with the photograph.
  //
  // So the world is drawn on the screen's own pixels, and the four times the
  // fragments is paid for twice over:
  //   - MSAA drops from four samples to two. At twice the linear resolution
  //     every edge is already half as long; four on top of that is paying for
  //     the same thing again.
  //   - FXAA goes off. It is a blur that guesses where the edges were, and at
  //     full resolution it costs more sharpness than it buys.
  //
  // A phone keeps what it had. Its ratio is three, its fill rate is a tenth of
  // a laptop's, and nine times the fragments is a slideshow. ?res=1 forces the
  // old behaviour and ?res=2 the new one, which is how the two were compared.
  const asked = Number(params.get('res'));
  const ratio = asked > 0 ? asked : phone ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  if (ratio > 1) {
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = ratio / (window.devicePixelRatio || 1);
  }
  // Order is coarse to fine, because the one on top wins where two overlap:
  // basemap.at's 30 cm first, then South Tyrol's 20 cm over the Brenner
  // ridge, then SWISSIMAGE's 10 cm over the Engadin and Val Müstair.
  // Spain goes under France for the same reason the Netherlands goes under
  // Germany: IGN's rectangle reaches to 9.7 E so Corsica fits in it, which
  // puts Catalonia and Navarre inside it too, and PNOA's box holds the
  // Pyrenees and a corner of Languedoc. Each layer wins over its own country
  // — IGN answers its canned white over Spain, which keys out, and Spanish
  // tiles that stray into France are covered by French photography.
  viewer.imageryLayers.add(spanishLayer());
  viewer.imageryLayers.add(canaryLayer());
  // Portugal above Spain, so that on the Minho — where PNOA photographs both
  // banks — the Portuguese side is drawn from Portugal's own 25 cm mosaic.
  viewer.imageryLayers.add(portugueseLayer());
  viewer.imageryLayers.add(orthoLayer());
  // The Low Countries go on before Germany, and resolution is not what
  // decides it. PDOK is 8 cm against North Rhine-Westphalia's 10, so by the
  // coarse-to-fine rule it belongs on top — but its mosaic does not stop at
  // the border. It reaches several kilometres into Germany and then ends on a
  // curved edge, and over Weeze that edge runs diagonally across the
  // aerodrome: the western half of the runway in a flat Dutch winter image,
  // the eastern half in NRW's summer one, with a seam between them. What
  // PDOK serves beyond its own coverage is the same canned white sheet as
  // ever, which keys out — the damage is done where it does have pixels and
  // they are not the country you are flying over.
  //
  // Below Germany is safe because the German services are polite about it:
  // asked for ground in Gennep, Nijmegen, Venlo or Enschede, North
  // Rhine-Westphalia and Lower Saxony each answer the same 667-byte sheet of
  // pure 255,255,255 that the no-data key already removes. So over the
  // Netherlands PDOK still shows, and over Germany the German state wins.
  viewer.imageryLayers.add(dutchAerialLayer());
  viewer.imageryLayers.add(flemishLayer());
  // Germany is thirteen services rather than one, and they go on before the
  // Alpine layers because Bavaria's bounding box runs into Austria's and
  // Baden-Württemberg's into Switzerland's, where the finer imagery wins.
  for (const layer of germanLayers()) viewer.imageryLayers.add(layer);
  viewer.imageryLayers.add(austrianLayer());
  viewer.imageryLayers.add(southTyrolLayer());
  viewer.imageryLayers.add(swissLayer());
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
  scene.globe.tileCacheSize = phone ? 250 : 1000;
  scene.fog.enabled = true;
  scene.fog.density = 0.00012;
  // Distance is where the tile budget goes. Cesium already relaxes detail into
  // the fog; doubling the factor relaxes it further, and in a cockpit at speed
  // the far field is a blur of haze anyway.
  scene.fog.screenSpaceErrorFactor = 4;
  scene.skyAtmosphere.show = true;
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  scene.msaaSamples = ratio > 1 ? 2 : 4;
  scene.postProcessStages.fxaa.enabled = ratio <= 1;
  // Off by default: it is a judgement about how a picture should look, and
  // that is the pilot's to make on their own screen. ?sharpen=0.6 is a good
  // place to start, 0 is what you get without it.
  const sharpen = Math.min(Number(params.get('sharpen')) || 0, 2);
  if (sharpen > 0) {
    scene.postProcessStages.add(
      new PostProcessStage({ name: 'fly_sharpen', uniforms: { amount: sharpen }, fragmentShader: SHARPEN }),
    );
  }
  viewer.clock.currentTime = JulianDate.fromIso8601(time);
  viewer.cesiumWidget.creditContainer.classList.add('fly-credits');
  viewer.camera.frustum.fov = (75 * Math.PI) / 180;

  return { viewer, scene, terrain };
}
