// Pure logica: parseert de rauwe JSON-responses van elke databron (databronnen-kiteweer-app.md)
// naar een genormaliseerd formaat dat scoreBerekening.js/bronnenMiddeling.js verwacht.
// Geen UrlFetchApp hier — het ophalen gebeurt in src/gas/WeerData.gs, dat deze functies aanroept.

const { msNaarKnopen, dichtstbijzijnde, afstandKm } = require('./eenheden');
const { zonsopgangOndergang } = require('./zonstand');

/** WMO weather_code 95/96/99 = onweer (zie https://open-meteo.com/en/docs, WMO-tabel). */
function weerCodeIsOnweer(code) {
  return code === 95 || code === 96 || code === 99;
}

/**
 * Open-Meteo Forecast API — hoofdbron voor wind, onweer/buien, luchttemperatuur, zicht.
 * Verwacht dat de call is gedaan met `wind_speed_unit=kn` (zie WeerData.gs), zodat hier
 * geen conversie nodig is. `daily` (zonsopgang/-ondergang) is een aparte, dag-niveau reeks
 * naast de uurlijkse `hourly`-reeks — zie WeerData.gs (`&daily=sunrise,sunset`).
 */
function parseOpenMeteoForecast(json) {
  const h = (json && json.hourly) || {};
  const dagelijks = (json && json.daily) || {};
  const tijdstippen = h.time || [];
  return {
    bron: 'open-meteo',
    tijdstippen,
    windKnopen: h.wind_speed_10m || tijdstippen.map(() => null),
    windvlaagKnopen: h.wind_gusts_10m || tijdstippen.map(() => null),
    windrichtingGraden: h.wind_direction_10m || tijdstippen.map(() => null),
    onweerAanwezig: (h.weather_code || tijdstippen.map(() => null)).map(weerCodeIsOnweer),
    neerslagKans: (h.precipitation_probability || tijdstippen.map(() => null)).map((p) =>
      p == null ? null : p / 100
    ),
    // Neerslag in mm per uur — apart van neerslagKans (%): "70% kans" zegt niets over hoevéél er
    // valt, en juist die hoeveelheid bepaalt of een sessie nog leuk is. Buienradar's raintext
    // (parseBuienradarRaintext) geeft ook mm, maar slechts ~2 uur vooruit; Open-Meteo dekt de
    // volledige ingestelde horizon en is dus de bruikbare bron voor een uurlijkse regenverwachting.
    neerslagMm: h.precipitation || tijdstippen.map(() => null),
    luchttemperatuurCelsius: h.temperature_2m || tijdstippen.map(() => null),
    zichtKm: (h.visibility || tijdstippen.map(() => null)).map((m) => (m == null ? null : m / 1000)),
    bewolkingPercent: h.cloud_cover || tijdstippen.map(() => null),
    dagInfo: {
      datums: dagelijks.time || [],
      zonsopgang: dagelijks.sunrise || [],
      zonsondergang: dagelijks.sunset || [],
    },
  };
}

/**
 * Bright Sky (DWD-model, gratis, zonder sleutel) — RESERVEBRON voor Open-Meteo. Wordt alleen gebruikt
 * als Open-Meteo weigert (HTTP 429 "Daily API request limit exceeded": de gratis tier telt per
 * IP-adres en Apps Script deelt adressen, zie WeerData.gs) en levert dezelfde velden als
 * parseOpenMeteoForecast, zodat de rest van de pijplijn er niets van merkt. Verwacht een aanvraag met
 * `tz=Europe/Amsterdam` (lokale tijdstippen mét offset, zoals "2026-09-21T12:00:00+02:00") en de
 * standaardeenheden (km/u, mm, °C, meter zicht). Zonstanden ontbreken in Bright Sky en worden hier
 * berekend (zonstand.js) — de offset per dag komt uit de tijdstippen zelf.
 */
