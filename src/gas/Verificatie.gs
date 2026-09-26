// Dagelijkse TOETSING van de weermodellen tegen echte KNMI-metingen (pure logica: modelVergelijking.js).
//
// Waarom: de voorspelling voor dag 3 t/m 7 hangt van één bron af (Open-Meteo), terwijl de modellen daar
// 4-8 knopen uit elkaar liggen. Zonder toetsing is niet te zeggen welk model klopt. Elke ochtend
// (06:00-12:00) leggen we daarom per spot vast wat 6 modellen (+ DWD) voor de komende 7 dagen
// voorspellen, en 's ochtends erna zetten we de gemeten wind van het dichtstbijzijnde KNMI-station ernaast.
// Na een paar weken zie je per voorspeldag-vooruit welk model gemiddeld het dichtst zit.
//
// Kosten: ≤12 Open-Meteo-aanvragen per dag (alle 6 modellen zitten in ÉÉN aanvraag) en ≤ ~12 KNMI-
// aanvragen per dag (één per station per afgelopen dag) — een fractie van het gebruik dat we al hebben.
// Geen enkele gebruikersgegevens: alleen spots (afgerond) -> station; ?actie=verificatie toont alleen
// stations en statistiek.

var VERIFICATIE_VAN_MINUUT = 6 * 60;
var VERIFICATIE_TOT_MINUUT = 12 * 60;
var VERIFICATIE_MAX_SPOTS = 12;
var VERIFICATIE_MAX_WAARNEMINGEN_PER_RUN = 4;
var VERIFICATIE_BEWAARDAGEN = 45;
var VERIFICATIE_BESTANDSNAAM = 'kiteweer-verificatie.json';

function verificatieLeegeData_() {
  return { snapshots: [], waarnemingen: [], stations: {} };
}

function laadVerificatieData_() {
  var id = PropertiesService.getScriptProperties().getProperty('VERIFICATIE_BESTANDS_ID');
  if (!id) return verificatieLeegeData_();
  // Bewust GEEN vangnet: lukt het lezen van een bestaand bestand niet, dan moet de ronde afbreken.
  // Anders zou de volgende schrijfactie een leeg bestand over de opgebouwde weken data heen zetten.
  var data = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
  data.snapshots = data.snapshots || [];
  data.waarnemingen = data.waarnemingen || [];
  data.stations = data.stations || {};
  return data;
}

/**
 * Bewaart in Drive (Script Properties zijn te klein: ~9KB). Bewust in de root van Drive en niet in de
 * profielenmap — laadAlleProfielen_ zou dit bestand anders als "profiel" proberen te lezen.
 */
function bewaarVerificatieData_(data) {
  var props = PropertiesService.getScriptProperties();
  var tekst = JSON.stringify(data);
  var id = props.getProperty('VERIFICATIE_BESTANDS_ID');
  if (id) {
    try {
      DriveApp.getFileById(id).setContent(tekst);
      return;
    } catch (e) {
      // Bestand weg of onbereikbaar: maak een nieuw.
    }
  }
  var bestand = DriveApp.createFile(VERIFICATIE_BESTANDSNAAM, tekst, MimeType.PLAIN_TEXT);
  props.setProperty('VERIFICATIE_BESTANDS_ID', bestand.getId());
}

/**
 * Unieke spots over alle profielen, populairste eerst, alleen in Nederland (KNMI-station binnen bereik
 * nodig). Geeft {sleutel, lat, lon, station, afstandKm} per spot.
 */
function verzamelVerificatieSpots_(profielen, stations) {
  var perSpot = {};
  profielen.forEach(function (profiel) {
    var gezien = {};
    (profiel.favorieteLocaties || []).forEach(function (locatie) {
      if (typeof locatie.lat !== 'number' || typeof locatie.lon !== 'number') return;
      if (!isInNederland_(locatie.lat, locatie.lon)) return;
      var sleutel = locatie.lat.toFixed(2) + '_' + locatie.lon.toFixed(2);
      if (gezien[sleutel]) return;
      gezien[sleutel] = true;
      var item = perSpot[sleutel] || (perSpot[sleutel] = { sleutel: sleutel, lat: locatie.lat, lon: locatie.lon, gebruikers: 0 });
      item.gebruikers++;
    });
  });
  var spots = [];
  Object.keys(perSpot).forEach(function (sleutel) {
    var spot = perSpot[sleutel];
    var gevonden = vindKnmiStation(spot.lat, spot.lon, stations);
    if (!gevonden) return;
    spot.station = gevonden.station;
    spot.afstandKm = Math.round(gevonden.afstandKm * 10) / 10;
    spots.push(spot);
  });
  spots.sort(function (a, b) { return b.gebruikers - a.gebruikers; });
  return spots.slice(0, VERIFICATIE_MAX_SPOTS);
}

