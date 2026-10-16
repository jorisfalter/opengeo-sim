# Hyperrealistische cabinerit Amsterdam Centraal → Amsterdam Zuid

Onderzoek + uitvoeringsplan voor een "ride mode" bovenop TrainConnections.
Datum: 2026-09-27. Auteur: Claude Code (sessie `trainconnections`), op verzoek
van Joris.

> **Status: fase P0, P1 en P2 zijn gebouwd en draaien.**
> `ride.html` rijdt van Amsterdam Centraal naar Sloterdijk (5,24 km) en naar
> Lelylaan (8,79 km) over echte spoorgeometrie, PDOK-terrein, 8 cm luchtfoto en
> LoD 2.2-gebouwen, met ballastbed, rails, bovenleiding, seinen en perrons, en
> een snelheidsprofiel dat op 04:56 uitkomt tegen 5 minuten dienstregeling.
> Bouwen: `npm run build:ride -- --ride ams-centraal-sloterdijk`, dan
> `npm run dev` en `/ride.html`. Techniek en beperkingen: `docs/ride-view.md`.
> Het nabije veld is compleet: ballastbed, dwarsliggerband, rails,
> bovenleiding, seinen, perrons met kap, viaductdekken met leuningen en
> geluidsschermen uit OSM. Volgende stappen: P3 (cabine), P4 (geluid) en P5
> (post-processing).
>
> **Correctie op §2 hieronder: er rijdt geen directe trein Amsterdam Centraal →
> Amsterdam Zuid.** Dat bleek uit de spoorgraaf tijdens het bouwen en is door NS
> bevestigd. De boog bij Riekerpolder aansluiting verbindt de Zuidtak met de
> Schiphollijn, niet met de Westelijke Ringspoorbaan uit de richting Lelylaan;
> vanaf Centraal is de Zuidtak in geen enkele rijrichting bereikbaar. De echte
> treinroute is Centraal → Schiphol (via Sloterdijk en Lelylaan) en dan
> Schiphol → Amsterdam Zuid: twee ritten. Voor de metro (lijn 52) geldt dat niet,
> maar dat is geen trein.

---

## 1. Doel

Een demo waarin je in de cabine (of aan het raam) van een trein van
**Amsterdam Centraal naar Amsterdam Zuid** rijdt, zo fotorealistisch mogelijk,
met de échte omgeving — niet een generiek verzonnen stad. Kortere variant als
terugvaloptie: **Amsterdam Centraal → Amsterdam Sloterdijk** (5,3 km, ~5 min).

Aanleiding: de stroom AI-gamedemo's op sociale media ("prompt → speelbare
wereld"). De vraag is of die techniek hier bruikbaar is, en zo niet, wat dan
wél.

Waarom dit bij TrainConnections past: de kaart beantwoordt nu *"welke directe
treinen lopen vanaf dit station"*. Een ride mode beantwoordt de logische
vervolgvraag: *"hoe ziet dat traject er dan uit"*. De data die je daarvoor
nodig hebt (stop-sequentie, tijden, shape-geometrie) zit al in de
GTFS-pipeline: `service_patterns.path_json` + `pattern_stops.minutes_from_origin`
uit `docs/gtfs-ingest.md`.

---

## 2. Traject: harde feiten

| Item | Waarde |
| --- | --- |
| Lijn | Ringspoorbaan west / Schiphollijn (Amsterdam CS – Schiphol), km 47,2 → Zuidtak |
| Stations | Amsterdam Centraal (km 47,2) → Sloterdijk (km 52,5) → Lelylaan (km 56,0) → *Riekerpolder aansluiting* → Schiphol; Amsterdam Zuid ligt aan de Zuidtak en is van hieruit niet direct bereikbaar |
| Lengte | CS → Sloterdijk 5,24 km, CS → Lelylaan 8,79 km (gemeten uit de OSM/ProRail-geometrie; komt overeen met de kilometrering) |
| Sporen / stroom | dubbelspoor, 1500 V DC, sinds 1986 |
| Baanvaksnelheid | 130 km/h (lager bij CS-uitrit en op de boog bij Riekerpolder) |
| Beveiliging | ATB-EG |
| Rijtijd | ± 12–14 min sprinter met 3 tussenstops |
| Bijzonderheden voor beeld | CS-perronkappen, Westerpark/Haarlemmerweg, hoog gelegen baan bij Sloterdijk (kruisstation, boven- én onderperrons), betonnen viaduct langs de A10 West, Lelylaan, de boog bij Riekerpolder, en bij Zuid de bouwput/nieuwe passages van **Zuidasdok** |

