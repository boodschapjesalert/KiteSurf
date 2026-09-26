// GAS-specifiek: haalt de rauwe databronnen op (UrlFetchApp) met caching (CacheService),
// en roept de pure parsers/samensteller (src/logica/) aan om er uurData van te maken.
// Zie databronnen-kiteweer-app.md voor de bronnen en caching-motivatie (gratis-quota's sparen).
//
// Efficiëntie: tot 8 bronnen per locatie is veel om ná elkaar op te halen (som van alle
// latenties). haalWeerDataOp_ verzamelt daarom eerst alle cache-missers en haalt die in één
// keer parallel op via UrlFetchApp.fetchAll() — de totale wachttijd wordt zo de LANGZAAMSTE
// enkele bron i.p.v. de SOM van alle bronnen.

var WEER_CACHE_SECONDEN = 600; // 10 minuten, zoals aanbevolen in databronnen-kiteweer-app.md

// Weerlive heeft een gratis quotum van 300 aanroepen/dag (zie weerlive.nl/delen.php). Sinds
// warmWeerCache_ (Meldingen.gs) elke kwartier-trigger-run élke favoriete locatie ververst, zou de
// standaard 10-minuten-cache (korter dan het kwartier-interval) bij elke opwarm-ronde alsnog een
// ECHTE aanroep zijn geweest — bij 2 locaties al ~192/dag, bij 4 locaties over de grens. Een langere
// cache specifiek voor deze bron (ruim boven het kwartier-triggerinterval) zorgt dat de meeste
// opwarm-rondes een cache-hit treffen i.p.v. een nieuwe aanroep — in de praktijk ongeveer de helft
// minder. Kost hooguit een iets ouder momentopname van déze ene bron; de andere bronnen (Open-Meteo,
// Buienradar, RWS) blijven op de gewone 10 minuten en het gemiddelde in bronnenMiddeling.js blijft
// dus ook met een wat ouder Weerlive-punt actueel genoeg.
var WEERLIVE_CACHE_SECONDEN = 1500; // 25 minuten.

// Open-Meteo's gratis tier staat maximaal 10.000 aanroepen per DAG toe (daarnaast 5.000/uur en
// 600/minuut), geteld PER IP-ADRES — en Apps Script-verzoeken komen vanaf gedeelde Google-adressen.
// Live vastgelegd (BRONFOUTEN): HTTP 429 "Daily API request limit exceeded", 11 van 11 aanvragen in
// één trigger-run mislukt, wat elke dagelijkse samenvatting/alert/webapp-aanroep zonder verse data
// liet zitten. Onze eigen bijdrage was onnodig groot: de 10-minuten-cache was korter dan het
// kwartier-triggerinterval, dus élke opwarm-ronde deed voor élke locatie een echte aanroep (~100x per
// dag per locatie), terwijl de onderliggende weermodellen hooguit ieder uur een nieuwe run hebben.
// Een uur is voor een voorspelling meer dan vers genoeg; golf-/zeewatertemperatuur verandert nog
// trager. Samen met opwarmen alléén overdag (zie WARM_START_MINUUT in Meldingen.gs) scheelt dit
// grofweg een factor 10 aan aanroepen.
var OPEN_METEO_CACHE_SECONDEN = 3600; // 60 minuten.
var OPEN_METEO_MARINE_CACHE_SECONDEN = 10800; // 3 uur.

// Levensduur van de "laatst bekende goede respons"-kopie van Open-Meteo (vangnet bij een mislukte
// verse aanvraag, zie voerBatchOp_). 6 uur is het maximum dat CacheService toestaat; omdat
// warmWeerCache_ elk kwartier ververst, is die kopie in de praktijk hooguit ~15-30 minuten oud.
var STALE_CACHE_SECONDEN = 21600;

// De cachesleutel van Open-Meteo/RWS bevat het aantal opgehaalde dagen. Twee accounts met dezelfde
// locatie maar een andere Voorspellingshorizon (bv. 5 en 6 dagen voor Rockanje Sportstrand) deden
// daardoor allebei hun EIGEN aanvraag voor exact dezelfde plek en deelden niets. Voor locaties die
// door meerdere profielen gebruikt worden, halen alle betrokken accounts nu dezelfde — de langste —
// horizon op (bewaarHorizonKaart_, elke trigger-run bijgewerkt) en snijdt bepaalDagOordelenVoorLocatie_
// er de eigen dagen uit. Bewust ALLEEN voor gedeelde locaties: een locatie van één account blijft op
// zijn eigen aantal dagen (geen onnodig grotere aanvraag), en er wordt niets voor locaties opgehaald
// die niemand gebruikt. Puur server-intern: het bevat alleen coördinaten en een aantal dagen — geen
// gebruikers-ID's — en niets ervan is voor een gebruiker zichtbaar.
var horizonKaartCache_ = null;

