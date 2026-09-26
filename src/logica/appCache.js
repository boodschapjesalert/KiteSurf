// Pure logica voor de lokale opslag van weeroordelen in de Android-app (src/app/app.js), gedeeld
// met de backend (appApi.js) en — via de opslagsleutel — met de achtergrondtaak
// (KiteweerAchtergrond.java). Doel: de app toont meteen de laatst bewaarde voorspelling en
// ververst die stil op de achtergrond, i.p.v. bij elke locatiewissel te laten wachten.

// Zelfde prefix gebruikt KiteweerAchtergrond.java (SharedPreferences "CapacitorStorage").
const OORDEEL_OPSLAG_PREFIX = 'kiteweer_oordeel_';

// Jonger dan dit: niet opnieuw ophalen (de backend cachet de bronnen zelf 10-60 minuten).
const OORDEEL_VERS_MS = 15 * 60 * 1000;

/** Opslagsleutel per locatie; zelfde id-terugval als profielValidatie.valideerLocatie. */
function oordeelOpslagSleutel(locatie) {
  const id = locatie.id || Number(locatie.lat).toFixed(4) + ',' + Number(locatie.lon).toFixed(4);
  return OORDEEL_OPSLAG_PREFIX + id;
}

/** JSON met gesorteerde sleutels, zodat de volgorde van velden de hash niet beïnvloedt. */
function stabielJson(waarde) {
  if (Array.isArray(waarde)) return '[' + waarde.map(stabielJson).join(',') + ']';
  if (waarde && typeof waarde === 'object') {
    return '{' + Object.keys(waarde).sort()
      .filter((k) => waarde[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stabielJson(waarde[k])).join(',') + '}';
  }
  return JSON.stringify(waarde === undefined ? null : waarde);
}

/**
 * Vingerafdruk van alles waar een weeroordeel van afhangt: het profiel (zonder meldingen en de
 * favorietenlijst zelf) plus de locatie (positie en windrichtingen). Een bewaard oordeel met een
 * andere sleutel is met oude instellingen berekend en mag niet als "actueel" getoond worden.
 */
function oordeelSleutel(profiel, locatie) {
  const relevant = Object.assign({}, profiel || {});
  delete relevant.meldingen;
  delete relevant.favorieteLocaties;
  const tekst = stabielJson({
    profiel: relevant,
    lat: locatie.lat,
    lon: locatie.lon,
    windrichting: locatie.windrichting || null,
  });
  // djb2 (32 bit): klein, snel en overal gelijk (Node, Apps Script, WebView).
  let h = 5381;
  for (let i = 0; i < tekst.length; i++) h = ((h << 5) + h + tekst.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Bewaard oordeel bruikbaar maken voor nu: dagen vóór `vandaag` weglaten (een voorspelling van
 * gisteren begint anders met een dag die al voorbij is). null als er niets bruikbaars overblijft.
 * @param {{ opgehaald: number, sleutel: string, r: { dagen: Array<{datum: string}> } }} bewaard
 * @param {string} verwachteSleutel oordeelSleutel(profiel, locatie) van nu
 * @param {string} vandaag "YYYY-MM-DD"
 */
function bruikbaarBewaardOordeel(bewaard, verwachteSleutel, vandaag) {
  if (!bewaard || !bewaard.r || !Array.isArray(bewaard.r.dagen)) return null;
  if (bewaard.sleutel !== verwachteSleutel) return null;
  const dagen = bewaard.r.dagen.filter((d) => d && d.datum >= vandaag);
  if (dagen.length === 0) return null;
  return Object.assign({}, bewaard, { r: Object.assign({}, bewaard.r, { dagen }) });
}

function isOordeelVers(bewaard, nuMs) {
  return !!bewaard && typeof bewaard.opgehaald === 'number' && nuMs - bewaard.opgehaald < OORDEEL_VERS_MS;
}

module.exports = {
  OORDEEL_OPSLAG_PREFIX,
  OORDEEL_VERS_MS,
  oordeelOpslagSleutel,
  oordeelSleutel,
  bruikbaarBewaardOordeel,
  isOordeelVers,
};
