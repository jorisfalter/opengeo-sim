# TODO

Open punten van dit project. Klaar = weg of afgevinkt met datum.

## Overgenomen uit Mission Control (2026-11-13)

- [ ] **BKG DOP20: gratis registratie voor heel Duitsland in één laag?** (wacht op Joris, sinds 2026-11-10)
  Gemeten 2026-11-10: 14 van de 16 Bundeslaender leveren open orthofoto zonder sleutel (NRW 10cm, BY 40cm, rest 20cm), maar dat zijn 14 WMS-lagen met 14 rechthoeken en 14 attributieregels, en WMS herprojecteert per aanvraag zonder tegelcache. BKG's landelijke wms_dop/wmts_dop antwoordt 403 op zowel sgx. als sg.geodatenzentrum.de; een gratis registratie bij gdz.bkg.bund.de geeft naar verluidt een token in het URL-pad en dan is het EEN uniforme 20cm-laag voor heel Duitsland. Joris beslist: registreren (sneller, netter, maar een sleutel in de frontend-URL) of 14 losse diensten. Zie docs/scenery-sources.md.
- [ ] **Dataforsyningen-token voor Denemarken (gratis)** (wacht op Joris, sinds 2026-11-10)
  api.dataforsyningen.dk levert capabilities maar antwoordt 403 op GetMap: orto_foraar vereist een gratis token van dataforsyningen.dk. Alleen nodig als Denemarken in de dekking moet. Lage prioriteit.
