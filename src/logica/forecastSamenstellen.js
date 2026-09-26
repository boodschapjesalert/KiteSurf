// Pure logica: voegt de genormaliseerde output van bronParsers.js per uur samen tot de
// uurData-structuur die scoreBerekening.berekenUurScore/berekenDagScore verwacht, en middelt
// daarbij over de beschikbare bronnen (zie bronnenMiddeling.js).
//
// Open-Meteo (forecast + marine) is de enige bron met een echte 3-daagse uurlijkse reeks en
// vormt daarom de tijdlijn. Buienradar/Weerlive leveren alleen een actuele waarneming ("nu") en
// worden uitsluitend meegemiddeld op het uur dat het dichtst bij het huidige tijdstip ligt —
// conform "Vandaag/nu" in databronnen-kiteweer-app.md.

const { middelWaarden } = require('./bronnenMiddeling');
const { classificeerGetijStatus } = require('./rwsGetij');

function vindDichtstbijzijndUurIndex(tijdstippenIso, huidigTijdstipIso) {
  if (!huidigTijdstipIso || !tijdstippenIso || tijdstippenIso.length === 0) return -1;
  const nu = new Date(huidigTijdstipIso).getTime();
  let besteIndex = -1;
  let besteVerschil = Infinity;
  tijdstippenIso.forEach((t, i) => {
    const verschil = Math.abs(new Date(t).getTime() - nu);
    if (verschil < besteVerschil) {
      besteVerschil = verschil;
      besteIndex = i;
    }
  });
  return besteIndex;
}

function indexeerOpTijdstip(reeks) {
  const map = new Map();
  (reeks && reeks.tijdstippen ? reeks.tijdstippen : []).forEach((t, i) => map.set(t, i));
  return map;
}

/**
 * Bouwt een opzoekfunctie voor een bron met een eigen (grovere) tijdreeks dan Open-Meteo's
 * uurlijkse tijdlijn — geeft de index van het dichtstbijzijnde punt terug, of -1 als niets
 * binnen `maxAfstandMs` ligt. Gebruikt voor Windfinder en de RWS-windverwachting.
 */
function maakNaburigeIndexZoeker(bron, maxAfstandMs) {
  return function (doelTijdstipIso) {
    if (!bron || !bron.tijdstippen || bron.tijdstippen.length === 0) return -1;
    const dichtstbijIndex = vindDichtstbijzijndUurIndex(bron.tijdstippen, doelTijdstipIso);
    if (dichtstbijIndex === -1) return -1;
    const afstandMs = Math.abs(
      new Date(bron.tijdstippen[dichtstbijIndex]).getTime() - new Date(doelTijdstipIso).getTime()
    );
    return afstandMs <= maxAfstandMs ? dichtstbijIndex : -1;
  };
}

/**
 * @param {Object} bronnen
 *   - openMeteo: output van parseOpenMeteoForecast (verplicht, vormt de tijdlijn)
 *   - openMeteoMarine: output van parseOpenMeteoMarine (optioneel)
 *   - buienradar: output van parseBuienradarFeed (optioneel, "nu"-snapshot)
 *   - weerlive: output van parseWeerlive (optioneel, "nu"-snapshot)
 *   - knmi: output van parseKnmiWaarnemingen (optioneel, "nu"-snapshot; officiële KNMI-meting, levert
 *     naast wind ook een gemeten windvlaag)
 *   - windfinder: output van parseWindfinderForecast (optioneel; eigen 3-uurlijkse tijdstippen)
 *   - rwsWindVerwachting: output van parseRwsWindVerwachting (optioneel; extra windvoorspelling)
 *   - rwsWindMeting: output van parseRwsWindMeting (optioneel, "nu"-snapshot, actuele wind)
 *   - rwsGetij: output van parseRwsGetij (optioneel; eigen tijdstippen, meestal elke 10 min)
 *   - huidigTijdstipIso: ISO-tijdstip van "nu", om buienradar/weerlive op het juiste uur te plakken
 * @param {Object} [middelingOpties] doorgegeven aan middelWaarden (bv. uitschieterDrempel)
 * @returns {Array<{tijdstip: string, uurData: Object, bronDetails: Object}>}
 */
