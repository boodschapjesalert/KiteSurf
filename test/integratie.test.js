// Integratietest: doorloopt de volledige keten van rauwe bron-responses tot een dagoordeel,
// met gemockte (fixture-)data van alle bronnen tegelijk. Dit is precies het pad dat
// src/gas/WeerData.gs in productie aanroept, maar dan zonder UrlFetchApp.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseOpenMeteoForecast,
  parseOpenMeteoMarine,
  parseBuienradarFeed,
} = require('../src/logica/bronParsers');
const { samenstellenUrenData, groepeerPerDag } = require('../src/logica/forecastSamenstellen');
const { berekenDagScore } = require('../src/logica/scoreBerekening');
const { standaardProfiel } = require('../src/logica/profielValidatie');

function fixture(naam) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', naam), 'utf8'));
}

describe('Volledige dag-score-berekening met alle bronnen tegelijk', () => {
  test('van rauwe fixtures tot een 2-daags weeroordeel per dag', () => {
    const forecastJson = fixture('open-meteo-forecast.json');
    const marineJson = fixture('open-meteo-marine.json');
    const buienradarJson = fixture('buienradar-feed.json');

    const openMeteo = parseOpenMeteoForecast(forecastJson);
    const openMeteoMarine = parseOpenMeteoMarine(marineJson);
    const eersteStation = buienradarJson.actual.stationmeasurements[0];
    const buienradar = parseBuienradarFeed(buienradarJson, eersteStation.lat, eersteStation.lon);

    const urenData = samenstellenUrenData({
      openMeteo,
      openMeteoMarine,
      buienradar,
      huidigTijdstipIso: openMeteo.tijdstippen[0],
    });

    assert.ok(urenData.length > 0, 'moet uurdata opleveren uit de fixtures');

    const profiel = standaardProfiel(123);
    // Windrichting is locatie-specifiek en staat niet in het standaardprofiel; voor de test
    // gebruiken we een brede cross-shore range zodat de andere variabelen bepalend zijn.
    const instellingen = { ...profiel.drempelwaarden, windrichting: { besteRanges: [[0, 360]], acceptabeleRanges: [] } };

    const dagen = groepeerPerDag(urenData);
    assert.ok(dagen.length >= 1);

    dagen.forEach(({ datum, uren }) => {
      const dagScore = berekenDagScore(uren, instellingen);
      assert.ok(['rood', 'oranje', 'groen'].includes(dagScore.kleur), `dag ${datum} moet een geldige kleur hebben`);
      assert.ok(dagScore.score >= 0 && dagScore.score <= 10);
      assert.equal(dagScore.uurResultaten.length, uren.length);
    });
  });

  test('ontbrekende marine- en buienradar-bron: forecast blijft werken op open-meteo alleen', () => {
    const openMeteo = parseOpenMeteoForecast(fixture('open-meteo-forecast.json'));
    const urenData = samenstellenUrenData({ openMeteo });
    const dagen = groepeerPerDag(urenData);
    const dagScore = berekenDagScore(dagen[0].uren, standaardProfiel(1).drempelwaarden);
    assert.ok(['rood', 'oranje', 'groen'].includes(dagScore.kleur));
  });

  test('lege forecast geeft een veilig "rood, geen data" resultaat i.p.v. te crashen', () => {
    const openMeteo = parseOpenMeteoForecast(fixture('open-meteo-forecast-leeg.json'));
    const urenData = samenstellenUrenData({ openMeteo });
    const dagen = groepeerPerDag(urenData);
    assert.equal(dagen.length, 0);
    const dagScore = berekenDagScore([], standaardProfiel(1).drempelwaarden);
    assert.equal(dagScore.kleur, 'rood');
  });
});