function parseBrightSkyForecast(json, lat, lon) {
  const uren = (json && json.weather) || [];
  const kmhNaarKnopen = (v) => (v == null ? null : Math.round((v / 1.852) * 10) / 10);
  const tijdstippen = uren.map((u) => String(u.timestamp).slice(0, 16));

  const offsetPerDatum = {};
  uren.forEach((u) => {
    const ts = String(u.timestamp);
    const datum = ts.slice(0, 10);
    const m = /([+-])(\d\d):(\d\d)$/.exec(ts);
    if (m && offsetPerDatum[datum] == null) {
      offsetPerDatum[datum] = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    }
  });
  const datums = Object.keys(offsetPerDatum);
  const zon = datums.map((d) => zonsopgangOndergang(lat, lon, d, offsetPerDatum[d]));

  return {
    bron: 'dwd-brightsky',
    tijdstippen,
    windKnopen: uren.map((u) => kmhNaarKnopen(u.wind_speed)),
    windvlaagKnopen: uren.map((u) => kmhNaarKnopen(u.wind_gust_speed)),
    windrichtingGraden: uren.map((u) => (u.wind_direction == null ? null : u.wind_direction)),
    onweerAanwezig: uren.map((u) => u.condition === 'thunderstorm'),
    neerslagKans: uren.map((u) => (u.precipitation_probability == null ? null : u.precipitation_probability / 100)),
    neerslagMm: uren.map((u) => (u.precipitation == null ? null : u.precipitation)),
    luchttemperatuurCelsius: uren.map((u) => (u.temperature == null ? null : u.temperature)),
    zichtKm: uren.map((u) => (u.visibility == null ? null : u.visibility / 1000)),
    bewolkingPercent: uren.map((u) => (u.cloud_cover == null ? null : u.cloud_cover)),
    dagInfo: {
      datums,
      zonsopgang: zon.map((z) => (z ? z.zonsopgang : null)),
      zonsondergang: zon.map((z) => (z ? z.zonsondergang : null)),
    },
  };
}

/** Open-Meteo Marine API — watertemperatuur en golfhoogte, wereldwijd op zee/kust. */
function parseOpenMeteoMarine(json) {
  const h = (json && json.hourly) || {};
  const tijdstippen = h.time || [];
  return {
    bron: 'open-meteo-marine',
    tijdstippen,
    watertemperatuurCelsius: h.sea_surface_temperature || tijdstippen.map(() => null),
    golfhoogteMeter: h.wave_height || tijdstippen.map(() => null),
  };
}

/**
 * Buienradar JSON-feed — actuele waarnemingen per meetstation (geen forecast).
 * Kiest het dichtstbijzijnde station t.o.v. de opgegeven lat/lon.
 */
function parseBuienradarFeed(json, lat, lon) {
  const stations = (json && json.actual && json.actual.stationmeasurements) || [];
  const station = dichtstbijzijnde(lat, lon, stations);
  if (!station) return null;
  return {
    bron: 'buienradar',
    tijdstip: station.timestamp,
    stationnaam: station.stationname,
    afstandKm: Math.round(afstandKm(lat, lon, station.lat, station.lon) * 10) / 10,
    windKnopen: msNaarKnopen(station.windspeed),
    windvlaagKnopen: msNaarKnopen(station.windgusts),
    windrichtingGraden: station.winddirectiondegrees != null ? station.winddirectiondegrees : null,
    luchttemperatuurCelsius: station.temperature != null ? station.temperature : null,
    zichtKm: station.visibility != null ? station.visibility / 1000 : null,
  };
}

/**
 * Buienradar raintext — neerslag-nowcasting per 5 min, komend ~2 uur. Regels: "waarde|HH:mm".
 * Conversie dBZ-achtige waarde -> mm/uur volgens de bekende Buienradar-formule.
 */
function parseBuienradarRaintext(tekst) {
  const regels = (tekst || '').split('\n').map((r) => r.trim()).filter(Boolean);
  return regels.map((regel) => {
    const [waardeStr, tijd] = regel.split('|');
    const waarde = Number(waardeStr);
    const mmPerUur = Number.isFinite(waarde) ? Math.pow(10, (waarde - 109) / 32) : null;
    return { tijd, mmPerUur };
  });
}

