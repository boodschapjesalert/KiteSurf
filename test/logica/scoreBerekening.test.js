const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  berekenUurScore,
  berekenDagScore,
  scoreNaarKleur,
  vindBesteVenster,
  berekenLangdurigeRegenVlaggen,
  normaliseerGewichten,
  GEWICHTEN,
} = require('../../src/logica/scoreBerekening');
const { standaardDrempelwaarden } = require('../../src/logica/drempelwaarden');

// standaardDrempelwaarden() start bewust blanco (zie README.md "Aannames") — deze tests testen
// de score-logica zelf, dus die vullen we hier expliciet met concrete testwaarden.
const instellingenMetGoedeRichting = {
  windsnelheid: { minimum: 11, ideaalOnder: 18, ideaalBoven: 24, maximum: null },
  windvlagen: { waarschuwingVlaagfactor: 0.3, maxVlaagfactor: 0.5 },
  windrichting: { besteRanges: [[200, 260]], acceptabeleRanges: [[260, 300]] },
  watertemperatuur: { minimumComfortabel: 19, minimumMetWetsuit: 9 },
};

describe('scoreNaarKleur', () => {
  test('grenzen exact volgens criteria-kiteweer-app.md', () => {
    assert.equal(scoreNaarKleur(8), 'groen');
    assert.equal(scoreNaarKleur(7.9), 'oranje');
    assert.equal(scoreNaarKleur(5), 'oranje');
    assert.equal(scoreNaarKleur(4.9), 'rood');
  });
});

describe('berekenUurScore', () => {
  test('ideale condities geven een hoge score en groen', () => {
    const r = berekenUurScore(
      {
        windKnopen: 20,
        windvlaagKnopen: 23,
        windrichtingGraden: 230,
        onweerAanwezig: false,
        neerslagKans: 0.05,
        luchttemperatuurCelsius: 20,
        watertemperatuurCelsius: 20,
        golfhoogteMeter: 0.4,
        zichtKm: 10,
      },
      instellingenMetGoedeRichting
    );
    assert.equal(r.noGo, false);
    assert.equal(r.kleur, 'groen');
    assert.ok(r.score >= 8);
  });

  test('onweer overrulet alles: score 0, rood, ongeacht de rest', () => {
    const r = berekenUurScore(
      {
        windKnopen: 20,
        windvlaagKnopen: 21,
        windrichtingGraden: 230,
        onweerAanwezig: true,
      },
      instellingenMetGoedeRichting
    );
    assert.equal(r.noGo, true);
    assert.equal(r.kleur, 'rood');
    assert.equal(r.score, 0);
    assert.ok(r.redenen.some((x) => x.variabele === 'onweer'));
  });

  test('te weinig wind is een no-go, ook al is de rest perfect', () => {
    const r = berekenUurScore(
      { windKnopen: 5, windvlaagKnopen: 6, windrichtingGraden: 230 },
      instellingenMetGoedeRichting
    );
    assert.equal(r.noGo, true);
    assert.ok(r.redenen.some((x) => x.variabele === 'windsnelheid'));
  });

  test('offshore wind is een no-go, ook al is de windsnelheid perfect', () => {
    const r = berekenUurScore(
      { windKnopen: 20, windvlaagKnopen: 21, windrichtingGraden: 90 },
      instellingenMetGoedeRichting
    );
    assert.equal(r.noGo, true);
    assert.ok(r.redenen.some((x) => x.variabele === 'windrichting'));
  });

  test('matige nice-to-haves verlagen de score maar veroorzaken geen no-go', () => {
    const goed = berekenUurScore(
      { windKnopen: 20, windvlaagKnopen: 21, windrichtingGraden: 230, watertemperatuurCelsius: 20 },
      instellingenMetGoedeRichting
    );
    const koud = berekenUurScore(
      { windKnopen: 20, windvlaagKnopen: 21, windrichtingGraden: 230, watertemperatuurCelsius: 3 },
      instellingenMetGoedeRichting
    );
    assert.equal(koud.noGo, false);
    assert.ok(koud.score < goed.score);
  });

  test('een vers (blanco) profiel geeft overal neutrale scores, geen valse no-go en geen crash', () => {
    const r = berekenUurScore(
      { windKnopen: 3, windvlaagKnopen: 20, windrichtingGraden: 90 }, // zou zonder config een no-go lijken
      standaardDrempelwaarden()
    );
    assert.equal(r.noGo, false);
    assert.ok(r.score > 0); // neutrale (0.5) deelscores, geen bestraffing voor ontbrekende config
  });
});