// Telt binnen één uitvoering hoeveel verse Open-Meteo-aanvragen lukten/mislukten (en hoe vaak de oude
// respons als vangnet moest inspringen); de trigger neemt dit op in zijn run-log (runInfo.openMeteo).
// Zo is te zien HOE VAAK de bron faalt, niet alleen dát hij één keer faalde.
// `details` bewaart per aanvraag "locatie_dagen:uitkomst" (bv. "51.87_4.04_6:429" of "51.87_4.07_5:ok"),
// in de volgorde waarin ze in de run gedaan werden — om te kunnen zien of falen samenhangt met de
// LOCATIE, met de VOLGORDE binnen de run (vroeg vs. laat, dus een oplopende teller), of met het moment.
var weerTelling_ = { ok: 0, fout: 0, oudeRespons: 0, reserve: 0, knmiOk: 0, knmiFout: 0, details: [] };

function horizonKaartSleutel_(lat, lon) {
  return lat.toFixed(2) + '_' + lon.toFixed(2);
}

function leesHorizonKaart_() {
  if (horizonKaartCache_ === null) {
    try {
      horizonKaartCache_ = JSON.parse(PropertiesService.getScriptProperties().getProperty('HORIZON_PER_LOCATIE') || '{}');
    } catch (e) {
      horizonKaartCache_ = {};
    }
  }
  return horizonKaartCache_;
}

function horizonVoorLocatie_(lat, lon, eigenDagen) {
  var gedeeld = leesHorizonKaart_()[horizonKaartSleutel_(lat, lon)] || 0;
  return Math.max(eigenDagen, gedeeld);
}

/**
 * Bepaalt per locatie die door MEER DAN ÉÉN profiel gebruikt wordt de langste horizon en bewaart die
 * (Script Properties, ~9KB-limiet: bij te veel gedeelde locaties valt dit gewoon terug op "geen
 * delen", wat alleen een paar extra aanvragen kost). Aangeroepen aan het begin van elke trigger-run.
 */
function bewaarHorizonKaart_(profielen) {
  var perLocatie = {};
  profielen.forEach(function (profiel) {
    var dagen = profiel.dagenVooruit || 3;
    var gezienDitProfiel = {};
    (profiel.favorieteLocaties || []).forEach(function (locatie) {
      var sleutel = horizonKaartSleutel_(locatie.lat, locatie.lon);
      if (gezienDitProfiel[sleutel]) return;
      gezienDitProfiel[sleutel] = true;
      var item = perLocatie[sleutel] || (perLocatie[sleutel] = { profielen: 0, dagen: 0 });
      item.profielen++;
      item.dagen = Math.max(item.dagen, dagen);
    });
  });
  var kaart = {};
  Object.keys(perLocatie).forEach(function (sleutel) {
    if (perLocatie[sleutel].profielen > 1) kaart[sleutel] = perLocatie[sleutel].dagen;
  });
  horizonKaartCache_ = kaart;
  try {
    var tekst = JSON.stringify(kaart);
    if (tekst.length < 8000) PropertiesService.getScriptProperties().setProperty('HORIZON_PER_LOCATIE', tekst);
  } catch (e) {
    // Best-effort: zonder kaart gebruikt elk profiel gewoon zijn eigen horizon.
  }
}

function cacheSleutel_(prefix, lat, lon) {
  return prefix + '_' + lat.toFixed(2) + '_' + lon.toFixed(2);
}

/** Nederland bij benadering (bounding box), voor de NL-only bronnen Buienradar/Weerlive/RWS. */
function isInNederland_(lat, lon) {
  return lat >= 50.5 && lat <= 53.7 && lon >= 3.2 && lon <= 7.3;
}

/**
 * Voert een lijst databron-"taken" uit: cache-hits direct teruggeven, cache-missers in één
 * parallelle batch ophalen (UrlFetchApp.fetchAll), daarna elk resultaat verwerken en cachen.
 * @param {Array<{sleutel: string, cacheKey: string, request: Object, verwerk?: (tekst:string)=>*}>} taken
 * @returns {Object} sleutel -> verwerkte waarde (of null bij fout/ontbrekend)
 */
