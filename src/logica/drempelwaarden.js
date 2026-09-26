// Pure logica: evaluatie van gemeten waarden tegen de (instelbare) drempelwaarden
// uit criteria-kiteweer-app.md. Geen GAS-afhankelijkheden, puur JS/Node-testbaar.
//
// Alle numerieke drempelwaarden starten LEEG (null) — de gebruiker moet ze bewust zelf instellen
// in plaats van (mogelijk misleidende) standaardwaarden te vertrouwen bij een veiligheidskritische
// go/no-go-beslissing. Elke evaluatiefunctie behandelt een ontbrekende drempel als
// 'niet-geconfigureerd' (neutraal, telt niet als no-go, maar telt ook niet mee als een echte
// beoordeling) — zie heeftEssentieleConfiguratie() voor de check die de UI gebruikt om de
// gebruiker daarop te wijzen.

/** Drempelwaarden-"vorm": alle tunable getallen leeg, op een paar bewust veilige defaults na. */
function standaardDrempelwaarden() {
  return {
    windsnelheid: { minimum: null, ideaalOnder: null, ideaalBoven: null, maximum: null },
    windrichting: { besteRanges: [], acceptabeleRanges: [] },
    windvlagen: { waarschuwingVlaagfactor: null, maxVlaagfactor: null },
    // hardNoGo blijft standaard aan: "onweer = altijd gevaarlijk" is een veiligheidsvangnet,
    // geen persoonlijke voorkeur zoals de andere drempels.
    onweer: { hardNoGo: true, neerslagWaarschuwingDrempel: null },
    // Los van de neerslagkans-waarschuwing hierboven (die kijkt per uur): dit signaleert een
    // aaneengesloten reeks natte uren, ongeacht de gerapporteerde kans. Een half uurtje bewolkt
    // met kans op een bui is iets anders dan drie uur aan één stuk daadwerkelijke regen.
    langdurigeRegen: { minimumUrenAchtereen: null, minimumMmPerUur: null },
    luchttemperatuur: { minimumComfortabel: null },
    watertemperatuur: { minimumComfortabel: null, minimumMetWetsuit: null },
    golfhoogte: { maximum: null, voorkeurGolven: false },
    getij: { voorkeur: 'geen' },
    zicht: { minimum: null },
  };
}

/**
 * De essentiële drempels (windsnelheid + windvlagen — windrichting is per-locatie, onweer heeft
 * al een veilige default) die de gebruiker minimaal zelf moet instellen voordat een score/kleur
 * een betrouwbare go/no-go-betekenis heeft. Gebruikt door de UI om een "eerst instellen"-banner
 * te tonen i.p.v. stilzwijgend met halve/onjuiste aannames te rekenen.
 */