describe('berekenDagScore', () => {
  test('kiest het beste uur binnen het daglichtvenster als dagoordeel', () => {
    const uren = [
      { tijdstip: '2026-08-29T03:00', uurData: { windKnopen: 25, windvlaagKnopen: 26, windrichtingGraden: 230 } }, // nacht, buiten venster
      { tijdstip: '2026-08-29T12:00', uurData: { windKnopen: 5, windvlaagKnopen: 6, windrichtingGraden: 230 } }, // no-go
      { tijdstip: '2026-08-29T15:00', uurData: { windKnopen: 20, windvlaagKnopen: 22, windrichtingGraden: 230 } }, // goed
    ];
    const r = berekenDagScore(uren, instellingenMetGoedeRichting);
    assert.equal(r.noGo, false);
    assert.equal(r.besteUur.tijdstip, '2026-08-29T15:00');
  });

  test('elk uurresultaat bevat de rauwe wind-, getij- en weerwaarden (los van de afgeleide evaluatie), voor een directe visuele weergave', () => {
    const uren = [
      {
        tijdstip: '2026-08-29T15:00',
        uurData: {
          windKnopen: 20, windvlaagKnopen: 22, windrichtingGraden: 230, getijStatus: 'hoog', waterstandCm: 145,
          luchttemperatuurCelsius: 19, onweerAanwezig: false, neerslagKans: 0.1, neerslagMm: 1.4, bewolkingPercent: 40,
        },
      },
    ];
    const r = berekenDagScore(uren, instellingenMetGoedeRichting);
    assert.deepEqual(r.besteUur.ruw, {
      windKnopen: 20,
      windvlaagKnopen: 22,
      windrichtingGraden: 230,
      getijStatus: 'hoog',
      waterstandCm: 145,
      luchttemperatuurCelsius: 19,
      onweerAanwezig: false,
      neerslagKans: 0.1,
      neerslagMm: 1.4,
      bewolkingPercent: 40,
    });
  });

  test('als alle uren no-go zijn, is de dag rood', () => {
    const uren = [
      { tijdstip: '2026-08-29T12:00', uurData: { windKnopen: 5, windvlaagKnopen: 5, windrichtingGraden: 230 } },
    ];
    const r = berekenDagScore(uren, instellingenMetGoedeRichting);
    assert.equal(r.noGo, true);
    assert.equal(r.kleur, 'rood');
  });

  test('lege dag geeft een veilige rode default i.p.v. te crashen', () => {
    const r = berekenDagScore([], instellingenMetGoedeRichting);
    assert.equal(r.kleur, 'rood');
    assert.equal(r.besteUur, null);
  });
});

describe('berekenLangdurigeRegenVlaggen', () => {
  function dagMetRegen(mmPerUur) {
    return mmPerUur.map((mm, i) => ({
      tijdstip: '2026-08-30T' + String(9 + i).padStart(2, '0') + ':00',
      uurData: { neerslagMm: mm },
    }));
  }
  const INSTELLING = { minimumUrenAchtereen: 3, minimumMmPerUur: 1 };

  test('niet-geconfigureerd geeft overal false, geen crash', () => {
    const vlaggen = berekenLangdurigeRegenVlaggen(dagMetRegen([5, 5, 5]), standaardDrempelwaarden().langdurigeRegen);
    assert.deepEqual(vlaggen, [false, false, false]);
  });

  test('drie aaneengesloten natte uren worden alle drie gevlagd', () => {
    const vlaggen = berekenLangdurigeRegenVlaggen(dagMetRegen([2, 2, 2, 0]), INSTELLING);
    assert.deepEqual(vlaggen, [true, true, true, false]);
  });

  test('twee natte uren (korter dan de drempel van 3) worden niet gevlagd', () => {
    const vlaggen = berekenLangdurigeRegenVlaggen(dagMetRegen([2, 2, 0, 2, 2]), INSTELLING);
    assert.deepEqual(vlaggen, [false, false, false, false, false]);
  });

  test('een droog uur breekt de reeks af, ook bij regen erna', () => {
    const vlaggen = berekenLangdurigeRegenVlaggen(dagMetRegen([2, 2, 0, 2, 2, 2]), INSTELLING);
    assert.deepEqual(vlaggen, [false, false, false, true, true, true]);
  });

  test('regen onder de mm-drempel telt niet mee als "nat"', () => {
    const vlaggen = berekenLangdurigeRegenVlaggen(dagMetRegen([0.2, 0.2, 0.2]), INSTELLING);
    assert.deepEqual(vlaggen, [false, false, false]);
  });
});

