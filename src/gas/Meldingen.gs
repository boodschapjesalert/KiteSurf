// GAS-specifiek: verstuurt Telegram-meldingen (geen e-mail — zie README.md "Aannames") voor elke
// gebruiker die de bot gekoppeld heeft (zie TelegramBot.gs). Twee onafhankelijke, los te
// combineren meldingsvormen (zie profielValidatie.standaardProfiel() -> `meldingen`), allebei
// gebouwd op dezelfde score/kleur-berekening als de webapp-kaarten (Code.gs:
// bepaalDagOordelenVoorLocatie_) — er is geen aparte, eenvoudigere meldingsregel meer (die bestond
// vroeger, `meldingDrempel`, en is verwijderd omdat de twee berekeningen uit elkaar konden lopen):
// - `dagelijkseSamenvatting`: op het zelf gekozen tijdstip, per favoriete locatie en per dag (over
//   de ingestelde voorspellingshorizon, profiel.dagenVooruit) één foto+bijschrift-bericht — zie
//   verstuurDagelijkseSamenvatting_.
// - `directeAlert`: zodra een dag ergens binnen diezelfde voorspellingshorizon voor het eerst kleur
//   "groen" krijgt (per locatie én per dag hooguit één keer, bijgehouden via
//   `meldingen.laatstGemeld`) — zie verwerkDirecteAlert_. Hergebruikt hetzelfde foto+bijschrift als
//   de dagelijkse samenvatting (verstuurDagBericht_), met een kort voorvoegsel dat duidelijk maakt
//   dat dit een tussentijdse melding is en geen de geplande samenvatting.
//
// Aangeroepen via één kwartier-trigger (zie Setup.gs) — elke run controleert zelf of het "nu" het
// gekozen samenvattingstijdstip van een profiel is, i.p.v. een aparte trigger per gekozen tijdstip.

var MELDING_DAG_LABELS = ['Vandaag', 'Morgen', 'Overmorgen'];

// Nachtrust voor de DIRECTE alert (op gebruikersverzoek): 22:30-07:00 geen Telegram-berichten,
// ongeacht wanneer een dag "Goed" wordt. Overspant middernacht, vandaar de "of"-vergelijking i.p.v.
// een simpel bereik. Geldt bewust NIET voor de dagelijkse samenvatting — die heeft al haar eigen,
// door de gebruiker zelf gekozen tijdstip (`meldingen.samenvattingUur`/`samenvattingMinuut`), dat
// blijft ongewijzigd de enige klok daarvoor.
var STIL_UUR_START_MINUUT = 22 * 60 + 30;
var STIL_UUR_EIND_MINUUT = 7 * 60;

// De dagelijkse samenvatting kost zelf tijd om te versturen (Slides-grafieken ~5s per dag/locatie,
// plus tot 2 herkansingen van 2s+5s per locatie als een bron hapert, zie verstuurDagelijkseSamenvatting_
// — bij een langere Voorspellingshorizon of meerdere favoriete locaties kan dat al snel een halve tot
// hele minuut zijn, en warmWeerCache_ hierboven kost er (bij ~9 profielen) nog eens ~15-20s bovenop
// vóórdat de eerste samenvatting-locatie aan de beurt is) — gebruikersverzoek: het gekozen tijdstip
// is wanneer het bericht AANKOMT, niet wanneer het triggermoment begint te verwerken. Vandaar één
// vast kwartier (de trigger-cadans zelf, zie hieronder) eerder AANVANGEN met controleren of de
// samenvatting verstuurd moet worden — dat verschuift het naar de trigger-run vóór het exacte
// tijdstip i.p.v. de run erná/erop, zodat de verwerkingstijd het bericht in de praktijk dichter bij
// (of net vóór) het echte gekozen moment laat aankomen i.p.v. er altijd een stuk na.
var SAMENVATTING_VOORSPRONG_MINUTEN = 15;

// Cache-opwarming (warmWeerCache_) alleen overdag, 06:00-18:00 (gebruikersverzoek, om het aantal
// aanroepen naar de gratis weerbron te verdelen/verminderen — zie OPEN_METEO_CACHE_SECONDEN in
// WeerData.gs voor de limiet). 's Nachts kijkt niemand in de webapp; de eerste aanroep daarna haalt
// gewoon zelf verse data op. Alerts en samenvattingen halen hun data hoe dan ook zelf op als de cache
// leeg is, dus die zijn hier niet van afhankelijk.
var WARM_START_MINUUT = 6 * 60;
var WARM_EIND_MINUUT = 18 * 60;

function isStilUur_(minutenNu) {
  return minutenNu >= STIL_UUR_START_MINUUT || minutenNu < STIL_UUR_EIND_MINUUT;
}

/**
 * Aan te roepen via een time-driven trigger, elk kwartier (zie SETUP.md/Setup.gs).
 *
 * Bevat bewust GEEN lock rond de hele functie-body meer (dat was de eerdere fix voor dubbele
 * alerts bij overlappende trigger-runs). Reden voor de omslag: zo'n lock rond de hele — trage,
 * soms tientallen seconden durende — trigger-run zou ook elke webapp-opslagactie (⚙️ Instellingen,
 * favoriet toevoegen/verwijderen) laten wachten zodra die toevallig samenviel met een trigger-run,
 * wat een véél vervelendere vertraging is dan de zeldzame race die het voorkwam. In plaats daarvan
 * pakken `verwerkDirecteAlert_` en de samenvatting-afronding hieronder allebei een KORTE lock
 * (`wijzigProfielMetLock_`, ProfielOpslag.gs) rond alleen hun her-lees-en-opslaan-stap — dat lost
 * dezelfde race net zo goed op (de daadwerkelijke verstuur-beslissing gebeurt altijd op een vers,
 * lock-beschermd gelezen profiel), zonder de trage delen (weerdata ophalen, Telegram versturen)
 * ook onder de lock te hoeven houden. Overlappende trigger-runs doen daardoor soms dubbel werk
 * (redundante, door caching goedkope weerdata-aanroepen) maar sturen nooit meer dubbele berichten.
 */
