// Pure logica: combineert de drempelwaarde-evaluaties tot een score (1-10) en kleurcode
// per uur en per dag, volgens het "Voorstel scoreberekening" in criteria-kiteweer-app.md.

const {
  standaardDrempelwaarden,
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
} = require('./drempelwaarden');

// Hoofdcriteria bepalen samen 90% van de score; het facultatieve restje (lucht-/watertemperatuur,
// golfhoogte, zicht) 10%. "Onweer" (los van langdurigeRegen) zit hier bewust niet als percentage
// bij — dat werkt al als hard-gate (harde no-go bij onweer) plus een vermenigvuldigende straf bij
// een neerslagwaarschuwing, dus met nóg meer gewicht dan een gewoon percentage zou geven.
// "Actuele wind" is geen aparte categorie: die wordt via bronnenMiddeling al rechtstreeks in
// windsnelheid/windrichting meegewogen op het "nu"-uur (zie forecastSamenstellen.js) — dezelfde
// hoofdcriteria, alleen met een actuele meting erbij.
//
// Dit is de STANDAARD-verdeling — de gebruiker kan er per profiel van afwijken (⚙️ Instellingen ->
// Score-berekening, `profiel.scoreGewichten`). `berekenUurScore` normaliseert altijd op de som van
// de gewichten (zie normaliseerGewichten hieronder), dus deze waarden hoeven niet exact op 1 uit te
// komen en een gebruiker mag ze als vrije relatieve factoren invullen i.p.v. als percentages.
const GEWICHTEN = {
  windsnelheid: 0.3,
  windrichting: 0.2,
  windvlagen: 0.15,
  getij: 0.15,
  langdurigeRegen: 0.1,
  facultatief: 0.1,
};

// De vier variabelen die standaard samen de "Facultatief"-rij vormen (het gemiddelde van hun
// deelscores). Instelbaar (⚙️ Instellingen -> Score-berekening) om ook individueel te kiezen —
// dan telt zo'n variabele met een eigen gewicht mee i.p.v. binnen het Facultatief-gemiddelde, zie
// berekenUurScore. `ALLE_SCORE_CRITERIA` is de volledige toegestane sleutelset voor
// `profiel.scoreGewichten` (zie valideerScoreGewichten in profielValidatie.js) — "onweer" hoort
// hier bewust niet bij: dat werkt als hard-gate + vermenigvuldigende factor, geen gewogen optelterm.
const FACULTATIEVE_SUBCRITERIA = ['luchttemperatuur', 'watertemperatuur', 'golfhoogte', 'zicht'];
const ALLE_SCORE_CRITERIA = [
  'windsnelheid', 'windrichting', 'windvlagen', 'getij', 'langdurigeRegen', 'facultatief',
  ...FACULTATIEVE_SUBCRITERIA,
];

/**
 * Valideert en geeft een gewichtenset terug die precies de sleutels bevat die de gebruiker heeft
 * gekozen (niet meer aangevuld tot een vaste standaardset — de tabel in ⚙️ Instellingen ->
 * Score-berekening IS de volledige definitie van wat meetelt). Onbekende sleutels en
 * negatieve/ongeldige waarden worden genegeerd; is er na filtering niets geldigs over (leeg,
 * afwezig, of alles op 0), dan valt het geheel terug op de standaard GEWICHTEN — een lege of
 * incorrect ingevulde set zou anders een blijvende score van 0 opleveren zonder duidelijke oorzaak.
 * @param {Object} [ruw] - bv. profiel.scoreGewichten; mag gedeeltelijk, leeg of afwezig zijn.
 */
function normaliseerGewichten(ruw) {
  if (!ruw || typeof ruw !== 'object') return GEWICHTEN;
  const resultaat = {};
  let som = 0;
  Object.keys(ruw).forEach((key) => {
    if (!ALLE_SCORE_CRITERIA.includes(key)) return;
    const waarde = ruw[key];
    if (typeof waarde === 'number' && Number.isFinite(waarde) && waarde >= 0) {
      resultaat[key] = waarde;
      som += waarde;
    }
  });
  return som > 0 ? resultaat : GEWICHTEN;
}

