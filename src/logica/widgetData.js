// Pure logica voor de startscherm-widget (Code.gs bouwWidgetData_): zet de dagoordelen om in de
// compacte vorm die de Android-widget tekent — een overzicht per dag (oordeel, beste venster,
// wind) plus de uurreeks voor de grafiek van die dag. Geen GAS-afhankelijkheden; tijdstippen
// zijn naive lokale ISO-strings (Europe/Amsterdam), dus new Date(...).getHours() volstaat.

const { windrichtingKompas } = require('./eenheden');
const { formatDatumKort, INDICATIEF_VANAF_DAGINDEX } = require('./telegramFormat');

const WIDGET_DAG_LABELS = ['Vandaag', 'Morgen', 'Overmorgen'];
const WIDGET_VERDICT_PER_KLEUR = {
  groen: 'Goede kite-conditie',
  oranje: 'Matige kite-conditie',
  rood: 'Niet geschikt om te kiten',
};

/** "15:00", desgewenst een uur verschoven (%24 zodat 23u+1 netjes naar "00:00" wrapt). */
function widgetUurLabel(tijdstip, plusUur) {
  const uur = (new Date(tijdstip).getHours() + (plusUur || 0)) % 24;
  return (uur < 10 ? '0' : '') + uur + ':00';
}

function widgetRond(waarde) {
  return waarde != null ? Math.round(waarde) : null;
}

/**
 * Compacte uurreeks voor een widget-grafiek, alleen de uren startUur..eindUur (het vaste
 * grafiekvenster, zelfde als de Grafiek-tab van de webapp):
 * { uur, windKnopen, windvlaagKnopen, windrichtingGraden, kleur, neerslagMm }.
 */
function widgetUren(uurResultaten, startUur, eindUur) {
  return (uurResultaten || [])
    .filter((u) => {
      const uur = new Date(u.tijdstip).getHours();
      return uur >= startUur && uur <= eindUur;
    })
    .map((u) => {
      const ruw = u.ruw || {};
      return {
        uur: new Date(u.tijdstip).getHours(),
        windKnopen: widgetRond(ruw.windKnopen),
        windvlaagKnopen: widgetRond(ruw.windvlaagKnopen),
        windrichtingGraden: widgetRond(ruw.windrichtingGraden),
        kleur: u.kleur,
        neerslagMm: ruw.neerslagMm != null ? Math.round(ruw.neerslagMm * 10) / 10 : null,
      };
    });
}

/**
 * Eén dag voor de widget. `dagScore`: berekenDagScore over de volle dag (niet gefilterd op de
 * klok, zelfde als de dagkaart). Het venster telt alleen als de dag niet rood is — zelfde
 * maatstaf als de "volgende kans" en de dagkaart-badge.
 * @param {{ datum: string }} dag
 * @param {Object} dagScore
 * @param {number} dagIndex 0 = vandaag
 * @param {{ startUur: number, eindUur: number }} grafiekVenster
 */
function bouwWidgetDag(dag, dagScore, dagIndex, grafiekVenster) {
  const ruw = dagScore.besteUur ? dagScore.besteUur.ruw : null;
  const venster = dagScore.besteVenster && dagScore.kleur !== 'rood'
    ? {
      vanaf: widgetUurLabel(dagScore.besteVenster.startTijdstip, 0),
      // +1 uur: het laatste uur van het venster loopt tot het eind van dat uur.
      tot: widgetUurLabel(dagScore.besteVenster.eindTijdstip, 1),
    }
    : null;
  return {
    datum: dag.datum,
    dagLabel: WIDGET_DAG_LABELS[dagIndex] || formatDatumKort(dag.datum),
    datumKort: formatDatumKort(dag.datum),
    kleur: dagScore.kleur,
    score: dagScore.score,
    verdict: WIDGET_VERDICT_PER_KLEUR[dagScore.kleur] || dagScore.kleur,
    indicatief: dagIndex >= INDICATIEF_VANAF_DAGINDEX,
    venster: venster,
    windKnopen: ruw ? widgetRond(ruw.windKnopen) : null,
    windvlaagKnopen: ruw ? widgetRond(ruw.windvlaagKnopen) : null,
    windrichtingKompas: ruw && ruw.windrichtingGraden != null ? windrichtingKompas(ruw.windrichtingGraden) : null,
    uren: widgetUren(dagScore.uurResultaten, grafiekVenster.startUur, grafiekVenster.eindUur),
  };
}

module.exports = {
  WIDGET_VERDICT_PER_KLEUR,
  widgetUurLabel,
  widgetUren,
  bouwWidgetDag,
};
