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
const xToLon = (x, z) => (x / 2 ** z) * 360 - 180;
const yToLat = (y, z) => {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};
const latToY = (lat, z) => {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};

export function createMinimap(root, { places = [], airports = [], fieldsNear, onNotice } = {}) {
  root.innerHTML = `
    <div class="fly-map__head">
      <strong>Map</strong>
      <button data-map="centre" title="Centre on the aeroplane" hidden>⌖</button>
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
  const centreButton = root.querySelector('[data-map="centre"]');
  const tiles = new Map(); // key -> Image | 'pending' | 'failed'
  const trail = [];
  // The fields under the map, asked for again only when the map has moved or
  // been zoomed: the index is 28,000 entries and this runs on every draw.
  let fields = [];
  let fieldsAt = null;
  let zoom = 9;
  // Where the map is looking, when that is not where the aeroplane is. Drag
  // it and it stays put until you ask for the aeroplane back, which is the
  // whole point: a map you cannot look away from is a position indicator.
  let pan = null;
  let visible = true;
  let lastTrail = 0;
  // The last position drawn, so a drag that starts before the first pan knows
  // what it is dragging away from.
  let lastSeen = null;
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
    const view = pan ?? aircraft;
    const centreX = lonToX(view.lon, zoom);
    const centreY = latToY(view.lat, zoom);

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

    // Every field under the map gets the same runway tick as the built ones,
    // in a quieter blue: at any useful zoom that is the difference between
    // "there is a field here" and "there is a field here and this is how it
    // lies", which is the thing you want when you are looking for somewhere
    // to put down. Shorter than six pixels of runway at this scale and it is
    // left out, or a map of the Low Countries is a wall of labels.
    const mpp = metresPerPixel(view.lat, zoom) || 1;
    const reach = (mpp * Math.max(w, h)) / 2 / 1000;
    if (fieldsNear && (!fieldsAt || fieldsAt.zoom !== zoom || Math.hypot(
      (view.lat - fieldsAt.lat) * 111320,
      (view.lon - fieldsAt.lon) * 111320 * Math.cos(view.lat * DEG),
        // a fifth of the half-width, in metres
    ) > reach * 200)) {
      fieldsAt = { lat: view.lat, lon: view.lon, zoom };
      fields = fieldsNear(view.lat, view.lon, reach, mpp * 6) ?? [];
    }
    const built = new Set(airports.map((field) => field.icao));
    ctx.font = '600 13px ui-monospace, monospace';
    for (const field of fields) {
      if (built.has(field.icao)) continue;
      // Never shorter than this: a runway drawn to scale at a wide zoom is
      // three pixels of dark grey on a satellite photograph of dark grey.
      const pixels = Math.max(9, field.length / mpp / 2);
      runway(project(field.lat, field.lon), field, pixels, '#9bd8ff');
    }

    // The surveyed airports on top, brighter: those have a runway you can
    // actually land on rather than a line on a map.
    ctx.font = '600 14px ui-monospace, monospace';
    for (const field of airports) {
      runway(project(field.lat, field.lon), field, Math.max(9, field.length / mpp / 2), '#ffffff');
    }

    /**
     * One field: the runway as a casing and a bright core, the way a map
     * draws a road, with a cross tick at each end. Both are what makes it
     * read as a runway at a glance instead of as a scratch on the photo.
     */
    function runway([x, y], field, pixels, colour) {
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return;
      const a = field.heading * DEG;
      const [dx, dy] = [Math.sin(a) * pixels, -Math.cos(a) * pixels];
      const [ex, ey] = [Math.cos(a) * 4, Math.sin(a) * 4];
      const strip = () => {
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.moveTo(x - dx - ex, y - dy - ey);
        ctx.lineTo(x - dx + ex, y - dy + ey);
        ctx.moveTo(x + dx - ex, y + dy - ey);
        ctx.lineTo(x + dx + ex, y + dy + ey);
        ctx.stroke();
      };
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 6;
      strip();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2.5;
      strip();
      label(field.icao, x + dx + 7, y + dy - 5, colour);
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

    // The aeroplane, pointing where it is going — at its place on the map,
    // which is the middle of it until the map is dragged off it.
    const [planeX, planeY] = project(aircraft.lat, aircraft.lon);
    ctx.save();
    ctx.translate(planeX, planeY);
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

  const recentre = () => {
    pan = null;
    centreButton.hidden = true;
    lastDraw = 0;
  };

  root.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.map;
    if (action === 'in') setZoom(zoom + 1);
    if (action === 'out') setZoom(zoom - 1);
    if (action === 'centre') recentre();
    if (action === 'hide') api.toggle(false);
  });
  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  // Dragging the map. The pointer is captured, so a drag that runs off the
  // edge of the canvas keeps panning instead of stopping dead, and the events
  // stop here so that nothing behind the map acts on them.
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Capture keeps a drag alive past the edge of the canvas. It is not worth
    // the drag itself, though: a pointer the browser will not let us capture
    // still pans perfectly well while it is over the map.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* no capture, no matter */
    }
    // The canvas is drawn at 460 and shown smaller, so a pixel on the screen
    // is more than a pixel on the map.
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    drag = { x: event.clientX, y: event.clientY, scale, moved: false };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || !lastSeen) return;
    event.stopPropagation();
    const dx = (event.clientX - drag.x) * drag.scale;
    const dy = (event.clientY - drag.y) * drag.scale;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const from = pan ?? lastSeen;
    const lat = yToLat(latToY(from.lat, zoom) - dy / TILE_SIZE, zoom);
    pan = {
      lat: Math.max(-85, Math.min(85, lat)),
      lon: xToLon(lonToX(from.lon, zoom) - dx / TILE_SIZE, zoom),
    };
    centreButton.hidden = false;
    lastDraw = 0;
  });
  const endDrag = (event) => {
    if (!drag) return;
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* it was never captured */
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    recentre();
  });

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
      lastSeen = { lat: aircraft.lat, lon: aircraft.lon };
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
    /**
     * Forgets where the aeroplane has been. Changing the start teleports it,
     * and a breadcrumb trail does not know that: it joined Chambery to the
     * new field with a straight line across France, which looks exactly like
     * a route and is not one.
     */
    clear() {
      trail.length = 0;
      fieldsAt = null;
      recentre();
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