/**
 * Bepaalt, over de volle dag (in chronologische volgorde, vóór het dagvenster-filter), welke uren
 * onderdeel zijn van een aaneengesloten reeks van minstens `instellingen.minimumUrenAchtereen` uur
 * met elk minstens `instellingen.minimumMmPerUur` regen. Zonder deze context per uur zou een
 * losse bui er per uur net zo onschuldig uitzien als drie uur aan één stuk regen — precies het
 * onderscheid dat "langdurige regen" moet vastleggen.
 * @param {Array<{uurData: Object}>} urenVanDag
 * @param {{minimumUrenAchtereen: ?number, minimumMmPerUur: ?number}} instellingen
 * @returns {boolean[]} even lang als urenVanDag
 */
function berekenLangdurigeRegenVlaggen(urenVanDag, instellingen) {
  const uren = urenVanDag || [];
  const i = instellingen || standaardDrempelwaarden().langdurigeRegen;
  const vlaggen = uren.map(() => false);
  if (i.minimumUrenAchtereen == null || i.minimumMmPerUur == null) return vlaggen;

  const natUren = uren.map((u) => {
    const mm = u.uurData ? u.uurData.neerslagMm : null;
    return mm != null && mm >= i.minimumMmPerUur;
  });

  let start = null;
  for (let index = 0; index <= natUren.length; index += 1) {
    const nat = index < natUren.length && natUren[index];
    if (nat && start === null) start = index;
    if (!nat && start !== null) {
      if (index - start >= i.minimumUrenAchtereen) {
        for (let k = start; k < index; k += 1) vlaggen[k] = true;
      }
      start = null;
    }
  }
  return vlaggen;
}

function scoreNaarKleur(score) {
  if (score >= 8) return 'groen';
  if (score >= 5) return 'oranje';
  return 'rood';
}

/**
 * Berekent de score/kleur voor één uur op basis van alle (gemiddelde) meetwaarden op dat uur.
 * @param {Object} uurData - windKnopen, windvlaagKnopen, windrichtingGraden, onweerAanwezig,
 *   neerslagKans, luchttemperatuurCelsius, watertemperatuurCelsius, golfhoogteMeter,
 *   getijStatus, zichtKm (elk optioneel/null als de bron niet beschikbaar is).
 * @param {Object} instellingen - per-variabele drempelwaarden (zie standaardDrempelwaarden()).
 * @param {{langdurigeRegenActief?: boolean, gewichten?: Object}} [extra] - `langdurigeRegenActief`
 *   komt uit berekenLangdurigeRegenVlaggen (berekenDagScore berekent 'm over de hele dag, één uur
 *   heeft niet genoeg context om dat zelf te weten); `gewichten` is profiel.scoreGewichten, of
 *   anders de standaard GEWICHTEN.
 */
