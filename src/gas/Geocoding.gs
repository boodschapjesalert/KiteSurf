// GAS-specifiek: locatie zoeken op naam (Open-Meteo Geocoding API, wereldwijd, geen key nodig).

/** Simpele eenmalige JSON-fetch — geen batching nodig, dit is de enige aanroep in dit request. */
function fetchJsonEenmalig_(url) {
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} zoekterm - plaatsnaam/adres, vrij ingevoerd door de gebruiker
 * @returns {Array<{naam: string, land: string, lat: number, lon: number}>}
 */
function zoekLocatie_(zoekterm) {
  var input = (zoekterm || '').trim().slice(0, 200); // inputvalidatie: lengte begrenzen
  if (!input) return [];

  var url = 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=nl&name=' +
    encodeURIComponent(input);
  var json = fetchJsonEenmalig_(url);
  var resultaten = (json && json.results) || [];

  return resultaten.map(function (r) {
    var onderdelen = [r.name, r.admin1, r.country].filter(function (x) { return !!x; });
    return {
      naam: onderdelen.join(', '),
      land: r.country || '',
      lat: r.latitude,
      lon: r.longitude,
    };
  });
}