**Let op — de omgeving verandert nu écht.** Zuidasdok is in volle gang: de
Brittenpassage opent 1 november 2026, de Vivaldipassage wordt onder het spoor
doorgeschoven, de A10 Zuid gaat de tunnel in. Elke hyperrealistische weergave
van Amsterdam Zuid is dus een **momentopname** die binnen een jaar zichtbaar
verouderd is. Dat is een argument om met CS → Sloterdijk te beginnen: dat stuk
is stabiel.

---

## 3. Wat er te koop is (stand september 2026)

### 3.1 Generatieve world models — de dingen die je op sociale media ziet

| Model | Wat het doet | Beperking voor dit doel |
| --- | --- | --- |
| **Genie 3 / Project Genie** (Google DeepMind) | tekst → bestuurbare wereld, 720p, 20–24 fps, real-time | sinds 29 jan 2026 publiek, maar **AI Ultra, VS-only**; consistent "voor een paar minuten"; geen geografische trouw |
| **Odyssey-2** | general-purpose world model, nieuw frame elke ~50 ms (20 fps) | zelfde verhaal: plausibele wereld, niet *deze* wereld |
| **Decart Mirage LSD** | live **video-naar-video** restyling, <40 ms latency, 768×432 @ 20 fps, API | verandert stijl van een bestaande stream — geografie blijft van de input. Interessant als *post-processing*, niet als generator |
| **World Labs Marble** | tekst/foto/panorama/video → **persistente** 3D-wereld als Gaussian splats, export SPZ/PLY + collider mesh, World API sinds 21 jan 2026, ~$0,12 per draft-wereld | levert een echte 3D-scene (goed nieuws), maar gegenereerd/verzonnen tenzij je eigen panorama's invoert; scene-schaal is een kamer/plein, geen 13 km corridor |
| **Veo 3.1 / Kling 3.0 / Seedance 2.5 / Runway Gen-4.5** | fotorealistische videogeneratie, image-to-video | niet interactief, clips van seconden, en "hallucinerende" gebouwen. Sora is geen optie meer: app dicht op 26 apr 2026, API sunset 24 sep 2026 |

**Conclusie:** deze modellen geven *fotorealisme zonder adres*. Prompt je
"cab ride Amsterdam to Amsterdam Zuid", dan krijg je een geloofwaardige
Noord-Europese spoorlijn — met grachtenpanden die nergens staan. Voor de
belofte "dit is echt het stuk van CS naar Zuid" zijn ze op zichzelf ongeschikt.
Ze zijn wél sterk als **laatste laag** over een geometrisch correcte render, of
als losse "wow"-teaser met eerlijk label.

### 3.2 Geo-echte 3D data — hier zit het goud, en het is Nederlands

Getest en werkend vanaf deze VPS (27 sep 2026):

- **PDOK / Kadaster 3D Basisvoorziening**, licentie **CC BY 4.0**, geen API-key:
  - `https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections`
  - collecties: `gebouwen` (OGC **3D Tiles**, LoD 2.2, glTF/glb — direct te
    streamen via `/collections/gebouwen/3dtiles`), `terreinen` (3D Tiles,
    BGT-grondvlak incl. wegen en water), `digitaalterreinmodel` (quantized mesh,
    Cesium-ready), `digitaaloppervlaktemodel_8cm` / `_20cm`,
    `basisbestand_gebouwen(_terreinen)` (CityJSON), `hoogtestatistieken_gebouwen`
  - hoogtes uit AHN4/5/6 + luchtfoto's, panden bijgewerkt t/m 1 jan 2026
- **PDOK luchtfoto RGB** WMTS (8 cm, open):
  `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0` — als grondtextuur over
  het DTM
- **3DBAG** (TU Delft e.a.): zelfde bronnen, fijnmazigere LoD-varianten, open
- **OSM / OpenRailwayMap**: Nederlandse sporen zijn **geïmporteerd uit
  ProRail-data**, dus de spoor-as (`railway=rail`), wissels, seinen
  (`railway=signal`), perrons en overwegen liggen er nauwkeurig in. ODbL.
