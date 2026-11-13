// Pure logica voor de eenmalige stapsgewijze instellingen-wizard bij eerste app-gebruik.
// ES5-compatibel zodat hetzelfde bestand zowel in Node-tests, www/logica.js (Android) als
// dist/JavaScript.html (GAS WebApp) direct draait zonder transpilatie.

var ONBOARDING_WIND_PRESETS = [
  {
    id: 'twintip',
    label: 'Twintip allround',
    beschrijving: '16–26 kn ideaal (min 12)',
    windsnelheid: { minimum: 12, ideaalOnder: 16, ideaalBoven: 26, maximum: 34 },
  },
  {
    id: 'groot',
    label: 'Grote kite / licht weer',
    beschrijving: '13–22 kn ideaal (min 10)',
    windsnelheid: { minimum: 10, ideaalOnder: 13, ideaalBoven: 22, maximum: 28 },
  },
  {
    id: 'foil',
    label: 'Hydrofoil',
    beschrijving: '10–18 kn ideaal (min 7)',
    windsnelheid: { minimum: 7, ideaalOnder: 10, ideaalBoven: 18, maximum: 26 },
  },
];

var ONBOARDING_VLAAG_PRESETS = [
  {
    id: 'voorzichtig',
    label: 'Voorzichtig (+25% / +40%)',
    waarschuwingVlaagfactor: 0.25,
    maxVlaagfactor: 0.4,
  },
  {
    id: 'standaard',
    label: 'Standaard (+30% / +50%)',
    waarschuwingVlaagfactor: 0.3,
    maxVlaagfactor: 0.5,
  },
  {
    id: 'ruim',
    label: 'Ervaren (+35% / +60%)',
    waarschuwingVlaagfactor: 0.35,
    maxVlaagfactor: 0.6,
  },
];

function kloningsWaarde(waarde, fallback) {
  return waarde !== undefined ? waarde : fallback;
}

/** Maakt een bewerkbare concept-kopie van het profiel voor de onboarding-wizard. */
function maakOnboardingConcept(profiel) {
  var p = profiel || {};
  var d = p.drempelwaarden || {};
  var ws = d.windsnelheid || {};
  var wv = d.windvlagen || {};
  var ow = d.onweer || {};
  var lr = d.langdurigeRegen || {};
  var lt = d.luchttemperatuur || {};
  var wt = d.watertemperatuur || {};
  var gh = d.golfhoogte || {};
  var gt = d.getij || {};
  var zc = d.zicht || {};
  var dv = p.dagvenster || {};
  var ml = p.meldingen || {};

  return {
    windsnelheid: {
      minimum: kloningsWaarde(ws.minimum, null),
      ideaalOnder: kloningsWaarde(ws.ideaalOnder, null),
      ideaalBoven: kloningsWaarde(ws.ideaalBoven, null),
      maximum: kloningsWaarde(ws.maximum, null),
    },
    windvlagen: {
      waarschuwingVlaagfactor: kloningsWaarde(wv.waarschuwingVlaagfactor, null),
      maxVlaagfactor: kloningsWaarde(wv.maxVlaagfactor, null),
    },
    dagvenster: {
      startUur: dv.startUur != null ? Number(dv.startUur) : 9,
      eindUur: dv.eindUur != null ? Number(dv.eindUur) : 20,
    },
    dagenVooruit: p.dagenVooruit != null ? Number(p.dagenVooruit) : 3,
    minimaleSessieUren: p.minimaleSessieUren != null ? Number(p.minimaleSessieUren) : 2,
    onweer: {
      hardNoGo: ow.hardNoGo !== false,
      neerslagWaarschuwingDrempel: kloningsWaarde(ow.neerslagWaarschuwingDrempel, null),
    },
    langdurigeRegen: {
      minimumUrenAchtereen: kloningsWaarde(lr.minimumUrenAchtereen, null),
      minimumMmPerUur: kloningsWaarde(lr.minimumMmPerUur, null),
    },
    luchttemperatuur: {
      minimumComfortabel: kloningsWaarde(lt.minimumComfortabel, null),
    },
    watertemperatuur: {
      minimumComfortabel: kloningsWaarde(wt.minimumComfortabel, null),
      minimumMetWetsuit: kloningsWaarde(wt.minimumMetWetsuit, null),
    },
    golfhoogte: {
      maximum: kloningsWaarde(gh.maximum, null),
      voorkeurGolven: gh.voorkeurGolven === true,
    },
    zicht: {
      minimum: kloningsWaarde(zc.minimum, null),
    },
    getij: {
      voorkeur: gt.voorkeur || 'geen',
    },
    meldingen: {
      dagelijkseSamenvatting: ml.dagelijkseSamenvatting !== false,
      samenvattingUur: ml.samenvattingUur != null ? Number(ml.samenvattingUur) : 8,
      samenvattingMinuut: ml.samenvattingMinuut != null ? Number(ml.samenvattingMinuut) : 0,
      directeAlert: ml.directeAlert === true,
    },
  };
}

