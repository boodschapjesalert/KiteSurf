// Pure logica voor de Android-app (zie README.md "Android-app"): de app bewaart het profiel
// lokaal op de telefoon en stuurt het bij elk verzoek mee — de backend is voor de app dus
// stateless (geen Drive-profiel, geen gebruikers-ID). Dit bestand bevat alles wat daarvoor
// zonder GAS-afhankelijkheden kan: het routeren/valideren van een app-verzoek, en het bepalen
// welke Android-meldingen er moeten verschijnen. De I/O (weerdata ophalen, geocoding) komt via
// het `diensten`-object binnen, dat Code.gs invult (zie verwerkAppApiVerzoek_).

const { valideerEnVulProfielAan, valideerLocatie } = require('./profielValidatie');
const { formatDatumKort, formatKleurEmoji, kleurNaarNl, formatWindTekst } = require('./telegramFormat');

const APP_DAG_LABELS = ['Vandaag', 'Morgen', 'Overmorgen'];

// Zelfde nachtrust als de Telegram-directe-alert (Meldingen.gs: isStilUur_): 22:30-07:00.
const APP_STIL_UUR_START_MINUUT = 22 * 60 + 30;
const APP_STIL_UUR_EIND_MINUUT = 7 * 60;

// De telefoon controleert (via Android WorkManager) ongeveer elk kwartier, maar Android kan dat
// uitstellen (Doze, batterijbesparing). Een samenvatting die pas uren na het gekozen tijdstip aan
// de beurt komt is niet meer zinvol ("goedemorgen" om 15:00) — na dit venster slaan we 'm voor
// vandaag over i.p.v. alsnog te sturen.
const SAMENVATTING_VENSTER_MINUTEN = 3 * 60;

const APP_ACTIES = ['weeroordeel', 'vergelijk', 'zoekLocatie', 'deelLink', 'achtergrond'];

function isAppStilUur(minutenNu) {
  return minutenNu >= APP_STIL_UUR_START_MINUUT || minutenNu < APP_STIL_UUR_EIND_MINUUT;
}

function appDagLabel(dagIndex, datum) {
  return APP_DAG_LABELS[dagIndex] || formatDatumKort(datum);
}

/** Profiel van de telefoon: altijd opnieuw valideren/aanvullen, nooit blind vertrouwen. */
function normaliseerAppProfiel(ruwProfiel) {
  if (!ruwProfiel || typeof ruwProfiel !== 'object' || Array.isArray(ruwProfiel)) return null;
  return valideerEnVulProfielAan(ruwProfiel, null).profiel;
}

/**
 * "Vergelijk locaties": vandaag voor elke favoriet. Zelfde vorm als vergelijkFavorieteLocaties
 * in Code.gs (dat deze functie ook gebruikt), zodat de front-end niet hoeft te weten of het
 * profiel uit Drive of van de telefoon komt.
 * @param {Object} profiel
 * @param {(profiel: Object, locatie: Object, dagen: number) => Array<Object>} dagOordelenFn
 */
function bouwVergelijking(profiel, dagOordelenFn) {
  return (profiel.favorieteLocaties || []).map(function (locatie) {
    let vandaag;
    try {
      vandaag = dagOordelenFn(profiel, locatie, 1)[0];
    } catch (fout) {
      return { locatieId: locatie.id, naam: locatie.naam, fout: 'Kon weerdata niet ophalen' };
    }
    if (!vandaag) return { locatieId: locatie.id, naam: locatie.naam, fout: 'Geen weerdata beschikbaar' };
    const ruw = vandaag.dagScore.besteUur ? vandaag.dagScore.besteUur.ruw : null;
    return {
      locatieId: locatie.id,
      naam: locatie.naam,
      kleur: vandaag.dagScore.kleur,
      score: vandaag.dagScore.score,
      ruw: ruw
        ? { windKnopen: ruw.windKnopen, windrichtingGraden: ruw.windrichtingGraden, windvlaagKnopen: ruw.windvlaagKnopen }
        : null,
    };
  });
}

/** Eén regel per dag voor de samenvatting-melding: "🟢 Vandaag (za 26 sep): Goed 8/10 · 18 kn uit ZW". */
function formatAppDagRegel(dagOordeel, dagIndex) {
  const dagScore = dagOordeel.dagScore;
  const ruw = dagScore.besteUur ? dagScore.besteUur.ruw : null;
  const wind = formatWindTekst(ruw);
  return formatKleurEmoji(dagScore.kleur) + ' ' + appDagLabel(dagIndex, dagOordeel.datum) +
    ' (' + formatDatumKort(dagOordeel.datum) + '): ' + kleurNaarNl(dagScore.kleur) + ' ' + dagScore.score + '/10' +
    (wind ? ' · ' + wind : '');
}

