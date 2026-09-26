const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseBrightSkyForecast } = require('../../src/logica/bronParsers');
const { zonsopgangOndergang } = require('../../src/logica/zonstand');
const { samenstellenUrenData, windBronnenVanDag } = require('../../src/logica/forecastSamenstellen');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/brightsky-forecast.json'), 'utf8'));

function minuten(tijd) {
  const [u, m] = tijd.slice(11, 16).split(':').map(Number);
  return u * 60 + m;
}

describe('zonsopgangOndergang', () => {
  // Referentiewaarden van Open-Meteo voor Rockanje (51,87 N / 4,04 O), CEST.
  const referentie = [
    ['2026-09-21', '2026-09-21T07:27', '2026-09-21T19:44'],
    ['2026-09-22', '2026-09-22T07:29', '2026-09-22T19:42'],
    ['2026-09-24', '2026-09-24T07:32', '2026-09-24T19:37'],
  ];
  referentie.forEach(([datum, opgang, ondergang]) => {
    test('komt binnen 3 minuten overeen met Open-Meteo op ' + datum, () => {
      const r = zonsopgangOndergang(51.87, 4.04, datum, 120);
      assert.ok(Math.abs(minuten(r.zonsopgang) - minuten(opgang)) <= 3, r.zonsopgang);
      assert.ok(Math.abs(minuten(r.zonsondergang) - minuten(ondergang)) <= 3, r.zonsondergang);
      assert.equal(r.zonsopgang.slice(0, 10), datum);
    });
  });

  test("'s winters is de dag korter dan 's zomers", () => {
    const winter = zonsopgangOndergang(51.87, 4.04, '2026-12-21', 60);
    const zomer = zonsopgangOndergang(51.87, 4.04, '2026-06-21', 120);
    const duur = (r) => minuten(r.zonsondergang) - minuten(r.zonsopgang);
    assert.ok(duur(winter) < duur(zomer) - 300);
  });

  test('poolnacht geeft null i.p.v. onzin', () => {
    assert.equal(zonsopgangOndergang(78, 15, '2026-12-21', 60), null);
  });
});

describe('parseBrightSkyForecast', () => {
  const p = parseBrightSkyForecast(fixture, 51.87, 4.04);

  test('geeft dezelfde velden als parseOpenMeteoForecast, allemaal even lang', () => {
    const n = fixture.weather.length;
    ['tijdstippen', 'windKnopen', 'windvlaagKnopen', 'windrichtingGraden', 'onweerAanwezig', 'neerslagKans',
      'neerslagMm', 'luchttemperatuurCelsius', 'zichtKm', 'bewolkingPercent'].forEach((veld) => {
      assert.equal(p[veld].length, n, veld);
    });
    assert.equal(p.bron, 'dwd-brightsky');
  });

  test('tijdstippen zijn lokaal, zonder offset (zelfde vorm als Open-Meteo)', () => {
    assert.equal(p.tijdstippen[12], '2026-09-21T12:00');
  });

  test('rekent km/u om naar knopen en meter zicht naar km', () => {
    // 12:00: 22,2 km/u wind, 31,5 km/u vlaag, 39.800 m zicht.
    assert.equal(p.windKnopen[12], 12);
    assert.equal(p.windvlaagKnopen[12], 17);
    assert.equal(p.zichtKm[12], 39.8);
    assert.equal(p.windrichtingGraden[12], 302);
  });

  test('neerslagkans is een fractie 0-1 en onweer volgt uit de conditie', () => {
    assert.equal(p.neerslagKans[12], 0.01);
    assert.equal(p.onweerAanwezig[12], false);
    const metOnweer = parseBrightSkyForecast({ weather: [{ timestamp: '2026-09-21T12:00:00+02:00', condition: 'thunderstorm' }] }, 51.87, 4.04);
    assert.equal(metOnweer.onweerAanwezig[0], true);
  });

  test('ontbrekende meetwaarden worden null, niet NaN of 0', () => {
    const r = parseBrightSkyForecast({ weather: [{ timestamp: '2026-09-21T12:00:00+02:00' }] }, 51.87, 4.04);
    assert.equal(r.windKnopen[0], null);
    assert.equal(r.windvlaagKnopen[0], null);
    assert.equal(r.zichtKm[0], null);
    assert.equal(r.neerslagKans[0], null);
  });

  test('berekent zonstanden per datum, met de offset uit de tijdstippen', () => {
    assert.deepEqual(p.dagInfo.datums, ['2026-09-21', '2026-09-22']);
    assert.ok(Math.abs(minuten(p.dagInfo.zonsopgang[0]) - minuten('2026-09-21T07:27')) <= 3);
  });

  test('lege of ontbrekende respons crasht niet', () => {
    const leeg = parseBrightSkyForecast({}, 51.87, 4.04);
    assert.deepEqual(leeg.tijdstippen, []);
    assert.deepEqual(leeg.dagInfo.datums, []);
    assert.doesNotThrow(() => parseBrightSkyForecast(null, 51.87, 4.04));
  });

  test('past in de samensteller en de bron heet eerlijk "dwd-brightsky"', () => {
    const uren = samenstellenUrenData({ openMeteo: p, huidigTijdstipIso: '2026-09-21T09:00:00.000Z' });
    assert.equal(uren.length, fixture.weather.length);
    assert.deepEqual(windBronnenVanDag(uren.slice(0, 24)), ['dwd-brightsky']);
  });
});