function voerBatchOp_(taken) {
  var cache = CacheService.getScriptCache();
  var resultaten = {};
  var teFetchen = [];

  taken.forEach(function (taak) {
    var cached = cache.get(taak.cacheKey);
    if (cached) {
      try {
        resultaten[taak.sleutel] = JSON.parse(cached);
        return;
      } catch (e) {
        // corrupte cache-waarde: gewoon opnieuw ophalen.
      }
    }
    teFetchen.push(taak);
  });

  if (teFetchen.length > 0) {
    var responses;
    var fetchAllFout = null;
    try {
      responses = UrlFetchApp.fetchAll(teFetchen.map(function (t) { return t.request; }));
    } catch (e) {
      fetchAllFout = 'fetchAll gooide: ' + String(e).slice(0, 200);
      responses = teFetchen.map(function () { return null; });
    }
    teFetchen.forEach(function (taak, i) {
      var response = responses[i];
      var waarde = null;
      var foutInfo = null;
      try {
        if (response && response.getResponseCode() === 200) {
          var verwerk = taak.verwerk || JSON.parse;
          waarde = verwerk(response.getContentText());
        } else {
          foutInfo = response
            ? 'HTTP ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 150)
            : fetchAllFout || 'geen respons';
        }
      } catch (e) {
        waarde = null; // Onverwachte respons-vorm: bron overslaan i.p.v. de hele batch te breken.
        foutInfo = 'verwerking mislukt: ' + String(e).slice(0, 150);
      }

      // Vangnet voor de bronnen waar de hele app van afhangt (Open-Meteo): faalt de verse aanvraag,
      // val dan terug op de laatst bekende GOEDE respons (max 6 uur oud, het maximum van CacheService)
      // i.p.v. niets. Een voorspelling van een half uur of een paar uur oud is voor een dagoverzicht
      // ruimschoots bruikbaar — een lege lijst is dat niet (gebruikersrapport: dagelijkse samenvatting
      // kwam soms met "0 van de X dagen" binnen, ook na herkansingen).
      var gebruiktStale = false;
      if (waarde == null && taak.staleSeconden) {
        var staleTekst = cache.get('stale_' + taak.cacheKey);
        if (staleTekst) {
          try {
            waarde = JSON.parse(staleTekst);
            gebruiktStale = true;
          } catch (e) {
            waarde = null;
          }
        }
      }
      // Backoff (KNMI fair use: "wait before you retry, and increase the waiting time on every
      // following 429"): een 429 verlengt de pauze voor deze bron, een geslaagde aanvraag zet 'm terug.
      if (taak.backoffNaam) {
        if (foutInfo && String(foutInfo).indexOf('HTTP 429') === 0) verhoogBackoff_(taak.backoffNaam);
        else if (!foutInfo) resetBackoff_(taak.backoffNaam);
      }
      if (taak.sleutel === 'knmi') {
        if (foutInfo) weerTelling_.knmiFout++; else weerTelling_.knmiOk++;
      }
      if (taak.sleutel === 'openMeteo') {
        if (foutInfo) weerTelling_.fout++; else weerTelling_.ok++;
        if (weerTelling_.details.length < 20) {
          weerTelling_.details.push(
            taak.cacheKey.replace('om_forecast_', '') + ':' + (foutInfo ? (response ? response.getResponseCode() : 'geen') : 'ok')
          );
        }
        if (gebruiktStale) weerTelling_.oudeRespons++;
      }
      if (foutInfo) legBronFoutVast_(taak.sleutel, foutInfo, gebruiktStale);

      resultaten[taak.sleutel] = waarde;
      if (gebruiktStale) resultaten[taak.sleutel + '_stale'] = true;
      if (waarde != null && !gebruiktStale) {
        try {
          var tekst = JSON.stringify(waarde);
          cache.put(taak.cacheKey, tekst, taak.cacheSeconden || WEER_CACHE_SECONDEN);
          if (taak.staleSeconden) cache.put('stale_' + taak.cacheKey, tekst, taak.staleSeconden);
        } catch (e) {
          // Waarde te groot (>100KB) of andere cache-fout: caching is best-effort.
        }
      }
    });
  }

  return resultaten;
}

