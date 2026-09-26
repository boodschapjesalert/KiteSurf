// Pure logica: combineert meerdere databronnen tot één gemiddelde waarde per variabele,
// met uitschieter-detectie, zoals beschreven in databronnen-kiteweer-app.md ("Hoe combineren").

/**
 * Middelt een set brondwaarden voor één variabele op één tijdstip.
 * @param {Array<{bron: string, waarde: number|null|undefined}>} waardenPerBron
 * @param {{uitschieterDrempel?: number}} [opties] uitschieterDrempel = max relatieve afwijking
 *   t.o.v. het gemiddelde van de overige bronnen voordat een bron genegeerd wordt (default 0.4 = 40%).
 * @returns {{gemiddelde: number|null, gebruikteBronnen: string[], genegeerdeBronnen: string[]}}
 */
function middelWaarden(waardenPerBron, opties) {
  const uitschieterDrempel = (opties && opties.uitschieterDrempel) || 0.4;

  const beschikbaar = (waardenPerBron || []).filter(
    (b) => b && b.waarde != null && !Number.isNaN(b.waarde)
  );

  if (beschikbaar.length === 0) {
    return { gemiddelde: null, gebruikteBronnen: [], genegeerdeBronnen: [] };
  }
  if (beschikbaar.length === 1) {
    return {
      gemiddelde: beschikbaar[0].waarde,
      gebruikteBronnen: [beschikbaar[0].bron],
      genegeerdeBronnen: [],
    };
  }

  const genegeerdeBronnen = [];
  let bruikbaar = beschikbaar.slice();

  // Uitschieter-detectie: verwijder net zolang de bron met de grootste relatieve afwijking
  // t.o.v. het gemiddelde als deze boven de drempel zit. Met maar 2 bronnen kun je niet meer
  // bepalen wélke van de twee de uitschieter is, dus daaronder stopt de detectie.
  while (bruikbaar.length > 2) {
    const gemiddeldeNu = bruikbaar.reduce((s, b) => s + b.waarde, 0) / bruikbaar.length;
    let ergsteKandidaat = null;
    let ergsteAfwijking = 0;
    bruikbaar.forEach((b) => {
      const afwijking = gemiddeldeNu === 0 ? 0 : Math.abs(b.waarde - gemiddeldeNu) / Math.abs(gemiddeldeNu);
      if (afwijking > ergsteAfwijking) {
        ergsteAfwijking = afwijking;
        ergsteKandidaat = b;
      }
    });
    if (!ergsteKandidaat || ergsteAfwijking <= uitschieterDrempel) break;
    genegeerdeBronnen.push(ergsteKandidaat.bron);
    bruikbaar = bruikbaar.filter((b) => b !== ergsteKandidaat);
  }

  const gemiddelde = bruikbaar.reduce((s, b) => s + b.waarde, 0) / bruikbaar.length;
  return {
    gemiddelde,
    gebruikteBronnen: bruikbaar.map((b) => b.bron),
    genegeerdeBronnen,
  };
}

/**
 * Past middelWaarden toe op een volledige uurlijkse forecast-set: een object per variabele
 * met daarin een array van {bron, reeks: number[]} (reeks = per-uur waarden, gelijke lengte/tijdstippen).
 * @returns {Object} per variabele: { gemiddelde: (number|null)[], gebruikteBronnen, genegeerdeBronnen }
 */
function middelForecastPerVariabele(bronnenPerVariabele, opties) {
  const resultaat = {};
  Object.keys(bronnenPerVariabele || {}).forEach((variabele) => {
    const bronnen = bronnenPerVariabele[variabele] || [];
    const aantalUren = bronnen.reduce((max, b) => Math.max(max, (b.reeks || []).length), 0);
    const perUur = [];
    for (let uur = 0; uur < aantalUren; uur += 1) {
      const waardenPerBron = bronnen.map((b) => ({ bron: b.bron, waarde: (b.reeks || [])[uur] }));
      perUur.push(middelWaarden(waardenPerBron, opties));
    }
    resultaat[variabele] = {
      gemiddelde: perUur.map((u) => u.gemiddelde),
      gebruikteBronnen: perUur.map((u) => u.gebruikteBronnen),
      genegeerdeBronnen: perUur.map((u) => u.genegeerdeBronnen),
    };
  });
  return resultaat;
}

module.exports = { middelWaarden, middelForecastPerVariabele };