- **Google Photorealistic 3D Tiles** (Maps Tile API, 2500+ steden incl.
  Amsterdam): echte fotogrammetrie-mesh, mooier dan LoD 2.2-blokken —
  maar: betaald per root-tile-sessie (één root request geeft ≥ 3 uur tiles),
  **geen derivative use** (niet meten, geen object-detectie, geen geodata
  afleiden, geen offline gebruik). Eigen 3D-objecten eroverheen leggen mág,
  zolang ze niet uit de tiles zijn afgeleid. Bij EEA-facturatie gelden de
  EEA-ToS sinds 8 juli 2025.

### 3.3 Street View — de valkuil

Je vermoedde Street View nodig te hebben. Probleem: **Street View rijdt over
wegen, niet over spoor.** Voor de baan zelf tussen CS en Zuid bestaat geen
straatbeeld; je hebt alleen kruisende straten, viaducten van onderaf en wat
station-imagery. Daar bouw je geen cabineperspectief mee. Bovendien verbiedt de
ToS het afleiden van 3D/geodata uit die beelden.

Wat wél kan: **eigen** beelden. Een 360-camera langs publiek toegankelijke
punten (perrons, viaducten, Westerpark) → Gaussian splats via city-scale
3DGS-tooling (Mosaic, StreetSurfGS, CityGaussian-achtige pipelines) of via
Marble's panorama-input. Hoogste fidelity per meter, maar alleen waar je zelf
mag komen — en de baan zelf is verboden gebied.

### 3.4 Treinsimulator-engines

| Optie | Verdict |
| --- | --- |
| **openBVE** (open source, gratis, NL-routes van hobbyisten bestaan) | uitstekende rijdynamiek en ATB-cultuur, maar grafisch 2005; routes zijn handmatig scripten per blokje. Goede bron voor *rijgedrag*, niet voor fotorealisme |
| **Zusi 3 / Train Sim World 5 / Run8** | mooier, maar gesloten, betaald, geen bruikbare SDK of publicatierechten voor een web-demo |
| **Unreal Engine 5 + Cesium for Unreal** (+ PDOK of Google 3D Tiles) | de fotorealistische route: Lumen/Nanite met echte geodata, offline render naar video. Gratis licentie tot $1M omzet. Vereist GPU |
| **CesiumJS of three.js in de browser** | draait overal, geen installatie, integreert direct in TrainConnections (React/Vite). Fidelity lager dan UE5, maar met goede post-processing verrassend ver |

### 3.5 Hardware-realiteit

De VPS heeft geen GPU. Die kan **hosten**, niet renderen.
Dus: de webvariant rendert in de browser van de bezoeker; de cinematic variant
rendert offline op een gehuurde GPU (RunPod/Lambda, ~$0,50–2,00/uur) en de VPS
serveert alleen het resultaat. Assets van een corridor van 13 km kunnen
honderden MB's zijn — statisch achter de Cloudflare Tunnel, of gewoon live van
PDOK streamen.

---

## 4. De kern van het probleem

> Vanuit een cabineraam op ~2,5 m hoogte kijk je precies naar datgene waar
> luchtfotogrammetrie het slechtst in is.

