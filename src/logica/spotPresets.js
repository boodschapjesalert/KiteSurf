// Optionele spot-presets: bekende Nederlandse kitespots met een voorgestelde windrichting. Pure
// data + een zoekfunctie, bewust los van de rest (en dus makkelijk uit te breiden of leeg te laten).
//
// LET OP: dit zijn RICHTLIJNEN afgeleid uit de ligging van de kust, geen officiële spotinformatie.
// De app gebruikt ze alleen als vooringevulde startwaarde die de gebruiker altijd ziet en kan
// aanpassen. Controleer ze ter plekke / bij de kitesurfvereniging. Richtingen staan als
// kompaspunten (zie KOMPAS_PUNTEN in eenheden.js): `beste` = ideaal (aanlandig/schuin), `matig` =
// bruikbaar maar minder (bv. sterk zij-aflandig of zijwaarts). Aflandige wind hoort er nooit in.

const { KOMPAS_PUNTEN, afstandKm } = require('./eenheden');
const { sectorenNaarRanges } = require('./windrichtingKeuze');

// Een preset telt als match als de gezochte plek binnen deze afstand van het preset-punt ligt.
const PRESET_MAX_AFSTAND_KM = 3.5;

const SPOT_PRESETS = [
  { id: 'rockanje-sportstrand', naam: 'Rockanje Sportstrand', lat: 51.8723, lon: 4.0449, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW'] },
  { id: 'maasvlakte-2-slufter', naam: 'Maasvlakte 2 - Slufter', lat: 51.919, lon: 3.9882, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW'] },
  { id: 'hoek-van-holland', naam: 'Hoek van Holland strand', lat: 51.9795, lon: 4.1235, beste: ['W', 'WNW', 'NW'], matig: ['WZW', 'NNW'] },
  { id: 'kijkduin', naam: 'Kijkduin', lat: 52.0715, lon: 4.2185, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'scheveningen', naam: 'Scheveningen', lat: 52.1083, lon: 4.2736, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'noordwijk', naam: 'Noordwijk', lat: 52.2405, lon: 4.4335, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'zandvoort', naam: 'Zandvoort', lat: 52.3733, lon: 4.5300, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'ijmuiden', naam: 'IJmuiden', lat: 52.4636, lon: 4.5547, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'wijk-aan-zee', naam: 'Wijk aan Zee', lat: 52.4950, lon: 4.5950, beste: ['ZW', 'WZW', 'W', 'WNW', 'NW'], matig: ['ZZW', 'NNW'] },
  { id: 'cadzand-bad', naam: 'Cadzand-Bad', lat: 51.3750, lon: 3.3900, beste: ['WNW', 'NW', 'NNW', 'N'], matig: ['W', 'NNO'] },
];

function sectorNamenNaarIndexen(namen) {
  return (namen || []).map((n) => KOMPAS_PUNTEN.indexOf(n)).filter((i) => i >= 0);
}

/** Preset → `windrichting`-object (graden-ranges) zoals een favoriete spot dat opslaat. */
function presetNaarWindrichting(preset) {
  return {
    besteRanges: sectorenNaarRanges(sectorNamenNaarIndexen(preset.beste)),
    acceptabeleRanges: sectorenNaarRanges(sectorNamenNaarIndexen(preset.matig)),
  };
}

/**
 * Zoekt de dichtstbijzijnde preset binnen PRESET_MAX_AFSTAND_KM van (lat, lon); anders null.
 * `presets` is injecteerbaar (standaard SPOT_PRESETS) zodat een andere gebruiker/uitrol een eigen
 * lijst kan aanleveren.
 */
function zoekSpotPreset(lat, lon, presets) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  let beste = null;
  let besteAfstand = Infinity;
  (presets || SPOT_PRESETS).forEach((p) => {
    const d = afstandKm(Number(lat), Number(lon), p.lat, p.lon);
    if (d <= PRESET_MAX_AFSTAND_KM && d < besteAfstand) {
      beste = p;
      besteAfstand = d;
    }
  });
  return beste ? { preset: beste, windrichting: presetNaarWindrichting(beste), afstandKm: besteAfstand } : null;
}

module.exports = {
  SPOT_PRESETS,
  PRESET_MAX_AFSTAND_KM,
  presetNaarWindrichting,
  zoekSpotPreset,
};
