// The glide path, checked against arithmetic anyone can do on paper.
//
// A 3° slope rises 5.24% — 524 m in 10 km — and a localizer's full scale is
// 2.5°, which at 5 km is 218 m off the centreline. If the module and the
// trigonometry disagree, one of them is wrong, and it is not the trigonometry.
import {
  approachEnds, pickEnd, deviation, papiColours, papiUnits,
  GLIDE_DEG, TCH_FT,
} from '../src/fly/approach.js';

const FT = 0.3048;
const DEG = Math.PI / 180;
let bad = 0;
const near = (what, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad += 1;
  console.log(`${ok ? '  ok ' : '  XX '} ${what}: ${got.toFixed(3)} (verwacht ${want.toFixed(3)} ±${tol})`);
};
const is = (what, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) bad += 1;
  console.log(`${ok ? '  ok ' : '  XX '} ${what}: ${got} (verwacht ${want})`);
};

// A field of our own making: a 3000 m runway on exactly 090°, at sea level,
// on the equator so a degree of longitude is a degree of latitude.
const L = 3000;
const half = L / 2 / 111320;
const field = {
  ident: 'TEST', name: 'Rekenveld', lat: 0, lon: 0, elevationFt: 0, country: 'XX',
  runways: [{
    leLat: 0, leLon: -half, heLat: 0, heLon: half,
    lengthFt: L / FT, widthFt: 150 / FT, surface: 'ASP',
    leId: '09', heId: '27', leDisplacedFt: 0, heDisplacedFt: 0, measured: false,
  }],
};

console.log('De twee richtingen');
const ends = approachEnds(field);
is('aantal', ends.length, 2);
const [le, he] = ends;
is('baan 09 koers', Math.round(le.course), 90);
is('baan 27 koers', Math.round(he.course), 270);
near('drempel 09 ten westen', le.lon * 111320, -L / 2, 1);
near('drempel 27 ten oosten', he.lon * 111320, L / 2, 1);

console.log('Welke richting je nadert');
const west = { lat: 0, lon: -0.1, heading: 90 * DEG };
is('van het westen is 09', pickEnd(ends, west).runway, '09');
const east = { lat: 0, lon: 0.1, heading: 270 * DEG };
is('van het oosten is 27', pickEnd(ends, east).runway, '27');

console.log('Op het pad, 10 km uit');
const tenKm = 10000;
const onPathFt = TCH_FT + (tenKm * Math.tan(GLIDE_DEG * DEG)) / FT;
near('hoogte op 10 km', onPathFt, 50 + 524.08 / FT, 1);
const plane = { lat: 0, lon: (-L / 2 - tenKm) / 111320 };
const d = deviation(le, plane, onPathFt);
near('te gaan', d.toGo, tenKm, 1);
near('glijpad-afwijking', d.gsDeg, 0, 0.01);
near('glijpad-stippen', d.gsDots, 0, 0.02);
near('localizer-stippen', d.locDots, 0, 0.001);
is('scherp', d.live, true);

console.log('Een halve graad boven het pad');
const highFt = TCH_FT + (tenKm * Math.tan(3.5 * DEG)) / FT;
const high = deviation(le, plane, highFt);
near('afwijking', high.gsDeg, 0.5, 0.01);
near('stippen', high.gsDots, 0.5 / 0.7, 0.02);

console.log('Volle uitslag zijwaarts, 5 km uit');
const fiveKm = 5000;
const off = fiveKm * Math.tan(2.5 * DEG);
near('dat is meters', off, 218.3, 0.5);
const right = { lat: -off / 111320, lon: (-L / 2 - fiveKm) / 111320 };
const side = deviation(le, right, TCH_FT + (fiveKm * Math.tan(GLIDE_DEG * DEG)) / FT);
near('graden', side.locDeg, 2.5, 0.01);
near('stippen', side.locDots, 1, 0.01);

console.log('De PAPI');
const units = papiUnits(le);
is('vier lampen', units.length, 4);
near('eerste 15 m naast de rand', (units[0].lat * 111320) - 0, 150 / 2 + 15, 0.5);
near('mikpunt 300 m voorbij de drempel', (units[0].lon * 111320) - (-L / 2), 300, 1);
const onPath = papiColours(le, plane, onPathFt);
is('op 3°: rood rood wit wit', onPath.map((u) => (u.white ? 'W' : 'R')).join(' '), 'R R W W');
const low = papiColours(le, plane, TCH_FT + (tenKm * Math.tan(2.2 * DEG)) / FT);
is('te laag: alles rood', low.map((u) => (u.white ? 'W' : 'R')).join(' '), 'R R R R');
const steep = papiColours(le, plane, TCH_FT + (tenKm * Math.tan(3.9 * DEG)) / FT);
is('te hoog: alles wit', steep.map((u) => (u.white ? 'W' : 'R')).join(' '), 'W W W W');

console.log('De drempelhoogte');
// The same field with a slope: 09 at sea level, 27 thirty metres higher, and
// a field elevation that is neither of them. A path to the low end must aim
// at the low end.
const sloped = {
  ...field,
  elevationFt: 100,
  runways: [{ ...field.runways[0], leElevationFt: 0, heElevationFt: 98, lighted: true }],
};
const [low09, high27] = approachEnds(sloped);
is('09 pakt zijn eigen drempel', low09.elevFt, 0);
is('27 pakt de zijne', high27.elevFt, 98);
is('en zegt dat het een ingemeten drempel is', low09.surveyedEnd, true);
const atLow = deviation(low09, plane, onPathFt);
near('het pad naar 09 ligt waar het lag', atLow.gsDots, 0, 0.02);
const atHigh = deviation(
  high27,
  { lat: 0, lon: (L / 2 + tenKm) / 111320 },
  98 + TCH_FT + (tenKm * Math.tan(GLIDE_DEG * DEG)) / FT,
);
near('het pad naar 27 ligt dertig meter hoger', atHigh.gsDots, 0, 0.02);
// Without the published numbers the field elevation is all there is.
const flat = { ...field, elevationFt: 100 };
const [plain] = approachEnds(flat);
is('zonder drempelhoogte: het veld', plain.elevFt, 100);
is('en dat wordt niet verzwegen', plain.surveyedEnd, false);

console.log('Verlichting');
is('onverlicht tenzij het in de index staat', plain.lighted, false);
is('verlicht als het er wel in staat', low09.lighted, true);

console.log(bad === 0 ? '\nAlles klopt.' : `\n${bad} fout(en).`);
process.exit(bad === 0 ? 0 : 1);