function controleerEnStuurMeldingen() {
  // Zelfherstel: zonder geregistreerde webhook kan niemand nieuw koppelen en blijft de app stil
  // zonder foutmelding. Praat hooguit eens per 6 uur met de Telegram-API, zie TelegramBot.gs.
  zorgVoorTelegramWebhook_(false);

  var profielen = laadAlleProfielen_();
  var nu = new Date();
  var minutenNu =
    Number(Utilities.formatDate(nu, 'Europe/Amsterdam', 'H')) * 60 +
    Number(Utilities.formatDate(nu, 'Europe/Amsterdam', 'm'));
  var vandaag = Utilities.formatDate(nu, 'Europe/Amsterdam', 'yyyy-MM-dd');

  // Run-log (zie legRunVast_): een start-markering NU, de eindregel pas helemaal aan het eind. Wordt
  // een run halverwege afgebroken (6-minutenlimiet van Apps Script, of een quota-fout) dan komt die
  // eindregel er nooit en verraadt het verschil tussen markering en laatste regel dat alsnog.
  var runStart = nu.getTime();
  var runInfo = { start: Utilities.formatDate(nu, 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm:ss'), samenvattingen: [] };
  try { PropertiesService.getScriptProperties().setProperty('RUN_LAATSTE_START', runInfo.start); } catch (e) {}

  // Cache-opwarming voor ALLE favoriete locaties van ALLE profielen, ongeacht meldingen-
  // instellingen en (bewust) ongeacht de nachtrust hierboven — dit verstuurt niets, dus valt niet
  // onder "geen Telegram-berichten tussen 22:30-07:00". Doel: de webapp zelf (waar geen van de
  // caching-logica hieronder voor gebouwd was) voelt minder vaak een koude cache/koude start,
  // ook als je een andere favoriet opent dan degene die de meldingen toevallig al ververst
  // hadden. `haalWeerDataOp_`'s CacheService-cache is gedeeld over alle profielen (de cachesleutel
  // bevat geen gebruikers-ID, alleen lat/lon + dagen), dus twee profielen met dezelfde locatie
  // warmen elkaars cache gratis mee — geen dubbele externe aanroepen.
  // Eén chat = één zender: dubbel gekoppelde profielen hier ontkoppelen (zie
  // kiesEnHerstelTelegramZenders_), vóórdat er iets verstuurd wordt — ook de herkansingen hieronder.
  try {
    var ontkoppeld = kiesEnHerstelTelegramZenders_(profielen);
    if (ontkoppeld) runInfo.dubbelOntkoppeld = ontkoppeld;
  } catch (koppelFout) {
    Logger.log('controleerEnStuurMeldingen: dubbele koppelingen controleren mislukt: ' + koppelFout);
  }

  bewaarHorizonKaart_(profielen);
  if (minutenNu >= WARM_START_MINUUT && minutenNu < WARM_EIND_MINUUT) {
    warmWeerCache_(profielen);
  } else {
    runInfo.warmOvergeslagen = true;
  }
  runInfo.warmS = Math.round((new Date().getTime() - runStart) / 1000);

  // Eerst de openstaande herkansingen van eerdere runs (zie verwerkOpenstaandeHerkansingen_); een
  // nieuwe mislukking van de profielenlus hieronder wacht zo vanzelf tot de volgende run.
  try {
    var herkansingen = verwerkOpenstaandeHerkansingen_(profielen, vandaag);
    if (herkansingen) runInfo.herkansingen = herkansingen;
  } catch (herkansingFout) {
    Logger.log('controleerEnStuurMeldingen: herkansingen mislukt: ' + herkansingFout);
  }

  profielen.forEach(function (profiel, profielIndex) {
    if (!profiel.telegramChatId) return;
    if (!profiel.favorieteLocaties || profiel.favorieteLocaties.length === 0) return;

    // Try/catch rond dit HELE profiel: zonder deze vangnet zou een onverwachte fout ergens in de
    // verwerking van dít profiel (bv. verstuurDagelijkseSamenvatting_) niet alleen dít profiel
    // stil laten mislukken, maar via de ongevangen exception ook deze `.forEach` zélf afbreken —
    // waardoor ALLE nog te verwerken profielen na dit punt in deze trigger-run gewoon oversláágen
    // worden, zonder enige foutmelding. Live ontdekt bij het troubleshooten van een gebruikersrapport
    // ("vanaf het 2e bericht geen data meer") waarbij de exacte oorzaak niet meer te reproduceren
    // was, maar déze ontbrekende foutisolatie wél de waargenomen symptomen (stille gaten, geen
    // enkele foutmelding) had kunnen verklaren — dus hier hoe dan ook dichtgezet.
    try {
      if (profiel.meldingen.directeAlert) {
        verwerkDirecteAlert_(profiel, vandaag, minutenNu);
      }
      if (profiel.meldingen.dagelijkseSamenvatting && moetSamenvattingVersturen_(profiel, minutenNu, vandaag)) {
        var samenvattingStart = new Date().getTime();
        var samenvattingResultaat = verstuurDagelijkseSamenvatting_(profiel);
        runInfo.samenvattingen.push({
          profiel: profielIndex,
          s: Math.round((new Date().getTime() - samenvattingStart) / 1000),
          zonderData: samenvattingResultaat.mislukteLocatieIds.length,
        });
        if (samenvattingResultaat.mislukteLocatieIds.length > 0) {
          registreerHerkansing_(profiel.gebruikerId, vandaag, samenvattingResultaat.mislukteLocatieIds);
        }
        // Gelockt en op een vers gelezen profiel (niet het mogelijk verouderde `profiel` hierboven,
        // zie de toelichting bij deze functie) — zet alleen de datumvlag, laat de rest van het
        // profiel met rust, zodat dit geen intussen elders opgeslagen wijzigingen overschrijft.
        wijzigProfielMetLock_(profiel.gebruikerId, function (versProfiel) {
          versProfiel.meldingen.laatsteSamenvattingDatum = vandaag;
          return versProfiel;
        });
      }
    } catch (fout) {
      Logger.log('controleerEnStuurMeldingen: onverwachte fout voor profiel ' + profiel.gebruikerId + ': ' + fout);
      runInfo.fouten = (runInfo.fouten || 0) + 1;
      runInfo.laatsteFout = profielIndex + ': ' + String(fout).slice(0, 150);
    }
  });

  // Toetsing van de weermodellen aan KNMI-metingen (zie Verificatie.gs). Best-effort en alleen 06:00-12:00;
  // mag de meldingen nooit in de weg zitten, dus na de profielenlus en met eigen vangnet.
  try {
    var verificatie = voerVerificatieUit_(profielen, vandaag, minutenNu);
    if (verificatie && (verificatie.snapshotsGemaakt || verificatie.metingenOpgehaald || verificatie.fout)) {
      runInfo.verificatie = {
        snap: verificatie.snapshotsGemaakt || 0,
        obs: verificatie.metingenOpgehaald || 0,
        fout: verificatie.fout || undefined,
      };
    }
  } catch (verificatieFout) {
    runInfo.verificatie = { fout: String(verificatieFout).slice(0, 120) };
  }

  runInfo.openMeteo = weerTelling_;
  runInfo.duurS = Math.round((new Date().getTime() - runStart) / 1000);
  legRunVast_(runInfo);
}

/**
 * Per Telegram-chat mag precies één profiel meldingen sturen (kiesActieveTelegramProfielen in
 * src/logica/telegramKoppeling.js): het profiel uit de chat-index, de rest wordt ontkoppeld. Zonder
 * dit kreeg iemand met twee profielen aan dezelfde chat de samenvatting van het ándere profiel, ook
 * nadat hij hem in "zijn" profiel had uitgezet (gebruikersrapport). Zet `telegramChatId` van de
 * ontkoppelde profielen ook in `profielen` (in het geheugen) op null, zodat deze run ze overslaat.
 * @returns {number} aantal ontkoppelde profielen
 */
function kiesEnHerstelTelegramZenders_(profielen) {
  var keuze = kiesActieveTelegramProfielen(profielen, leesTelegramChatIndex_());
  Object.keys(keuze.indexUpdates).forEach(function (chatId) {
    onthoudTelegramKoppeling_(chatId, keuze.indexUpdates[chatId]);
  });
  keuze.dubbel.forEach(function (item) {
    wijzigProfielMetLock_(item.gebruikerId, function (vers) {
      if (vers.telegramChatId != null && String(vers.telegramChatId) === String(item.chatId)) vers.telegramChatId = null;
      return vers;
    });
    profielen.forEach(function (p) {
      if (p.gebruikerId === item.gebruikerId) p.telegramChatId = null;
    });
  });
  return keuze.dubbel.length;
}

/**
 * Bewaart de laatste ~25 trigger-runs (start, duur, opwarm-duur, welke profielen een samenvatting
 * kregen en hoe lang dat duurde, fouten) in Script Properties, opvraagbaar via ?actie=meldingen-status.
 * Aanleiding: een gebruiker kreeg de dagelijkse samenvatting "soms wel, soms niet", en er was geen
 * enkel inzicht in wat een trigger-run eigenlijk doet of hoe lang die duurt. Profielen worden hier
 * bewust alleen op volgnummer vermeld, nooit met gebruikers- of chat-ID.
 */
function legRunVast_(runInfo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var lijst = JSON.parse(props.getProperty('RUN_LOG') || '[]');
    lijst.push(runInfo);
    props.setProperty('RUN_LOG', JSON.stringify(lijst.slice(-12))); // Property-limiet ~9KB.
  } catch (e) {
    // Best-effort.
  }
}

/**
 * Ververst de weerdata-cache (CacheService, 10 minuten geldig — zie WEER_CACHE_SECONDEN in
 * WeerData.gs) voor elke favoriete locatie van elk profiel, puur voor het neveneffect: de eerste
 * webapp-/widget-aanroep die daarna dezelfde locatie opvraagt, treft dan al warme cache i.p.v. zelf
 * op alle externe bronnen te moeten wachten. Eén mislukking (bv. een locatie waarvan alle bronnen
 * net haperen) mag de rest niet blokkeren, vandaar de losse try/catch per locatie.
 */
function warmWeerCache_(profielen) {
  profielen.forEach(function (profiel) {
    (profiel.favorieteLocaties || []).forEach(function (locatie) {
      try {
        bepaalDagOordelenVoorLocatie_(profiel, locatie, profiel.dagenVooruit);
      } catch (fout) {
        Logger.log('warmWeerCache_: kon cache niet opwarmen voor ' + locatie.naam + ': ' + fout);
      }
    });
  });
}

/**
 * Is het gekozen samenvattingstijdstip vandaag bereikt (met een voorsprong, zie
 * SAMENVATTING_VOORSPRONG_MINUTEN hierboven, voor de verwerkingstijd) en is de samenvatting nog
 * niet verstuurd?
 *
 * Bewust "tijdstip gepasseerd + vandaag nog niet verstuurd" in plaats van een exacte match op het
 * trigger-moment: de trigger draait op vaste kwartieren, dus een tijdstip als 08:05 zou anders
 * nooit precies geraakt worden. Deze opzet is bovendien zelfherstellend — mist een trigger-run
 * (Apps Script garandeert geen exacte uitvoertijden), dan gaat de samenvatting alsnog bij de
 * eerstvolgende run diezelfde dag.
 */
function moetSamenvattingVersturen_(profiel, minutenNu, vandaag) {
  if (profiel.meldingen.laatsteSamenvattingDatum === vandaag) return false;
  var gekozenMinuten =
    (profiel.meldingen.samenvattingUur || 0) * 60 + (profiel.meldingen.samenvattingMinuut || 0);
  // Nooit negatief: bij een heel vroeg gekozen tijdstip (bv. 00:05) zou de voorsprong anders naar
  // "de dag ervoor" duwen, wat met minutenNu (0-1439) nooit ingehaald kan worden — dan simpelweg zo
  // vroeg mogelijk vandaag versturen i.p.v. de voorsprong toe te passen.
  var drempel = Math.max(0, gekozenMinuten - SAMENVATTING_VOORSPRONG_MINUTEN);
  return minutenNu >= drempel;
}

/**
 * Stuurt (hooguit één keer per dag per favoriete locatie) een alert zodra een dag ergens binnen de
 * ingestelde Voorspellingshorizon kleur "groen" krijgt — dezelfde score/kleur-berekening als de
 * webapp-kaarten en de dagelijkse samenvatting (bepaalDagOordelenVoorLocatie_ in Code.gs). Geen
 * eigen, losstaande meldingsregel meer: die kon uit de pas gaan lopen met het cijfer zelf (bv. een
 * andere windrichting-tolerantie), wat verwarrend is als de melding iets anders zegt dan de kaart.
 *
 * `profiel.meldingen.laatstGemeld` is per locatie een **verzameling datums** waarvoor al gealerteerd
 * is (`{ '2026-09-01': true, ... }`), niet meer één losse "laatste datum" — nodig omdat nu de hele
 * horizon in één keer gecontroleerd wordt: dag 1 kan al gealerteerd zijn terwijl dag 3 nu pas
 * "Goed" wordt. Datums die niet meer in de horizon vallen (voorbij, of voorbij dagenVooruit) worden
 * er stilzwijgend uit gelaten bij het herschrijven, dus die ruimen zichzelf op.
 *
 * Slaat de bijgewerkte historie per locatie op VÓÓRDAT er een bericht verstuurd wordt (niet
 * erna) — zie de toelichting bij `teVersturen` hieronder voor waarom. Die claim-stap gebeurt
 * gelockt op een VERS van schijf gelezen profiel (`wijzigProfielMetLock_`, ProfielOpslag.gs), niet
 * op het `profiel`-object dat deze functie binnenkwam — dat kan intussen verouderd zijn (een
 * overlappende trigger-run, of de gebruiker die net iets anders opsloeg via de webapp). Een snelle,
 * ongelockte voorcheck (`heeftMogelijkNieuws`) voorkomt dat élke locatie op élke trigger-run de
 * lock+her-lees-stap doorloopt, ook als er overduidelijk niets veranderd is.
 *
 * Stuurt bewust NIETS tussen 22:30-07:00 (zie isStilUur_ hierboven) — deze hele functie slaat dan
 * over, óók het bijwerken van de historie: een dag die midden in de nacht voor het eerst groen
 * wordt, wordt dus simpelweg nog niet als "gemeld" vastgelegd, en telt bij de eerstvolgende run ná
 * 07:00 gewoon weer als nieuw — dus geen gemiste melding, alleen uitgesteld tot na de nachtrust.
 */
function normaliseerMeldingHistorie_(ruweHistorie) {
  // Oudere profielen kunnen hier nog de vroegere vorm hebben (één datum-string i.p.v. een
  // verzameling) — dat negeren i.p.v. te crashen op de 'in'-check hieronder.
  return ruweHistorie && typeof ruweHistorie === 'object' && !Array.isArray(ruweHistorie) ? ruweHistorie : {};
}

function verwerkDirecteAlert_(profiel, vandaag, minutenNu) {
  if (isStilUur_(minutenNu)) return;

  profiel.favorieteLocaties.forEach(function (locatie) {
    var dagOordelen;
    try {
      dagOordelen = bepaalDagOordelenVoorLocatie_(profiel, locatie, profiel.dagenVooruit);
    } catch (eersteFout) {
      // Zelfde eenmalige herkansing als verstuurDagelijkseSamenvatting_ — een externe bron die één
      // keer hapert, mag deze locatie niet voor de rest van de trigger-run overslaan.
      try {
        Utilities.sleep(2000);
        dagOordelen = bepaalDagOordelenVoorLocatie_(profiel, locatie, profiel.dagenVooruit);
      } catch (tweedeFout) {
        Logger.log('verwerkDirecteAlert_: kon weerdata niet ophalen voor ' + locatie.naam + ': ' + tweedeFout);
        return; // Geen alert nu; volgende trigger-run (over 15 min) probeert het gewoon opnieuw.
      }
    }

    var voorlopigeHistorie = normaliseerMeldingHistorie_(profiel.meldingen.laatstGemeld[locatie.id]);
    var heeftMogelijkNieuws = dagOordelen.some(function (dagOordeel) {
      return dagOordeel.datum >= vandaag && dagOordeel.dagScore.kleur === 'groen' && !voorlopigeHistorie[dagOordeel.datum];
    });
    if (!heeftMogelijkNieuws) return; // Niets nieuws voor deze locatie — de lock+her-lees-stap overslaan.

    // CLAIM VÓÓR VERSTUREN, bewust in die volgorde: sla de "al gemeld"-datums eerst op, en stuur
    // pas dáárna de Telegram-berichten. Andersom (versturen, dan pas opslaan — de oude volgorde)
    // gaf herhaalde alerts voor exact dezelfde dag zodra er íets tussen versturen en opslaan mis
    // ging (een haperende Telegram-call, een afgebroken run door een GAS-quotafout, noem het op):
    // het bericht was al de deur uit, maar de volgende run wist daar niets van en probeerde het
    // opnieuw. Met claim-eerst kan dat niet meer: in het ergste geval mist iemand één keer een
    // alert door een echte verstuurfout — en dat weegt veel minder zwaar dan een dag lang
    // herhaalde meldingen over exact dezelfde kitesurf-kans (gebruikersrapport: spam-gevoel).
    var teVersturen = [];
    wijzigProfielMetLock_(profiel.gebruikerId, function (versProfiel) {
      var historie = normaliseerMeldingHistorie_(versProfiel.meldingen.laatstGemeld[locatie.id]);
      var nieuweHistorie = {};

      dagOordelen.forEach(function (dagOordeel, dagIndex) {
        if (dagOordeel.datum < vandaag) return; // Nooit relevant, maar geen alert voor het verleden — prunet vanzelf.
        var algemeld = !!historie[dagOordeel.datum];
        if (dagOordeel.dagScore.kleur === 'groen' && !algemeld) {
          teVersturen.push({ dagOordeel: dagOordeel, dagIndex: dagIndex });
        }
        // Blijf de datum onthouden zodra hij ooit groen gemeld is, ook als de kleur een latere run
        // weer terugzakt naar oranje/rood (voorspellingen kunnen tussen runs wat schuiven, vooral
        // dicht bij de groen/oranje-grens) — anders viel de datum hier stilzwijgend uit
        // nieuweHistorie zodra hij één keer niet-groen was, en triggerde elke keer dat hij daarna
        // weer groen werd een nieuwe alert voor exact dezelfde dag.
        if (dagOordeel.dagScore.kleur === 'groen' || algemeld) {
          nieuweHistorie[dagOordeel.datum] = true;
        }
      });

      versProfiel.meldingen.laatstGemeld[locatie.id] = nieuweHistorie;
      return versProfiel;
    });

    teVersturen.forEach(function (item) {
      try {
        verstuurDagBericht_(profiel.telegramChatId, locatie, item.dagOordeel, item.dagIndex, '⚡ Kitesurf alert');
      } catch (verstuurFout) {
        // Bewust NIET meer opnieuw proberen: de claim staat al vast, dus een falende verstuurpoging
        // hier betekent een gemiste (niet een herhaalde) alert — precies de afweging hierboven.
        Logger.log('verwerkDirecteAlert_: versturen mislukt voor ' + locatie.naam + ' ' + item.dagOordeel.datum + ': ' + verstuurFout);
      }
    });
  });
}

/**
 * Stuurt de dagelijkse samenvatting als een REEKS Telegram-berichten i.p.v. één tekstbericht: per
 * favoriete locatie, per dag (Vandaag/Morgen/Overmorgen, ...), één foto met daarbij als bijschrift
 * letterlijk dezelfde informatie als de ingeklapte dagkaart in de webapp (kleur, verdict, score,
 * wind/weer/getij/zonsondergang, samenvattingszin — zie formatDagBalkTekst in telegramFormat.js)
 * en als foto de grafiek van die dag (wind + regen + kleurindicatie, zie bouwDagGrafiekBlob_).
 *
 * Bewust N berichten i.p.v. één grote tekst: Telegram staat maar één foto per bericht toe (een
 * fotoalbum met per-foto-bijschrift kan wel via sendMediaGroup, maar dat is een aanmerkelijk
 * complexere multipart-aanroep voor enkel een andere presentatievorm — losse berichten na elkaar
 * geven exact dezelfde informatie en zijn op een telefoon net zo goed leesbaar, elk voor zich).
 *
 * Elke locatie wordt onafhankelijk verwerkt: als het ophalen van weerdata voor één locatie faalt,
 * krijgen de andere locaties gewoon hun berichten (zelfde defensieve opzet als elders in dit
 * bestand — één mislukking mag de rest van de melding niet blokkeren).
 *
 * `opties` (optioneel): `alleenLocatieIds` beperkt de run tot die locaties en slaat opening- en
 * slotbericht over — gebruikt door verwerkOpenstaandeHerkansingen_ om alléén de locaties opnieuw te
 * proberen waarvoor de weerdata niet binnenkwam, zonder de hele samenvatting te herhalen.
 * `laatstePoging` bepaalt de toon van het bericht bij (weer) geen data. Geeft
 * `{ mislukteLocatieIds }` terug: de locaties die nog steeds géén enkele dag opleverden.
 */
function verstuurDagelijkseSamenvatting_(profiel, opties) {
  opties = opties || {};
  var alleenLocatieIds = opties.alleenLocatieIds || null;
  var mislukteLocatieIds = [];
  var dagenVooruit = profiel.dagenVooruit || 3;
  // Verkort via TinyURL (zie verkortUrl_ in Code.gs). Gecachet per lange URL (6 uur), dus dit kost
  // geen extra externe aanroep bij elke dagelijkse samenvatting — het gebruikers-ID, en dus deze
  // link, verandert toch nooit.
  var webappUrl = verkortUrl_(ScriptApp.getService().getUrl() + '?id=' + encodeURIComponent(profiel.gebruikerId));

  if (!alleenLocatieIds) {
    verstuurTelegramBotBericht_(
      profiel.telegramChatId,
      '🪁 Kitesurf-vooruitzicht (' + dagenVooruit + ' ' + (dagenVooruit === 1 ? 'dag' : 'dagen') + ')'
    );
  }

  profiel.favorieteLocaties.forEach(function (locatie) {
    if (alleenLocatieIds && alleenLocatieIds.indexOf(locatie.id) === -1) return;
    var dagOordelen;
    try {
      dagOordelen = bepaalDagOordelenVoorLocatie_(profiel, locatie, dagenVooruit);
    } catch (eersteFout) {
      // Eén herkansing: een externe bron (Open-Meteo/Buienradar/RWS/Windfinder) die één keer
      // hapert, mag niet meteen de hele samenvatting voor deze locatie kosten — dat gebeurde
      // (vermoedelijk, niet reproduceerbaar bij live navraag) in de praktijk al eens en leverde
      // toen alleen de kale fallback hieronder op, zonder foto of details.
      try {
        Utilities.sleep(2000);
        dagOordelen = bepaalDagOordelenVoorLocatie_(profiel, locatie, dagenVooruit);
      } catch (tweedeFout) {
        Logger.log('verstuurDagelijkseSamenvatting_: kon weerdata niet ophalen voor ' + locatie.naam + ': ' + tweedeFout);
        mislukteLocatieIds.push(locatie.id);
        meldGeenWeerdata_(profiel, locatie, opties);
        return;
      }
    }
    // Bewaakt het scenario waar het gebruikersrapport ("alleen open-/slotbericht, niets ertussen")
    // op bleef wijzen ook ná de try/catches hierboven: `dagOordelen` komt zónder enige fout terug,
    // maar leeg (of korter dan gevraagd) — dan heeft de forEach hieronder simpelweg NUL iteraties.
    // Live bevestigd via ?actie=laatste-lege-samenvatting (zie hieronder): een concrete locatie gaf
    // op een willekeurig tijdstip 0/3 dagen terug, zonder dat diezelfde locatie/instellingen bij
    // herhaald handmatig navragen ooit opnieuw faalden — een kortstondige hapering van een bron
    // (waarschijnlijk Open-Meteo, de enige verplichte bron) die zélf geen exception veroorzaakt
    // (dus niet gedekt door de try/catch hierboven), maar wél een leeg resultaat.
    //
    // Twee herkansingen i.p.v. één (2s, dan 5s): bij een profiel met een langere Voorspellingshorizon
    // (5 dagen i.p.v. 3) — dus een groter, trager Open-Meteo-verzoek, gemeten ~1,3s i.p.v. ~1s voor
    // dezelfde locatie — bleef het probleem zich vaker voordoen ondanks de eerste herkansing: één
    // gebruikersrapport liet zien dat zowel de oorspronkelijke poging ALS de herkansing 2s later
    // allebei leeg terugkwamen, wat er op wijst dat een hapering soms langer dan 2s aanhoudt. Meer
    // tijd geven de bron zich te herstellen is dan zinvoller dan sneller opgeven.
    for (var poging = 0; poging < 2 && dagOordelen.length < dagenVooruit; poging++) {
      Utilities.sleep(poging === 0 ? 2000 : 5000);
      try {
        var herkansingDagOordelen = bepaalDagOordelenVoorLocatie_(profiel, locatie, dagenVooruit);
        if (herkansingDagOordelen.length > dagOordelen.length) dagOordelen = herkansingDagOordelen;
      } catch (herkansingFout) {
        // Herkansing gooide alsnog een exception: de eerdere (te korte) dagOordelen blijft staan,
        // de lus probeert het hierna nog één keer (of stopt, en het momentopname/bericht-traject
        // hieronder wordt dan alsnog doorlopen).
      }
    }
    // Legt een momentopname vast in Script Properties (i.p.v. alleen Logger.log, dat alleen
    // inzichtelijk is via de Apps Script-editor) zodat een volgend voorval — ook ná de herkansing
    // hierboven — opgevraagd kan worden via ?actie=laatste-lege-samenvatting i.p.v. opnieuw te
    // moeten gissen. Zie Code.gs.
    if (dagOordelen.length < dagenVooruit) {
      try {
        PropertiesService.getScriptProperties().setProperty('LAATSTE_LEGE_SAMENVATTING', JSON.stringify({
          tijdstip: Utilities.formatDate(new Date(), 'Europe/Amsterdam', "yyyy-MM-dd HH:mm:ss"),
          locatie: locatie.naam,
          lat: locatie.lat,
          lon: locatie.lon,
          databronnen: profiel.databronnen,
          dagenGevraagd: dagenVooruit,
          dagenGekregen: dagOordelen.length,
        }));
      } catch (bewaarFout) {}
      Logger.log(
        'verstuurDagelijkseSamenvatting_: ' + locatie.naam + ' gaf ' + dagOordelen.length + '/' +
        dagenVooruit + ' dagen terug, ook ná twee herkansingen (geen fout, gewoon te weinig/leeg).'
      );
      // Zonder dit bericht zou een volledig lege dagOordelen-array (0 dagen) voor deze locatie
      // precies zo onzichtbaar blijven als het oorspronkelijke gebruikersrapport beschrijft — de
      // forEach hieronder doet dan simpelweg niets. Bij een GEDEELTELIJK tekort (bv. 2 van de 3)
      // sturen de wél aanwezige dagen gewoon hun eigen bericht via de forEach; dit extra regeltje
      // maakt dan alleen duidelijk dat er dagen ontbraken, i.p.v. dat stilzwijgend te laten lijken
      // alsof de horizon nu eenmaal korter was.
      if (dagOordelen.length === 0) {
        mislukteLocatieIds.push(locatie.id);
        meldGeenWeerdata_(profiel, locatie, opties);
      } else {
        verstuurTelegramBotBericht_(profiel.telegramChatId, '📍 ' + locatie.naam + ': maar ' + dagOordelen.length + ' van de ' + dagenVooruit + ' dagen ontvangen, ook na twee herkansingen.');
      }
    }
    dagOordelen.forEach(function (dagOordeel, dagIndex) {
      // Try/catch per dag: zonder deze vangnet zou een onverwachte fout bij het opbouwen/versturen
      // van ÉÉN dag (bv. formatDagBalkTekst) niet alleen die ene dag stil laten wegvallen, maar via
      // de ongevangen exception ook de rest van déze locatie EN alle nog te verwerken locaties in
      // deze samenvatting overslaan — de "Bekijk de app"-regel zou dan nog wél volgen (die staat
      // hierbuiten), wat precies het stille-gat-gevolgd-door-de-linkregel-patroon zou opleveren uit
      // een gebruikersrapport dat niet meer live te reproduceren was. Hier dus hoe dan ook dichtgezet.
      try {
        verstuurDagBericht_(profiel.telegramChatId, locatie, dagOordeel, dagIndex);
      } catch (fout) {
        Logger.log('verstuurDagelijkseSamenvatting_: kon dagbericht niet versturen voor ' + locatie.naam + ' dag ' + dagIndex + ': ' + fout);
        // Zichtbaar in Telegram i.p.v. alleen in het (voor de gebruiker onzichtbare) uitvoeringslog
        // — een stil gat in de reeks berichten is precies wat verwarrend bleek in het gebruikersrapport
        // dat tot deze try/catch leidde; nu is minstens duidelijk DAT en WELKE dag het betreft.
        try {
          verstuurTelegramBotBericht_(profiel.telegramChatId, '📍 ' + locatie.naam + ', ' + (MELDING_DAG_LABELS[dagIndex] || 'dag ' + (dagIndex + 1)) + ': kon dit bericht niet versturen.');
        } catch (meldFout) {}
      }
    });
  });

  if (!alleenLocatieIds) {
    verstuurTelegramBotBericht_(profiel.telegramChatId, 'Bekijk de app: ' + webappUrl + '\nGeen berichten meer? Stuur /stop');
  }
  return { mislukteLocatieIds: mislukteLocatieIds };
}

// Hoe vaak (na de eerste poging) een locatie zonder weerdata nog opnieuw wordt geprobeerd, elk
// kwartier (de trigger-cadans) — dus ongeveer een uur, waarna de gebruiker een laatste bericht krijgt.
var SAMENVATTING_MAX_HERKANSINGEN = 4;

/**
 * Bericht bij een locatie waarvoor (ook na de herkansingen binnen één run) geen enkele dag weerdata
 * binnenkwam. Bewust afhankelijk van de ronde: de eerste keer een uitleg mét de belofte dat het
 * vanzelf opnieuw wordt geprobeerd, tussenliggende pogingen stil (anders een bericht per kwartier),
 * en pas bij de laatste poging de mededeling dat het niet gelukt is.
 */
function meldGeenWeerdata_(profiel, locatie, opties) {
  var isEersteRonde = !opties.alleenLocatieIds;
  var tekst = null;
  if (opties.laatstePoging) {
    tekst = '📍 ' + locatie.naam + ': ook na meerdere pogingen (een uur lang) kwam er geen weerdata binnen. Kijk later in de app, of probeer het morgen weer.';
  } else if (isEersteRonde) {
    tekst = '📍 ' + locatie.naam + ': de weerdata kwam nu niet binnen — ik probeer het automatisch opnieuw, over ongeveer een kwartier.';
  }
  if (tekst) verstuurTelegramBotBericht_(profiel.telegramChatId, tekst);
}

// Locaties waarvoor de samenvatting vandaag geen data kreeg, met het aantal al gedane pogingen. In
// Script Properties (niet in het profiel): puur tijdelijke, server-interne administratie die aan het
// eind van de dag vanzelf vervalt, en die profielValidatie niet hoeft te kennen.
function leesHerkansingen_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('SAMENVATTING_HERKANSINGEN') || '{}');
  } catch (e) {
    return {};
  }
}

