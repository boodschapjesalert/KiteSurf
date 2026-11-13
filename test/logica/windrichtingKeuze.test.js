const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sectorenNaarRanges,
  rangesNaarSectorIndexen,
  windrichtingNaarSectorStanden,
  sectorStandenNaarWindrichting,
  bereikSectorenMetKlokMee,
  pasBereikToeOpStanden,
  formatWindrichting,
  formatRanges,
  formatWindrichtingSamenvatting,
  valideerWindrichtingWeergave,
  SECTOR_BESTE,
  SECTOR_ACCEPTABEL,
} = require('../../src/logica/windrichtingKeuze');
const { zoekSpotPreset, presetNaarWindrichting, SPOT_PRESETS } = require('../../src/logica/spotPresets');
const { inGradenBereik } = require('../../src/logica/drempelwaarden');
const { updateFavorieteLocatieWindrichting, standaardProfiel, valideerEnVulProfielAan } = require('../../src/logica/profielValidatie');

describe('windrichtingKeuze: sectoren <-> graden-ranges', () => {
  it('voegt aaneengesloten sectoren samen tot een range', () => {
    // ZZW(9) t/m NW(14): 191,25 - 326,25
    assert.deepEqual(sectorenNaarRanges([9, 10, 11, 12, 13, 14]), [[191.25, 326.25]]);
  });

  it('wikkelt over noord heen (NNW, N, NNO)', () => {
    const r = sectorenNaarRanges([15, 0, 1]);
    assert.deepEqual(r, [[326.25, 33.75]]);
    assert.ok(inGradenBereik(0, r[0][0], r[0][1]));
    assert.ok(!inGradenBereik(90, r[0][0], r[0][1]));
  });

  it('geeft meerdere ranges voor losse sectoren', () => {
    assert.equal(sectorenNaarRanges([2, 10]).length, 2);
  });

  it('alle 16 = volledige cirkel, geen = leeg', () => {
    assert.deepEqual(sectorenNaarRanges([...Array(16).keys()]), [[0, 360]]);
    assert.deepEqual(sectorenNaarRanges([]), []);
  });

  it('is rond-te-reizen: sectoren -> ranges -> sectoren', () => {
    const sets = [[0], [9, 10, 11], [15, 0, 1, 2], [4, 8, 12], [...Array(16).keys()]];
    sets.forEach((s) => assert.deepEqual(rangesNaarSectorIndexen(sectorenNaarRanges(s)), s.slice().sort((a, b) => a - b)));
  });

  it('standaard Rockanje-range (202,5-315) wordt ZZW t/m NW', () => {
    assert.deepEqual(rangesNaarSectorIndexen([[202.5, 315]]), [9, 10, 11, 12, 13, 14]);
  });

  it('standen <-> windrichting', () => {
    const wr = { besteRanges: [[202.5, 292.5]], acceptabeleRanges: [[180, 180]] };
    const standen = windrichtingNaarSectorStanden(wr);
    assert.equal(standen[8], SECTOR_ACCEPTABEL);
    assert.equal(standen[10], SECTOR_BESTE);
    const terug = sectorStandenNaarWindrichting(standen);
    assert.equal(terug.besteRanges.length, 1);
    assert.equal(terug.acceptabeleRanges.length, 1);
  });
});

describe('windrichtingKeuze: weergave (kompas OF graden)', () => {
  it('toont alleen kompas of alleen graden, nooit beide', () => {
    assert.equal(formatWindrichting(225, 'kompas'), 'ZW');
    assert.equal(formatWindrichting(225, 'graden'), '225°');
    assert.equal(formatWindrichting(225), 'ZW');
    assert.equal(formatWindrichting(null, 'kompas'), null);
  });

  it('valideert de voorkeur met fallback', () => {
    assert.equal(valideerWindrichtingWeergave('graden'), 'graden');
    assert.equal(valideerWindrichtingWeergave('beide'), 'kompas');
    assert.equal(valideerWindrichtingWeergave(undefined, 'graden'), 'graden');
  });

  it('vat ranges samen als kompas of graden', () => {
    assert.equal(formatRanges([[202.5, 315]], 'kompas'), 'ZZW t/m NW');
    assert.equal(formatRanges([[326.25, 33.75]], 'kompas'), 'NNW t/m NNO');
    assert.equal(formatRanges([], 'kompas'), 'geen');
    assert.equal(formatRanges([[0, 360]], 'kompas'), 'alle richtingen');
    assert.equal(formatRanges([[202.5, 315]], 'graden'), '202,5° – 315°');
    assert.equal(
      formatWindrichtingSamenvatting({ besteRanges: [[202.5, 315]], acceptabeleRanges: [] }, 'kompas'),
      'Beste: ZZW t/m NW'
    );
  });
});

