// Pure logica: zet het dagoordeel (zie scoreBerekening.berekenDagScore) om in één leesbare
// Nederlandse zin, zodat je niet eerst een grafiek hoeft te interpreteren om te weten of het
// vandaag de moeite waard is. Bewust hier en niet in de front-end: het is echte tekstlogica
// (trends, drempels, meervoudsvormen) die je wilt kunnen testen zonder browser, en zo kan ook
// de Telegram-melding er later dezelfde zin uit halen.

/** Regen onder deze drempel is verwaarloosbaar (motregen) en wordt niet gemeld. */
const REGEN_DREMPEL_MM = 0.2;

function uurVan(tijdstip) {
  return new Date(tijdstip).getHours();
}

function formatUur(tijdstip) {
  const uur = uurVan(tijdstip);
  return (uur < 10 ? '0' + uur : String(uur)) + ':00';
}

/**
 * Beschrijft het verloop van de wind ná het beste venster: neemt hij af, trekt hij aan, of blijft
 * hij gelijk? Vergelijkt het gemiddelde van de uren ná het venster met dat van het venster zelf.
 * @returns {'af'|'toe'|'gelijk'|null} null als er geen uren ná het venster zijn.
 */
function bepaalWindTrendNaVenster(urenNaVenster, venstergemiddeldeKnopen) {
  const knopenNa = (urenNaVenster || [])
    .map((u) => (u.ruw ? u.ruw.windKnopen : null))
    .filter((kn) => kn != null);
  if (knopenNa.length === 0 || venstergemiddeldeKnopen == null) return null;

  const gemiddeldeNa = knopenNa.reduce((som, kn) => som + kn, 0) / knopenNa.length;
  const verschil = gemiddeldeNa - venstergemiddeldeKnopen;
  // Onder ~2 knopen verschil is "het neemt af" een overdreven conclusie voor een voorspelling.
  if (Math.abs(verschil) < 2) return 'gelijk';
  return verschil < 0 ? 'af' : 'toe';
}

/**
 * Vat de regenverwachting binnen het dagvenster samen. Groepeert aaneengesloten regenuren tot
 * losse buien, zodat een onderbroken dag niet als één lange regenperiode wordt gepresenteerd:
 * "tussen 09:00 en 18:00" terwijl het tussendoor droog is, zou de dag onterecht afschrijven.
 * Uren onder REGEN_DREMPEL_MM tellen niet mee (motregen).
 *
 * Elke bui krijgt een `totTijdstip` = het láátste regenuur; de leesbare eindtijd is dat uur + 1
 * (het uur "11:00" beslaat 11:00-12:00), net als bij de windperiode.
 * @returns {{buien: Array<{vanafTijdstip, totTijdstip, mm}>, totaalMm: number}|null}
 *   null als het droog blijft.
 */
function vatRegenSamen(uren) {
  const buien = [];
  let huidige = null;

  (uren || []).forEach((u, index) => {
    const mm = u.ruw ? u.ruw.neerslagMm : null;
    if (mm == null || mm < REGEN_DREMPEL_MM) {
      huidige = null; // droog uur breekt de bui af
      return;
    }
    // Aansluitend = direct opeenvolgend in de urenreeks (zelfde aanpak als vindBesteVenster);
    // bij een gat in de reeks begint dus een nieuwe bui.
    if (huidige && huidige.laatsteIndex === index - 1) {
      huidige.totTijdstip = u.tijdstip;
      huidige.mm += mm;
      huidige.laatsteIndex = index;
    } else {
      huidige = { vanafTijdstip: u.tijdstip, totTijdstip: u.tijdstip, mm, laatsteIndex: index };
      buien.push(huidige);
    }
  });

  if (buien.length === 0) return null;

  return {
    buien: buien.map((b) => ({
      vanafTijdstip: b.vanafTijdstip,
      totTijdstip: b.totTijdstip,
      mm: Math.round(b.mm * 10) / 10,
    })),
    totaalMm: Math.round(buien.reduce((som, b) => som + b.mm, 0) * 10) / 10,
  };
}

/** Uur ná het gegeven tijdstip, als "HH:00" — een uur "11:00" loopt immers tot 12:00. */
function formatEindUur(tijdstip) {
  const eind = (uurVan(tijdstip) + 1) % 24;
  return (eind < 10 ? '0' + eind : String(eind)) + ':00';
}

/**
 * Zet de regensamenvatting om in een leesbare zin met begin- én eindtijd. Bij meerdere buien
 * worden er hooguit twee genoemd; daarboven wordt het een samenvattende "met onderbrekingen".
 */