/**
 * Bewaart de laatste mislukte bronaanvragen (bron, statuscode + begin van de respons, en of het
 * vangnet met de oude respons is ingesprongen) in Script Properties, opvraagbaar via
 * ?actie=meldingen-status. Zonder dit was een mislukte aanvraag onzichtbaar: voerBatchOp_ maakt er
 * bewust een `null` van (één falende bron mag de rest niet breken) en daarmee bleef de échte reden
 * — een rate limit (HTTP 429), een 5xx, een time-out — tot nu toe volledig onbekend.
 */
function legBronFoutVast_(sleutel, foutInfo, gebruiktStale) {
  // Marine-data bestaat niet voor binnenlandse locaties (een verwachte, dagelijkse "fout") en zou de
  // korte lijst hieronder volstoppen met ruis.
  if (sleutel === 'openMeteoMarine') return;
  try {
    var props = PropertiesService.getScriptProperties();
    var lijst = JSON.parse(props.getProperty('BRONFOUTEN') || '[]');
    lijst.push({
      tijd: Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm:ss'),
      bron: sleutel,
      fout: foutInfo,
      oudeResponsGebruikt: !!gebruiktStale,
    });
    props.setProperty('BRONFOUTEN', JSON.stringify(lijst.slice(-20))); // Property-limiet is ~9KB per waarde.
  } catch (e) {
    // Vastleggen is best-effort en mag de weerdata-flow nooit breken.
  }
}

// Open-Meteo staat forecast_days tot 16 toe; onze eigen instelling (profielValidatie.js:
// MAXIMUM_DAGEN_VOORUIT) is al lager geklemd, maar clamp hier defensief nogmaals mocht die ooit
// uit de pas lopen.
var OPEN_METEO_MAX_FORECAST_DAGEN = 16;

function openMeteoForecastTaak_(lat, lon, dagenVooruit) {
  var dagen = Math.min(OPEN_METEO_MAX_FORECAST_DAGEN, dagenVooruit || 3);
  var url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation_probability,precipitation,temperature_2m,visibility,cloud_cover' +
    '&daily=sunrise,sunset' +
    '&wind_speed_unit=kn&forecast_days=' + dagen + '&timezone=auto';
  return { sleutel: 'openMeteo', cacheKey: cacheSleutel_('om_forecast', lat, lon) + '_' + dagen, cacheSeconden: OPEN_METEO_CACHE_SECONDEN, staleSeconden: STALE_CACHE_SECONDEN, request: { url: url, muteHttpExceptions: true } };
}

// De reservebron (Bright Sky/DWD) is een Europees model met stations rond Nederland; en de
// tijdstippen worden als Europe/Amsterdam opgevraagd. Buiten dit gebied geen reserve i.p.v. een
// voorspelling in de verkeerde tijdzone.
// Oplopende pauze na een HTTP 429 (15, 30, 60, 120 min; teller vervalt na 6 uur rust). CacheService is
// gedeeld over alle uitvoeringen, dus ook de webapp en de trigger houden zich aan dezelfde pauze.
function backoffActief_(naam) {
  return !!CacheService.getScriptCache().get('backoff_' + naam);
}

function verhoogBackoff_(naam) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('backoffn_' + naam) || 0) + 1;
  var seconden = Math.min(7200, 900 * Math.pow(2, n - 1));
  cache.put('backoff_' + naam, '1', seconden);
  cache.put('backoffn_' + naam, String(n), 21600);
}

function resetBackoff_(naam) {
  CacheService.getScriptCache().remove('backoffn_' + naam);
}

var KNMI_EDR_BASIS = 'https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations';

/** Stationlijst van KNMI (77 stations). Verandert nauwelijks: 6 uur cache (CacheService-maximum). */
function knmiStationsTaak_(sleutel) {
  return {
    sleutel: 'knmiStations',
    cacheKey: 'knmi_stations_v2', // v2: bevat nu ook de stationssoort.
    cacheSeconden: 21600,
    backoffNaam: 'knmi',
    request: { url: KNMI_EDR_BASIS + '/locations', headers: { Authorization: sleutel }, muteHttpExceptions: true },
    verwerk: function (tekst) { return compacteerKnmiStations(JSON.parse(tekst)); },
  };
}

/**
 * De laatste ~90 minuten metingen van één station (wind, vlaag, richting, temperatuur, zicht).
 * KNMI publiceert elke 10 minuten; 10 minuten cache = nooit vaker vragen dan de bron ververst (fair
 * use). Gedeeld over alle accounts en locaties die dit station als dichtstbijzijnde hebben.
 */
