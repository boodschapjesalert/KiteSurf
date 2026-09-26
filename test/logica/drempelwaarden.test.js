const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  standaardDrempelwaarden,
  heeftEssentieleConfiguratie,
  normaliseerGraden,
  inGradenBereik,
  evalueerWindsnelheid,
  evalueerWindrichting,
  evalueerWindvlagen,
  evalueerOnweer,
  evalueerLangdurigeRegen,
  evalueerLuchttemperatuur,
  evalueerWatertemperatuur,
  evalueerGolfhoogte,
  evalueerGetij,
  evalueerZicht,
} = require('../../src/logica/drempelwaarden');

// Concrete testwaarden voor de evaluatie-logica zelf — los van standaardDrempelwaarden(), die
// bewust alle tunable drempels op null zet (zie "blanco starten" in README.md "Aannames").
const WINDSNELHEID = { minimum: 11, ideaalOnder: 18, ideaalBoven: 24, maximum: null };
const WINDVLAGEN = { waarschuwingVlaagfactor: 0.3, maxVlaagfactor: 0.5 };
const ONWEER = { hardNoGo: true, neerslagWaarschuwingDrempel: 0.7 };
const LUCHTTEMPERATUUR = { minimumComfortabel: 15 };
const WATERTEMPERATUUR = { minimumComfortabel: 19, minimumMetWetsuit: 9 };
const GOLFHOOGTE = { maximum: 1, voorkeurGolven: false };
const ZICHT = { minimum: 1.5 };

describe('standaardDrempelwaarden', () => {
  test('start volledig blanco (null) op de tunable drempels, behalve onweer.hardNoGo', () => {
    const d = standaardDrempelwaarden();
    assert.equal(d.windsnelheid.minimum, null);
    assert.equal(d.windsnelheid.ideaalOnder, null);
    assert.equal(d.windvlagen.maxVlaagfactor, null);
    assert.equal(d.luchttemperatuur.minimumComfortabel, null);
    assert.equal(d.onweer.hardNoGo, true); // enige bewuste, veilige default
    assert.equal(d.getij.voorkeur, 'geen');
  });
});

describe('evalueerLangdurigeRegen', () => {
  const INSTELLING = { minimumUrenAchtereen: 3, minimumMmPerUur: 1 };

  test('niet-geconfigureerd geeft een neutrale score, geen no-go', () => {
    const r = evalueerLangdurigeRegen(true, standaardDrempelwaarden().langdurigeRegen);
    assert.equal(r.status, 'niet-geconfigureerd');
    assert.equal(r.score, 0.5);
    assert.equal(r.noGo, false);
  });

  test('actief geeft score 0 maar geen no-go — het is een weegfactor, geen blokkade', () => {
    const r = evalueerLangdurigeRegen(true, INSTELLING);
    assert.equal(r.score, 0);
    assert.equal(r.noGo, false);
    assert.equal(r.status, 'langdurige-regen');
  });

  test('niet actief geeft volle score', () => {
    const r = evalueerLangdurigeRegen(false, INSTELLING);
    assert.equal(r.score, 1);
  });
});

describe('heeftEssentieleConfiguratie', () => {
  test('false voor een vers (blanco) profiel', () => {
    assert.equal(heeftEssentieleConfiguratie(standaardDrempelwaarden()), false);
  });

  test('false zolang niet alle essentiële velden zijn ingevuld', () => {
    const deels = { windsnelheid: WINDSNELHEID, windvlagen: { waarschuwingVlaagfactor: 0.3, maxVlaagfactor: null } };
    assert.equal(heeftEssentieleConfiguratie(deels), false);
  });

  test('true zodra windsnelheid én windvlagen volledig zijn ingevuld', () => {
    assert.equal(heeftEssentieleConfiguratie({ windsnelheid: WINDSNELHEID, windvlagen: WINDVLAGEN }), true);
  });
});