function bewaarHerkansingen_(map) {
  try {
    PropertiesService.getScriptProperties().setProperty('SAMENVATTING_HERKANSINGEN', JSON.stringify(map));
  } catch (e) {
    Logger.log('bewaarHerkansingen_: kon niet opslaan: ' + e);
  }
}

function registreerHerkansing_(gebruikerId, datum, locatieIds) {
  var map = leesHerkansingen_();
  map[gebruikerId] = { datum: datum, locatieIds: locatieIds, pogingen: 0 };
  bewaarHerkansingen_(map);
}

/**
 * Elke trigger-run: probeert de samenvatting opnieuw voor locaties die eerder vandaag geen weerdata
 * kregen. Aanleiding (gebruikersrapport: "soms wel, soms geen dagelijkse melding"): een run met een
 * lege bron werd tot nu toe als "klaar" afgevinkt (laatsteSamenvattingDatum staat dan op vandaag), dus
 * kreeg zo iemand die dag GEEN samenvatting meer — ook niet als de bron een kwartier later gewoon weer
 * werkte. Herkansingen van een andere dag vervallen zonder iets te sturen.
 */
function verwerkOpenstaandeHerkansingen_(profielen, vandaag) {
  var map = leesHerkansingen_();
  var gebruikerIds = Object.keys(map);
  if (gebruikerIds.length === 0) return 0;

  var nieuw = {};
  var aantal = 0;
  gebruikerIds.forEach(function (gebruikerId) {
    var item = map[gebruikerId];
    if (!item || item.datum !== vandaag) return;
    var profiel = profielen.filter(function (p) { return p.gebruikerId === gebruikerId; })[0];
    if (!profiel || !profiel.telegramChatId) return;
    // Intussen afgemeld (of ontkoppeld): geen nagekomen berichten meer voor vandaag.
    if (!profiel.meldingen || !profiel.meldingen.dagelijkseSamenvatting) return;

    var pogingNr = (item.pogingen || 0) + 1;
    var laatste = pogingNr >= SAMENVATTING_MAX_HERKANSINGEN;
    aantal++;
    var overgeblevenLocatieIds = item.locatieIds;
    try {
      var res = verstuurDagelijkseSamenvatting_(profiel, { alleenLocatieIds: item.locatieIds, laatstePoging: laatste });
      overgeblevenLocatieIds = res.mislukteLocatieIds;
    } catch (fout) {
      Logger.log('verwerkOpenstaandeHerkansingen_: fout bij herkansing ' + pogingNr + ': ' + fout);
    }
    if (overgeblevenLocatieIds.length > 0 && !laatste) {
      nieuw[gebruikerId] = { datum: item.datum, locatieIds: overgeblevenLocatieIds, pogingen: pogingNr };
    }
  });
  bewaarHerkansingen_(nieuw);
  return aantal;
}

