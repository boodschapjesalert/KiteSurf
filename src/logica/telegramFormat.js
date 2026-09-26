// Pure logica: zet één dagoordeel (zie scoreBerekening.berekenDagScore + Code.gs
// bepaalDagOordelenVoorLocatie_) om in de tekst voor één Telegram-bericht — letterlijk dezelfde
// informatie als de ingeklapte dagkaart in de webapp (kleur, datum, verdict, score, wind/weer/
// getij/zonsondergang-badges, en de samenvattingszin), zodat de dagelijkse Telegram-samenvatting
// niet een eigen, magerdere versie van diezelfde informatie hoeft te tonen (zie Meldingen.gs).
//
// Geen GAS-afhankelijkheden (geen Utilities.formatDate): tijdstip-strings in dit project zijn
// naive lokale ISO-strings (Europe/Amsterdam, zie src/gas/appsscript.json "timeZone"), dus
// new Date(...).getHours() werkt hier hetzelfde als al in dagSamenvatting.js.

const { windrichtingKompas } = require('./eenheden');

const KORTE_DAGNAMEN_NL = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const KORTE_MAANDNAMEN_NL = [
  'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

/** "ma 31 aug" — zelfde stijl als de webapp (formatDatum in JavaScript.html). `datum`: "YYYY-MM-DD". */
function formatDatumKort(datum) {
  const [jaar, maand, dag] = String(datum).split('-').map(Number);
  // Middaguur in UTC: de kalenderdag/weekdag van een datum hangt daardoor niet af van waar dit
  // draait — voorkomt dat een tijdzoneverschil de datum een dag laat op- of terugschuiven.
  const d = new Date(Date.UTC(jaar, maand - 1, dag, 12));
  return KORTE_DAGNAMEN_NL[d.getUTCDay()] + ' ' + dag + ' ' + KORTE_MAANDNAMEN_NL[maand - 1];
}

const KLEUR_EMOJI = { groen: '🟢', oranje: '🟠', rood: '🔴' };
const KLEUR_NL = { groen: 'Goed', oranje: 'Matig', rood: 'Niet geschikt' };

function formatKleurEmoji(kleur) {
  return KLEUR_EMOJI[kleur] || '⚪';
}

function kleurNaarNl(kleur) {
  return KLEUR_NL[kleur] || kleur;
}

/** "18 kn uit WZW (vlagen 21 kn)" — tekstversie van de webapp's windbadge (bouwWindBadgeHtml). */
function formatWindTekst(ruw) {
  if (!ruw || ruw.windKnopen == null) return null;
  const kn = Math.round(ruw.windKnopen);
  const kompas = windrichtingKompas(ruw.windrichtingGraden);
  const vlaagTekst = ruw.windvlaagKnopen != null ? ' (vlagen ' + Math.round(ruw.windvlaagKnopen) + ' kn)' : '';
  return kn + ' kn' + (kompas != null ? ' uit ' + kompas : '') + vlaagTekst;
}

/** Tekstversie van de webapp's weerbadge (bouwWeerBadgeHtml): onweer > neerslagkans >= 30% > bewolking. */
function formatWeerTekst(ruw) {
  if (!ruw) return null;
  if (ruw.onweerAanwezig) return '⛈️ onweer';
  if (ruw.neerslagKans != null && ruw.neerslagKans >= 0.3) {
    return '🌧️ ' + Math.round(ruw.neerslagKans * 100) + '% regenkans';
  }
  if (ruw.bewolkingPercent != null) {
    const pct = Math.round(ruw.bewolkingPercent);
    const icoon = pct < 25 ? '☀️' : pct < 60 ? '🌤️' : pct < 85 ? '⛅' : '☁️';
    return icoon + ' ' + pct + '% bewolking';
  }
  return null;
}

/** Tekstversie van de webapp's getijbadge (bouwGetijBadgeHtml). */
function formatGetijTekst(ruw) {
  if (!ruw || ruw.getijStatus == null) return null;
  const icoon = ruw.getijStatus === 'hoog' ? '🌊↑' : '🌊↓';
  const cm = ruw.waterstandCm != null ? ' ' + Math.round(ruw.waterstandCm) + 'cm' : '';
  return icoon + cm;
}

/** "🌇 20:35" — zelfde icoon als de webapp; geen weersindicatie, alleen het tijdstip. */
function formatZonsondergangTekst(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const uu = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return '🌇 ' + uu + ':' + mm;
}

/**
 * Bouwt de volledige tekst voor één dag van één locatie — bedoeld als Telegram-bijschrift bij de
 * bijbehorende grafiek (zie Meldingen.gs: bouwDagGrafiekBlob_), letterlijk dezelfde informatie als
 * de ingeklapte dagkaart in de webapp: kleur + locatie + dag + datum op de kopregel, verdict + score
 * op de tweede regel, dan wind/weer/getij/zonsondergang als aparte opsommingsregels (i.p.v. één met
 * " · " aan elkaar geplakte regel — op gebruikersverzoek beter leesbaar in Telegram), dan een lege
 * regel en de samenvattingszin.
 * @param {{naam: string}} locatie
 * @param {Object} dagOordeel - één element uit bepaalDagOordelenVoorLocatie_ (Code.gs): heeft
 *   minimaal .datum, .dagScore, .samenvatting, .zonsondergang.
 * @param {string[]} [dagLabels] - bv. ['Vandaag', 'Morgen', 'Overmorgen'].
 * @param {number} [dagIndex]
 * @returns {string}
 */
// Vanaf de 5e dag (index 4) lopen de weermodellen gemiddeld enkele knopen uiteen (zie de modeltoetsing,
// ?actie=verificatie), dus dat oordeel is een indicatie en geen belofte. Zelfde grens in JavaScript.html.
const INDICATIEF_VANAF_DAGINDEX = 4;

function formatDagBalkTekst(locatie, dagOordeel, dagLabels, dagIndex) {
  const dagScore = dagOordeel.dagScore;
  const label = dagLabels && dagLabels[dagIndex] != null ? dagLabels[dagIndex] : formatDatumKort(dagOordeel.datum);

  const kop =
    formatKleurEmoji(dagScore.kleur) + ' 📍 ' + locatie.naam + ' — ' + label +
    ' (' + formatDatumKort(dagOordeel.datum) + ')';
  const verdict =
    kleurNaarNl(dagScore.kleur) + ' (' + dagScore.score + '/10)' + (dagIndex >= INDICATIEF_VANAF_DAGINDEX ? ' · indicatief' : '');

  const ruw = dagScore.besteUur ? dagScore.besteUur.ruw : null;
  const windTekst = formatWindTekst(ruw);
  const details = [
    windTekst != null ? '💨 ' + windTekst : null,
    formatWeerTekst(ruw),
    formatGetijTekst(ruw),
    formatZonsondergangTekst(dagOordeel.zonsondergang),
  ].filter(Boolean).map(function (regel) {
    return '• ' + regel;
  });

  const regels = [kop, verdict].concat(details);
  if (dagOordeel.samenvatting) regels.push('', dagOordeel.samenvatting);
  return regels.join('\n');
}

module.exports = {
  INDICATIEF_VANAF_DAGINDEX,
  formatDatumKort,
  formatKleurEmoji,
  kleurNaarNl,
  formatWindTekst,
  formatWeerTekst,
  formatGetijTekst,
  formatZonsondergangTekst,
  formatDagBalkTekst,
};