describe('spotPresets', () => {
  it('vindt een preset op coordinaten en geeft graden-ranges terug', () => {
    const m = zoekSpotPreset(52.1085, 4.274);
    assert.equal(m.preset.id, 'scheveningen');
    assert.ok(m.windrichting.besteRanges.length >= 1);
  });

  it('geen match ver van elke preset', () => {
    assert.equal(zoekSpotPreset(52.95, 5.9), null);
    assert.equal(zoekSpotPreset(NaN, 4), null);
  });

  it('aflandige richtingen (oost) zitten nooit in een preset', () => {
    SPOT_PRESETS.forEach((p) => {
      ['O', 'ONO', 'OZO'].forEach((r) => {
        assert.ok(![...p.beste, ...p.matig].includes(r), `${p.id} bevat ${r}`);
      });
    });
  });

  it('accepteert een eigen presetlijst', () => {
    const eigen = [{ id: 'x', naam: 'Eigen spot', lat: 52, lon: 5, beste: ['O'], matig: [] }];
    const m = zoekSpotPreset(52.001, 5.001, eigen);
    assert.equal(m.preset.id, 'x');
    assert.deepEqual(presetNaarWindrichting(eigen[0]).besteRanges, [[78.75, 101.25]]);
  });
});

describe('profiel: windrichtingWeergave en spot-update', () => {
  it('standaard kompas, behoudt graden, valt terug bij ongeldig', () => {
    assert.equal(standaardProfiel('x').windrichtingWeergave, 'kompas');
    assert.equal(valideerEnVulProfielAan({ windrichtingWeergave: 'graden' }, 'x').profiel.windrichtingWeergave, 'graden');
    assert.equal(valideerEnVulProfielAan({ windrichtingWeergave: 'beide' }, 'x').profiel.windrichtingWeergave, 'kompas');
  });

  it('updateFavorieteLocatieWindrichting past alleen die spot aan', () => {
    const p = standaardProfiel('x');
    const nieuw = { besteRanges: [[90, 180]], acceptabeleRanges: [] };
    const r = updateFavorieteLocatieWindrichting(p, 'rockanje-sportstrand', nieuw);
    assert.deepEqual(r.fouten, []);
    assert.deepEqual(r.profiel.favorieteLocaties[0].windrichting, nieuw);
    assert.deepEqual(r.profiel.favorieteLocaties[1].windrichting, p.favorieteLocaties[1].windrichting);
  });

  it('onbekende spot of ongeldige invoer laat profiel ongemoeid', () => {
    const p = standaardProfiel('x');
    assert.equal(updateFavorieteLocatieWindrichting(p, 'bestaat-niet', {}).fouten.length, 1);
    assert.equal(updateFavorieteLocatieWindrichting(p, 'rockanje-sportstrand', { besteRanges: [['a', 1]] }).profiel.favorieteLocaties[0].windrichting.besteRanges.length, 0);
  });
});

describe('windrichtingKeuze: bereik kiezen (slecht of goed)', () => {
  it('bereikSectorenMetKlokMee wikkelt netjes over noord heen', () => {
    assert.deepEqual(bereikSectorenMetKlokMee(14, 1), [14, 15, 0, 1]);
    assert.deepEqual(bereikSectorenMetKlokMee(4, 4), [4]);
  });

  it('slechte windrichting kiezen maakt dat bereik uit en de rest groen', () => {
    const standen = pasBereikToeOpStanden(new Array(16).fill(0), 1, 7, 'slecht');
    assert.equal(standen[4], 0); // O uit
    assert.equal(standen[10], SECTOR_BESTE); // ZW groen
    assert.equal(standen[0], SECTOR_BESTE); // N groen
  });

  it('goede windrichting kiezen maakt alleen dat bereik groen', () => {
    const standen = pasBereikToeOpStanden(new Array(16).fill(1), 9, 14, 'goed');
    assert.equal(standen[10], SECTOR_BESTE);
    assert.equal(standen[4], 0);
  });
});