/**
 * Eén dag, één locatie: foto (grafiek) met de dagbalk-tekst als bijschrift, tekst-only als
 * fallback. `voorvoegsel` (optioneel) komt vóór de dagbalk-tekst — gebruikt door de directe alert
 * (verwerkDirecteAlert_) om aan te geven dat dit een tussentijdse melding is, niet de geplande
 * dagelijkse samenvatting (die hetzelfde bericht ongewijzigd hergebruikt).
 */
function verstuurDagBericht_(chatId, locatie, dagOordeel, dagIndex, voorvoegsel) {
  var tekst = (voorvoegsel ? voorvoegsel + '\n\n' : '') + formatDagBalkTekst(locatie, dagOordeel, MELDING_DAG_LABELS, dagIndex);
  var afbeelding = null;
  try {
    afbeelding = bouwDagGrafiekBlob_(dagOordeel.dagScore.uurResultaten, dagOordeel.instellingen);
  } catch (fout) {
    afbeelding = null;
  }
  if (afbeelding && verstuurTelegramFotoMetOnderschrift_(chatId, afbeelding, tekst)) return;
  // Nu ook de tekst-fallback zélf op succes controleren (zie telegramApiAanroep_ in TelegramBot.gs
  // voor waarom dat eerder niet gebeurde): mislukt zelfs déze na de ingebouwde 429-herkansing, dan
  // is er voor deze dag/locatie helemaal niets aangekomen — precies het scenario uit een
  // gebruikersrapport dat de vorige twee fixes (foutisolatie, lege-dagOordelen-detectie) allebei
  // niet dekten, omdat er hier geen exception was én dagOordelen prima gevuld was. Vastleggen zodat
  // een eventueel volgend voorval ná déze fix nog steeds harde gegevens oplevert.
  if (!verstuurTelegramBotBericht_(chatId, tekst)) {
    Logger.log('verstuurDagBericht_: kon geen enkel bericht (foto noch tekst) versturen voor ' + locatie.naam + ' dag ' + dagIndex);
    try {
      PropertiesService.getScriptProperties().setProperty('LAATSTE_MISLUKTE_VERSTUURPOGING', JSON.stringify({
        tijdstip: Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm:ss'),
        locatie: locatie.naam,
        dagIndex: dagIndex,
        hadAfbeelding: !!afbeelding,
      }));
    } catch (bewaarFout) {}
  }
}

