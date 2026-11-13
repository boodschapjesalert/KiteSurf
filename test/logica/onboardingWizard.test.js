const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  ONBOARDING_WIND_PRESETS,
  ONBOARDING_VLAAG_PRESETS,
  maakOnboardingConcept,
  berekenVlaagVoorbeeldKnopen,
  valideerOnboardingStap,
  pasOnboardingConceptToeOpProfiel,
} = require('../../src/logica/onboardingWizard');
const { standaardProfiel } = require('../../src/logica/profielValidatie');
const { heeftEssentieleConfiguratie } = require('../../src/logica/drempelwaarden');

describe('onboardingWizard presets en concept', () => {
  test('wind- en vlaag-presets bevatten geldige waarden voor de stappen', () => {
    assert.ok(ONBOARDING_WIND_PRESETS.length >= 3);
    assert.ok(ONBOARDING_VLAAG_PRESETS.length >= 3);

    ONBOARDING_WIND_PRESETS.forEach((p) => {
      const concept = maakOnboardingConcept(standaardProfiel('u1'));
      concept.windsnelheid = { ...p.windsnelheid };
      assert.equal(valideerOnboardingStap(0, concept).ok, true, p.id);
    });

    ONBOARDING_VLAAG_PRESETS.forEach((p) => {
      const concept = maakOnboardingConcept(standaardProfiel('u1'));
      concept.windvlagen = {
        waarschuwingVlaagfactor: p.waarschuwingVlaagfactor,
        maxVlaagfactor: p.maxVlaagfactor,
      };
      assert.equal(valideerOnboardingStap(1, concept).ok, true, p.id);
    });
  });

  test('berekenVlaagVoorbeeldKnopen rekent vlaagfactor exact om naar knopen', () => {
    const r = berekenVlaagVoorbeeldKnopen(20, 0.3, 0.5);
    assert.deepEqual(r, {
      basisKnopen: 20,
      waarschuwingKnopen: 26,
      maxKnopen: 30,
      waarschuwingPct: 30,
      maxPct: 50,
    });
  });

  test('berekenVlaagVoorbeeldKnopen valt terug op 20 knopen als basis ontbreekt', () => {
    const r = berekenVlaagVoorbeeldKnopen(null, 0.25, null);
    assert.equal(r.basisKnopen, 20);
    assert.equal(r.waarschuwingKnopen, 25);
    assert.equal(r.maxKnopen, null);
  });
});

describe('valideerOnboardingStap', () => {
  test('Stap 1 (windsnelheid): vereist minimum < ideaalOnder <= ideaalBoven <= maximum', () => {
    const c = maakOnboardingConcept(standaardProfiel('u1'));
    assert.equal(valideerOnboardingStap(0, c).ok, false);

    c.windsnelheid = { minimum: 16, ideaalOnder: 14, ideaalBoven: 24, maximum: null };
    assert.equal(valideerOnboardingStap(0, c).ok, false);

    c.windsnelheid = { minimum: 12, ideaalOnder: 16, ideaalBoven: 24, maximum: 22 };
    assert.equal(valideerOnboardingStap(0, c).ok, false);

    c.windsnelheid = { minimum: 12, ideaalOnder: 16, ideaalBoven: 24, maximum: null };
    assert.equal(valideerOnboardingStap(0, c).ok, true);
  });

  test('Stap 2 (windvlagen): waarschuwing < max, waarschuwt bij waarden >= 1', () => {
    const c = maakOnboardingConcept(standaardProfiel('u1'));
    c.windvlagen = { waarschuwingVlaagfactor: 0.5, maxVlaagfactor: 0.3 };
    assert.equal(valideerOnboardingStap(1, c).ok, false);

    c.windvlagen = { waarschuwingVlaagfactor: 1.3, maxVlaagfactor: 1.5 };
    const r = valideerOnboardingStap(1, c);
    assert.equal(r.ok, true);
    assert.ok(r.waarschuwing && r.waarschuwing.includes('+30%'));
  });

  test('Stap 3 (dagvenster/sessie/horizon) en Stap 4 (optioneel) vangen ongeldige combinaties af', () => {
    const c = maakOnboardingConcept(standaardProfiel('u1'));
    assert.equal(valideerOnboardingStap(2, c).ok, true);
    assert.equal(valideerOnboardingStap(3, c).ok, true);

    c.dagvenster = { startUur: 20, eindUur: 9 };
    assert.equal(valideerOnboardingStap(2, c).ok, false);

    c.dagvenster = { startUur: 9, eindUur: 20 };
    c.onweer.neerslagWaarschuwingDrempel = 1.5;
    assert.equal(valideerOnboardingStap(3, c).ok, false);

    c.onweer.neerslagWaarschuwingDrempel = 0.5;
    c.watertemperatuur = { minimumComfortabel: 15, minimumMetWetsuit: 18 };
    assert.equal(valideerOnboardingStap(3, c).ok, false);
  });
});

describe('pasOnboardingConceptToeOpProfiel', () => {
  test('schrijft wizard-keuzes door en behoudt overige profielvelden (favorieten, telegram, gewichten)', () => {
    const basis = standaardProfiel('gebruiker-123');
    basis.telegramChatId = 999888;
    basis.meldingen.laatstGemeld = { 'rockanje-sportstrand': { '2026-11-13': true } };
    basis.meldingen.laatsteSamenvattingDatum = '2026-11-13';

    const concept = maakOnboardingConcept(basis);
    concept.windsnelheid = { minimum: 12, ideaalOnder: 16, ideaalBoven: 26, maximum: 34 };
    concept.windvlagen = { waarschuwingVlaagfactor: 0.3, maxVlaagfactor: 0.5 };
    concept.dagenVooruit = 5;
    concept.meldingen.directeAlert = true;

    const nieuw = pasOnboardingConceptToeOpProfiel(basis, concept);
    assert.equal(heeftEssentieleConfiguratie(nieuw.drempelwaarden), true);
    assert.equal(nieuw.dagenVooruit, 5);
    assert.equal(nieuw.meldingen.directeAlert, true);
    assert.equal(nieuw.telegramChatId, 999888);
    assert.deepEqual(nieuw.meldingen.laatstGemeld, basis.meldingen.laatstGemeld);
    assert.equal(nieuw.meldingen.laatsteSamenvattingDatum, '2026-11-13');
    assert.equal(nieuw.favorieteLocaties.length, basis.favorieteLocaties.length);
  });
});
