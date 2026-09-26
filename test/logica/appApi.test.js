const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAppStilUur,
  normaliseerAppProfiel,
  bouwVergelijking,
  bepaalAppMeldingen,
  verwerkAppVerzoek,
} = require('../../src/logica/appApi');
const { standaardProfiel } = require('../../src/logica/profielValidatie');
const { oordeelSleutel } = require('../../src/logica/appCache');

function dag(datum, kleur, score, samenvatting) {
  return {
    datum,
    dagScore: {
      kleur,
      score,
      besteUur: { ruw: { windKnopen: 18.4, windrichtingGraden: 225, windvlaagKnopen: 23.6 } },
    },
    samenvatting: samenvatting || null,
  };
}

const ROCKANJE = { id: 'rockanje', naam: 'Rockanje' };
const SLUFTER = { id: 'slufter', naam: 'Slufter' };
const ALLES_AAN = { dagelijkseSamenvatting: true, samenvattingUur: 8, samenvattingMinuut: 0, directeAlert: true };

describe('isAppStilUur', () => {
  test('22:30-07:00 is nachtrust, overspant middernacht', () => {
    assert.equal(isAppStilUur(22 * 60 + 29), false);
    assert.equal(isAppStilUur(22 * 60 + 30), true);
    assert.equal(isAppStilUur(3 * 60), true);
    assert.equal(isAppStilUur(7 * 60 - 1), true);
    assert.equal(isAppStilUur(7 * 60), false);
  });
});

describe('normaliseerAppProfiel', () => {
  test('geen object: null', () => {
    assert.equal(normaliseerAppProfiel(null), null);
    assert.equal(normaliseerAppProfiel('x'), null);
    assert.equal(normaliseerAppProfiel([]), null);
  });

  test('vult een onvolledig profiel aan met defaults', () => {
    const profiel = normaliseerAppProfiel({ dagenVooruit: 99, favorieteLocaties: [] });
    assert.equal(profiel.dagenVooruit, 10);
    assert.deepEqual(profiel.favorieteLocaties, []);
    assert.equal(profiel.meldingen.samenvattingUur, 8);
  });
});

describe('bepaalAppMeldingen — dagelijkse samenvatting', () => {
  const locaties = [
    { locatie: ROCKANJE, dagOordelen: [dag('2026-09-26', 'groen', 8, 'Tussen 09:00 en 18:00 lijkt de wind goed.'), dag('2026-09-27', 'rood', 2)] },
    { locatie: SLUFTER, dagOordelen: [dag('2026-09-26', 'oranje', 5)] },
  ];

  test('op het gekozen tijdstip: één melding per locatie, en vandaag afgevinkt', () => {
    const r = bepaalAppMeldingen({
      locaties,
      instellingen: { ...ALLES_AAN, directeAlert: false },
      status: {},
      vandaag: '2026-09-26',
      minutenNu: 8 * 60 + 5,
    });
    assert.equal(r.meldingen.length, 2);
    assert.equal(r.meldingen[0].soort, 'samenvatting');
    assert.equal(r.meldingen[0].titel, '📅 Rockanje');
    assert.match(r.meldingen[0].tekst, /🟢 Vandaag \(za 26 sep\): Goed 8\/10 · 18 kn uit ZW \(vlagen 24 kn\)/);
    assert.match(r.meldingen[0].tekst, /🔴 Morgen \(zo 27 sep\): Niet geschikt 2\/10/);
    assert.match(r.meldingen[0].tekst, /Tussen 09:00 en 18:00 lijkt de wind goed\./);
    assert.equal(r.status.laatsteSamenvattingDatum, '2026-09-26');
  });

  test('vóór het gekozen tijdstip, of al verstuurd vandaag: niets', () => {
    const basis = { locaties, instellingen: ALLES_AAN, vandaag: '2026-09-26' };
    assert.equal(bepaalAppMeldingen({ ...basis, status: {}, minutenNu: 7 * 60 + 59 }).meldingen.filter((m) => m.soort === 'samenvatting').length, 0);
    const alGedaan = bepaalAppMeldingen({ ...basis, status: { laatsteSamenvattingDatum: '2026-09-26' }, minutenNu: 9 * 60 });
    assert.equal(alGedaan.meldingen.filter((m) => m.soort === 'samenvatting').length, 0);
  });

  test('ruim na het gekozen tijdstip (telefoon lag uit): overslaan i.p.v. alsnog sturen', () => {
    const r = bepaalAppMeldingen({ locaties, instellingen: ALLES_AAN, status: {}, vandaag: '2026-09-26', minutenNu: 15 * 60 });
    assert.equal(r.meldingen.filter((m) => m.soort === 'samenvatting').length, 0);
    assert.equal(r.status.laatsteSamenvattingDatum, null);
  });

  test('ophalen overal mislukt: niet afvinken, volgende controle probeert opnieuw', () => {
    const r = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: null }],
      instellingen: ALLES_AAN,
      status: {},
      vandaag: '2026-09-26',
      minutenNu: 8 * 60,
    });
    assert.equal(r.meldingen.length, 0);
    assert.equal(r.status.laatsteSamenvattingDatum, null);
  });
});