/**
 * Bepaalt welke Android-meldingen de telefoon nu moet tonen, en de bijgewerkte meldingsstatus
 * die de telefoon daarna bewaart. Zelfde regels als de Telegram-meldingen (Meldingen.gs):
 * - Dagelijkse samenvatting: één keer per dag, vanaf het gekozen tijdstip (en uiterlijk
 *   SAMENVATTING_VENSTER_MINUTEN daarna), één melding per favoriete locatie.
 * - Directe alert: per locatie én per datum hooguit één keer zodra een dag binnen de horizon
 *   "groen" wordt; niet tijdens de nachtrust (dan uitgesteld, niet gemist). Een eenmaal gemelde
 *   datum blijft onthouden, ook als de kleur tussendoor terugzakt (geen herhaal-alerts).
 *
 * @param {Object} invoer
 * @param {Array<{locatie: {id: string, naam: string}, dagOordelen: Array<Object>|null}>} invoer.locaties
 *   dagOordelen `null` = ophalen mislukt voor die locatie.
 * @param {{dagelijkseSamenvatting: boolean, samenvattingUur: number, samenvattingMinuut: number, directeAlert: boolean}} invoer.instellingen
 * @param {{laatstGemeld?: Object, laatsteSamenvattingDatum?: string|null}} [invoer.status]
 * @param {string} invoer.vandaag - "YYYY-MM-DD" (Europe/Amsterdam)
 * @param {number} invoer.minutenNu - minuten sinds middernacht (Europe/Amsterdam)
 * @returns {{meldingen: Array<Object>, status: {laatstGemeld: Object, laatsteSamenvattingDatum: string|null}}}
 */
function bepaalAppMeldingen(invoer) {
  const instellingen = invoer.instellingen || {};
  const status = invoer.status && typeof invoer.status === 'object' ? invoer.status : {};
  const vandaag = invoer.vandaag;
  const minutenNu = invoer.minutenNu;
  const locaties = invoer.locaties || [];

  const oudeLaatstGemeld =
    status.laatstGemeld && typeof status.laatstGemeld === 'object' && !Array.isArray(status.laatstGemeld)
      ? status.laatstGemeld
      : {};
  const nieuweStatus = {
    laatstGemeld: {},
    laatsteSamenvattingDatum: typeof status.laatsteSamenvattingDatum === 'string' ? status.laatsteSamenvattingDatum : null,
  };
  const meldingen = [];

  // --- Dagelijkse samenvatting ---
  const gekozenMinuten = (instellingen.samenvattingUur || 0) * 60 + (instellingen.samenvattingMinuut || 0);
  const samenvattingNu =
    instellingen.dagelijkseSamenvatting &&
    nieuweStatus.laatsteSamenvattingDatum !== vandaag &&
    minutenNu >= gekozenMinuten &&
    minutenNu < gekozenMinuten + SAMENVATTING_VENSTER_MINUTEN;
  if (samenvattingNu) {
    let ietsVerstuurd = false;
    locaties.forEach(function (item) {
      if (!item.dagOordelen || item.dagOordelen.length === 0) return;
      ietsVerstuurd = true;
      const eerste = item.dagOordelen[0];
      const regels = item.dagOordelen.map(formatAppDagRegel);
      if (eerste.samenvatting) regels.push('', eerste.samenvatting);
      meldingen.push({
        soort: 'samenvatting',
        locatieId: item.locatie.id,
        datum: vandaag,
        kleur: eerste.dagScore.kleur,
        titel: '📅 ' + item.locatie.naam,
        kortTekst: regels[0],
        tekst: regels.join('\n'),
      });
    });
    // Alleen afvinken als er echt iets te melden was — lukte het ophalen overal niet, dan
    // probeert de volgende controle (binnen het venster) het gewoon opnieuw.
    if (ietsVerstuurd) nieuweStatus.laatsteSamenvattingDatum = vandaag;
  }

  // --- Directe alert ---
  const alertsAan = instellingen.directeAlert === true;
  const stil = isAppStilUur(minutenNu);
  locaties.forEach(function (item) {
    const oudeHistorie = oudeLaatstGemeld[item.locatie.id];
    const historie = oudeHistorie && typeof oudeHistorie === 'object' && !Array.isArray(oudeHistorie) ? oudeHistorie : {};
    if (!item.dagOordelen) {
      // Ophalen mislukt: historie ongewijzigd laten (anders zou een datum opnieuw alerten).
      nieuweStatus.laatstGemeld[item.locatie.id] = historie;
      return;
    }
    const nieuweHistorie = {};
    item.dagOordelen.forEach(function (dagOordeel, dagIndex) {
      if (dagOordeel.datum < vandaag) return;
      const algemeld = !!historie[dagOordeel.datum];
      const groen = dagOordeel.dagScore.kleur === 'groen';
      // Buiten de nachtrust/met alerts uit: groen niet als "gemeld" vastleggen, zodat hij na
      // 07:00 (of na het aanzetten) alsnog als nieuw geldt.
      const magMelden = alertsAan && !stil;
      if (groen && !algemeld && magMelden) {
        const ruw = dagOordeel.dagScore.besteUur ? dagOordeel.dagScore.besteUur.ruw : null;
        const wind = formatWindTekst(ruw);
        const kop = appDagLabel(dagIndex, dagOordeel.datum) + ' (' + formatDatumKort(dagOordeel.datum) + '): ' +
          kleurNaarNl('groen') + ' ' + dagOordeel.dagScore.score + '/10' + (wind ? ' · ' + wind : '');
        meldingen.push({
          soort: 'alert',
          locatieId: item.locatie.id,
          datum: dagOordeel.datum,
          kleur: 'groen',
          titel: '⚡ Kitesurf alert — ' + item.locatie.naam,
          kortTekst: kop,
          tekst: dagOordeel.samenvatting ? kop + '\n\n' + dagOordeel.samenvatting : kop,
        });
      }
      if (algemeld || (groen && magMelden)) nieuweHistorie[dagOordeel.datum] = true;
    });
    nieuweStatus.laatstGemeld[item.locatie.id] = nieuweHistorie;
  });

  return { meldingen: meldingen, status: nieuweStatus };
}