function formatRegenZin(regen) {
  if (!regen) return '';
  const buien = regen.buien;

  function periode(b) {
    return formatUur(b.vanafTijdstip) + '-' + formatEindUur(b.totTijdstip);
  }

  // Eén periode leest natuurlijker met "en" (zelfde vorm als de windzin ervoor); bij een opsomming
  // van twee zou dat een dubbel "en" geven, dus daar het compactere streepje.
  if (buien.length === 1) {
    const b = buien[0];
    return ' Tussen ' + formatUur(b.vanafTijdstip) + ' en ' + formatEindUur(b.totTijdstip) +
      ' valt ' + regen.totaalMm + ' mm regen.';
  }
  if (buien.length === 2) {
    return ' Regen tussen ' + periode(buien[0]) + ' en ' + periode(buien[1]) +
      ', samen ' + regen.totaalMm + ' mm.';
  }
  return ' Met onderbrekingen regen tussen ' + formatUur(buien[0].vanafTijdstip) + ' en ' +
    formatEindUur(buien[buien.length - 1].totTijdstip) + ', samen ' + regen.totaalMm + ' mm.';
}

function gemiddeldeWindKnopen(uren) {
  const knopen = (uren || []).map((u) => (u.ruw ? u.ruw.windKnopen : null)).filter((kn) => kn != null);
  if (knopen.length === 0) return null;
  return knopen.reduce((som, kn) => som + kn, 0) / knopen.length;
}

/**
 * Bouwt één samenvattende zin over de dag, bv.:
 *   "Tussen 09:00 en 12:00 lijkt de wind goed (18-22 kn), daarna neemt het af. Vanaf 11:00 wordt
 *    8 mm regen verwacht."
 * @param {Object} dagScore - resultaat van berekenDagScore (met besteVenster/urenInVenster)
 * @param {{dagvensterStartUur?: number, dagvensterEindUur?: number}} [opties] - alleen gebruikt om
 *   het "geen sessie"-geval te formuleren; het venster zelf komt uit dagScore.
 * @returns {string}
 */
function bouwDagSamenvatting(dagScore, opties) {
  if (!dagScore || !dagScore.uurResultaten || dagScore.uurResultaten.length === 0) {
    return 'Geen weerdata beschikbaar voor deze dag.';
  }

  const startUur = (opties && opties.dagvensterStartUur) != null ? opties.dagvensterStartUur : 6;
  const eindUur = (opties && opties.dagvensterEindUur) != null ? opties.dagvensterEindUur : 21;
  const urenInDagvenster = dagScore.uurResultaten.filter((u) => {
    const uur = uurVan(u.tijdstip);
    return uur >= startUur && uur <= eindUur;
  });
  const regenZin = formatRegenZin(vatRegenSamen(urenInDagvenster));

  if (!dagScore.besteVenster) {
    // Onderscheid maakt uit voor wat je eraan kunt doen: een harde no-go (te weinig/te veel wind,
    // verkeerde richting, onweer) is iets anders dan wind die simpelweg te kort goed is.
    const basis = dagScore.noGo
      ? 'Vandaag geen geschikt moment om te kiten.'
      : 'Geen aaneengesloten periode lang genoeg om te kiten vandaag.';
    return basis + regenZin;
  }

  const urenVenster = dagScore.urenInVenster || [];
  const knopenInVenster = urenVenster
    .map((u) => (u.ruw ? u.ruw.windKnopen : null))
    .filter((kn) => kn != null)
    .map(Math.round);

  let windBereik = '';
  if (knopenInVenster.length > 0) {
    const min = Math.min.apply(null, knopenInVenster);
    const max = Math.max.apply(null, knopenInVenster);
    windBereik = min === max ? ' (' + min + ' kn)' : ' (' + min + '-' + max + ' kn)';
  }

  const eindUurVenster = uurVan(dagScore.besteVenster.eindTijdstip);
  const urenNaVenster = urenInDagvenster.filter((u) => uurVan(u.tijdstip) > eindUurVenster);
  const trend = bepaalWindTrendNaVenster(urenNaVenster, gemiddeldeWindKnopen(urenVenster));
  const trendZin = trend === 'af' ? ', daarna neemt het af'
    : trend === 'toe' ? ', daarna trekt het verder aan'
    : '';

  // Eindtijdstip is het láátste uur van het venster; de sessie loopt tot het eind van dat uur,
  // dus +1 uur voor een natuurlijk leesbare periode ("09:00 en 12:00" bij uren 9, 10, 11).
  const eindWeergave = (eindUurVenster + 1) % 24;
  const eindTekst = (eindWeergave < 10 ? '0' + eindWeergave : String(eindWeergave)) + ':00';

  return (
    'Tussen ' + formatUur(dagScore.besteVenster.startTijdstip) + ' en ' + eindTekst +
    ' lijkt de wind goed' + windBereik + trendZin + '.' + regenZin
  );
}

module.exports = {
  REGEN_DREMPEL_MM,
  bepaalWindTrendNaVenster,
  vatRegenSamen,
  formatRegenZin,
  bouwDagSamenvatting,
};