describe('evalueerWindsnelheid', () => {
  test('niet-geconfigureerd (blanco drempel) geeft een neutrale score, geen no-go', () => {
    const r = evalueerWindsnelheid(20, standaardDrempelwaarden().windsnelheid);
    assert.equal(r.status, 'niet-geconfigureerd');
    assert.equal(r.noGo, false);
    assert.equal(r.score, 0.5);
  });

  test('onder het minimum is een harde no-go', () => {
    const r = evalueerWindsnelheid(8, WINDSNELHEID);
    assert.equal(r.noGo, true);
    assert.equal(r.score, 0);
  });

  test('binnen het ideale bereik geeft score 1', () => {
    const r = evalueerWindsnelheid(20, WINDSNELHEID);
    assert.equal(r.status, 'ideaal');
    assert.equal(r.score, 1);
  });

  test('tussen minimum en ideaal loopt de score geleidelijk op', () => {
    const laag = evalueerWindsnelheid(12, WINDSNELHEID);
    const hoger = evalueerWindsnelheid(16, WINDSNELHEID);
    assert.ok(laag.score > 0 && laag.score < 1);
    assert.ok(hoger.score > laag.score);
  });

  test('boven een ingesteld maximum is een harde no-go', () => {
    const r = evalueerWindsnelheid(30, { ...WINDSNELHEID, maximum: 28 });
    assert.equal(r.noGo, true);
  });

  test('boven ideaal maar zonder maximum daalt de score geleidelijk, geen no-go', () => {
    const r = evalueerWindsnelheid(28, WINDSNELHEID);
    assert.equal(r.noGo, false);
    assert.ok(r.score < 1);
  });

  test('ontbrekende waarde geeft status onbekend, geen no-go', () => {
    const r = evalueerWindsnelheid(null, WINDSNELHEID);
    assert.equal(r.status, 'onbekend');
    assert.equal(r.noGo, false);
  });
});

describe('normaliseerGraden / inGradenBereik', () => {
  test('normaliseert negatieve en >360 hoeken', () => {
    assert.equal(normaliseerGraden(-10), 350);
    assert.equal(normaliseerGraden(370), 10);
  });

  test('normaal bereik zonder wrap', () => {
    assert.equal(inGradenBereik(180, 170, 190), true);
    assert.equal(inGradenBereik(200, 170, 190), false);
  });

  test('bereik dat over 0/360 heen wikkelt', () => {
    assert.equal(inGradenBereik(350, 340, 20), true);
    assert.equal(inGradenBereik(10, 340, 20), true);
    assert.equal(inGradenBereik(180, 340, 20), false);
  });

  test('een volledige cirkel ([0,360]) accepteert elke richting, niet alleen exact 0°', () => {
    // Zonder de expliciete volle-cirkel-check zou [0,360] normaliseren naar s=0/e=0 en dus
    // alléén 0° matchen — het tegenovergestelde van wat "alle richtingen" moet betekenen.
    assert.equal(inGradenBereik(250, 0, 360), true);
    assert.equal(inGradenBereik(0, 0, 360), true);
    assert.equal(inGradenBereik(359, 0, 360), true);
    assert.equal(inGradenBereik(180, -180, 180), true);
  });

  test('ontbrekende waarden geven false i.p.v. een crash of onterechte match', () => {
    assert.equal(inGradenBereik(null, 0, 90), false);
    assert.equal(inGradenBereik(45, null, 90), false);
  });
});

describe('evalueerWindrichting', () => {
  const instellingen = { besteRanges: [[200, 260]], acceptabeleRanges: [[260, 300]] };

  test('cross-shore (beste) geeft score 1', () => {
    const r = evalueerWindrichting(230, instellingen);
    assert.equal(r.status, 'beste');
    assert.equal(r.score, 1);
  });

  test('onshore (acceptabel) geeft lagere score, geen no-go', () => {
    const r = evalueerWindrichting(280, instellingen);
    assert.equal(r.status, 'acceptabel');
    assert.equal(r.noGo, false);
  });

  test('offshore buiten beide bereiken is een harde no-go', () => {
    const r = evalueerWindrichting(90, instellingen);
    assert.equal(r.noGo, true);
  });

  test('zonder geconfigureerde ranges (nieuwe locatie) is het niet beoordeelbaar, geen no-go', () => {
    const r = evalueerWindrichting(90, { besteRanges: [], acceptabeleRanges: [] });
    assert.equal(r.status, 'niet-geconfigureerd');
    assert.equal(r.noGo, false);
  });
});

