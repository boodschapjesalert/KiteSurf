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

function isUtcOfOffsetIso(s) {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
}

/**
 * Leest uur (0-23) uit een ISO-tijdstip. Naive lokale tijdstippen ("YYYY-MM-DDTHH:mm") worden
 * rechtstreeks uit de string gelezen (onafhankelijk van machine-tijdzone); tijdstippen mét Z of
 * tijdzone-offset worden via Date geconverteerd.
 */
function uurVanIso(tijdstip) {
  const s = String(tijdstip || '').trim();
  const m = /T(\d{2}):(\d{2})/.exec(s);
  if (m && !isUtcOfOffsetIso(s)) return Number(m[1]);
  return new Date(s).getHours();
}

/** Leest minuten sinds middernacht (0-1439) uit een ISO-tijdstip. */
function minutenVanIso(tijdstip) {
  const s = String(tijdstip || '').trim();
  const m = /T(\d{2}):(\d{2})/.exec(s);
  if (m && !isUtcOfOffsetIso(s)) return Number(m[1]) * 60 + Number(m[2]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}

/** Formatteert minuten sinds middernacht naar "HH:mm" (modulo 24 uur). */
function formatMinutenAlsTijd(minuten) {
  const genorm = ((Math.round(minuten) % 1440) + 1440) % 1440;
  const uu = Math.floor(genorm / 60);
  const mm = genorm % 60;
  return (uu < 10 ? '0' : '') + uu + ':' + (mm < 10 ? '0' : '') + mm;
}

module.exports = {
  msNaarKnopen,
  kmhNaarKnopen,
  afstandKm,
  dichtstbijzijnde,
  KOMPAS_PUNTEN,
  windrichtingKompas,
  uurVanIso,
  minutenVanIso,
  formatMinutenAlsTijd,
};
