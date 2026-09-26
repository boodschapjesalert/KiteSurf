const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { bepaalWindTrendNaVenster, vatRegenSamen, formatRegenZin, bouwDagSamenvatting } = require('../../src/logica/dagSamenvatting');
const { berekenDagScore } = require('../../src/logica/scoreBerekening');

/** Bouwt een uur zoals berekenDagScore dat teruggeeft (alleen de velden die de samenvatting leest). */
function uur(uurVanDag, windKnopen, neerslagMm) {
  return {
    tijdstip: '2026-08-30T' + String(uurVanDag).padStart(2, '0') + ':00',
    ruw: { windKnopen: windKnopen, neerslagMm: neerslagMm != null ? neerslagMm : 0 },
  };
}

describe('bepaalWindTrendNaVenster', () => {
  test('duidelijk afnemende wind na het venster', () => {
    assert.equal(bepaalWindTrendNaVenster([uur(13, 12), uur(14, 10)], 20), 'af');
  });

  test('duidelijk aantrekkende wind na het venster', () => {
    assert.equal(bepaalWindTrendNaVenster([uur(13, 26), uur(14, 28)], 20), 'toe');
  });

  test('klein verschil (<2 kn) telt als gelijk, geen overdreven conclusie', () => {
    assert.equal(bepaalWindTrendNaVenster([uur(13, 21), uur(14, 20)], 20), 'gelijk');
  });

  test('geen uren na het venster of geen venstergemiddelde geeft null', () => {
    assert.equal(bepaalWindTrendNaVenster([], 20), null);
    assert.equal(bepaalWindTrendNaVenster([uur(13, 12)], null), null);
  });
});

describe('vatRegenSamen', () => {
  test('telt mm op en geeft begin- én eindtijd van één aaneengesloten bui', () => {
    const r = vatRegenSamen([uur(9, 18, 0), uur(10, 18, 0), uur(11, 18, 3), uur(12, 18, 5)]);
    assert.equal(r.totaalMm, 8);
    assert.equal(r.buien.length, 1);
    assert.equal(r.buien[0].vanafTijdstip, '2026-08-30T11:00');
    assert.equal(r.buien[0].totTijdstip, '2026-08-30T12:00');
  });

  test('splitst onderbroken regen in aparte buien i.p.v. één lange periode', () => {
    const r = vatRegenSamen([uur(9, 18, 2), uur(10, 18, 1), uur(11, 18, 0), uur(12, 18, 0), uur(13, 18, 3)]);
    assert.equal(r.buien.length, 2);
    assert.equal(r.buien[0].vanafTijdstip, '2026-08-30T09:00');
    assert.equal(r.buien[0].totTijdstip, '2026-08-30T10:00');
    assert.equal(r.buien[1].vanafTijdstip, '2026-08-30T13:00');
    assert.equal(r.totaalMm, 6);
  });

  test('negeert verwaarloosbare motregen onder de drempel', () => {
    assert.equal(vatRegenSamen([uur(9, 18, 0.1), uur(10, 18, 0)]), null);
  });

  test('droge dag geeft null', () => {
    assert.equal(vatRegenSamen([uur(9, 18, 0), uur(10, 18, 0)]), null);
  });

  test('ontbrekende neerslagdata telt niet als regen', () => {
    assert.equal(vatRegenSamen([{ tijdstip: '2026-08-30T09:00', ruw: { windKnopen: 18, neerslagMm: null } }]), null);
  });
});

describe('formatRegenZin', () => {
  test('één bui: noemt periode met eindtijd (laatste regenuur + 1)', () => {
    const zin = formatRegenZin(vatRegenSamen([uur(9, 18, 0), uur(10, 18, 3), uur(11, 18, 2.3)]));
    assert.match(zin, /Tussen 10:00 en 12:00 valt 5\.3 mm regen\./);
  });

  test('twee buien: noemt beide periodes en het totaal', () => {
    const zin = formatRegenZin(vatRegenSamen([uur(9, 18, 2), uur(10, 18, 0), uur(11, 18, 3)]));
    assert.match(zin, /Regen tussen 09:00-10:00 en 11:00-12:00, samen 5 mm\./);
  });

  test('drie of meer buien: vat samen als "met onderbrekingen" met een totale periode', () => {
    const zin = formatRegenZin(vatRegenSamen([
      uur(9, 18, 1), uur(10, 18, 0), uur(11, 18, 1), uur(12, 18, 0), uur(13, 18, 1),
    ]));
    assert.match(zin, /Met onderbrekingen regen tussen 09:00 en 14:00, samen 3 mm\./);
  });

  test('geen regen geeft een lege string (geen losse punt in de zin)', () => {
    assert.equal(formatRegenZin(null), '');
  });
});