function samenstellenUrenData(bronnen, middelingOpties) {
  const openMeteo = bronnen.openMeteo || { tijdstippen: [] };
  // Naam van de bron die de tijdlijn levert: normaal 'open-meteo', maar de reserve (Bright Sky/DWD)
  // levert dezelfde vorm en moet eerlijk zo heten in "Wind-databronnen voor deze dag".
  const hoofdbron = openMeteo.bron || 'open-meteo';
  const tijdstippen = openMeteo.tijdstippen || [];
  const marineIndex = indexeerOpTijdstip(bronnen.openMeteoMarine);
  const nuIndex = vindDichtstbijzijndUurIndex(tijdstippen, bronnen.huidigTijdstipIso);

  // RWS levert eigen tijdstippen (meestal 10-minutenreeks), dus per Open-Meteo-uur wordt de
  // dichtstbijzijnde RWS-classificatie opgezocht i.p.v. een exacte tijdstip-match.
  const rwsGetij = bronnen.rwsGetij;
  const getijStatusPerRwsTijdstip = rwsGetij ? classificeerGetijStatus(rwsGetij.waterstandCm) : [];
  const rwsGetijIndexVoorTijdstip = maakNaburigeIndexZoeker(rwsGetij, 60 * 60 * 1000);
  // Naast de hoog/laag-classificatie (voor de voorkeur-evaluatie, zie drempelwaarden.evalueerGetij)
  // ook de ruwe waterstand (cm) teruggeven, zodat de UI een concrete, actuele waterstand kan tonen
  // los van of de gebruiker al een voorkeur heeft ingesteld — zie README.md "Aannames".
  function getijInfoVoorTijdstip(doelTijdstipIso) {
    const index = rwsGetijIndexVoorTijdstip(doelTijdstipIso);
    if (index === -1) return { status: null, waterstandCm: null };
    return {
      status: getijStatusPerRwsTijdstip[index],
      waterstandCm: rwsGetij.waterstandCm[index] != null ? rwsGetij.waterstandCm[index] : null,
    };
  }

  // Windfinder en de RWS-windverwachting leveren allebei een eigen (geen uurlijkse) reeks — geen
  // "nu"-snapshot zoals Buienradar/Weerlive, wel een echte meerdaagse voorspelling zoals
  // Open-Meteo — per Open-Meteo-uur wordt het dichtstbijzijnde punt gezocht.
  const windfinder = bronnen.windfinder;
  const windfinderIndexVoorTijdstip = maakNaburigeIndexZoeker(windfinder, 90 * 60 * 1000);
  const rwsWindVerwachting = bronnen.rwsWindVerwachting;
  const rwsWindIndexVoorTijdstip = maakNaburigeIndexZoeker(rwsWindVerwachting, 60 * 60 * 1000);

  return tijdstippen.map((tijdstip, i) => {
    const isNu = i === nuIndex;
    const windfinderI = windfinderIndexVoorTijdstip(tijdstip);
    const getijInfo = getijInfoVoorTijdstip(tijdstip);

    const windBronnen = [{ bron: hoofdbron, waarde: openMeteo.windKnopen[i] }];
    const windrichtingBronnen = [{ bron: hoofdbron, waarde: openMeteo.windrichtingGraden[i] }];
    const windvlaagBronnen = [{ bron: hoofdbron, waarde: openMeteo.windvlaagKnopen[i] }];
    const luchttempBronnen = [{ bron: hoofdbron, waarde: openMeteo.luchttemperatuurCelsius[i] }];
    const zichtBronnen = [{ bron: hoofdbron, waarde: openMeteo.zichtKm[i] }];

    const marineI = marineIndex.get(tijdstip);
    const marine = bronnen.openMeteoMarine;
    const golfhoogteBronnen =
      marineI != null ? [{ bron: 'open-meteo-marine', waarde: marine.golfhoogteMeter[marineI] }] : [];

    if (isNu && bronnen.buienradar) {
      windBronnen.push({ bron: 'buienradar', waarde: bronnen.buienradar.windKnopen });
      windrichtingBronnen.push({ bron: 'buienradar', waarde: bronnen.buienradar.windrichtingGraden });
      luchttempBronnen.push({ bron: 'buienradar', waarde: bronnen.buienradar.luchttemperatuurCelsius });
      zichtBronnen.push({ bron: 'buienradar', waarde: bronnen.buienradar.zichtKm });
    }
    // KNMI-meting: de officiële 10-minutenwaarneming van het dichtstbijzijnde station. Alleen op het
    // "nu"-uur (het is een meting, geen voorspelling). Levert als enige "nu"-bron ook een gemeten vlaag.
    if (isNu && bronnen.knmi) {
      windBronnen.push({ bron: 'knmi-waarneming', waarde: bronnen.knmi.windKnopen });
      windrichtingBronnen.push({ bron: 'knmi-waarneming', waarde: bronnen.knmi.windrichtingGraden });
      windvlaagBronnen.push({ bron: 'knmi-waarneming', waarde: bronnen.knmi.windvlaagKnopen });
      luchttempBronnen.push({ bron: 'knmi-waarneming', waarde: bronnen.knmi.luchttemperatuurCelsius });
      zichtBronnen.push({ bron: 'knmi-waarneming', waarde: bronnen.knmi.zichtKm });
    }
    if (isNu && bronnen.weerlive) {
      windBronnen.push({ bron: 'weerlive', waarde: bronnen.weerlive.windKnopen });
      windrichtingBronnen.push({ bron: 'weerlive', waarde: bronnen.weerlive.windrichtingGraden });
      luchttempBronnen.push({ bron: 'weerlive', waarde: bronnen.weerlive.luchttemperatuurCelsius });
      zichtBronnen.push({ bron: 'weerlive', waarde: bronnen.weerlive.zichtKm });
    }
    if (windfinderI !== -1) {
      windBronnen.push({ bron: 'windfinder', waarde: windfinder.windKnopen[windfinderI] });
      windrichtingBronnen.push({ bron: 'windfinder', waarde: windfinder.windrichtingGraden[windfinderI] });
      windvlaagBronnen.push({ bron: 'windfinder', waarde: windfinder.windvlaagKnopen[windfinderI] });
      golfhoogteBronnen.push({ bron: 'windfinder', waarde: windfinder.golfhoogteMeter[windfinderI] });
    }
    const rwsWindI = rwsWindIndexVoorTijdstip(tijdstip);
    if (rwsWindI !== -1) {
      windBronnen.push({ bron: 'rws-wind-verwachting', waarde: rwsWindVerwachting.windKnopen[rwsWindI] });
      windrichtingBronnen.push({ bron: 'rws-wind-verwachting', waarde: rwsWindVerwachting.windrichtingGraden[rwsWindI] });
    }
    // RWS-"meting" is een echte actuele waarneming (geen voorspelling) — zoals Buienradar/Weerlive
    // alleen op het "nu"-uur meegewogen, als extra onafhankelijke cross-check van de actuele wind.
    if (isNu && bronnen.rwsWindMeting) {
      windBronnen.push({ bron: 'rws-wind-meting', waarde: bronnen.rwsWindMeting.windKnopen });
      windrichtingBronnen.push({ bron: 'rws-wind-meting', waarde: bronnen.rwsWindMeting.windrichtingGraden });
    }

    const windMiddeling = middelWaarden(windBronnen, middelingOpties);
    const windrichtingMiddeling = middelWaarden(windrichtingBronnen, middelingOpties);
    const windvlaagMiddeling = middelWaarden(windvlaagBronnen, middelingOpties);
    const luchttempMiddeling = middelWaarden(luchttempBronnen, middelingOpties);
    const zichtMiddeling = middelWaarden(zichtBronnen, middelingOpties);
    const golfhoogteMiddeling = middelWaarden(golfhoogteBronnen, middelingOpties);

    return {
      tijdstip,
      uurData: {
        windKnopen: windMiddeling.gemiddelde,
        windvlaagKnopen: windvlaagMiddeling.gemiddelde,
        windrichtingGraden: windrichtingMiddeling.gemiddelde,
        onweerAanwezig: openMeteo.onweerAanwezig[i],
        neerslagKans: openMeteo.neerslagKans[i],
        neerslagMm: openMeteo.neerslagMm ? openMeteo.neerslagMm[i] : null,
        bewolkingPercent: openMeteo.bewolkingPercent ? openMeteo.bewolkingPercent[i] : null,
        luchttemperatuurCelsius: luchttempMiddeling.gemiddelde,
        watertemperatuurCelsius: marineI != null ? marine.watertemperatuurCelsius[marineI] : null,
        golfhoogteMeter: golfhoogteMiddeling.gemiddelde,
        getijStatus: getijInfo.status,
        waterstandCm: getijInfo.waterstandCm,
        zichtKm: zichtMiddeling.gemiddelde,
      },
      bronDetails: {
        wind: windMiddeling,
        windrichting: windrichtingMiddeling,
        windvlagen: windvlaagMiddeling,
        luchttemperatuur: luchttempMiddeling,
        zicht: zichtMiddeling,
        golfhoogte: golfhoogteMiddeling,
      },
    };
  });
}

