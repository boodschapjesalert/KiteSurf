const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { widgetUurLabel, widgetUren, bouwWidgetDag } = require('../../src/logica/widgetData');

function uur(u, kleur, ruw) {
  return { tijdstip: '2026-09-26T' + (u < 10 ? '0' : '') + u + ':00', kleur, ruw };
}

const VENSTER = { startUur: 9, eindUur: 20 };

describe('widgetUurLabel', () => {
  test('uur met voorloopnul, +1 wrapt rond middernacht', () => {
    assert.equal(widgetUurLabel('2026-09-26T09:00', 0), '09:00');
    assert.equal(widgetUurLabel('2026-09-26T23:00', 1), '00:00');
  });
});

describe('widgetUren', () => {
  test('alleen het grafiekvenster, afgerond, met windrichting', () => {
    const uren = widgetUren([
      uur(8, 'rood', { windKnopen: 5 }),
      uur(9, 'groen', { windKnopen: 17.6, windvlaagKnopen: 22.4, windrichtingGraden: 224.6, neerslagMm: 0.26 }),
      uur(21, 'rood', { windKnopen: 3 }),
    ], 9, 20);
    assert.deepEqual(uren, [
      { uur: 9, windKnopen: 18, windvlaagKnopen: 22, windrichtingGraden: 225, kleur: 'groen', neerslagMm: 0.3 },
    ]);
  });

  test('ontbrekende waarden blijven null', () => {
    assert.deepEqual(widgetUren([uur(12, 'rood', null)], 9, 20), [
      { uur: 12, windKnopen: null, windvlaagKnopen: null, windrichtingGraden: null, kleur: 'rood', neerslagMm: null },
    ]);
    assert.deepEqual(widgetUren(undefined, 9, 20), []);
  });
});

describe('bouwWidgetDag', () => {
  const ruw = { windKnopen: 18.4, windvlaagKnopen: 23.6, windrichtingGraden: 225 };
  const goedeDag = {
    kleur: 'groen',
    score: 7.5,
    besteUur: { ruw },
    besteVenster: { startTijdstip: '2026-09-27T13:00', eindTijdstip: '2026-09-27T16:00' },
    uurResultaten: [uur(13, 'groen', ruw)],
  };

  test('goede dag: label, venster tot het eind van het laatste uur, wind van het beste uur', () => {
    const dag = bouwWidgetDag({ datum: '2026-09-27' }, goedeDag, 1, VENSTER);
    assert.equal(dag.dagLabel, 'Morgen');
    assert.equal(dag.datumKort, 'zo 27 sep');
    assert.equal(dag.verdict, 'Goede kite-conditie');
    assert.deepEqual(dag.venster, { vanaf: '13:00', tot: '17:00' });
    assert.equal(dag.windKnopen, 18);
    assert.equal(dag.windvlaagKnopen, 24);
    assert.equal(dag.windrichtingKompas, 'ZW');
    assert.equal(dag.indicatief, false);
    assert.equal(dag.uren.length, 1);
  });

  test('rode dag zonder venster; na overmorgen een datumlabel en vanaf dag 5 indicatief', () => {
    const dag = bouwWidgetDag(
      { datum: '2026-10-01' },
      { kleur: 'rood', score: 0, besteUur: null, besteVenster: null, uurResultaten: [] },
      5,
      VENSTER,
    );
    assert.equal(dag.dagLabel, 'do 1 okt');
    assert.equal(dag.venster, null);
    assert.equal(dag.windKnopen, null);
    assert.equal(dag.windrichtingKompas, null);
    assert.equal(dag.indicatief, true);
    assert.deepEqual(dag.uren, []);
  });

  test('rood mét venster (te lage score) toont geen venster', () => {
    const dag = bouwWidgetDag({ datum: '2026-09-26' }, Object.assign({}, goedeDag, { kleur: 'rood', score: 3 }), 0, VENSTER);
    assert.equal(dag.dagLabel, 'Vandaag');
    assert.equal(dag.venster, null);
  });
});