function berekenUurScore(uurData, instellingen, extra) {
  const i = { ...standaardDrempelwaarden(), ...(instellingen || {}) };
  const d = uurData || {};
  const gewichten = normaliseerGewichten(extra && extra.gewichten);

  const evaluaties = {
    windsnelheid: evalueerWindsnelheid(d.windKnopen, i.windsnelheid),
    windrichting: evalueerWindrichting(d.windrichtingGraden, i.windrichting),
    windvlagen: evalueerWindvlagen(d.windKnopen, d.windvlaagKnopen, i.windvlagen),
    onweer: evalueerOnweer(d.onweerAanwezig, d.neerslagKans, i.onweer),
    langdurigeRegen: evalueerLangdurigeRegen(extra && extra.langdurigeRegenActief, i.langdurigeRegen),
    luchttemperatuur: evalueerLuchttemperatuur(d.luchttemperatuurCelsius, i.luchttemperatuur),
    watertemperatuur: evalueerWatertemperatuur(d.watertemperatuurCelsius, i.watertemperatuur),
    golfhoogte: evalueerGolfhoogte(d.golfhoogteMeter, i.golfhoogte),
    getij: evalueerGetij(d.getijStatus, i.getij),
    zicht: evalueerZicht(d.zichtKm, i.zicht),
  };

  const noGoRedenen = Object.entries(evaluaties)
    .filter(([, e]) => e.noGo)
    .map(([variabele, e]) => ({ variabele, reden: e.reden }));

  if (noGoRedenen.length > 0) {
    return { score: 0, kleur: 'rood', noGo: true, redenen: noGoRedenen, evaluaties };
  }

  // evalueerOnweer geeft bij een waarschuwing (hoge neerslagkans) 0.5 i.p.v. een no-go;
  // die waarschuwing weegt mee via een vermenigvuldigende straf op de hele score (zie GEWICHTEN).
  const onweerWaarschuwingFactor = evaluaties.onweer.score;

  // "Facultatief" is standaard het gemiddelde van de vier FACULTATIEVE_SUBCRITERIA. Kiest een
  // gebruiker er één individueel (⚙️ Instellingen -> Score-berekening, bv. "Zicht" met een eigen
  // gewicht), dan telt die niet meer dubbel mee in dit gemiddelde — anders zou hij zowel apart als
  // via Facultatief bijdragen. Zijn alle vier apart gekozen, dan heeft Facultatief niets meer te
  // middelen en draagt de rij (terecht) niets bij, ook al staat hij nog met een gewicht in de tabel.
  const restFacultatief = FACULTATIEVE_SUBCRITERIA.filter((key) => !(key in gewichten));
  const facultatiefGemiddelde = restFacultatief.length > 0
    ? restFacultatief.reduce((s, key) => s + evaluaties[key].score, 0) / restFacultatief.length
    : 0;

  const somGewichten = Object.values(gewichten).reduce((s, w) => s + w, 0) || 1;
  const gewogenSom = Object.keys(gewichten).reduce((som, key) => {
    if (key === 'facultatief') return som + facultatiefGemiddelde * gewichten.facultatief;
    return evaluaties[key] ? som + evaluaties[key].score * gewichten[key] : som;
  }, 0);
  // Delen door de som (i.p.v. aan te nemen dat de gewichten al op 1 uitkomen) zodat een gebruiker
  // ze als vrije relatieve factoren mag invullen — met de standaard GEWICHTEN (som 1.0) is dit een
  // no-op en blijft het bestaande gedrag exact hetzelfde.
  const gewogenGemiddelde = gewogenSom / somGewichten;

  const score = Number((gewogenGemiddelde * onweerWaarschuwingFactor * 10).toFixed(1));
  return { score, kleur: scoreNaarKleur(score), noGo: false, redenen: [], evaluaties };
}

/**
 * Zoekt het best scorende aaneengesloten blok van `minimaleSessieUren` uur waarin géén enkel uur
 * een no-go is. Een losse piek van één uur is voor een kitesurfer geen bruikbare sessie — je rijdt
 * er niet voor naar het strand — dus telt alleen een blok dat lang genoeg aaneengesloten goed is.
 *
 * De score van een blok is het gemiddelde van de uren erin (niet het maximum): zo trekt één
 * uitschieter-uur een verder matig blok niet omhoog. Aaneengesloten wordt bepaald op de
 * volgorde van `uurResultaten` (opeenvolgende uren binnen het dagvenster), niet op klok-
 * rekenwerk — bij een gat in de reeks (ontbrekend uur) breekt het blok dus vanzelf af.
 * @param {Array<{tijdstip: string, score: number, noGo: boolean}>} uren binnen het dagvenster
 * @param {number} minimaleSessieUren
 * @returns {{startTijdstip: string, eindTijdstip: string, uren: Array, gemiddeldeScore: number}|null}
 */
function vindBesteVenster(uren, minimaleSessieUren) {
  const lengte = Math.max(1, Math.round(minimaleSessieUren || 1));
  if (!uren || uren.length < lengte) return null;

  let beste = null;
  for (let start = 0; start + lengte <= uren.length; start += 1) {
    const blok = uren.slice(start, start + lengte);
    if (blok.some((u) => u.noGo)) continue;
    const gemiddelde = blok.reduce((som, u) => som + u.score, 0) / blok.length;
    if (!beste || gemiddelde > beste.gemiddeldeScore) {
      beste = {
        startTijdstip: blok[0].tijdstip,
        eindTijdstip: blok[blok.length - 1].tijdstip,
        uren: blok,
        gemiddeldeScore: Number(gemiddelde.toFixed(1)),
      };
    }
  }
  return beste;
}