/**
 * Weerlive.nl API (v2, json-data-10min.php) — actuele waarneming + korte verwachting, alleen NL.
 * Vereist een gratis API-key (zie SETUP.md). Veldnamen zijn gebaseerd op de publieke Weerlive-
 * documentatie en zijn NIET getest tegen een live response (geen key beschikbaar tijdens bouw) —
 * zie "Aannames" in README.md. De GAS-laag vangt afwijkende/ontbrekende velden af (best effort:
 * bij een onverwachte vorm worden de betreffende waarden als niet-beschikbaar (null) behandeld,
 * zodat deze bron simpelweg wordt overgeslagen in de middeling i.p.v. de hele call te laten falen).
 */
function parseWeerlive(json) {
  const data = json && Array.isArray(json.liveweer) ? json.liveweer[0] : null;
  if (!data) return null;
  return {
    bron: 'weerlive',
    tijdstip: null,
    stationnaam: data.plaats || null,
    windKnopen: data.windknp != null ? Number(data.windknp) : null,
    windrichtingGraden: data.windrgr != null ? Number(data.windrgr) : null,
    luchttemperatuurCelsius: data.temp != null ? Number(data.temp) : null,
    zichtKm: data.zicht != null ? Number(data.zicht) : null,
  };
}

/**
 * Ontrafelt Windfinder's [tag, waarde]-tuple-formaat (hun eigen client-state-serialisatie) tot
 * gewone JS-waarden/objecten/arrays. Elk niveau — ook geneste objectvelden — kan zo'n tuple zijn.
 */
function ontrafelWindfinderTuple(node) {
  if (Array.isArray(node) && node.length === 2 && typeof node[0] === 'number') {
    return ontrafelWindfinderTuple(node[1]);
  }
  if (Array.isArray(node)) return node.map(ontrafelWindfinderTuple);
  if (node && typeof node === 'object') {
    const resultaat = {};
    Object.keys(node).forEach((k) => { resultaat[k] = ontrafelWindfinderTuple(node[k]); });
    return resultaat;
  }
  return node;
}

/**
 * Windfinder.com forecast-pagina (bv. https://www.windfinder.com/forecast/rockanje) — geen
 * publieke API, maar de volledige meerdaagse voorspelling (wind, golven, getij) staat als JSON
 * ingebakken in de server-gerenderde HTML zelf (voor hun eigen Astro-component-hydratie), in het
 * "props"-attribuut van het <astro-island> voor het "ForecastDataInit"-component. Geen losse
 * API-call of JavaScript-uitvoering nodig — één keer de paginabron parsen volstaat.
 * Waarden zijn in SI-eenheden (m/s, meter, Kelvin) ongeacht de weergave-eenheid van de site zelf.
 * Levert 3-uurlijkse punten (geen uurlijkse reeks zoals Open-Meteo).
 * Zie README.md "Aannames" voor de juridische afweging (robots.txt staat /forecast/ toe, maar
 * dat zegt niets over hergebruiksrecht van de data — bewust alleen gebruikt op uitdrukkelijk
 * verzoek, en uit te zetten via de bronnen-instelling in de app).
 */
function parseWindfinderForecast(html) {
  const match = /<astro-island[^>]*component-url="[^"]*ForecastDataInit[^"]*"[^>]*props="([^"]*)"/.exec(
    html || ''
  );
  if (!match) return null;

  let json;
  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    json = JSON.parse(decoded);
  } catch (e) {
    return null;
  }

  const dagen = (ontrafelWindfinderTuple(json.fcSectionData) || [])[0] || [];
  const uren = [];
  dagen.forEach((dag) => {
    (dag.horizons || []).forEach((horizon) => {
      const fc = horizon.fcData || {};
      if (!fc.dtl) return;
      uren.push({
        tijdstip: fc.dtl,
        windKnopen: fc.ws != null ? msNaarKnopen(fc.ws) : null,
        windvlaagKnopen: fc.wg != null ? msNaarKnopen(fc.wg) : null,
        windrichtingGraden: fc.wd != null ? fc.wd : null,
        golfhoogteMeter: fc.wah != null ? fc.wah : null,
      });
    });
  });
  uren.sort((a, b) => new Date(a.tijdstip).getTime() - new Date(b.tijdstip).getTime());

  return {
    bron: 'windfinder',
    tijdstippen: uren.map((u) => u.tijdstip),
    windKnopen: uren.map((u) => u.windKnopen),
    windvlaagKnopen: uren.map((u) => u.windvlaagKnopen),
    windrichtingGraden: uren.map((u) => u.windrichtingGraden),
    golfhoogteMeter: uren.map((u) => u.golfhoogteMeter),
  };
}

