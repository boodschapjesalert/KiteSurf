const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { middelWaarden, middelForecastPerVariabele } = require('../../src/logica/bronnenMiddeling');

describe('middelWaarden', () => {
  test('middelt meerdere bronnen die het redelijk eens zijn', () => {
    const r = middelWaarden([
      { bron: 'a', waarde: 18 },
      { bron: 'b', waarde: 20 },
    ]);
    assert.equal(r.gemiddelde, 19);
    assert.deepEqual(r.gebruikteBronnen.sort(), ['a', 'b']);
    assert.deepEqual(r.genegeerdeBronnen, []);
  });

  test('negeert een bron die als uitschieter wordt gedetecteerd', () => {
    const r = middelWaarden(
      [
        { bron: 'a', waarde: 18 },
        { bron: 'b', waarde: 19 },
        { bron: 'c', waarde: 60 }, // duidelijke uitschieter
      ],
      { uitschieterDrempel: 0.4 }
    );
    assert.equal(r.genegeerdeBronnen.includes('c'), true);
    assert.ok(Math.abs(r.gemiddelde - 18.5) < 0.01);
  });

  test('ontbrekende bron (null/undefined) telt niet mee, wordt niet als 0 gezien', () => {
    const r = middelWaarden([
      { bron: 'a', waarde: 20 },
      { bron: 'b', waarde: null },
      { bron: 'c', waarde: undefined },
    ]);
    assert.equal(r.gemiddelde, 20);
    assert.deepEqual(r.gebruikteBronnen, ['a']);
  });

  test('lege bronnenlijst geeft gemiddelde null', () => {
    const r = middelWaarden([]);
    assert.equal(r.gemiddelde, null);
  });

  test('enkele bron wordt direct teruggegeven zonder uitschieter-check', () => {
    const r = middelWaarden([{ bron: 'a', waarde: 42 }]);
    assert.equal(r.gemiddelde, 42);
    assert.deepEqual(r.gebruikteBronnen, ['a']);
  });

  test('valt terug op alle bronnen als de uitschieter-detectie alles zou wegstrepen', () => {
    // Twee bronnen die ver uit elkaar liggen markeren elkaar wederzijds als uitschieter.
    const r = middelWaarden(
      [
        { bron: 'a', waarde: 10 },
        { bron: 'b', waarde: 30 },
      ],
      { uitschieterDrempel: 0.1 }
    );
    assert.equal(r.gemiddelde, 20);
    assert.deepEqual(r.genegeerdeBronnen, []);
  });
});

describe('middelForecastPerVariabele', () => {
  test('middelt per uur over meerdere bronreeksen', () => {
    const resultaat = middelForecastPerVariabele({
      windKnopen: [
        { bron: 'open-meteo', reeks: [10, 12, 14] },
        { bron: 'buienradar', reeks: [11, null, 13] },
      ],
    });
    assert.deepEqual(resultaat.windKnopen.gemiddelde, [10.5, 12, 13.5]);
  });
});