// Zelfde vaste weergavevenster als de webapp-grafiek (zie GRAFIEK_START_UUR/EIND_UUR in
// JavaScript.html) — zodat de Telegram-grafiek exact hetzelfde uurbereik toont.
var GRAFIEK_START_UUR_ = 9;
var GRAFIEK_EIND_UUR_ = 20;

// Layout van de Slides-grafiek, in punten (Slides' eenheid — een nieuwe presentatie heeft een
// vaste standaard paginagrootte van 720x405 punten; `Presentation` heeft geen setPageWidth/
// -Height, live ontdekt, zie TESTING.md). Deze lay-out is met opzet ontworpen om ruim binnen die
// 720x405 te passen (700 breed, ~342 hoog) i.p.v. de paginagrootte te proberen aan te passen.
// Zelfde volgorde van boven naar beneden als bouwUurGrafiek in JavaScript.html: eerst de
// regendruppel-rij, dan de balken+lijn, dan de uur-labels, dan de legenda-tekst.
var GRAFIEK_BREEDTE_ = 700;
var GRAFIEK_YAS_BREEDTE_ = 34;
var GRAFIEK_REGENRIJ_TOP_ = 6;
var GRAFIEK_REGENRIJ_HOOGTE_ = 24;
var GRAFIEK_PLOT_TOP_ = GRAFIEK_REGENRIJ_TOP_ + GRAFIEK_REGENRIJ_HOOGTE_ + 4;
var GRAFIEK_PLOT_HOOGTE_ = 260;
var GRAFIEK_PLOT_BREEDTE_ = GRAFIEK_BREEDTE_ - GRAFIEK_YAS_BREEDTE_ - 10;
var GRAFIEK_LABELS_TOP_ = GRAFIEK_PLOT_TOP_ + GRAFIEK_PLOT_HOOGTE_ + 2;
var GRAFIEK_LABELS_HOOGTE_ = 16;
var GRAFIEK_LEGENDA_TOP_ = GRAFIEK_LABELS_TOP_ + GRAFIEK_LABELS_HOOGTE_ + 6;

