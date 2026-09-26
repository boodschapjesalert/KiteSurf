const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { msNaarKnopen, kmhNaarKnopen, afstandKm, dichtstbijzijnde, windrichtingKompas } = require('../../src/logica/eenheden');

describe('eenheid-conversies', () => {
  test('m/s naar knopen', () => {
    assert.ok(Math.abs(msNaarKnopen(1) - 1.9438) < 0.001);
    assert.equal(msNaarKnopen(null), null);
  });

  test('km/u naar knopen', () => {
    assert.ok(Math.abs(kmhNaarKnopen(1.852) - 1) < 0.001);
  });
});

describe('afstandKm / dichtstbijzijnde', () => {
  test('afstand tussen zelfde punt is 0', () => {
    assert.equal(afstandKm(52, 4, 52, 4), 0);
  });

  test('vindt het dichtstbijzijnde punt uit een lijst', () => {
    const punten = [
      { naam: 'ver', lat: 53.5, lon: 6.5 },
      { naam: 'dichtbij', lat: 52.01, lon: 4.01 },
    ];
    const dichtstbij = dichtstbijzijnde(52.0, 4.0, punten);
    assert.equal(dichtstbij.naam, 'dichtbij');
  });

  test('lege lijst geeft null', () => {
    assert.equal(dichtstbijzijnde(52, 4, []), null);
  });
});

describe('windrichtingKompas', () => {
  test('kompaspunten op de hoofdrichtingen', () => {
    assert.equal(windrichtingKompas(0), 'N');
    assert.equal(windrichtingKompas(90), 'O');
    assert.equal(windrichtingKompas(180), 'Z');
    assert.equal(windrichtingKompas(270), 'W');
    assert.equal(windrichtingKompas(202.5), 'ZZW');
    assert.equal(windrichtingKompas(315), 'NW');
  });

  test('wikkelt correct rond 360/0', () => {
    assert.equal(windrichtingKompas(359), 'N');
    assert.equal(windrichtingKompas(-10), 'N');
  });

  test('ontbrekende waarde geeft null', () => {
    assert.equal(windrichtingKompas(null), null);
  });
});