/** Groepeert een urenData-array (van samenstellenUrenData) per kalenderdag (YYYY-MM-DD, lokale tijd in het ISO-tijdstip). */
function groepeerPerDag(urenData) {
  const perDag = new Map();
  (urenData || []).forEach((uur) => {
    const datum = (uur.tijdstip || '').slice(0, 10);
    if (!perDag.has(datum)) perDag.set(datum, []);
    perDag.get(datum).push(uur);
  });
  return Array.from(perDag.entries()).map(([datum, uren]) => ({ datum, uren }));
}

/**
 * Unieke, daadwerkelijk gebruikte windbron-namen (bv. 'open-meteo', 'windfinder') over alle uren
 * van één dag (zoals gegroepeerd door groepeerPerDag) — laat per dag zien welke bronnen echt
 * hebben bijgedragen. Bedoeld voor transparantie bij een instelbare voorspellingshorizon (zie
 * profielValidatie.dagenVooruit): bronnen met een kortere eigen horizon (Windfinder, RWS) vallen
 * voor verdere dagen vanzelf weg uit bronnenMiddeling, dus dit toont concreet, niet aangenomen,
 * welke bronnen een dag nog dekken (zie README.md "Aannames").
 * @param {Array<{bronDetails: Object}>} uren
 * @returns {string[]}
 */
