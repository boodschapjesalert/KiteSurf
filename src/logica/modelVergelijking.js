// Pure logica voor de dagelijkse TOETSING van de weermodellen: per spot leggen we elke ochtend vast wat
// elk model voor dag 1 t/m 7 voorspelt (windgemiddelde en hoogste vlaag tussen 09:00 en 19:00), en
// zetten dat later naast wat het dichtstbijzijnde KNMI-station daadwerkelijk mat. Zo is na een paar
// weken te zien welk model op welke voorspeldag structureel te hoog of te laag zit — i.p.v. blind één
// bron te vertrouwen. Geen UrlFetchApp/Drive hier; zie src/gas/Verificatie.gs.

const { msNaarKnopen, kmhNaarKnopen } = require('./eenheden');

// De weermodellen die Open-Meteo in ÉÉN aanvraag kan teruggeven ("models="-parameter). De volgorde is
// de kolomvolgorde in de rapportage. DWD (Bright Sky) komt er apart bij, als 'dwd_brightsky'.
const VERIFICATIE_MODELLEN = [
  'knmi_harmonie_arome_netherlands',
  'icon_seamless',
  'ecmwf_ifs025',
  'gfs_seamless',
  'meteofrance_seamless',
  'gem_seamless',
];
const VERIFICATIE_VAN_UUR = 9;
const VERIFICATIE_TOT_UUR = 19;
const VERIFICATIE_DAGEN = 7;
// Een dag telt pas mee als er genoeg uren zijn om een gemiddelde te vertrouwen (van de 11 in het venster).
const MIN_UREN_PER_DAG = 6;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Laatste zondag van een maand (0-11) in een jaar, als dag-van-de-maand. */
function laatsteZondag(jaar, maand) {
  const laatsteDag = new Date(Date.UTC(jaar, maand + 1, 0));
  return laatsteDag.getUTCDate() - laatsteDag.getUTCDay();
}

/**
 * Offset van Europe/Amsterdam t.o.v. UTC in minuten op een UTC-tijdstip (zomertijd tussen de laatste
 * zondag van maart en die van oktober, beide om 01:00 UTC). Zelf uitgeschreven i.p.v. Intl, want
 * Apps Script's Intl-ondersteuning voor tijdzones is niet iets om op te vertrouwen.
 */
function amsterdamOffsetMinuten(datumUtc) {
  const d = new Date(datumUtc);
  const jaar = d.getUTCFullYear();
  const start = Date.UTC(jaar, 2, laatsteZondag(jaar, 2), 1, 0, 0);
  const eind = Date.UTC(jaar, 9, laatsteZondag(jaar, 9), 1, 0, 0);
  const t = d.getTime();
  return t >= start && t < eind ? 120 : 60;
}

/** UTC-tijdstip (ISO, "…Z") -> lokale datum en uur in Europe/Amsterdam. */
function lokaleDatumUur(isoUtc) {
  const ms = new Date(isoUtc).getTime();
  const lokaal = new Date(ms + amsterdamOffsetMinuten(ms) * 60000);
  return {
    datum: lokaal.getUTCFullYear() + '-' + pad2(lokaal.getUTCMonth() + 1) + '-' + pad2(lokaal.getUTCDate()),
    uur: lokaal.getUTCHours(),
  };
}

/** Voegt dagen toe aan een "YYYY-MM-DD"-datum (kalenderrekenen, dus zomertijd-veilig). */
function plusDagen(datum, dagen) {
  const [j, m, d] = datum.split('-').map(Number);
  const nieuw = new Date(Date.UTC(j, m - 1, d + dagen));
  return nieuw.getUTCFullYear() + '-' + pad2(nieuw.getUTCMonth() + 1) + '-' + pad2(nieuw.getUTCDate());
}