function heeftEssentieleConfiguratie(drempelwaarden) {
  const w = (drempelwaarden && drempelwaarden.windsnelheid) || {};
  const v = (drempelwaarden && drempelwaarden.windvlagen) || {};
  return (
    w.minimum != null &&
    w.ideaalOnder != null &&
    w.ideaalBoven != null &&
    v.maxVlaagfactor != null &&
    v.waarschuwingVlaagfactor != null
  );
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Windsnelheid is essentieel: onder het minimum is een harde no-go.
 * Score loopt lineair op tot het ideale bereik en blijft 1 binnen het ideale bereik.
 * Boven een eventueel ingesteld maximum is het ook een no-go (te hard voor de gekozen kite).
 */
function evalueerWindsnelheid(knopen, instellingen) {
  const i = instellingen || standaardDrempelwaarden().windsnelheid;
  if (knopen == null) return { status: 'onbekend', score: 0, noGo: false };
  if (i.minimum == null || i.ideaalOnder == null || i.ideaalBoven == null) {
    return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  }
  if (knopen < i.minimum) return { status: 'no-go', score: 0, noGo: true, reden: 'Te weinig wind' };
  if (i.maximum != null && knopen > i.maximum) {
    return { status: 'no-go', score: 0, noGo: true, reden: 'Te veel wind' };
  }
  if (knopen >= i.ideaalOnder && knopen <= i.ideaalBoven) {
    return { status: 'ideaal', score: 1, noGo: false };
  }
  if (knopen < i.ideaalOnder) {
    const score = clamp01((knopen - i.minimum) / (i.ideaalOnder - i.minimum));
    return { status: 'bruikbaar', score, noGo: false };
  }
  // Boven ideaalBoven (en onder/op een eventueel maximum): geleidelijk afnemende score.
  const bovengrens = i.maximum != null ? i.maximum : i.ideaalBoven * 1.5;
  const score = clamp01(1 - (knopen - i.ideaalBoven) / (bovengrens - i.ideaalBoven));
  return { status: 'gevorderd', score, noGo: false };
}

/** Normaliseert een hoek naar het bereik [0, 360). */
function normaliseerGraden(graden) {
  return ((graden % 360) + 360) % 360;
}

/** Ligt `graden` in het (mogelijk over 360/0 heen wikkelende) bereik [start, eind]? */
function inGradenBereik(graden, start, eind) {
  if (graden == null || start == null || eind == null) return false;
  // Een bereik dat een hele cirkel (of meer) beslaat betekent "elke richting is goed". Zonder deze
  // check zou [0, 360] na normalisatie s=0/e=0 worden en dus alléén exact 0° accepteren — precies
  // het tegenovergestelde van wat een gebruiker bedoelt die "alle richtingen" invult bij een
  // favoriete locatie.
  if (Math.abs(eind - start) >= 360) return true;

  const g = normaliseerGraden(graden);
  const s = normaliseerGraden(start);
  const e = normaliseerGraden(eind);
  if (s <= e) return g >= s && g <= e;
  return g >= s || g <= e; // bereik wikkelt over 0/360 heen
}

/**
 * Windrichting is essentieel en spot-afhankelijk (cross-shore t.o.v. de kustlijn).
 * `instellingen.besteRanges`/`acceptabeleRanges` zijn arrays van [start, eind] in graden,
 * ingesteld per gekozen locatie op basis van de kustoriëntatie.
 * Buiten beide bereiken = offshore/cross-offshore = harde no-go.
 * Lege bereik-arrays betekenen "nog niet geconfigureerd voor deze locatie" -> niet beoordeelbaar.
 */
function evalueerWindrichting(graden, instellingen) {
  const i = instellingen || standaardDrempelwaarden().windrichting;
  if (graden == null) return { status: 'onbekend', score: 0, noGo: false };
  const geenConfig = (!i.besteRanges || i.besteRanges.length === 0)
    && (!i.acceptabeleRanges || i.acceptabeleRanges.length === 0);
  if (geenConfig) return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };

  const isBeste = (i.besteRanges || []).some(([s, e]) => inGradenBereik(graden, s, e));
  if (isBeste) return { status: 'beste', score: 1, noGo: false };

  const isAcceptabel = (i.acceptabeleRanges || []).some(([s, e]) => inGradenBereik(graden, s, e));
  if (isAcceptabel) return { status: 'acceptabel', score: 0.6, noGo: false };

  return { status: 'no-go', score: 0, noGo: true, reden: 'Offshore of cross-offshore wind' };
}

/**
 * Windvlagen: vlaagfactor = (vlaag - gemiddelde) / gemiddelde.
 * Boven maxVlaagfactor is een harde no-go, tussen waarschuwing en max is een waarschuwing
 * (weegt mee in de score, blokkeert niet).
 */
function evalueerWindvlagen(gemiddeldeKnopen, vlaagKnopen, instellingen) {
  const i = instellingen || standaardDrempelwaarden().windvlagen;
  if (gemiddeldeKnopen == null || vlaagKnopen == null || gemiddeldeKnopen === 0) {
    return { status: 'onbekend', score: 0, noGo: false, vlaagfactor: null };
  }
  if (i.maxVlaagfactor == null || i.waarschuwingVlaagfactor == null) {
    return { status: 'niet-geconfigureerd', score: 0.5, noGo: false, vlaagfactor: null };
  }
  const vlaagfactor = (vlaagKnopen - gemiddeldeKnopen) / gemiddeldeKnopen;
  if (vlaagfactor > i.maxVlaagfactor) {
    return { status: 'no-go', score: 0, noGo: true, vlaagfactor, reden: 'Te grillige windvlagen' };
  }
  if (vlaagfactor > i.waarschuwingVlaagfactor) {
    const score = clamp01(1 - (vlaagfactor - i.waarschuwingVlaagfactor) / (i.maxVlaagfactor - i.waarschuwingVlaagfactor));
    return { status: 'waarschuwing', score, noGo: false, vlaagfactor };
  }
  return { status: 'laag-risico', score: 1, noGo: false, vlaagfactor };
}

/**
 * Onweer/buien: onweer is standaard altijd een harde no-go (uit te zetten per profiel, dit is
 * de enige drempel die niet blanco start — zie standaardDrempelwaarden()).
 * Een hoge neerslagkans zonder onweer is een waarschuwing, geen no-go — alleen als er een
 * drempel is ingesteld; zonder ingestelde drempel wordt de neerslagkans genegeerd (niet als
 * automatisch "wel" of "geen" waarschuwing behandeld).
 */
