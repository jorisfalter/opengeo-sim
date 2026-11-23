# TODO

Open punten van dit project. Klaar = weg of afgevinkt met datum.

## Overgenomen uit Mission Control (2026-11-13)

- [ ] **BKG DOP20: gratis registratie voor heel Duitsland in één laag?** (wacht op Joris, sinds 2026-11-10)
  Gemeten 2026-11-10: 14 van de 16 Bundeslaender leveren open orthofoto zonder sleutel (NRW 10cm, BY 40cm, rest 20cm), maar dat zijn 14 WMS-lagen met 14 rechthoeken en 14 attributieregels, en WMS herprojecteert per aanvraag zonder tegelcache. BKG's landelijke wms_dop/wmts_dop antwoordt 403 op zowel sgx. als sg.geodatenzentrum.de; een gratis registratie bij gdz.bkg.bund.de geeft naar verluidt een token in het URL-pad en dan is het EEN uniforme 20cm-laag voor heel Duitsland. Joris beslist: registreren (sneller, netter, maar een sleutel in de frontend-URL) of 14 losse diensten. Zie docs/scenery-sources.md.
- [ ] **Dataforsyningen-token voor Denemarken (gratis)** (wacht op Joris, sinds 2026-11-10)
  api.dataforsyningen.dk levert capabilities maar antwoordt 403 op GetMap: orto_foraar vereist een gratis token van dataforsyningen.dk. Alleen nodig als Denemarken in de dekking moet. Lage prioriteit.

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
