const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  amsterdamOffsetMinuten,
  lokaleDatumUur,
  plusDagen,
  lokaleDagAlsUtcVenster,
  parseMultiModel,
  parseBrightSkyAlsModel,
  aggregeerVerificatie,
  dagStatistiek,
  bouwSnapshot,
  waarnemingDagStatistiek,
  evalueerVerificatie,
} = require('../../src/logica/modelVergelijking');

describe('tijdzone (Europe/Amsterdam, zonder Intl)', () => {
  test('zomer- en wintertijd, ook precies op de omschakelmomenten', () => {
    assert.equal(amsterdamOffsetMinuten('2026-09-21T12:00:00Z'), 120);
    assert.equal(amsterdamOffsetMinuten('2026-12-21T12:00:00Z'), 60);
    assert.equal(amsterdamOffsetMinuten('2026-03-29T00:59:00Z'), 60);
    assert.equal(amsterdamOffsetMinuten('2026-03-29T01:00:00Z'), 120);
    assert.equal(amsterdamOffsetMinuten('2026-10-25T00:59:00Z'), 120);
    assert.equal(amsterdamOffsetMinuten('2026-10-25T01:00:00Z'), 60);
  });

  test('UTC -> lokale datum/uur, ook rond middernacht', () => {
    assert.deepEqual(lokaleDatumUur('2026-09-21T10:00:00Z'), { datum: '2026-09-21', uur: 12 });
    assert.deepEqual(lokaleDatumUur('2026-09-21T22:30:00Z'), { datum: '2026-09-22', uur: 0 });
    assert.deepEqual(lokaleDatumUur('2026-12-21T23:30:00Z'), { datum: '2026-12-22', uur: 0 });
  });

  test('plusDagen rekent kalenderdagen, ook over maand- en jaargrens', () => {
    assert.equal(plusDagen('2026-09-28', 3), '2026-10-01');
    assert.equal(plusDagen('2026-12-30', 3), '2027-01-02');
    assert.equal(plusDagen('2026-10-24', 2), '2026-10-26'); // over de zomertijd-omschakeling heen
  });

  test('een lokale dag als UTC-venster (23 of 25 uur op omschakeldagen)', () => {
    assert.deepEqual(lokaleDagAlsUtcVenster('2026-09-21'), { van: '2026-09-20T22:00:00Z', tot: '2026-09-21T22:00:00Z' });
    assert.deepEqual(lokaleDagAlsUtcVenster('2026-12-21'), { van: '2026-12-20T23:00:00Z', tot: '2026-12-21T23:00:00Z' });
    const s = lokaleDagAlsUtcVenster('2026-10-25');
    assert.equal((new Date(s.tot) - new Date(s.van)) / 3600000, 25);
  });
});

describe('parseMultiModel + dagStatistiek', () => {
  const uren = [];
  for (let u = 0; u < 24; u++) uren.push('2026-09-21T' + String(u).padStart(2, '0') + ':00');
  const json = {
    hourly: {
      time: uren,
      wind_speed_10m_icon_seamless: uren.map((_, u) => (u >= 9 && u <= 19 ? 10 : 2)),
      wind_gusts_10m_icon_seamless: uren.map((_, u) => (u === 14 ? 25 : 12)),
      wind_speed_10m_gfs_seamless: uren.map(() => 6),
      wind_gusts_10m_gfs_seamless: uren.map(() => null),
    },
  };

  test('splitst de reeksen per model', () => {
    const p = parseMultiModel(json);
    assert.deepEqual(Object.keys(p).sort(), ['gfs_seamless', 'icon_seamless']);
    assert.equal(p.icon_seamless.wind.length, 24);
  });

  test('gemiddelde en hoogste vlaag over alleen 09-19 uur', () => {
    const p = parseMultiModel(json);
    const s = dagStatistiek(p.icon_seamless.tijdstippen, p.icon_seamless.wind, p.icon_seamless.vlaag);
    assert.deepEqual(s['2026-09-21'], { w: 10, g: 25, n: 11 });
  });

  test('ontbrekende vlaag geeft g=null, niet 0', () => {
    const p = parseMultiModel(json);
    assert.equal(dagStatistiek(p.gfs_seamless.tijdstippen, p.gfs_seamless.wind, p.gfs_seamless.vlaag)['2026-09-21'].g, null);
  });

  test('een dag met te weinig uren telt niet mee', () => {
    const s = dagStatistiek(uren.slice(0, 13), uren.slice(0, 13).map(() => 5), null);
    assert.deepEqual(s, {}); // alleen 09-12 aanwezig = 4 uur
  });

  test('lege/kapotte respons crasht niet', () => {
    assert.deepEqual(parseMultiModel({}), {});
    assert.deepEqual(parseMultiModel(null), {});
    assert.deepEqual(dagStatistiek(null, [], []), {});
  });
});