describe('normaliseerGewichten', () => {
  test('zonder invoer geeft de standaard GEWICHTEN terug', () => {
    assert.deepEqual(normaliseerGewichten(undefined), GEWICHTEN);
  });

  test('geeft precies de meegegeven sleutels terug (open set, geen vaste zes meer)', () => {
    // De tabel in de UI bepaalt nu volledig wélke criteria meetellen — een criterium dat niet in
    // de invoer staat, wordt niet meer stilzwijgend met een default aangevuld.
    const r = normaliseerGewichten({ windsnelheid: 0.6, zicht: 0.2 });
    assert.deepEqual(Object.keys(r).sort(), ['windsnelheid', 'zicht']);
    assert.equal(r.windsnelheid, 0.6);
    assert.equal(r.zicht, 0.2);
  });

  test('negeert ongeldige waarden en onbekende sleutels, houdt de rest', () => {
    const r = normaliseerGewichten({ windsnelheid: 0.6, windrichting: -1, getij: 'oeps', nietBestaand: 5 });
    assert.deepEqual(Object.keys(r), ['windsnelheid']);
  });

  test('als er na filtering niets geldigs overblijft, valt het geheel terug op de standaard GEWICHTEN', () => {
    const alNul = Object.fromEntries(Object.keys(GEWICHTEN).map((k) => [k, 0]));
    assert.deepEqual(normaliseerGewichten(alNul), GEWICHTEN);
    assert.deepEqual(normaliseerGewichten({}), GEWICHTEN);
    assert.deepEqual(normaliseerGewichten({ nietBestaand: 5 }), GEWICHTEN);
  });
});