/**
 * Bouwt de PNG-grafiek voor de Telegram-berichten door de webapp's Grafiek-tab (bouwUurGrafiek in
 * JavaScript.html) na te tekenen met Google Slides-vormen: balken (windsnelheid, kleur = score),
 * een lijn erover (windvlagen, zelfde kn-schaal), regendruppels erboven, uur-labels en een
 * legenda-regel — pixel-voor-pixel dezelfde opbouw en schaalberekening als de webapp, i.p.v. een
 * eigen andere weergave.
 *
 * **Waarom via Slides en niet via de ingebouwde `Charts`-service**: die kan geen staven en een
 * lijn in één afbeelding combineren (`Charts.newComboChart` bestaat niet, live geverifieerd — zie
 * TESTING.md), dus de windvlagen-lijn kon er niet in. Slides-vormen (rechthoeken voor de balken,
 * losse lijnstukken voor de vlaaglijn, tekstvakken voor labels/druppels/legenda) kennen die
 * beperking niet: het is gewoon tekenen, geen grafiek-abstractie. Een tijdelijke presentatie wordt
 * per grafiek aangemaakt, als PNG geëxporteerd via de authenticated Drive-exportlink, en meteen
 * weer weggegooid (`finally`) — er blijft dus geen rommel achter in Drive.
 *
 * **Vereist eenmalige autorisatie** (`https://www.googleapis.com/auth/presentations`) die de
 * bestaande grant niet dekte — zie SETUP.md voor de eenmalige editor-stap.
 * @param {Array} uurResultaten - dagScore.uurResultaten (alle 24 uur; wordt hier gefilterd)
 * @param {Object} instellingen - niet meer gebruikt door deze functie zelf (de kleur zit al in elk
 *   uurresultaat), maar behouden in de signatuur zodat call sites niet hoeven te wijzigen.
 * @returns {GoogleAppsScript.Base.Blob|null}
 */
