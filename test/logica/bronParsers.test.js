const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  weerCodeIsOnweer,
  parseOpenMeteoForecast,
  parseOpenMeteoMarine,
  parseBuienradarFeed,
  parseBuienradarRaintext,
  parseWeerlive,
  ontrafelWindfinderTuple,
  parseWindfinderForecast,
  kiesRwsProcesType,
  parseRwsWindVerwachting,
  parseRwsWindMeting,
} = require('../../src/logica/bronParsers');

function fixture(naam) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', naam), 'utf8'));
}

function tekstFixture(naam) {
  return fs.readFileSync(path.join(__dirname, '../fixtures', naam), 'utf8');
}

describe('weerCodeIsOnweer', () => {
  test('WMO-codes 95/96/99 zijn onweer, andere niet', () => {
    assert.equal(weerCodeIsOnweer(95), true);
    assert.equal(weerCodeIsOnweer(96), true);
    assert.equal(weerCodeIsOnweer(99), true);
    assert.equal(weerCodeIsOnweer(61), false);
    assert.equal(weerCodeIsOnweer(0), false);
    assert.equal(weerCodeIsOnweer(null), false);
  });
});

describe('parseOpenMeteoForecast (echte fixture)', () => {
  const json = fixture('open-meteo-forecast.json');
  const r = parseOpenMeteoForecast(json);

  test('geeft een reeks per variabele van gelijke lengte als de tijdstippen', () => {
    assert.ok(r.tijdstippen.length > 0);
    assert.equal(r.windKnopen.length, r.tijdstippen.length);
    assert.equal(r.onweerAanwezig.length, r.tijdstippen.length);
  });

  test('neerslagkans wordt omgezet van percentage naar fractie 0-1', () => {
    r.neerslagKans.forEach((k) => {
      if (k != null) assert.ok(k >= 0 && k <= 1);
    });
  });

  test('zicht wordt omgezet van meter naar kilometer', () => {
    assert.ok(r.zichtKm[0] < 1000); // ruwe fixture-waarde was in meters (duizenden)
  });
});

describe('parseOpenMeteoForecast (lege forecast, edge case)', () => {
  test('verwerkt een lege hourly-reeks zonder te crashen', () => {
    const r = parseOpenMeteoForecast(fixture('open-meteo-forecast-leeg.json'));
    assert.deepEqual(r.tijdstippen, []);
    assert.deepEqual(r.windKnopen, []);
  });

  test('verwerkt een volledig ontbrekend hourly-object', () => {
    const r = parseOpenMeteoForecast({});
    assert.deepEqual(r.tijdstippen, []);
  });

  test('ontbrekend daily-object (bv. oudere fixture zonder &daily=sunrise,sunset) geeft lege dagInfo', () => {
    const r = parseOpenMeteoForecast(fixture('open-meteo-forecast.json'));
    assert.deepEqual(r.dagInfo, { datums: [], zonsopgang: [], zonsondergang: [] });
  });
});

describe('parseOpenMeteoForecast (dagInfo: zonsopgang/-ondergang)', () => {
  test('haalt de dag-niveau zon-reeks uit het aparte daily-object', () => {
    const r = parseOpenMeteoForecast({
      hourly: { time: ['2026-08-29T12:00'], wind_speed_10m: [20] },
      daily: {
        time: ['2026-08-29', '2026-08-30'],
        sunrise: ['2026-08-29T06:30', '2026-08-30T06:32'],
        sunset: ['2026-08-29T20:45', '2026-08-30T20:43'],
      },
    });
    assert.deepEqual(r.dagInfo, {
      datums: ['2026-08-29', '2026-08-30'],
      zonsopgang: ['2026-08-29T06:30', '2026-08-30T06:32'],
      zonsondergang: ['2026-08-29T20:45', '2026-08-30T20:43'],
    });
  });
});

describe('parseOpenMeteoMarine (echte fixture)', () => {
  test('parseert golfhoogte en watertemperatuur', () => {
    const r = parseOpenMeteoMarine(fixture('open-meteo-marine.json'));
    assert.ok(r.tijdstippen.length > 0);
    assert.equal(r.golfhoogteMeter.length, r.tijdstippen.length);
  });
});

describe('parseBuienradarFeed (echte fixture)', () => {
  const json = fixture('buienradar-feed.json');

  test('kiest het dichtstbijzijnde station en converteert m/s naar knopen', () => {
    const station = json.actual.stationmeasurements[0];
    const r = parseBuienradarFeed(json, station.lat, station.lon);
    assert.equal(r.stationnaam, station.stationname);
    assert.ok(Math.abs(r.windKnopen - station.windspeed * 1.9438444924) < 0.01);
  });

  test('ontbrekende bron (geen stations) geeft null i.p.v. te crashen', () => {
    assert.equal(parseBuienradarFeed({ actual: { stationmeasurements: [] } }, 52, 4), null);
    assert.equal(parseBuienradarFeed(null, 52, 4), null);
  });
});

