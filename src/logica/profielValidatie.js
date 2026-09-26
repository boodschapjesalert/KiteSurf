// Pure logica: validatie, defaults-aanvulling en CRUD-helpers voor het gebruikersprofiel-JSON
// dat per unieke gebruikers-ID in Drive wordt opgeslagen. De gebruiker wordt geïdentificeerd via
// een niet-geraden ID in de URL (zie README.md "Aannames") i.p.v. een account/login.

const { standaardDrempelwaarden } = require('./drempelwaarden');
const { GEWICHTEN, ALLE_SCORE_CRITERIA } = require('./scoreBerekening');

// Bovengrens voor een handmatig ingevuld score-gewicht: dit zijn vrije relatieve factoren (geen
// percentages die op 1 moeten optellen — zie normaliseerGewichten in scoreBerekening.js), maar een
// begrenzing voorkomt dat een tik-fout (bv. 900 i.p.v. 90) de andere criteria volledig verdrinkt.
const MAXIMUM_SCORE_GEWICHT = 10;

// ZZW (202.5°) t/m NW (315°): de standaard cross-shore windrichting voor Rockanje/Maasvlakte.
const ZZW_GRADEN = 202.5;
const NW_GRADEN = 315;

// Voorspellingshorizon (instelbaar, zie `dagenVooruit`): standaard 3, instelbaar tot 10. Boven de
// 10 wordt het onderscheid met de standaard 3 dagen weinig zinvol (zie README.md "Aannames" —
// niet elke bron voorspelt zo ver vooruit, dus meer dagen betekent vooral meer dagen die alleen
// nog op Open-Meteo draaien).
const MINIMUM_DAGEN_VOORUIT = 1;
const MAXIMUM_DAGEN_VOORUIT = 10;
const STANDAARD_DAGEN_VOORUIT = 3;

// Minimale aaneengesloten sessieduur (uren) voordat een periode als bruikbaar telt. Boven de 8 uur
// wordt het onzinnig (langer dan een realistische kitesurfdag binnen het dagvenster).
const MINIMUM_MINIMALE_SESSIE_UREN = 1;
const MAXIMUM_MINIMALE_SESSIE_UREN = 8;
const STANDAARD_MINIMALE_SESSIE_UREN = 2;

