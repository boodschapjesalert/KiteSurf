// Pure logica: parseert de Rijkswaterstaat WaterWebservices-respons (getij/waterstand) en
// classificeert per uur of het "hoog" of "laag" water is. RWS levert geen kant-en-klare
// hoog/laag-classificatie, dus die wordt hier afgeleid uit de min/max van de opgehaalde reeks.
// Zie databronnen-kiteweer-app.md en README.md "Aannames" voor de stationskeuze (Hoek van Holland
// dekt zowel Rockanje als Maasvlakte, de twee standaard-favorieten).

/**
 * Parseert de respons van POST .../ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen.
 * Kiest bij voorkeur ProcesType "verwachting" (met weersinvloed, beste match voor een
 * weersverwachting), valt terug op "astronomisch" als die ontbreekt.
 * @returns {{tijdstippen: string[], waterstandCm: number[]}}
 */
function parseRwsGetij(json) {
  var lijst = (json && json.WaarnemingenLijst) || [];
  var gekozen =
    lijst.filter(function (w) { return w.AquoMetadata && w.AquoMetadata.ProcesType === 'verwachting'; })[0] ||
    lijst.filter(function (w) { return w.AquoMetadata && w.AquoMetadata.ProcesType === 'astronomisch'; })[0];

  if (!gekozen) return { tijdstippen: [], waterstandCm: [] };

  var metingen = gekozen.MetingenLijst || [];
  return {
    tijdstippen: metingen.map(function (m) { return m.Tijdstip; }),
    waterstandCm: metingen.map(function (m) {
      return m.Meetwaarde ? m.Meetwaarde.Waarde_Numeriek : null;
    }),
  };
}

/**
 * Classificeert elk punt als 'hoog' of 'laag' t.o.v. het midden van de min/max-range van de
 * gegeven reeks. Eenvoudige, robuuste heuristiek — geen echte piek/dal-detectie nodig omdat
 * evalueerGetij() alleen een grove hoog/laag-voorkeur toetst, geen exact getij-tijdstip.
 * @param {number[]} waterstandCm
 * @returns {Array<'hoog'|'laag'|null>}
 */
function classificeerGetijStatus(waterstandCm) {
  var geldig = (waterstandCm || []).filter(function (w) { return w != null; });
  if (geldig.length === 0) return (waterstandCm || []).map(function () { return null; });

  var min = Math.min.apply(null, geldig);
  var max = Math.max.apply(null, geldig);
  var midden = (min + max) / 2;

  return (waterstandCm || []).map(function (w) {
    if (w == null) return null;
    return w >= midden ? 'hoog' : 'laag';
  });
}

module.exports = { parseRwsGetij, classificeerGetijStatus };