describe('parseBrightSkyAlsModel', () => {
  test('km/h -> knopen, lokale tijdstippen zonder offset, ontbrekende waarden blijven null', () => {
    const p = parseBrightSkyAlsModel({
      weather: [
        { timestamp: '2026-09-21T09:00:00+02:00', wind_speed: 18.52, wind_gust_speed: 37.04 },
        { timestamp: '2026-09-21T10:00:00+02:00', wind_speed: 9.26, wind_gust_speed: null },
      ],
    });
    assert.deepEqual(p.tijdstippen, ['2026-09-21T09:00', '2026-09-21T10:00']);
    assert.ok(Math.abs(p.wind[0] - 10) < 0.01);
    assert.ok(Math.abs(p.vlaag[0] - 20) < 0.01);
    assert.equal(p.vlaag[1], null);
  });
  test('lege invoer crasht niet', () => {
    assert.deepEqual(parseBrightSkyAlsModel(null), { tijdstippen: [], wind: [], vlaag: [] });
  });
});

describe('bouwSnapshot', () => {
  function reeks(datum, wind) {
    const t = [];
    for (let u = 0; u < 24; u++) t.push(datum + 'T' + String(u).padStart(2, '0') + ':00');
    return { tijdstippen: t, wind: t.map(() => wind), vlaag: t.map(() => wind + 5) };
  }
  test('zet dag 0..6 op een rij, met null voor dagen die een model niet dekt', () => {
    const modellen = {
      lang: { tijdstippen: [], wind: [], vlaag: [] },
    };
    ['2026-09-21', '2026-09-22', '2026-09-23'].forEach((d) => {
      const r = reeks(d, 8);
      modellen.lang.tijdstippen.push(...r.tijdstippen);
      modellen.lang.wind.push(...r.wind);
      modellen.lang.vlaag.push(...r.vlaag);
    });
    const snap = bouwSnapshot({ vandaag: '2026-09-21', locatieSleutel: '51.87_4.04', stationId: 'X', stationNaam: 'Hoek van Holland', modellen });
    assert.equal(snap.d, '2026-09-21');
    assert.equal(snap.m.lang.length, 7);
    assert.deepEqual(snap.m.lang[0], { w: 8, g: 13 });
    assert.equal(snap.m.lang[3], null);
  });

  test('een model zonder enige bruikbare dag komt er niet in', () => {
    const snap = bouwSnapshot({ vandaag: '2026-09-21', locatieSleutel: 'k', stationId: 'X', stationNaam: 'n', modellen: { leeg: { tijdstippen: [], wind: [], vlaag: [] } } });
    assert.deepEqual(snap.m, {});
  });
});

