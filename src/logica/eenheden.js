// Pure logica: eenheid-conversies, gedeeld door de bron-parsers.

const KNOPEN_PER_MS = 1.9438444924;
const KNOPEN_PER_KMH = 0.5399568;

function msNaarKnopen(ms) {
  return ms == null ? null : ms * KNOPEN_PER_MS;
}

function kmhNaarKnopen(kmh) {
  return kmh == null ? null : kmh * KNOPEN_PER_KMH;
}

/** Haversine-afstand in kilometers tussen twee lat/lon-punten. */
function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Vindt het dichtstbijzijnde element in `punten` (elk met .lat/.lon) t.o.v. (lat, lon). */
function dichtstbijzijnde(lat, lon, punten) {
  if (!punten || punten.length === 0) return null;
  return punten.reduce((beste, p) => {
    const afstand = afstandKm(lat, lon, p.lat, p.lon);
    return !beste || afstand < beste.afstand ? { punt: p, afstand } : beste;
  }, null).punt;
}

const KOMPAS_PUNTEN = [
  'N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO',
  'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW',
];

/** Zet een windrichting in graden om naar het dichtstbijzijnde 16-punts kompaslabel (bv. "ZZW"). */
function windrichtingKompas(graden) {
  if (graden == null || Number.isNaN(graden)) return null;
  const g = ((graden % 360) + 360) % 360;
  return KOMPAS_PUNTEN[Math.round(g / 22.5) % 16];
}

module.exports = { msNaarKnopen, kmhNaarKnopen, afstandKm, dichtstbijzijnde, windrichtingKompas };