function knmiWaarnemingTaak_(station, sleutel) {
  var nu = new Date();
  var van = Utilities.formatDate(new Date(nu.getTime() - 90 * 60 * 1000), 'UTC', "yyyy-MM-dd'T'HH:mm:00'Z'");
  var tot = Utilities.formatDate(nu, 'UTC', "yyyy-MM-dd'T'HH:mm:00'Z'");
  return {
    sleutel: 'knmi',
    cacheKey: 'knmi_obs_' + station.id,
    cacheSeconden: 600,
    backoffNaam: 'knmi',
    request: {
      url: KNMI_EDR_BASIS + '/locations/' + station.id +
        '?parameter-name=ff,gff,dd,ta,vv&datetime=' + van + '/' + tot + '&f=CoverageJSON',
      headers: { Authorization: sleutel },
      muteHttpExceptions: true,
    },
  };
}

function isInReserveBereik_(lat, lon) {
  return lat >= 49.5 && lat <= 55 && lon >= 2.5 && lon <= 9;
}

/**
 * Reserve voor Open-Meteo (zie parseBrightSkyForecast in bronParsers.js): alleen opgevraagd als
 * Open-Meteo weigert. `verwerk` verkleint de respons tot de velden die de parser gebruikt — de
 * volledige respons (~350 bytes per uur, 10 dagen) zou de 100KB-limiet van CacheService benaderen.
 */
function brightSkyTaak_(lat, lon, dagen) {
  var nu = new Date();
  var vandaag = Utilities.formatDate(nu, 'Europe/Amsterdam', 'yyyy-MM-dd');
  var eind = Utilities.formatDate(new Date(nu.getTime() + dagen * 24 * 60 * 60 * 1000), 'Europe/Amsterdam', 'yyyy-MM-dd');
  var url =
    'https://api.brightsky.dev/weather?lat=' + lat + '&lon=' + lon +
    '&date=' + vandaag + '&last_date=' + eind + '&tz=Europe/Amsterdam';
  return {
    sleutel: 'brightSky',
    cacheKey: cacheSleutel_('bs_forecast', lat, lon) + '_' + dagen,
    cacheSeconden: 1800,
    staleSeconden: STALE_CACHE_SECONDEN,
    request: { url: url, muteHttpExceptions: true },
    verwerk: function (tekst) {
      var uren = (JSON.parse(tekst).weather || []).map(function (u) {
        return {
          timestamp: u.timestamp,
          precipitation: u.precipitation,
          temperature: u.temperature,
          wind_direction: u.wind_direction,
          wind_speed: u.wind_speed,
          cloud_cover: u.cloud_cover,
          visibility: u.visibility,
          wind_gust_speed: u.wind_gust_speed,
          condition: u.condition,
          precipitation_probability: u.precipitation_probability,
        };
      });
      return { weather: uren };
    },
  };
}

function openMeteoMarineTaak_(lat, lon, dagenVooruit) {
  var dagen = Math.min(OPEN_METEO_MAX_FORECAST_DAGEN, dagenVooruit || 3);
  var url =
    'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
    '&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature&forecast_days=' + dagen + '&timezone=auto';
  return { sleutel: 'openMeteoMarine', cacheKey: cacheSleutel_('om_marine', lat, lon) + '_' + dagen, cacheSeconden: OPEN_METEO_MARINE_CACHE_SECONDEN, staleSeconden: STALE_CACHE_SECONDEN, request: { url: url, muteHttpExceptions: true } };
}

function buienradarTaak_() {
  return {
    sleutel: 'buienradar',
    cacheKey: 'buienradar_feed',
    request: { url: 'https://data.buienradar.nl/2.0/feed/json', muteHttpExceptions: true },
  };
}

function weerliveTaak_(lat, lon, apiKey) {
  var url = 'https://weerlive.nl/api/json-data-10min.php?key=' + encodeURIComponent(apiKey) + '&locatie=' + lat + ',' + lon;
  return {
    sleutel: 'weerlive',
    cacheKey: cacheSleutel_('weerlive', lat, lon),
    cacheSeconden: WEERLIVE_CACHE_SECONDEN,
    request: { url: url, muteHttpExceptions: true },
  };
}