describe('waarnemingDagStatistiek (KNMI 10-minuten)', () => {
  const dekking = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/knmi-waarnemingen-hoekvanholland.json'), 'utf8'));

  function dagVanZeventig(datumUtcPrefix) {
    // 10-minutenreeks van 08:00Z t/m 18:00Z (= 10:00-20:00 lokaal), constante wind 5 m/s, vlaag 8 m/s.
    const t = [];
    for (let u = 8; u <= 18; u++) for (let m = 0; m < 60; m += 10) t.push(datumUtcPrefix + 'T' + String(u).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00Z');
    return {
      coverages: [{ domain: { axes: { t: { values: t } } }, ranges: { ff: { values: t.map(() => 5) }, gff: { values: t.map(() => 8) } } }],
    };
  }

  test('rekent m/s om naar knopen en neemt alleen het 09-19-venster', () => {
    const r = waarnemingDagStatistiek(dagVanZeventig('2026-09-21'), '2026-09-21');
    assert.ok(Math.abs(r.w - 5 * 1.943844) < 0.06);
    assert.ok(Math.abs(r.g - 8 * 1.943844) < 0.06);
    assert.ok(r.n >= 33);
  });

  test('een andere datum of te weinig metingen geeft null', () => {
    assert.equal(waarnemingDagStatistiek(dagVanZeventig('2026-09-21'), '2026-09-22'), null);
    assert.equal(waarnemingDagStatistiek(dekking, '2026-09-21'), null); // fixture heeft maar 8 metingen
  });

  test('ongeldige respons: null', () => {
    assert.equal(waarnemingDagStatistiek(null, '2026-09-21'), null);
    assert.equal(waarnemingDagStatistiek({}, '2026-09-21'), null);
  });
});

describe('aggregeerVerificatie', () => {
  const rij = (dagenVooruit, model, n, biasWind, maeWind, biasVlaag, maeVlaag) => ({ dagenVooruit, model, n, biasWind, maeWind, biasVlaag, maeVlaag });
  test('weegt per (voorspeldag, model) naar het aantal paren en sorteert op fout', () => {
    const r = aggregeerVerificatie({
      A: { naam: 'A', rijen: [rij(3, 'x', 2, 4, 4, 5, 5), rij(3, 'y', 2, 1, 1, null, null)] },
      B: { naam: 'B', rijen: [rij(3, 'x', 6, 0, 2, 3, 3)] },
    });
    const x = r.find((z) => z.model === 'x');
    assert.equal(x.n, 8);
    assert.equal(x.biasWind, 1); // (4*2 + 0*6) / 8
    assert.equal(x.maeWind, 2.5); // (4*2 + 2*6) / 8
    assert.equal(x.biasVlaag, 3.5); // (5*2 + 3*6) / 8
    assert.equal(r.find((z) => z.model === 'y').biasVlaag, null);
    assert.equal(r[0].model, 'y'); // kleinste fout eerst
  });
  test('lege invoer geeft een lege lijst', () => {
    assert.deepEqual(aggregeerVerificatie({}), []);
    assert.deepEqual(aggregeerVerificatie(null), []);
  });
});

describe('evalueerVerificatie', () => {
  const snap = (d, m) => ({ d, l: 'loc', s: 'ST', sn: 'Hoek van Holland', m });
  const data = {
    snapshots: [
      snap('2026-09-01', { goed: [{ w: 10, g: 15 }, { w: 10, g: 15 }], hoog: [{ w: 14, g: 20 }, { w: 14, g: 20 }] }),
      snap('2026-09-02', { goed: [{ w: 8, g: 12 }], hoog: [{ w: 12, g: 18 }] }),
    ],
    waarnemingen: [
      { s: 'ST', d: '2026-09-01', w: 10, g: 15 },
      { s: 'ST', d: '2026-09-02', w: 8, g: 12 },
      { s: 'ST', d: '2026-09-03', w: 10, g: 15 }, // geen snapshot voorspelde deze dag: telt nergens mee
    ],
  };

  test('meet bias en fout per model per voorspeldag-vooruit', () => {
    const r = evalueerVerificatie(data).ST;
    assert.equal(r.naam, 'Hoek van Holland');
    const rij = (k, model) => r.rijen.find((x) => x.dagenVooruit === k && x.model === model);
    // lead 0: snapshot 09-01 (goed 10 vs 10, hoog 14 vs 10) en 09-02 (goed 8 vs 8, hoog 12 vs 8).
    assert.equal(rij(0, 'goed').n, 2);
    assert.equal(rij(0, 'goed').biasWind, 0);
    assert.equal(rij(0, 'hoog').biasWind, 4);
    assert.equal(rij(0, 'hoog').maeWind, 4);
    assert.equal(rij(0, 'hoog').biasVlaag, 5.5); // (+5 en +6)
    // lead 1: alleen snapshot 09-01 vs meting 09-02 (8): goed 10-8 = +2, hoog 14-8 = +6.
    assert.equal(rij(1, 'goed').biasWind, 2);
    assert.equal(rij(1, 'hoog').biasWind, 6);
  });

  test('de consensus (gemiddelde van de modellen) wordt ook beoordeeld', () => {
    const r = evalueerVerificatie(data).ST;
    const c = r.rijen.find((x) => x.dagenVooruit === 0 && x.model === 'consensus');
    assert.equal(c.biasWind, 2); // gemiddelde van 0 en +4
  });

  test('rijen zijn per voorspeldag gesorteerd, beste model (laagste fout) eerst', () => {
    const r = evalueerVerificatie(data).ST;
    const lead0 = r.rijen.filter((x) => x.dagenVooruit === 0).map((x) => x.model);
    assert.equal(lead0[0], 'goed');
  });

  test('een "geen meting"-regel (w null) telt niet mee en veroorzaakt geen NaN', () => {
    const r = evalueerVerificatie({
      snapshots: data.snapshots,
      waarnemingen: [{ s: 'ST', d: '2026-09-01', w: null, g: null, n: 0 }],
    });
    assert.deepEqual(r, {});
  });

  test('zonder gemeten data blijft de uitkomst leeg, geen crash', () => {
    assert.deepEqual(evalueerVerificatie({ snapshots: data.snapshots, waarnemingen: [] }), {});
    assert.deepEqual(evalueerVerificatie({}), {});
  });
});
