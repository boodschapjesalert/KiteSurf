const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  standaardProfiel,
  valideerEnVulProfielAan,
  valideerLocatie,
  valideerDagvenster,
  valideerDagenVooruit,
  valideerMinimaleSessieUren,
  valideerScoreGewichten,
  valideerMeldingen,
  voegFavorieteLocatieToe,
  verwijderFavorieteLocatie,
} = require('../../src/logica/profielValidatie');
const { GEWICHTEN } = require('../../src/logica/scoreBerekening');

describe('standaardProfiel', () => {
  test('bevat alle drempelwaarde-categorieën behalve windrichting (die is locatie-specifiek)', () => {
    const p = standaardProfiel('abc-123');
    assert.equal(p.gebruikerId, 'abc-123');
    assert.ok(p.drempelwaarden.windsnelheid);
    assert.equal(p.drempelwaarden.windrichting, undefined);
  });

  test('scoreGewichten start als exacte kopie van de ingebouwde GEWICHTEN (geen gedrags-verrassing)', () => {
    assert.deepEqual(standaardProfiel('abc-123').scoreGewichten, GEWICHTEN);
  });

  test('bevat Rockanje en Maasvlakte als standaard-favorieten met de ZZW-NW meldingsrichting', () => {
    const p = standaardProfiel('abc-123');
    const namen = p.favorieteLocaties.map((l) => l.naam);
    assert.ok(namen.includes('Rockanje Sportstrand'));
    assert.ok(namen.includes('Maasvlakte 2 - Slufter'));
    p.favorieteLocaties.forEach((l) => {
      assert.deepEqual(l.windrichting.besteRanges, [[202.5, 315]]);
    });
  });

  test('databronnen staan standaard allemaal aan', () => {
    const p = standaardProfiel('abc-123');
    assert.deepEqual(p.databronnen, { openMeteo: true, buienradar: true, weerlive: true, rws: true, windfinder: true, knmi: true });
  });

  test('dagvenster heeft een concrete default (09:00-20:00), i.t.t. de blanco drempelwaarden', () => {
    const p = standaardProfiel('abc-123');
    assert.deepEqual(p.dagvenster, { startUur: 9, eindUur: 20 });
  });

  test('telegramChatId is standaard null (alleen gekoppeld via de bot, niet handmatig instelbaar)', () => {
    assert.equal(standaardProfiel('abc-123').telegramChatId, null);
  });

  test('meldingen: dagelijkse samenvatting om 08:00 aan, directe alert uit', () => {
    const p = standaardProfiel('abc-123');
    assert.deepEqual(p.meldingen, {
      dagelijkseSamenvatting: true,
      samenvattingUur: 8,
      samenvattingMinuut: 0,
      directeAlert: false,
      laatstGemeld: {},
      laatsteSamenvattingDatum: null,
    });
  });

  test('dagenVooruit is standaard 3', () => {
    assert.equal(standaardProfiel('abc-123').dagenVooruit, 3);
  });

  test('minimaleSessieUren is standaard 2 (een los piek-uur is geen sessie)', () => {
    assert.equal(standaardProfiel('abc-123').minimaleSessieUren, 2);
  });
});

describe('valideerMinimaleSessieUren', () => {
  test('null/ontbrekend/ongeldig geeft de default terug', () => {
    assert.equal(valideerMinimaleSessieUren(null, 2), 2);
    assert.equal(valideerMinimaleSessieUren(undefined, 2), 2);
    assert.equal(valideerMinimaleSessieUren('lang', 2), 2);
  });

  test('klemt naar het toegestane bereik (1-8)', () => {
    assert.equal(valideerMinimaleSessieUren(0, 2), 1);
    assert.equal(valideerMinimaleSessieUren(-3, 2), 1);
    assert.equal(valideerMinimaleSessieUren(24, 2), 8);
  });

  test('geldige waarde blijft staan (afgerond)', () => {
    assert.equal(valideerMinimaleSessieUren(3, 2), 3);
    assert.equal(valideerMinimaleSessieUren(2.6, 2), 3);
  });
});