function evalueerOnweer(onweerAanwezig, neerslagKans, instellingen) {
  const i = instellingen || standaardDrempelwaarden().onweer;
  if (onweerAanwezig && i.hardNoGo !== false) {
    return { status: 'no-go', score: 0, noGo: true, reden: 'Onweer aanwezig of voorspeld' };
  }
  if (i.neerslagWaarschuwingDrempel != null && neerslagKans != null && neerslagKans > i.neerslagWaarschuwingDrempel) {
    return { status: 'waarschuwing', score: 0.5, noGo: false, reden: 'Hoge neerslagkans' };
  }
  return { status: 'ok', score: 1, noGo: false };
}

/**
 * Langdurige regen: los van de per-uur neerslagkans-waarschuwing (evalueerOnweer) hierboven, want
 * die kijkt niet naar duur. `actief` komt uit `berekenLangdurigeRegenVlaggen` (scoreBerekening.js),
 * dat over de hele dag heen bepaalt of dit uur in een aaneengesloten natte reeks van voldoende
 * lengte valt — deze functie evalueert alleen de uitkomst daarvan tot een score, net als de andere
 * evalueerX-functies hier. Geen no-go: het is vervelend, geen veiligheidsrisico zoals onweer.
 */
function evalueerLangdurigeRegen(actief, instellingen) {
  const i = instellingen || standaardDrempelwaarden().langdurigeRegen;
  if (i.minimumUrenAchtereen == null || i.minimumMmPerUur == null) {
    return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  }
  if (actief) return { status: 'langdurige-regen', score: 0, noGo: false, reden: 'Langdurige regen' };
  return { status: 'geen-langdurige-regen', score: 1, noGo: false };
}

function evalueerLuchttemperatuur(celsius, instellingen) {
  const i = instellingen || standaardDrempelwaarden().luchttemperatuur;
  if (celsius == null) return { status: 'onbekend', score: 0.5, noGo: false };
  if (i.minimumComfortabel == null) return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  if (celsius >= i.minimumComfortabel) return { status: 'comfortabel', score: 1, noGo: false };
  const score = clamp01(0.5 + (celsius - i.minimumComfortabel) / 20);
  return { status: 'kouder', score, noGo: false };
}

function evalueerWatertemperatuur(celsius, instellingen) {
  const i = instellingen || standaardDrempelwaarden().watertemperatuur;
  if (celsius == null) return { status: 'onbekend', score: 0.5, noGo: false };
  if (i.minimumComfortabel == null || i.minimumMetWetsuit == null) {
    return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  }
  if (celsius >= i.minimumComfortabel) return { status: 'comfortabel-zonder-wetsuit', score: 1, noGo: false };
  if (celsius >= i.minimumMetWetsuit) {
    const score = clamp01(0.5 + (celsius - i.minimumMetWetsuit) / (2 * (i.minimumComfortabel - i.minimumMetWetsuit)));
    return { status: 'met-wetsuit-doenlijk', score, noGo: false };
  }
  return { status: 'te-koud', score: 0.1, noGo: false };
}

function evalueerGolfhoogte(meter, instellingen) {
  const i = instellingen || standaardDrempelwaarden().golfhoogte;
  if (meter == null) return { status: 'onbekend', score: 0.5, noGo: false };
  if (i.maximum == null) return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  if (i.voorkeurGolven) {
    const score = clamp01(meter / i.maximum);
    return { status: score >= 1 ? 'golven-gewenst' : 'te-vlak', score, noGo: false };
  }
  if (meter <= 0.5) return { status: 'vlak-water', score: 1, noGo: false };
  if (meter <= i.maximum) return { status: 'gemiddeld', score: 0.7, noGo: false };
  const score = clamp01(1 - (meter - i.maximum) / i.maximum);
  return { status: 'hoog', score, noGo: false };
}

function evalueerGetij(getijStatus, instellingen) {
  const i = instellingen || standaardDrempelwaarden().getij;
  if (!i.voorkeur || i.voorkeur === 'geen' || getijStatus == null) {
    return { status: 'geen-voorkeur', score: 1, noGo: false };
  }
  return { status: getijStatus, score: getijStatus === i.voorkeur ? 1 : 0.4, noGo: false };
}

function evalueerZicht(km, instellingen) {
  const i = instellingen || standaardDrempelwaarden().zicht;
  if (km == null) return { status: 'onbekend', score: 0.5, noGo: false };
  if (i.minimum == null) return { status: 'niet-geconfigureerd', score: 0.5, noGo: false };
  if (km < i.minimum) return { status: 'onvoldoende', score: 0.2, noGo: false };
  return { status: 'voldoende', score: 1, noGo: false };
}

module.exports = {
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
};