describe('berekenUurScore met instelbare gewichten', () => {
  const instellingen = {
    windsnelheid: { minimum: 11, ideaalOnder: 18, ideaalBoven: 24, maximum: null },
    windrichting: { besteRanges: [[200, 260]], acceptabeleRanges: [] },
    windvlagen: { waarschuwingVlaagfactor: 0.3, maxVlaagfactor: 0.5 },
  };
  const data = { windKnopen: 20, windvlaagKnopen: 21, windrichtingGraden: 230 };

  test('gewichten die niet op 1 optellen geven toch een score op de 0-10-schaal (relatieve factoren)', () => {
    // Extreme "factoren" i.p.v. percentages: som is 90, niet 1 — de normalisatie moet dat opvangen.
    const r = berekenUurScore(data, instellingen, { gewichten: { windsnelheid: 90 } });
    assert.ok(r.score >= 0 && r.score <= 10);
  });

  test('een criterium op gewicht 0 telt niet meer mee in de score', () => {
    // Windrichting 250° valt buiten besteRanges maar binnen acceptabeleRanges -> score 0.6, geen
    // no-go. Met windrichting-gewicht 0 mag die 0.6 (i.p.v. het ideaal 1) geen verschil meer maken.
    const instellingenMetAcceptabel = {
      ...instellingen,
      windrichting: { besteRanges: [[200, 240]], acceptabeleRanges: [[240, 260]] },
    };
    const inAcceptabelBereik = { ...data, windrichtingGraden: 250 };
    const inBesteBereik = { ...data, windrichtingGraden: 230 };

    const metVolleGewicht = {
      acceptabel: berekenUurScore(inAcceptabelBereik, instellingenMetAcceptabel).score,
      beste: berekenUurScore(inBesteBereik, instellingenMetAcceptabel).score,
    };
    assert.notEqual(metVolleGewicht.acceptabel, metVolleGewicht.beste); // ter controle: gewicht doet normaal iets

    const gewichtenZonderRichting = { ...GEWICHTEN, windrichting: 0 };
    const zonderGewicht = {
      acceptabel: berekenUurScore(inAcceptabelBereik, instellingenMetAcceptabel, { gewichten: gewichtenZonderRichting }).score,
      beste: berekenUurScore(inBesteBereik, instellingenMetAcceptabel, { gewichten: gewichtenZonderRichting }).score,
    };
    assert.equal(zonderGewicht.acceptabel, zonderGewicht.beste);
  });

  test('default-gewichten (geen extra meegegeven) geven hetzelfde resultaat als expliciet GEWICHTEN', () => {
    const zonderExtra = berekenUurScore(data, instellingen);
    const metExpliciet = berekenUurScore(data, instellingen, { gewichten: GEWICHTEN });
    assert.equal(zonderExtra.score, metExpliciet.score);
  });

  test('een individueel gekozen facultatieve variabele telt niet dubbel mee via "Facultatief"', () => {
    const instellingenMetZicht = { ...instellingen, zicht: { minimum: 5 } };
    const dataMetSlechtZicht = { ...data, zichtKm: 1 }; // ver onder het minimum -> lage zicht-score

    // Alleen "Facultatief" (bevat zicht impliciet, gemiddeld met de andere drie): een slecht
    // zicht wordt afgezwakt door het gemiddelde met temperatuur/golven (die hier neutraal zijn).
    const alleenFacultatief = berekenUurScore(dataMetSlechtZicht, instellingenMetZicht, {
      gewichten: { ...GEWICHTEN },
    });
    // "Zicht" ook individueel toegevoegd met een fors gewicht: mag het totaal verder omlaag
    // trekken (zicht telt nu apart EN blijft weg uit het facultatief-gemiddelde) i.p.v. dat het
    // dezelfde bijdrage twee keer telt.
    const metApartZicht = berekenUurScore(dataMetSlechtZicht, instellingenMetZicht, {
      gewichten: { ...GEWICHTEN, zicht: 0.5 },
    });
    assert.ok(metApartZicht.score < alleenFacultatief.score);

    // Controle dat "zicht" dan niet meer meetelt in het facultatief-gemiddelde: als ALLE vier
    // facultatieve subcriteria apart zijn gekozen, moet Facultatief zelf 0 bijdragen (geen NaN,
    // geen lege-array-deling-door-0).
    const alleVierApart = berekenUurScore(dataMetSlechtZicht, instellingenMetZicht, {
      gewichten: {
        ...GEWICHTEN,
        zicht: 0.1, golfhoogte: 0.1, luchttemperatuur: 0.1, watertemperatuur: 0.1,
      },
    });
    assert.ok(Number.isFinite(alleVierApart.score));
  });
});

describe('vindBesteVenster', () => {
  function u(uurVanDag, score, noGo) {
    return { tijdstip: '2026-08-30T' + String(uurVanDag).padStart(2, '0') + ':00', score, noGo: !!noGo };
  }

  test('kiest het aaneengesloten blok met het hoogste gemiddelde, niet de hoogste losse piek', () => {
    // 10:00 is de hoogste losse piek (9.5) maar staat naast een zwak uur; 13-14 is samen beter.
    const venster = vindBesteVenster([u(9, 3), u(10, 9.5), u(11, 3), u(13, 8), u(14, 8.4)], 2);
    assert.equal(venster.startTijdstip, '2026-08-30T13:00');
    assert.equal(venster.eindTijdstip, '2026-08-30T14:00');
    assert.equal(venster.gemiddeldeScore, 8.2);
  });

  test('slaat blokken over die een no-go-uur bevatten', () => {
    const venster = vindBesteVenster([u(9, 9), u(10, 9, true), u(11, 6), u(12, 6)], 2);
    assert.equal(venster.startTijdstip, '2026-08-30T11:00');
  });

  test('geeft null als geen enkel blok lang genoeg is', () => {
    assert.equal(vindBesteVenster([u(9, 9), u(10, 5, true), u(11, 9)], 2), null);
    assert.equal(vindBesteVenster([u(9, 9)], 2), null);
    assert.equal(vindBesteVenster([], 2), null);
  });

  test('minimaleSessieUren 1 gedraagt zich als het beste losse uur', () => {
    const venster = vindBesteVenster([u(9, 4), u(10, 7), u(11, 5)], 1);
    assert.equal(venster.startTijdstip, '2026-08-30T10:00');
    assert.equal(venster.gemiddeldeScore, 7);
  });
});