function isEindigGetal(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Windrichting zit per favoriete locatie (kustoriëntatie is locatie-specifiek), niet globaal. */
function standaardDrempelwaardenZonderWindrichting() {
  const { windrichting, ...rest } = standaardDrempelwaarden();
  return rest;
}

/** De twee standaard-favorieten, met exacte coördinaten van kitesurfvereniging.nl se spotkaart. */
function standaardFavorieteLocaties() {
  const windrichting = { besteRanges: [[ZZW_GRADEN, NW_GRADEN]], acceptabeleRanges: [] };
  return [
    {
      id: 'rockanje-sportstrand',
      naam: 'Rockanje Sportstrand',
      lat: 51.8722925148425,
      lon: 4.044898266162127,
      windrichting,
    },
    {
      id: 'maasvlakte-2-slufter',
      naam: 'Maasvlakte 2 - Slufter',
      lat: 51.919079,
      lon: 3.988189,
      windrichting,
    },
  ];
}

function standaardDatabronnen() {
  return { openMeteo: true, buienradar: true, weerlive: true, rws: true, windfinder: true, knmi: true };
}

function standaardProfiel(gebruikerId) {
  return {
    gebruikerId: gebruikerId != null ? gebruikerId : null,
    // Gekoppeld door TelegramBot.gs zodra de gebruiker de bot start — niet handmatig instelbaar
    // in de UI (er is geen "vul je Telegram-ID in"-veld, dat zou te makkelijk te vervalsen zijn).
    // Meldingen lopen uitsluitend via Telegram (geen e-mail meer) — zonder gekoppeld chat-ID
    // krijgt dit profiel geen dagelijkse samenvatting (zie Meldingen.gs).
    telegramChatId: null,
    drempelwaarden: standaardDrempelwaardenZonderWindrichting(),
    databronnen: standaardDatabronnen(),
    // I.t.t. de drempelwaarden hierboven heeft dit wél een concrete default: 09:00-20:00, gelijk
    // aan het vaste weergavevenster van de grafiek (zie GRAFIEK_START_UUR/EIND_UUR in
    // JavaScript.html) — zo is het dagoordeel altijd gebaseerd op hetzelfde venster als wat je
    // in de grafiek ziet.
    dagvenster: { startUur: 9, eindUur: 20 },
    // Hoeveel dagen vooruit de app een weeroordeel toont — instelbaar (zie valideerDagenVooruit),
    // standaard 3. Zie README.md "Aannames" voor welke databronnen bij meer dagen uitvallen.
    dagenVooruit: STANDAARD_DAGEN_VOORUIT,
    // Hoe lang de wind aaneengesloten goed moet zijn voordat het als bruikbare sessie telt —
    // een losse piek van één uur is geen sessie waar je voor naar het strand rijdt. Bepaalt de
    // dagscore (zie scoreBerekening.vindBesteVenster). Standaard 2 uur.
    minimaleSessieUren: STANDAARD_MINIMALE_SESSIE_UREN,
    // Hoe zwaar elk hoofdcriterium meeweegt in de score (zie scoreBerekening.GEWICHTEN) — hier als
    // kopie zodat elk profiel zijn eigen instelbare set heeft. Default = exact de ingebouwde
    // berekening; een gebruiker die niets aanpast, merkt dus niets van deze instelling.
    scoreGewichten: { ...GEWICHTEN },
    favorieteLocaties: standaardFavorieteLocaties(),
    // Twee onafhankelijke, los te combineren Telegram-meldingsvormen (zie Meldingen.gs), allebei
    // gebaseerd op dezelfde score/kleur-berekening hierboven (scoreGewichten) — geen aparte
    // meldingsregel meer:
    // - dagelijkseSamenvatting: één keer per dag, op het gekozen tijdstip, het oordeel voor élke
    //   favoriete locatie en dag binnen de Voorspellingshorizon (ongeacht of het "goed" is).
    // - directeAlert: zodra een dag ergens binnen diezelfde horizon voor het eerst kleur "groen"
    //   krijgt. `laatstGemeld` is per locatie een verzameling datums waarvoor al gealerteerd is
    //   (`{ [locatieId]: { 'YYYY-MM-DD': true, ... } }`), zodat dag 1 en dag 3 onafhankelijk van
    //   elkaar hooguit één keer melden.
    // `samenvattingUur` + `samenvattingMinuut` vormen samen het gekozen tijdstip (in de UI één
    // tijdpicker, zie JavaScript.html: bouwTijdstipVeld); `laatsteSamenvattingDatum` voorkomt dat
    // dezelfde dag twee keer een samenvatting krijgt (de trigger draait vaker dan één keer per uur).
    meldingen: {
      dagelijkseSamenvatting: true,
      samenvattingUur: 8,
      samenvattingMinuut: 0,
      directeAlert: false,
      laatstGemeld: {},
      laatsteSamenvattingDatum: null,
    },
  };
}

/** Diepe merge van gebruikersinstellingen over de defaults heen, zonder onbekende velden over te nemen. */
function vulAanMetDefaults(waarden, defaults) {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return waarden != null ? waarden : defaults;
  }
  const resultaat = {};
  Object.keys(defaults).forEach((key) => {
    const heeftWaarde = waarden && typeof waarden === 'object' && waarden[key] !== undefined;
    resultaat[key] = heeftWaarde ? vulAanMetDefaults(waarden[key], defaults[key]) : defaults[key];
  });
  return resultaat;
}