function isGeldigGetalWaarde(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Rekeneenheid voor Stap 2: vertaalt de vlaagfactor (drempelwaarden.js: (vlaag - gem) / gem) naar
 * begrijpelijke knopen bij een gekozen referentie-windsnelheid.
 */
function berekenVlaagVoorbeeldKnopen(basisKnopen, waarschuwingFactor, maxFactor) {
  var basis = isGeldigGetalWaarde(Number(basisKnopen)) && Number(basisKnopen) > 0
    ? Math.round(Number(basisKnopen))
    : 20;
  var wf = isGeldigGetalWaarde(waarschuwingFactor) && waarschuwingFactor > 0 ? waarschuwingFactor : null;
  var mf = isGeldigGetalWaarde(maxFactor) && maxFactor > 0 ? maxFactor : null;
  return {
    basisKnopen: basis,
    waarschuwingKnopen: wf != null ? Math.round(basis * (1 + wf)) : null,
    maxKnopen: mf != null ? Math.round(basis * (1 + mf)) : null,
    waarschuwingPct: wf != null ? Math.round(wf * 100) : null,
    maxPct: mf != null ? Math.round(mf * 100) : null,
  };
}

/** Valideert één wizard-stap (0..5) en geeft duidelijke Nederlandse meldingen terug. */
function valideerOnboardingStap(stapIndex, concept) {
  var fouten = [];
  var waarschuwing = null;
  var c = concept || {};

  if (stapIndex === 0) {
    var ws = c.windsnelheid || {};
    if (!isGeldigGetalWaarde(ws.minimum) || ws.minimum <= 0) {
      fouten.push('Vul een geldige minimale windsnelheid in (groter dan 0 knopen).');
    }
    if (!isGeldigGetalWaarde(ws.ideaalOnder) || ws.ideaalOnder <= 0) {
      fouten.push('Vul in vanaf welke windkracht het ideaal is.');
    }
    if (!isGeldigGetalWaarde(ws.ideaalBoven) || ws.ideaalBoven <= 0) {
      fouten.push('Vul in tot welke windkracht het ideaal is.');
    }
    if (fouten.length === 0) {
      if (ws.minimum >= ws.ideaalOnder) {
        fouten.push('Minimum (' + ws.minimum + ' kn) moet lager zijn dan "Ideaal vanaf" (' + ws.ideaalOnder + ' kn).');
      }
      if (ws.ideaalOnder > ws.ideaalBoven) {
        fouten.push('"Ideaal vanaf" (' + ws.ideaalOnder + ' kn) mag niet hoger zijn dan "Ideaal tot" (' + ws.ideaalBoven + ' kn).');
      }
      if (ws.maximum != null) {
        if (!isGeldigGetalWaarde(ws.maximum) || ws.maximum < ws.ideaalBoven) {
          fouten.push('Maximum (' + ws.maximum + ' kn) moet minstens gelijk zijn aan "Ideaal tot" (' + ws.ideaalBoven + ' kn).');
        }
      }
    }
  } else if (stapIndex === 1) {
    var wv = c.windvlagen || {};
    if (!isGeldigGetalWaarde(wv.waarschuwingVlaagfactor) || wv.waarschuwingVlaagfactor <= 0) {
      fouten.push('Vul een waarschuwings-vlaagfactor in (bijv. 0.3 voor +30%).');
    }
    if (!isGeldigGetalWaarde(wv.maxVlaagfactor) || wv.maxVlaagfactor <= 0) {
      fouten.push('Vul een no-go-vlaagfactor in (bijv. 0.5 voor +50%).');
    }
    if (fouten.length === 0) {
      if (wv.waarschuwingVlaagfactor >= wv.maxVlaagfactor) {
        fouten.push('De waarschuwingsfactor (' + wv.waarschuwingVlaagfactor + ') moet kleiner zijn dan de no-go factor (' + wv.maxVlaagfactor + ').');
      } else if (wv.waarschuwingVlaagfactor >= 1 || wv.maxVlaagfactor >= 1.2) {
        waarschuwing = 'Let op: vlaagfactor is de extra marge boven de wind (0.3 = +30%, 0.5 = +50%; 1.3 betekent +130%).';
      }
    }
  } else if (stapIndex === 2) {
    var dv = c.dagvenster || {};
    if (!isGeldigGetalWaarde(dv.startUur) || dv.startUur < 0 || dv.startUur > 22) {
      fouten.push('Kies een startuur tussen 0 en 22.');
    }
    if (!isGeldigGetalWaarde(dv.eindUur) || dv.eindUur < 1 || dv.eindUur > 23) {
      fouten.push('Kies een einduur tussen 1 en 23.');
    }
    if (fouten.length === 0 && dv.startUur >= dv.eindUur) {
      fouten.push('Het startuur van het dagvenster moet vóór het einduur liggen.');
    }
    if (!isGeldigGetalWaarde(c.minimaleSessieUren) || c.minimaleSessieUren < 1 || c.minimaleSessieUren > 8) {
      fouten.push('Minimale sessieduur moet tussen 1 en 8 uur liggen.');
    }
    if (!isGeldigGetalWaarde(c.dagenVooruit) || c.dagenVooruit < 1 || c.dagenVooruit > 10) {
      fouten.push('Voorspellingshorizon moet tussen 1 en 10 dagen liggen.');
    }
  } else if (stapIndex === 3) {
    var ow = c.onweer || {};
    var wt = c.watertemperatuur || {};
    var lr = c.langdurigeRegen || {};
    var gh = c.golfhoogte || {};
    var zc = c.zicht || {};
    if (ow.neerslagWaarschuwingDrempel != null &&
      (!isGeldigGetalWaarde(ow.neerslagWaarschuwingDrempel) || ow.neerslagWaarschuwingDrempel < 0 || ow.neerslagWaarschuwingDrempel > 1)) {
      fouten.push('Neerslagkans-waarschuwing moet tussen 0 en 1 liggen (bijv. 0.5 = 50%).');
    }
    if (wt.minimumComfortabel != null && wt.minimumMetWetsuit != null && wt.minimumMetWetsuit > wt.minimumComfortabel) {
      fouten.push('Watertemperatuur "met wetsuit vanaf" kan niet hoger zijn dan "zonder wetsuit vanaf".');
    }
    if (lr.minimumUrenAchtereen != null && (!isGeldigGetalWaarde(lr.minimumUrenAchtereen) || lr.minimumUrenAchtereen < 1)) {
      fouten.push('Aantal aaneengesloten regen-uren moet minstens 1 zijn (of leeg).');
    }
    if (lr.minimumMmPerUur != null && (!isGeldigGetalWaarde(lr.minimumMmPerUur) || lr.minimumMmPerUur < 0)) {
      fouten.push('Minimaal mm per uur regen mag niet negatief zijn.');
    }
    if (gh.maximum != null && (!isGeldigGetalWaarde(gh.maximum) || gh.maximum < 0)) {
      fouten.push('Golfhoogte mag niet negatief zijn.');
    }
    if (zc.minimum != null && (!isGeldigGetalWaarde(zc.minimum) || zc.minimum < 0)) {
      fouten.push('Minimum zicht mag niet negatief zijn.');
    }
  }

  return { ok: fouten.length === 0, fouten: fouten, waarschuwing: waarschuwing };
}

/** Past de concept-instellingen uit de wizard toe op het profiel met behoud van overige velden. */
function pasOnboardingConceptToeOpProfiel(basisProfiel, concept) {
  var p = Object.assign({}, basisProfiel || {});
  var basisConcept = maakOnboardingConcept(p);
  var c = concept || {};
  var ws = c.windsnelheid || basisConcept.windsnelheid;
  var wv = c.windvlagen || basisConcept.windvlagen;
  var dv = c.dagvenster || basisConcept.dagvenster;
  var ow = c.onweer || basisConcept.onweer;
  var lr = c.langdurigeRegen || basisConcept.langdurigeRegen;
  var lt = c.luchttemperatuur || basisConcept.luchttemperatuur;
  var wt = c.watertemperatuur || basisConcept.watertemperatuur;
  var gh = c.golfhoogte || basisConcept.golfhoogte;
  var zc = c.zicht || basisConcept.zicht;
  var gt = c.getij || basisConcept.getij;
  var ml = c.meldingen || basisConcept.meldingen;

  var oudeDrempels = Object.assign({}, p.drempelwaarden || {});
  p.drempelwaarden = Object.assign(oudeDrempels, {
    windsnelheid: Object.assign({}, basisConcept.windsnelheid, ws),
    windvlagen: Object.assign({}, basisConcept.windvlagen, wv),
    onweer: Object.assign({}, basisConcept.onweer, ow),
    langdurigeRegen: Object.assign({}, basisConcept.langdurigeRegen, lr),
    luchttemperatuur: Object.assign({}, basisConcept.luchttemperatuur, lt),
    watertemperatuur: Object.assign({}, basisConcept.watertemperatuur, wt),
    golfhoogte: Object.assign({}, basisConcept.golfhoogte, gh),
    zicht: Object.assign({}, basisConcept.zicht, zc),
    getij: Object.assign({}, basisConcept.getij, gt),
  });
  p.dagvenster = {
    startUur: Math.round(dv.startUur),
    eindUur: Math.round(dv.eindUur),
  };
  p.dagenVooruit = Math.round(c.dagenVooruit != null ? c.dagenVooruit : basisConcept.dagenVooruit);
  p.minimaleSessieUren = Math.round(c.minimaleSessieUren != null ? c.minimaleSessieUren : basisConcept.minimaleSessieUren);

  var oudeMeldingen = Object.assign({}, p.meldingen || {});
  p.meldingen = Object.assign(oudeMeldingen, {
    dagelijkseSamenvatting: !!ml.dagelijkseSamenvatting,
    samenvattingUur: Math.round(ml.samenvattingUur != null ? ml.samenvattingUur : basisConcept.meldingen.samenvattingUur),
    samenvattingMinuut: Math.round(ml.samenvattingMinuut != null ? ml.samenvattingMinuut : basisConcept.meldingen.samenvattingMinuut),
    directeAlert: !!ml.directeAlert,
  });
  return p;
}

module.exports = {
  ONBOARDING_WIND_PRESETS: ONBOARDING_WIND_PRESETS,
  ONBOARDING_VLAAG_PRESETS: ONBOARDING_VLAAG_PRESETS,
  maakOnboardingConcept: maakOnboardingConcept,
  berekenVlaagVoorbeeldKnopen: berekenVlaagVoorbeeldKnopen,
  valideerOnboardingStap: valideerOnboardingStap,
  pasOnboardingConceptToeOpProfiel: pasOnboardingConceptToeOpProfiel,
};