/**
 * RWS-meetpunten die naast getij (WATHTE) ook wind (WINDSHD/WINDRTG) meten, EN die bij
 * verificatie (30 aug 2026, via het METADATASERVICES/OphalenCatalogus-endpoint gevolgd door een
 * live OphalenWaarnemingen-check per kandidaat) daadwerkelijk actuele data teruggaven — RWS'
 * eigen catalogus vermeldt tientallen meetpunten die in theorie deze grootheden meten, maar veel
 * daarvan gaven een lege HTTP 204-respons terug (zoals destijds ook al bleek bij
 * "rockanje.2eslag"). Alleen de geverifieerd-actieve punten staan hieronder; dichtstbijzijnde()
 * (uit eenheden.js) kiest per opgevraagde locatie het dichtstbijzijnde. Omdat RWS' actieve
 * stations wijzigen, kan dit lijstje na verloop van tijd verouderen — check dan opnieuw via
 * dezelfde catalogus (zie README.md "Aannames" voor de aanpak).
 */
var RWS_STATIONS = [
  { code: 'hoekvanholland', naam: 'Hoek van Holland', lat: 51.976899, lon: 4.119827 },
  { code: 'brouwersdam.brouwershavensegat.2', naam: 'Brouwersdam', lat: 51.766527, lon: 3.621747 },
  { code: 'cadzand.1', naam: 'Cadzand', lat: 51.390145, lon: 3.368697 },
  { code: 'oosterschelde.4', naam: 'Oosterschelde', lat: 51.65514, lon: 3.69342 },
  { code: 'stavenisse', naam: 'Stavenisse', lat: 51.598, lon: 4.004 },
  { code: 'marollegat', naam: 'Marollegat (Westerschelde)', lat: 51.479747, lon: 4.191958 },
  { code: 'hansweert', naam: 'Hansweert (Westerschelde)', lat: 51.44567, lon: 3.99744 },
  { code: 'vlaktevanderaan', naam: 'Vlakte van de Raan', lat: 51.503721, lon: 3.242164 },
  { code: 'europlatform', naam: 'Europlatform', lat: 51.99781, lon: 3.275071 },
  { code: 'k13a', naam: 'K13a platform', lat: 53.217016, lon: 3.218922 },
];
// De twee offshore platforms (Europlatform, K13a) liggen tientallen km uit de kust — een grotere
// marge dan Windfinders 5km (zie hieronder), omdat RWS-meetpunten sparser staan dan Windfinder-
// spots en de dichtstbijzijnde ondanks de afstand vaak nog steeds representatiever is dan niets.
var RWS_MAX_AFSTAND_KM = 30;

function vindDichtstbijzijndRwsStation_(lat, lon) {
  var dichtstbij = dichtstbijzijnde(lat, lon, RWS_STATIONS);
  if (!dichtstbij) return null;
  return afstandKm(lat, lon, dichtstbij.lat, dichtstbij.lon) <= RWS_MAX_AFSTAND_KM ? dichtstbij : null;
}

function rwsWaarnemingenTaak_(sleutel, grootheidCode, compartimentCode, locatieCode, dagenVooruit) {
  var dagen = dagenVooruit || 3;
  var nu = new Date();
  // Begin bij het begin van vandaag (00:00), niet bij "nu": RWS geeft voor ProcesType
  // "verwachting" gewoon ook de al gepasseerde uren van vandaag terug zodra je erom vraagt (getest
  // tegen de live API — zonder deze aanpassing ontbrak getij/wind voor elk uur vóór het moment van
  // opvragen, ook al had RWS de data wél beschikbaar). Zie README.md "Aannames" voor de RWS-opzet.
  var begin = new Date(Utilities.formatDate(nu, 'Europe/Amsterdam', 'yyyy-MM-dd') + 'T00:00:00');
  var eind = new Date(nu.getTime() + dagen * 24 * 60 * 60 * 1000);
  var aquoMetadata = { Grootheid: { Code: grootheidCode } };
  if (compartimentCode) aquoMetadata.Compartiment = { Code: compartimentCode };
  var body = {
    Locatie: { Code: locatieCode },
    AquoPlusWaarnemingMetadata: { AquoMetadata: aquoMetadata },
    Periode: {
      Begindatumtijd: Utilities.formatDate(begin, 'Europe/Amsterdam', "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"),
      Einddatumtijd: Utilities.formatDate(eind, 'Europe/Amsterdam', "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"),
    },
  };
  return {
    sleutel: sleutel,
    cacheKey: 'rws_' + grootheidCode + '_' + locatieCode + '_' + dagen,
    request: {
      url: 'https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen',
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    },
  };
}

/**
 * Windfinder.com — geen publieke API; de forecast-pagina bevat de volledige meerdaagse
 * voorspelling (wind, golven, getij) als ingebakken JSON (zie parseWindfinderForecast in
 * src/logica/bronParsers.js). Alleen bekende, met de hand gekoppelde spots (geen generieke
 * lat/lon-naar-Windfinder-spot-lookup) — zie README.md "Aannames".
 */