/** Het UTC-venster ("van"/"tot", ISO) van één lokale kalenderdag, voor een waarnemingen-opvraging. */
function lokaleDagAlsUtcVenster(datum) {
  const [j, m, d] = datum.split('-').map(Number);
  const middernachtAlsUtc = Date.UTC(j, m - 1, d, 0, 0, 0);
  const van = middernachtAlsUtc - amsterdamOffsetMinuten(middernachtAlsUtc) * 60000;
  const volgende = Date.UTC(j, m - 1, d + 1, 0, 0, 0);
  const tot = volgende - amsterdamOffsetMinuten(volgende) * 60000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
  return { van: iso(van), tot: iso(tot) };
}

/**
 * Bright Sky (DWD MOSMIX) in de compacte vorm van brightSkyTaak_ -> zelfde vorm als een model uit
 * parseMultiModel. Bright Sky levert km/h met lokale tijdstippen ("2026-09-21T09:00:00+02:00").
 */
function parseBrightSkyAlsModel(compact) {
  const uren = (compact && compact.weather) || [];
  return {
    tijdstippen: uren.map((u) => String(u.timestamp).slice(0, 16)),
    wind: uren.map((u) => (u.wind_speed == null ? null : kmhNaarKnopen(u.wind_speed))),
    vlaag: uren.map((u) => (u.wind_gust_speed == null ? null : kmhNaarKnopen(u.wind_gust_speed))),
  };
}

/**
 * Open-Meteo-respons met meerdere modellen -> { modelnaam: { tijdstippen, wind, vlaag } }. Bij
 * `models=a,b` heten de reeksen `wind_speed_10m_a`, `wind_gusts_10m_b`, enz.
 */
function parseMultiModel(json) {
  const h = (json && json.hourly) || {};
  const tijdstippen = h.time || [];
  const uit = {};
  Object.keys(h).forEach((sleutel) => {
    const m = /^wind_speed_10m_(.+)$/.exec(sleutel);
    if (!m) return;
    const model = m[1];
    uit[model] = {
      tijdstippen,
      wind: h[sleutel],
      vlaag: h['wind_gusts_10m_' + model] || tijdstippen.map(() => null),
    };
  });
  return uit;
}

function rond(x) {
  return Math.round(x * 10) / 10;
}

/**
 * Per lokale datum: gemiddelde wind (w) en hoogste vlaag (g) tussen VAN_UUR en TOT_UUR (inclusief),
 * in knopen. Dagen met te weinig uren worden overgeslagen.
 * @param {string[]} tijdstippenLokaal "YYYY-MM-DDTHH:mm" (lokale tijd)
 * @returns {Object<string, {w: number, g: number|null, n: number}>}
 */
function dagStatistiek(tijdstippenLokaal, wind, vlaag) {
  const perDag = {};
  (tijdstippenLokaal || []).forEach((t, i) => {
    const uur = Number(String(t).slice(11, 13));
    if (uur < VERIFICATIE_VAN_UUR || uur > VERIFICATIE_TOT_UUR) return;
    if (wind[i] == null) return;
    const dag = String(t).slice(0, 10);
    const item = perDag[dag] || (perDag[dag] = { winden: [], vlagen: [] });
    item.winden.push(wind[i]);
    if (vlaag && vlaag[i] != null) item.vlagen.push(vlaag[i]);
  });
  const uit = {};
  Object.keys(perDag).forEach((dag) => {
    const { winden, vlagen } = perDag[dag];
    if (winden.length < MIN_UREN_PER_DAG) return;
    uit[dag] = {
      w: rond(winden.reduce((a, b) => a + b, 0) / winden.length),
      g: vlagen.length ? rond(Math.max(...vlagen)) : null,
      n: winden.length,
    };
  });
  return uit;
}

/**
 * Eén "snapshot": wat elk model op `vandaag` voorspelde voor vandaag t/m vandaag+6.
 * @param {Object<string, {tijdstippen: string[], wind: number[], vlaag: number[]}>} modellen
 * @returns {{d: string, l: string, s: string, sn: string, m: Object<string, Array<{w: number, g: number|null}|null>>}}
 */
