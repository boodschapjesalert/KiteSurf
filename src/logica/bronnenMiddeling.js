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

function normHoek360(graden) {
  return ((graden % 360) + 360) % 360;
}

function kortsteHoekVerschil(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function circulairHoekGemiddelde(lijst) {
  let sinSom = 0;
  let cosSom = 0;
  lijst.forEach((b) => {
    const rad = (b.waarde * Math.PI) / 180;
    sinSom += Math.sin(rad);
    cosSom += Math.cos(rad);
  });
  // Exact tegengestelde richtingen (bv. 0 en 180) heffen elkaar op: val deterministisch terug.
  if (Math.hypot(sinSom, cosSom) < 1e-9) return lijst[0].waarde;
  return normHoek360((Math.atan2(sinSom, cosSom) * 180) / Math.PI);
}

/**
 * Circulair gemiddelde voor windrichtingen (0-360°), zodat waarden rond Noord (bv. 355° en 5°)
 * netjes naar ~0° middelen i.p.v. 180° (Zuid). Gebruikt hoekafwijking in graden voor uitschieters.
 */
function middelRichtingen(waardenPerBron, opties) {
  const uitschieterGraden = (opties && opties.uitschieterGraden) || 60;
  const beschikbaar = (waardenPerBron || [])
    .filter((b) => b && b.waarde != null && Number.isFinite(b.waarde))
    .map((b) => ({ bron: b.bron, waarde: normHoek360(b.waarde) }));

  if (beschikbaar.length === 0) {
    return { gemiddelde: null, gebruikteBronnen: [], genegeerdeBronnen: [] };
  }
  if (beschikbaar.length === 1) {
    return { gemiddelde: beschikbaar[0].waarde, gebruikteBronnen: [beschikbaar[0].bron], genegeerdeBronnen: [] };
  }

  const genegeerdeBronnen = [];
  let bruikbaar = beschikbaar.slice();
  while (bruikbaar.length > 2) {
    const gemiddeldeNu = circulairHoekGemiddelde(bruikbaar);
    let ergsteKandidaat = null;
    let ergsteAfwijking = 0;
    bruikbaar.forEach((b) => {
      const afwijking = kortsteHoekVerschil(b.waarde, gemiddeldeNu);
      if (afwijking > ergsteAfwijking) {
        ergsteAfwijking = afwijking;
        ergsteKandidaat = b;
      }
    });
    if (!ergsteKandidaat || ergsteAfwijking <= uitschieterGraden) break;
    genegeerdeBronnen.push(ergsteKandidaat.bron);
    bruikbaar = bruikbaar.filter((b) => b !== ergsteKandidaat);
  }

  return {
    gemiddelde: circulairHoekGemiddelde(bruikbaar),
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

module.exports = { middelWaarden, middelRichtingen, middelForecastPerVariabele };