describe('bepaalAppMeldingen — directe alert', () => {
  const instellingen = { ...ALLES_AAN, dagelijkseSamenvatting: false };

  test('nieuwe groene dag: alert + datum onthouden', () => {
    const r = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-26', 'oranje', 5), dag('2026-09-27', 'groen', 8, 'Goed.')] }],
      instellingen,
      status: {},
      vandaag: '2026-09-26',
      minutenNu: 12 * 60,
    });
    assert.equal(r.meldingen.length, 1);
    assert.equal(r.meldingen[0].soort, 'alert');
    assert.equal(r.meldingen[0].datum, '2026-09-27');
    assert.equal(r.meldingen[0].titel, '⚡ Kitesurf alert — Rockanje');
    assert.match(r.meldingen[0].tekst, /^Morgen \(zo 27 sep\): Goed 8\/10/);
    assert.deepEqual(r.status.laatstGemeld, { rockanje: { '2026-09-27': true } });
  });

  test('al gemelde datum: geen herhaling, ook niet na tussentijds terugzakken naar oranje', () => {
    const status = { laatstGemeld: { rockanje: { '2026-09-27': true } } };
    const tussendoorOranje = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-27', 'oranje', 5)] }],
      instellingen, status, vandaag: '2026-09-26', minutenNu: 12 * 60,
    });
    assert.deepEqual(tussendoorOranje.status.laatstGemeld, { rockanje: { '2026-09-27': true } });
    const weerGroen = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-27', 'groen', 8)] }],
      instellingen, status: tussendoorOranje.status, vandaag: '2026-09-26', minutenNu: 13 * 60,
    });
    assert.equal(weerGroen.meldingen.length, 0);
  });

  test('nachtrust: niets melden en niets vastleggen (na 07:00 alsnog)', () => {
    const locaties = [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-27', 'groen', 8)] }];
    const nacht = bepaalAppMeldingen({ locaties, instellingen, status: {}, vandaag: '2026-09-26', minutenNu: 23 * 60 });
    assert.equal(nacht.meldingen.length, 0);
    assert.deepEqual(nacht.status.laatstGemeld, { rockanje: {} });
    const ochtend = bepaalAppMeldingen({ locaties, instellingen, status: nacht.status, vandaag: '2026-09-27', minutenNu: 7 * 60 });
    assert.equal(ochtend.meldingen.length, 1);
  });

  test('datums in het verleden vallen uit de historie', () => {
    const r = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-27', 'oranje', 5)] }],
      instellingen,
      status: { laatstGemeld: { rockanje: { '2026-09-20': true, '2026-09-27': true } } },
      vandaag: '2026-09-27',
      minutenNu: 12 * 60,
    });
    assert.deepEqual(r.status.laatstGemeld, { rockanje: { '2026-09-27': true } });
  });

  test('ophalen mislukt voor een locatie: historie blijft ongewijzigd', () => {
    const r = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: null }],
      instellingen,
      status: { laatstGemeld: { rockanje: { '2026-09-27': true } } },
      vandaag: '2026-09-26',
      minutenNu: 12 * 60,
    });
    assert.deepEqual(r.status.laatstGemeld, { rockanje: { '2026-09-27': true } });
  });

  test('alert uit: groen wordt niet als gemeld vastgelegd', () => {
    const r = bepaalAppMeldingen({
      locaties: [{ locatie: ROCKANJE, dagOordelen: [dag('2026-09-27', 'groen', 8)] }],
      instellingen: { ...instellingen, directeAlert: false },
      status: {},
      vandaag: '2026-09-26',
      minutenNu: 12 * 60,
    });
    assert.equal(r.meldingen.length, 0);
    assert.deepEqual(r.status.laatstGemeld, { rockanje: {} });
  });
});

describe('bouwVergelijking', () => {
  test('vandaag per favoriet, met een fout-rij bij een mislukte locatie', () => {
    const profiel = standaardProfiel(null);
    const r = bouwVergelijking(profiel, (p, locatie) => {
      if (locatie.id === 'maasvlakte-2-slufter') throw new Error('bron plat');
      return [dag('2026-09-26', 'groen', 8)];
    });
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], {
      locatieId: 'rockanje-sportstrand',
      naam: 'Rockanje Sportstrand',
      kleur: 'groen',
      score: 8,
      ruw: { windKnopen: 18.4, windrichtingGraden: 225, windvlaagKnopen: 23.6 },
    });
    assert.equal(r[1].fout, 'Kon weerdata niet ophalen');
  });
});