function bouwSnapshot({ vandaag, locatieSleutel, stationId, stationNaam, modellen }) {
  const m = {};
  Object.keys(modellen).forEach((model) => {
    const bron = modellen[model];
    if (!bron || !bron.tijdstippen || !bron.wind) return;
    const stat = dagStatistiek(bron.tijdstippen, bron.wind, bron.vlaag);
    const reeks = [];
    let heeftIets = false;
    for (let k = 0; k < VERIFICATIE_DAGEN; k++) {
      const s = stat[plusDagen(vandaag, k)];
      reeks.push(s ? { w: s.w, g: s.g } : null);
      if (s) heeftIets = true;
    }
    if (heeftIets) m[model] = reeks;
  });
  return { d: vandaag, l: locatieSleutel, s: stationId, sn: stationNaam, m };
}

/**
 * Gemeten daggemiddelde wind en hoogste vlaag (knopen, 09-19 uur lokaal) uit een KNMI-EDR-respons
 * (CoverageJSON) voor één lokale dag. Verwacht 10-minutenwaarden; te weinig metingen geeft null.
 */
function waarnemingDagStatistiek(coverageJson, datum) {
  const cov = coverageJson && coverageJson.coverages && coverageJson.coverages[0];
  if (!cov || !cov.domain || !cov.ranges) return null;
  const tijden = (cov.domain.axes && cov.domain.axes.t && cov.domain.axes.t.values) || [];
  const ff = (cov.ranges.ff && cov.ranges.ff.values) || [];
  const gff = (cov.ranges.gff && cov.ranges.gff.values) || [];
  const winden = [];
  const vlagen = [];
  tijden.forEach((t, i) => {
    const lokaal = lokaleDatumUur(t);
    if (lokaal.datum !== datum) return;
    if (lokaal.uur < VERIFICATIE_VAN_UUR || lokaal.uur > VERIFICATIE_TOT_UUR) return;
    if (ff[i] != null) winden.push(msNaarKnopen(ff[i]));
    if (gff[i] != null) vlagen.push(msNaarKnopen(gff[i]));
  });
  // 11 uur x 6 metingen = 66; minder dan de helft is geen betrouwbaar daggemiddelde.
  if (winden.length < 33) return null;
  return {
    w: rond(winden.reduce((a, b) => a + b, 0) / winden.length),
    g: vlagen.length ? rond(Math.max(...vlagen)) : null,
    n: winden.length,
  };
}

function gemiddelde(waarden) {
  const echt = waarden.filter((x) => x != null);
  return echt.length ? echt.reduce((a, b) => a + b, 0) / echt.length : null;
}

/**
 * Legt snapshots naast waarnemingen. Per (station, voorspeldag-vooruit, model): aantal paren, bias
 * (voorspeld min gemeten; positief = model geeft te veel wind) en gemiddelde absolute fout, voor zowel
 * de wind als de vlaag. `consensus` = gemiddelde van alle modellen met data op die dag.
 * @param {{snapshots: Array, waarnemingen: Array<{s: string, d: string, w: number, g: number|null}>}} data
 */