function verificatieModellenTaak_(spot, index) {
  var url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wind_speed_10m,wind_gusts_10m&models=' + VERIFICATIE_MODELLEN.join(',') +
    '&wind_speed_unit=kn&forecast_days=' + VERIFICATIE_DAGEN + '&timezone=Europe/Amsterdam';
  return {
    sleutel: 'verifOm' + index,
    cacheKey: 'verif_om_' + spot.sleutel,
    cacheSeconden: 1800,
    backoffNaam: 'verificatie',
    request: { url: url, muteHttpExceptions: true },
    // Open-Meteo meldt fouten soms als JSON met {error: true, reason}; dat is dan geen bruikbare respons.
    verwerk: function (tekst) {
      var json = JSON.parse(tekst);
      if (json.error) throw new Error('Open-Meteo: ' + String(json.reason || '').slice(0, 100));
      return json;
    },
  };
}

function verificatieWaarnemingTaak_(station, datum, sleutel, index) {
  var venster = lokaleDagAlsUtcVenster(datum);
  return {
    sleutel: 'verifObs' + index,
    cacheKey: 'verif_obs_' + station.id + '_' + datum,
    cacheSeconden: 21600,
    backoffNaam: 'knmi',
    request: {
      url: KNMI_EDR_BASIS + '/locations/' + station.id + '?parameter-name=ff,gff&datetime=' + venster.van + '/' + venster.tot + '&f=CoverageJSON',
      headers: { Authorization: sleutel },
      muteHttpExceptions: true,
    },
    // De dag-statistiek meteen uitrekenen: een 200-respons zonder bruikbare meting wordt {w: null}
    // (= "geprobeerd, geen data", niet nog eens vragen); een mislukte aanvraag blijft null (= later opnieuw).
    verwerk: function (tekst) {
      var stat = waarnemingDagStatistiek(JSON.parse(tekst), datum);
      return stat ? { w: stat.w, g: stat.g, n: stat.n } : { w: null, g: null, n: 0 };
    },
  };
}

/**
 * Eén verificatie-ronde, aangeroepen door de meldingen-trigger (elke 15 minuten): maakt de snapshot van
 * vandaag voor spots die er nog geen hebben en haalt ontbrekende metingen van afgelopen dagen op.
 * Idempotent; een deel dat mislukt (429, netwerk) wordt bij de volgende ronde vanzelf herhaald.
 */
