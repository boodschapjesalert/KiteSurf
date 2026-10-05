# Testing

## Uitvoeren

```bash
npm test
```

Gebruikt Node's ingebouwde test runner (`node --test`, Node ≥ 18) — geen dependencies nodig.

## Resultaat (laatste run)

```
tests 323
suites 89
pass 323
fail 0
```

(26 sep 2026: +22 tests in `test/logica/appApi.test.js` voor de Android-app-API, zie
"Android-app" hieronder.)

(Was 227 — `meldingLogica.js`'s `bepaalMeldingOverzicht` en zijn tests zijn verwijderd toen de
directe alert overging op de score/kleur-berekening in plaats van een eigen `meldingDrempel`, zie
README.md "Meldingen"; `voldoetAanMeldingDrempel`/`vindEersteMatchendUur` zijn ook weg, want die
werden uitsluitend door de oude alert-toets gebruikt. Ervoor in de plaats kwamen nieuwe tests voor
`berekenLangdurigeRegenVlaggen`, `normaliseerGewichten`/`valideerScoreGewichten` (nu open-set i.p.v.
aangevuld tot een vaste zes, zie hieronder) en de facultatief-dubbeltelling-uitsluiting.)

Coverage (`node --test --experimental-test-coverage`), over `src/logica/` (het deel dat zonder
een live GAS-omgeving testbaar is):

| Bestand | Regels | Branches | Functies |
|---|---|---|---|
| bronnenMiddeling.js | 100.00% | 81.25% | 100.00% |
| bronParsers.js | 100.00% | 76.27% | 92.68% |
| dagSamenvatting.js | 100.00% | 77.78% | 100.00% |
| drempelwaarden.js | 96.43% | 83.33% | 100.00% |
| eenheden.js | 100.00% | 94.74% | 100.00% |
| forecastSamenstellen.js | 97.83% | 85.07% | 100.00% |
| profielValidatie.js | 100.00% | 93.75% | 96.15% |
| rwsGetij.js | 100.00% | 81.82% | 88.89% |
| scoreBerekening.js | 100.00% | 81.58% | 100.00% |
| telegramFormat.js | 100.00% | 91.30% | 100.00% |
| appApi.js | 99.27% | 82.29% | 100.00% |
| **Totaal** | **99.27%** | **83.79%** | **97.25%** |

\* `bronParsers.js` telt losse export-references als functies; alle *gebruikte* parsers hebben
minstens één test met een echte fixture.

## Telegram: één chat, één profiel

- **`telegramKoppeling.js`** (`test/logica/telegramKoppeling.test.js`): keuze van de zender per chat
  (index, verouderde/ontbrekende index, getal- vs. string-chat-ID), behoud van server-velden bij
  opslaan, herkennen van `/stop`.
- **De echte `dist/*.gs` in Node met nagebootste Drive/Properties/Telegram** (eenmalig script, niet
  in de repo): het gebruikersrapport nagespeeld — twee profielen aan één chat, de samenvatting uit in
  het ene en aan in het andere. Met de oude code komen de berichten van het andere profiel (bug
  gereproduceerd), met de nieuwe niet meer en wordt dat profiel ontkoppeld. Ook: een enkel gekoppeld
  profiel stuurt nog gewoon (met `/stop` in het slotbericht), een verouderd tabblad zet de koppeling
  niet terug, koppelen via deep link ontkoppelt alle andere profielen, `/stop` ontkoppelt alles en
  een los bericht daarna maakt geen profiel aan, en een herkansing na afmelden stuurt niets.

## Android-app

- **`appApi.js`** (`test/logica/appApi.test.js`): routering/validatie van app-verzoeken (onbekende
  actie, ontbrekend profiel, ongeldige locatie), `vergelijk` met een haperende locatie, en
  `bepaalAppMeldingen`: samenvatting op/voor/ruim na het gekozen tijdstip, niet afvinken als
  ophalen overal mislukte; alert voor een nieuwe groene dag, geen herhaling na tussentijds
  terugzakken, nachtrust (uitgesteld, niet gemist), opschonen van verleden datums, historie
  ongewijzigd bij een mislukte locatie, en "meldingen uit" laat de status ongemoeid.