describe('evalueerWindvlagen', () => {
  test('niet-geconfigureerd (blanco drempel) geeft een neutrale score, geen no-go', () => {
    const r = evalueerWindvlagen(20, 28, standaardDrempelwaarden().windvlagen);
    assert.equal(r.status, 'niet-geconfigureerd');
    assert.equal(r.noGo, false);
  });

  test('vlaagfactor boven maxVlaagfactor is een harde no-go', () => {
    const r = evalueerWindvlagen(20, 32, WINDVLAGEN); // factor = 0.6
    assert.equal(r.noGo, true);
  });

  test('vlaagfactor tussen waarschuwing en max is een waarschuwing, geen no-go', () => {
    const r = evalueerWindvlagen(20, 28, WINDVLAGEN); // factor = 0.4
    assert.equal(r.status, 'waarschuwing');
    assert.equal(r.noGo, false);
  });

  test('vlaagfactor onder de waarschuwingsdrempel is laag risico', () => {
    const r = evalueerWindvlagen(20, 24, WINDVLAGEN); // factor = 0.2
    assert.equal(r.status, 'laag-risico');
    assert.equal(r.score, 1);
  });

  test('gemiddelde van 0 knopen geeft onbekend i.p.v. delen door nul', () => {
    const r = evalueerWindvlagen(0, 5, WINDVLAGEN);
    assert.equal(r.status, 'onbekend');
  });
});

describe('evalueerOnweer', () => {
  test('onweer aanwezig is altijd een harde no-go, ook zonder ingestelde neerslagdrempel', () => {
    const r = evalueerOnweer(true, 0.1, standaardDrempelwaarden().onweer);
    assert.equal(r.noGo, true);
  });

  test('onweer kan uitgezet worden per profiel', () => {
    const r = evalueerOnweer(true, 0.1, { ...ONWEER, hardNoGo: false });
    assert.equal(r.noGo, false);
  });

  test('hoge neerslagkans zonder onweer is een waarschuwing als de drempel is ingesteld', () => {
    const r = evalueerOnweer(false, 0.8, ONWEER);
    assert.equal(r.status, 'waarschuwing');
    assert.equal(r.noGo, false);
  });

  test('zonder ingestelde neerslagdrempel wordt neerslagkans genegeerd (ok, geen gok)', () => {
    const r = evalueerOnweer(false, 0.95, standaardDrempelwaarden().onweer);
    assert.equal(r.status, 'ok');
  });

  test('lage neerslagkans zonder onweer is ok', () => {
    const r = evalueerOnweer(false, 0.1, ONWEER);
    assert.equal(r.status, 'ok');
    assert.equal(r.score, 1);
  });
});

describe('nice-to-have variabelen', () => {
  test('niet-geconfigureerd geeft overal een neutrale score, geen crash', () => {
    const blanco = standaardDrempelwaarden();
    assert.equal(evalueerLuchttemperatuur(18, blanco.luchttemperatuur).status, 'niet-geconfigureerd');
    assert.equal(evalueerWatertemperatuur(18, blanco.watertemperatuur).status, 'niet-geconfigureerd');
    assert.equal(evalueerGolfhoogte(0.3, blanco.golfhoogte).status, 'niet-geconfigureerd');
    assert.equal(evalueerZicht(2, blanco.zicht).status, 'niet-geconfigureerd');
  });

  test('luchttemperatuur boven minimum is comfortabel', () => {
    assert.equal(evalueerLuchttemperatuur(18, LUCHTTEMPERATUUR).status, 'comfortabel');
  });

  test('watertemperatuur onder minimumMetWetsuit is te koud', () => {
    const r = evalueerWatertemperatuur(5, WATERTEMPERATUUR);
    assert.equal(r.status, 'te-koud');
  });

  test('golfhoogte: vlak water scoort vol als er geen golfvoorkeur is', () => {
    const r = evalueerGolfhoogte(0.3, GOLFHOOGTE);
    assert.equal(r.status, 'vlak-water');
    assert.equal(r.score, 1);
  });

  test('golfhoogte: met golfvoorkeur scoort vlak water juist laag', () => {
    const r = evalueerGolfhoogte(0.2, { ...GOLFHOOGTE, voorkeurGolven: true });
    assert.equal(r.status, 'te-vlak');
  });

  test('getij zonder voorkeur telt altijd vol mee', () => {
    assert.equal(evalueerGetij('laag', { voorkeur: 'geen' }).score, 1);
  });

  test('getij met voorkeur die niet matcht scoort lager, geen no-go', () => {
    const r = evalueerGetij('laag', { voorkeur: 'hoog' });
    assert.ok(r.score < 1);
    assert.equal(r.noGo, false);
  });

  test('onvoldoende zicht scoort laag maar is geen no-go', () => {
    const r = evalueerZicht(0.8, ZICHT);
    assert.equal(r.status, 'onvoldoende');
    assert.equal(r.noGo, false);
  });
});
