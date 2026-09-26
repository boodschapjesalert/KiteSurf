# Kite Weer App

Een webapp die kitesurfers een 3-daags weeroordeel geeft (kleurcode, score, uurdetail) op basis
van meerdere gratis weerbronnen, met per-gebruiker instelbare drempelwaarden, favoriete spots,
en een dagelijkse Telegram-samenvatting (08:00) die aangeeft welke van vandaag/morgen/overmorgen
aan een expliciete windregel voldoen.

Live op: `https://script.google.com/macros/s/AKfycbxaxYVjqJxb4IK5ep3KrVmtrMJHCVFf3j68kVzz0JhxBtKWyzYag7yI5jVF6R5RC0QY8w/exec`
(voeg `?id=<je-eigen-uuid>` toe — die krijg je automatisch bij je eerste bezoek, zie "Toegang" hieronder).

Gebouwd volgens:
- [`criteria-kiteweer-app.md`](criteria-kiteweer-app.md) — de go/no-go-criteria en scoreformule
- [`databronnen-kiteweer-app.md`](databronnen-kiteweer-app.md) — de databronnen en hoe ze gemiddeld worden

## Toegang (geen account/login)

De app draait los van Telegram (zie "Aannames" #1 hieronder) en heeft geen inlogsysteem. In
plaats daarvan krijgt elke bezoeker bij het eerste bezoek automatisch een eigen, niet-geraden
gebruikers-ID (een UUID) toegewezen, zichtbaar in de URL (`?id=...`) en opgeslagen in
`localStorage`. Bewaar die link (bookmark 'm) om later bij dezelfde instellingen/favorieten
terug te komen — wie de link kent, kan bij dat profiel, vergelijkbaar met een deel-link.

## Architectuur

```
src/
  logica/    Pure JS, geen GAS-afhankelijkheden. Los met Node.js te testen.
  gas/       Dunne GAS entry points (doGet, triggers) — I/O: UrlFetchApp, DriveApp,
             PropertiesService, CacheService.
  webapp/    HTML/CSS/JS voor de front-end (HtmlService + google.script.run).
  app/       Alleen voor de Android-app: vervangt google.script.run (zie "Android-app").
android/     Capacitor Android-project: WebView-app + widget + meldingen (Java).
test/        Unit- en integratietests voor src/logica/, met fixtures (echte bron-responses).
tools/       gas-dev-server.js: draait dist/*.gs lokaal in Node (app end-to-end testen).
build.js     Bundelt src/ naar dist/ (GAS-compatibel, klaar voor `clasp push`).
build-app.js Bouwt www/ (de front-end voor de Android-app) uit src/webapp + src/app + src/logica.
```

`src/gas/*.gs` roept functies uit `src/logica/*.js` rechtstreeks bij naam aan (bv.
`berekenDagScore(...)`), zónder import: een Apps Script-project deelt automatisch één globale
scope over al zijn `.gs`-bestanden. `build.js` bundelt daarom niet zoals een normale
JS-bundelaar, het strip alleen de `require()`/`module.exports`-syntax die `src/logica/*.js`
gebruikt om in Node testbaar te zijn, en kopieert de rest ongewijzigd naar `dist/`.

De pagina wordt geserveerd via `HtmlService` (niet `ContentService` — zie "Aannames" #2) en de
front-end praat met de backend via het standaard `google.script.run`-mechanisme.

### Databronnen en middeling

Zie `src/logica/bronParsers.js` (parseert elke bron naar een genormaliseerd formaat: Open-Meteo,
Buienradar, Weerlive, Rijkswaterstaat-getij/-wind, Windfinder), `src/logica/bronnenMiddeling.js`
(middelt meerdere bronnen per variabele, met uitschieter-detectie) en
`src/logica/forecastSamenstellen.js` (voegt dat samen tot de uurData-tijdlijn, inclusief
getij-classificatie). Elke bron kan per gebruiker aan/uit gezet worden via de 🛰️-knop
("Databronnen") in de app.

**Efficiëntie:** `src/gas/WeerData.gs` verzamelt per locatie eerst alle databronnen die nog niet
in de cache zitten (tot 8: Open-Meteo ×2, Buienradar, Weerlive, RWS ×3, Windfinder), en haalt die
in één keer **parallel** op via `UrlFetchApp.fetchAll()` (`voerBatchOp_`) i.p.v. na elkaar — de
wachttijd wordt zo de langzaamste enkele bron in plaats van de som van alle bronnen. Caching
blijft via `CacheService` (10 minuten per bron-en-locatie).

**Windfinder.com** heeft geen publieke API, maar de forecast-pagina (bv.
`windfinder.com/forecast/rockanje`) bevat de volledige meerdaagse voorspelling (wind + golven)
al als JSON ingebakken in de server-gerenderde HTML, voor hun eigen paginacomponent-hydratie
(zie `parseWindfinderForecast` in `bronParsers.js`) — geen scraping van gerenderde tekst of
JavaScript-uitvoering nodig, één keer de paginabron parsen volstaat. Alleen gekoppeld voor de
twee standaard-favorieten (zie "Aannames" #5).

### Scoreberekening

`src/logica/drempelwaarden.js` evalueert elke variabele individueel tegen de (instelbare)
drempelwaarden; `src/logica/scoreBerekening.js` combineert dat tot een score 1-10 en
kleurcode per uur (`berekenUurScore`) en per dag (`berekenDagScore`).

**De dagscore komt van het beste aaneengesloten blok, niet van het beste losse uur.** Een piek van
één uur is geen sessie waar je voor naar het strand rijdt, dus `vindBesteVenster` zoekt het best
scorende blok van minimaal `profiel.minimaleSessieUren` uur (instelbaar via ⚙️ Instellingen,
standaard 2, geklemd 1-8) waarin géén enkel uur een no-go is. De score van zo'n blok is het
*gemiddelde* van de uren erin, niet het maximum — anders zou één uitschieter een verder matig blok
omhoog trekken. Is er geen blok dat lang genoeg aaneengesloten goed is, dan is de dag rood met
`geenSessieMogelijk: true`, óók als er wel een los goed uur was.

Voor de weergave wordt dat kern-venster daarna uitgebreid naar de volledige *bruikbare* periode
(`breidUitRondVenster`): aangrenzende uren worden meegenomen zolang ze minstens 80% van de
kernscore halen. Zo beschrijft de app "tussen 09:00 en 18:00 lijkt de wind goed" in plaats van
alleen de beste twee uur daarvan — zonder door te lopen tot elk nét-bruikbaar uur.

**Langdurige regen weegt mee, los van de neerslagkans-waarschuwing.** Die laatste (`evalueerOnweer`)
kijkt per uur naar de gerapporteerde kans; die zegt niets over duur — een half uurtje bewolkt met
20% kans is heel anders dan drie uur aan één stuk daadwerkelijke regen. `berekenLangdurigeRegenVlaggen`
(scoreBerekening.js) bepaalt daarom over de **volle dag** (vóór het dagvenster-filter, zodat een
regenreeks die er net vóór begint en erin doorloopt ook meetelt) welke uren in een aaneengesloten
reeks van minstens `drempelwaarden.langdurigeRegen.minimumUrenAchtereen` uur zitten met elk
minstens `.minimumMmPerUur` regen; `evalueerLangdurigeRegen` (drempelwaarden.js) zet dat per uur om
in een scorebijdrage (0 als actief, geen no-go — het is een weegfactor, geen blokkade). Beide velden
starten blanco (net als de rest van de drempelwaarden, zie "Aannames" hieronder) en worden dan
genegeerd (neutrale score 0.5).

**De score-gewichten zijn instelbaar via een uitklapbare variabelen-tabel, met de huidige
berekening als default.** `scoreBerekening.GEWICHTEN` (windsnelheid 0.30, windrichting 0.20,
windvlagen 0.15, getij 0.15, langdurigeRegen 0.10, facultatief 0.10) is niet langer een vaste
constante maar de **default-inhoud** van `profiel.scoreGewichten` — instelbaar bij ⚙️ Instellingen
→ Score-berekening (een `<details>`-uitklapmenu, standaard dicht: dit is een instelling voor
gevorderde gebruikers). Dit zijn bewust **vrije relatieve factoren**, geen percentages die op 100%
moeten optellen: `berekenUurScore` deelt de gewogen som door de daadwerkelijke som van de gewichten
— met de standaard-gewichten (som = 1,0) is dat een no-op, dus een gebruiker die niets aanpast
merkt niets van deze instelling.

De tabel is een **open set**: `normaliseerGewichten` vult niet langer ontbrekende sleutels aan met
een default (dat deed de eerdere versie van deze instelling nog wel) — de tabel ZELF bepaalt
volledig welke criteria meetellen. Een criterium dat de gebruiker verwijdert, telt simpelweg niet
meer mee; blijft er na filtering niets geldigs over (leeg, of alles op 0/negatief), dan valt het
geheel terug op de standaard-GEWICHTEN i.p.v. een blijvende score van 0 zonder duidelijke oorzaak.

**Naast de zes standaardcriteria zijn ook de vier variabelen die normaliter in "Facultatief" zitten
individueel kiesbaar**: luchttemperatuur, watertemperatuur, golfhoogte, zicht
(`FACULTATIEVE_SUBCRITERIA` in scoreBerekening.js). Een gebruiker kiest via een dropdown ("+
Toevoegen") een variabele die nog niet in de tabel staat; die krijgt een eigen rij met een
gewichtveld en een verwijderknop. Om dubbeltelling te voorkomen berekent `berekenUurScore` het
"Facultatief"-gemiddelde alleen nog over de subcriteria die NIET ook individueel in de tabel staan
— kies je bijvoorbeeld "Zicht" apart, dan valt zicht uit dat gemiddelde en telt hij alleen nog mee
via zijn eigen gewicht. Zijn alle vier apart gekozen, dan draagt de (dan lege) "Facultatief"-rij
terecht niets meer bij. De client-side mirror hiervan (`genormaliseerdeGewichten`,
`herrenderScoreGewichtenTabel` in JavaScript.html) volgt exact dezelfde regel, zodat de
"Berekening"-tab (`bouwBerekeningWeergave`) altijd de daadwerkelijk gebruikte, genormaliseerde
gewichten toont — inclusief eventueel losgekoppelde facultatieve criteria.

"Onweer" is bewust nooit kiesbaar in deze tabel: dat werkt als harde no-go plus een
vermenigvuldigende straf-factor op de hele score (zie hierboven), geen gewogen optelterm zoals de
rest — het zou niet kloppen om er een relatief gewicht aan toe te kennen.

### Samenvattende zin per dag

`src/logica/dagSamenvatting.js` zet het dagoordeel om in één leesbare regel op de dagkaart, bv.
*"Tussen 09:00 en 18:00 lijkt de wind goed (14-24 kn), daarna neemt het af. Tussen 15:00 en 19:00
valt 8.4 mm regen."* — zodat je niet eerst een grafiek hoeft te interpreteren. Bewust in de
logica-laag en niet in de front-end: het is echte tekstlogica (windtrend na het venster, met een
2-knopen-marge zodat een verwaarloosbaar verschil geen "het neemt af" oplevert; regen met begin- én
eindtijd, waarbij onderbroken buien apart worden gegroepeerd zodat een droge tussenperiode niet als
één doorlopende regenperiode leest) die zonder browser testbaar is, en zo kan een Telegram-melding
er later dezelfde zin uit halen. `Code.gs` (`getWeerOordeel`) geeft 'm per dag mee als `samenvatting`.

Naast de afgeleide status/score bevat elk uurresultaat ook een `ruw`-object met de feitelijke
meetwaarden, voor een directe weergave los van de go/no-go-interpretatie: windknopen, windvlaag
(zichtbaar in de wind-badge, bv. "18 kn ZW (vlagen 24 kn)" — niet alleen in een hover-tooltip, die
op mobiel toch niet werkt) en getij (`getijStatus`/`waterstandCm`, zichtbaar als bv. "🌊↑ 145cm").
Dat laatste staat bewust los van `evaluaties.getij.status`: die toont de voorkeur-relatieve status
("geen-voorkeur" zolang er geen getij-voorkeur is ingesteld bij ⚙️ Instellingen → Getij/waterstand)
en is dus ongeschikt om de feitelijke waterstand te tonen — `ruw.getijStatus`/`ruw.waterstandCm`
tonen de daadwerkelijke hoog/laag-classificatie en waterstand, ongeacht of er een voorkeur staat.

### Meldingen — twee onafhankelijke Telegram-vormen

Geen e-mail meer: meldingen lopen uitsluitend via Telegram. Bij ⚙️ Instellingen kies je, los van
elkaar aan/uit te zetten (beide, één van de twee, of geen van beide):

- **Dagelijkse samenvatting**, op een zelf gekozen tijdstip (één `<input type="time">`-veld in de
  UI, zie hieronder — server-side nog steeds `meldingen.samenvattingUur` + `.samenvattingMinuut`,
  default 08:00): per favoriete locatie, per dag (over de ingestelde Voorspellingshorizon) één
  **foto+bijschrift**-bericht — letterlijk dezelfde informatie als de ingeklapte dagkaart in de
  webapp: kleur, verdict, score, wind/weer/getij/zonsondergang en de samenvattingszin als
  bijschrift, met de dag-grafiek (wind, score-kleur, regen) als foto. Bij 2 favorieten × 3 dagen
  zijn dat dus 6 losse berichten na elkaar, plus een kort opening- en slotbericht — bewust geen ene
  grote tekst, zie `verstuurDagelijkseSamenvatting_` in `Meldingen.gs`.

  **Het gekozen tijdstip is wanneer het bericht aankomt, niet wanneer de verwerking begint**
  (gebruikersverzoek). Het versturen zelf kost tijd — Slides-grafieken ~5s per dag/locatie, tot twee
  herkansingen van 2s+5s per locatie als een bron hapert (zie hieronder), en `warmWeerCache_` kost
  er bij meerdere profielen nog een keer ~15-20s bovenop vóór de eerste samenvatting aan de beurt
  is — dus zonder compensatie komt het bericht altijd een stuk ná het gekozen tijdstip aan, niet
  exact erop. `moetSamenvattingVersturen_` begint daarom `SAMENVATTING_VOORSPRONG_MINUTEN` (15,
  gelijk aan de trigger-cadans) vóór het gekozen tijdstip al te controleren of er verstuurd moet
  worden — dat schuift het naar de trigger-run vóór het exacte tijdstip i.p.v. de run erop, zodat de
  verwerkingstijd het bericht in de praktijk dichter bij (of net vóór) het echte gekozen moment laat
  aankomen. Een vast kwartier i.p.v. een exact gemeten vertraging: eenvoudiger, en ruim genoeg voor
  de huidige schaal (een enkel profiel met een lange horizon en meerdere locaties blijft ruim onder
  de 15 minuten, zelfs met een herkansing).
- **Directe alert**: zodra een dag ergens binnen de ingestelde Voorspellingshorizon (niet meer
  alleen vandaag) voor het eerst kleur **"groen"** krijgt — per locatie én per dag hooguit één
  keer, zie `verwerkDirecteAlert_` in `Meldingen.gs`. Hergebruikt hetzelfde foto+bijschrift-bericht
  als de dagelijkse samenvatting (`verstuurDagBericht_`, met een kort "⚡ Kitesurf alert"
  voorvoegsel) i.p.v. een eigen, losstaand berichtformaat. **Nachtrust: geen berichten tussen
  22:30-07:00** (`isStilUur_`, vast — geen instelling), op gebruikersverzoek. De hele functie slaat
  in dat venster over, óók het bijwerken van `laatstGemeld` — een dag die midden in de nacht voor
  het eerst groen wordt, telt bij de eerstvolgende run ná 07:00 dus gewoon nog als nieuw en wordt
  dan alsnog gemeld: uitgesteld, niet gemist. Geldt alleen voor de directe alert; de dagelijkse
  samenvatting hierboven heeft al haar eigen, door de gebruiker gekozen tijdstip en blijft
  ongewijzigd.

  Dit is fundamenteel anders dan vroeger, op twee manieren:
  1. **Eén gedeelde berekening, geen aparte meldingsregel meer.** Beide vormen toetsten ooit aan
     verschillende dingen: de samenvatting aan de volle score/kleur-berekening, de directe alert
     aan een eigen, eenvoudigere `meldingDrempel` (minimale windkracht + richting-bereik). Die twee
     konden uit de pas lopen — een dag kon "Matig" op de kaart staan en tegelijk een alert
     triggeren, of andersom. `meldingDrempel` is daarom verwijderd (profielValidatie.js,
     `src/logica/meldingLogica.js` volledig, en de bijbehorende UI-velden); beide meldingsvormen
     draaien nu op exact dezelfde `bepaalDagOordelenVoorLocatie_` (Code.gs) als de webapp-kaarten,
     dus ook op de instelbare Score-berekening en Langdurige regen hierboven.
  2. **De horizon, niet alleen vandaag.** De oude directe alert keek alleen naar vandaag. De nieuwe
     versie scant alle dagen binnen `profiel.dagenVooruit` en meldt zodra een NIEUWE dag groen
     wordt — `meldingen.laatstGemeld` is daarom veranderd van "laatste datum" (één string per
     locatie) naar een **verzameling datums** per locatie (`{ 'YYYY-MM-DD': true, ... }`), want dag
     1 kan al gealerteerd zijn terwijl dag 3 nu pas goed wordt. Datums die uit de horizon vallen
     (verstreken, of voorbij `dagenVooruit`) worden er bij elke run stilzwijgend uit gelaten —
     zelf-opruimend, geen aparte cleanup-taak nodig.

     **Bug (gebruikersrapport): herhaalde alerts voor dezelfde dag.** `verwerkDirecteAlert_`
     (Meldingen.gs) bouwde `laatstGemeld` bij elke trigger-run helemaal opnieuw op uit alleen de op
     dát moment groene dagen — een dag die ooit gealerteerd was maar tussen twee runs in tijdelijk
     naar oranje/rood terugzakte (voorspellingen schuiven soms een beetje, vooral dicht bij de
     groen/oranje-grens) viel daardoor stilzwijgend uit die verzameling. Werd hij daarna weer
     groen, dan zag de check hem als "nooit eerder gemeld" en stuurde opnieuw een alert — voor
     exact dezelfde dag, mogelijk meerdere keren per dag. Fix: een datum die ooit als groen
     gealerteerd is, blijft nu in `laatstGemeld` staan zolang hij binnen de horizon valt,
     ongeacht zijn kleur in latere runs — alleen het verstrijken van de datum of het uit de
     horizon vallen (bij het krimpen van `dagenVooruit`) haalt 'm er nog uit.

     **Tweede bug (zelfde symptoom, andere oorzaak): overlappende trigger-runs.** Ook ná
     bovenstaande fix kwam hetzelfde probleem nog een keer voor, zonder dat de situatie
     veranderde. Oorzaak: `controleerEnStuurMeldingen` had geen enkele bescherming tegen twee
     gelijktijdig lopende runs — gebeurt dat (bv. een kortstondig dubbel geïnstalleerde trigger,
     iets wat tijdens het testen van deze sessie zelf is voorgevallen door herhaaldelijk
     `?actie=onderhoud` aan te roepen terwijl er ook al een kwartier-trigger liep), dan lazen beide
     runs hetzelfde nog-niet-gealerteerde profiel, stuurden allebei een bericht, en overschreef de
     laatste run de historie-update van de eerste stilzwijgend — de uiteindelijk opgeslagen
     historie zag er dus correct uit, maar er waren toch twee berichten verstuurd. Fix:
     `controleerEnStuurMeldingen` pakt nu een `LockService.getScriptLock()` voor de hele
     functie-body; lukt dat niet binnen 10s (een andere run is al bezig), dan slaat deze run
     zichzelf gewoon over — de eerstvolgende kwartier-trigger probeert het vanzelf opnieuw, net als
     andere zelfherstellende onderdelen in dit bestand.

     **Derde keer, structurele fix: claim vóór versturen i.p.v. erna.** Ook mét bovenstaande twee
     fixes bleef hetzelfde gebeuren — uren achter elkaar dezelfde alert, zonder situatieverandering
     (gebruikersrapport: voelt als spam). De onderliggende zwakte in `verwerkDirecteAlert_` was de
     **volgorde**: eerst het bericht versturen, dan pas (aan het eind, voor alle locaties samen)
     `laatstGemeld` opslaan. Alles wat daartussen misgaat — een haperende `UrlFetchApp`-call die
     ondanks `muteHttpExceptions` toch een uitzondering gooit (bv. een GAS-quotafout), een run die
     om wat voor reden dan ook wordt afgebroken — laat het bericht al wél verstuurd zijn, maar de
     "al gemeld"-markering nooit opgeslagen. De eerstvolgende run weet daar niets van en verstuurt
     opnieuw, keer op keer, tot een run toevallig zonder haperingen doorloopt.
     Fix: de volgorde is omgedraaid. Per locatie wordt eerst de complete bijgewerkte
     `laatstGemeld[locatie.id]` **opgeslagen** (`slaProfielOp_`), en pas dáárna worden de nieuwe
     alerts voor die locatie verstuurd — elk in een eigen `try/catch` die een verstuurfout alleen
     logt, niet opnieuw probeert. Bewuste afweging: een echte verstuurfout op dit punt betekent nu
     een **gemiste** alert (de claim staat al vast) in plaats van een **herhaalde** — en dat weegt
     duidelijk minder zwaar dan meldingen die als spam aanvoelen.

  3. **Bug (gebruikersrapport, twee gebruikers onafhankelijk van elkaar): stille gaten in de
     dagelijkse samenvatting.** "De eerste melding kwam binnen met alle dagen een grafiekje zoals
     verwacht. Vanaf het 2e bericht ontvang ik alleen maar 'kitesurf-vooruitzicht (3 dagen)', geen
     grafiekjes of data, daarna wel weer 'bekijk de app'." Dus wél het openingsbericht, wél het
     slotbericht, maar **niets ertussenin** — geen foto's, ook geen tekst-fallback.

     Uitgebreid live getest zonder de exacte trigger te reproduceren: `bepaalDagOordelenVoorLocatie_`
     gaf voor alle echte profielen gewoon het juiste aantal dagen terug (ook na een koude-cache-dan-
     warme-cache-volgorde, precies zoals `warmWeerCache_` gevolgd door de echte samenvatting), en
     `bouwDagGrafiekBlob_` (Slides) hield 10 aanroepen achter elkaar in dezelfde run foutloos vol
     (~5s per grafiek, geen degradatie). Wat wél bleek te ontbreken: **foutisolatie**. Noch de
     per-dag-verstuurlus in `verstuurDagelijkseSamenvatting_`, noch de per-profiel-lus in
     `controleerEnStuurMeldingen` had een `try/catch` — exact het patroon dat elders in dit bestand
     (zie hierboven, en `warmWeerCache_`) al wél consequent wordt toegepast ("één mislukking mag de
     rest niet blokkeren"), hier over het hoofd gezien. Een onverwachte fout op willekeurig welk punt
     tussen het open- en slotbericht (bv. `formatDagBalkTekst` op een randgeval, of iets in de
     Telegram-call zelf) zou daardoor **stilzwijgend** precies dít patroon opleveren: alles ná dat
     punt in de huidige locatie/profiel wordt overgeslagen, zonder enige foutmelding, tot de volgende
     regel die wél buiten de kapotte lus staat (het slotbericht) gewoon weer aan de beurt komt. Erger
     nog: omdat `.forEach` in JavaScript niet zelf fouten opvangt, zou zo'n fout bij één profiel ook
     de verwerking van ALLE nog volgende profielen in diezelfde trigger-run hebben kunnen afbreken.

     De exacte oorspronkelijke oorzaak is niet met zekerheid vast te stellen (niet meer
     reproduceerbaar), maar deze ontbrekende foutisolatie is hoe dan ook dichtgezet: een `try/catch`
     rond elk hele profiel in `controleerEnStuurMeldingen` (logt en gaat door met het volgende
     profiel) én rond elk dagbericht in `verstuurDagelijkseSamenvatting_` (logt, stuurt nu ook een
     zichtbare "kon dit bericht niet versturen"-regel in Telegram i.p.v. alleen in het voor de
     gebruiker onzichtbare uitvoeringslog, en gaat door met de volgende dag/locatie). Mocht dit
     zich ooit herhalen, dan is het nu zichtbaar in plaats van stil — en dus voor het eerst echt te
     diagnosticeren.

     **Vervolg: dezelfde stilte kwam ná die fix gewoon terug.** De try/catches hierboven vangen
     alleen *fouten* op (iets dat een exception gooit) — het gebruikersrapport liet daarna zien dat
     er waarschijnlijk helemaal geen fout optrad: `dagOordelen` kwam gewoon **leeg terug, zónder
     exception**, waardoor de verstuurlus simpelweg nul keer draaide. Geen fout om te vangen, dus
     geen logregel, geen fallback-bericht — precies zo onzichtbaar als voorheen, ondanks de fix.
     Uitgebreid geprobeerd te reproduceren met de échte profielen (koude cache, warme cache, 10
     Slides-aanroepen achter elkaar) zonder succes; de makkelijkste verklaring die overbleef —
     tijdstip-afhankelijk gedrag rond het (vroege ochtend-)samenvattingsuur — was niet op afstand na
     te bootsen. In plaats van nog een keer blind te gokken: `verstuurDagelijkseSamenvatting_`
     controleert nu expliciet of `dagOordelen.length` klopt met het gevraagde aantal dagen. Is dat
     niet zo, dan (a) stuurt de app alsnog een zichtbaar Telegram-bericht ("0 van de 3 dagen
     ontvangen" / "maar 2 van de 3 dagen ontvangen") i.p.v. stilte, en (b) legt een momentopname
     (tijdstip, locatie, coördinaten, databronnen, gevraagd/gekregen aantal dagen) vast in Script
     Properties, opvraagbaar via `?actie=laatste-lege-samenvatting` — zodat een volgend voorval voor
     het eerst harde gegevens oplevert i.p.v. opnieuw alleen een gebruikersrapport zonder
     reproductie.

     **Derde vervolg, en de vermoedelijke daadwerkelijke oorzaak: `verstuurTelegramBotBericht_`
     controleerde de statuscode helemaal niet.** Doorslaggevende aanwijzing (gebruikersrapport): "dit
     is een probleem voor telegram trouwens, de webapp geeft wel gewoon het juiste overzicht" — op
     hetzelfde moment. Dat sluit de hele data-laag (`bepaalDagOordelenVoorLocatie_`,
     `haalWeerDataOp_`) uit als oorzaak, want die is identiek voor webapp én Telegram-melding; alleen
     het *versturen* is Telegram-specifiek. Bij het naast elkaar leggen van beide verstuurfuncties in
     `TelegramBot.gs` bleek `verstuurTelegramFotoMetOnderschrift_` (de foto) keurig `response.
     getResponseCode() === 200` te checken en dat terug te geven, maar `verstuurTelegramBotBericht_`
     (de tekst — gebruikt voor het open-/slotbericht, ÉN als fallback wanneer de foto mislukt) vuurde
     de aanroep af en las het antwoord daarna **nooit**. Met `muteHttpExceptions` crasht een mislukte
     aanroep dan niet, maar verdwijnt ook volledig geruisloos.

     Dat verklaart het exacte patroon: bij een dagelijkse samenvatting met meerdere locaties/dagen
     verstuurt de app kort na elkaar een reeks foto+bijschrift-berichten naar dezelfde chat — precies
     waar Telegram een kortstondige rate-limit (HTTP 429) op kan zetten. Zodra dat gebeurt, faalt de
     foto (netjes gedetecteerd), valt de code terug op de tekst-versie, en ALS die óók geraakt wordt
     door dezelfde rate-limit-periode verdwijnt ook die spoorloos — geen foutmelding, niets in
     `dagOordelen` dat iets zou verklappen (die was prima gevuld), niets dat de vorige twee fixes
     zouden hebben opgevangen. Het open- en slotbericht ontsnappen hieraan simpelweg omdat ze vóór
     de burst resp. ná een korte pauze verstuurd worden, buiten het geraakte venster.

     Fix: een gedeelde `telegramApiAanroep_`-helper (`TelegramBot.gs`) die de statuscode wél
     controleert, en bij een 429 Telegram's eigen `retry_after`-veld gebruikt om één keer een
     passende tijd te wachten en opnieuw te proberen — zowel `verstuurTelegramBotBericht_` als
     `verstuurTelegramFotoMetOnderschrift_` gebruiken 'm nu. Mocht zelfs die ene herkansing nog
     mislukken, dan legt `verstuurDagBericht_` (Meldingen.gs) dat nu vast in Script Properties
     (`LAATSTE_MISLUKTE_VERSTUURPOGING`, ook opvraagbaar via `?actie=laatste-lege-samenvatting`) —
     voor het eerst mét het onderscheid tussen "geen data" en "wel data, verzending mislukt", iets
     wat tot nu toe niet te maken was.

     **Vierde vervolg: de "0 van de 3 dagen"-melding zelf leverde het eerste harde bewijs.**
     `?actie=laatste-lege-samenvatting` ving een concreet geval: locatie "Berkel en Rodenrijs" (een
     binnenlandse plaats, geen kust-spot) gaf om 11:02 — géén vroege ochtend, dus geen tijdstip-
     specifiek patroon — 0 van de 3 gevraagde dagen terug, met alle bronnen aan. Diezelfde
     locatie/instellingen faalden bij herhaald handmatig navragen nooit opnieuw — dit is dus een
     échte maar zeldzame, kortstondige hapering van een bron (vermoedelijk Open-Meteo, de enige
     verplichte bron voor de basistijdlijn) die zichzelf zonder ingrijpen weer oplost, en die zélf
     geen exception veroorzaakt (dus niet door de bestaande try/catch opgevangen wordt). De
     ontbrekende schakel was een herkansing voor exact dít geval: `verstuurDagelijkseSamenvatting_`
     had al een herkansing bij een gegooide fout, maar niet bij een resultaat dat gewoon leeg
     terugkomt zónder fout. Fix: dezelfde eenmalige herkansing (2s wachten, opnieuw ophalen) nu ook
     hier — de momentopname/het zichtbare Telegram-bericht wordt pas gebruikt als ook de herkansing
     te kort blijft.

     **Vijfde vervolg: eenmalige herkansing bleek soms niet genoeg.** Een tweede gebruiker bleef last
     houden ná bovenstaande fix — het onderscheidende verschil: hun profiel vraagt 5 dagen vooruit
     i.p.v. 3. Rechtstreeks getest (`haalWeerDataOp_` voor dezelfde locatie, 3 vs. 5 dagen): geen
     structurele breuk, 5 dagen werkt op zich prima, maar is wél meetbaar groter/trager (~1,3s i.p.v.
     ~1s voor exact dezelfde locatie) — een groter Open-Meteo-verzoek geeft een kortstondige hapering
     simpelweg meer kans om precies dán toe te slaan. Bevestigd via `?actie=laatste-lege-samenvatting`:
     bij dit profiel kwamen zowel de oorspronkelijke poging ALS de herkansing (2s later) allebei leeg
     terug — de hapering hield dus soms langer dan 2s aan. Fix: twee herkansingen i.p.v. één, met
     oplopende wachttijd (2s, dan 5s) — meer tijd geven een langer aanhoudende hapering zich te
     herstellen, i.p.v. na 2s al op te geven.

     **Zesde vervolg: een tweede gebruiker, "soms wel, soms geen" (5 → 6 dagen).** De momentopname
     liet zien dat ook zijn samenvatting om 08:19 met 0 van de 6 dagen binnenkwam, ook na de
     herkansingen. Zijn profiel (`laatsteSamenvattingDatum` = vandaag) verklaarde het "soms geen":
     een run met een lege bron werd toch als **klaar** afgevinkt, dus daarna probeerde de app het die
     dag nooit meer — ook niet toen de bron een kwartier later gewoon weer werkte. Vier veranderingen:

     1. **Herstel in plaats van opgeven** (`verwerkOpenstaandeHerkansingen_`): een locatie zonder
        enige dag data wordt de rest van de dag elk kwartier opnieuw geprobeerd (max. 4 keer, ~1 uur),
        alléén die locatie en zonder opening-/slotbericht te herhalen. De gebruiker krijgt één bericht
        ("ik probeer het over een kwartier opnieuw") en bij definitief mislukken één laatste. De
        administratie staat in Script Properties (`SAMENVATTING_HERKANSINGEN`), niet in het profiel.
     2. **Vangnet met de laatst bekende goede respons** (`voerBatchOp_`, `STALE_CACHE_SECONDEN`): faalt
        de verse Open-Meteo-aanvraag, dan wordt een kopie van de laatste succesvolle respons (max. 6 uur,
        in de praktijk ~15-30 min oud omdat `warmWeerCache_` elk kwartier ververst) gebruikt i.p.v.
        niets. Een licht verouderde voorspelling is voor een dagoverzicht prima; een lege lijst niet.
     3. **Gedeelde horizon voor gedeelde locaties.** De cachesleutel bevatte het aantal dagen, dus twee
        accounts met dezelfde locatie maar 5 en 6 dagen deden elk een eigen aanvraag. Nu bepaalt
        `bewaarHorizonKaart_` (elke trigger-run) voor locaties die door **meer dan één profiel** gebruikt
        worden de langste horizon, en halen alle betrokken accounts die op; een locatie van één account
        blijft op zijn eigen aantal dagen. Er is geen botsing tussen accounts (de sleutel bevat alleen
        coördinaten + dagen), en niets ervan is voor gebruikers zichtbaar: alleen weerdata per plek,
        nooit gebruikers-ID's.
     4. **Inzicht**: `?actie=meldingen-status` toont de laatste ~25 trigger-runs (duur, opwarm-duur,
        welke samenvattingen hoe lang duurden, of de laatste run is afgebroken) en de laatste mislukte
        bronaanvragen met statuscode en respons (`BRONFOUTEN`, `legBronFoutVast_`) — de échte reden van
        een lege respons (rate limit? 5xx? time-out?) was tot nu toe onbekend. Alleen volgnummers,
        geen gebruikers- of chat-ID's.

     Nog niet bewezen wát de bron precies terugstuurt bij zo'n mislukking; `BRONFOUTEN` moet dat bij
     de eerstvolgende keer laten zien. Verdachte: Open-Meteo's gratis tier rate-limit per IP-adres,
     terwijl Apps Script-verzoeken vanaf gedeelde Google-IP's komen.

     **Zevende vervolg: oorzaak bewezen — HTTP 429, dagelijkse limiet.** De eerste trigger-run met de
     nieuwe meetpunten gaf `openMeteo: { ok: 0, fout: 11 }`, elke keer `HTTP 429: "Daily API request
     limit exceeded. Please try again tomorrow."`. Open-Meteo's gratis tier staat 10.000 aanroepen per
     dag (5.000/uur, 600/minuut) toe, geteld **per IP-adres**; Apps Script-verzoeken komen vanaf
     gedeelde Google-adressen, dus die ruimte deelt de app met wie er verder ook op zit. Daarom werkte
     het "soms wel, soms niet", ook voor jezelf op sommige dagen en tijdstippen, en ook in de webapp.
     Wat de app op zo'n moment nog bood: alleen de 10-minuten-cache en (sinds v82) de laatst bekende
     goede kopie, dus wie een locatie opvroeg waarvoor die kopie ontbrak, kreeg niets.

     Onze eigen bijdrage was onnodig groot: de cache (10 min) was korter dan het triggerinterval (15
     min), dus elke opwarm-ronde deed voor elke locatie opnieuw een echte aanroep — 11 per run, ~1.000
     per dag, meer als de aanvraag door het aantal variabelen zwaarder telt. Aanpassingen (v86):
     Open-Meteo-voorspelling 60 min in de cache (de modellen verversen hooguit ieder uur), Marine-data
     3 uur, en `warmWeerCache_` alleen tussen 06:00 en 18:00 (`WARM_START_MINUUT`/`WARM_EIND_MINUUT`) —
     samen grofweg een factor 10 minder aanroepen. Dat verkleint onze eigen bijdrage, maar kan de
     bijdrage van anderen op dezelfde IP's niet wegnemen; bij aanhoudende 429's blijft een tweede,
     gratis bron (Bright Sky/DWD) als reserve de logische volgende stap.

     **Achtste vervolg: reservebron, omdat een blokkade álles raakt.** De tweede run (11:49) liet met de
     per-aanvraag-log (`details`, v87) zien dat *alle* sleutels tegelijk met 429 faalden, ook de
     locaties van het eerste profiel in de run — dus geen verband met locatie, account of volgorde;
     in een blokkadeperiode raakt het iedereen. Tegen zo'n periode helpt minder aanroepen doen alleen
     niet meer (de limiet was al op), dus is er een reserve: **Bright Sky** (`api.brightsky.dev`, het
     Duitse DWD-model, gratis, zonder sleutel), getest met dezelfde velden als Open-Meteo, inclusief
     windvlagen en zicht. `parseBrightSkyForecast` (bronParsers.js) levert exact dezelfde vorm, dus de
     rest van de pijplijn merkt niets. Het wordt **alleen** gevraagd als de verse Open-Meteo-aanvraag
     faalt (of er hooguit een oude kopie is), niet als vervanging en niet bij elke run; een gebruiker die
     Open-Meteo uitzet krijgt het niet. Twee details: Bright Sky levert geen zonsopkomst/-ondergang,
     dus die worden berekend (`zonstand.js`, gecontroleerd tegen Open-Meteo: opkomst op de minuut,
     ondergang binnen 2 minuten); en de bron heet in de app eerlijk "DWD (reservebron)" i.p.v. dat het
     als Open-Meteo wordt voorgesteld (`hoofdbron` in forecastSamenstellen.js). Beperkt tot het gebied
     rond Nederland (`isInReserveBereik_`, tijdzone Europe/Amsterdam); zeewatertemperatuur/golven
     (Open-Meteo Marine) hebben geen reserve. `?actie=meldingen-status` telt per run hoe vaak de
     reserve inviel (`openMeteo.reserve`).

     **Negende vervolg: KNMI rechtstreeks onderzocht — nu niet bruikbaar voor voorspellingen.**
     De vraag was of KNMI's hoge kwaliteit (HARMONIE-AROME) rechtstreeks kan, zodat ook tijdens een
     Open-Meteo-blokkade dat model blijft. Bevindingen (KNMI Data Platform, sleutel per API apart
     aanvragen: Open Data, EDR en WMS zijn drie sleutels):
     - **Open-Meteo gebruikt voor Nederland zelf al KNMI's HARMONIE** voor de eerste ~3 dagen
       (getest: 48 van 48 uur identiek aan `models=knmi_harmonie_arome_netherlands`); daarna ECMWF.
       De app krijgt die kwaliteit dus al, zolang Open-Meteo antwoordt.
     - **Open Data API**: werkt, maar HARMONIE-bestanden zijn ~1 GB `.tar`-roosterbestanden;
       Apps Script (max. 50 MB per aanvraag, geen GRIB/HDF5) kan die niet verwerken.
     - **EDR API** (aanvraag per punt): 11 collecties, maar uitsluitend **waarnemingen** (10-minuten-,
       uur- en dagmetingen per station, incl. wind `ff`, vlagen `fx`/`gff`) en historische rasters;
       `wins50` is een reanalyse 2019-2021, géén voorspelling. Geen operationele puntvoorspelling.
     - **WMS** (`DATASET=knmi_ha43_nl_2p5km`): het model bevat wél alles wat we nodig hebben (o.a.
       `wind_speed_hagl`, `wind_speed_of_gust_01h_hagl`, `visibility_in_air_hagl`,
       `total_precipitation_accumulation_01h_hagl`), `GetFeatureInfo` (ook JSON) wordt ondersteund,
       maar de server meldt alle 70 lagen als "misconfigured" en elke puntopvraging als
       `Store has no results / InvalidDimensionValue` (ook met expliciete TIME/DIM_REFERENCE_TIME).
       KNMI's documentatie waarschuwt: "temporal coverage via WMS may be limited for some datasets";
       WMS is bovendien bedoeld voor kaartbeelden, niet voor gegevens.
     Fair use (KNMI FAQ): sleutel alleen server-side, responses cachen, niet vaker vragen dan het
     model ververst (uurlijks), oplopende wachttijd bij 429, bronvermelding CC BY 4.0, gebruik per
     account 3 maanden gelogd; quota 1.000 aanvragen/uur per sleutel (WMS 20/s). Besluit: niets
     gebouwd. Opties voor later: KNMI-waarnemingen via EDR als extra bron voor "nu", of de KNMI-WMS
     opnieuw testen wanneer KNMI de dataopslag vult.

     **Tiende vervolg: KNMI-metingen gebouwd** (`src/logica/knmiWaarnemingen.js`, gebruikersverzoek:
     een bron die niet wegvalt). De EDR-collectie `10-minute-in-situ-meteorological-observations` levert
     per officieel KNMI-station elke 10 minuten wind (`ff`, m/s op 10 m), windvlaag (`gff`),
     richting (`dd`), temperatuur (`ta`) en — als het station het meet — zicht (`vv`). Per spot
     wordt het dichtstbijzijnde station binnen 30 km gekozen (Rockanje → Hoek van Holland ~14 km,
     Berkel en Rodenrijs → Rotterdam Airport ~4 km) en de laatste meting (max. 1 uur oud) als
     "nu"-bron meegewogen, precies zoals Buienradar/Weerlive/RWS. **Beperking, bewust benoemd:** dit zijn
     *metingen*, geen voorspelling — ze verbeteren het actuele uur (en leveren als enige "nu"-bron een
     gemeten windvlaag), maar de tijdlijn komt nog steeds van Open-Meteo of de DWD-reserve. KNMI maakt de
     app dus nauwkeuriger voor "nu", niet onafhankelijk van een voorspellingsbron.
     Fair use (KNMI FAQ) is ingebouwd: sleutel alleen server-side (`KNMI_EDR_API_KEY`, anders
     `KNMI_API_KEY`, in Script Properties; nooit in code of log), metingen 10 minuten gecachet (= nooit
     vaker vragen dan de bron ververst) en gedeeld over alle accounts/spots bij hetzelfde station,
     stationlijst 6 uur gecachet, en bij HTTP 429 een **oplopende pauze** (15/30/60/120 min,
     `verhoogBackoff_`) waarin KNMI wordt overgeslagen. Quota: 1.000 aanvragen/uur per sleutel; wij
     doen er hooguit enkele tientallen. Aan/uit te zetten per gebruiker onder 🛰️ Databronnen; bron heet
     "KNMI (meting)"; bronvermelding (CC BY 4.0) staat in de voetregel. `?actie=meldingen-status` telt
     per run `knmiOk`/`knmiFout`.

     **Elfde vervolg: modeltoetsing en zichtbare meetpunten (v94-v96).** Twee dingen, beide op verzoek.
     *(1) Welke meetpunten?* Elk actueel-uur-station is nu zichtbaar: onder de detailweergave van
     *vandaag* staat "Actuele metingen van: KNMI Hoek van Holland (14 km, weerstation) · RWS … ·
     Buienradar …" (`meetpunten` per dag uit `haalWeerDataOp_`; afstand berekend met `afstandKm`).
     Alle bronnen kiezen het dichtstbijzijnde station; bij KNMI worden alleen stations in Nederland/de
     Noordzee gekozen (`isNederlandsGebied`: 50,7-55,8 N, 2,5-7,3 E, dus niet de drie Caribische
     BES-stations die in de KNMI-lijst staan). Gebruikt op dit moment: Hoek van Holland (~12-14 km van
     drie spots), Rotterdam Airport (~4 km) en Nieuwkoop (~11 km).
     *(2) Toetsing van de modellen* (`src/gas/Verificatie.gs` + pure logica in
     `src/logica/modelVergelijking.js`): tussen 06:00 en 12:00 legt de trigger per unieke NL-spot
     (max. 12, populairste eerst) vast wat **6 Open-Meteo-modellen** (KNMI HARMONIE, ICON, ECMWF, GFS,
     Météo-France, GEM; alle zes in **één** aanvraag via `models=`) plus **DWD** (Bright Sky) voor dag 1-7
     voorspellen (gemiddelde wind en hoogste vlaag 09-19 uur, knopen). De volgende dagen wordt de
     **gemeten** wind van het dichtstbijzijnde KNMI-station (EDR, één dag-aanvraag per station per dag,
     verificatie in productie bevestigd: 66 tienminutenwaarden) ernaast gelegd. Opslag: Drive-bestand
     `kiteweer-verificatie.json` (id in Script Property `VERIFICATIE_BESTANDS_ID`; bewust buiten de
     profielenmap), 45 dagen bewaard; lezen mag nooit stil mislukken (anders overschrijft de volgende
     schrijfactie de opgebouwde data met een leeg bestand). Kosten: ≤12 Open-Meteo- en een paar KNMI-
     aanvragen per dag; `VERIFICATIE_STATUS` (`klaarOp`) voorkomt dat de 15-minutentrigger de rest van de
     ochtend nog Drive/KNMI raakt. **Rapport:** `?actie=verificatie` (publiek, alleen stations en
     statistiek, geen profiel- of spotgegevens): per station naam/soort/coördinaten/`inNederland`, en per
     voorspeldag-vooruit en model bias en gemiddelde absolute fout (wind + vlaag), plus `perModel` over
     alle stations. Na 1-2 weken (n ≥ ~10 per cel) is hieruit te lezen welk model op welke voorspeldag
     het best zit; daarop volgt een consensus/weging voor dag 3-7 (nog niet gebouwd — bewust pas na data).
     *(3) Indicatief:* vanaf de 5e dag toont de app een "indicatief"-label (+ uitleg in het detail) en de
     Telegram-dagbalk "· indicatief" achter het oordeel (`INDICATIEF_VANAF_DAGINDEX = 4`).

Beide vormen draaien via dezelfde `src/gas/Meldingen.gs` (`controleerEnStuurMeldingen`, via één
**kwartier**-trigger — zie SETUP.md, die zelf per profiel bepaalt of het gekozen tijdstip
gepasseerd is en of er vandaag al een samenvatting uitging. Een uur-trigger volstaat niet meer nu
het tijdstip tot op de minuut instelbaar is: 08:05 zou dan nooit binnen redelijke tijd vallen.
Vaker draaien geeft geen dubbele berichten, `laatsteSamenvattingDatum` bewaakt dat). Alleen gestuurd
naar wie de bot gekoppeld heeft (zie hieronder) — zonder gekoppeld Telegram-chat-ID krijgt een
profiel geen van beide.

### Cache-opwarming (voorkomt trage koude starts)

`controleerEnStuurMeldingen` roept, vóór de per-profiel meldingen-afhandeling en **ongeacht**
meldingen-instellingen of de nachtrust hierboven, `warmWeerCache_` aan: die ververst voor élke
favoriete locatie van élk profiel de `CacheService`-cache (10 minuten geldig, zie
`WEER_CACHE_SECONDEN` in `WeerData.gs`) door gewoon `bepaalDagOordelenVoorLocatie_` aan te roepen en
het resultaat weg te gooien — puur voor het neveneffect. Aanleiding (gebruikersvraag): de webapp
zelf voelde traag aan bij een koude cache, met name bij het wisselen naar een favoriete locatie die
nog niet recent bekeken was — `kiesLocatie` in `JavaScript.html` haalt namelijk uitsluitend de
aangeklikte locatie op, nooit de andere favorieten alvast op de achtergrond (bewust simpel
gehouden, zie hieronder). Met de kwartier-trigger die nu élke favoriete locatie warm houdt, treft
een normale paginalaad/locatiewissel meestal al warme cache, ongeacht welke locatie het is.

Twee dingen die dit niet oplost, bewust:
- **Cold start van de Apps Script-executie zelf** (na een nieuwe deployment, of na lange
  inactiviteit) is een platform-eigenschap van Apps Script — elke aanroep (`doGet`,
  `google.script.run`, een trigger) is een eigen, geïsoleerde executie; er is geen "warme server"
  om aan te sturen vanuit code. `warmWeerCache_` verkort alleen de trage **data**-ophaal-stap erna,
  niet de opstart van de executie zelf.
- **Client-side vooraf ophalen van de niet-geopende favorieten** (in de browser, meteen na het
  laden) is bewust niet gebouwd — de server-side cache-opwarming dekt hetzelfde geval al af zonder
  extra RPC-rondjes vanuit de client, en zonder dat elke paginalaad zelf meer bronnen hoeft te
  raadplegen dan de ene locatie die je daadwerkelijk bekijkt.

Cachesleutels bevatten geen gebruikers-ID (alleen brontype + lat/lon + `dagenVooruit`, zie
`cacheSleutel_`), dus meerdere profielen met dezelfde locatie warmen elkaars cache gratis mee — geen
dubbele externe aanroepen. Bij de huidige schaal (enkele profielen/locaties) is de extra belasting
van deze onvoorwaardelijke opwarm-ronde verwaarloosbaar; bij veel meer profielen zou dit opnieuw
bekeken moeten worden (bv. per-locatie-dedup, of alleen locaties opwarmen die recent daadwerkelijk
bekeken zijn).

**Bijwerking (betrouwbaarheidsscan): Weerlive's gratis quotum (300/dag) kwam dichterbij dan
bedoeld.** Omdat de standaard cache (`WEER_CACHE_SECONDEN`, 10 minuten) kórter is dan het
kwartier-triggerinterval, was élke opwarm-ronde voor déze bron alsnog een échte externe aanroep —
bij 2 locaties al ~192/dag, bij 4 al over de grens. Fix: Weerlive krijgt een eigen, langere cache
(`WEERLIVE_CACHE_SECONDEN`, 25 minuten, via een nieuw optioneel `cacheSeconden`-veld per taak in
`voerBatchOp_`) — ruim boven het kwartier-interval, dus de meeste opwarm-rondes treffen nu een
cache-hit i.p.v. een nieuwe aanroep. Kost een iets ouder momentopname van déze ene bron; de andere
bronnen blijven op 10 minuten.

### Profiel-opslag: lock tegen gelijktijdig schrijven

Bijwerking (betrouwbaarheidsscan): `slaProfielOp_` (ProfielOpslag.gs) was een kale
read-modify-write tegen het Drive-bestand, zonder enige bescherming tegen gelijktijdige schrijvers
— vijf verschillende plekken konden hetzelfde profiel-bestand aanraken (`saveProfiel`,
favoriete-locatie toevoegen/verwijderen, de meldingen-trigger, en het Telegram-koppelen), en wie
het laatst schreef won, de rest verdween stilzwijgend. Dezelfde bugklasse als de eerder gefixte
dubbele-alert-race, maar dan tussen de webapp en de trigger (of twee webapp-acties) i.p.v. tussen
twee trigger-runs.

Fix: **`wijzigProfielMetLock_`** (ProfielOpslag.gs) — pakt de script-lock, leest het profiel dan
VERS van schijf (niet een mogelijk verouderde in-memory kopie die de aanroeper toevallig bij de
hand had), past een meegegeven functie toe, en slaat het resultaat op, allemaal binnen de lock.
Gebruikt door: favoriete locatie toevoegen/verwijderen, de directe-alert-claim-stap en de
samenvatting-afrondingsvlag (Meldingen.gs), en het Telegram-koppelen (TelegramBot.gs). `saveProfiel`
zelf gebruikt 'm bewust niet — de client stuurt al een compleet gewenst eind-profiel mee (geen
transformatie op een vers gelezen profiel), dus een her-lees-patroon is daar niet zinvol; een lock
rond alleen de schrijfactie zelf beschermt daar wél tegen letterlijk gelijktijdig schrijven, maar
niet tegen een client die met een verouderde momentopname werkte (een client-side versienummer zou
dat wél oplossen, maar is voor de huidige schaal niet gebouwd).

**Bewust geen lock meer rond de hele `controleerEnStuurMeldingen`-functie-body** (dat was de
eerdere fix voor de dubbele-alert-race bij overlappende trigger-runs). Zo'n lock rond de hele —
soms tientallen seconden durende — trigger-run zou ook elke webapp-opslagactie laten wachten zodra
die toevallig samenviel met een trigger-run, een véél vervelendere vertraging dan de zeldzame race
die het voorkwam. De fijnmazige `wijzigProfielMetLock_`-aanroepen lossen dezelfde race net zo goed
op (de verstuur-beslissing gebeurt altijd op een vers, lock-beschermd gelezen profiel) zonder de
trage delen (weerdata ophalen, Telegram versturen) ook onder de lock te hoeven houden. Overlappende
trigger-runs doen daardoor soms dubbel werk (redundante, door caching goedkope weerdata-aanroepen)
maar sturen nooit meer dubbele berichten. Een snelle, ongelockte voorcheck in `verwerkDirecteAlert_`
(`heeftMogelijkNieuws`) voorkomt bovendien dat élke locatie op élke trigger-run de lock+her-lees-stap
doorloopt als er overduidelijk niets veranderd is.

**Instellingen opslaan geeft nu een zichtbare bevestiging** (de "Opslaan"-knop toont ~0,9s
"✓ Opgeslagen" voor het paneel sluit) — voorheen sloot het paneel meteen en onopvallend, wat het
ten onrechte deed lijken alsof de opslag mislukt was. Een concrete valkuil bij het testen van de
dagelijkse samenvatting: `laatsteSamenvattingDatum` blokkeert een **tweede** samenvatting op
dezelfde dag, dus als er al een 08:00-bericht is verstuurd, doet het wijzigen van het tijdstip naar
"over 5 minuten" die dag niets meer — dat is geen bug, maar wel makkelijk te verwarren met "de
instelling is niet opgeslagen". Test daarom pas de volgende dag, of reset `laatsteSamenvattingDatum`
handmatig in het profielbestand.

### Grafiek + bijschrift in Telegram-berichten

Elk foto+bijschrift-bericht (`verstuurDagBericht_`, Meldingen.gs) bestaat uit twee losse, pure
onderdelen:

- **De grafiek** (`bouwDagGrafiekBlob_`, Meldingen.gs) — visueel identiek aan de Grafiek-tab in de
  webapp: balken = windsnelheid (kn), kleur = score, grijze lijn = windvlagen, 💧+mm boven een uur
  met ≥ 0,2 mm regen. Getekend met **Google Slides-vormen** (rechthoeken + lijnen + tekstvakken op
  een presentatie) en geëxporteerd als PNG, **niet** met Apps Script's ingebouwde `Charts`-service:
  die kan geen staafdiagram en lijndiagram in één afbeelding combineren
  (`Object.keys(Charts)` heeft alleen Area/Bar/Column/Line/Pie/Scatter/Table, geen ComboChart), en
  Apps Script heeft geen eigen rendering-/browser-engine om de webapp zelf te "screenshotten" (een
  externe headless-browserdienst is bewust afgewezen, zelfde privacy-afweging als de
  QuickChart.io-afwijzing hieronder bij "Aannames"). Twee niet-voor-de-hand-liggende addertjes
  onder het gras, live ontdekt:
  - `Presentation` heeft **geen** `setPageWidth`/`setPageHeight` (alleen getters) — de layout
    (`GRAFIEK_BREEDTE_` etc.) is daarom afgestemd op de vaste default-paginagrootte (720×405 pt).
  - **`presentatie.saveAndClose()` is verplicht vóór de PNG-export**, anders geeft zowel de
    `/export/png`-URL als `DriveApp.getThumbnail()` een **blanco** afbeelding terug (de
    exportendpoints lezen de laatst-*opgeslagen* versie, niet de sessie-editbuffer). Zichtbaar aan
    een byte-count die pas na deze fix meestijgt met de inhoud.
  - Vereist een eigen, eenmalige OAuth-autorisatie (`…/auth/presentations`) die de bestaande
    Drive/UrlFetch/Triggers-grant niet dekt — vandaar `autoriseerSlidesToegang()` in `Setup.gs`,
    zie SETUP.md stap 3b. Zonder die stap faalt elke grafiek-poging geruisloos en valt het bericht
    terug op tekst-only.
- **Het bijschrift** (`formatDagBalkTekst`, `src/logica/telegramFormat.js`, puur/unit-getest) —
  kop (kleur + locatie + dag-label + datum) en verdict+score op eigen regels, dan wind/weer/
  getij/zonsondergang als losse `•`-opsommingsregels (i.p.v. één met " · " aan elkaar geplakte
  regel — op gebruikersverzoek, beter leesbaar in de smalle Telegram-bijschriftweergave), dan een
  lege regel en de samenvattingszin.

### Telegram-bot als meldingskanaal (optioneel)

De eerder aangemaakte bot (@ShouldIKite_bot) wordt **niet** gebruikt als Mini App (zie
"Aannames" #1), maar als het enige meldingskanaal (`src/gas/TelegramBot.gs`, via een
Telegram-webhook op `doPost` in Code.gs):

- **"🔗 Koppel aan Telegram" bij ⚙️ Instellingen** (zichtbaar zolang er nog geen Telegram
  gekoppeld is) → een echte, klikbare Telegram "deep link"
  (`t.me/ShouldIKite_bot?start=<gebruikerId>`, opgebouwd in `JavaScript.html`:
  `telegramKoppelLink()`) die Telegram opent met `/start <gebruikerId>` als berichttekst. De bot
  herkent die payload en koppelt dit chat-ID aan **dat bestaande profiel** — je browser-favorieten
  en -instellingen blijven dus intact, in plaats van een nieuw los profiel.
- **De bot rechtstreeks starten** (zonder deep link, bv. via `t.me/ShouldIKite_bot`) → een
  **nieuw**, los profiel wordt aangemaakt en aan de chat gekoppeld; de bot stuurt de link naar dát
  nieuwe profiel terug (met een hint om in plaats daarvan de koppel-knop vanuit een bestaand
  profiel te gebruiken).
- **Elk uur** → `Meldingen.gs` controleert per profiel of de directe alert een match heeft en/of
  "nu" het gekozen samenvattingsuur is (zie "Meldingen" hierboven), en stuurt zo nodig naar het
  gekoppelde chat-ID.

Een chat-ID hoort maar bij één profiel tegelijk: koppel je een tweede profiel aan dezelfde chat
(bv. eerst de bot rechtstreeks gestart, later alsnog via de knop vanuit je browser-profiel), dan
wordt de oudere koppeling losgemaakt (`telegramChatId` op dat profiel wordt weer `null`) — dat
profiel blijft verder gewoon bestaan, alleen zonder Telegram-meldingen.

Vereist alleen `TELEGRAM_BOT_TOKEN` in Script Properties (zie SETUP.md). De webhook-registratie —
die Telegram vertelt de botberichten naar `doPost` te sturen — is **zelfherstellend**:
`zorgVoorTelegramWebhook_` (TelegramBot.gs) controleert bij elke trigger-run of de webhook nog naar
déze deployment wijst en zet hem anders opnieuw, hooguit één API-call per 6 uur (cache-vlag).
Dit was eerst een eenmalige handmatige editor-run (`registreerTelegramWebhook`) en dat is precies
misgegaan: de webhook stond nooit aan, waardoor koppelen **stil** faalde — geen foutmelding, alleen
nooit een bericht. Voor een handmatige controle/reparatie is er `?actie=onderhoud` op de webapp-URL
(zie hieronder).

Bij het (her)instellen gaat `drop_pending_updates=true` mee. Zonder dat komt een opgespaarde
wachtrij aan updates in één keer binnen als een berichtenstorm — wat hier daadwerkelijk gebeurde
(zie "Dubbele Telegram-antwoorden" hieronder).

### `?actie=onderhoud` — zelfcontrole vanaf de webapp-URL

`https://…/exec?actie=onderhoud` zet de webhook én de meldingen-trigger terug als ze ontbreken, en
geeft de status als JSON terug. Beide acties zijn idempotent en geven niets gevoeligs prijs (de
webhook-URL is de publieke webapp-URL; het bot-token komt er niet in voor), dus de route mag
publiek zijn. De trigger wordt **altijd** opnieuw gezet: de ScriptApp-API kan van een bestaande
trigger niet uitlezen hóe vaak hij draait, dus een achtergebleven uur-trigger uit een oudere versie
is niet te herkennen — en die zou het per-minuut instelbare samenvattingstijdstip stilletjes
onbruikbaar maken.

Achterliggende afweging: alles wat buiten de code om handmatig ingesteld moest worden, stond in de
praktijk niet aan en faalde zonder signaal. Zulke setup-stappen horen daarom in code, controleerbaar
via een URL, niet in een handleiding.

### Dubbele Telegram-antwoorden ("het is al gekoppeld", in een lus)

Telegram verwacht binnen korte tijd een HTTP 200 op een webhook-update en **stuurt dezelfde update
opnieuw** als die uitblijft. `vindGebruikerIdVoorTelegramChatId_` las daarvoor álle profielen in om
één chat-ID te vinden; bij genoeg profielen duurde dat te lang, waarna Telegram bleef herhalen en de
gebruiker het antwoord "je bent al gekoppeld" telkens opnieuw kreeg. Drie lagen erop:

1. **Idempotentie op `update_id`** (`telegramUpdateAlGezien_` in Code.gs, CacheService, 6 uur): een
   herhaalde update wordt herkend en met een lege 200 afgedaan.
2. **Omgekeerde index** `tg_chat_<chatId>` → `gebruikerId` in Script Properties, zodat opzoeken één
   property-read is i.p.v. een volledige profielscan — de eigenlijke oorzaak van de traagheid.
3. **Cooldown van 60 s** (`recentAlGeantwoord_`) op het "al gekoppeld"-antwoord, zodat een
   resterende herhaling hooguit stil wordt genegeerd i.p.v. opnieuw beantwoord.

### "Je hebt al een profiel gekoppeld" — elke ~6 uur, zonder aanleiding

Ander patroon dan hierboven (die cooldown is 60s, dit gebeurde uren na elkaar): een gebruiker bleef
het "al gekoppeld"-bericht periodiek terugkrijgen zonder zelf iets gedaan te hebben. Oorzaak: een
losstaande, half opgeloste variant van hetzelfde "Telegram herhaalt een onafgeleverde update"-
probleem als hierboven, maar dan op Telegrams **eigen, veel tragere** hersteschema (in de orde van
uren, niet seconden) i.p.v. de snelle terugval die de bovenstaande drie lagen al dekken.

`getWebhookInfo` liet zien: `pending_update_count: 1` en `last_error_message: "Wrong response from
the webhook: 302 Found"` — Apps Script's webapp-hosting gaf op het moment van bezorgen kennelijk een
302-redirect terug in plaats van een direct antwoord (dezelfde eigenaardigheid als bij `doGet`, zie
Code.gs); Telegram volgt zo'n redirect niet voor webhook-bezorging, beschouwt de bezorging als
mislukt, en blijft die ene vastzittende update op een eigen backoff-schema herproberen (in de
praktijk zo'n eens per ~6 uur) — net zo lang tot de wachtrij expliciet geleegd wordt.

`zorgVoorTelegramWebhook_` deed dat al (`drop_pending_updates=true`), maar **alléén** in de tak waar
de webhook-URL zelf niet klopte. Stond de URL al goed (de gebruikelijke situatie, "stond-al-goed")
dan werd de wachtrij nooit gecontroleerd of geleegd, hoeveel vastzittende updates er ook stonden —
precies dít geval dus. Fix: de "stond-al-goed"-kortsluiting controleert nu ook
`pending_update_count`; staat die boven 0, dan wordt (met dezelfde, al-correcte URL)
`drop_pending_updates=true` alsnog uitgevoerd. `?actie=onderhoud` toont het resultaat als
`"reden": "wachtrij-geleegd"` i.p.v. het misleidende "opnieuw-ingesteld" (de URL verandert in dit
geval niet, alleen de wachtrij wordt leeggemaakt).

### Dagvenster (instelbaar)

Welke uren van de dag meetellen bij het dagoordeel (`berekenDagScore`) én bij het checken van de
meldingsregel — instelbaar via ⚙️ Instellingen, standaard **09:00-20:00**, gelijk aan het vaste
weergavevenster van de uur-grafiek (zie hieronder). I.t.t. de blanco drempelwaarden (zie
"Aannames" #11) heeft dit wél een concrete default, omdat expliciet als zodanig opgegeven.

### Voorspellingshorizon (instelbaar)

Hoeveel dagen vooruit een weeroordeel getoond wordt — instelbaar via ⚙️ Instellingen
(`profiel.dagenVooruit`, standaard **3**, geklemd tussen 1 en 10, zie
`profielValidatie.valideerDagenVooruit`). Alleen Open-Meteo (`forecast_days`) en RWS (de
opgevraagde periode in `rwsWaarnemingenTaak_`) schalen daadwerkelijk mee; Buienradar/Weerlive zijn
sowieso alleen een "nu"-snapshot en Windfinder levert altijd zijn eigen, vaste (kortere) horizon.
Bronnen met een kortere horizon dan de ingestelde `dagenVooruit` vallen voor de verdere dagen
simpelweg weg uit `bronnenMiddeling.js` (ontbrekende bron, niet als 0 meegeteld) — **niet
stilzwijgend**: `Code.gs` (`getWeerOordeel`) berekent per dag, via
`forecastSamenstellen.windBronnenVanDag`, welke wind-databronnen die dag daadwerkelijk hebben
bijgedragen, en de app toont dat als regel ("Wind-databronnen voor deze dag: ...") bovenin het
uitklapmenu van elke dag — zo is voor de gebruiker concreet zichtbaar wanneer een verdere dag op
minder bronnen (en dus minder betrouwbaar) draait, i.p.v. dat aan te moeten nemen.

### Grafiek-venster (vast, niet instelbaar)

De uur-grafiek in het dagdetail toont bewust alleen 09:00-20:00 (`GRAFIEK_START_UUR`/
`GRAFIEK_EIND_UUR` in `JavaScript.html`), los van het Dagvenster hierboven — 's nachts is er toch
nooit een bruikbaar moment, dat maakt de grafiek onnodig lang. **De Tabel-weergave gebruikt
sindsdien hetzelfde venster** (was eerst alle 24 uur — voegde niets toe naast de balkjes/Berekening,
zie hieronder); de Berekening-weergave toont nog altijd alleen het beste uur van de dag.

De balkhoogte in de grafiek is **windsnelheid** (kn) — waar een kitesurfer als eerste naar kijkt —
met de **windvlagen als lijn** eroverheen op exact dezelfde kn-schaal (`bouwGrafiekVlaagLijnSvg`
in `JavaScript.html` krijgt `maxKn` mee i.p.v. eigen schaling: alleen dán is de afstand tussen
balk en lijn een eerlijke maat voor hoe vlagerig het is). De balk-kléur blijft de score/no-go, en
de y-as staat in knopen. Temperatuur is bewust uit de grafiek gehaald — die zei weinig over de
vraag of je kunt kiten en verdrong de twee grootheden die er wél toe doen.

**De "Vlaag"-kolom toont alleen de kn-waarde**, geen vlaagfactor-percentage meer
(`formatVlagTekst` in `JavaScript.html`) — dat percentage (hoe ver de vlaag relatief boven het
gemiddelde uitkomt) wordt intern nog gebruikt voor de score/no-go-drempel
(`drempelwaarden.js`), maar voegde als los getal in de Tabel niets toe naast het gewone kn-getal
en verwarde meer dan het hielp (gebruikersfeedback).

**De Tabel is standaard ingeklapt tot het huidige uur.** Uren die al voorbij zijn (vergeleken met
de actuele klok, dus alleen relevant bij de dag van vandaag) staan achter een "▸ N afgelopen uren
tonen"-knop bovenaan de tabel (`bouwUurTabel` in `JavaScript.html`) — voor "moet ik nu naar het
strand" tellen ze toch niet meer mee, en bij een laat bezoek vulden ze een groot deel van de tabel.
Bij morgen/overmorgen ligt geen enkel uur nog in het verleden, dus is er simpelweg niets om in te
klappen en verschijnt de knop niet.

Boven de grafiek staat per uur een **💧-druppel met de neerslag in mm** (`neerslagMm`, uit
Open-Meteo's `precipitation`), alleen bij ≥0,2 mm — daaronder is het motregen en zou vrijwel elk
uur een druppel krijgen. Bewust mm en niet alleen de neerslagkans: "70% kans" zegt niets over
hóeveel er valt, en juist dat bepaalt of een sessie nog leuk is. Buienradars raintext geeft ook
mm maar slechts ~2 uur vooruit, dus die dekt de ingestelde horizon niet.

### Radar-tabblad (alleen bij vandaag)

Naast Grafiek/Tabel/Berekening staat bij de dag van vandaag een **🌧️ Radar**-tabblad: een
geanimeerde neerslagradar **rond de gekozen spot**, van nu tot **2,5 uur vooruit** in stappen van
10 minuten, met speel/pauze-knop en per beeld het tijdstip ("17:40 (+1u10)"). Alleen bij vandaag —
onder een toekomstige datum zou een radarbeeld misleidend zijn.

De `+X` in het label is de stap binnen de reeks (0, +10, +20, …), niet het verschil met de klok op
dat moment. Buienradar publiceert alleen op hele 5 minuten, dus het eerste beeld is tot 5 minuten
oud; gerekend vanaf "nu" werd de eerste sprong daardoor bijvoorbeeld +12 en de rest +15, wat eruit
zag als een fout terwijl de beelden keurig even ver uit elkaar lagen. Het getoonde kloktijdstip is
en blijft exact, dus er gaat geen informatie verloren.

Opbouw (`bouwRadarWeergave` in `JavaScript.html`): een raster OpenStreetMap-tegels als scherpe
ondergrond, met daarover per tijdstap een **transparant** radarbeeld van Buienradar. Alle lagen
staan tegelijk in de DOM en alleen de `opacity` wisselt — dat animeert vloeiend zonder per stap
opnieuw te laden. Bewust zonder kaartbibliotheek (Leaflet e.d.): een raster tegels plaatsen is een
handvol regels en scheelt een externe afhankelijkheid binnen de HtmlService-iframe.

#### Waarom deze constructie — twee eerdere pogingen werkten niet

Geen enkele gratis bron levert kant-en-klaar "toekomst én ingezoomd":

- **Buienradars animatie-GIF** toont wél de toekomst maar is **niet in te zoomen**: hun
  `lat`/`lon`/`zoom`/`bbox`-parameters worden genegeerd (live geverifieerd — identieke bytes terug,
  en `zoom=6`, `zoom=9` en `zoom=12` geven exact hetzelfde beeld), en het resultaat blijft altijd
  550×512 pixels, wat je ook opvraagt. Dat gaf een Nederland-brede kaart waarop je je eigen spot
  moest zoeken.
- **RainViewer-tegels** kunnen wél inzoomen, maar hun gratis API levert **nul nowcast-frames**
  (`radar.nowcast: []`, herhaald gecontroleerd) en het nieuwste beeld liep ~10 minuten achter. Die
  weergave toonde dus uitsluitend het verleden — voor "kan ik zo het water op?" waardeloos.

Wat beide problemen oplost: Buienradars **losse-beeld-endpoint** accepteert een `timestamp` (UTC,
`yyyyMMddHHmm`, stappen van 5 minuten) en geeft dat beeld **ook voor tijdstippen in de toekomst**,
tot ~170 minuten vooruit (daarboven een HTTP 400 — live afgetast). Met `renderBackground=false`
komt het als transparante laag terug. Daarmee bepalen wij de uitsnede in plaats van de bron: we
leggen het beeld over een eigen, correct gepositioneerde kaart en centreren op de spot.

#### De hoekcoördinaten van het radarbeeld (en hoe die zijn vastgesteld)

Om het radarbeeld op de kaart te leggen moet je weten welk gebied het beslaat. Buienradar
documenteert dat nergens, en het is niet te raden. De waarden in `RADAR_BEELD` zijn daarom
empirisch bepaald:

1. Een eerste fit op de **gele stationsstippen** in het beeld, gekoppeld aan de coördinaten uit
   `data.buienradar.nl` — die kwam niet betrouwbaar uit (twee varianten van de fit lagen 57 km uit
   elkaar), dus die uitkomst is verworpen.
2. De fit is toen vastgezet op een **consistente Web Mercator** met drie vrijheidsgraden
   (middelpunt + schaal). Een 4-parameterfit gaf 14% scheefheid tussen de horizontale en verticale
   schaal, wat betekent dat zo'n oplossing per definitie geen echte Mercator-uitsnede kan zijn.
3. De uitkomst is daarna **onafhankelijk geverifieerd**: van zowel het radarbeeld als van een uit
   OSM-tegels samengestelde referentie voor dezelfde uitsnede is een land/zee-masker gemaakt, en
   vervolgens is gezocht bij welke verschuiving de overlap maximaal is. Die zoektocht wees eerst
   een afwijking van 5×3 pixels (7,4 km) aan; ná correctie komt hij uit op **nul pixels
   verschuiving**. Het beeld valt dus samen met de kaart tot op minder dan één beeldpixel (~1,3 km).
   Dezelfde controle op een frame uit de animatie geeft ook nul — animatie en los beeld delen
   dezelfde geometrie.

De vastgestelde hoeken: `lonW=-0.0363, lonE=10.1331, latN=55.0055, latS=49.2013`, bij 550×512
pixels, oftewel ~1,27 km per beeldpixel.

Op de gebruikte kaartzoom (OSM zoom 8, ~0,38 km/px) wordt het radarbeeld ~3,4× uitvergroot. Dat
oogt zacht, maar verliest geen echte informatie: radardata is toch ongeveer kilometerresolutie en
buien hebben geen scherpe randen. De kaart eronder blijft scherp, en dat is wat het beeld leesbaar
maakt.

#### "Heel Nederland"-knop

Naast de ingezoomde weergave rond de gekozen spot staat een knop **🗺️ Heel Nederland** die
omschakelt naar Buienradar's eigen, volledig gestylede kaartbeeld van heel Nederland (dezelfde
groen/blauwe kaart met provinciegrenzen en tijdstempel als op buienradar.nl zelf).

Een **eerste versie reconstrueerde dit zelf** uit dezelfde OSM-tegels als de ingezoomde weergave,
uitgezoomd en teruggeschaald tot het hele `RADAR_BEELD`-gebied paste. Gebruikersfeedback na het
uittesten: *"Dit lijkt wel een andere type map, ik dacht dat je ook gewoon de buienradar map van
Nederland zelf had?"* — terecht, een OSM-reconstructie oogt onvermijdelijk anders dan de vertrouwde
buienradar.nl-styling. Losse-beeld-endpoint (`RadarMapRainNL`, dezelfde bron als de ingezoomde
transparante laag hierboven) blijkt **ook zónder** `renderBackground=false&renderBranding=false&
renderText=false` te werken — dan komt Buienradar's eigen volledige beeld terug in plaats van de
transparante overlay. Geen tegels, geen transform-rekenwerk: dit ene beeld ís de hele kaart al
(`radarBeeldUrlVolledig_` in `JavaScript.html`).

Die bron blijkt echter, net als de animatie-GIF hierboven, **de opgevraagde `w`/`h` te negeren**:
de redirect naar `image-cdn.buienradar.nl` wijst altijd naar een vast `..._550x512_..._c.png`-
bestand, wat je ook opvraagt. Dat vaste beeld toont van zichzelf een breder gebied dan alleen
Nederland — een flink stuk Engeland, België en Duitsland — wat na de eerste deploy als "erg ver
uitgezoomd... grote delen van België en Duitsland" werd gerapporteerd. Bijgesneden via CSS
(`.radar-beeld-vol` in `Stylesheet.html`).

Twee mislukte pogingen onderweg, allebei pas ontdekt door de fout zelf, niet vooraf bedacht:

1. Een eerste, gecentreerde uitvergroting (135%) sneed Engeland er al uit maar liet nog forse
   stroken België/Duitsland staan.
2. Een **niet-uniforme** uitvergroting (190% breed, 155% hoog, naar rechtsonder verschoven i.p.v.
   gecentreerd) verwijderde die stroken wél, maar rekte de kaart daarbij oost-westelijk merkbaar
   verder op dan noord-zuid — zichtbaar scheefgetrokken (gebruikersrapport: "ik vind hem er nu wat
   lelijk uitzien") én, erger, het verschuiven naar de hoek liet Groningen, Drenthe, Overijssel en
   de Achterhoek gewoon **buiten beeld vallen**. Dat laatste bleef onopgemerkt tot een volgende
   testronde toevallig wél het complete kader in een schermafbeelding liet zien — de eerdere
   goedkeuring was gebaseerd op een afgekapt beeld waarvan de onderkant buiten het zichtbare
   viewport van die test viel.

De huidige versie is een **uniforme** 1,4× uitvergroting, gecentreerd (`width`/`height` altijd
gelijk houden is hier de kern van de fix). Dat laat een dunne, herkenbare rand van de buurlanden
staan — vergelijkbaar met hoe de echte buienradar.nl-weergave zelf bijsnijdt — zonder enige
vervorming en zonder een stuk Nederland te amputeren. Empirisch bepaald: meerdere crop-instellingen
naast elkaar tegen de live afbeelding vergeleken, dit keer met het complete kader gecontroleerd
zichtbaar in elke test. De locatie-marker (rode stip) heeft in deze weergave geen zinvolle positie
(Buienradar's beeld heeft geen vaste, bekende pixel-grens) en wordt daarom verborgen.

#### Beperkingen

- **Verder dan ~2,5 uur kan een radar niet kijken.** Een neerslagradar *meet* actuele neerslag en
  extrapoleert hooguit een korte nowcast; een radarbeeld voor de hele dag bestaat niet. Voor de rest
  van de dag is de **regenverwachting per uur (💧 mm in de Grafiek)** de juiste bron — die dekt wél
  de volledige ingestelde horizon.
- **Dataverbruik.** Zestien frames van ~80 KB plus zestien kaarttegels: ongeveer 1,3 MB. Wie dit
  wil terugbrengen, zet `RADAR_STAP_MIN` hoger — dat kost alleen vloeiendheid, niet de horizon.

#### Voorladen

Die 1,3 MB wordt **op de achtergrond opgehaald zodra de dagkaarten staan** (`voorlaadRadar`), niet
pas bij het klikken op het tabblad. Dat kan alleen omdat beide bronnen cachebaar antwoorden — dat
is nagemeten: Buienradar stuurt `Cache-Control: public, max-age=300` en OpenStreetMap ruim een week.

Twee details die nodig zijn om het te laten wérken:

- **De framelijst is gememoiseerd per 5-minutenblok** (`radarFramesVoor`). Zonder dat berekent het
  tabblad een paar minuten na het voorladen andere tijdstempels — andere URL's, dus een lege cache
  en alsnog wachten. Voorladen en opbouwen delen daarom één lijst én één set URL-bouwers.
- **De volgorde is bewust**: eerst het beeld van *nu* (dat toont het tabblad als eerste), dan de
  kaarttegels, dan pas de rest van de vooruitblik.

Het ophalen gebeurt in vier parallelle stromen en start pas via `requestIdleCallback` (terugval:
een korte vertraging), zodat het weeroordeel en de zichtbare kaarten voorrang houden. Bij
`saveData` of een 2G-verbinding wordt er **niet** voorgeladen — daar is ongevraagd megabytes
ophalen schadelijker dan de wachttijd.

Bij het openen toont het tabblad het eerste beeld zodra dát binnen is; de animatie start pas als
alle frames er zijn, anders loopt hij langs frames die nog ontbreken en flitst er telkens een kale
kaart voorbij. Gemeten met warme cache: **0 bytes van het netwerk** en ~0,6-0,8 seconde tot het
eerste beeld — die resterende tijd is het decoderen van zestien PNG's, niet het ophalen.
- **De bron hapert af en toe** (incidentele HTTP 502). Een frame dat niet laadt, wordt overgeslagen
  (`.radar-beeld.mislukt`) én door de animatie overgeslagen (`volgendeIndex`), zodat er geen lege
  kaart tussendoor flitst.

Bronvermelding voor Buienradar en OpenStreetMap staat onder de kaart (voorwaarde voor gratis
gebruik van OSM-tegels).

### Weer-badge (bewolking/neerslag/onweer)

Naast wind en getij toont elke dagkaart en Tabel-rij ook een weer-badge — voorheen nergens
zichtbaar, ook al werden `neerslagKans` en `onweerAanwezig` al wel gebruikt vóór de score
(`evalueerOnweer` in `drempelwaarden.js`) en werd `bewolkingPercent` uit Open-Meteo geparseerd
maar daarna zonder gebruik weggegooid. Prioriteit (zie `bouwWeerBadgeHtml` in `JavaScript.html`):
⛈️ bij onweer, anders 🌧️ + percentage bij een neerslagkans ≥30%, anders een zon/wolk-icoon naar
gelang bewolkingspercentage. Let op: het 🌇-icoon naast de zonsondergangstijd is **geen**
weersindicatie — dat toont alleen het tíjdstip van zonsondergang, elke dag, ongeacht bewolking of
regen (licht te verwarren mee, vandaar deze expliciete vermelding).

### Widget-JSON-endpoint (voor Tasker en vergelijkbare clients)

`?actie=widget&id=<gebruikerId>` (optioneel `&locatie=<locatieId>`, anders de eerste favoriet) op
dezelfde `/exec`-URL geeft een platte JSON-samenvatting terug — bedoeld voor een client die geen
`google.script.run` kan gebruiken (dat vereist de HtmlService-pagina zelf), zoals een Android
Tasker-taak die een homescreen-widget bouwt. Zie `widgetJson_` in `Code.gs`. De `&id=` is meteen
ook de personalisatie: elke gebruiker plakt zijn eigen `gebruikerId` (dezelfde UUID als in de
bewaar-link van de webapp) in zijn eigen Tasker-taak, dus elke widget toont vanzelf de eigen
locatie/instellingen — er is geen aparte koppelstap nodig.

Top-level velden blijven "vandaag, de volle dag" (ongewijzigd): `spotnaam`, `kleur`, `score`,
`verdict`, `windKnopen`, `windrichtingKompas`, `windvlaagKnopen`, `bijgewerkt`, `grafiekUrl`
(dezelfde dag-grafiek als de Telegram-berichten, zie hierboven — bedoeld voor een tweede
widget-scherm). Geeft `kleur` als de rauwe string ("groen"/"oranje"/"rood") terug, geen hex-kleur —
welke exacte tint daarbij hoort is een presentatiekeuze voor de client, geen
backend-verantwoordelijkheid.

**`volgendeKans`** — op gebruikersverzoek toegevoegd voor een widget-scherm dat niet "nu", maar de
eerstvolgende bruikbare sessie toont: `{ gevonden, dagLabel, datum, vanaf, tot, kleur, score,
verdict, windKnopen, windrichtingKompas, windvlaagKnopen }`, of `{ gevonden: false }` als niets
binnen de ingestelde Voorspellingshorizon voldoet. "Voldoet" = een aaneengesloten blok van
minimaal `profiel.minimaleSessieUren` uur (standaard 2) zonder no-go-uur, met dagkleur ≠ rood —
dezelfde `berekenDagScore`/`vindBesteVenster` als de webapp-kaarten en dezelfde maatstaf als de
Telegram-directe-alert. Zoekt dag voor dag vanaf vandaag; voor **vandaag tellen alleen uren vanaf
nu mee** (`new Date(tijdstip) >= nu`, dezelfde grens als de Tabel-weergave's
"afgelopen uren"-inklapping in `JavaScript.html`) — zonder die filter zou de widget een kans tonen
die al voorbij is als je 's middags of 's avonds ververst. Dit was ook de aanleiding om
`minimaleSessieUren` alsnog aan de widget's `dagvensterOpties` toe te voegen: die ontbrak er eerder
(wél al aanwezig in `bepaalDagOordelenVoorLocatie_` voor de webapp/Telegram), waardoor de widget de
sessieduur-eis van de gebruiker stilzwijgend negeerde.

### Widget-app delen: download + klembord-koppeling

⚙️ Instellingen → **"📱 Installeer ook de Widget"** toont een downloadknop voor de Tasker/App-
Factory-APK (Drive-bestand, zie `getWidgetApkBestandsId_` in `Config.gs` en SETUP.md — zonder
ingevulde `WIDGET_APK_DRIVE_BESTANDS_ID` blijft de knop simpelweg verborgen) en, los daarvan, altijd
het eigen `gebruikerId` met een kopieerknop.

Aanleiding: de widget-app is bedoeld om met anderen te delen (bv. gezinsleden), die geen toegang
hebben tot de Tasker-taak zelf om er hun eigen `?id=...` in te zetten. Een volledige "download 'm
al gekoppeld" is met alleen Apps Script + Drive niet haalbaar — dat zou de APK per download moeten
patchen en opnieuw ondertekenen, wat buiten wat een Apps Script-webapp kan bereiken valt. In plaats
daarvan kopieert de downloadknop het `gebruikerId` meteen naar het klembord
(`navigator.clipboard.writeText`, met een stille no-op bij weigering — de zichtbare, aanraak-
selecteerbare ID-tekst eronder blijft dan de handmatige terugval). Gecombineerd met een Tasker
"Input"-actie die haar standaardwaarde uit `%CLIP` (de klembordinhoud) haalt, wordt koppelen na
installatie voor de meeste mensen alleen nog "OK" tikken i.p.v. handmatig heen-en-weer kopiëren
tussen de webapp en de widget-app.

### Verkorte links (TinyURL) — geprobeerd, teruggedraaid

Op uitdrukkelijk verzoek is een tijd lang elke gedeelde/Telegram-link door TinyURL's gratis,
sleutelloze API gehaald (`tinyurl.com/api-create.php?url=...`), voor de "🔗 Deel deze app"-link, de
bot-antwoorden met het app-linkje (`verwerkTelegramBericht_` in TelegramBot.gs) en de "Bekijk de
app"-regel onderaan de dagelijkse samenvatting (`verstuurDagelijkseSamenvatting_` in Meldingen.gs).

Dat had al bij invoering een bewuste privacy-kanttekening (de volledige lange link — inclusief het
toegangs-ID, functioneel het "wachtwoord" voor dat profiel — ziet en logt TinyURL dan), maar is
alsnog teruggedraaid nadat bleek dat een via de anonieme API aangemaakte TinyURL-link bij het
openen eerst een TinyURL-tussenpagina toont in plaats van direct door te verwijzen — precies het
soort wrijving die een korte link had moeten wegnemen. Een handmatig via tinyurl.com aangemaakte
link (ingelogd, of met een eigen alias) heeft dat probleem niet, maar dat is geen optie voor een
per-ontvanger gegenereerd ID.

**Alternatief geprobeerd: `is.gd`/`v.gd`** (zelfde infrastructuur, geen tussenpagina bij anoniem
via de API aangemaakte links). Faalde echter structureel: `is.gd/create.php?format=simple&url=...`
gaf zowel vanaf mijn eigen testomgeving als — via een tijdelijke diagnostische route — vanaf Apps
Script's eigen netwerk steeds "Error, database insert failed" terug, voor drie verschillende
doel-URL's (`script.google.com`, `example.com`, `anthropic.com`). Geen IP-blokkade of
flood-bescherming dus (dat zou domein- of IP-afhankelijk variëren), maar een structureel kapotte
of uitgeschakelde dienst op het moment van testen. Niet gebruikt.

Nu dus gewoon de lange URL, overal: `bouwDeelLink` (Code.gs, hernoemd vanaf `bouwVerkorteDeelLink`),
de Telegram-koppel-antwoorden en de dagelijkse samenvatting. Enige overgebleven betrouwbare optie
voor een korte link zonder tussenpagina is TinyURL's **geauthenticeerde** API (eigen account +
API-token, i.p.v. de anonieme `api-create.php`) — vereist dat de gebruiker zelf een gratis account
aanmaakt en een token aanlevert, dus bewust niet zomaar geïmplementeerd zonder die stap.

### Automatisch Instellingen openen bij een nog niet geconfigureerd profiel

Sinds v59: `init()` (JavaScript.html) opent bij het laden automatisch ⚙️ Instellingen — niet alleen
de al bestaande passieve `configuratieBanner` — zodra `heeftEssentieleConfiguratie(profiel.
drempelwaarden)` false is (nieuw profiel, of via een verse "🔗 Deel deze app"-link). Op
gebruikersverzoek: proactief om de essentiële windcriteria vragen bij het opstarten i.p.v. te
wachten tot iemand de banner opmerkt en zelf op "Nu instellen" klikt. De weerkaarten laden
intussen gewoon door op de achtergrond (dezelfde `kiesLocatie`-aanroep als altijd), dus zodra
Instellingen weer sluit staat er al een score klaar.

**`grafiekUrl`**: een publiek-met-link-deelbare Drive-URL (`drive.google.com/uc?id=...`) van
dezelfde dag-grafiek (wind, score-kleur, regen) als bij de Telegram-meldingen (zie hierboven,
`bouwDagGrafiekBlob_`) — bedoeld als rechtstreekse `url` van een "Image"-element in bv. een
Tasker-widgetlayout (dat element-type accepteert een gewone HTTP-URL, geen base64, dus geen
download/opslag-stap nodig in de Tasker-taak zelf). **Niet** als binaire respons van dit
endpoint zelf geprobeerd: live getest dat `doGet` een Blob niet als afbeelding teruggeeft maar in
een HTML-wrapper verpakt (zie TESTING.md) — vandaar de omweg via Drive
(`slaWidgetGrafiekOp_`, map `KiteWeerApp-WidgetGrafieken`, één overschreven bestand per
gebruiker om Drive niet te laten volstromen), hetzelfde patroon als foto-opslag elders in dit
soort GAS-projecten. `null` als de afbeelding niet gebouwd/geüpload kon worden — de widget blijft
dan gewoon werken zonder afbeelding.

Live geverifieerd (in tegenstelling tot de eerdere ContentService/text-plain-quirk bij de
HTML-pagina, zie "Aannames" #2): deze JSON-response komt met de correcte
`Content-Type: application/json` terug op de `/exec`-URL. Zou dat ooit alsnog `text/plain` zijn,
dan maakt dat voor een programmatische client als Tasker sowieso niets uit — die leest de
responstekst en parseert 'm zelf als JSON, in tegenstelling tot een browser die op de
Content-Type-header vertrouwt om te beslissen of iets gerenderd moet worden.

### Donkere modus

Toggle-knop (🌙/☀️) linksboven in de topbar, naast Databronnen/Instellingen (`themaKnop` in
`index.html`/`JavaScript.html`). Zet `data-theme="dark"`/`"light"` op `<html>` en onthoudt de
keuze in `localStorage` (`kiteweer_thema`); zonder expliciete keuze volgt de app het systeemthema
via `prefers-color-scheme` (`Stylesheet.html`). Werkt voor de hele app omdat vrijwel alle kleuren
al via CSS-variabelen liepen (`--bg`, `--tekst`, `--hint`, `--knop-bg`, `--knop-tekst`,
`--sectie-bg` — oorspronkelijk bedoeld als Telegram-Mini-App-themavariabelen, maar die staan in de
praktijk nooit echt omdat deze webapp geen Mini App is, zie "Aannames" #1; de dark-mode-overrides
herdefiniëren dus gewoon dezelfde fallback-waarden). De keuze wordt al synchroon in `<head>`
toegepast (vóór de eerste render) om een lichte flits bij het laden te voorkomen.

### Versie-marker

Onderin de app staat een versienummer + datum (`KITEWEER_VERSIE` in `Code.gs`), zodat je na een
`clasp deploy` kunt controleren of je browser echt de nieuwe versie toont en niet een gecachete
oudere. Hoog dit handmatig op bij een betekenisvolle wijziging.

## Android-app

Naast de webapp is er een Android-app (APK), gebouwd met [Capacitor](https://capacitorjs.com):
dezelfde front-end (`src/webapp/`) draait in een WebView in de app, met een **eigen, lokale
start**: het profiel (instellingen, favorieten, meldingen) staat alléén op de telefoon — geen
gebruikers-ID, geen Drive-profiel, geen bewaar-link. De Apps Script-backend blijft wél het
rekenwerk doen (weerbronnen ophalen/middelen, score, samenvattingszin), zodat API-sleutels
(KNMI, Weerlive) server-side blijven en de logica op één plek staat.

```
Telefoon (APK)                                            Apps Script (/exec, doPost)
┌───────────────────────────────────────────┐   POST     ┌──────────────────────────────────┐
│ WebView: index.html + JavaScript.html     │ ─────────► │ {actie, profiel, ...}            │
│  └ src/app/app.js: profiel in             │ ◄───────── │ verwerkAppVerzoek (appApi.js)    │
│    Capacitor Preferences, API via fetch   │   JSON     │  → bepaalDagOordelenVoorLocatie_ │
│ Widget + meldingen (Java, WorkManager)    │ ─────────► │  → bouwWidgetData_               │
│  └ elk half uur {actie:'achtergrond'}     │            │  → bepaalAppMeldingen            │
└───────────────────────────────────────────┘            └──────────────────────────────────┘
```

**App-API (`doPost`).** Een POST met een JSON-body met een `actie`-veld is een app-verzoek (een
Telegram-update heeft dat veld nooit); de rest van `doPost` (Telegram-webhook) is ongewijzigd.
Routering en validatie staan als pure, geteste logica in `src/logica/appApi.js`
(`verwerkAppVerzoek`); `Code.gs` (`verwerkAppApiVerzoek_`) vult alleen de I/O in. Acties:

| actie | invoer | antwoord |
|---|---|---|
| `weeroordeel` | `profiel`, `locatie` | `{ dagen }` — zelfde als `getWeerOordeel` |
| `vergelijk` | `profiel` | `{ locaties }` — zelfde als `vergelijkFavorieteLocaties` |
| `zoekLocatie` | `zoekterm` | `{ resultaten }` |
| `deelLink` | — | `{ url }` — webapp-link met een nieuw ID |
| `achtergrond` | `profiel`, `status`, optioneel `widgetLocatieId` | `{ widget, meldingen, status }` |

Het meegestuurde profiel wordt altijd opnieuw gevalideerd (`valideerEnVulProfielAan`), net als een
profiel uit Drive. De backend bewaart niets van de app; wie de /exec-URL kent kon de weerberekening
al via de webapp gebruiken, dus dit opent geen nieuwe gegevens.

**Front-end.** `build-app.js` bouwt `www/` uit dezelfde `index.html`/`JavaScript.html`/
`Stylesheet.html` als de webapp (de `<?!= ... ?>`-tags worden ingevuld) plus `src/app/app.js`.
`JavaScript.html` herkent de app aan `window.KiteweerApp` (`IS_APP`) en stuurt zijn
`run('...')`-aanroepen dan daarheen i.p.v. naar `google.script.run`; verder zijn alleen de
bewaar-link, de Telegram-koppeling en de Tasker-widget-uitleg anders in de app. Het laatst
opgehaalde weeroordeel per locatie wordt lokaal bewaard: zonder verbinding toont de app dat, met
de melding van welk tijdstip het is.

**Widget.** Een echte Android-widget (`KiteweerWidget.java`), geen Tasker meer. Vaste kop (spot,
tijd van bijwerken — tik erop om meteen te verversen) met daaronder een **scrollbare lijst**
(`KiteweerWidgetService.java`):

1. **Overzicht** (eerste scherm): score-badge en oordeel van vandaag (achtergrondkleur =
   groen/oranje/rood), wind + vlagen, de eerstvolgende kitemogelijkheid en een strook chips met
   het oordeel per dag ("za 7.4").
2. **Per dag van de Voorspellingshorizon een kaart** met score, beste venster ("13:00–18:00"),
   oordeel/wind en een grafiek 09:00-20:00 (`KiteweerGrafiek.java`): balken = wind (kleur =
   oordeel per uur), lijn = vlagen, pijltjes = windrichting, druppels = regen (≥ 0,2 mm), het
   beste venster als band, bij vandaag een stippellijn op "nu". Alle dagen delen één kn-schaal,
   zodat je tijdens het scrollen dagen kunt vergelijken. De grafiek wordt zo hoog dat één kaart
   ongeveer de zichtbare lijst vult.

Standaardmaat 4x3 (het overzicht plus een glimp van de eerste dagkaart), vrij te vergroten/verkleinen.
Volgt de eerste favoriete locatie en leest het profiel rechtstreeks van de telefoon, dus er is geen
koppelstap. De gegevens komen uit `widget.dagen` (per dag gebouwd door `bouwWidgetDag` in
`src/logica/widgetData.js`); een backend van vóór v98 stuurt die nog niet, dan toont de widget
alleen vandaag (uit `uren`). Ondersteunt donkere modus.

**Meldingen.** Dezelfde twee vormen als in Telegram (dagelijkse samenvatting, directe alert),
nu als Android-melding. Welke meldingen er komen, bepaalt de backend
(`bepaalAppMeldingen` in `appApi.js`, dezelfde regels als `Meldingen.gs`: alert per locatie én
datum hooguit één keer, nachtrust 22:30-07:00, een gemelde datum blijft onthouden). De telefoon
bewaart alleen de meldingsstatus en stuurt die bij de volgende aanroep terug. De achtergrondtaak
(`KiteweerAchtergrond.java`, WorkManager) draait elk half uur, maar 's nachts (22:30-06:30) niet;
voor de samenvatting plant hij een aparte taak precies op het gekozen tijdstip. Een samenvatting
die door Doze/batterijbesparing pas >3 uur na het gekozen tijdstip aan de beurt zou komen, wordt
voor die dag overgeslagen. Android 13+ vraagt eenmalig om toestemming voor meldingen.

**Belasting.** Elke app-installatie doet overdag ~32 achtergrond-aanroepen per dag (plus wat je
zelf in de app opent). De backend cachet de bronnen per locatie (Open-Meteo 60 min, de rest
10-25 min), dus meerdere gebruikers met dezelfde spots delen die cache.

### Bouwen, installeren, bijwerken

```bash
npm run build:app          # www/ bouwen + naar android/ kopiëren (cap sync)
npm run apk                # idem + release-APK: android/app/build/outputs/apk/release/
npm run dev:app            # lokale backend (tools/gas-dev-server.js) + www/ op http://localhost:8787
```

Nodig: Node 22, JDK 21 en de Android SDK (`ANDROID_HOME`, platform 36). Zonder lokale
toolchain bouwt GitHub Actions de APK bij elke push (`.github/workflows/android-apk.yml`): Actions
→ run → Artifacts; bij een tag `v*` komt hij als download bij een release.

**Backend eerst.** De app heeft de nieuwe `doPost` nodig: `npm run build`, `clasp push` en
`clasp deploy --deploymentId …` (zie SETUP.md stap 1). Met een oudere deployment meldt de app
"De backend kent de app-API nog niet".

**Ondertekening.** Deze repo is publiek, dus de ondertekeningssleutel staat er niet in.
`android/app/build.gradle` leest hem uit `android/keystore.properties` (git-ignored) of uit de
omgevingsvariabelen `KITEWEER_KEYSTORE*` (GitHub Actions-secrets, zie de workflow). Updates
installeren alleen over een versie heen die met dezelfde sleutel ondertekend is — raak je de
sleutel kwijt, dan moet de app eraf (en zijn de lokale instellingen weg). Versie ophogen: `version`
in `package.json` (wordt `versionName`/`versionCode`).

**Installeren (sideload).** Open de APK op de telefoon en sta "installeren uit onbekende bronnen"
toe voor de app waarmee je hem opent (browser/bestanden). Niet via de Play Store; daarvoor zijn een
ontwikkelaarsaccount en een AAB (`./gradlew bundleRelease`) nodig.

**Updates.** De app kijkt bij het openen in `downloads/versie.json` op `main` (via
raw.githubusercontent.com) of er een nieuwere versie is (`isNieuwereAppVersie` in
`src/logica/appVersie.js`) en toont dan bovenaan een balk met een downloadlink; de update installeert
over de oude versie heen (instellingen blijven) zolang hij met dezelfde sleutel is ondertekend. Een
nieuwe versie uitbrengen: `version` in `package.json` ophogen, ondertekende APK bouwen, als
`downloads/kite-weer-app-<versie>.apk` committen en `downloads/versie.json` (versie, url, notitie)
bijwerken — pas na de merge naar `main` zien gebruikers de melding.

**Sleutelwissel 1.0.0 → 1.1.0.** De oorspronkelijke release-sleutel van 1.0.0 is niet bewaard gebleven;
1.1.0 is met een nieuwe sleutel ondertekend. Wie 1.0.0 heeft, moet die eenmalig verwijderen en 1.1.0
installeren (instellingen en favorieten opnieuw invullen). 1.0.0 heeft nog geen updatemelding.

## Bouwen en testen

```bash
npm test          # alle unit-/integratietests (Node's ingebouwde test runner, geen dependencies)
npm run build     # bouwt dist/ vanuit src/
npm run push      # build + clasp push
npm run apk       # Android-app, zie "Android-app" hierboven
```

Zie [`TESTING.md`](TESTING.md) voor testdekking en [`SETUP.md`](SETUP.md) voor eenmalige
installatiestappen (Script Properties, meldingen-trigger).

## Aannames

1. **Losgekoppeld van Telegram.** De app is oorspronkelijk gebouwd als Telegram Mini App, maar
   Google Apps Script bleek daar structureel ongeschikt voor: Telegram geeft zijn app-data mee
   via het `#`-gedeelte van de URL, en Apps Script's eigen serveerlaag (zowel via `HtmlService`
   als via `ContentService`) verliest dat `#`-gedeelte vóórdat de eigen code draait. Vervangen
   door directe toegang via een unieke gebruikers-link (zie "Toegang" hierboven).
2. **`HtmlService`, niet `ContentService`, voor het serveren van de pagina.** Tijdens het
   oplossen van bovenstaand Telegram-probleem is `ContentService` geprobeerd (geen geneste
   iframe-wrapper, dus geen `#`-verlies) — maar die bleek op de `/exec`-URL altijd
   `Content-Type: text/plain` terug te geven, ongeacht `setMimeType(HTML)`, waardoor de browser
   de pagina niet rendert. Met Telegram uit beeld verviel de noodzaak voor `ContentService`
   sowieso, dus teruggezet naar het standaard, betrouwbare `HtmlService` + `google.script.run`.
3. **RWS is de databron voor zowel getij als "actuele wind", via een dichtstbijzijnde-
   meetpunt-lookup (niet langer één hardgecodeerde locatie).** Rijkswaterstaat's WaterWebservices
   (nieuwe versie: `ddapi20-waterwebservices.rijkswaterstaat.nl`) vereist een locatiecode per
   meetpunt. Eerder was dat hardgecodeerd op `hoekvanholland` (dekt Rockanje/Maasvlakte); sinds
   30 aug 2026 kiest `WeerData.gs` (`vindDichtstbijzijndRwsStation_`, met `dichtstbijzijnde()` uit
   `eenheden.js`, net als bij Windfinder) per opgevraagde locatie het dichtstbijzijnde meetpunt uit
   een vaste lijst (`RWS_STATIONS`, max 30 km afstand). Die lijst bevat **alleen** meetpunten die
   volgens RWS' eigen catalogus (`METADATASERVICES/OphalenCatalogus`) zowel getij (`WATHTE`) als
   wind (`WINDSHD`/`WINDRTG`) meten ÉN bij een live check daadwerkelijk data teruggaven — van de
   ~90 kandidaten uit de catalogus bleken er (op 30 aug 2026) maar 10 daadwerkelijk actief; de rest
   gaf een lege HTTP 204-respons terug (zoals eerder ook al bleek bij `rockanje.2eslag`, dat om die
   reden nooit is toegevoegd). Dat maakt deze bron nu ook nauwkeurig bruikbaar bij bv. Brouwersdam,
   Cadzand en de Oosterschelde/Westerschelde, niet alleen de Voordelta. Wind wordt zowel als
   `ProcesType: "meting"` (de daadwerkelijk actuele waarneming — vervangt het idee om
   kitesurfvereniging.nl's windmeter te gebruiken, zie punt 4) als `ProcesType: "verwachting"` (een
   extra, onafhankelijke windvoorspelling, gemiddeld met Open-Meteo/Windfinder) opgehaald. Omdat
   RWS' actieve stations wijzigen, kan `RWS_STATIONS` na verloop van tijd verouderen — een station
   dat plotseling niets teruggeeft, wordt door `bronnenMiddeling.js` gewoon overgeslagen (geen
   crash), maar levert dan wel stilzwijgend minder databronnen op; check bij twijfel opnieuw via
   dezelfde catalogus-aanpak. Voor spots ver van elk RWS-meetpunt (>30 km) wordt deze bron
   automatisch overgeslagen — zet 'm anders handmatig uit via 🛰️. Getij-status (hoog/laag) is een
   eenvoudige heuristiek (boven/onder het midden van de min/max-waterstand in de opgehaalde
   reeks), geen echte getijtafel-berekening. **De RWS-periode start bij 00:00 vandaag, niet bij
   "nu".** Aanvankelijk vroeg `rwsWaarnemingenTaak_` de periode vanaf het opvraagmoment op, waardoor
   elk uur vóór "nu" (bv. het beste winduur van vandaag, als dat toevallig vroeg in de ochtend valt)
   geen getij/RWS-wind kreeg — niet omdat RWS die data niet heeft, maar omdat er niet naar gevraagd
   werd. Live geverifieerd dat RWS voor `ProcesType: "verwachting"` gewoon de al gepasseerde uren
   van vandaag teruggeeft zodra je een eerdere `Begindatumtijd` opgeeft (en er is zelfs een aparte
   `ProcesType: "meting"`-reeks met echte, gemeten waarden voor het verleden). Sindsdien vraagt de
   app consequent vanaf 00:00 vandaag op.
4. **kitesurfvereniging.nl (NKV) is niet geïntegreerd**, ondanks de vraag om de "Rockanje
   sportstrand"-pagina als bron te gebruiken (en, later, om een alternatief te zoeken). Twee
   redenen: (a) de site vermeldt expliciet dat overname van content alleen mag "met
   bronvermelding én schriftelijke toestemming van de NKV" — dat is niet geregeld; (b) de live
   windmeterwaarde blijkt dynamisch via JavaScript geladen te worden (een marker-klik op hun
   interactieve kaart), niet statisch in de HTML aanwezig, dus ook technisch niet zomaar op te
   halen met `UrlFetchApp` (dat voert geen JavaScript uit) — ook niet in de HTML-bron die
   handmatig is aangeleverd ter controle. **Vervangen door RWS' eigen windmeting** (zie punt 3)
   als bron voor "actuele wind" — officiële overheidsdata, geen toestemmingsvraag nodig. Wél
   gebruikt van kitesurfvereniging.nl: de exacte coördinaten van Rockanje Sportstrand en
   Maasvlakte 2 - Slufter, afkomstig uit de publieke spotkaart-data van diezelfde site (geen
   auteursrechtelijk beschermde content,
   puur coördinaten).
5. **Windfinder.com is wél geïntegreerd, op uitdrukkelijk verzoek — met een juridische
   kanttekening.** Hun `robots.txt` staat `/forecast/` toe, maar dat zegt formeel alleen iets
   over crawl-toestemming, niet over toestemming om hun voorspellingsdata te *hergebruiken* in
   een andere app; voor een commerciële weerdienst is hergebruik van de onderliggende data
   typisch niet toegestaan zonder licentie/API-overeenkomst. Alleen gekoppeld aan de twee
   standaard-favorieten (Rockanje/Maasvlakte, met de hand aan hun URL-slug gekoppeld — geen
   generieke lookup); voor elke andere locatie wordt deze bron automatisch overgeslagen. Uit te
   zetten via 🛰️ Databronnen als je het risico liever niet neemt of een licentie ontbreekt.
6. **Windrichting is per favoriete locatie geconfigureerd**, niet globaal: de kustoriëntatie
   verschilt per spot. Rockanje en Maasvlakte staan standaard op ZZW-NW (202,5°-315°), gelijk aan
   de meldingsregel. De overige drempelwaarden zijn wél globaal per gebruiker.
7. **Dagscore = het beste (hoogst scorende) uur binnen het daglichtvenster (6:00-21:00)**
   vertegenwoordigt de hele dag: "is er vandaag ergens een goed moment". Niveau 3
   (uitklapmenu) toont nog steeds alle uren afzonderlijk, incl. getij per uur.
8. **Eén profiel-JSON-bestand per gebruikers-ID** in een vaste, niet-publiek-gedeelde Drive-map
   (`KiteWeerApp-Profielen`, automatisch aangemaakt bij eerste gebruik). Nieuwe profielen krijgen
   Rockanje en Maasvlakte automatisch als favoriet; een gebruiker die ze bewust verwijdert,
   blijven ze verwijderd (geen automatische heraanvulling bij een volgend bezoek).
9. **Meldingen uitsluitend via Telegram, geen e-mail.** Eerder ging dit via `MailApp`
   (in de praktijk werd e-mail als te traag/makkelijk gemist ervaren voor iets tijdgevoeligs als
   een kitesurf-window); nu is Telegram het enige kanaal en is de melding zelf ook veranderd van
   "stuur zodra de drempel binnen de dag voor het eerst gehaald wordt" naar "stuur elke ochtend om
   08:00 de 3-daagse vooruitzicht" (zie README.md "Meldingen"). Zonder gekoppeld Telegram-chat-ID
   (bot starten, zie hieronder) krijgt een profiel dus geen enkele melding.
10. **Windrichting van een favoriete locatie wijzig je door de locatie te verwijderen (🗑️) en
    opnieuw toe te voegen** met nieuwe waarden — er is geen apart "bewerk"-formulier voor een
    bestaande favoriet.
11. **Alle tunable drempelwaarden (windsnelheid, windvlagen, temperaturen, golfhoogte, zicht)
    starten leeg (`null`), bewust — geen stille standaardwaarden bij een veiligheidskritische
    go/no-go-beslissing.** Elke evaluatiefunctie in `drempelwaarden.js` behandelt een ontbrekende
    drempel als neutraal ("niet-geconfigureerd", telt niet mee als no-go, maar ook niet als een
    echte beoordeling), en `heeftEssentieleConfiguratie()` bepaalt of windsnelheid + windvlagen
    volledig zijn ingevuld. Zolang dat niet zo is, toont de app een oranje
    "Stel eerst je windcriteria in"-banner met een knop naar ⚙️ Instellingen. Uitzondering:
    `onweer.hardNoGo` blijft standaard `true` (een veiligheidsvangnet, geen persoonlijke
    voorkeur) en de meldingsregel (§ Meldingen) heeft wél concrete standaardwaarden, omdat die
    letterlijk als getal is opgegeven.
12. **Hoofdcriteria vs. facultatief in de score.** Op verzoek herwogen: windsnelheid (35%),
    windrichting (20%), windvlagen (15%) en getij (15%) zijn de hoofdcriteria — getij was eerst
    een facultatieve "nice-to-have" zonder eigen gewicht, nu een volwaardige categorie. Lucht-/
    watertemperatuur, golfhoogte en zicht vormen samen de resterende 15% ("facultatief").
    Onweer/buien ("weer") zit hier bewust niet als percentage bij: dat werkt al als hard-gate
    (harde no-go bij onweer) plus een vermenigvuldigende straf bij een neerslagwaarschuwing — dat
    weegt al zwaarder door dan een gewoon percentage zou doen. "Actuele wind" is geen aparte
    categorie: RWS' live windmeting (zie punt 3) wordt via `bronnenMiddeling.js` gewoon
    meegewogen in dezelfde windsnelheid/windrichting-hoofdcriteria op het "nu"-uur, naast
    Buienradar/Weerlive — het is dezelfde hoofdcriteria-groep, alleen met een actuele meting
    erbij i.p.v. uitsluitend voorspellingen.
13. **De scoreberekening is transparant zichtbaar** via een derde "Berekening"-weergave naast
    Grafiek/Tabel bij elke dag (`bouwBerekeningWeergave` in `JavaScript.html`), die per
    hoofdcriterium de status, deelscore, gewicht en bijdrage toont voor het beste uur van die
    dag, plus de volledige formule. De gewichten staan hard gecodeerd gespiegeld in de front-end
    (`BEREKENING_GEWICHTEN`, gelijk aan `GEWICHTEN` in `scoreBerekening.js`) — bij een toekomstige
    wijziging van de gewichten moet je dus op beide plekken aanpassen.
14. **Widget-grafieken staan "voor iedereen met de link" gedeeld op Drive**, in een aparte map
    (`KiteWeerApp-WidgetGrafieken`, automatisch aangemaakt bij eerste gebruik van
    `?actie=widget` — zie `getWidgetGrafiekenMapId_` in `Config.gs`), anders dan de
    niet-publiek-gedeelde profielenmap uit punt 8. Nodig omdat een Tasker-widget's
    "Image"-element een gewone HTTP-URL verwacht (`drive.google.com/uc?id=...`), niet een
    geauthenticeerde Drive-aanroep. Zelfde toegangsmodel als de rest van de app (zie punt 1): wie
    de bestands-URL kent kan de afbeelding zien, maar die URL is net zo min te raden als een
    gebruikers-ID zelf, en de afbeelding bevat sowieso geen gevoeligere info dan wat toch al
    zichtbaar is voor wie het gebruikers-ID kent. Eén bestand per gebruiker
    (`grafiek-<gebruikerId>.png`), bij elke `?actie=widget`-aanvraag overschreven (oud bestand
    eerst verwijderd) om Drive niet te laten volstromen.
