const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compacteerKnmiStations, vindKnmiStation, parseKnmiWaarnemingen } = require('../../src/logica/knmiWaarnemingen');
const { samenstellenUrenData, windBronnenVanDag } = require('../../src/logica/forecastSamenstellen');
const { parseOpenMeteoForecast } = require('../../src/logica/bronParsers');

const fx = (naam) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', naam), 'utf8'));
const stationsGeo = fx('knmi-stations.json');
const dekking = fx('knmi-waarnemingen-hoekvanholland.json');
const stations = compacteerKnmiStations(stationsGeo);

describe('compacteerKnmiStations', () => {
  test('houdt id, naam en coördinaten over', () => {
    assert.ok(stations.length > 50);
    const hoek = stations.find((s) => s.naam === 'Hoek van Holland');
    assert.equal(hoek.id, '0-20000-0-06330');
    assert.ok(Math.abs(hoek.lat - 51.9911) < 0.001 && Math.abs(hoek.lon - 4.1217) < 0.001);
  });

  test('slaat kapotte features over en crasht niet op leeg', () => {
    assert.deepEqual(compacteerKnmiStations(null), []);
    assert.deepEqual(compacteerKnmiStations({ features: [{ id: 'x' }, { geometry: {} }] }), []);
  });
});

describe('vindKnmiStation', () => {
  test('Rockanje -> Hoek van Holland (~14 km)', () => {
    const r = vindKnmiStation(51.87, 4.04, stations);
    assert.equal(r.station.naam, 'Hoek van Holland');
    assert.ok(r.afstandKm > 10 && r.afstandKm < 18, String(r.afstandKm));
  });

  test('Berkel en Rodenrijs -> Rotterdam Airport (dichtbij)', () => {
    const r = vindKnmiStation(51.99313, 4.47865, stations);
    assert.equal(r.station.naam, 'Rotterdam Airport');
    assert.ok(r.afstandKm < 6);
  });

  test('te ver weg (midden op de Atlantische Oceaan) geeft null', () => {
    assert.equal(vindKnmiStation(45, -20, stations), null);
  });

  test('geen stations geeft null', () => {
    assert.equal(vindKnmiStation(51.87, 4.04, []), null);
    assert.equal(vindKnmiStation(51.87, 4.04, null), null);
  });
});

describe('parseKnmiWaarnemingen', () => {
  const hoek = stations.find((s) => s.naam === 'Hoek van Holland');
  // De fixture eindigt op 11:30Z; "nu" net daarna.
  const nu = '2026-09-21T11:40:00Z';

  test('neemt de laatste tijdstap en rekent m/s om naar knopen', () => {
    const r = parseKnmiWaarnemingen(dekking, hoek, 14.2, nu);
    assert.equal(r.bron, 'knmi-waarneming');
    assert.equal(r.tijdstip, '2026-09-21T11:30:00Z');
    assert.equal(r.stationnaam, 'Hoek van Holland');
    assert.equal(r.afstandKm, 14.2);
    // 4,55 m/s = 8,84 kn; laatste gemeten vlaag hoort bij dezelfde stap.
    assert.ok(Math.abs(r.windKnopen - 4.55 * 1.943844) < 0.01, String(r.windKnopen));
    const gff = dekking.coverages[0].ranges.gff.values.slice(-1)[0];
    assert.ok(Math.abs(r.windvlaagKnopen - gff * 1.943844) < 0.01);
    assert.equal(r.windrichtingGraden, dekking.coverages[0].ranges.dd.values.slice(-1)[0]);
    assert.equal(r.luchttemperatuurCelsius, dekking.coverages[0].ranges.ta.values.slice(-1)[0]);
  });

  test('een parameter die het station niet meet (zicht) wordt null, geen crash', () => {
    assert.equal(parseKnmiWaarnemingen(dekking, hoek, 1, nu).zichtKm, null);
  });

  test('zicht in meters wordt kilometers als het station het wel meet', () => {
    const met = JSON.parse(JSON.stringify(dekking));
    met.coverages[0].ranges.vv = { values: met.coverages[0].domain.axes.t.values.map(() => 12500) };
    assert.equal(parseKnmiWaarnemingen(met, hoek, 1, nu).zichtKm, 12.5);
  });

  test('een meting ouder dan een uur is geen "nu" meer', () => {
    assert.equal(parseKnmiWaarnemingen(dekking, hoek, 1, '2026-09-21T13:00:00Z'), null);
  });

  test('een ontbrekende laatste meting valt terug op de vorige tijdstap met wind', () => {
    const gat = JSON.parse(JSON.stringify(dekking));
    const n = gat.coverages[0].ranges.ff.values.length;
    gat.coverages[0].ranges.ff.values[n - 1] = null;
    const r = parseKnmiWaarnemingen(gat, hoek, 1, nu);
    assert.equal(r.tijdstip, gat.coverages[0].domain.axes.t.values[n - 2]);
  });

  test('zonder enige windmeting: null', () => {
    const geenWind = JSON.parse(JSON.stringify(dekking));
    geenWind.coverages[0].ranges.ff.values = geenWind.coverages[0].ranges.ff.values.map(() => null);
    assert.equal(parseKnmiWaarnemingen(geenWind, hoek, 1, nu), null);
  });

  test('lege of ongeldige respons: null, geen crash', () => {
    assert.equal(parseKnmiWaarnemingen({}, hoek, 1, nu), null);
    assert.equal(parseKnmiWaarnemingen(null, hoek, 1, nu), null);
    assert.equal(parseKnmiWaarnemingen({ coverages: [{ domain: {}, ranges: {} }] }, hoek, 1, nu), null);
  });
});

describe('KNMI als "nu"-bron in de samensteller', () => {
  const om = parseOpenMeteoForecast(fx('open-meteo-forecast.json'));
  const hoek = stations.find((s) => s.naam === 'Hoek van Holland');
  const nuIso = om.tijdstippen[5];
  const knmi = {
    bron: 'knmi-waarneming',
    windKnopen: 30,
    windvlaagKnopen: 40,
    windrichtingGraden: om.windrichtingGraden[5],
    luchttemperatuurCelsius: 10,
    zichtKm: null,
  };

  test('telt alleen op het "nu"-uur mee, en levert een eigen vlaag-waarde', () => {
    const met = samenstellenUrenData({ openMeteo: om, knmi, huidigTijdstipIso: nuIso });
    const zonder = samenstellenUrenData({ openMeteo: om, huidigTijdstipIso: nuIso });
    assert.notEqual(met[5].uurData.windKnopen, zonder[5].uurData.windKnopen);
    assert.deepEqual(met[6].uurData.windKnopen, zonder[6].uurData.windKnopen);
    assert.ok(windBronnenVanDag(met).includes('knmi-waarneming'));
    assert.ok(met[5].bronDetails.windvlagen.gebruikteBronnen || met[5].bronDetails.windvlagen);
  });

  test('zonder KNMI-data verandert er niets', () => {
    const a = samenstellenUrenData({ openMeteo: om, knmi: null, huidigTijdstipIso: nuIso });
    const b = samenstellenUrenData({ openMeteo: om, huidigTijdstipIso: nuIso });
    assert.deepEqual(a, b);
  });
});
