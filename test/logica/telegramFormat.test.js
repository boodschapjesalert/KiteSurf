const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatDatumKort,
  formatKleurEmoji,
  kleurNaarNl,
  formatWindTekst,
  formatWeerTekst,
  formatGetijTekst,
  formatZonsondergangTekst,
  formatDagBalkTekst,
} = require('../../src/logica/telegramFormat');

describe('formatDatumKort', () => {
  test('geeft "ma 31 aug"-stijl, onafhankelijk van de lokale tijdzone van de machine', () => {
    // 31-08-2026 is een maandag.
    assert.equal(formatDatumKort('2026-08-31'), 'ma 31 aug');
  });

  test('werkt ook rond een maandwissel', () => {
    // 01-09-2026 is een dinsdag.
    assert.equal(formatDatumKort('2026-09-01'), 'di 1 sep');
  });
});

describe('formatKleurEmoji / kleurNaarNl', () => {
  test('bekende kleuren', () => {
    assert.equal(formatKleurEmoji('groen'), '🟢');
    assert.equal(formatKleurEmoji('oranje'), '🟠');
    assert.equal(formatKleurEmoji('rood'), '🔴');
    assert.equal(kleurNaarNl('groen'), 'Goed');
    assert.equal(kleurNaarNl('rood'), 'Niet geschikt');
  });

  test('onbekende kleur crasht niet', () => {
    assert.equal(formatKleurEmoji('paars'), '⚪');
    assert.equal(kleurNaarNl('paars'), 'paars');
  });
});

describe('formatWindTekst', () => {
  test('volledige gegevens', () => {
    assert.equal(
      formatWindTekst({ windKnopen: 18.4, windrichtingGraden: 247, windvlaagKnopen: 21.2 }),
      '18 kn uit WZW (vlagen 21 kn)'
    );
  });

  test('zonder vlaag valt dat deel weg', () => {
    assert.equal(formatWindTekst({ windKnopen: 18, windrichtingGraden: 247 }), '18 kn uit WZW');
  });

  test('geen data geeft null', () => {
    assert.equal(formatWindTekst(null), null);
    assert.equal(formatWindTekst({}), null);
  });
});

describe('formatWeerTekst', () => {
  test('onweer overrulet neerslagkans en bewolking', () => {
    assert.equal(formatWeerTekst({ onweerAanwezig: true, neerslagKans: 0.9, bewolkingPercent: 100 }), '⛈️ onweer');
  });

  test('hoge neerslagkans zonder onweer', () => {
    assert.equal(formatWeerTekst({ neerslagKans: 0.4 }), '🌧️ 40% regenkans');
  });

  test('lage neerslagkans valt terug op bewolking', () => {
    assert.equal(formatWeerTekst({ neerslagKans: 0.1, bewolkingPercent: 10 }), '☀️ 10% bewolking');
    assert.equal(formatWeerTekst({ neerslagKans: 0.1, bewolkingPercent: 90 }), '☁️ 90% bewolking');
  });

  test('niets bekend geeft null', () => {
    assert.equal(formatWeerTekst({}), null);
  });
});

describe('formatGetijTekst', () => {
  test('hoog/laag met waterstand', () => {
    assert.equal(formatGetijTekst({ getijStatus: 'hoog', waterstandCm: 109.4 }), '🌊↑ 109cm');
    assert.equal(formatGetijTekst({ getijStatus: 'laag', waterstandCm: 34 }), '🌊↓ 34cm');
  });

  test('geen getij-data geeft null', () => {
    assert.equal(formatGetijTekst({}), null);
    assert.equal(formatGetijTekst(null), null);
  });
});

describe('formatZonsondergangTekst', () => {
  test('formatteert naar HH:mm', () => {
    const iso = new Date(2026, 7, 31, 20, 35).toISOString();
    assert.equal(formatZonsondergangTekst(iso), '🌇 20:35');
  });

  test('ontbrekend geeft null', () => {
    assert.equal(formatZonsondergangTekst(null), null);
  });
});

describe('formatDagBalkTekst', () => {
  const locatie = { naam: 'Rockanje Sportstrand' };

  function dagOordeel(overrides) {
    return Object.assign(
      {
        datum: '2026-08-31',
        zonsondergang: null,
        samenvatting: 'Tussen 09:00 en 18:00 lijkt de wind goed (14-24 kn).',
        dagScore: {
          kleur: 'groen',
          score: 9.3,
          besteUur: { ruw: { windKnopen: 18, windrichtingGraden: 247, windvlaagKnopen: 21 } },
        },
      },
      overrides
    );
  }

  test('bevat kleur, locatie, dag-label, datum, verdict, score en de samenvattingszin', () => {
    const tekst = formatDagBalkTekst(locatie, dagOordeel(), ['Vandaag', 'Morgen', 'Overmorgen'], 0);
    assert.match(tekst, /^🟢 📍 Rockanje Sportstrand — Vandaag \(ma 31 aug\)\nGoed \(9\.3\/10\)/);
    assert.match(tekst, /• 💨 18 kn uit WZW \(vlagen 21 kn\)/);
    assert.match(tekst, /\n\nTussen 09:00 en 18:00 lijkt de wind goed/);
  });

  test('vanaf de 5e dag staat er "indicatief" bij het oordeel, eerder niet', () => {
    assert.doesNotMatch(formatDagBalkTekst(locatie, dagOordeel(), null, 3), /indicatief/);
    assert.match(formatDagBalkTekst(locatie, dagOordeel(), null, 4), /Goed \(9\.3\/10\) · indicatief\n/);
    assert.doesNotMatch(formatDagBalkTekst(locatie, dagOordeel()), /indicatief/);
  });

  test('zonder dagLabels valt het label terug op de datum zelf', () => {
    const tekst = formatDagBalkTekst(locatie, dagOordeel(), null, 0);
    assert.match(tekst, /— ma 31 aug \(ma 31 aug\)\n/);
  });

  test('een dag zonder besteUur (harde no-go) laat de detailregel gewoon weg, geen crash', () => {
    const tekst = formatDagBalkTekst(locatie, dagOordeel({ dagScore: { kleur: 'rood', score: 0, besteUur: null }, samenvatting: 'Vandaag geen geschikt moment om te kiten.' }));
    assert.match(tekst, /🔴 📍 Rockanje Sportstrand/);
    assert.match(tekst, /Vandaag geen geschikt moment om te kiten\./);
  });
});
