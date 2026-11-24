# TODO

Open punten van dit project. Klaar = weg of afgevinkt met datum.

## Overgenomen uit Mission Control (2026-11-13)

- [ ] **BKG DOP20: gratis registratie voor heel Duitsland in één laag?** (wacht op Joris, sinds 2026-11-10)
  Gemeten 2026-11-10: 14 van de 16 Bundeslaender leveren open orthofoto zonder sleutel (NRW 10cm, BY 40cm, rest 20cm), maar dat zijn 14 WMS-lagen met 14 rechthoeken en 14 attributieregels, en WMS herprojecteert per aanvraag zonder tegelcache. BKG's landelijke wms_dop/wmts_dop antwoordt 403 op zowel sgx. als sg.geodatenzentrum.de; een gratis registratie bij gdz.bkg.bund.de geeft naar verluidt een token in het URL-pad en dan is het EEN uniforme 20cm-laag voor heel Duitsland. Joris beslist: registreren (sneller, netter, maar een sleutel in de frontend-URL) of 14 losse diensten. Zie docs/scenery-sources.md.
- [ ] **Dataforsyningen-token voor Denemarken (gratis)** (wacht op Joris, sinds 2026-11-10)
  api.dataforsyningen.dk levert capabilities maar antwoordt 403 op GetMap: orto_foraar vereist een gratis token van dataforsyningen.dk. Alleen nodig als Denemarken in de dekking moet. Lage prioriteit.

## Cockpit (2026-11-24)

- [ ] **Rondkijken ontbreekt op de telefoon** (2026-11-24)
  Shift+pijl, rechtermuisknop en de LOOK-knoppen in de strip werken; de strip is op een telefoon verborgen en in de touch-rij passen geen twee knoppen meer (zes van 108 px vanaf 96 px is al 794 van de 844). Een tweevingersleep op het stickvlak is de logische plek en is niet geschreven.
- [ ] **Taxiroute kent geen holding points en geen verkeer** (2026-11-24)
  De route gaat van de baan naar een stand en zegt niets over hold short, volgorde of ander verkeer. Er is hier geen ATC en dit is het niet.
- [ ] **Taxi: geen route zonder OSM-taxibanen** (2026-11-24)
  Bij een veld zonder `aeroway=taxiway` in OpenStreetMap zegt hij dat eerlijk en tekent niets. Een terugval op "rij rechtdoor van de baan af" is denkbaar.

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
- [ ] **Dezelfde ronde voor Frankrijk, Duitsland, de Lage Landen?** (idee 2026-11-23)
  De methode uit de Spaanse ronde (zoeken + met het oog nalopen op contactvellen) werkt overal waar we een orthofoto hebben. Spanje leverde 12 fouten op 137 velden; LFMA was al eerder zo'n geval in Frankrijk.