describe('bouwDagSamenvatting', () => {
  // Drempels die een duidelijke groen/rood-scheiding geven bij de testwaarden hieronder.
  const instellingen = {
    windsnelheid: { minimum: 12, ideaalOnder: 16, ideaalBoven: 26, maximum: 40 },
    windvlagen: { waarschuwingVlaagfactor: 0.4, maxVlaagfactor: 0.8 },
    windrichting: { besteRanges: [[0, 360]], acceptabeleRanges: [] },
  };

  function dagMetUren(urenSpec) {
    const uren = urenSpec.map((u) => ({
      tijdstip: '2026-08-30T' + String(u.uur).padStart(2, '0') + ':00',
      uurData: {
        windKnopen: u.wind,
        windvlaagKnopen: u.wind * 1.2,
        windrichtingGraden: 250,
        neerslagMm: u.regen != null ? u.regen : 0,
      },
    }));
    return berekenDagScore(uren, instellingen, {
      dagvensterStartUur: 9, dagvensterEindUur: 20, minimaleSessieUren: 2,
    });
  }

  test('noemt periode en windbereik van het beste venster', () => {
    const dag = dagMetUren([
      { uur: 9, wind: 20 }, { uur: 10, wind: 22 }, { uur: 11, wind: 21 },
      { uur: 12, wind: 8 }, { uur: 13, wind: 7 },
    ]);
    const zin = bouwDagSamenvatting(dag, { dagvensterStartUur: 9, dagvensterEindUur: 20 });
    assert.match(zin, /Tussen 09:00 en \d{2}:00 lijkt de wind goed/);
    assert.match(zin, /kn\)/);
  });

  test('meldt afnemende wind na het venster', () => {
    const dag = dagMetUren([
      { uur: 9, wind: 24 }, { uur: 10, wind: 24 }, { uur: 11, wind: 24 },
      { uur: 12, wind: 14 }, { uur: 13, wind: 13 },
    ]);
    assert.match(bouwDagSamenvatting(dag, { dagvensterStartUur: 9, dagvensterEindUur: 20 }), /daarna neemt het af/);
  });

  test('voegt de regenverwachting toe met totaal, begin- én eindtijd', () => {
    const dag = dagMetUren([
      { uur: 9, wind: 20 }, { uur: 10, wind: 22 }, { uur: 11, wind: 21, regen: 3 }, { uur: 12, wind: 20, regen: 5 },
    ]);
    const zin = bouwDagSamenvatting(dag, { dagvensterStartUur: 9, dagvensterEindUur: 20 });
    assert.match(zin, /Tussen 11:00 en 13:00 valt 8 mm regen\./);
  });

  test('geen venster lang genoeg: meldt dat expliciet i.p.v. een goede periode te suggereren', () => {
    // Eén los goed uur tussen te zwakke uren — te kort voor een sessie bij minimaleSessieUren 2.
    const dag = dagMetUren([
      { uur: 9, wind: 5 }, { uur: 10, wind: 22 }, { uur: 11, wind: 5 }, { uur: 12, wind: 5 },
    ]);
    const zin = bouwDagSamenvatting(dag, { dagvensterStartUur: 9, dagvensterEindUur: 20 });
    assert.match(zin, /geen geschikt moment|lang genoeg/i);
    assert.doesNotMatch(zin, /lijkt de wind goed/);
  });

  test('lege dag geeft een nette melding, geen crash', () => {
    assert.match(bouwDagSamenvatting(berekenDagScore([], instellingen, {})), /Geen weerdata/);
    assert.match(bouwDagSamenvatting(null), /Geen weerdata/);
  });
});
