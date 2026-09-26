// GAS entry points: doGet/doPost. De front-end praat via het standaard `google.script.run`-
// mechanisme met de functies hieronder — dat vereist dat de pagina via HtmlService.evaluate()
// geserveerd wordt (niet via ContentService: die geeft op /exec bij nader inzien altijd
// Content-Type text/plain terug, ongeacht setMimeType(HTML), en rendert dus niet als pagina).
//
// Toegang: geen account/login. Elke gebruiker heeft een eigen, niet-geraden gebruikers-ID (een
// UUID, gegenereerd in de browser bij het eerste bezoek en bewaard in de URL + localStorage).
// Wie die ID kent, kan bij dat profiel — vergelijkbaar met een deel-link. Zie README.md
// "Aannames" voor de afweging.

// Handmatig ophogen bij elke betekenisvolle wijziging/deploy — zichtbaar onderin de app, zodat
// eenvoudig te controleren is of een nieuwe versie daadwerkelijk live staat (i.p.v. een gecachete
// oudere versie in de browser).
var KITEWEER_VERSIE = 'v96 (21 sep 2026)';

/**
 * Verkort een URL via TinyURL's geauthenticeerde API (eigen account + API-token in Script
 * Properties, zie getTinyUrlToken_ in Config.gs) — i.p.v. de eerder gebruikte anonieme
 * api-create.php, die bij het openen een tussenpagina toont in plaats van direct door te
 * verwijzen (zie README.md "Verkorte links" voor de volledige geschiedenis, incl. het geprobeerde
 * en structureel kapot gebleken `is.gd`-alternatief). Zonder token: gewoon de lange URL, geen
 * enkele link is hier ooit van afhankelijk. Cachet 6 uur per lange URL, zodat een vast appLink
 * (verandert nooit zolang het gebruikers-ID hetzelfde blijft) niet bij elke melding een nieuwe
 * externe aanroep kost. Valt terug op de lange URL bij elke fout.
 */
function verkortUrl_(langeUrl) {
  var token = getTinyUrlToken_();
  if (!token) return langeUrl;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'kort_' + Utilities.base64EncodeWebSafe(langeUrl).slice(0, 200);
  var gecached = cache.get(cacheKey);
  if (gecached) return gecached;

  try {
    var response = UrlFetchApp.fetch('https://api.tinyurl.com/create', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ url: langeUrl }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      var korteUrl = data && data.data && data.data.tiny_url;
      if (korteUrl && korteUrl.indexOf('https://tinyurl.com/') === 0) {
        cache.put(cacheKey, korteUrl, 21600);
        return korteUrl;
      }
    }
  } catch (fout) {
    // TinyURL onbereikbaar of onverwacht antwoord: gewoon de lange URL teruggeven, niet crashen.
  }
  return langeUrl;
}