describe('valideerScoreGewichten', () => {
  test('zonder invoer geeft het default-object terug', () => {
    assert.deepEqual(valideerScoreGewichten(null, GEWICHTEN), GEWICHTEN);
  });

  test('geeft precies de meegegeven geldige sleutels terug (open set, geen aanvulling meer)', () => {
    // De tabel in ⚙️ Instellingen -> Score-berekening bepaalt nu volledig wélke criteria
    // meetellen; een niet-meegegeven criterium (hier windrichting) wordt niet meer aangevuld.
    const r = valideerScoreGewichten({ windsnelheid: 0.5, getij: 0.05 }, GEWICHTEN);
    assert.deepEqual(Object.keys(r).sort(), ['getij', 'windsnelheid']);
    assert.equal(r.windsnelheid, 0.5);
    assert.equal(r.getij, 0.05);
  });

  test('een individueel toegevoegde facultatieve variabele (bv. zicht) blijft ook staan', () => {
    const r = valideerScoreGewichten({ windsnelheid: 0.5, zicht: 0.2 }, GEWICHTEN);
    assert.equal(r.zicht, 0.2);
  });

  test('negatieve/niet-numerieke waarden en onbekende sleutels worden genegeerd, geldige buren blijven staan', () => {
    const r = valideerScoreGewichten({ windsnelheid: -1, windrichting: 'veel', getij: 0.2, nietBestaand: 5 }, GEWICHTEN);
    assert.deepEqual(Object.keys(r), ['getij']);
  });

  test('klemt een te hoge waarde naar het maximum i.p.v. hem ongelimiteerd te laten', () => {
    const r = valideerScoreGewichten({ windsnelheid: 9999 }, GEWICHTEN);
    assert.equal(r.windsnelheid, 10);
  });

  test('blijft er na filtering niets geldigs over, dan valt het geheel terug op de default', () => {
    assert.deepEqual(valideerScoreGewichten({ nietBestaand: 5 }, GEWICHTEN), GEWICHTEN);
    assert.deepEqual(valideerScoreGewichten({}, GEWICHTEN), GEWICHTEN);
    assert.deepEqual(valideerScoreGewichten({ windsnelheid: -1 }, GEWICHTEN), GEWICHTEN);
  });
});

describe('valideerDagenVooruit', () => {
  test('null/ontbrekend/ongeldig geeft de default terug', () => {
    assert.equal(valideerDagenVooruit(null, 3), 3);
    assert.equal(valideerDagenVooruit(undefined, 3), 3);
    assert.equal(valideerDagenVooruit('veel', 3), 3);
  });

  test('klemt naar het toegestane bereik (1-10)', () => {
    assert.equal(valideerDagenVooruit(0, 3), 1);
    assert.equal(valideerDagenVooruit(-5, 3), 1);
    assert.equal(valideerDagenVooruit(50, 3), 10);
  });

  test('geldige waarde binnen bereik blijft staan (afgerond)', () => {
    assert.equal(valideerDagenVooruit(7, 3), 7);
    assert.equal(valideerDagenVooruit(5.6, 3), 6);
  });
});