describe('berekenDagScore met langdurige regen', () => {
  const instellingen = {
    windsnelheid: { minimum: 12, ideaalOnder: 16, ideaalBoven: 26, maximum: 40 },
    windvlagen: { waarschuwingVlaagfactor: 0.4, maxVlaagfactor: 0.8 },
    windrichting: { besteRanges: [[0, 360]], acceptabeleRanges: [] },
    langdurigeRegen: { minimumUrenAchtereen: 3, minimumMmPerUur: 1 },
  };
  function dag(urenSpec) {
    return urenSpec.map((s) => ({
      tijdstip: '2026-08-30T' + String(s.uur).padStart(2, '0') + ':00',
      uurData: { windKnopen: 20, windvlaagKnopen: 22, windrichtingGraden: 250, neerslagMm: s.mm || 0 },
    }));
  }

  test('een uur binnen een langdurige regenperiode scoort lager dan hetzelfde uur zonder', () => {
    const nat = berekenDagScore(dag([{ uur: 9, mm: 2 }, { uur: 10, mm: 2 }, { uur: 11, mm: 2 }]), instellingen);
    const droog = berekenDagScore(dag([{ uur: 9 }, { uur: 10 }, { uur: 11 }]), instellingen);
    assert.ok(nat.uurResultaten[0].score < droog.uurResultaten[0].score);
  });

  test('twee natte uren (korter dan de drempel) worden niet als langdurig gezien', () => {
    const r = berekenDagScore(dag([{ uur: 9, mm: 2 }, { uur: 10, mm: 2 }]), instellingen);
    assert.equal(r.uurResultaten[0].evaluaties.langdurigeRegen.status, 'geen-langdurige-regen');
  });
});

describe('berekenDagScore met minimale sessieduur', () => {
  const instellingen = {
    windsnelheid: { minimum: 12, ideaalOnder: 16, ideaalBoven: 26, maximum: 40 },
    windvlagen: { waarschuwingVlaagfactor: 0.4, maxVlaagfactor: 0.8 },
    windrichting: { besteRanges: [[0, 360]], acceptabeleRanges: [] },
  };
  function dag(urenSpec) {
    return urenSpec.map((s) => ({
      tijdstip: '2026-08-30T' + String(s.uur).padStart(2, '0') + ':00',
      uurData: { windKnopen: s.wind, windvlaagKnopen: s.wind * 1.2, windrichtingGraden: 250 },
    }));
  }
  const opties = { dagvensterStartUur: 9, dagvensterEindUur: 20, minimaleSessieUren: 2 };

  test('een enkel goed uur telt niet als bruikbare dag', () => {
    const r = berekenDagScore(dag([{ uur: 9, wind: 5 }, { uur: 10, wind: 22 }, { uur: 11, wind: 5 }]), instellingen, opties);
    assert.equal(r.geenSessieMogelijk, true);
    assert.equal(r.score, 0);
    assert.equal(r.kleur, 'rood');
    assert.equal(r.besteVenster, null);
    assert.ok(r.besteUur, 'besteUur blijft gevuld voor de weergave');
  });

  test('twee aaneengesloten goede uren geven wel een dagscore en venster', () => {
    const r = berekenDagScore(dag([{ uur: 9, wind: 20 }, { uur: 10, wind: 22 }, { uur: 11, wind: 5 }]), instellingen, opties);
    assert.equal(r.geenSessieMogelijk, false);
    assert.ok(r.score > 0);
    assert.equal(r.besteVenster.startTijdstip, '2026-08-30T09:00');
    assert.equal(r.besteVenster.aantalUren, 2);
    assert.equal(r.urenInVenster.length, 2);
  });

  test('zonder minimaleSessieUren blijft het oude gedrag (beste losse uur) gelden', () => {
    const r = berekenDagScore(dag([{ uur: 9, wind: 5 }, { uur: 10, wind: 22 }]), instellingen, { dagvensterStartUur: 9, dagvensterEindUur: 20 });
    assert.equal(r.geenSessieMogelijk, false);
    assert.ok(r.score > 0);
  });
});
