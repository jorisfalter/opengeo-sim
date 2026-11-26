# TODO

Open punten van dit project. Klaar = weg of afgevinkt met datum.

## Overgenomen uit Mission Control (2026-11-13)

- [ ] **BKG DOP20: gratis registratie voor heel Duitsland in één laag?** (wacht op Joris, sinds 2026-11-10)
  Gemeten 2026-11-10: 14 van de 16 Bundeslaender leveren open orthofoto zonder sleutel (NRW 10cm, BY 40cm, rest 20cm), maar dat zijn 14 WMS-lagen met 14 rechthoeken en 14 attributieregels, en WMS herprojecteert per aanvraag zonder tegelcache. BKG's landelijke wms_dop/wmts_dop antwoordt 403 op zowel sgx. als sg.geodatenzentrum.de; een gratis registratie bij gdz.bkg.bund.de geeft naar verluidt een token in het URL-pad en dan is het EEN uniforme 20cm-laag voor heel Duitsland. Joris beslist: registreren (sneller, netter, maar een sleutel in de frontend-URL) of 14 losse diensten. Zie docs/scenery-sources.md.
- [ ] **Dataforsyningen-token voor Denemarken (gratis)** (wacht op Joris, sinds 2026-11-10)
  api.dataforsyningen.dk levert capabilities maar antwoordt 403 op GetMap: orto_foraar vereist een gratis token van dataforsyningen.dk. Alleen nodig als Denemarken in de dekking moet. Lage prioriteit.

## Cockpit (2026-11-24)

- [x] **Shift bleef hangen en legde de besturing plat** (2026-11-25)
  Na Cmd+Shift+4 (schermfoto) komt de keyup van shift nooit aan; de pagina dacht daarna voor altijd dat shift ingedrukt was, de pijltjes gingen naar het hoofd en in assisted law bleef het toestel in zijn stand hangen. Modifiers worden nu uit het event gelezen en shift alleen pakt de stick niet meer af.
- [ ] **De "scherpe foto"-dobbelsteen is ruimer dan de diensten** (2026-11-25)
  De zes rechthoeken in `COVERED` (start.js) lopen over landen heen waar geen eigen luchtfoto is: Wallonie, Luxemburg, Noord-Italie, delen van Duitsland buiten de dertien DOP-diensten. Een worp kan daar landen en dan krijg je Sentinel-2 op 10 m. EBBE Beauvechain kwam zo boven bij de controle. Te meten op dezelfde manier als de censuurtest: welke velden krijgen uberhaupt een eigen luchtfoto?

- [ ] **Rondkijken ontbreekt op de telefoon** (2026-11-24)
  Shift+pijl, rechtermuisknop en de LOOK-knoppen in de strip werken; de strip is op een telefoon verborgen en in de touch-rij passen geen twee knoppen meer (zes van 108 px vanaf 96 px is al 794 van de 844). Een tweevingersleep op het stickvlak is de logische plek en is niet geschreven.
- [ ] **Taxiroute kent geen holding points en geen verkeer** (2026-11-24)
  De route gaat van de baan naar een stand en zegt niets over hold short, volgorde of ander verkeer. Er is hier geen ATC en dit is het niet.
- [ ] **Taxi: geen route zonder OSM-taxibanen** (2026-11-24)
  Bij een veld zonder `aeroway=taxiway` in OpenStreetMap zegt hij dat eerlijk en tekent niets. Een terugval op "rij rechtdoor van de baan af" is denkbaar.

## Naderen (2026-11-26)

- [x] **Glijpad zichtbaar zonder dat het arcade wordt** (2026-11-26)
  Een PAPI van vier lampen naast de drempel (ICAO-hoeken 3°30' 3°10' 2°50' 2°30', de steilste het dichtst bij het asfalt, dus twee rood twee wit is 3° zonder dat er een regel in de code staat die dat zegt), een gestreepte GP-lijn op de pitch-ladder waar je de flight path vector op zet, en een afwijkingsruit naast de hoogtemeterband op de echte ±0,7°-schaal. Geen ILS: OurAirports heeft nul localizers (11.008 bakens, alleen NDB/VOR/DME), en X-Plane's earth_nav.dat is GPL. Het is meetkunde naar een ingemeten drempel en heet daarom glijpad. `I` zet het uit, `?gp=0` start het uit. Meetkunde nagerekend in `npm run test:approach`.
