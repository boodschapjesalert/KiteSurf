// Modulaire windrichting-keuze: één plek die de (opslag)graden-ranges van een spot omzet van/naar
// de 16 kompassectoren (N, NNO, ... NNW) waarmee een gebruiker ze het makkelijkst aanvinkt, en
// bepaalt hoe een windrichting getoond wordt (kompas OF graden — nooit beide tegelijk).
//
// Opslagformaat verandert NIET: `windrichting: { besteRanges, acceptabeleRanges }` in graden
// (zie drempelwaarden.evalueerWindrichting). Alles hier is een pure vertaallaag erbovenop, zodat
// de invoer-UI (kompas-vakjes of graden) en de weergave los van elkaar te kiezen zijn.

const { KOMPAS_PUNTEN, windrichtingKompas } = require('./eenheden');
const { inGradenBereik } = require('./drempelwaarden');

const WINDRICHTING_WEERGAVE_OPTIES = ['kompas', 'graden'];
const STANDAARD_WINDRICHTING_WEERGAVE = 'kompas';
const SECTOR_BREEDTE_GRADEN = 22.5;

// Stand van één kompassector: 0 = niet geschikt (hard no-go), 1 = beste, 2 = acceptabel.
const SECTOR_UIT = 0;
const SECTOR_BESTE = 1;
const SECTOR_ACCEPTABEL = 2;

function valideerWindrichtingWeergave(waarde, fallback) {
  if (WINDRICHTING_WEERGAVE_OPTIES.includes(waarde)) return waarde;
  return fallback != null ? fallback : STANDAARD_WINDRICHTING_WEERGAVE;
}

function normaliseerSectorGraden(graden) {
  return ((graden % 360) + 360) % 360;
}

/** Middelpunt (graden) van kompassector `index` (0 = N = 0°, 1 = NNO = 22.5°, ...). */
function sectorMidden(index) {
  return index * SECTOR_BREEDTE_GRADEN;
}

/**
 * Zet aangevinkte sector-indexen (0-15) om naar zo weinig mogelijk aaneengesloten graden-ranges,
 * elk als [start, eind] (start mag groter zijn dan eind: wikkelt dan over 0°/360°, zoals
 * inGradenBereik dat al ondersteunt). Alle 16 sectoren → één volledige cirkel [0, 360].
 */
function sectorenNaarRanges(sectorIndexen) {
  const aan = new Array(16).fill(false);
  (sectorIndexen || []).forEach((i) => {
    if (Number.isInteger(i) && i >= 0 && i < 16) aan[i] = true;
  });
  const aantal = aan.filter(Boolean).length;
  if (aantal === 0) return [];
  if (aantal === 16) return [[0, 360]];

  // Begin bij een sector die uit staat, zodat een reeks over N heen niet in tweeën gesplitst wordt.
  const begin = aan.findIndex((x) => !x);
  const ranges = [];
  let startIdx = null;
  for (let stap = 1; stap <= 16; stap++) {
    const i = (begin + stap) % 16;
    if (aan[i]) {
      if (startIdx === null) startIdx = i;
    } else if (startIdx !== null) {
      const eindIdx = (i + 15) % 16;
      ranges.push([
        normaliseerSectorGraden(sectorMidden(startIdx) - SECTOR_BREEDTE_GRADEN / 2),
        normaliseerSectorGraden(sectorMidden(eindIdx) + SECTOR_BREEDTE_GRADEN / 2),
      ]);
      startIdx = null;
    }
  }
  return ranges;
}

/** Omgekeerd: welke sectoren (middelpunt) vallen binnen één van de ranges. */
function rangesNaarSectorIndexen(ranges) {
  const resultaat = [];
  for (let i = 0; i < 16; i++) {
    const midden = sectorMidden(i);
    if ((ranges || []).some((r) => Array.isArray(r) && inGradenBereik(midden, r[0], r[1]))) resultaat.push(i);
  }
  return resultaat;
}

/** `windrichting` van een spot → array van 16 standen (SECTOR_UIT / SECTOR_BESTE / SECTOR_ACCEPTABEL). */
function windrichtingNaarSectorStanden(windrichting) {
  const standen = new Array(16).fill(SECTOR_UIT);
  const wr = windrichting || {};
  rangesNaarSectorIndexen(wr.acceptabeleRanges).forEach((i) => { standen[i] = SECTOR_ACCEPTABEL; });
  rangesNaarSectorIndexen(wr.besteRanges).forEach((i) => { standen[i] = SECTOR_BESTE; });
  return standen;
}

/** Array van 16 standen → `windrichting`-object zoals het opgeslagen wordt. */
function sectorStandenNaarWindrichting(standen) {
  const lijst = standen || [];
  const idx = (stand) => lijst.map((s, i) => (s === stand ? i : -1)).filter((i) => i >= 0);
  return {
    besteRanges: sectorenNaarRanges(idx(SECTOR_BESTE)),
    acceptabeleRanges: sectorenNaarRanges(idx(SECTOR_ACCEPTABEL)),
  };
}