/**
 * Aggregeert de uurscores van één dag tot één dagoordeel: het beste aaneengesloten blok van
 * minimaal `minimaleSessieUren` uur binnen het dagvenster bepaalt de dagkleur/score ("is er
 * vandaag een bruikbare sessie"). Is er geen enkel blok dat lang genoeg aaneengesloten goed is,
 * dan is de dag rood met `geenSessieMogelijk: true` — ook als er wél één losse piek-uur was.
 * `besteUur` blijft gevuld (het beste uur binnen het venster, of anders het beste losse uur), zodat
 * de UI altijd concrete wind-/getijwaarden kan tonen.
 * @param {Array<{tijdstip: string, uurData: Object}>} urenVanDag
 * @param {Object} instellingen
 * @param {{dagvensterStartUur?: number, dagvensterEindUur?: number, minimaleSessieUren?: number, gewichten?: Object}} [opties]
 */
function berekenDagScore(urenVanDag, instellingen, opties) {
  const startUur = (opties && opties.dagvensterStartUur) != null ? opties.dagvensterStartUur : 6;
  const eindUur = (opties && opties.dagvensterEindUur) != null ? opties.dagvensterEindUur : 21;
  const minimaleSessieUren = (opties && opties.minimaleSessieUren) != null ? opties.minimaleSessieUren : 1;
  const gewichten = opties && opties.gewichten;

  // Over de VOLLE dag (vóór het dagvenster-filter hieronder), zodat een regenreeks die vóór het
  // venster begint en erin doorloopt ook herkend wordt — zie berekenLangdurigeRegenVlaggen.
  const langdurigeRegenVlaggen = berekenLangdurigeRegenVlaggen(
    urenVanDag,
    (instellingen && instellingen.langdurigeRegen) || undefined
  );

  const uurResultaten = (urenVanDag || []).map((u, index) => ({
    tijdstip: u.tijdstip,
    ...berekenUurScore(u.uurData, instellingen, {
      langdurigeRegenActief: langdurigeRegenVlaggen[index],
      gewichten,
    }),
    // Rauwe meetwaarden (naast de afgeleide status/score in `evaluaties`) — voor een directe
    // visuele weergave (pijl + kn, waterstand) in de UI, los van de go/no-go-interpretatie.
    // getijStatus/waterstandCm staan hier bewust apart van evaluaties.getij: die laatste toont de
    // voorkeur-relatieve status ("geen-voorkeur" zolang niets ingesteld is), dit hier is de
    // feitelijke waterstand, altijd zichtbaar ongeacht of een voorkeur is ingesteld.
    ruw: {
      windKnopen: u.uurData ? u.uurData.windKnopen : null,
      windvlaagKnopen: u.uurData ? u.uurData.windvlaagKnopen : null,
      windrichtingGraden: u.uurData ? u.uurData.windrichtingGraden : null,
      getijStatus: u.uurData ? u.uurData.getijStatus : null,
      waterstandCm: u.uurData ? u.uurData.waterstandCm : null,
      luchttemperatuurCelsius: u.uurData ? u.uurData.luchttemperatuurCelsius : null,
      // Bewust los van evaluaties.onweer (die geeft de score-invloed, "no-go"/"waarschuwing"/"ok")
      // — dit zijn de feitelijke waarden, altijd zichtbaar, ongeacht drempelinstellingen.
      onweerAanwezig: u.uurData ? u.uurData.onweerAanwezig : null,
      neerslagKans: u.uurData ? u.uurData.neerslagKans : null,
      neerslagMm: u.uurData ? u.uurData.neerslagMm : null,
      bewolkingPercent: u.uurData ? u.uurData.bewolkingPercent : null,
    },
  }));

  const binnenVenster = uurResultaten.filter((u) => {
    const uur = new Date(u.tijdstip).getHours();
    return uur >= startUur && uur <= eindUur;
  });
  const relevant = binnenVenster.length > 0 ? binnenVenster : uurResultaten;

  if (relevant.length === 0) {
    return {
      score: 0, kleur: 'rood', noGo: true, geenSessieMogelijk: true,
      besteUur: null, besteVenster: null, urenInVenster: [], uurResultaten,
    };
  }

  const besteLosseUur = relevant.reduce((beste, u) => (u.score > beste.score ? u : beste), relevant[0]);
  const besteVenster = vindBesteVenster(relevant, minimaleSessieUren);

  if (!besteVenster) {
    // Wel losse goede uren mogelijk, maar geen blok dat lang genoeg aaneengesloten goed is —
    // bewust rood: voor een sessie is een enkel piek-uur niet bruikbaar.
    return {
      score: 0,
      kleur: 'rood',
      noGo: besteLosseUur.noGo,
      geenSessieMogelijk: true,
      besteUur: besteLosseUur,
      besteVenster: null,
      urenInVenster: [],
      uurResultaten,
    };
  }

  // Binnen het gekozen venster is het beste uur representatief voor "hoe goed was het op z'n best".
  const besteUurInVenster = besteVenster.uren.reduce((beste, u) => (u.score > beste.score ? u : beste), besteVenster.uren[0]);

  // De score komt van het beste blok van exact `minimaleSessieUren`, maar voor de weergave wil je
  // de héle bruikbare periode weten: "tussen 09:00 en 15:00 is het goed" i.p.v. alleen de beste
  // twee uur daarvan. Rond het venster uitbreiden zolang uren minstens bruikbaar (oranje) zijn.
  const bruikbaarBlok = breidUitRondVenster(relevant, besteVenster);

  return {
    score: besteVenster.gemiddeldeScore,
    kleur: scoreNaarKleur(besteVenster.gemiddeldeScore),
    noGo: false,
    geenSessieMogelijk: false,
    besteUur: besteUurInVenster,
    besteVenster: {
      startTijdstip: bruikbaarBlok[0].tijdstip,
      eindTijdstip: bruikbaarBlok[bruikbaarBlok.length - 1].tijdstip,
      gemiddeldeScore: besteVenster.gemiddeldeScore,
      aantalUren: bruikbaarBlok.length,
      // Het kern-venster waar de score vandaan komt, los van de bredere bruikbare periode.
      kernStartTijdstip: besteVenster.startTijdstip,
      kernEindTijdstip: besteVenster.eindTijdstip,
    },
    urenInVenster: bruikbaarBlok,
    uurResultaten,
  };
}

