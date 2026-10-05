const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  OORDEEL_VERS_MS,
  oordeelOpslagSleutel,
  oordeelSleutel,
  bruikbaarBewaardOordeel,
  isOordeelVers,
} = require('../../src/logica/appCache');
const { standaardProfiel } = require('../../src/logica/profielValidatie');

describe('appCache', () => {
  const profiel = standaardProfiel();
  const locatie = profiel.favorieteLocaties[0];

  test('opslagsleutel: id, anders de afgeronde positie', () => {
    assert.equal(oordeelOpslagSleutel({ id: 'rockanje' }), 'kiteweer_oordeel_rockanje');
    assert.equal(oordeelOpslagSleutel({ lat: 51.87, lon: 4.05 }), 'kiteweer_oordeel_51.8700,4.0500');
  });

  test('oordeelSleutel: veldvolgorde, meldingen en favorieten tellen niet mee', () => {
    const basis = oordeelSleutel(profiel, locatie);
    const omgedraaid = {};
    Object.keys(profiel).reverse().forEach((k) => { omgedraaid[k] = profiel[k]; });
    assert.equal(oordeelSleutel(omgedraaid, locatie), basis);
    const andereMeldingen = Object.assign({}, profiel, { meldingen: { directeAlert: !profiel.meldingen.directeAlert }, favorieteLocaties: [] });
    assert.equal(oordeelSleutel(andereMeldingen, locatie), basis);
  });

  test('oordeelSleutel: andere drempels, horizon of locatie = andere sleutel', () => {
    const basis = oordeelSleutel(profiel, locatie);
    assert.notEqual(oordeelSleutel(Object.assign({}, profiel, { dagenVooruit: profiel.dagenVooruit + 1 }), locatie), basis);
    const drempels = JSON.parse(JSON.stringify(profiel.drempelwaarden));
    drempels.windsnelheid.minimum += 1;
    assert.notEqual(oordeelSleutel(Object.assign({}, profiel, { drempelwaarden: drempels }), locatie), basis);
    assert.notEqual(oordeelSleutel(profiel, Object.assign({}, locatie, { lat: locatie.lat + 0.01 })), basis);
  });

  test('bruikbaarBewaardOordeel: alleen met de juiste sleutel, zonder verlopen dagen', () => {
    const bewaard = { opgehaald: 1, sleutel: 'abc', r: { dagen: [{ datum: '2026-09-25' }, { datum: '2026-09-26' }] } };
    assert.equal(bruikbaarBewaardOordeel(bewaard, 'anders', '2026-09-26'), null);
    assert.deepEqual(bruikbaarBewaardOordeel(bewaard, 'abc', '2026-09-26').r.dagen, [{ datum: '2026-09-26' }]);
    assert.equal(bruikbaarBewaardOordeel(bewaard, 'abc', '2026-09-27'), null);
    assert.equal(bruikbaarBewaardOordeel(null, 'abc', '2026-09-26'), null);
    assert.equal(bewaard.r.dagen.length, 2, 'origineel ongewijzigd');
  });

  test('isOordeelVers', () => {
    assert.equal(isOordeelVers({ opgehaald: 1000 }, 1000 + OORDEEL_VERS_MS - 1), true);
    assert.equal(isOordeelVers({ opgehaald: 1000 }, 1000 + OORDEEL_VERS_MS), false);
    assert.equal(isOordeelVers(null, 0), false);
  });
});