var WINDFINDER_SPOTS = [
  { naam: 'Rockanje', lat: 51.8722925148425, lon: 4.044898266162127, slug: 'rockanje' },
  { naam: 'Maasvlakte', lat: 51.919079, lon: 3.988189, slug: 'maasvlakte' },
];
var WINDFINDER_MAX_AFSTAND_KM = 5;

function vindWindfinderSlug_(lat, lon) {
  var dichtstbij = dichtstbijzijnde(lat, lon, WINDFINDER_SPOTS);
  if (!dichtstbij) return null;
  return afstandKm(lat, lon, dichtstbij.lat, dichtstbij.lon) <= WINDFINDER_MAX_AFSTAND_KM ? dichtstbij.slug : null;
}

/** Verwerkt (parseert) direct i.p.v. de rauwe ~280KB pagina te cachen — dat past niet binnen de 100KB-cachelimiet. */
function windfinderTaak_(slug) {
  return {
    sleutel: 'windfinder',
    cacheKey: 'windfinder_' + slug,
    request: {
      url: 'https://www.windfinder.com/forecast/' + slug,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KiteWeerApp/1.0)' },
    },
    verwerk: parseWindfinderForecast,
  };
}

/**
 * Haalt en combineert alle databronnen voor één locatie tot een uurData-array (per tijdstip),
 * klaar voor scoreBerekening.berekenDagScore. Ontbrekende/onbereikbare bronnen worden overgeslagen
 * (bronnenMiddeling.js negeert ontbrekende bronnen, telt ze niet als 0).
 * @param {Object} [databronnen] - welke bronnen te gebruiken (zie profielValidatie.standaardDatabronnen()
 *   voor de vorm); ontbrekende sleutels tellen als "aan".
 * @param {number} [dagenVooruit] - hoeveel dagen vooruit opgehaald worden (standaard 3, zie
 *   profielValidatie.valideerDagenVooruit). Alleen Open-Meteo en RWS ondersteunen een instelbare
 *   horizon; Buienradar/Weerlive zijn sowieso alleen een "nu"-snapshot en Windfinder levert altijd
 *   zijn eigen (vaste, kortere) horizon — die bronnen vallen simpelweg vanzelf weg voor latere
 *   dagen via bronnenMiddeling.js, zie README.md "Aannames".
 * @returns {{urenData: Array, zonInfo: {datums: string[], zonsopgang: string[], zonsondergang: string[]}}}
 */
