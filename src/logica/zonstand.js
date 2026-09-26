// Pure logica: zonsopkomst/-ondergang berekenen uit coördinaten en datum (NOAA/Wikipedia-benadering,
// nauwkeurig tot ~1-2 minuten). Nodig omdat de reservebron voor het weer (Bright Sky/DWD, zie
// parseBrightSkyForecast in bronParsers.js) geen zonstanden meelevert, terwijl Open-Meteo dat wel
// deed — zonder deze berekening ontbreken in de app en in Telegram de zonsondergangstijd en de
// daglichtgrenzen zodra die reservebron inspringt.

const RAD = Math.PI / 180;

function formatLokaal(julianDag, utcOffsetMinuten) {
  const ms = (julianDag - 2440587.5) * 86400000 + utcOffsetMinuten * 60000;
  return new Date(ms).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm", zelfde vorm als Open-Meteo.
}

/**
 * @param {number} lat graden noord
 * @param {number} lon graden oost
 * @param {string} datum "YYYY-MM-DD" (lokale kalenderdatum)
 * @param {number} utcOffsetMinuten lokale offset t.o.v. UTC op die dag (bv. 120 voor CEST)
 * @returns {{zonsopgang: string, zonsondergang: string}|null} lokale tijden "YYYY-MM-DDTHH:mm", of
 *   null als de zon die dag niet op-/ondergaat (poolgebieden).
 */
function zonsopgangOndergang(lat, lon, datum, utcOffsetMinuten) {
  const [jaar, maand, dag] = datum.split('-').map(Number);
  const jd0 = Date.UTC(jaar, maand - 1, dag) / 86400000 + 2440587.5; // Juliaanse dag om 00:00 UTC.
  const n = Math.ceil(jd0 - 2451545.0 + 0.0008);
  const jSter = n - lon / 360; // Oostelijk = de zon staat eerder (UTC) op het hoogst.
  const M = (357.5291 + 0.98560028 * jSter) % 360;
  const Mr = M * RAD;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const lr = lambda * RAD;
  const jTransit = 2451545.0 + jSter + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
  const sinDecl = Math.sin(lr) * Math.sin(23.4397 * RAD);
  const decl = Math.asin(sinDecl);
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDecl) / (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  const H = Math.acos(cosH) / RAD;
  return {
    zonsopgang: formatLokaal(jTransit - H / 360, utcOffsetMinuten),
    zonsondergang: formatLokaal(jTransit + H / 360, utcOffsetMinuten),
  };
}

module.exports = { zonsopgangOndergang };