- [ ] **Het pad rekent met de veldhoogte, niet met de drempelhoogte** (2026-11-26)
  `runways.csv` van OurAirports heeft `le_elevation_ft` en `he_elevation_ft` per baaneinde; de index bewaart ze niet, dus het glijpad gebruikt de hoogte van het veld. Op een vlak veld is dat een paar voet. Op Courchevel (18,6% helling) scheelt het tientallen meters en is het pad dus fout. Toevoegen in `scripts/build-airport-index.mjs` en in `loadAirports`, en dan de index opnieuw bouwen — die stap raakt alle 17.000 velden, dus hij verdient zijn eigen ronde. Hetzelfde geldt voor waar de lampen staan: die krijgen hun hoogte van het 30 m-DEM en niet van de ingemeten baan, dus op de negen gebouwde velden kunnen ze een paar meter zweven of wegzakken.
- [ ] **De PAPI staat bij elk veld, ook waar er geen is** (2026-11-26)
  OurAirports weet niet welke banen een PAPI hebben; het weet alleen of een baan verlicht is (`lighted`, 12.398 van de 49.908 banen) en ook dat bewaart de index niet. Nu krijgt elke baan vier lampen. Eerlijker zou zijn: alleen bij verlichte banen, en dat is één kolom in de bouwstap.
- [ ] **Geen baan- of naderingsverlichting** (2026-11-26)
  De PAPI is er; de middenlijn, de drempelbalk en de randlichten zijn er niet. In de schemering is dat het verschil tussen een baan en een grijze streep. Zelfde machinerie als de PAPI (punt-primitieven uit de ingemeten lijn), meer lampen.

## Verenigd Koninkrijk (2026-11-26)

- [x] **Gebouwen van Londen** (2026-11-26) Heathrow, de City met Westminster en Canary Wharf, 17.553 gebouwen uit OSM. De bouwer sorteert nu op volume in plaats van grondvlak, zodat de limiet van 6000 de torens houdt en niet de stations.
- [ ] **Geen open luchtfoto van Groot-Brittannie** (2026-11-26)
  OS vereist een sleutel (401), en APGB (Getmapping/Bluesky) is geen open data — de metadata van Natural Resources Wales zegt dat de licentie het tot intern overheidsgebruik beperkt. Boven Engeland dus Sentinel-2 op 10 m. Als er ooit een open bron komt: de machinerie staat klaar, het is een laag in providers.js.

## Portugal

- [x] **Alle 44 vastelandvelden nagelopen op de DGT-luchtfoto van 2018** (2026-11-24)
  Zeven banen lagen naast hun asfalt en zijn opnieuw ingemeten: LPAV (536 m), LPCO (246), LPVL (177), LPIN (155), LP77 (108 m en 8,2°), LPSO (59 m en 5,0°), LPVR (51). Staan in `MEASURED` in src/fly/airports.js.
- [ ] **LPMI Mirandela: de lijn loopt over de oostrand van het asfalt** (2026-11-24)
  Ongeveer tien meter naast de middenstreep van een baan van twintig meter breed, met een graad koersfout. Je staat op de verharding maar niet in het midden. De zoeker vond hier een weg (586 m) en is dus geen hulp; met de hand inmeten.
- [ ] **Madeira en de Azoren hebben geen orthofoto** (2026-11-24)
  DGT's dekking is het vasteland. Elf Portugese velden liggen buiten de foto en zijn niet gecontroleerd. Madeira heeft eigen orthofoto's 1:2000 van 2018-19 in de SNIG-catalogus; dat is wat er te proberen valt.
- [ ] **De vlieglaag is van 2018** (2026-11-24)
  Bij Ponte de Sor (LPSO) is de baan op de foto nog een bouwput; die is op de satellietlaag van 2023 ingemeten. Waar nog meer na 2018 gebouwd is, is niet nagegaan. De satellietlaag `ortoSat2023-CorVerdadeira` op geo.dgterritorio.gov.pt is het alternatief: actueler, 30 cm, zachter.