/** Haalt één ProcesType (bv. "meting" of "verwachting") uit een RWS OphalenWaarnemingen-respons. */
function kiesRwsProcesType(json, procesType) {
  const lijst = (json && json.WaarnemingenLijst) || [];
  const gekozen = lijst.filter((w) => w.AquoMetadata && w.AquoMetadata.ProcesType === procesType)[0];
  if (!gekozen) return { tijdstippen: [], waarden: [] };
  const metingen = gekozen.MetingenLijst || [];
  return {
    tijdstippen: metingen.map((m) => m.Tijdstip),
    waarden: metingen.map((m) => (m.Meetwaarde ? m.Meetwaarde.Waarde_Numeriek : null)),
  };
}

/**
 * Rijkswaterstaat meet naast getij ook wind (WINDSHD/WINDRTG) op hetzelfde meetpunt — zelfde
 * aanpak als Windfinder: ProcesType "verwachting" is een extra, onafhankelijke voorspellingsreeks
 * (eigen tijdstippen, per uur genaderd door forecastSamenstellen.js). Windrichting wordt op
 * exact tijdstip gekoppeld aan windsnelheid (aparte API-calls per grootheid, dus niet zomaar
 * index-voor-index uit te lijnen).
 */
function parseRwsWindVerwachting(windshdJson, windrtgJson) {
  const snelheid = kiesRwsProcesType(windshdJson, 'verwachting');
  const richting = kiesRwsProcesType(windrtgJson, 'verwachting');
  const richtingPerTijdstip = new Map();
  richting.tijdstippen.forEach((t, i) => richtingPerTijdstip.set(t, richting.waarden[i]));
  return {
    bron: 'rws-wind-verwachting',
    tijdstippen: snelheid.tijdstippen,
    windKnopen: snelheid.waarden.map((w) => (w != null ? msNaarKnopen(w) : null)),
    windrichtingGraden: snelheid.tijdstippen.map((t) => {
      const w = richtingPerTijdstip.get(t);
      return w != null ? w : null;
    }),
  };
}

/**
 * RWS wind-"meting" (ProcesType "meting") — de daadwerkelijk gemeten, actuele wind op het
 * meetpunt. Geen forecast-reeks maar één momentopname (het laatste meetpunt), net als
 * Buienradar/Weerlive: alleen bruikbaar als "nu"-cross-check.
 */
function parseRwsWindMeting(windshdJson, windrtgJson) {
  const snelheid = kiesRwsProcesType(windshdJson, 'meting');
  const richting = kiesRwsProcesType(windrtgJson, 'meting');
  if (snelheid.waarden.length === 0) return null;
  const laatsteWindKnopen = snelheid.waarden[snelheid.waarden.length - 1];
  const laatsteRichting = richting.waarden.length ? richting.waarden[richting.waarden.length - 1] : null;
  return {
    bron: 'rws-wind-meting',
    tijdstip: snelheid.tijdstippen[snelheid.tijdstippen.length - 1],
    windKnopen: laatsteWindKnopen != null ? msNaarKnopen(laatsteWindKnopen) : null,
    windrichtingGraden: laatsteRichting,
  };
}

module.exports = {
  weerCodeIsOnweer,
  parseOpenMeteoForecast,
  parseOpenMeteoMarine,
  parseBrightSkyForecast,
  parseBuienradarFeed,
  parseBuienradarRaintext,
  parseWeerlive,
  ontrafelWindfinderTuple,
  parseWindfinderForecast,
  kiesRwsProcesType,
  parseRwsWindVerwachting,
  parseRwsWindMeting,
};