function voerVerificatieUit_(profielen, vandaag, minutenNu) {
  if (minutenNu < VERIFICATIE_VAN_MINUUT || minutenNu >= VERIFICATIE_TOT_MINUUT) return null;
  var knmiSleutel = getKnmiApiKey_();
  if (!knmiSleutel) return null; // zonder KNMI-metingen valt er niets te toetsen.

  var props0 = PropertiesService.getScriptProperties();
  try {
    // Al alles gedaan voor vandaag? Dan de Drive-lees en KNMI-cache-checks van de 15-minutentrigger sparen.
    if (JSON.parse(props0.getProperty('VERIFICATIE_STATUS') || '{}').klaarOp === vandaag) return null;
  } catch (e0) {}

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return null;
  var snapshotsKlaar = false;
  var metingenKlaar = false;
  var status = { tijd: Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm:ss') };
  try {
    var data = laadVerificatieData_();
    var gewijzigd = false;

    // 1. Snapshots van vandaag.
    if (!backoffActief_('knmi')) {
      var lijst = voerBatchOp_([knmiStationsTaak_(knmiSleutel)]);
      var stationLijst = lijst.knmiStations;
      if (stationLijst) {
        var spots = verzamelVerificatieSpots_(profielen, stationLijst);
        status.spots = spots.length;
        snapshotsKlaar = true;
        var heeftSnapshot = {};
        data.snapshots.forEach(function (s) { if (s.d === vandaag) heeftSnapshot[s.l] = true; });
        var teDoen = spots.filter(function (s) { return !heeftSnapshot[s.sleutel]; });

        if (teDoen.length > 0 && backoffActief_('verificatie')) snapshotsKlaar = false;
        if (teDoen.length > 0 && !backoffActief_('verificatie')) {
          var taken = [];
          teDoen.forEach(function (spot, i) {
            taken.push(verificatieModellenTaak_(spot, i));
            var dwd = brightSkyTaak_(spot.lat, spot.lon, VERIFICATIE_DAGEN);
            dwd.sleutel = 'verifDwd' + i;
            taken.push(dwd);
          });
          var res = voerBatchOp_(taken);
          var gelukt = 0;
          teDoen.forEach(function (spot, i) {
            var om = res['verifOm' + i];
            if (!om) return; // Open-Meteo weigerde: volgende ronde opnieuw (met backoff).
            var modellen = parseMultiModel(om);
            if (res['verifDwd' + i]) modellen.dwd_brightsky = parseBrightSkyAlsModel(res['verifDwd' + i]);
            var snap = bouwSnapshot({
              vandaag: vandaag,
              locatieSleutel: spot.sleutel,
              stationId: spot.station.id,
              stationNaam: spot.station.naam,
              modellen: modellen,
            });
            if (Object.keys(snap.m).length === 0) return;
            snap.a = spot.afstandKm;
            data.snapshots.push(snap);
            data.stations[spot.station.id] = {
              naam: spot.station.naam,
              soort: knmiStationSoortNl(spot.station.soort),
              lat: spot.station.lat,
              lon: spot.station.lon,
            };
            gelukt++;
          });
          status.snapshotsGemaakt = gelukt;
          status.snapshotsOntbraken = teDoen.length - gelukt;
          if (gelukt < teDoen.length) snapshotsKlaar = false;
          if (gelukt > 0) gewijzigd = true;
        }
      }
    }

    // 2. Metingen van afgelopen dagen bij de snapshots. Nieuwste dagen eerst; ≤ MAX per ronde.
    if (!backoffActief_('knmi')) {
      var heeftObs = {};
      data.waarnemingen.forEach(function (o) { heeftObs[o.s + '|' + o.d] = true; });
      var nodig = {};
      var namen = {};
      data.snapshots.forEach(function (snap) {
        for (var k = 0; k < VERIFICATIE_DAGEN; k++) {
          var dag = plusDagen(snap.d, k);
          if (dag >= vandaag) break;
          var sl = snap.s + '|' + dag;
          if (!heeftObs[sl]) { nodig[sl] = { id: snap.s, datum: dag }; }
        }
      });
      var nodigLijst = Object.keys(nodig).map(function (sl) { return nodig[sl]; });
      nodigLijst.sort(function (a, b) { return a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0; });
      var deze = nodigLijst.slice(0, VERIFICATIE_MAX_WAARNEMINGEN_PER_RUN);
      status.metingenNodig = nodigLijst.length;
      metingenKlaar = nodigLijst.length === 0;
      if (deze.length > 0) {
        var obsRes = voerBatchOp_(deze.map(function (n, i) {
          return verificatieWaarnemingTaak_({ id: n.id }, n.datum, knmiSleutel, i);
        }));
        var opgehaald = 0;
        deze.forEach(function (n, i) {
          var w = obsRes['verifObs' + i];
          if (!w) return; // mislukt (bv. 429): volgende ronde opnieuw.
          data.waarnemingen.push({ s: n.id, d: n.datum, w: w.w, g: w.g, n: w.n });
          opgehaald++;
        });
        status.metingenOpgehaald = opgehaald;
        metingenKlaar = opgehaald === nodigLijst.length;
        if (opgehaald > 0) gewijzigd = true;
      }
    }

    // 3. Opruimen (45 dagen snapshots; metingen zolang ze nog bij een snapshot kunnen horen).
    var grens = plusDagen(vandaag, -VERIFICATIE_BEWAARDAGEN);
    var grensObs = plusDagen(vandaag, -(VERIFICATIE_BEWAARDAGEN + VERIFICATIE_DAGEN));
    var vooropruim = data.snapshots.length + data.waarnemingen.length;
    data.snapshots = data.snapshots.filter(function (s) { return s.d >= grens; });
    data.waarnemingen = data.waarnemingen.filter(function (o) { return o.d >= grensObs; });
    if (data.snapshots.length + data.waarnemingen.length !== vooropruim) gewijzigd = true;

    if (gewijzigd) bewaarVerificatieData_(data);
    status.snapshotsTotaal = data.snapshots.length;
    status.waarnemingenTotaal = data.waarnemingen.length;
  } catch (e) {
    status.fout = String(e).slice(0, 200);
    snapshotsKlaar = false;
  } finally {
    lock.releaseLock();
  }
  if (snapshotsKlaar && metingenKlaar) status.klaarOp = vandaag;
  try { PropertiesService.getScriptProperties().setProperty('VERIFICATIE_STATUS', JSON.stringify(status)); } catch (e2) {}
  return status;
}

/**
 * Rapport voor ?actie=verificatie: welke KNMI-stations worden gebruikt (naam, soort, coördinaten, en of
 * die in Nederland liggen), hoeveel dagen aan snapshots/metingen er zijn, en per voorspeldag-vooruit en
 * model de gemiddelde afwijking (bias, in knopen; positief = model geeft te veel wind) en absolute fout.
 * Geen gebruikers- of profielgegevens, en geen spot-coördinaten.
 */
function bouwVerificatieRapport_() {
  var data;
  try { data = laadVerificatieData_(); } catch (e) { data = verificatieLeegeData_(); }
  var stationInfo = {};
  data.snapshots.forEach(function (s) {
    var item = stationInfo[s.s] || (stationInfo[s.s] = { spots: {}, dagen: {}, minKm: null, maxKm: null });
    item.spots[s.l] = true;
    item.dagen[s.d] = true;
    if (typeof s.a === 'number') {
      item.minKm = item.minKm === null ? s.a : Math.min(item.minKm, s.a);
      item.maxKm = item.maxKm === null ? s.a : Math.max(item.maxKm, s.a);
    }
  });
  var meetdagen = {};
  data.waarnemingen.forEach(function (o) { if (o.w != null) meetdagen[o.s] = (meetdagen[o.s] || 0) + 1; });

  var evaluatie = evalueerVerificatie(data);
  var stations = Object.keys(stationInfo).map(function (id) {
    var meta = data.stations[id] || {};
    var item = stationInfo[id];
    var dagen = Object.keys(item.dagen).sort();
    return {
      id: id,
      naam: meta.naam || null,
      soort: meta.soort || null,
      lat: meta.lat != null ? meta.lat : null,
      lon: meta.lon != null ? meta.lon : null,
      inNederland: meta.lat != null ? isNederlandsGebied(meta.lat, meta.lon) : null,
      aantalSpots: Object.keys(item.spots).length,
      afstandTotSpotKm: item.minKm === null ? null : { min: item.minKm, max: item.maxKm },
      snapshotDagen: dagen.length,
      eersteSnapshot: dagen[0] || null,
      laatsteSnapshot: dagen[dagen.length - 1] || null,
      meetdagen: meetdagen[id] || 0,
      vergelijking: evaluatie[id] ? evaluatie[id].rijen : [],
    };
  });
  stations.sort(function (a, b) { return String(a.naam).localeCompare(String(b.naam)); });

  var status = null;
  try { status = JSON.parse(PropertiesService.getScriptProperties().getProperty('VERIFICATIE_STATUS') || 'null'); } catch (e) {}
  return {
    uitleg:
      'Per model en voorspeldag-vooruit (0 = vandaag, 6 = over 6 dagen): gemiddelde afwijking (bias) en gemiddelde ' +
      'absolute fout (mae) van de voorspelde wind (gemiddelde 09-19 uur) en vlaag (hoogste 09-19 uur) t.o.v. de ' +
      'gemeten wind van het dichtstbijzijnde KNMI-station, in knopen. Bias > 0: model geeft te veel wind. ' +
      'Kleinste mae = beste model. n = aantal vergelijkingen; onder ~10 is het nog ruis.',
    status: status,
    aantalSnapshots: data.snapshots.length,
    aantalWaarnemingen: data.waarnemingen.length,
    perModel: aggregeerVerificatie(evaluatie),
    stations: stations,
  };
}