function haalWeerDataOp_(lat, lon, databronnen, dagenVooruit) {
  var d = databronnen || {};
  // Eigen horizon, of de langste van alle accounts die deze locatie delen (zie horizonVoorLocatie_).
  var dagen = horizonVoorLocatie_(lat, lon, dagenVooruit || 3);
  var inNL = isInNederland_(lat, lon);
  var weerliveKey = getWeerliveApiKey_();
  var windfinderSlug = d.windfinder !== false ? vindWindfinderSlug_(lat, lon) : null;
  var rwsStation = d.rws !== false ? vindDichtstbijzijndRwsStation_(lat, lon) : null;

  var taken = [];
  if (d.openMeteo !== false) {
    taken.push(openMeteoForecastTaak_(lat, lon, dagen));
    taken.push(openMeteoMarineTaak_(lat, lon, dagen));
  }
  if (inNL && d.buienradar !== false) taken.push(buienradarTaak_());
  if (inNL && d.weerlive !== false && weerliveKey) taken.push(weerliveTaak_(lat, lon, weerliveKey));
  if (rwsStation) {
    taken.push(rwsWaarnemingenTaak_('rwsGetij', 'WATHTE', 'OW', rwsStation.code, dagen));
    taken.push(rwsWaarnemingenTaak_('rwsWindshd', 'WINDSHD', null, rwsStation.code, dagen));
    taken.push(rwsWaarnemingenTaak_('rwsWindrtg', 'WINDRTG', null, rwsStation.code, dagen));
  }
  if (windfinderSlug) taken.push(windfinderTaak_(windfinderSlug));

  // KNMI-meting van het dichtstbijzijnde station (alleen NL, alleen met sleutel, niet tijdens een
  // backoff-pauze na een 429). Eerst de (6 uur gecachete) stationlijst, dan één gecachete
  // waarneming per station — meerdere spots/accounts bij hetzelfde station delen die aanvraag.
  var knmiStation = null;
  var knmiSleutel = getKnmiApiKey_();
  if (knmiSleutel && inNL && d.knmi !== false && !backoffActief_('knmi')) {
    var knmiLijst = voerBatchOp_([knmiStationsTaak_(knmiSleutel)]);
    var knmiGevonden = knmiLijst.knmiStations ? vindKnmiStation(lat, lon, knmiLijst.knmiStations) : null;
    if (knmiGevonden) {
      knmiStation = knmiGevonden;
      taken.push(knmiWaarnemingTaak_(knmiGevonden.station, knmiSleutel));
    }
  }

  var r = voerBatchOp_(taken);

  // RESERVE: faalde de verse Open-Meteo-aanvraag (HTTP 429 of anders) en is er hooguit een oude kopie,
  // vraag dan Bright Sky (DWD) — een verse voorspelling van een andere bron is beter dan een van
  // uren oud. Alleen als Open-Meteo aanstaat (een gebruiker die 'm uitzet wil 'm niet vervangen) en
  // binnen het bereik van de reserve. Lukt ook dat niet, dan blijft de oude Open-Meteo-kopie staan.
  var openMeteo = null;
  if (d.openMeteo !== false && (r.openMeteo == null || r.openMeteo_stale) && isInReserveBereik_(lat, lon)) {
    var reserve = voerBatchOp_([brightSkyTaak_(lat, lon, dagen)]);
    if (reserve.brightSky) {
      openMeteo = parseBrightSkyForecast(reserve.brightSky, lat, lon);
      weerTelling_.reserve++;
    }
  }
  if (!openMeteo) openMeteo = parseOpenMeteoForecast(r.openMeteo || {});
  var openMeteoMarine = r.openMeteoMarine ? parseOpenMeteoMarine(r.openMeteoMarine) : null;
  var buienradar = r.buienradar ? parseBuienradarFeed(r.buienradar, lat, lon) : null;
  var weerlive = r.weerlive ? parseWeerlive(r.weerlive) : null;
  var rwsGetij = r.rwsGetij ? parseRwsGetij(r.rwsGetij) : null;
  var rwsWindVerwachting = r.rwsWindshd ? parseRwsWindVerwachting(r.rwsWindshd, r.rwsWindrtg || {}) : null;
  var rwsWindMeting = r.rwsWindshd ? parseRwsWindMeting(r.rwsWindshd, r.rwsWindrtg || {}) : null;
  // r.windfinder is door windfinderTaak_'s `verwerk` al het geparseerde object, geen JSON.parse meer nodig.
  var windfinder = r.windfinder || null;
  var knmi = r.knmi && knmiStation ? parseKnmiWaarnemingen(r.knmi, knmiStation.station, knmiStation.afstandKm) : null;

  var urenData = samenstellenUrenData({
    openMeteo: openMeteo,
    openMeteoMarine: openMeteoMarine,
    buienradar: buienradar,
    weerlive: weerlive,
    windfinder: windfinder,
    knmi: knmi,
    rwsGetij: rwsGetij,
    rwsWindVerwachting: rwsWindVerwachting,
    rwsWindMeting: rwsWindMeting,
    huidigTijdstipIso: new Date().toISOString(),
  });

  // Welke MEETPUNTEN daadwerkelijk zijn gebruikt voor het actuele uur (transparantie: waar komen de
  // metingen vandaan, hoe ver van de spot, wat voor station). Alle bronnen kiezen het dichtstbijzijnde
  // station; alleen Nederlandse stations komen in aanmerking (KNMI: zie isNederlandsGebied).
  var meetpunten = [];
  if (knmi) meetpunten.push({ bron: 'KNMI', naam: knmi.stationnaam, soort: knmi.stationsoort, afstandKm: knmi.afstandKm });
  if (buienradar) meetpunten.push({ bron: 'Buienradar', naam: buienradar.stationnaam, afstandKm: buienradar.afstandKm });
  if (rwsWindMeting && rwsStation) {
    meetpunten.push({
      bron: 'RWS',
      naam: rwsStation.naam,
      afstandKm: Math.round(afstandKm(lat, lon, rwsStation.lat, rwsStation.lon) * 10) / 10,
    });
  }
  if (weerlive && weerlive.stationnaam) meetpunten.push({ bron: 'Weerlive', naam: weerlive.stationnaam, afstandKm: null });

  return { urenData: urenData, zonInfo: openMeteo.dagInfo, meetpunten: meetpunten };
}