Alle geo-echte datasets (PDOK LoD 2.2, Google's mesh, AHN) zijn uit de lucht
gemaakt. Ze zijn uitstekend voor silhouetten, straatpatronen en skyline op
50–500 m. Op 5–30 m van het spoor — ballast, dwarsliggers, bovenleidingportalen,
geluidsschermen, relaiskasten, graffiti op keerwanden, perronkappen — is er
**geen data**: daar is het smeuïge mesh of het ontbreekt volledig.

Daaruit volgt de enige aanpak die werkt:

1. **Verre veld = echte data** (PDOK/Google tiles + luchtfoto-drape). Zorgt dat
   het *echt Amsterdam* is: de Sloterdijk-kruising, de A10-flats, de
   Zuidas-torens.
2. **Nabije veld = procedureel + handwerk**, gegenereerd uit de spoor-as: rails,
   ballast, bovenleiding elke ~50 m, seinen op OSM-posities, perrons uit BGT,
   geluidsschermen uit BGT. Hier wordt het realisme gewonnen of verloren.
3. **AI = laatste laag**, niet de basis: video-restyle (Mirage LSD) of
   diffusie-upscale over de gerenderde frames, om de CGI-tell weg te poetsen.

Dat is ook precies waarom de sociale-media-demo's zo goed lijken: die hoeven
nergens te kloppen. Onze demo moet kloppen — dat is duurder, maar het is ook
het hele punt.

---

## 5. Vier sporen, met verdict

| Spoor | Wat | Geo-echt? | Interactief? | Inspanning | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Web geo-sim** | CesiumJS/three.js in TrainConnections, PDOK 3D Tiles + procedureel spoor + cabine-overlay | ja | ja (snelheid, kijkrichting, pauze) | 13–15 dagen voor CS→Sloterdijk | **doen** — dit is het product |
| **B. Cinematic hero-render** | UE5 + Cesium for Unreal + Google/PDOK tiles, 60–90 s render, optioneel AI-restyle | ja | nee | 5–10 dagen (+ GPU-huur) | **doen als tweede** — dit is wat je op sociale media zet |
| **C. Video-first** | echte 4K/360 cabinerit-opname als basis, AI-restyle + data-overlay (stations, snelheid, kaartje) | ja, letterlijk | half (rondkijken, scrubben) | 2–4 dagen mits bruikbare bronbeelden + licentie | **snelle win**, maar rechten regelen: zelf in een NS-cabine filmen mag niet zonder toestemming |
| **D. World-model teaser** | Genie 3 / Odyssey-2 / Marble prompt → "een Nederlandse forensentrein" | **nee** | ja | uren | leuk experiment, expliciet labelen als "AI-fantasie", nooit als "dit is Amsterdam" |

Aanbeveling: **A als basis, B voor de etalage.** C als je binnen een week iets
wil kunnen laten zien. D los, als postje over de techniek zelf.

---

## 6. Uitvoeringsplan spoor A (het product)

Scope MVP: **Amsterdam Centraal → Amsterdam Sloterdijk**, één rijrichting,
daglicht, geen weer, vast cabineperspectief.

### P0 — Spoor-as met hoogte (2 dagen) — **gebouwd**, zie `docs/ride-view.md`
- Haal de spoor-as uit **OSM** via Overpass: `railway=rail` binnen een corridor
  rond de lijn. Niet uit GTFS `shapes.txt` — die is versimpeld
  (`maxShapePoints: 900` per pattern) en ligt soms tussen de sporen.
- In de praktijk bleek een gerichte-edge-zoektocht nodig: op een ongerichte
  knopengraaf levert Dijkstra paden op die voorbij het station rijden en
  terugkeren, want een trein kan niet omkeren op een wissel.
- Kies het juiste spoor (richting Sloterdijk), knoop de segmenten aan elkaar,
  resample naar 1 punt per 2 m.
- Z-waarde: sample `digitaalterreinmodel` (quantized mesh) of het 8 cm DSM. Voor
  viaducten en de hoge baan bij Sloterdijk het hoogteprofiel handmatig
  bijstellen — DTM is maaiveld, niet spoorhoogte. Reken erop dat dit tijd kost.
- Bereken kilometrering, kromming (radius per punt) en daaruit de verkanting.
- **Output:** `data/ride/ams-slotdijk.centerline.json` — `[x, y, z, s, curvature]`.
- **Acceptatie:** de as ligt overal < 1,5 m van de spoor-as op de luchtfoto, en
  het hoogteprofiel heeft geen sprongen > 0,3 m per 2 m.

### P1 — Scene en camera (2 dagen) — **gebouwd**
- CesiumJS (of three.js + `3d-tiles-renderer`) in de bestaande Vite/React app,
  als lazy-loaded route `/ride`.
- Tilesets: PDOK `gebouwen` + `terreinen`, luchtfoto-WMTS als imagery layer over
  het DTM.
- Camera volgt de as op cabinehoogte (± 2,4 m boven railkop), yaw uit de
  tangens, roll uit de verkanting, plus gefilterde ruis voor draaistelbeweging.
- **Acceptatie:** 60 fps op een MacBook-klasse GPU bij 1,5 km zichtafstand; geen
  tile-pop in beeld binnen 200 m.

### P2 — Nabije veld, procedureel (3–4 dagen) — *hier zit het realisme*, **gebouwd**
- Rails (UIC 54-profiel), dwarsliggers en ballastbed geëxtrudeerd langs de as.
- Bovenleiding: portalen elke ~50 m, draagkabel + rijdraad met doorhang,
  sectie-isolatoren. Visueel het sterkste "dit is echt spoor"-signaal.
- Seinen, borden en snelheidsborden op OSM-posities (`railway=signal`).
- Perrons Centraal + Sloterdijk uit BGT-vlakken, met kap.
- Geluidsschermen en keerwanden langs de A10-strook uit BGT.
- **Acceptatie:** blinde vergelijking met een foto van hetzelfde punt — een
  spoorliefhebber moet de locatie kunnen benoemen.

### P3 — Trein en cabine (2 dagen) — **volgende stap**
- Cabine-interieur als voorgrondlaag: raamframe, ruitenwisser, dashboard met
  snelheidsmeter en ATB-lampjes, subtiele glasreflectie en vuil op de ruit.
- Houd de huisstijl **generiek** (geen NS-logo of exacte livery) tenzij je daar
  toestemming voor regelt; "SNG-achtig" mag, het merk niet.
- **Acceptatie:** de overlay verbergt precies de horizon-artefacten van de
  tileset — praktische truc: de cabine snijdt het slechtste beeld weg.

### P4 — Beweging, tijd en geluid (2 dagen) — *snelheidsprofiel gebouwd, geluid nog niet*
- Snelheidsprofiel uit de GTFS-tijden (`minutes_from_origin`) plus realistisch
  rijgedrag: optrekken ~0,6 m/s², remmen ~0,7 m/s², vmax 130 km/h, afgetopt op
  de boogsnelheid uit P0.
- Geluid: tractietoon gekoppeld aan snelheid, railstoten op lasafstand,
  wisselgeratel op OSM-wisselposities, luchtdruk bij stoppen, deurgong +
  halteomroep (TTS).
- Zonstand uit echte ephemeris voor de gekozen datum/tijd; een Nederlandse
  bewolkingsdefault (~0,6 cloud cover) staat realistischer dan felle zon.
- **Acceptatie:** rijtijd CS→Sloterdijk binnen 10 s van de echte sprinterrijtijd.

### P5 — Post-processing (1–2 dagen)
- TAA, lichte motion blur, bloom, chromatische aberratie, lens-vuil, filmgrain.
  Zonder dit ziet elke geodata-render eruit als een architectenmaquette.
- Optioneel de AI-laag: frames door een video-restyle (Mirage LSD real-time, of
  offline diffusie-upscale) om textuurdetail te verzinnen waar data ontbreekt.
  Alleen voor de *cinematic* variant — in de interactieve webversie kost dit te
  veel latency en geld.

### P6 — Integratie in TrainConnections (1 dag)
- Op de kaart: bij een geselecteerd pattern een knop **"Rijd dit traject"** op
  segmenten waarvoor een ride bestaat.
- Deep link `/ride?from=nl-amsterdam-centraal&to=nl-amsterdam-sloterdijk`.
- Ride-registry als JSON zodat er later trajecten bij kunnen; bij een onbekende
  combinatie netjes "nog niet beschikbaar".

**Totaal MVP: 13–15 werkdagen** voor CS → Sloterdijk. Doortrekken naar
Amsterdam Zuid daarna: + 4–6 dagen (langer traject, de Riekerpolder-boog, en de
Zuidasdok-bouwsituatie die in geen enkele dataset klopt).

---

## 7. Uitvoeringsplan spoor B (de sociale-media-render)

1. UE5-project + **Cesium for Unreal**, tileset = Google Photorealistic 3D Tiles
   (mooier op ground-level dan LoD 2.2) of PDOK als je licentievrij wil blijven.
2. Importeer de centerline uit P0 als spline; camera als Sequencer-track.
3. Zet de P2-assets erop — bovenleiding en rails zijn hier belangrijker dan in
   de webversie, want de camera kijkt scherper.
4. Lumen + volumetrische mist + echte zonstand; render 3840×2160 @ 60 fps,
   60–90 s, op een gehuurde GPU.
5. Optioneel een AI-pass over het resultaat (Veo/Kling als *stylist*, niet als
   generator; of Mirage LSD voor "zelfde rit, ander seizoen/andere wereld" —
   dat is meteen ook de leukste post: **één rit, vier werelden**).
6. Bronvermelding in beeld: "© Kadaster/PDOK CC BY 4.0 · © OpenStreetMap
   contributors". Bij Google-tiles moet de attributie zichtbaar blijven en mag
   je beeld niet offline cachen — een pre-render is daar een juridisch
   oplet-punt, dus PDOK is voor deze route de veiligere keuze.

---

## 8. Kosten en benodigdheden

| Post | Inschatting |
| --- | --- |
| PDOK 3D Basisvoorziening + luchtfoto + OSM | **€0**, CC BY 4.0 / ODbL, attributie verplicht |
| Google Photorealistic 3D Tiles | per root-tile-sessie; alleen nodig als PDOK-kwaliteit tekortschiet. Geen offline/derivative gebruik |
| GPU-huur voor UE5-render | ~$0,50–2,00/uur, reken op 5–15 uur → < $30 |
| Marble (World API) | ~$0,12 per draft-wereld — alleen voor spoor D |
| Veo 3.1 / Kling / Mirage LSD | per seconde video; reken tientjes voor een teaser |
| Genie 3 / Project Genie | vereist Google AI Ultra, VS-only → praktisch niet beschikbaar |
| Hosting | bestaande VPS, statisch achter Cloudflare Tunnel op `127.0.0.1:<port>` volgens de deployment-standaard |
| Eigen 360-opnames (optioneel) | camera + een dag lopen langs publiek toegankelijke punten. **Niet** het spoor op |

---

## 9. Risico's

| Risico | Kans | Mitigatie |
| --- | --- | --- |
| Nabije veld ziet er goedkoop uit → "dit is geen hyperrealisme" | hoog | besteed het grootste deel van de tijd aan P2 en P5, niet aan meer kilometers |
| Hoogteprofiel klopt niet (viaducten, hoge baan Sloterdijk) | hoog | handmatige correctie per kunstwerk, controleren tegen foto's |
| Tileset-gewicht maakt het onbruikbaar op mobiel | middel | corridor-clipping, LoD-limiet, en een "low"-modus zonder gebouwen buiten 400 m |
| Zuidasdok maakt Amsterdam Zuid binnen een jaar verouderd | zeker | begin bij Sloterdijk; datum in beeld ("situatie 2026") |
| Licentie-misstap (Google-tiles pre-renderen, NS-huisstijl, andermans cabinerit-video) | middel | PDOK als default, generieke livery, bronmateriaal alleen met licentie |
| Verwachting "AI maakt dit in een middag" | hoog | dit document: de AI-demo's zijn niet geo-echt; het echte werk is geodata + procedureel spoor |

---

## 10. Eerlijk antwoord op "is dit haalbaar?"

- **Een fotorealistische, geografisch kloppende, interactieve rit CS → Zuid,
  gebouwd door één persoon met AI-hulp?** Ja, binnen ~3 weken werk, met de
  kwaliteit van "heel goede geo-simulatie" — niet die van Train Sim World, en op
  sommige plekken zichtbaar onscherp in het nabije veld.
- **Een clip van 60 seconden die op sociale media doorgaat voor hyperrealisme?**
  Ja, binnen ~1 week (spoor B). Dat is de goedkoopste route naar "wauw".
- **"Prompt → speelbare hyperrealistische Amsterdam-rit" zoals de demo's
  suggereren?** Nee. Niet in 2026, niet geo-echt. Wie dat claimt toont je een
  wereld die niet bestaat.

**Voorgestelde eerste stap (1 dag spike):** P0 + P1 voor CS → Sloterdijk —
spoor-as uit OSM, PDOK-tilesets in een Cesium-view, camera over de as. Dan weet
je binnen één dag hoe het echte Amsterdam er vanaf railhoogte uitziet in deze
data, en pas daarna beslis je of het nabije veld (P2) de investering waard is.

---

## 11. Bronnen

- Genie 3: <https://deepmind.google/models/genie/> · Project Genie-uitrol:
  <https://9to5google.com/2026/01/29/google-project-genie/>
- Odyssey-2: <https://odyssey.systems/introducing-odyssey-2>
- Decart Mirage LSD: <https://platform.decart.ai/models/mirage-lsd>
- World Labs Marble: <https://www.worldlabs.ai/blog/marble-world-model> ·
  export: <https://docs.worldlabs.ai/marble/export/gaussian-splat/index>
- PDOK 3D Basisvoorziening:
  <https://www.pdok.nl/introductie/-/article/3d-basisvoorziening-1> ·
  productbeschrijving: <https://3d.kadaster.nl/productbeschrijving/> ·
  API: <https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections>
- 3DBAG bronnen: <https://docs.3dbag.nl/nl/overview/sources/>
- OSM-spoor NL uit ProRail:
  <https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_Netherlands>
- Google Photorealistic 3D Tiles:
  <https://developers.google.com/maps/documentation/tile/3d-tiles> ·
  policies: <https://developers.google.com/maps/documentation/tile/policies> ·
  Cesium: <https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/>
- openBVE: <https://openbve-project.net/>
- Lijn CS–Schiphol:
  <https://nl.wikipedia.org/wiki/Spoorlijn_Amsterdam_Centraal_-_Schiphol>
- Zuidasdok 2026:
  <https://zuidas.nl/en/blog/2026/01/06/major-zuidasdok-works-in-2026-and-how-they-will-affect-you/>