describe('valideerMeldingen', () => {
  const defaultMeldingen = {
    dagelijkseSamenvatting: true, samenvattingUur: 8, samenvattingMinuut: 0,
    directeAlert: false, laatstGemeld: {}, laatsteSamenvattingDatum: null,
  };

  test('null/ontbrekend geeft de default terug', () => {
    assert.deepEqual(valideerMeldingen(null, defaultMeldingen), defaultMeldingen);
  });

  test('beide meldingsvormen zijn onafhankelijk instelbaar (ook beide aan)', () => {
    assert.deepEqual(
      valideerMeldingen({ dagelijkseSamenvatting: true, directeAlert: true }, defaultMeldingen),
      { ...defaultMeldingen, dagelijkseSamenvatting: true, directeAlert: true }
    );
    assert.deepEqual(
      valideerMeldingen({ dagelijkseSamenvatting: false, directeAlert: false }, defaultMeldingen),
      { ...defaultMeldingen, dagelijkseSamenvatting: false, directeAlert: false }
    );
  });

  test('samenvattingUur wordt geklemd naar 0-23, ongeldige waarde valt terug op de default', () => {
    assert.equal(valideerMeldingen({ samenvattingUur: -5 }, defaultMeldingen).samenvattingUur, 0);
    assert.equal(valideerMeldingen({ samenvattingUur: 30 }, defaultMeldingen).samenvattingUur, 23);
    assert.equal(valideerMeldingen({ samenvattingUur: 'ochtend' }, defaultMeldingen).samenvattingUur, 8);
  });

  test('samenvattingMinuut wordt geklemd naar 0-59; ontbrekend valt terug op de default', () => {
    assert.equal(valideerMeldingen({ samenvattingMinuut: 45 }, defaultMeldingen).samenvattingMinuut, 45);
    assert.equal(valideerMeldingen({ samenvattingMinuut: 99 }, defaultMeldingen).samenvattingMinuut, 59);
    assert.equal(valideerMeldingen({ samenvattingMinuut: -5 }, defaultMeldingen).samenvattingMinuut, 0);
    // Ontbrekende minuut mag niet als de geldige waarde 0 gelden (Number(null) === 0-valkuil).
    assert.equal(valideerMeldingen({}, { ...defaultMeldingen, samenvattingMinuut: 30 }).samenvattingMinuut, 30);
  });

  test('laatsteSamenvattingDatum blijft behouden, ongeldige waarde wordt null', () => {
    assert.equal(valideerMeldingen({ laatsteSamenvattingDatum: '2026-08-31' }, defaultMeldingen).laatsteSamenvattingDatum, '2026-08-31');
    assert.equal(valideerMeldingen({ laatsteSamenvattingDatum: 12345 }, defaultMeldingen).laatsteSamenvattingDatum, null);
  });

  test('laatstGemeld blijft behouden (geen leegveeg-bug via een leeg standaardobject)', () => {
    const resultaat = valideerMeldingen({ laatstGemeld: { 'rockanje-sportstrand': '2026-08-30' } }, defaultMeldingen);
    assert.deepEqual(resultaat.laatstGemeld, { 'rockanje-sportstrand': '2026-08-30' });
  });

  test('ongeldige laatstGemeld (geen object) valt terug op een lege kaart', () => {
    assert.deepEqual(valideerMeldingen({ laatstGemeld: 'kapot' }, defaultMeldingen).laatstGemeld, {});
    assert.deepEqual(valideerMeldingen({ laatstGemeld: ['a', 'b'] }, defaultMeldingen).laatstGemeld, {});
  });
});

describe('valideerDagvenster', () => {
  const defaultDagvenster = { startUur: 7, eindUur: 21 };

  test('vult ontbrekende velden aan met de default', () => {
    assert.deepEqual(valideerDagvenster({ startUur: 9 }, defaultDagvenster), { startUur: 9, eindUur: 21 });
  });

  test('klemt uren buiten 0-23 vast', () => {
    assert.deepEqual(valideerDagvenster({ startUur: -5, eindUur: 30 }, defaultDagvenster), { startUur: 0, eindUur: 23 });
  });

  test('ongeldige (niet-numerieke) waarden vallen terug op de default', () => {
    assert.deepEqual(valideerDagvenster({ startUur: 'ochtend' }, defaultDagvenster), { startUur: 7, eindUur: 21 });
  });

  test('null/ontbrekend geeft de volledige default terug', () => {
    assert.deepEqual(valideerDagvenster(null, defaultDagvenster), defaultDagvenster);
  });
});

