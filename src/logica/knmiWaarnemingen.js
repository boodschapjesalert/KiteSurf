// Pure logica voor de KNMI-waarnemingen (EDR-API, collectie "10-minute-in-situ-meteorological-
// observations"): het dichtstbijzijnde officiële meetstation kiezen en de CoverageJSON-respons
// omzetten naar hetzelfde "nu"-snapshot-formaat als parseBuienradarFeed (zie bronParsers.js). Geen
// UrlFetchApp hier — het ophalen (met sleutel, cache en backoff) staat in src/gas/WeerData.gs.
//
// Dit zijn METINGEN, geen voorspelling: ze verbeteren het actuele uur, ze bouwen zelf geen tijdlijn.

const { msNaarKnopen, afstandKm } = require('./eenheden');

// Verder dan dit is een station niet meer representatief voor de spot (zelfde grens als bij RWS).
const KNMI_MAX_AFSTAND_KM = 30;
// Een meting ouder dan dit is geen "nu" meer (KNMI publiceert elke 10 minuten met ~10 min vertraging).
const KNMI_MAX_LEEFTIJD_MS = 60 * 60 * 1000;

/** Verkleint de EDR-stationlijst (GeoJSON) tot wat we nodig hebben: id, naam en coördinaten. */
function compacteerKnmiStations(geojson) {
  return ((geojson && geojson.features) || [])
    .filter((f) => f && f.id && f.geometry && Array.isArray(f.geometry.coordinates))
    .map((f) => ({
      id: f.id,
      naam: (f.properties && f.properties.name) || f.id,
      soort: (f.properties && f.properties.type) || null,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
}

/** KNMI-stationstype (Engels, uit de EDR-lijst) -> korte Nederlandse omschrijving voor de app. */
function knmiStationSoortNl(soort) {
  const s = String(soort || '').toLowerCase();
  if (s.indexOf('platform') !== -1) return 'platform op zee';
  if (s.indexOf('aerodrome') !== -1 || s.indexOf('aws') !== -1) return 'vliegveld';
  if (s.indexOf('wind') !== -1) return 'windstation';
  return 'weerstation';
}

/**
 * Ligt dit punt in Nederland of het Nederlandse deel van de Noordzee? (grofweg; sluit o.a. de
 * Caribische KNMI-stations Saba, Sint Eustatius en Bonaire uit, die in de stationlijst staan.)
 */
function isNederlandsGebied(lat, lon) {
  return lat >= 50.7 && lat <= 55.8 && lon >= 2.5 && lon <= 7.3;
}

/**
 * Dichtstbijzijnde station binnen maxKm, of null.
 * @returns {{station: {id: string, naam: string, lat: number, lon: number}, afstandKm: number}|null}
 */
function vindKnmiStation(lat, lon, stations, maxKm = KNMI_MAX_AFSTAND_KM) {
  let beste = null;
  (stations || []).forEach((s) => {
    if (!isNederlandsGebied(s.lat, s.lon)) return; // o.a. de Caribische BES-stations nooit als "dichtstbijzijnde".
    const afstand = afstandKm(lat, lon, s.lat, s.lon);
    if (!beste || afstand < beste.afstandKm) beste = { station: s, afstandKm: afstand };
  });
  return beste && beste.afstandKm <= maxKm ? beste : null;
}

function laatsteWaarde(reeks, uptoIndex) {
  for (let i = Math.min(uptoIndex, reeks.length - 1); i >= 0; i--) {
    if (reeks[i] != null) return reeks[i];
  }
  return null;
}

/**
 * @param {Object} coverageJson EDR-respons (CoverageJSON, "PointSeries") voor één station
 * @param {{naam: string}} station
 * @param {number|null} afstand kilometers tussen de spot en het station (alleen informatief)
 * @param {string} [nuIso] "nu" (standaard de systeemtijd); alleen voor testbaarheid
 * @returns {Object|null} snapshot in dezelfde vorm als parseBuienradarFeed, of null als er geen
 *   recente windmeting is. Parameters die een station niet meet (bv. zicht) ontbreken in de
 *   respons en worden null.
 */
function parseKnmiWaarnemingen(coverageJson, station, afstand, nuIso) {
  const cov = coverageJson && coverageJson.coverages && coverageJson.coverages[0];
  if (!cov || !cov.domain || !cov.ranges) return null;
  const tijden = (cov.domain.axes && cov.domain.axes.t && cov.domain.axes.t.values) || [];
  const waarden = (naam) => (cov.ranges[naam] && cov.ranges[naam].values) || [];

  const ff = waarden('ff');
  // De laatste tijdstap met een echte windmeting; zonder wind is er niets bruikbaars.
  let index = -1;
  for (let i = tijden.length - 1; i >= 0; i--) {
    if (ff[i] != null) {
      index = i;
      break;
    }
  }
  if (index === -1) return null;

  const nuMs = new Date(nuIso || Date.now()).getTime();
  if (nuMs - new Date(tijden[index]).getTime() > KNMI_MAX_LEEFTIJD_MS) return null;

  const gff = waarden('gff');
  const dd = waarden('dd');
  const ta = waarden('ta');
  const vv = waarden('vv');
  const vlaag = laatsteWaarde(gff, index);
  const richting = laatsteWaarde(dd, index);
  const temperatuur = laatsteWaarde(ta, index);
  const zicht = laatsteWaarde(vv, index);
  return {
    bron: 'knmi-waarneming',
    tijdstip: tijden[index],
    stationnaam: (station && station.naam) || null,
    stationsoort: knmiStationSoortNl(station && station.soort),
    afstandKm: afstand != null ? Math.round(afstand * 10) / 10 : null,
    windKnopen: msNaarKnopen(ff[index]),
    windvlaagKnopen: vlaag != null ? msNaarKnopen(vlaag) : null,
    windrichtingGraden: richting,
    luchttemperatuurCelsius: temperatuur,
    zichtKm: zicht != null ? zicht / 1000 : null,
  };
}

module.exports = {
  KNMI_MAX_AFSTAND_KM,
  compacteerKnmiStations,
  knmiStationSoortNl,
  isNederlandsGebied,
  vindKnmiStation,
  parseKnmiWaarnemingen,
};