function doGet(e) {
  // ?actie=widget geeft een kleine, platte JSON-samenvatting terug i.p.v. de HTML-app — voor
  // niet-browser clients zoals een Tasker-widget die geen google.script.run kunnen gebruiken (dat
  // vereist een pagina binnen de HtmlService-iframe) en dus een gewoon HTTP GET-antwoord nodig
  // hebben. Zie widgetJson_ hieronder en README.md "Aannames" voor de afweging.
  if (e && e.parameter && e.parameter.actie === 'widget') {
    return widgetJson_(e);
  }
  // ?actie=onderhoud herstelt de twee dingen die buiten de code om ingesteld moesten worden en
  // daardoor stil kapot konden staan: de Telegram-webhook (was nooit geregistreerd, dus koppelen
  // faalde geruisloos) en de meldingen-trigger (moest handmatig in de editor gedraaid worden).
  // Beide acties zijn idempotent en geven niets gevoeligs prijs, dus de route mag publiek zijn.
  if (e && e.parameter && e.parameter.actie === 'onderhoud') {
    return ContentService.createTextOutput(JSON.stringify(voerOnderhoudUit_(), null, 2)).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  // ?actie=laatste-lege-samenvatting geeft de laatst vastgelegde momentopname terug van een dag-
  // oordeel dat leeg/te kort terugkwam zónder fout (zie de toelichting bij LAATSTE_LEGE_SAMENVATTING
  // in verstuurDagelijkseSamenvatting_, Meldingen.gs) — voor het navragen van een gebruikersrapport
  // ("geen grafieken/data") zonder op Apps Script's uitvoeringslog aangewezen te zijn. Geeft alleen
  // een locatienaam/coördinaten/instellingen terug, niets gebruikers- of chat-gebonden, dus de route
  // mag net als ?actie=onderhoud publiek zijn.
  if (e && e.parameter && e.parameter.actie === 'laatste-lege-samenvatting') {
    var props = PropertiesService.getScriptProperties();
    return ContentService.createTextOutput(JSON.stringify({
      legeDagOordelen: JSON.parse(props.getProperty('LAATSTE_LEGE_SAMENVATTING') || 'null'),
      misluktVersturen: JSON.parse(props.getProperty('LAATSTE_MISLUKTE_VERSTUURPOGING') || 'null'),
    }, null, 2)).setMimeType(ContentService.MimeType.JSON);
  }
  // ?actie=meldingen-status: alleen-lezen inzicht in de meldingen-trigger — de laatste runs (duur,
  // opwarm-duur, welke samenvattingen en hoe lang), of de laatste run is afgebroken, de laatste
  // mislukte bronaanvragen (statuscode + respons), openstaande herkansingen, en per Telegram-profiel
  // de verwachte belasting. Aanleiding: "soms wel, soms geen dagelijkse melding" zonder enig zicht
  // op wat een run eigenlijk doet. Profielen alleen op volgnummer; geen gebruikers-/chat-ID, dus
  // publiek net als ?actie=onderhoud.
  if (e && e.parameter && e.parameter.actie === 'meldingen-status') {
    var msProps = PropertiesService.getScriptProperties();
    var msRunLog = JSON.parse(msProps.getProperty('RUN_LOG') || '[]');
    var msLaatsteStart = msProps.getProperty('RUN_LAATSTE_START');
    var msLaatsteRun = msRunLog.length ? msRunLog[msRunLog.length - 1] : null;
    var msHerkansingen = JSON.parse(msProps.getProperty('SAMENVATTING_HERKANSINGEN') || '{}');
    var msTelegramProfielen = laadAlleProfielen_()
      .filter(function (p) { return p.telegramChatId; })
      .map(function (p, i) {
        var aantalLocaties = (p.favorieteLocaties || []).length;
        var dagen = p.dagenVooruit || 3;
        return {
          nr: i,
          samenvatting: !!(p.meldingen && p.meldingen.dagelijkseSamenvatting),
          tijd: (p.meldingen.samenvattingUur || 0) + ':' + ('0' + (p.meldingen.samenvattingMinuut || 0)).slice(-2),
          laatsteSamenvattingDatum: p.meldingen.laatsteSamenvattingDatum || null,
          dagen: dagen,
          locaties: aantalLocaties,
          grafieken: dagen * aantalLocaties,
          geschatteSecondenGrafieken: dagen * aantalLocaties * 5,
        };
      });
    return ContentService.createTextOutput(JSON.stringify({
      laatsteRunAfgebroken: !!(msLaatsteStart && (!msLaatsteRun || msLaatsteRun.start !== msLaatsteStart)),
      laatsteStart: msLaatsteStart,
      runs: msRunLog,
      bronFouten: JSON.parse(msProps.getProperty('BRONFOUTEN') || '[]'),
      openstaandeHerkansingen: Object.keys(msHerkansingen).length,
      telegramProfielen: msTelegramProfielen,
    }, null, 2)).setMimeType(ContentService.MimeType.JSON);
  }
  // ?actie=verificatie: toetsing van de weermodellen aan KNMI-metingen + welke meetstations dat zijn (zie
  // Verificatie.gs). Alleen stations en statistiek, geen gebruikers-, profiel- of spot-gegevens: publiek.
  if (e && e.parameter && e.parameter.actie === 'verificatie') {
    return ContentService.createTextOutput(JSON.stringify(bouwVerificatieRapport_(), null, 2)).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  var template = HtmlService.createTemplateFromFile('index');
  // De pagina draait zelf in een geneste iframe met een eigen, instabiele interne URL — voor de
  // deel-/bookmarklink die de gebruiker te zien krijgt hebben we de echte, publieke /exec-URL
  // nodig, die alleen de server kent (ScriptApp.getService().getUrl()). Om dezelfde reden lezen
  // we een meegegeven ?id=... hier server-side uit `e.parameter` i.p.v. te vertrouwen op
  // location.search in de client (die weerspiegelt de interne iframe-URL, niet de bezochte URL).
  template.webappUrl = ScriptApp.getService().getUrl();
  template.gebruikerIdUitUrl = (e && e.parameter && e.parameter.id) || null;
  template.versie = KITEWEER_VERSIE;
  var apkBestandsId = getWidgetApkBestandsId_();
  // uc?export=download i.p.v. uc?id= (dat laatste is de inline-weergave-variant die de widget-
  // grafiekafbeeldingen gebruiken, zie slaWidgetGrafiekOp_) — hier moet de browser het bestand
  // daadwerkelijk downloaden, niet proberen te tonen.
  template.apkDownloadUrl = apkBestandsId ? 'https://drive.google.com/uc?export=download&id=' + apkBestandsId : null;
  return template
    .evaluate()
    .setTitle('Kite Weer App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Zoekt het profiel en de gevraagde (of anders eerste) favoriete locatie op voor widgetJson_.
 * `{ fout }` bij een ongeldig/ontbrekend gebruikers-ID of een profiel zonder favoriete locaties,
 * anders `{ profiel, locatie }`.
 */
function widgetProfielEnLocatie_(e) {
  var gebruikerId = e && e.parameter && e.parameter.id;
  if (!gebruikerId) return { fout: 'Ontbrekend ?id=<gebruikerId>' };

  var profiel = laadProfiel_(gebruikerId.trim().slice(0, 100));
  if (!profiel.favorieteLocaties || profiel.favorieteLocaties.length === 0) {
    return { fout: 'Geen favoriete locaties in dit profiel' };
  }
  var gevraagdeLocatieId = e.parameter.locatie;
  var locatie =
    (gevraagdeLocatieId && profiel.favorieteLocaties.filter(function (l) { return l.id === gevraagdeLocatieId; })[0]) ||
    profiel.favorieteLocaties[0];
  return { profiel: profiel, locatie: locatie, gebruikerId: gebruikerId.trim().slice(0, 100) };
}

/**
 * Platte JSON-samenvatting van "nu/vandaag" voor één favoriete locatie — bedoeld voor een
 * Tasker-widget (of vergelijkbare automatiseringsclient) via een gewoon HTTP GET, met
 * `?actie=widget&id=<gebruikerId>` (en optioneel `&locatie=<locatieId>`, anders de eerste
 * favoriet). Bewust een aparte, kleine vorm i.p.v. hergebruik van getWeerOordeel's volledige
 * meerdaagse/meeruurse structuur — een widget toont toch maar een handvol velden.
 *
 * `grafiekUrl` is een publiek-met-link-deelbare Drive-afbeelding van de dag-grafiek van vandaag
 * (wind, score-kleur en regen — dezelfde `bouwDagGrafiekBlob_` als de Telegram-berichten, zie
 * Meldingen.gs) — bedoeld als rechtstreekse `url` van een "Image"-element in de
 * Tasker-widgetlayout. **Niet** rechtstreeks als binaire respons van dit endpoint zelf: live
 * tegen de deployment geprobeerd en geverifieerd met curl dat `doGet` een Blob niet als
 * binaire afbeelding teruggeeft maar in een HTML-wrapper verpakt (zie TESTING.md) — vandaar de
 * omweg via Drive, net als foto-opslag elders in dit soort GAS-projecten.
 *
 * Content-Type-kanttekening voor de JSON zelf: `ContentService` geeft op de /exec-URL soms
 * `text/plain` terug ongeacht `setMimeType()` (zie de doGet-comment hierboven, ontdekt bij de
 * HTML-pagina) — live gecontroleerd dat dit voor déze JSON-response niet optreedt (wél
 * `application/json`), en voor een programmatische client als Tasker zou het toch niets uitmaken.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
/** "15:00", desgewenst een uur verschoven (%24 zodat 23u+1 netjes naar "00:00" wrapt). */
function formatWidgetUurLabel_(tijdstip, plusUur) {
  var uur = (new Date(tijdstip).getHours() + (plusUur || 0)) % 24;
  return (uur < 10 ? '0' : '') + uur + ':00';
}

function widgetJson_(e) {
  var json = (function () {
    var gevonden = widgetProfielEnLocatie_(e);
    if (gevonden.fout) return gevonden;
    var profiel = gevonden.profiel;
    var locatie = gevonden.locatie;

    var windrichting = locatie.windrichting || { besteRanges: [], acceptabeleRanges: [] };
    var instellingen = Object.assign({}, profiel.drempelwaarden, { windrichting: windrichting });
    var dagvensterOpties = {
      dagvensterStartUur: profiel.dagvenster.startUur,
      dagvensterEindUur: profiel.dagvenster.eindUur,
      minimaleSessieUren: profiel.minimaleSessieUren,
      gewichten: profiel.scoreGewichten,
    };
    var verdictPerKleur = {
      groen: 'Goede kite-conditie',
      oranje: 'Matige kite-conditie',
      rood: 'Niet geschikt om te kiten',
    };
    function ruwVanDagScore(dagScore) {
      return dagScore.besteUur ? dagScore.besteUur.ruw : null;
    }
    function kompasVan(ruw) {
      return ruw && ruw.windrichtingGraden != null ? windrichtingKompas(ruw.windrichtingGraden) : null;
    }

    // Niet meer alleen vandaag: de "volgende kans" hieronder moet ook een dag verderop kunnen
    // vinden, dus over de hele ingestelde Voorspellingshorizon ophalen (zelfde als
    // bepaalDagOordelenVoorLocatie_ voor de webapp/Telegram).
    var dagenVooruit = profiel.dagenVooruit || 3;
    var weerData = haalWeerDataOp_(locatie.lat, locatie.lon, profiel.databronnen, dagenVooruit);
    var dagen = groepeerPerDag(weerData.urenData).slice(0, dagenVooruit);
    if (dagen.length === 0) return { fout: 'Geen weerdata beschikbaar voor deze locatie' };

    // Screen 1 (oorspronkelijk) / grafiekbron voor screen 2: "vandaag" over de volle dag,
    // ongefilterd op de klok — dezelfde berekening als de webapp's Grafiek-tab.
    var dagScoreVandaag = berekenDagScore(dagen[0].uren, instellingen, dagvensterOpties);
    var ruwVandaag = ruwVanDagScore(dagScoreVandaag);

    var grafiekUrl = null;
    try {
      // Zelfde dag-grafiek (wind + regen + score-kleur) als de Telegram-berichten (Meldingen.gs) —
      // dagScoreVandaag.uurResultaten is al precies de vorm die bouwDagGrafiekBlob_ verwacht.
      // Filtert zelf op het vaste 09:00-20:00-grafiekvenster (GRAFIEK_START_UUR_/EIND_UUR_), niet
      // op het profiel-Dagvenster — zelfde vaste venster als de webapp's eigen Grafiek-tab.
      var afbeelding = bouwDagGrafiekBlob_(dagScoreVandaag.uurResultaten, instellingen);
      if (afbeelding) grafiekUrl = slaWidgetGrafiekOp_(afbeelding, gevonden.gebruikerId);
    } catch (fout) {
      grafiekUrl = null; // Grafiek-opbouw/-upload mislukt: widget blijft werken zonder afbeelding.
    }

    // Nieuw, voor widget-scherm 1: de eerstvolgende mogelijkheid om te kiten vanaf NU, gezocht
    // over de hele Voorspellingshorizon — een aaneengesloten blok van minimaal
    // profiel.minimaleSessieUren uur (standaard 2) dat aan de ingestelde drempelwaarden voldoet,
    // via dezelfde berekenDagScore/vindBesteVenster als de webapp-kaarten (kleur !== 'rood' telt
    // hier als "geschikt", zelfde maatstaf als de dagkaart-badge en de Telegram-alert). Vandaag
    // tellen alleen uren vanaf nu mee — zelfde "is dit al voorbij"-grens als de Tabel-weergave in
    // JavaScript.html (new Date(tijdstip) >= nu) — anders zou de widget een kans kunnen tonen die
    // al verstreken is.
    var nu = new Date();
    var volgendeKans = { gevonden: false };
    for (var i = 0; i < dagen.length; i++) {
      var urenVoorZoektocht = i === 0
        ? dagen[0].uren.filter(function (u) { return new Date(u.tijdstip) >= nu; })
        : dagen[i].uren;
      var kansScore = berekenDagScore(urenVoorZoektocht, instellingen, dagvensterOpties);
      if (!kansScore.besteVenster || kansScore.kleur === 'rood') continue;

      var ruwKans = ruwVanDagScore(kansScore);
      volgendeKans = {
        gevonden: true,
        dagLabel: MELDING_DAG_LABELS[i] || formatDatumKort(dagen[i].datum),
        datum: dagen[i].datum,
        vanaf: formatWidgetUurLabel_(kansScore.besteVenster.startTijdstip, 0),
        // +1 uur: het laatste uur van het venster loopt tot het eind van dat uur (zelfde conventie
        // als dagSamenvatting.bouwDagSamenvatting).
        tot: formatWidgetUurLabel_(kansScore.besteVenster.eindTijdstip, 1),
        kleur: kansScore.kleur,
        score: kansScore.score,
        verdict: verdictPerKleur[kansScore.kleur] || kansScore.kleur,
        windKnopen: ruwKans && ruwKans.windKnopen != null ? Math.round(ruwKans.windKnopen) : null,
        windrichtingKompas: kompasVan(ruwKans),
        windvlaagKnopen: ruwKans && ruwKans.windvlaagKnopen != null ? Math.round(ruwKans.windvlaagKnopen) : null,
      };
      break;
    }

    return {
      spotnaam: locatie.naam,
      bijgewerkt: Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'HH:mm'),
      // "Vandaag over de volle dag" — ongewijzigd t.o.v. eerdere versies van dit endpoint.
      kleur: dagScoreVandaag.kleur,
      score: dagScoreVandaag.score,
      verdict: verdictPerKleur[dagScoreVandaag.kleur] || dagScoreVandaag.kleur,
      windKnopen: ruwVandaag && ruwVandaag.windKnopen != null ? Math.round(ruwVandaag.windKnopen) : null,
      windrichtingKompas: kompasVan(ruwVandaag),
      windvlaagKnopen: ruwVandaag && ruwVandaag.windvlaagKnopen != null ? Math.round(ruwVandaag.windvlaagKnopen) : null,
      grafiekUrl: grafiekUrl,
      volgendeKans: volgendeKans,
    };
  })();

  return ContentService.createTextOutput(JSON.stringify(json)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Slaat de grafiek-afbeelding op als Drive-bestand (map: getWidgetGrafiekenMapId_) en geeft een
 * publiek-met-link-deelbare `drive.google.com/uc?id=`-URL terug. Eén bestand per gebruiker
 * (`grafiek-<gebruikerId>.png`) — een eventueel bestaand bestand wordt eerst verwijderd i.p.v.
 * DriveApp's beperkte in-place-content-vervanging te gebruiken, dat voorkomt dat er bij elke
 * widget-ververing een nieuw bestand blijft ophopen.
 * @returns {string}
 */
function slaWidgetGrafiekOp_(afbeeldingBlob, gebruikerId) {
  var map = DriveApp.getFolderById(getWidgetGrafiekenMapId_());
  var bestandsnaam = 'grafiek-' + gebruikerId + '.png';

  var bestaande = map.getFilesByName(bestandsnaam);
  while (bestaande.hasNext()) bestaande.next().setTrashed(true);

  var bestand = map.createFile(afbeeldingBlob.setName(bestandsnaam));
  bestand.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?id=' + bestand.getId();
}

/**
 * Enige binnenkomende kanaal voor de Telegram-bot-webhook (zie TelegramBot.gs) — niet gebruikt
 * door de webapp zelf (die praat via google.script.run, niet via doPost).
 */
function doPost(e) {
  try {
    var update = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Telegram levert een update opnieuw aan zolang het geen tijdig HTTP 200 terugziet. Dit
    // handmatig verwerken kost meerdere Drive-calls en kan die grens halen, waardoor dezelfde
    // /start eindeloos opnieuw binnenkwam en de gebruiker een stroom identieke antwoorden kreeg.
    // Elk update heeft een uniek, oplopend `update_id`; dat één keer verwerken maakt de webhook
    // idempotent, ongeacht waaróm Telegram het opnieuw stuurt. Bewust markeren vóór het
    // verwerken: een herhaling die binnenkomt terwijl we nog bezig zijn, moet ook al afketsen.
    if (update.update_id != null && telegramUpdateAlGezien_(update.update_id)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, overgeslagen: 'dubbel' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (update.message) verwerkTelegramBericht_(update.message);
  } catch (err) {
    // Onverwachte/ongeldige payload: negeren, geen foutrespons nodig richting Telegram.
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Onthoudt verwerkte Telegram-`update_id`s zodat een herhaalde aflevering niet nogmaals wordt
 * afgehandeld. Retourneert true als dit update al eerder is gezien.
 * Zes uur bewaren is ruim: Telegram geeft het na een paar minuten op.
 */
function telegramUpdateAlGezien_(updateId) {
  var cache = CacheService.getScriptCache();
  var sleutel = 'tg_update_' + updateId;
  if (cache.get(sleutel)) return true;
  cache.put(sleutel, '1', 21600);
  return false;
}

/** Voegt een HTML-partial in vanuit een <?!= include('naam'); ?> template-tag. */
function include(bestandsnaam) {
  return HtmlService.createHtmlOutputFromFile(bestandsnaam).getContent();
}

/** Simpele sanity-check op het gebruikers-ID (moet een niet-lege string zijn, verder geen eisen). */
function metGebruiker_(gebruikerId, fn) {
  if (!gebruikerId || typeof gebruikerId !== 'string') {
    return { fout: 'Ongeldig of ontbrekend gebruikers-ID' };
  }
  return fn(gebruikerId.trim().slice(0, 100));
}

function getProfiel(gebruikerId) {
  return metGebruiker_(gebruikerId, function (id) {
    return { profiel: laadProfiel_(id) };
  });
}

function saveProfiel(gebruikerId, ruwProfiel) {
  return metGebruiker_(gebruikerId, function (id) {
    // Geen wijzigProfielMetLock_ hier: de client stuurt al een compleet, gewenst eind-profiel mee
    // (geen transformatie op een vers server-gelezen profiel) — de lock rond de schrijfactie zelf
    // beschermt wel tegen letterlijk gelijktijdig schrijven (bv. samen met de kwartier-trigger),
    // maar niet tegen een client die met een verouderde momentopname werkte. Zie
    // wijzigProfielMetLock_ (ProfielOpslag.gs) voor de volledige toelichting.
    var lock = LockService.getScriptLock();
    var resultaat;
    if (lock.tryLock(10000)) {
      try {
        resultaat = slaProfielOp_(id, ruwProfiel);
      } finally {
        lock.releaseLock();
      }
    } else {
      // Kon de lock niet krijgen (een andere schrijver is al bezig) — toch opslaan i.p.v. de
      // gebruikers-actie te laten mislukken; beter een zeldzame race dan een opslaan dat zomaar
      // faalt zonder duidelijke reden voor de gebruiker.
      resultaat = slaProfielOp_(id, ruwProfiel);
    }
    return { profiel: resultaat.profiel, fouten: resultaat.fouten };
  });
}

function voegFavorieteLocatieToeServer(gebruikerId, ruweLocatie) {
  return metGebruiker_(gebruikerId, function (id) {
    var resultaat;
    var opgeslagen = wijzigProfielMetLock_(id, function (profiel) {
      resultaat = voegFavorieteLocatieToe(profiel, ruweLocatie);
      return resultaat.profiel;
    });
    if (!opgeslagen) return { fout: 'Kon niet opslaan (probeer het nog eens)' };
    resultaat.profiel = opgeslagen;
    return resultaat;
  });
}

function verwijderFavorieteLocatieServer(gebruikerId, locatieId) {
  return metGebruiker_(gebruikerId, function (id) {
    var opgeslagen = wijzigProfielMetLock_(id, function (profiel) {
      return verwijderFavorieteLocatie(profiel, locatieId);
    });
    if (!opgeslagen) return { fout: 'Kon niet opslaan (probeer het nog eens)' };
    return { profiel: opgeslagen };
  });
}

/**
 * Haalt het weeroordeel op voor één locatie (standaard 3 dagen, instelbaar via
 * profiel.dagenVooruit — zie ⚙️ Instellingen), met de drempelwaarden en databronnen-instellingen
 * van de gebruiker gecombineerd met de windrichting-configuratie van die specifieke favoriete
 * locatie.
 * @param {string} gebruikerId
 * @param {{lat: number, lon: number, windrichting?: Object}} locatie
 */
function getWeerOordeel(gebruikerId, locatie) {
  return metGebruiker_(gebruikerId, function (id) {
    if (!locatie || typeof locatie.lat !== 'number' || typeof locatie.lon !== 'number') {
      return { fout: 'Ongeldige locatie' };
    }
    if (locatie.lat < -90 || locatie.lat > 90 || locatie.lon < -180 || locatie.lon > 180) {
      return { fout: 'Ongeldige coördinaten' };
    }

    var profiel = laadProfiel_(id);
    return { dagen: bepaalDagOordelenVoorLocatie_(profiel, locatie, profiel.dagenVooruit) };
  });
}

/**
 * Compacte vergelijking van VANDAAG over alle favoriete locaties tegelijk — voor de "Vergelijk
 * locaties"-weergave in de webapp (welke spot is nu het beste, zonder elke dagkaart los te hoeven
 * uitklappen). Haalt bewust maar 1 dag per locatie op (i.p.v. de volle profiel.dagenVooruit) —
 * sneller, en "vandaag" is precies de vraag die deze weergave beantwoordt. `ruw` blijft de rauwe
 * vorm (windKnopen/windrichtingGraden/windvlaagKnopen) i.p.v. voorgeformatteerd, zodat de client
 * 'm rechtstreeks aan `bouwWindBadgeHtml` kan geven — exact dezelfde badge als de dagkaarten.
 */
function vergelijkFavorieteLocaties(gebruikerId) {
  return metGebruiker_(gebruikerId, function (id) {
    var profiel = laadProfiel_(id);
    return {
      locaties: (profiel.favorieteLocaties || []).map(function (locatie) {
        var vandaag;
        try {
          vandaag = bepaalDagOordelenVoorLocatie_(profiel, locatie, 1)[0];
        } catch (fout) {
          return { locatieId: locatie.id, naam: locatie.naam, fout: 'Kon weerdata niet ophalen' };
        }
        if (!vandaag) return { locatieId: locatie.id, naam: locatie.naam, fout: 'Geen weerdata beschikbaar' };
        var ruw = vandaag.dagScore.besteUur ? vandaag.dagScore.besteUur.ruw : null;
        return {
          locatieId: locatie.id,
          naam: locatie.naam,
          kleur: vandaag.dagScore.kleur,
          score: vandaag.dagScore.score,
          ruw: ruw
            ? { windKnopen: ruw.windKnopen, windrichtingGraden: ruw.windrichtingGraden, windvlaagKnopen: ruw.windvlaagKnopen }
            : null,
        };
      }),
    };
  });
}

/**
 * Bouwt een verkorte deel-link met een gloednieuw, willekeurig gebruikers-ID — voor de
 * "🔗 Deel deze app"-knop bij ⚙️ Instellingen (JavaScript.html). Server-side gegenereerd (i.p.v.
 * client-side) zodat het ID nooit per ongeluk het ID van de delende gebruiker zelf is. Zie
 * verkortUrl_ hierboven voor de TinyURL-verkorting (en README.md "Verkorte links" voor waarom
 * dit de geauthenticeerde API is, niet de anonieme).
 */
function bouwDeelLink() {
  var langeUrl = ScriptApp.getService().getUrl() + '?id=' + encodeURIComponent(Utilities.getUuid());
  return { url: verkortUrl_(langeUrl) };
}

/**
 * Het volledige dagoordeel (score, kleur, beste venster, samenvattingszin, gebruikte
 * wind-databronnen) voor één locatie, over `dagenVooruit` dagen — exact dezelfde berekening als de
 * webapp-kaarten. Uitgelicht uit getWeerOordeel zodat Meldingen.gs (Telegram-samenvatting)
 * letterlijk dezelfde informatie kan hergebruiken i.p.v. er een eigen, eenvoudigere versie van te
 * bouwen — zie Meldingen.gs voor de aanleiding (gebruikersverzoek: dezelfde balk + grafiek per dag).
 * @param {Object} profiel
 * @param {{lat: number, lon: number, windrichting?: Object}} locatie
 * @param {number} dagenVooruit
 * @returns {Array<Object>}
 */
function bepaalDagOordelenVoorLocatie_(profiel, locatie, dagenVooruit) {
  var windrichting = locatie.windrichting || { besteRanges: [], acceptabeleRanges: [] };
  var instellingen = Object.assign({}, profiel.drempelwaarden, { windrichting: windrichting });

  var dagvensterOpties = {
    dagvensterStartUur: profiel.dagvenster.startUur,
    dagvensterEindUur: profiel.dagvenster.eindUur,
    minimaleSessieUren: profiel.minimaleSessieUren,
    gewichten: profiel.scoreGewichten,
  };
  var weerData = haalWeerDataOp_(locatie.lat, locatie.lon, profiel.databronnen, dagenVooruit);
  var dagen = groepeerPerDag(weerData.urenData).slice(0, dagenVooruit);
  return dagen.map(function (dag) {
    var zon = zonInfoVoorDatum(weerData.zonInfo, dag.datum);
    var dagScore = berekenDagScore(dag.uren, instellingen, dagvensterOpties);
    return {
      datum: dag.datum,
      zonsopgang: zon.zonsopgang,
      zonsondergang: zon.zonsondergang,
      dagScore: dagScore,
      // Server-side samengesteld (src/logica/dagSamenvatting.js) i.p.v. in de front-end: het is
      // echte tekstlogica (trends, drempels) die zonder browser getest kan worden, en zo kan een
      // Telegram-melding er dezelfde zin uit halen.
      samenvatting: bouwDagSamenvatting(dagScore, dagvensterOpties),
      // Welke wind-databronnen deze dag daadwerkelijk hebben bijgedragen (zie
      // forecastSamenstellen.windBronnenVanDag) — transparantie bij een verder-vooruit-
      // ingestelde dagenVooruit: bronnen met een kortere eigen horizon (Windfinder, RWS) vallen
      // voor latere dagen vanzelf weg, dit toont concreet welke dat zijn i.p.v. het aan te nemen.
      windBronnen: windBronnenVanDag(dag.uren),
      // Meetpunten (stations) die het actuele uur voedden — zie haalWeerDataOp_. Alleen voor "vandaag"
      // relevant, maar goedkoop genoeg om bij elke dag mee te geven.
      meetpunten: weerData.meetpunten || [],
      // Nodig om per dag dezelfde grafiek te kunnen bouwen als de webapp (zie
      // Meldingen.gs -> bouwDagGrafiekBlob_): dezelfde instellingen als hierboven gebruikt.
      instellingen: instellingen,
    };
  });
}

/** Locatie zoeken op naam. Geen sessie-check nodig: publieke geocoding-data, geen user-koppeling. */
function zoekLocatie(zoekterm) {
  return zoekLocatie_(zoekterm);
}