/** Alle sector-indexen van `startIdx` met de klok mee t/m `eindIdx` (wikkelt over 0/N heen). */
function bereikSectorenMetKlokMee(startIdx, eindIdx) {
  const s = ((Math.trunc(startIdx) % 16) + 16) % 16;
  const e = ((Math.trunc(eindIdx) % 16) + 16) % 16;
  const resultaat = [s];
  let cur = s;
  while (cur !== e) {
    cur = (cur + 1) % 16;
    resultaat.push(cur);
  }
  return resultaat;
}

/**
 * Past een bereik (begin -> eind met de klok mee) toe op 16 sector-standen:
 * - 'slecht': dit bereik wordt niet-geschikt (0), alle overige richtingen worden beste (1)
 * - 'goed':   dit bereik wordt beste (1), alle overige richtingen worden niet-geschikt (0)
 * - 'matig':  dit bereik wordt matig/acceptabel (2), de rest blijft staan
 */
function pasBereikToeOpStanden(standen, startIdx, eindIdx, modus) {
  const gekozen = new Set(bereikSectorenMetKlokMee(startIdx, eindIdx));
  const huidige = Array.isArray(standen) && standen.length === 16 ? standen.slice() : new Array(16).fill(SECTOR_UIT);
  return huidige.map((waarde, i) => {
    if (modus === 'slecht') return gekozen.has(i) ? SECTOR_UIT : SECTOR_BESTE;
    if (modus === 'goed') return gekozen.has(i) ? SECTOR_BESTE : SECTOR_UIT;
    if (modus === 'matig') return gekozen.has(i) ? SECTOR_ACCEPTABEL : waarde;
    return waarde;
  });
}

/** Eén windrichting als tekst, naar voorkeur: 'kompas' → "ZW", 'graden' → "225°". Nooit beide. */
function formatWindrichting(graden, weergave) {
  if (graden == null || !Number.isFinite(Number(graden))) return null;
  if (weergave === 'graden') return Math.round(normaliseerSectorGraden(Number(graden))) + '°';
  return windrichtingKompas(Number(graden));
}

function graadTekst(g) {
  return String(Math.round(normaliseerSectorGraden(g) * 10) / 10).replace('.', ',') + '°';
}

/** Samenvatting van ranges, bv. kompas: "ZZW t/m NW", graden: "191,3° – 326,3°"; leeg → "geen". */
function formatRanges(ranges, weergave) {
  const geldig = (ranges || []).filter((r) => Array.isArray(r) && r.length === 2);
  if (geldig.length === 0) return 'geen';
  if (geldig.some((r) => Math.abs(r[1] - r[0]) >= 360)) return 'alle richtingen';
  if (weergave === 'graden') return geldig.map((r) => graadTekst(r[0]) + ' – ' + graadTekst(r[1])).join(', ');
  // Kompas: per aaneengesloten reeks sectoren "A t/m B" (of één sector "A").
  const indexen = rangesNaarSectorIndexen(geldig);
  const aan = new Array(16).fill(false);
  indexen.forEach((i) => { aan[i] = true; });
  if (indexen.length === 0) return 'geen';
  const begin = aan.findIndex((x) => !x);
  const delen = [];
  let startIdx = null;
  for (let stap = 1; stap <= 16; stap++) {
    const i = (begin + stap) % 16;
    if (aan[i]) {
      if (startIdx === null) startIdx = i;
    } else if (startIdx !== null) {
      const eindIdx = (i + 15) % 16;
      delen.push(startIdx === eindIdx ? KOMPAS_PUNTEN[startIdx] : KOMPAS_PUNTEN[startIdx] + ' t/m ' + KOMPAS_PUNTEN[eindIdx]);
      startIdx = null;
    }
  }
  return delen.join(', ');
}

/** Korte tekst voor een spot: "Beste: ZZW t/m NW · Matig: –". */
function formatWindrichtingSamenvatting(windrichting, weergave) {
  const wr = windrichting || {};
  const beste = formatRanges(wr.besteRanges, weergave);
  const acceptabel = formatRanges(wr.acceptabeleRanges, weergave);
  return 'Beste: ' + beste + (acceptabel !== 'geen' ? ' · Matig: ' + acceptabel : '');
}

module.exports = {
  WINDRICHTING_WEERGAVE_OPTIES,
  STANDAARD_WINDRICHTING_WEERGAVE,
  SECTOR_UIT,
  SECTOR_BESTE,
  SECTOR_ACCEPTABEL,
  valideerWindrichtingWeergave,
  sectorenNaarRanges,
  rangesNaarSectorIndexen,
  windrichtingNaarSectorStanden,
  sectorStandenNaarWindrichting,
  bereikSectorenMetKlokMee,
  pasBereikToeOpStanden,
  formatWindrichting,
  formatRanges,
  formatWindrichtingSamenvatting,
};