describe('verwerkAppVerzoek', () => {
  function maakDiensten(overschrijf) {
    const aanroepen = [];
    const diensten = {
      dagOordelen: (profiel, locatie, dagen) => {
        aanroepen.push({ fn: 'dagOordelen', locatie: locatie.id, dagen });
        return [dag('2026-09-26', 'groen', 8, 'Goed.')];
      },
      widget: (profiel, locatie) => ({ spotnaam: locatie.naam, kleur: 'groen' }),
      zoekLocatie: (term) => [{ naam: 'Zoek: ' + term, lat: 1, lon: 2 }],
      deelLink: () => ({ url: 'https://voorbeeld/exec?id=x' }),
      nu: () => ({ vandaag: '2026-09-26', minutenNu: 12 * 60 }),
      ...overschrijf,
    };
    return { diensten, aanroepen };
  }

  test('onbekende actie of geen object: fout', () => {
    const { diensten } = maakDiensten();
    assert.ok(verwerkAppVerzoek(null, diensten).fout);
    assert.ok(verwerkAppVerzoek({ actie: 'saveProfiel' }, diensten).fout);
  });

  test('zoekLocatie en deelLink hebben geen profiel nodig', () => {
    const { diensten } = maakDiensten();
    assert.deepEqual(verwerkAppVerzoek({ actie: 'zoekLocatie', zoekterm: 'Rockanje' }, diensten), {
      resultaten: [{ naam: 'Zoek: Rockanje', lat: 1, lon: 2 }],
    });
    assert.deepEqual(verwerkAppVerzoek({ actie: 'deelLink' }, diensten), { url: 'https://voorbeeld/exec?id=x' });
  });

  test('weeroordeel en weeroordelen geven de cachesleutel mee (zelfde als appCache.oordeelSleutel)', () => {
    const { diensten } = maakDiensten();
    const profiel = normaliseerAppProfiel(standaardProfiel());
    const locatie = profiel.favorieteLocaties[0];
    const enkel = verwerkAppVerzoek({ actie: 'weeroordeel', profiel, locatie }, diensten);
    assert.equal(enkel.sleutel, oordeelSleutel(profiel, locatie));
    const batch = verwerkAppVerzoek({ actie: 'weeroordelen', profiel, locaties: [locatie] }, diensten);
    assert.equal(batch.resultaten[0].sleutel, enkel.sleutel);
  });

  test('weeroordelen: standaard alle favorieten, fout per locatie stopt de rest niet', () => {
    const { diensten, aanroepen } = maakDiensten({
      dagOordelen: (profiel, locatie) => {
        if (locatie.id === 'kapot') throw new Error('bron plat');
        return [dag('2026-09-26', 'groen', 8)];
      },
    });
    const profiel = normaliseerAppProfiel(standaardProfiel());
    const alle = verwerkAppVerzoek({ actie: 'weeroordelen', profiel }, diensten);
    assert.deepEqual(alle.resultaten.map((r) => r.locatieId), profiel.favorieteLocaties.map((l) => l.id));
    assert.ok(alle.resultaten.every((r) => r.dagen.length === 1));

    const gemengd = verwerkAppVerzoek({
      actie: 'weeroordelen',
      profiel,
      locaties: [{ id: 'kapot', naam: 'Kapot', lat: 52, lon: 4 }, { naam: 'x', lat: 999, lon: 4 }, { id: 'goed', naam: 'Goed', lat: 51.9, lon: 4.1 }],
    }, diensten);
    assert.equal(gemengd.resultaten[0].fout, 'Kon weerdata niet ophalen');
    assert.match(gemengd.resultaten[1].fout, /Ongeldige locatie/);
    assert.equal(gemengd.resultaten[2].locatieId, 'goed');
    assert.equal(gemengd.resultaten[2].dagen.length, 1);
    assert.equal(aanroepen.length, 0);
  });

  test('achtergrond met metOordelen: oordelen per favoriet, één berekening gedeeld met de meldingen', () => {
    const { diensten, aanroepen } = maakDiensten();
    const profiel = normaliseerAppProfiel(Object.assign(standaardProfiel(), { meldingen: ALLES_AAN }));
    const r = verwerkAppVerzoek({ actie: 'achtergrond', profiel, status: {}, metOordelen: true }, diensten);
    assert.equal(r.oordelen.length, profiel.favorieteLocaties.length);
    assert.ok(r.oordelen.every((o) => o.dagen && o.sleutel));
    assert.equal(aanroepen.filter((a) => a.fn === 'dagOordelen').length, profiel.favorieteLocaties.length);

    const zonderVraag = verwerkAppVerzoek({ actie: 'achtergrond', profiel, status: {} }, diensten);
    assert.equal(zonderVraag.oordelen, undefined);

    const meldingenUit = normaliseerAppProfiel(standaardProfiel());
    meldingenUit.meldingen.dagelijkseSamenvatting = false;
    meldingenUit.meldingen.directeAlert = false;
    const r2 = verwerkAppVerzoek({ actie: 'achtergrond', profiel: meldingenUit, metOordelen: true }, diensten);
    assert.equal(r2.oordelen.length, meldingenUit.favorieteLocaties.length);
    assert.deepEqual(r2.meldingen, []);
  });

  test('weeroordeel: profiel verplicht, locatie gevalideerd, horizon uit het profiel', () => {
    const { diensten, aanroepen } = maakDiensten();
    assert.ok(verwerkAppVerzoek({ actie: 'weeroordeel', locatie: { naam: 'x', lat: 1, lon: 2 } }, diensten).fout);
    assert.match(
      verwerkAppVerzoek({ actie: 'weeroordeel', profiel: {}, locatie: { naam: 'x', lat: 999, lon: 2 } }, diensten).fout,
      /Ongeldige locatie/
    );
    const r = verwerkAppVerzoek(
      { actie: 'weeroordeel', profiel: { dagenVooruit: 5 }, locatie: { id: 'eigen', naam: 'Eigen spot', lat: 52, lon: 4 } },
      diensten
    );
    assert.equal(r.dagen.length, 1);
    assert.deepEqual(aanroepen, [{ fn: 'dagOordelen', locatie: 'eigen', dagen: 5 }]);
  });

  test('vergelijk: alle favorieten uit het meegestuurde profiel', () => {
    const { diensten } = maakDiensten();
    const r = verwerkAppVerzoek({ actie: 'vergelijk', profiel: { favorieteLocaties: [{ id: 'a', naam: 'A', lat: 52, lon: 4 }] } }, diensten);
    assert.equal(r.locaties.length, 1);
    assert.equal(r.locaties[0].locatieId, 'a');
  });

  test('achtergrond: widget van de gekozen (of eerste) favoriet + meldingen + nieuwe status', () => {
    const { diensten } = maakDiensten();
    const profiel = {
      favorieteLocaties: [
        { id: 'a', naam: 'A', lat: 52, lon: 4 },
        { id: 'b', naam: 'B', lat: 52, lon: 4 },
      ],
      meldingen: { dagelijkseSamenvatting: false, directeAlert: true },
    };
    const r = verwerkAppVerzoek({ actie: 'achtergrond', profiel, widgetLocatieId: 'b', status: {} }, diensten);
    assert.equal(r.widget.spotnaam, 'B');
    assert.equal(r.meldingen.length, 2); // A en B allebei vandaag voor het eerst groen
    assert.deepEqual(r.status.laatstGemeld, { a: { '2026-09-26': true }, b: { '2026-09-26': true } });

    const zonderKeuze = verwerkAppVerzoek({ actie: 'achtergrond', profiel, status: r.status }, diensten);
    assert.equal(zonderKeuze.widget.spotnaam, 'A');
    assert.equal(zonderKeuze.meldingen.length, 0);
  });

  test('achtergrond met meldingen uit: geen weerdata voor meldingen, status ongemoeid', () => {
    const { diensten, aanroepen } = maakDiensten();
    const status = { laatstGemeld: { a: { '2026-09-26': true } }, laatsteSamenvattingDatum: '2026-09-25' };
    const r = verwerkAppVerzoek({
      actie: 'achtergrond',
      profiel: { favorieteLocaties: [{ id: 'a', naam: 'A', lat: 52, lon: 4 }], meldingen: { dagelijkseSamenvatting: false, directeAlert: false } },
      status,
    }, diensten);
    assert.deepEqual(r.meldingen, []);
    assert.deepEqual(r.status, status);
    assert.equal(aanroepen.length, 0);
  });

  test('achtergrond: een haperende widget-berekening laat de meldingen niet vallen', () => {
    const { diensten } = maakDiensten({ widget: () => { throw new Error('plat'); } });
    const r = verwerkAppVerzoek({
      actie: 'achtergrond',
      profiel: { favorieteLocaties: [{ id: 'a', naam: 'A', lat: 52, lon: 4 }], meldingen: { directeAlert: true, dagelijkseSamenvatting: false } },
    }, diensten);
    assert.equal(r.widget.fout, 'Kon weerdata niet ophalen');
    assert.equal(r.meldingen.length, 1);
  });

  test('achtergrond zonder favorieten', () => {
    const { diensten } = maakDiensten();
    const r = verwerkAppVerzoek({ actie: 'achtergrond', profiel: { favorieteLocaties: [] } }, diensten);
    assert.equal(r.widget.fout, 'Geen favoriete locaties');
  });
});