/**
 * Routeert één app-verzoek (POST-body van de Android-app, zie Code.gs doPost). Valideert de
 * invoer en roept de juiste dienst aan. Geeft altijd een plat object terug; bij een fout
 * `{ fout: '...' }` (zelfde conventie als de google.script.run-functies van de webapp).
 *
 * @param {Object} verzoek - bv. `{ actie: 'weeroordeel', profiel: {...}, locatie: {...} }`
 * @param {Object} diensten
 * @param {(profiel: Object, locatie: Object, dagen: number) => Array<Object>} diensten.dagOordelen
 * @param {(profiel: Object, locatie: Object) => Object} diensten.widget
 * @param {(zoekterm: string) => Array<Object>} diensten.zoekLocatie
 * @param {() => {url: string}} diensten.deelLink
 * @param {() => {vandaag: string, minutenNu: number}} diensten.nu
 */
function verwerkAppVerzoek(verzoek, diensten) {
  if (!verzoek || typeof verzoek !== 'object' || APP_ACTIES.indexOf(verzoek.actie) === -1) {
    return { fout: 'Onbekende of ontbrekende actie' };
  }

  if (verzoek.actie === 'zoekLocatie') {
    const term = typeof verzoek.zoekterm === 'string' ? verzoek.zoekterm : '';
    return { resultaten: diensten.zoekLocatie(term) };
  }
  if (verzoek.actie === 'deelLink') {
    return diensten.deelLink();
  }

  const profiel = normaliseerAppProfiel(verzoek.profiel);
  if (!profiel) return { fout: 'Ontbrekend of ongeldig profiel' };

  if (verzoek.actie === 'weeroordeel') {
    const { locatie, fouten } = valideerLocatie(verzoek.locatie);
    if (!locatie) return { fout: 'Ongeldige locatie: ' + fouten.join(', ') };
    return { dagen: diensten.dagOordelen(profiel, locatie, profiel.dagenVooruit) };
  }

  if (verzoek.actie === 'vergelijk') {
    return { locaties: bouwVergelijking(profiel, diensten.dagOordelen) };
  }

  // 'achtergrond': één aanroep voor de periodieke Android-taak — widget-gegevens + meldingen.
  const favorieten = profiel.favorieteLocaties || [];
  if (favorieten.length === 0) {
    return { widget: { fout: 'Geen favoriete locaties' }, meldingen: [], status: verzoek.status || {} };
  }
  const widgetLocatie = favorieten.filter(function (l) { return l.id === verzoek.widgetLocatieId; })[0] || favorieten[0];

  let widget;
  try {
    widget = diensten.widget(profiel, widgetLocatie);
  } catch (fout) {
    widget = { fout: 'Kon weerdata niet ophalen', spotnaam: widgetLocatie.naam };
  }

  const meldingenAan = profiel.meldingen.dagelijkseSamenvatting || profiel.meldingen.directeAlert;
  if (!meldingenAan) {
    // Meldingen uit: niets berekenen, en de bestaande status ongemoeid laten (anders zou
    // weer aanzetten dezelfde dagen opnieuw melden).
    return { widget: widget, meldingen: [], status: verzoek.status || {} };
  }
  const locaties = favorieten.map(function (locatie) {
    let dagOordelen = null;
    try {
      dagOordelen = diensten.dagOordelen(profiel, locatie, profiel.dagenVooruit);
    } catch (fout) {
      dagOordelen = null;
    }
    return { locatie: locatie, dagOordelen: dagOordelen };
  });
  const tijd = diensten.nu();
  const meldingResultaat = bepaalAppMeldingen({
    locaties: locaties,
    instellingen: profiel.meldingen,
    status: verzoek.status,
    vandaag: tijd.vandaag,
    minutenNu: tijd.minutenNu,
  });

  return { widget: widget, meldingen: meldingResultaat.meldingen, status: meldingResultaat.status };
}

module.exports = {
  APP_ACTIES,
  SAMENVATTING_VENSTER_MINUTEN,
  isAppStilUur,
  normaliseerAppProfiel,
  bouwVergelijking,
  bepaalAppMeldingen,
  verwerkAppVerzoek,
};
