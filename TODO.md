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

## Cockpit (2026-11-27)

- [x] **De LOOK-knoppen zijn stappen geworden** (2026-11-27)
  Je kon niet 60 of 90 graden naar rechts kijken en dat vasthouden: ingedrukt houden draaide door tot over je schouder, loslaten veerde terug. Nu is één klik 45 graden en blijft het hoofd daar staan, tot drie klikken; de andere knop loopt terug door nul heen. Shift+pijl en slepen met de rechtermuisknop blijven een blik die terugveert — naar waar het hoofd geparkeerd staat. Het glas zegt LOOK 90° R en dimt de kunsthorizon, dus een hoofd dat over de schouder blijft staan is aangekondigd.
- [x] **Spatie na een muisklik deed de knop in plaats van pauze** (2026-11-27)
  Een aangeklikte knop houdt de focus, en een knop met focus slikt de spatiebalk. Klik op Brake en de volgende spatie zette de rem aan in plaats van te pauzeren. De focus wordt nu teruggegeven na een muisklik (niet na een toetsenbordklik, want daar heeft hij hem nodig).
- [x] **De kaart loopt voor op het vliegtuig** (2026-11-27)
  Het vliegtuig stond in het midden, dus de helft van de kaart was waar je vandaan kwam. Het middelpunt schuift nu mee langs de koers tot het vliegtuig op ongeveer een kwart van onderen staat — tweemaal zoveel vooruit als achteruit — en dat schuift op met de snelheid, zodat je op de grond nog gewoon je eigen veld ziet. Slepen en de centreerknop werken zoals ze deden.
- [ ] **Vertrekken aan een gate** (gevraagd 2026-11-27)
  Nu start je altijd op de baan. De gegevens liggen er al: `taxi.js` haalt `aeroway=parking_position` en `gate` uit OpenStreetMap voor het veld waar je staat, en tekent er al een route naartoe. Wat ontbreekt is de andere kant op — een startplaats op een stand kiezen (in het startmenu, of `?start=EHAM&gate=B12`), het toestel daar met de neus naar buiten zetten, en een taxiroute van de stand naar de baan in plaats van omgekeerd.
- [x] **In de autopilot zelf een hoogte en een koers kiezen** (2026-11-27)
  De knop Autopilot opent nu een strip onder de bedieningsbalk met drie getallen — koers, hoogte, snelheid — die je kunt intikken of stappen, elk met een eigen knop HDG / ALT / SPD om die as over te geven. Een as die je niet armeert laat hij met rust: wings level, de hoogte die je hebt, stuwkracht voor de kruissnelheid. `P` armeert nog steeds alle drie op wat je op dat moment doet, NAV vliegt het plan, en een stevige ruk aan de stick neemt alles terug.

- [ ] **De autopilot-regel op het glas botst met de bedieningsbalk** (2026-11-27)
  `AUTOPILOT · 090° · 12000 ft` staat midden bovenaan op het glas (SVG 500,86) en op een breed scherm valt dat precies achter de rechterkant van de balk. Bestond al met de kortere tekst (`PAUSED` stond er ook half achter); met drie waardes erbij valt het meer op. Of de regel naar beneden, of de balk smaller.

- [ ] **Rondkijken ontbreekt op de telefoon** (2026-11-24)
  Shift+pijl, rechtermuisknop en de LOOK-knoppen in de strip werken; de strip is op een telefoon verborgen en in de touch-rij passen geen twee knoppen meer (zes van 108 px vanaf 96 px is al 794 van de 844). Een tweevingersleep op het stickvlak is de logische plek en is niet geschreven.
- [ ] **Taxiroute kent geen holding points en geen verkeer** (2026-11-24)
  De route gaat van de baan naar een stand en zegt niets over hold short, volgorde of ander verkeer. Er is hier geen ATC en dit is het niet.
- [ ] **Taxi: geen route zonder OSM-taxibanen** (2026-11-24)
  Bij een veld zonder `aeroway=taxiway` in OpenStreetMap zegt hij dat eerlijk en tekent niets. Een terugval op "rij rechtdoor van de baan af" is denkbaar.

## Naderen (2026-11-26)

- [x] **Glijpad zichtbaar zonder dat het arcade wordt** (2026-11-26)
  Een PAPI van vier lampen naast de drempel (ICAO-hoeken 3°30' 3°10' 2°50' 2°30', de steilste het dichtst bij het asfalt, dus twee rood twee wit is 3° zonder dat er een regel in de code staat die dat zegt), een gestreepte GP-lijn op de pitch-ladder waar je de flight path vector op zet, en een afwijkingsruit naast de hoogtemeterband op de echte ±0,7°-schaal. Geen ILS: OurAirports heeft nul localizers (11.008 bakens, alleen NDB/VOR/DME), en X-Plane's earth_nav.dat is GPL. Het is meetkunde naar een ingemeten drempel en heet daarom glijpad. `I` zet het uit, `?gp=0` start het uit. Meetkunde nagerekend in `npm run test:approach`.
