const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRwsGetij, classificeerGetijStatus } = require('../../src/logica/rwsGetij');

function fixture(naam) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', naam), 'utf8'));
}

describe('parseRwsGetij (echte fixture, Hoek van Holland)', () => {
  const json = fixture('rws-getij-hoekvanholland.json');
  const r = parseRwsGetij(json);

  test('kiest ProcesType "verwachting" en geeft een gelijk-lange reeks terug', () => {
    assert.ok(r.tijdstippen.length > 0);
    assert.equal(r.waterstandCm.length, r.tijdstippen.length);
  });

  test('valt terug op "astronomisch" als "verwachting" ontbreekt', () => {
    const zonderVerwachting = { WaarnemingenLijst: json.WaarnemingenLijst.filter((w) => w.AquoMetadata.ProcesType !== 'verwachting') };
    const r2 = parseRwsGetij(zonderVerwachting);
    assert.ok(r2.tijdstippen.length > 0);
  });

  test('lege/ontbrekende WaarnemingenLijst geeft lege reeksen, geen crash', () => {
    assert.deepEqual(parseRwsGetij({}), { tijdstippen: [], waterstandCm: [] });
    assert.deepEqual(parseRwsGetij({ WaarnemingenLijst: [] }), { tijdstippen: [], waterstandCm: [] });
  });
});

describe('classificeerGetijStatus', () => {
  test('classificeert boven het midden als hoog, onder als laag', () => {
    const r = classificeerGetijStatus([0, 50, 100]);
    assert.deepEqual(r, ['laag', 'hoog', 'hoog']);
  });

  test('null-waarden (ontbrekende meting) blijven null, tellen niet mee in min/max', () => {
    const r = classificeerGetijStatus([null, 0, 100]);
    assert.deepEqual(r, [null, 'laag', 'hoog']);
  });

  test('lege reeks geeft lege reeks zonder crash', () => {
    assert.deepEqual(classificeerGetijStatus([]), []);
  });
});