describe('parseBuienradarRaintext (echte fixture)', () => {
  test('parseert regels en converteert naar mm/uur', () => {
    const tekst = fs.readFileSync(path.join(__dirname, '../fixtures/buienradar-raintext.txt'), 'utf8');
    const r = parseBuienradarRaintext(tekst);
    assert.ok(r.length > 0);
    assert.ok(r[0].tijd.match(/^\d{2}:\d{2}$/));
    r.forEach((regel) => assert.ok(regel.mmPerUur >= 0));
  });

  test('lege tekst geeft een lege lijst', () => {
    assert.deepEqual(parseBuienradarRaintext(''), []);
  });
});

describe('parseWeerlive (fixture, best-effort/ongeverifieerd formaat)', () => {
  test('parseert de belangrijkste velden uit de fixture', () => {
    const r = parseWeerlive(fixture('weerlive.json'));
    assert.equal(r.windKnopen, 14);
    assert.equal(r.luchttemperatuurCelsius, 18.4);
  });

  test('onverwachte/lege response geeft null i.p.v. te crashen', () => {
    assert.equal(parseWeerlive({}), null);
    assert.equal(parseWeerlive({ liveweer: [] }), null);
  });
});

describe('ontrafelWindfinderTuple', () => {
  test('ontrafelt geneste [tag, waarde]-tuples op elk niveau', () => {
    const input = [0, { a: [0, 1], b: [1, [[0, 'x'], [0, 'y']]] }];
    assert.deepEqual(ontrafelWindfinderTuple(input), { a: 1, b: ['x', 'y'] });
  });

  test('laat gewone waarden en 2-element-arrays van niet-getallen met rust', () => {
    assert.equal(ontrafelWindfinderTuple('gewoon'), 'gewoon');
    assert.deepEqual(ontrafelWindfinderTuple(['a', 'b']), ['a', 'b']);
  });
});

describe('parseWindfinderForecast (echte fixture, Rockanje)', () => {
  const html = tekstFixture('windfinder-forecast-snippet.html');
  const r = parseWindfinderForecast(html);

  test('vindt en parseert het ingebakken ForecastDataInit-blok', () => {
    assert.equal(r.bron, 'windfinder');
    assert.ok(r.tijdstippen.length > 0);
    assert.equal(r.windKnopen.length, r.tijdstippen.length);
  });

  test('converteert wind van m/s naar knopen', () => {
    // eerste fixture-punt: ws=8.9 m/s -> ± 17.3 knopen
    assert.ok(Math.abs(r.windKnopen[0] - 8.9 * 1.9438444924) < 0.01);
  });

  test('tijdstippen staan chronologisch gesorteerd', () => {
    for (let i = 1; i < r.tijdstippen.length; i++) {
      assert.ok(new Date(r.tijdstippen[i]).getTime() >= new Date(r.tijdstippen[i - 1]).getTime());
    }
  });

  test('geen match (bv. pagina-indeling gewijzigd) geeft null i.p.v. te crashen', () => {
    assert.equal(parseWindfinderForecast('<html><body>geen astro-island hier</body></html>'), null);
    assert.equal(parseWindfinderForecast(''), null);
  });

  test('kapotte JSON in het props-attribuut geeft null i.p.v. te crashen', () => {
    const kapot = '<astro-island component-url="ForecastDataInit.js" props="{niet-geldige-json">';
    assert.equal(parseWindfinderForecast(kapot), null);
  });
});

describe('RWS-wind (echte fixtures, Hoek van Holland — zelfde meetpunt als het getij)', () => {
  const windshdJson = fixture('rws-windshd-hoekvanholland.json');
  const windrtgJson = fixture('rws-windrtg-hoekvanholland.json');

  test('kiesRwsProcesType geeft lege reeksen bij een ontbrekend ProcesType', () => {
    assert.deepEqual(kiesRwsProcesType({ WaarnemingenLijst: [] }, 'meting'), { tijdstippen: [], waarden: [] });
  });

  test('parseRwsWindVerwachting geeft een 3-daagse reeks, gekoppeld op exact tijdstip', () => {
    const r = parseRwsWindVerwachting(windshdJson, windrtgJson);
    assert.equal(r.bron, 'rws-wind-verwachting');
    assert.ok(r.tijdstippen.length > 0);
    assert.equal(r.windKnopen.length, r.tijdstippen.length);
    assert.equal(r.windrichtingGraden.length, r.tijdstippen.length);
    // eerste fixture-punt: 9 m/s -> ±17.5 knopen
    assert.ok(Math.abs(r.windKnopen[0] - 9 * 1.9438444924) < 0.01);
  });

  test('parseRwsWindMeting geeft de laatste actuele waarneming, geen reeks', () => {
    const r = parseRwsWindMeting(windshdJson, windrtgJson);
    assert.equal(r.bron, 'rws-wind-meting');
    assert.ok(r.windKnopen > 0);
    assert.ok(r.windrichtingGraden >= 0 && r.windrichtingGraden <= 360);
    assert.ok(r.tijdstip);
  });

  test('ontbrekende "meting"-reeks geeft null i.p.v. te crashen', () => {
    const leeg = { WaarnemingenLijst: [] };
    assert.equal(parseRwsWindMeting(leeg, leeg), null);
  });
});