function windBronnenVanDag(uren) {
  const bronnenSet = new Set();
  (uren || []).forEach((uur) => {
    const gebruikt = (uur.bronDetails && uur.bronDetails.wind && uur.bronDetails.wind.gebruikteBronnen) || [];
    gebruikt.forEach((bron) => bronnenSet.add(bron));
  });
  return Array.from(bronnenSet);
}

/**
 * Zoekt zonsopgang/-ondergang (ISO-tijdstippen) voor één kalenderdag op in Open-Meteo's
 * `dagInfo` (zie parseOpenMeteoForecast) — een aparte dag-niveau reeks naast de uurlijkse
 * tijdlijn, dus hier op datum (niet op uur-index) opgezocht.
 * @param {{datums: string[], zonsopgang: string[], zonsondergang: string[]}} [dagInfo]
 * @param {string} datum YYYY-MM-DD
 */
function zonInfoVoorDatum(dagInfo, datum) {
  const index = dagInfo && dagInfo.datums ? dagInfo.datums.indexOf(datum) : -1;
  if (index === -1) return { zonsopgang: null, zonsondergang: null };
  return {
    zonsopgang: dagInfo.zonsopgang[index] != null ? dagInfo.zonsopgang[index] : null,
    zonsondergang: dagInfo.zonsondergang[index] != null ? dagInfo.zonsondergang[index] : null,
  };
}

module.exports = {
  vindDichtstbijzijndUurIndex,
  samenstellenUrenData,
  groepeerPerDag,
  windBronnenVanDag,
  zonInfoVoorDatum,
};