function evalueerVerificatie(data) {
  const obs = {};
  (data.waarnemingen || []).forEach((o) => {
    // Een "geprobeerd maar geen meting"-regel (w == null) is alleen administratie voor de ophaal-lus.
    if (o.w == null) return;
    obs[o.s + '|' + o.d] = o;
  });

  const cellen = {}; // station|lead|model -> { fW:[], fG:[] }
  const stationNamen = {};
  (data.snapshots || []).forEach((snap) => {
    stationNamen[snap.s] = snap.sn;
    for (let k = 0; k < VERIFICATIE_DAGEN; k++) {
      const gemeten = obs[snap.s + '|' + plusDagen(snap.d, k)];
      if (!gemeten) continue;
      const modelNamen = Object.keys(snap.m);
      const perModel = {};
      modelNamen.forEach((model) => {
        if (snap.m[model][k]) perModel[model] = snap.m[model][k];
      });
      const namen = Object.keys(perModel);
      if (namen.length === 0) continue;
      perModel.consensus = {
        w: gemiddelde(namen.map((n) => perModel[n].w)),
        g: gemiddelde(namen.map((n) => perModel[n].g)),
      };
      Object.keys(perModel).forEach((model) => {
        const sleutel = snap.s + '|' + k + '|' + model;
        const cel = cellen[sleutel] || (cellen[sleutel] = { s: snap.s, k, model, fW: [], fG: [] });
        cel.fW.push(perModel[model].w - gemeten.w);
        if (perModel[model].g != null && gemeten.g != null) cel.fG.push(perModel[model].g - gemeten.g);
      });
    }
  });

  const stations = {};
  Object.keys(cellen).forEach((sleutel) => {
    const c = cellen[sleutel];
    const st = stations[c.s] || (stations[c.s] = { naam: stationNamen[c.s], rijen: [] });
    const maeW = gemiddelde(c.fW.map(Math.abs));
    const biasW = gemiddelde(c.fW);
    const maeG = c.fG.length ? gemiddelde(c.fG.map(Math.abs)) : null;
    const biasG = c.fG.length ? gemiddelde(c.fG) : null;
    st.rijen.push({
      dagenVooruit: c.k,
      model: c.model,
      n: c.fW.length,
      biasWind: rond(biasW),
      maeWind: rond(maeW),
      biasVlaag: biasG == null ? null : rond(biasG),
      maeVlaag: maeG == null ? null : rond(maeG),
    });
  });
  Object.keys(stations).forEach((s) => {
    stations[s].rijen.sort((a, b) => a.dagenVooruit - b.dagenVooruit || a.maeWind - b.maeWind);
  });
  return stations;
}

/**
 * Voegt de uitkomst van evalueerVerificatie over alle stations samen tot één rij per
 * (voorspeldag-vooruit, model), gewogen naar het aantal paren. Dit is de tabel om uit af te lezen welk
 * model op welke voorspeldag het best scoort.
 */
function aggregeerVerificatie(stations) {
  const cellen = {};
  Object.keys(stations || {}).forEach((s) => {
    stations[s].rijen.forEach((r) => {
      const sleutel = r.dagenVooruit + '|' + r.model;
      const c = cellen[sleutel] || (cellen[sleutel] = { dagenVooruit: r.dagenVooruit, model: r.model, n: 0, sBias: 0, sMae: 0, sBiasG: 0, sMaeG: 0, nG: 0 });
      c.n += r.n;
      c.sBias += r.biasWind * r.n;
      c.sMae += r.maeWind * r.n;
      if (r.biasVlaag != null) {
        c.sBiasG += r.biasVlaag * r.n;
        c.sMaeG += r.maeVlaag * r.n;
        c.nG += r.n;
      }
    });
  });
  return Object.keys(cellen)
    .map((k) => {
      const c = cellen[k];
      return {
        dagenVooruit: c.dagenVooruit,
        model: c.model,
        n: c.n,
        biasWind: rond(c.sBias / c.n),
        maeWind: rond(c.sMae / c.n),
        biasVlaag: c.nG ? rond(c.sBiasG / c.nG) : null,
        maeVlaag: c.nG ? rond(c.sMaeG / c.nG) : null,
      };
    })
    .sort((a, b) => a.dagenVooruit - b.dagenVooruit || a.maeWind - b.maeWind);
}

module.exports = {
  VERIFICATIE_MODELLEN,
  VERIFICATIE_DAGEN,
  amsterdamOffsetMinuten,
  lokaleDatumUur,
  plusDagen,
  lokaleDagAlsUtcVenster,
  parseMultiModel,
  parseBrightSkyAlsModel,
  aggregeerVerificatie,
  dagStatistiek,
  bouwSnapshot,
  waarnemingDagStatistiek,
  evalueerVerificatie,
};