function bouwDagGrafiekBlob_(uurResultaten, instellingen) {
  var zichtbareUren = (uurResultaten || []).filter(function (u) {
    var uur = new Date(u.tijdstip).getHours();
    return uur >= GRAFIEK_START_UUR_ && uur <= GRAFIEK_EIND_UUR_;
  });
  if (zichtbareUren.length === 0) return null;

  // Zelfde schaal-logica als bouwUurGrafiek: de hoogste van álle wind- én vlaagwaarden bepaalt de
  // as, naar boven afgerond op 5 — anders zou de vlaaglijn af en toe buiten beeld vallen.
  var alleKnopen = [];
  zichtbareUren.forEach(function (u) {
    if (!u.ruw) return;
    if (u.ruw.windKnopen != null) alleKnopen.push(u.ruw.windKnopen);
    if (u.ruw.windvlaagKnopen != null) alleKnopen.push(u.ruw.windvlaagKnopen);
  });
  var maxKn = alleKnopen.length ? Math.ceil(Math.max.apply(null, alleKnopen) / 5) * 5 : 10;
  if (maxKn < 5) maxKn = 5;

  var n = zichtbareUren.length;
  var plotX0 = GRAFIEK_YAS_BREEDTE_;
  var slotBreedte = GRAFIEK_PLOT_BREEDTE_ / n;
  var plotBottom = GRAFIEK_PLOT_TOP_ + GRAFIEK_PLOT_HOOGTE_;
  var KLEUR_HEX = { groen: '#2ecc71', oranje: '#f5a623', rood: '#e74c3c' };

  var presentatie = null;
  try {
    // Standaard paginagrootte (720x405 pt) blijft ongewijzigd — zie de lay-out-toelichting
    // hierboven. De grafiek beslaat het linkerbovendeel van de pagina; de rest blijft wit.
    presentatie = SlidesApp.create('kiteweer-grafiek-' + new Date().getTime());
    var slide = presentatie.getSlides()[0];
    // De standaard-placeholder-tekstvakken van een nieuwe slide staan in de weg van de grafiek.
    slide.getShapes().forEach(function (vorm) { vorm.remove(); });

    function tekstVak(tekst, x, y, breedte, hoogte, kleur, puntgrootte, gecentreerd) {
      var vak = slide.insertTextBox(tekst, x, y, breedte, hoogte);
      vak.getFill().setTransparent();
      vak.getBorder().setTransparent();
      var stijl = vak.getText().getTextStyle();
      stijl.setFontSize(puntgrootte).setForegroundColor(kleur).setFontFamily('Arial');
      if (gecentreerd) {
        vak.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      }
      return vak;
    }

    // Y-as: max/helft/0, op dezelfde drie hoogtes als de balken-plot.
    tekstVak(String(maxKn), 2, GRAFIEK_PLOT_TOP_ - 6, GRAFIEK_YAS_BREEDTE_ - 6, 14, '#8e8e93', 9, false);
    tekstVak(String(Math.round(maxKn / 2)), 2, GRAFIEK_PLOT_TOP_ + GRAFIEK_PLOT_HOOGTE_ / 2 - 6, GRAFIEK_YAS_BREEDTE_ - 6, 14, '#8e8e93', 9, false);
    tekstVak('0', 2, plotBottom - 12, GRAFIEK_YAS_BREEDTE_ - 6, 14, '#8e8e93', 9, false);

    // Balken: windsnelheid = hoogte, score = kleur — identiek aan .balk in de webapp-CSS.
    zichtbareUren.forEach(function (u, i) {
      var wind = u.ruw ? u.ruw.windKnopen : null;
      var percentage = wind != null ? Math.max(2, (wind / maxKn) * 100) : 2;
      var hoogte = (percentage / 100) * GRAFIEK_PLOT_HOOGTE_;
      var breedte = slotBreedte * 0.7;
      var x = plotX0 + i * slotBreedte + (slotBreedte - breedte) / 2;
      var y = plotBottom - hoogte;
      var balk = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, breedte, hoogte);
      balk.getFill().setSolidFill(KLEUR_HEX[u.kleur] || '#8e8e93');
      balk.getBorder().setTransparent();
    });

    // Windvlagen-lijn: punten van links (uur 0) naar rechts (laatste uur), verdeeld over de volle
    // plotbreedte — zelfde x-verdeling (i/(n-1)) als bouwGrafiekVlaagLijnSvg. Een ontbrekend punt
    // breekt het lijnstuk af i.p.v. er overheen te trekken (geen lijn tussen twee punten waarvan
    // er één null is).
    var vorigPunt = null;
    zichtbareUren.forEach(function (u, i) {
      var vlaag = u.ruw ? u.ruw.windvlaagKnopen : null;
      if (vlaag == null) { vorigPunt = null; return; }
      var x = n > 1 ? plotX0 + (i / (n - 1)) * GRAFIEK_PLOT_BREEDTE_ : plotX0 + GRAFIEK_PLOT_BREEDTE_ / 2;
      var yPercentage = Math.max(2, 100 - (vlaag / maxKn) * 100);
      var y = GRAFIEK_PLOT_TOP_ + (yPercentage / 100) * GRAFIEK_PLOT_HOOGTE_;
      if (vorigPunt) {
        var lijn = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, vorigPunt.x, vorigPunt.y, x, y);
        lijn.getLineFill().setSolidFill('#555555');
        lijn.setWeight(2);
      }
      vorigPunt = { x: x, y: y };
    });

    // Regendruppels boven de balken — alleen bij noemenswaardige neerslag (zelfde 0,2 mm-drempel
    // als de webapp; motregen zou anders elk uur een druppel geven).
    zichtbareUren.forEach(function (u, i) {
      var mm = u.ruw ? u.ruw.neerslagMm : null;
      if (mm == null || mm < 0.2) return;
      var tekst = '💧' + (mm >= 1 ? Math.round(mm) : mm.toFixed(1));
      var x = plotX0 + i * slotBreedte;
      tekstVak(tekst, x, GRAFIEK_REGENRIJ_TOP_, slotBreedte, GRAFIEK_REGENRIJ_HOOGTE_, '#3498db', 9, true);
    });

    // Uur-labels: elk 3e uur, zelfde "niet te vol"-regel als de webapp.
    zichtbareUren.forEach(function (u, i) {
      var uur = new Date(u.tijdstip).getHours();
      if (uur % 3 !== 0) return;
      var x = plotX0 + i * slotBreedte;
      tekstVak(String(uur), x, GRAFIEK_LABELS_TOP_, slotBreedte, GRAFIEK_LABELS_HOOGTE_, '#8e8e93', 9, true);
    });

    tekstVak(
      'Balk = windsnelheid (kn), kleur = score. Lijn = windvlagen. 💧 = regen in mm.',
      plotX0, GRAFIEK_LEGENDA_TOP_, GRAFIEK_PLOT_BREEDTE_, 18, '#8e8e93', 8, false
    );

    var presentatieId = presentatie.getId();
    // Cruciaal: zonder expliciet op te slaan blijft de export-URL een blanco pagina teruggeven —
    // die leest kennelijk de laatst ópgeslagen versie, niet de nog openstaande bewerksessie. Live
    // ontdekt (eerst kreeg elke poging een leeg wit PNG terug, ondanks een lange Utilities.sleep()
    // ervoor — pas na saveAndClose() verscheen de inhoud), zie TESTING.md.
    presentatie.saveAndClose();
    Utilities.sleep(2000);
    var exportUrl = 'https://docs.google.com/presentation/d/' + presentatieId + '/export/png?pageid=' + slide.getObjectId();
    var response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) return null;
    return response.getBlob();
  } finally {
    // Altijd opruimen, ook bij een fout onderweg: dit was alleen een tussenstap om een
    // afbeelding te krijgen, geen bestand dat iemand ooit terug hoeft te vinden in Drive.
    if (presentatie) {
      try { DriveApp.getFileById(presentatie.getId()).setTrashed(true); } catch (opruimFout) {}
    }
  }
}
