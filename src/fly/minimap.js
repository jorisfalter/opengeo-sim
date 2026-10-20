// A moving map in the corner, so you know where you are.
//
// Drawn on a canvas from the same Sentinel-2 cloudless tiles the scene already
// uses — no second source and no second licence. North is up, because a map
// that rotates with the aeroplane tells you where you are pointing and not
// where you are, and the question here is the second one.
//
// Zoomed out it is the continents, zoomed in it is the valley you are flying
// down; the satellite mosaic reads at every scale, which is why it needs no
// labels of its own beyond the places we already know about.

const TILE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g';
const TILE_SIZE = 256;
const MAX_Z = 13;
const MIN_Z = 2;
const DEG = Math.PI / 180;

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};

export function createMinimap(root, { places = [], airports = [], onNotice } = {}) {
  root.innerHTML = `
    <div class="fly-map__head">
      <strong>Map</strong>
      <button data-map="out" title="Zoom out">−</button>
      <button data-map="in" title="Zoom in">+</button>
      <button data-map="hide" title="Hide (N)">×</button>
    </div>
    <canvas data-el="canvas" width="460" height="460"></canvas>
    <div class="fly-map__foot">
      <span data-el="scale"></span>
      <span data-el="coords"></span>
    </div>`;

  const canvas = root.querySelector('[data-el="canvas"]');
  const ctx = canvas.getContext('2d');
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const tiles = new Map(); // key -> Image | 'pending' | 'failed'
  const trail = [];
  let zoom = 9;
  let visible = true;
  let lastTrail = 0;
  // The map is not flight data: ten frames a second is plenty, and it keeps
  // the canvas out of the budget on a machine that needs it for the scene.
  let lastDraw = 0;

  function tileAt(z, x, y) {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    const wrapped = ((x % n) + n) % n;
    const key = `${z}/${wrapped}/${y}`;
    const have = tiles.get(key);
    if (have) return have === 'pending' || have === 'failed' ? null : have;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    tiles.set(key, 'pending');
    image.addEventListener('load', () => tiles.set(key, image));
    image.addEventListener('error', () => tiles.set(key, 'failed'));
    // WMTS path order is z/row/col, the same as the scene's imagery layer.
    image.src = `${TILE}/${z}/${y}/${wrapped}.jpg`;
    return null;
  }

  /** Metres per pixel at this latitude and zoom, for the scale bar. */
  const metresPerPixel = (lat, z) =>
    (156543.03392 * Math.cos(lat * DEG)) / 2 ** z;

  function draw(aircraft, { route = [], leg = null } = {}) {
    if (!visible) return;
    const { width: w, height: h } = canvas;
    const cx = w / 2;
    const cy = h / 2;
    const centreX = lonToX(aircraft.lon, zoom);
    const centreY = latToY(aircraft.lat, zoom);

    ctx.fillStyle = '#0b1014';
    ctx.fillRect(0, 0, w, h);

    // Tiles, from the top-left of the visible square outwards.
    const first = Math.floor(centreX - cx / TILE_SIZE);
    const last = Math.ceil(centreX + cx / TILE_SIZE);
    const top = Math.floor(centreY - cy / TILE_SIZE);
    const bottom = Math.ceil(centreY + cy / TILE_SIZE);
    for (let x = first; x <= last; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const image = tileAt(zoom, x, y);
        if (!image) continue;
        ctx.drawImage(
          image,
          Math.round(cx + (x - centreX) * TILE_SIZE),
          Math.round(cy + (y - centreY) * TILE_SIZE),
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }

    const project = (lat, lon) => [
      cx + (lonToX(lon, zoom) - centreX) * TILE_SIZE,
      cy + (latToY(lat, zoom) - centreY) * TILE_SIZE,
    ];

    // Where you have been.
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      trail.forEach((point, i) => {
        const [x, y] = project(point.lat, point.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // The route, when one is being flown.
    if (route.length) {
      ctx.strokeStyle = 'rgba(122, 240, 176, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      route.forEach((point, i) => {
        const [x, y] = project(point.lat, point.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 15px ui-monospace, monospace';
      route.forEach((point, i) => {
        const [x, y] = project(point.lat, point.lon);
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return;
        ctx.fillStyle = i === leg ? '#ffd166' : 'rgba(122, 240, 176, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, i === leg ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        label(point.name, x + 9, y + 5, i === leg ? '#ffd166' : 'rgba(230, 255, 240, 0.85)');
      });
    }

    // Airports first, with a runway tick at the right angle: at any useful
    // zoom that is the difference between "there is a field here" and "there
    // is a field here and this is how it lies".
    ctx.font = '600 14px ui-monospace, monospace';
    for (const field of airports) {
      const [x, y] = project(field.lat, field.lon);
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      const pixels = Math.max(7, field.length / (metresPerPixel(field.lat, zoom) || 1) / 2);
      const a = field.heading * DEG;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - Math.sin(a) * pixels, y + Math.cos(a) * pixels);
      ctx.lineTo(x + Math.sin(a) * pixels, y - Math.cos(a) * pixels);
      ctx.stroke();
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      label(field.icao, x + 8, y - 6, '#8fd0ff');
    }

    // The places you can start from double as landmarks.
    ctx.font = '500 14px ui-monospace, monospace';
    for (const place of places) {
      if (place.lat === undefined) continue;
      const [x, y] = project(place.lat, place.lon);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(x - 2, y - 2, 4, 4);
      // "Tarentaise, boven Moûtiers" is a start-point description, not a map
      // label; the map wants the name and nothing after the comma.
      label(place.name.split(',')[0], x + 7, y + 4, 'rgba(255, 255, 255, 0.8)');
    }

    // The aeroplane, pointing where it is going.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(aircraft.heading);
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 11);
    ctx.lineTo(0, 6);
    ctx.lineTo(-9, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North, so the orientation is never in doubt.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.fillText('N', w - 22, 24);
    ctx.beginPath();
    ctx.moveTo(w - 17, 30);
    ctx.lineTo(w - 21, 40);
    ctx.lineTo(w - 13, 40);
    ctx.closePath();
    ctx.fill();

    function label(text, x, y, colour) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    }
  }

  const setZoom = (value) => {
    zoom = Math.max(MIN_Z, Math.min(MAX_Z, value));
    lastDraw = 0;
  };

  root.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.map;
    if (action === 'in') setZoom(zoom + 1);
    if (action === 'out') setZoom(zoom - 1);
    if (action === 'hide') api.toggle(false);
  });
  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  const api = {
    update(aircraft, context) {
      if (!visible) return;
      const now = performance.now();
      // A breadcrumb every second and a half, five minutes of history.
      if (now - lastTrail > 1500) {
        lastTrail = now;
        trail.push({ lat: aircraft.lat, lon: aircraft.lon });
        if (trail.length > 200) trail.shift();
      }
      if (now - lastDraw < 100) return;
      lastDraw = now;
      draw(aircraft, context);
      el('coords').textContent =
        `${Math.abs(aircraft.lat).toFixed(2)}${aircraft.lat < 0 ? 'S' : 'N'} ` +
        `${Math.abs(aircraft.lon).toFixed(2)}${aircraft.lon < 0 ? 'W' : 'E'} z${zoom}`;
      const metres = metresPerPixel(aircraft.lat, zoom) * (canvas.width / 4);
      el('scale').textContent =
        metres > 2000 ? `${Math.round(metres / 1000)} km` : `${Math.round(metres / 10) * 10} m`;
    },
    toggle(show) {
      visible = show ?? !visible;
      root.classList.toggle('is-open', visible);
      onNotice?.(visible ? 'Map on' : 'Map off (N)');
      return visible;
    },
    get visible() {
      return visible;
    },
  };
  setZoom(zoom);
  api.toggle(true);
  return api;
}