## Spanje

- [x] **Alle 137 Spaanse velden nagelopen op de PNOA-foto** (2026-11-23)
  Twaalf banen lagen naast hun asfalt en zijn opnieuw ingemeten op zoom 18: LECT, LEBE, LEMR, LECD, LETI, ES-0219, ES-0069, LEGY, LEOC, LECF, ES-0088, LERE (plus LERO eerder die dag). Staan in `MEASURED` in src/fly/airports.js. Alle grote luchthavens klopten al.
- [ ] **Twee Spaanse velden blijven open** (2026-11-23)
  LEMP Los Martínez del Puerto: de lijn van OurAirports ligt nergens op, maar de enige kandidaat-strook loopt 170 voor een baan die 15 heet. ES-0167 La Llosa: ULM-strip in een moeras, de helft van de lijn ligt in het water en het droge deel is 280 m tegen 350 opgegeven. Niet gokken; met de hand inmeten als iemand daar wil vliegen.
- [ ] **Alleen de eerste baan per veld is gecontroleerd** (2026-11-23)
  Dat is de baan waar `?start=` je op zet. De 24 tweede banen in Spanje worden alleen op de kaart getekend en zijn niet nagelopen.
- [ ] **DEM-vlakheidstest als algemene controle?** (idee 2026-11-23)
  Een baan is vlak, dus een lijn over een helling ligt niet op een baan. Gemeten op Terrarium: LECT's foute lijn 73,9 m spreiding tegen 16 m voor de echte; maar LERO's foute lijn 11,9 m tegen 9,7 m voor de echte en Burgos' goede lijn 12,2 m. Vangt dus alleen de grove gevallen. Zou in de bouwstap kunnen draaien over de 1368 velden waarvan het vliegveldpunt meer dan 150 m van de baan ligt.
- [x] **Dezelfde ronde voor Frankrijk** (2026-11-26)
  390 velden met minstens 450 m baan: 151 die de dobbelsteen kan aanbieden, 239 die hij niet aanbiedt. Tien banen lagen naast hun asfalt en zijn opnieuw ingemeten (LFCC, LFCW, LFDA, LFGK, LFED, LFAV, LFCS, LFYG, LFEQ, LFCF), bovenop LFNH, LFKJ en LFKT eerder die week. De automatische regel alleen deugt hier niet: bij kleine grasvelden grijpt de zoeker een snelweg of een grindgat, dus alles is met het oog nagelopen en bij de tien is de drempel op 20 cm per pixel gecontroleerd.
- [ ] **De kleine verschuivingen in de tweede Franse ronde** (2026-11-26)
  Van de 239 velden die de dobbelsteen niet aanbiedt zijn alleen de kandidaten met 150 m of meer verschuiving met het oog nagelopen. Zestien met minder dan 150 m staan nog open; op een baan van 900 m is dat nog altijd het verschil tussen asfalt en gras. Lijst: `decide.py fr2-results.jsonl`, kop "corrigeren".
- [ ] **Vier Franse velden blijven open** (2026-11-26)
  LFFI Ancenis (zowel de oude lijn als de gevonden lijn ligt naast de baan; de gevonden lijn ligt op de N23), LFQC Lunéville-Croismare (de randstreepfit komt op de zuidrand uit, een halve baanbreedte naast het midden), LFOX Étampes-Mondésir en LFCN Nogaro (geen randstrepen, de zoeker vindt niets bruikbaars). Met de hand inmeten zoals Corte.
- [ ] **LFCH Arcachon-La Teste heeft twee parallelle banen** (2026-11-26)
  07L/25R verhard en 07R/25L gras. Welke van de twee de lijn van OurAirports beschrijft is uit de foto niet zeker; niet aangeraakt.
- [ ] **Dezelfde ronde voor Duitsland en de Lage Landen?** (idee 2026-11-23)
  De methode werkt overal waar we een orthofoto hebben. Spanje leverde 12 fouten op 137 velden, Portugal 7 op 44, Frankrijk 13 op 390.