- **Android-unittests** (`android/app/src/test`, `./gradlew testReleaseUnitTest`): de HTTP-route
  POST → 302 → GET van `KiteweerHttp` tegen een lokale mini-server, foutcodes, en de nachtrust-grens
  van de achtergrondtaak. `./gradlew lintRelease`: 0 fouten.
- **End-to-end tegen de échte weerbronnen** met `tools/gas-dev-server.js` (dist/*.gs in Node):
  alle vijf acties via `POST /exec`, en de app-front-end (www/) in Chromium (Playwright): eerste
  start → welkomstkaart → instellingen invullen/opslaan (profiel in lokale opslag) → locatie zoeken
  en toevoegen → vergelijken → herladen (profiel blijft) — zonder JavaScript-fouten. De webapp-
  variant van `JavaScript.html` (met een nagebootste `google.script.run`) toont ongewijzigd de
  bewaar-link, de Telegram-koppeling en de Tasker-widget-uitleg.
- **Live Apps Script** (curl): POST naar /exec geeft een 302 met `Access-Control-Allow-Origin: *`,
  de GET daarna 200 + JSON met dezelfde header — de route die de WebView (fetch) en de widget
  (`KiteweerHttp`) volgen.
- **Niet getest (geen emulator/KVM beschikbaar):** de app op een echt toestel — widget-weergave,
  meldingen, toestemmingsdialoog en WorkManager-timing. Zie SETUP.md stap 6 voor de handmatige
  controle.

## Wat is getest

- **`drempelwaarden.js`** — elke evaluatiefunctie, inclusief grenswaarden en de
  no-go/waarschuwing/ok-overgangen.
- **`bronnenMiddeling.js`** — middeling van 1/2/3+ bronnen, uitschieter-detectie, en ontbrekende
  bronnen (niet als 0 meegeteld).
- **`bronParsers.js`** — geparsed tegen **echte responses**, live opgehaald tijdens de bouw van
  Open-Meteo Forecast, Open-Meteo Marine, Buienradar JSON-feed en Buienradar raintext, plus een
  lege-forecast edge case en een best-effort Weerlive-fixture (ongeverifieerd, zie README.md).
  `parseWindfinderForecast`/`ontrafelWindfinderTuple` zijn getest tegen een echte, opgeslagen
  Windfinder-paginabron (Rockanje), inclusief het geen-match- en kapotte-JSON-scenario.
  `parseRwsWindVerwachting`/`parseRwsWindMeting` zijn getest tegen echte RWS-responses
  (WINDSHD/WINDRTG, Hoek van Holland), inclusief het koppelen van windsnelheid en -richting op
  exact tijdstip (twee losse API-calls, dus niet zomaar index-voor-index uit te lijnen).
  `parseOpenMeteoForecast`s `dagInfo` (zonsopgang/-ondergang, apart dag-niveau veld naast de
  uurlijkse reeks) is getest zowel tegen een oudere fixture zonder dat veld (geeft lege reeksen,
  geen crash) als een expliciete inline-fixture mét `daily`.
- **`rwsGetij.js`** — geparsed tegen een echte Rijkswaterstaat-respons (Hoek van Holland,
  nieuwe `ddapi20-waterwebservices`-API), inclusief het kiezen van ProcesType "verwachting" met
  terugval op "astronomisch", en de hoog/laag-classificatieheuristiek.
- **`forecastSamenstellen.js`** — het combineren van Open-Meteo (tijdlijn) met Buienradar/
  Weerlive (alleen op het "nu"-uur) en RWS-getij (dichtstbijzijnde meting binnen een uur, incl. de
  ruwe waterstand in cm naast de hoog/laag-classificatie), het groeperen per kalenderdag,
  `windBronnenVanDag` (de unieke, daadwerkelijk gebruikte wind-databronnen over de uren van één
  dag — union bij verschillende bronnen per uur, lege lijst zonder crash), en `zonInfoVoorDatum`
  (zonsopgang/-ondergang per dag opzoeken, inclusief onbekende datum/ontbrekende dagInfo zonder
  crash).
- **`eenheden.js`** — naast de eenheid-conversies ook `windrichtingKompas` (graden naar
  16-punts kompaslabel, inclusief de 0/360-wikkel).
- **`scoreBerekening.js`** — uur- en dagscore, inclusief dat elke essentiële no-go de rest
  overrulet, dat nice-to-haves de score beïnvloeden zonder ooit een no-go te veroorzaken, en dat
  elk uurresultaat de rauwe wind-, getij- én weerwaarden (`ruw`, incl. `getijStatus`/
  `waterstandCm`/`neerslagMm`) meekrijgt voor een directe weergave los van de voorkeur-relatieve
  evaluatie. Plus `vindBesteVenster` (de minimale-sessieduur-logica): dat een blok met het hoogste
  *gemiddelde* wint i.p.v. de hoogste losse piek, dat blokken met een no-go-uur worden
  overgeslagen, en dat een dag met alleen één goed uur `geenSessieMogelijk: true` krijgt i.p.v.
  een groene score.
- **`dagSamenvatting.js`** — de leesbare dagzin: windtrend na het venster (af/toe/gelijk, met een
  bewuste 2-knopen-marge zodat een verwaarloosbaar verschil geen "het neemt af" oplevert), het
  "geen sessie lang genoeg"-geval, en lege/ontbrekende data zonder crash. Plus de regenzin met
  begin- én eindtijd: dat aaneengesloten regenuren tot één bui worden samengevoegd, dat een droge
  tussenperiode de bui juist opsplitst (anders zou "tussen 09:00 en 18:00" een dag onterecht
  afschrijven), de drie formuleringen (één bui / twee buien / "met onderbrekingen" bij drie of
  meer), en dat motregen onder 0.2 mm genegeerd wordt.
- **`src/logica/meldingLogica.js` bestaat niet meer.** Bevatte de expliciete meldingsregel
  (minimale windkracht + richting-bereik, `meldingDrempel`) die ooit zowel de dagelijkse
  samenvatting als de directe alert toetsten. Nu beide meldingsvormen op dezelfde
  score/kleur-berekening draaien als de webapp-kaarten (zie README.md "Meldingen") was dat bestand
  — en zijn tests — volledig ongebruikt; verwijderd i.p.v. dode code te laten staan.
- **`telegramFormat.js`** — elke tekstformatter los (wind/weer/getij/zonsondergang-badge als
  platte tekst, kleur-emoji, Nederlandse datumnotatie via handmatige dag-/maandnaam-arrays i.p.v.
  `toLocaleDateString`/`Utilities.formatDate` met `EEE`/`MMM` — dat is locale-afhankelijk en dit
  project stelt de Apps Script-locale nergens expliciet in), en `formatDagBalkTekst` end-to-end:
  bevat kleur, locatie, dag-label, datum, verdict, score en de samenvattingszin, en een dag zonder
  `besteUur` (harde no-go) crasht niet en laat de detailregel gewoon weg.
- **`scoreBerekening.berekenLangdurigeRegenVlaggen`** — drie aaneengesloten natte uren worden alle
  drie gevlagd, twee (korter dan de ingestelde drempel) niet, een droog uur breekt de reeks af (ook
  als het erna weer gaat regenen), en regen onder de mm-drempel telt niet mee als "nat".
- **`normaliseerGewichten`/`valideerScoreGewichten` (open set)** — geeft precies de meegegeven,
  geldige sleutels terug (niet langer aangevuld tot een vaste zes: een niet-meegegeven criterium
  telt simpelweg niet mee), negeert onbekende sleutels en ongeldige/negatieve waarden, en valt in
  zijn geheel terug op de standaard-GEWICHTEN als er na filtering niets geldigs overblijft (leeg,
  alleen onbekende sleutels, of alles ongeldig) — dat gold al voor "alles op 0", nu ook voor deze
  bredere set gevallen.
- **Facultatieve subcriteria individueel kiesbaar, zonder dubbeltelling** — een individueel gekozen
  facultatieve variabele (bv. "Zicht" met een eigen gewicht) telt aantoonbaar zwaarder mee dan
  wanneer hij alleen impliciet in het "Facultatief"-gemiddelde zit (twee scores met en zonder aparte
  weging vergeleken, de score met apart gewicht ligt lager bij een slecht zicht). Ook gecontroleerd
  dat het geheel niet crasht (geen NaN door een lege-array-deling-door-0) als alle vier de
  facultatieve subcriteria tegelijk apart zijn gekozen — dan draagt "Facultatief" zelf terecht 0 bij.
- **`berekenUurScore` met instelbare gewichten** — gewichten die niet op 1 optellen geven toch een
  score op de 0-10-schaal (de normalisatie deelt door de daadwerkelijke som), een criterium op
  gewicht 0 telt niet meer mee, en zonder expliciete gewichten is het resultaat identiek aan met de
  standaard `GEWICHTEN` meegegeven — dus de bestaande, ongewijzigde profielen zien geen
  gedragsverandering.
- **`profielValidatie.js`** — defaults aanvullen (incl. de standaard-favorieten Rockanje/
  Maasvlakte en databronnen-instellingen), onbekende velden negeren, een bewust leeggemaakte
  favorieten-lijst niet opnieuw aanvullen, ongeldige locaties afwijzen zonder het hele profiel te
  breken, `telegramChatId`/`dagvenster` passthrough, `valideerDagvenster` (start/eind uur
  clampen naar 0-23, terugval op de 07-21-default bij ontbrekende/ongeldige waarden), en
  `valideerMeldingen` (de twee onafhankelijke meldingsvormen, `samenvattingUur` clampen naar
  0-23 en `samenvattingMinuut` naar 0-59 — met dezelfde `Number(null) === 0`-valkuil, en dat `laatstGemeld` — een dynamische locatie-id-sleutel/waarde-kaart — behouden blijft
  i.p.v. leeggeveegd door een leeg standaardobject), en `valideerDagenVooruit` (de
  voorspellingshorizon clampen naar 1-10, inclusief de `Number(null) === 0`-valkuil: null moet
  expliciet als "ontbrekend" behandeld worden, niet als de geldige waarde 0), en
  `valideerMinimaleSessieUren` (clampen naar 1-8 met dezelfde null-valkuil).
- **`inGradenBereik` volledige-cirkel-bug** (`drempelwaarden.js`) — een windrichting-bereik van
  `[0, 360]` ("alle richtingen", wat je via het toevoeg-formulier zo kunt invullen) normaliseerde
  naar start=0/eind=0 en accepteerde dáárdoor alléén exact 0°, precies het tegenovergestelde van
  de bedoeling. Gevonden doordat een testfixture met `[0,360]` onverwacht als no-go uitkwam;
  opgelost met een expliciete volle-cirkel-check en vastgelegd in een regressietest.
- **`test/integratie.test.js`** — de volledige keten van rauwe bron-fixtures tot een dagoordeel
  per dag, plus dezelfde keten met ontbrekende bronnen en met een volledig lege forecast.

## Wat NIET zonder live GAS-omgeving getest kon worden

- **`src/gas/*.gs`** — alles wat `UrlFetchApp`, `DriveApp`, `PropertiesService`, `CacheService`
  of `ScriptApp` aanroept. Wel **handmatig geverifieerd op de live deployment**: locatie kiezen,
  weeroordeel met echte databronnen (incl. RWS-getij), instellingen opslaan, bronnen aan/uit
  zetten, en dat de gebruikers-ID-link na een pagina-herlaad hetzelfde profiel teruggeeft. Het
  widget-JSON-endpoint (`?actie=widget`, zie `widgetJson_` in `Code.gs`) is met `curl` tegen de
  live URL geverifieerd: correcte data, correcte `Content-Type: application/json`, een nette
  foutmelding zonder `id`, de `locatie`-parameter, en (na de fix hieronder) een werkende
  `grafiekUrl` die zelf ook weer met `curl` gecontroleerd is op een echte, geldige PNG. **Eerst
  geprobeerd en verworpen**: een Blob rechtstreeks als `doGet`-respons teruggeven (voor een
  aparte `?actie=widget-grafiek`-URL) — dat leverde met `curl` een HTML-wrapper op in plaats van
  de afbeelding (bevestigt dat Apps Script dit niet ondersteunt, ondanks tegenstrijdige
  documentatie hierover); vervangen door de Drive-omweg die er nu staat.
- **Het daadwerkelijk versturen van beide meldingsvormen** (`Meldingen.gs`:
  `controleerEnStuurMeldingen`) — beide meldingsvormen draaien op dezelfde, volledig geteste
  `berekenDagScore`/`bouwDagSamenvatting` als de webapp (via `bepaalDagOordelenVoorLocatie_` in
  `Code.gs`; de directe alert toetst simpelweg `dagScore.kleur === 'groen'`, geen eigen logica meer
  om apart te testen — zie README.md "Meldingen"). Maar het daadwerkelijk
  versturen via de Telegram Bot API (nu N losse foto+bijschrift-berichten i.p.v. één tekstbericht,
  zie README.md "Meldingen"), de tijdstip-gating, en de `laatstGemeld`-dedup van de directe alert
  vereisen een live trigger-run met een gekoppeld chat-ID.

  **Live incident, wél onderzocht**: een gebruiker kreeg voor de dagelijkse samenvatting alleen de
  kale "📍 locatie: kon geen weerdata ophalen"-fallback, zonder foto of details. Onderzocht via
  tijdelijke diagnoseroutes (zelfde werkwijze als elders in dit document, sindsdien weer
  verwijderd): eerst het daadwerkelijk gekoppelde profiel opgezocht (`laadAlleProfielen_` gefilterd
  op `telegramChatId`, zonder chatId/token in de respons), en toen de ECHTE
  `verstuurDagelijkseSamenvatting_`/`verwerkDirecteAlert_` er rechtstreeks tegenaan gedraaid. Beide
  liepen foutloos door en stuurden een volledig, correct bericht mét foto — de fout was dus niet
  (meer) reproduceerbaar. Vermoedelijke oorzaak: een eenmalige hapering van een externe bron
  (Open-Meteo/Buienradar/RWS/Windfinder) tijdens die ene trigger-run, die via het bestaande
  try/catch in de kale fallback terechtkwam. Als resilience-verbetering hebben zowel
  `verstuurDagelijkseSamenvatting_` als `verwerkDirecteAlert_` nu een **eenmalige herkansing** (2s
  wachten, dan opnieuw `bepaalDagOordelenVoorLocatie_` aanroepen) vóór ze de fallback tonen — een
  kortstondige externe hik hoeft zo niet meer de hele samenvatting voor die locatie te kosten. De
  daadwerkelijke fout wordt bij een blijvende mislukking naar `Logger.log` geschreven (zichtbaar in
  Apps Script's uitvoeringslog), niet in het Telegram-bericht zelf.
- **De grafiek-afbeelding — `bouwAlertGrafiekBlob_` bestaat niet meer.** Dat was de oorspronkelijke,
  score-als-hoogte staafdiagram-functie voor de (toenmalige) directe alert, live geverifieerd via
  het widget-JSON-endpoint (`curl` is sneller te testen dan een echte Telegram-trigger-run). **De
  ontdekking die dat testen opleverde blijft relevant voor `bouwDagGrafiekBlob_` hieronder, dat het
  vervangt**: per-staaf kleuren via een DataTable-'style'-kolom gaf live een harde fout
  (`DataTableBuilder.addColumn` accepteert dat object-vorm-argument niet — een client-side
  Google-Charts-JS-feature, geen Apps Script-API), opgelost met drie aparte series
  (Goed/Matig/Niet geschikt) + `setStacked()` + `setColors()`. Nu gebruiken zowel het
  widget-JSON-endpoint (`widgetJson_` in `Code.gs`) als beide Telegram-meldingsvormen dezelfde
  `bouwDagGrafiekBlob_`.
- **De dag-grafiek** (`bouwDagGrafiekBlob_` in `Meldingen.gs`) — net als bij de vorige versie
  hierboven eerst een aanname gedaan en die live onderuitgehaald: `Charts.newComboChart()`
  (staven + lijn combineren, nodig voor de
  windvlagen-lijn) bestaat **niet** in de Apps Script Charts-service — een tijdelijke
  `?actie=test-dag-grafiek`-route (sindsdien weer verwijderd, zelfde werkwijze als eerdere
  Charts-checks) gaf `TypeError: Charts.newComboChart is not a function`, en `Object.keys(Charts)`
  bevestigde dat alleen de losse chart-types (Area/Bar/Column/Line/Pie/Scatter/Table) bestaan. De
  windvlagen-lijn is daarom **niet** overgenomen uit de webapp-grafiek (de vlaag staat wel nog in
  de bijschrift-tekst en in de Tabel-weergave). Wat wél lukte, ook live geverifieerd: een gewone
  `newColumnChart()` accepteert per-serie een `targetAxisIndex`, waarmee regen (mm) op een eigen
  tweede as naast de windstaven (kn) past, zonder ComboChart nodig te hebben. De resulterende PNG
  is via dezelfde Drive-omweg als het widget-JSON opgehaald en visueel gecontroleerd: correct
  gekleurde windstaven (groen/oranje/rood naar score) en losse blauwe regenstaven op de juiste
  uren, met een duidelijk leesbare tweede as.
- **De regenradar** (`bouwRadarWeergave` in `JavaScript.html`) — de projectie-wiskunde en het
  animeren zijn niet als unit-test vast te leggen (DOM + externe tegel-/beeldservers), maar wél
  uitgebreid geverifieerd:
  - **De hoekcoördinaten van het radarbeeld** (`RADAR_BEELD`) zijn niet aangenomen maar gemeten, en
    daarna onafhankelijk gecontroleerd: van het radarbeeld én van een uit OSM-tegels samengestelde
    referentie voor dezelfde uitsnede is een land/zee-masker gemaakt, waarna is gezocht bij welke
    verschuiving de overlap maximaal is. Die controle wees eerst 5×3 pixels (7,4 km) afwijking aan;
    ná correctie komt hij uit op **nul pixels**. Dezelfde meting op een frame uit de animatie geeft
    ook nul, dus animatie en los beeld delen dezelfde geometrie. Zie README.md "Radar-tabblad".
  - **Dat de bron écht vooruit kijkt** is afgetast tegen de API: `timestamp` in UTC werkt tot
    +170 minuten, daarboven volgt een HTTP 400.
  - **In de browser**, met echte data: 16/16 kaarttegels en 16/16 radarframes geladen, 0 mislukt,
    precies één actieve laag tegelijk, en de spotmarker valt op de juiste plek aan de kust. De
    labelreeks is uitgelezen over een volledige cyclus en loopt regelmatig: `16:30 (nu)`,
    `16:40 (+10 min)`, … , `19:00 (+2u30)` — kloktijden exact 10 minuten uit elkaar. Dat was een
    eerdere bevinding van de gebruiker: de eerste sprong las `+12` en de rest `+15`, doordat het
    label werd afgezet tegen de echte klok terwijl frame 0 op Buienradars 5-minutenraster ligt.
  - **Twee fouten die dit testen eerder opleverde**: (1) de kaart centreerde ~60 km te ver zuidoost
    omdat `clientWidth`/`clientHeight` werden uitgelezen terwijl het element nog niet in de DOM hing
    (dus 0) — opgelost door met `left/top: 50%` te positioneren, wat de containergrootte niet nodig
    heeft; (2) een eerdere versie met `loading="lazy"` laadde de radar helemaal niet in een
    net-geopende container.
  - **Het voorladen** (`voorlaadRadar`) is in de browser gemeten, niet aangenomen: na het laden van
    de pagina staan er 32 opgehaalde bronnen (16 frames + 16 tegels) terwijl het radartabblad nog
    niet bestaat, en bij het daarna openen komt **alles uit de cache** — 32 van de 32 met
    `transferSize === 0`, dus 0 bytes van het netwerk. Tijd tot het eerste zichtbare beeld: ~0,6-0,8 s,
    tegen ~1,0 s toen er nog op alle zestien frames gewacht werd. Dat dit kán is vooraf geverifieerd
    aan de responsheaders: Buienradar `Cache-Control: public, max-age=300`, OSM ruim een week.
  - **Niet afgedekt**: hoe vaak de bron een 502 geeft. Dat gebeurt merkbaar (ook tijdens dit testen),
    en een frame dat niet laadt wordt overgeslagen — maar bij een langere storing blijft de kaart
    leeg, en dat pad is niet als test vast te leggen.
- **Webhook- en trigger-zelfherstel** (`zorgVoorTelegramWebhook_`, `voerOnderhoudUit_`) — praat met
  de Telegram-API en de ScriptApp-triggerdienst, dus niet unit-testbaar. Wél live geverifieerd via
  `?actie=onderhoud` op de productie-deployment: eerst `"reden": "opnieuw-ingesteld"` (webhook was
  weg), daarna bij een herhaalde aanroep `"reden": "stond-al-goed"` met `wachtrij: 0` en
  `laatsteFout: null` — dus zowel het herstellen als het herkennen-dat-het-al-goed-staat klopt.
  De route is bewust idempotent, zodat dit soort verificatie geen bijwerkingen heeft.
- **De Telegram-lusfixes** (`telegramUpdateAlGezien_`, `vindGebruikerIdVoorTelegramChatId_`,
  `recentAlGeantwoord_`) — alle drie leunen op CacheService/ScriptProperties en zijn daarom niet
  unit-getest. De oorzaak is wel hard vastgesteld: Telegram herhaalt een update als er niet snel
  genoeg een 200 terugkomt, en de oude chat-ID-lookup las álle profielen in. Of de fix in productie
  standhoudt, blijkt pas bij de volgende koppeling — vandaar dat het antwoord bij twijfel liever
  wordt overgeslagen dan herhaald.
- **De generieke RWS-station-lookup** (`vindDichtstbijzijndRwsStation_` in `WeerData.gs`) — welke
  van de 10 stations in `RWS_STATIONS` daadwerkelijk actuele data teruggeeft, is op 30 aug 2026
  live tegen de RWS-API geverifieerd (zie README.md "Aannames" #3), maar niet als geautomatiseerde
  test omdat dat een netwerkcall naar een externe, veranderlijke bron zou zijn.
- **Weerlive.nl-respons-vorm** — geen API-key beschikbaar tijdens de bouw, zie README.md.
- **De live Windfinder-fetch zelf** (`UrlFetchApp.fetch` in `WeerData.gs`) — de parser is wel
  tegen een echte, opgeslagen paginabron getest (zie hierboven), maar of Windfinder's
  paginastructuur ongewijzigd blijft kan alleen in productie blijken; verandert die structuur,
  dan geeft `parseWindfinderForecast` gewoon `null` terug (bron wordt overgeslagen, geen crash).
- **kitesurfvereniging.nl (NKV)** — bewust niet geïntegreerd, zie README.md "Aannames" #4.