function valideerLocatie(ruweLocatie) {
  const fouten = [];
  const naam = typeof ruweLocatie?.naam === 'string' && ruweLocatie.naam.trim()
    ? ruweLocatie.naam.trim().slice(0, 100)
    : null;
  if (!naam) fouten.push('Locatienaam ontbreekt of is leeg');

  const lat = Number(ruweLocatie?.lat);
  const lon = Number(ruweLocatie?.lon);
  if (!isEindigGetal(lat) || lat < -90 || lat > 90) fouten.push('Ongeldige breedtegraad (lat)');
  if (!isEindigGetal(lon) || lon < -180 || lon > 180) fouten.push('Ongeldige lengtegraad (lon)');

  const besteRanges = Array.isArray(ruweLocatie?.windrichting?.besteRanges)
    ? ruweLocatie.windrichting.besteRanges.filter(
        (r) => Array.isArray(r) && r.length === 2 && isEindigGetal(r[0]) && isEindigGetal(r[1])
      )
    : [];
  const acceptabeleRanges = Array.isArray(ruweLocatie?.windrichting?.acceptabeleRanges)
    ? ruweLocatie.windrichting.acceptabeleRanges.filter(
        (r) => Array.isArray(r) && r.length === 2 && isEindigGetal(r[0]) && isEindigGetal(r[1])
      )
    : [];

  if (fouten.length > 0) return { locatie: null, fouten };

  const id = ruweLocatie.id || `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return {
    locatie: { id, naam, lat, lon, windrichting: { besteRanges, acceptabeleRanges } },
    fouten: [],
  };
}

function valideerDagvenster(ruwDagvenster, defaultDagvenster) {
  const merged = vulAanMetDefaults(ruwDagvenster, defaultDagvenster);
  const clamp = (u) => Math.min(23, Math.max(0, Math.round(Number(u))));
  return {
    startUur: isEindigGetal(Number(merged.startUur)) ? clamp(merged.startUur) : defaultDagvenster.startUur,
    eindUur: isEindigGetal(Number(merged.eindUur)) ? clamp(merged.eindUur) : defaultDagvenster.eindUur,
  };
}

/**
 * Klemt de voorspellingshorizon naar [1, 10] (zie MINIMUM_/MAXIMUM_DAGEN_VOORUIT); ongeldige of
 * ontbrekende waarde valt terug op de default.
 */
function valideerDagenVooruit(ruwDagenVooruit, defaultDagenVooruit) {
  // Number(null) is 0 (geen NaN) — expliciet op null/undefined checken vóór de isEindigGetal-check,
  // anders valt een ontbrekende waarde niet terug op de default maar wordt 'm geklemd naar 1.
  if (ruwDagenVooruit == null || !isEindigGetal(Number(ruwDagenVooruit))) return defaultDagenVooruit;
  return Math.min(MAXIMUM_DAGEN_VOORUIT, Math.max(MINIMUM_DAGEN_VOORUIT, Math.round(Number(ruwDagenVooruit))));
}

/** Klemt de minimale sessieduur naar [1, 8] uur; ontbrekend/ongeldig valt terug op de default. */
function valideerMinimaleSessieUren(ruweWaarde, defaultWaarde) {
  if (ruweWaarde == null || !isEindigGetal(Number(ruweWaarde))) return defaultWaarde;
  return Math.min(MAXIMUM_MINIMALE_SESSIE_UREN, Math.max(MINIMUM_MINIMALE_SESSIE_UREN, Math.round(Number(ruweWaarde))));
}

/**
 * Geeft een gewichtenset terug die precies de door de gebruiker gekozen criteria bevat (zie
 * ⚙️ Instellingen -> Score-berekening: een tabel waar variabelen aan/uit toegevoegd worden, niet
 * langer een vaste set van zes). Elke waarde wordt geklemd naar [0, MAXIMUM_SCORE_GEWICHT]; een
 * onbekende sleutel (niet in `ALLE_SCORE_CRITERIA`, scoreBerekening.js) of een ongeldige/negatieve
 * waarde wordt genegeerd — dus verdwijnt uit de set in plaats van op een default terug te vallen,
 * want een gebruiker kan een criterium bewust helemaal verwijderd hebben. Is er na filtering niets
 * geldigs over, dan valt het geheel terug op `defaultGewichten` (voorkomt een leeg/kapot profiel).
 */
function valideerScoreGewichten(ruweGewichten, defaultGewichten) {
  if (!ruweGewichten || typeof ruweGewichten !== 'object' || Array.isArray(ruweGewichten)) {
    return { ...defaultGewichten };
  }
  const resultaat = {};
  Object.keys(ruweGewichten).forEach((key) => {
    if (!ALLE_SCORE_CRITERIA.includes(key)) return;
    const ruw = ruweGewichten[key];
    if (isEindigGetal(Number(ruw)) && Number(ruw) >= 0) {
      resultaat[key] = Math.min(MAXIMUM_SCORE_GEWICHT, Number(ruw));
    }
  });
  return Object.keys(resultaat).length > 0 ? resultaat : { ...defaultGewichten };
}

/**
 * Twee onafhankelijke, los te combineren Telegram-meldingsvormen (zie Meldingen.gs):
 * `dagelijkseSamenvatting` (op een zelf gekozen tijdstip) en `directeAlert` (zodra een dag ergens
 * binnen de Voorspellingshorizon kleur "groen" krijgt — dezelfde berekening als het cijfer, zie
 * scoreGewichten). Geen `vulAanMetDefaults()` hier — dat zou `laatstGemeld` (een dynamische,
 * per-locatie-id sleutel/waarde-kaart zonder vaste vorm) leegvegen omdat het standaardobject
 * daarvoor `{}` is.
 */
function valideerMeldingen(ruwMeldingen, defaultMeldingen) {
  const clampUur = (u) => Math.min(23, Math.max(0, Math.round(Number(u))));
  const clampMinuut = (m) => Math.min(59, Math.max(0, Math.round(Number(m))));
  return {
    dagelijkseSamenvatting: ruwMeldingen?.dagelijkseSamenvatting !== false,
    samenvattingUur: isEindigGetal(Number(ruwMeldingen?.samenvattingUur))
      ? clampUur(ruwMeldingen.samenvattingUur)
      : defaultMeldingen.samenvattingUur,
    // Number(null) is 0 (geen NaN), dus null/undefined eerst expliciet afvangen — anders zou een
    // ontbrekende minuut als de geldige waarde 0 gelden i.p.v. terug te vallen op de default.
    samenvattingMinuut:
      ruwMeldingen?.samenvattingMinuut != null && isEindigGetal(Number(ruwMeldingen.samenvattingMinuut))
        ? clampMinuut(ruwMeldingen.samenvattingMinuut)
        : defaultMeldingen.samenvattingMinuut,
    directeAlert: ruwMeldingen?.directeAlert === true,
    laatstGemeld:
      ruwMeldingen?.laatstGemeld && typeof ruwMeldingen.laatstGemeld === 'object' && !Array.isArray(ruwMeldingen.laatstGemeld)
        ? ruwMeldingen.laatstGemeld
        : {},
    laatsteSamenvattingDatum:
      typeof ruwMeldingen?.laatsteSamenvattingDatum === 'string' ? ruwMeldingen.laatsteSamenvattingDatum : null,
  };
}

/**
 * Valideert een ruw (bv. uit Drive of van de client) profiel-object en vult ontbrekende
 * velden aan met defaults. Onherstelbaar ongeldige favoriete locaties worden overgeslagen
 * (met een foutmelding) i.p.v. het hele profiel af te wijzen.
 */
function valideerEnVulProfielAan(ruwProfiel, gebruikerId) {
  const fouten = [];
  const basis = standaardProfiel(gebruikerId);

  if (ruwProfiel != null && typeof ruwProfiel !== 'object') {
    return { profiel: basis, fouten: ['Profiel was geen object, standaardprofiel gebruikt'] };
  }

  const drempelwaarden = vulAanMetDefaults(ruwProfiel?.drempelwaarden, basis.drempelwaarden);
  const databronnen = vulAanMetDefaults(ruwProfiel?.databronnen, basis.databronnen);
  const dagvenster = valideerDagvenster(ruwProfiel?.dagvenster, basis.dagvenster);
  const dagenVooruit = valideerDagenVooruit(ruwProfiel?.dagenVooruit, basis.dagenVooruit);
  const minimaleSessieUren = valideerMinimaleSessieUren(ruwProfiel?.minimaleSessieUren, basis.minimaleSessieUren);
  const scoreGewichten = valideerScoreGewichten(ruwProfiel?.scoreGewichten, basis.scoreGewichten);
  const telegramChatId = ruwProfiel?.telegramChatId != null ? ruwProfiel.telegramChatId : null;

  // Favoriete locaties: alleen aanvullen met de standaard-favorieten als het veld helemaal
  // ontbreekt (nieuw profiel) — een gebruiker die ze bewust verwijderd heeft, moet dat zo houden.
  const favorieteLocatiesRuw = Array.isArray(ruwProfiel?.favorieteLocaties)
    ? ruwProfiel.favorieteLocaties
    : ruwProfiel == null
      ? basis.favorieteLocaties
      : [];

  const favorieteLocaties = [];
  favorieteLocatiesRuw.forEach((ruw) => {
    const { locatie, fouten: locatieFouten } = valideerLocatie(ruw);
    if (locatie) favorieteLocaties.push(locatie);
    else fouten.push(...locatieFouten.map((f) => `Locatie "${ruw?.naam || '?'}": ${f}`));
  });

  const meldingen = valideerMeldingen(ruwProfiel?.meldingen, basis.meldingen);

  return {
    profiel: {
      gebruikerId: gebruikerId != null ? gebruikerId : ruwProfiel?.gebruikerId || null,
      telegramChatId,
      drempelwaarden,
      databronnen,
      dagvenster,
      dagenVooruit,
      minimaleSessieUren,
      scoreGewichten,
      favorieteLocaties,
      meldingen,
    },
    fouten,
  };
}

function voegFavorieteLocatieToe(profiel, ruweLocatie) {
  const { locatie, fouten } = valideerLocatie(ruweLocatie);
  if (!locatie) return { profiel, fouten };
  const bestaatAl = profiel.favorieteLocaties.some((l) => l.id === locatie.id);
  if (bestaatAl) return { profiel, fouten: ['Locatie staat al in favorieten'] };
  return {
    profiel: { ...profiel, favorieteLocaties: [...profiel.favorieteLocaties, locatie] },
    fouten: [],
  };
}

function verwijderFavorieteLocatie(profiel, locatieId) {
  return {
    ...profiel,
    favorieteLocaties: profiel.favorieteLocaties.filter((l) => l.id !== locatieId),
  };
}

module.exports = {
  standaardProfiel,
  standaardFavorieteLocaties,
  standaardDatabronnen,
  vulAanMetDefaults,
  valideerLocatie,
  valideerDagvenster,
  valideerDagenVooruit,
  valideerMinimaleSessieUren,
  valideerScoreGewichten,
  valideerMeldingen,
  valideerEnVulProfielAan,
  voegFavorieteLocatieToe,
  verwijderFavorieteLocatie,
};