describe('valideerEnVulProfielAan', () => {
  test('null profiel geeft het standaardprofiel (incl. standaard-favorieten) terug', () => {
    const { profiel, fouten } = valideerEnVulProfielAan(null, 'abc-123');
    assert.equal(profiel.gebruikerId, 'abc-123');
    assert.equal(profiel.favorieteLocaties.length, 2);
    assert.equal(fouten.length, 0);
  });

  test('gedeeltelijk profiel wordt aangevuld met defaults, eigen waarden blijven staan', () => {
    const ruw = { drempelwaarden: { windsnelheid: { minimum: 14 } } };
    const { profiel } = valideerEnVulProfielAan(ruw, 'abc-123');
    assert.equal(profiel.drempelwaarden.windsnelheid.minimum, 14);
    // ideaalOnder was niet meegegeven en moet uit de (blanco) defaults komen:
    assert.equal(profiel.drempelwaarden.windsnelheid.ideaalOnder, null);
  });

  test('een expliciet lege favorieten-lijst (bewust verwijderd) blijft leeg, wordt niet aangevuld', () => {
    const { profiel } = valideerEnVulProfielAan({ favorieteLocaties: [] }, 'abc-123');
    assert.deepEqual(profiel.favorieteLocaties, []);
  });

  test('onbekende/vreemde velden worden genegeerd, geen crash', () => {
    const { profiel } = valideerEnVulProfielAan({ nietBestaandVeld: 'x', drempelwaarden: 'geen-object' }, 'abc-123');
    assert.ok(profiel.drempelwaarden.windsnelheid);
  });

  test('ongeldige favoriete locaties worden overgeslagen met een foutmelding, profiel blijft bruikbaar', () => {
    const ruw = {
      favorieteLocaties: [
        { naam: 'Scheveningen', lat: 52.1, lon: 4.28 },
        { naam: 'Ongeldig', lat: 999, lon: 4.28 },
      ],
    };
    const { profiel, fouten } = valideerEnVulProfielAan(ruw, 'abc-123');
    assert.equal(profiel.favorieteLocaties.length, 1);
    assert.equal(profiel.favorieteLocaties[0].naam, 'Scheveningen');
    assert.ok(fouten.some((f) => f.includes('Ongeldig')));
  });

  test('databronnen worden aangevuld met defaults als ze ontbreken', () => {
    const { profiel } = valideerEnVulProfielAan({ databronnen: { rws: false } }, 'abc-123');
    assert.deepEqual(profiel.databronnen, { openMeteo: true, buienradar: true, weerlive: true, rws: false, windfinder: true, knmi: true });
  });

  test('telegramChatId blijft staan als die eerder door de bot gekoppeld is', () => {
    const { profiel } = valideerEnVulProfielAan({ telegramChatId: 123456789 }, 'abc-123');
    assert.equal(profiel.telegramChatId, 123456789);
  });

  test('aangepast dagvenster blijft staan, ontbrekend veld valt terug op de default', () => {
    const { profiel } = valideerEnVulProfielAan({ dagvenster: { startUur: 6 } }, 'abc-123');
    assert.deepEqual(profiel.dagvenster, { startUur: 6, eindUur: 20 });
  });

  test('profiel dat geen object is valt terug op het standaardprofiel', () => {
    const { profiel, fouten } = valideerEnVulProfielAan('kapotte-data', 'abc-123');
    assert.equal(profiel.gebruikerId, 'abc-123');
    assert.ok(fouten.length > 0);
  });
});

describe('valideerLocatie', () => {
  test('geldige locatie met windrichting-ranges', () => {
    const { locatie, fouten } = valideerLocatie({
      naam: 'Brouwersdam',
      lat: 51.75,
      lon: 3.85,
      windrichting: { besteRanges: [[220, 280]], acceptabeleRanges: [] },
    });
    assert.equal(fouten.length, 0);
    assert.equal(locatie.naam, 'Brouwersdam');
    assert.deepEqual(locatie.windrichting.besteRanges, [[220, 280]]);
  });

  test('ontbrekende naam en ongeldige coördinaten geven meerdere foutmeldingen', () => {
    const { locatie, fouten } = valideerLocatie({ naam: '  ', lat: 200, lon: 4 });
    assert.equal(locatie, null);
    assert.equal(fouten.length, 2);
  });
});

describe('voegFavorieteLocatieToe / verwijderFavorieteLocatie', () => {
  test('voegt toe zonder het origineel te muteren (pure functie)', () => {
    const profiel = standaardProfiel('abc-123');
    const aantalVoor = profiel.favorieteLocaties.length;
    const { profiel: nieuw } = voegFavorieteLocatieToe(profiel, { naam: 'IJburg', lat: 52.35, lon: 5.0 });
    assert.equal(profiel.favorieteLocaties.length, aantalVoor);
    assert.equal(nieuw.favorieteLocaties.length, aantalVoor + 1);
  });

  test('weigert een dubbele locatie', () => {
    const profiel = standaardProfiel('abc-123');
    const { profiel: eenmaal } = voegFavorieteLocatieToe(profiel, { naam: 'IJburg', lat: 52.35, lon: 5.0 });
    const { profiel: tweemaal, fouten } = voegFavorieteLocatieToe(eenmaal, { naam: 'IJburg', lat: 52.35, lon: 5.0 });
    assert.equal(tweemaal.favorieteLocaties.length, eenmaal.favorieteLocaties.length);
    assert.ok(fouten.length > 0);
  });

  test('verwijdert op id', () => {
    const profiel = standaardProfiel('abc-123');
    const aantalVoor = profiel.favorieteLocaties.length;
    const { profiel: metLocatie } = voegFavorieteLocatieToe(profiel, { naam: 'IJburg', lat: 52.35, lon: 5.0 });
    const nieuweId = metLocatie.favorieteLocaties[metLocatie.favorieteLocaties.length - 1].id;
    const zonder = verwijderFavorieteLocatie(metLocatie, nieuweId);
    assert.equal(zonder.favorieteLocaties.length, aantalVoor);
  });
});