- [x] **Drempelhoogte en verlichting staan nu in de index** (2026-11-27)
  Drie kolommen erbij in `scripts/build-airport-index.mjs`: `le_elevation_ft`, `he_elevation_ft` (12.525 van de 39.791 open banen hebben ze) en `lighted` (10.596 verlicht). Het glijpad mikt nu op de drempel waar je landt en niet meer op het veldgemiddelde, en de PAPI staat alleen nog bij verlichte banen — 186 van de 1080 Franse. Index opnieuw gebouwd: 29.460 velden, 4,2 MB. Gecontroleerd met `npm run test:approach` (33 beweringen) en in de applicatie op EDGS (verlicht, drempel 1961 ft) en LFQC (onverlicht, geen lampen).
- [x] **De baan onder de wielen liep door de getekende grond heen** (2026-11-27)
  Joris vertrok op EDGS Siegerland en reed het landschap in. `strip.js` legde een rechte lijn door de gemeten hoogtes, en het terreinmodel heeft daar een bult van drie meter over het midden van baan 13/31: je begon 3,7 m boven de getekende grond en sneed er halverwege 3,2 m in. De cockpit zit twee meter boven de wielen, dus midden op de baan kijk je vanuit de heuvel. Nu wordt elke 60 m bemonsterd en gefilterd (vijfpunts binomiaal, 240 m breed) in plaats van rechtgetrokken: de ruis eruit, de bult erin, wielen binnen 0,3 m van de getekende grond op alle 33 stations. Dat de bult van het model is en niet van de baan weten we nu zeker: de twee drempelhoogtes zeggen 645,0 → 635,0 m, kaarsrecht, en dat zijn precies de modelhoogtes aan de uiteinden.
- [ ] **Het plaatje is niet vlak, alleen de wielen** (2026-11-27)
  Bij een indexveld wordt niets getekend: je ziet de luchtfoto over het terreinmodel, en dat model heeft bulten waar een baan vlak is (EDGS: drie meter over 1,6 km). De wielen volgen nu het model, dus je zakt er niet meer in, maar de baan die je ziet golft wel. Het echte antwoord is de bol opensnijden en er een platform in leggen zoals bij de negen gebouwde velden — alleen is er voor 29.460 velden geen foto om erop te leggen en liggen duizenden OurAirports-lijnen tientallen meters naast het asfalt, dus een grijze plaat zou er vaker naast liggen dan erop. Pas zinvol voor velden waarvan de lijn is ingemeten.
- [ ] **42 Franse velden zijn bij OurAirports verschoven** (2026-11-27)
  De herbouw van de index (6 nov → 27 nov) verplaatst de eerste baan van 3323 velden meer dan 20 m, waarvan 42 Franse. Grote: LFCZ Mimizan 771 m, LFIG Cassagnes 581, LFFL Bailleau 411, LFYS Ste Léocadie 378, LFJL Metz-Nancy 347. Veel ervan zijn velden die vroeger alleen een baannummer hadden en nu echte coördinaten — dus waarschijnlijk beter — maar de controleronde van 24 november keek naar de oude lijnen. Opnieuw door de meetmachine halen; LFFI Ancenis (153 m) en LFQC Lunéville (41 m) staan toch al op de lijst.
- [ ] **OurAirports publiceert een ware koers en wij gebruiken het baannummer** (2026-11-27)
  `le_heading_degT` staat op 14.399 van de 39.791 banen. De velden zonder eindcoördinaten worden nu om het veldpunt gelegd op het baannummer maal tien — een magnetische koers, afgerond op tien graden, getekend als een ware. Met die kolom erbij is dat voor een derde van de banen niet meer nodig.
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
- [x] **De vier Franse velden zijn opgelost, drie door OurAirports zelf** (2026-11-27)
  LFFI Ancenis, LFQC Lunéville-Croismare, LFOX Étampes-Mondésir en LFCN Nogaro. Bij de herbouw van de index bleken Ancenis (153 m verschoven) en Lunéville (41 m) upstream verbeterd, en Étampes en Nogaro lagen al goed; de verhardingsfit over de hele lijn geeft nu 2,0 / 0,9 / 0,5 / 1,1 m uit het midden, bij baanbreedtes van 24,5 / 18,4 / 35,1 / 14,0 m. De gevonden lijnen van de zoeker waren bij alle vier de verkeerde: bij Ancenis de N23, bij Étampes de spoorlijn.
- [x] **LFCH Arcachon-La Teste ingemeten** (2026-11-27)
  Geen van beide gepubliceerde lijnen ligt op het asfalt; die van 07L loopt er 267 m naast en voorbij de drempel door tot bij de rotonde. Het asfalt is één strook, gevonden met de zoeker (score 0,12 → 0,93) en daarna station voor station over de breedte gefit: 18,9 m breed tegen 23 opgegeven, 1346 m gecentreerd op de verharding, met de keerplaatsen voorbij beide einden. Staat in `MEASURED`. De grasbaan 07R/25L blijft zoals het record hem heeft.
- [ ] **Dezelfde ronde voor Duitsland en de Lage Landen?** (idee 2026-11-23)
  De methode werkt overal waar we een orthofoto hebben. Spanje leverde 12 fouten op 137 velden, Portugal 7 op 44, Frankrijk 13 op 390.