/** Score vanaf waar een uur überhaupt bruikbaar is (oranje) — zie scoreNaarKleur. */
const BRUIKBAAR_VANAF_SCORE = 5;
/**
 * Hoe dicht een aangrenzend uur bij de kwaliteit van het kern-venster moet liggen om nog tot
 * dezelfde "goede periode" gerekend te worden. Zonder deze relatieve eis zou een topsessie van
 * 9-11 doorlopen tot elk nét-bruikbaar uur erna, en dan beschrijft de samenvatting "goede wind"
 * over een periode die in werkelijkheid duidelijk zwakker is.
 */
const VERGELIJKBAAR_AANDEEL = 0.8;

/**
 * Breidt het gevonden kern-venster naar voren en achteren uit zolang de aangrenzende uren
 * vergelijkbaar goed zijn als het venster zelf. Zo beschrijft de UI de volledige periode waarin je
 * kunt kiten, niet alleen het best scorende stukje — maar ook niet meer dan dat.
 */
function breidUitRondVenster(alleUren, venster) {
  const startIndex = alleUren.indexOf(venster.uren[0]);
  const eindIndex = alleUren.indexOf(venster.uren[venster.uren.length - 1]);
  if (startIndex === -1 || eindIndex === -1) return venster.uren;

  const drempel = Math.max(BRUIKBAAR_VANAF_SCORE, venster.gemiddeldeScore * VERGELIJKBAAR_AANDEEL);
  let van = startIndex;
  let tot = eindIndex;
  const hoortErbij = (u) => u && !u.noGo && u.score >= drempel;
  while (van - 1 >= 0 && hoortErbij(alleUren[van - 1])) van -= 1;
  while (tot + 1 < alleUren.length && hoortErbij(alleUren[tot + 1])) tot += 1;
  return alleUren.slice(van, tot + 1);
}

module.exports = {
  GEWICHTEN,
  FACULTATIEVE_SUBCRITERIA,
  ALLE_SCORE_CRITERIA,
  normaliseerGewichten,
  berekenLangdurigeRegenVlaggen,
  scoreNaarKleur,
  berekenUurScore,
  berekenDagScore,
  vindBesteVenster,
};
