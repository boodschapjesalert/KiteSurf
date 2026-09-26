const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  vindDichtstbijzijndUurIndex,
  samenstellenUrenData,
  groepeerPerDag,
  windBronnenVanDag,
  zonInfoVoorDatum,
} = require('../../src/logica/forecastSamenstellen');

const openMeteo = {
  tijdstippen: ['2026-08-29T12:00', '2026-08-29T13:00', '2026-08-30T12:00'],
  windKnopen: [18, 19, 20],
  windvlaagKnopen: [20, 21, 22],
  windrichtingGraden: [230, 235, 240],
  onweerAanwezig: [false, false, false],
  neerslagKans: [0.1, 0.1, 0.1],
  luchttemperatuurCelsius: [18, 19, 20],
  zichtKm: [10, 10, 10],
};

const openMeteoMarine = {
  tijdstippen: ['2026-08-29T12:00', '2026-08-29T13:00', '2026-08-30T12:00'],
  watertemperatuurCelsius: [19, 19, 19],
  golfhoogteMeter: [0.4, 0.4, 0.4],
};

describe('vindDichtstbijzijndUurIndex', () => {
  test('vindt het exact matchende of dichtstbijzijnde uur', () => {
    assert.equal(vindDichtstbijzijndUurIndex(openMeteo.tijdstippen, '2026-08-29T13:00'), 1);
    assert.equal(vindDichtstbijzijndUurIndex(openMeteo.tijdstippen, '2026-08-29T12:20'), 0);
  });

  test('geen huidig tijdstip geeft -1', () => {
    assert.equal(vindDichtstbijzijndUurIndex(openMeteo.tijdstippen, null), -1);
  });
});

describe('samenstellenUrenData', () => {
  test('middelt buienradar/weerlive alleen in het "nu"-uur, elders alleen open-meteo', () => {
    const resultaat = samenstellenUrenData({
      openMeteo,
      openMeteoMarine,
      buienradar: { windKnopen: 22, windrichtingGraden: 232, luchttemperatuurCelsius: 18.5, zichtKm: 9 },
      huidigTijdstipIso: '2026-08-29T12:00',
    });

    assert.equal(resultaat.length, 3);
    // Uur 0 = "nu": gemiddelde van open-meteo (18) en buienradar (22) = 20.
    assert.equal(resultaat[0].uurData.windKnopen, 20);
    // Uur 1: geen "nu"-bron, dus puur open-meteo.
    assert.equal(resultaat[1].uurData.windKnopen, 19);
  });

  test('watertemperatuur/golfhoogte komen uit de marine-reeks op hetzelfde tijdstip', () => {
    const resultaat = samenstellenUrenData({ openMeteo, openMeteoMarine });
    assert.equal(resultaat[0].uurData.watertemperatuurCelsius, 19);
    assert.equal(resultaat[0].uurData.golfhoogteMeter, 0.4);
  });

  test('ontbrekende marine-data geeft null in plaats van te crashen', () => {
    const resultaat = samenstellenUrenData({ openMeteo });
    assert.equal(resultaat[0].uurData.watertemperatuurCelsius, null);
  });

  test('getijStatus komt van de dichtstbijzijnde RWS-meting, ontbrekende data geeft null', () => {
    const rwsGetij = {
      tijdstippen: ['2026-08-29T11:55', '2026-08-29T12:50'],
      waterstandCm: [-50, 80],
    };
    const resultaat = samenstellenUrenData({ openMeteo, rwsGetij });
    assert.equal(resultaat[0].uurData.getijStatus, 'laag'); // 12:00 ligt dichter bij 11:55 (-50)
    assert.equal(resultaat[1].uurData.getijStatus, 'hoog'); // 13:00 ligt dichter bij 12:50 (80)
    assert.equal(resultaat[2].uurData.getijStatus, null); // geen RWS-punt in de buurt van dag 2

    const zonderRws = samenstellenUrenData({ openMeteo });
    assert.equal(zonderRws[0].uurData.getijStatus, null);
  });

  test('Windfinder (3-uurlijks) wordt meegemiddeld op het dichtstbijzijnde punt, ook buiten "nu"', () => {
    const windfinder = {
      tijdstippen: ['2026-08-29T12:30', '2026-08-30T12:30'],
      windKnopen: [22, 24],
      windvlaagKnopen: [26, 28],
      windrichtingGraden: [234, 238],
      golfhoogteMeter: [0.6, 0.6],
    };
    const resultaat = samenstellenUrenData({ openMeteo, openMeteoMarine, windfinder });
    // Uur 0 (12:00): dichtstbij 12:30 (30 min weg, binnen de 90-min-marge) -> gemiddeld met open-meteo.
    assert.equal(resultaat[0].uurData.windKnopen, (18 + 22) / 2);
    assert.equal(resultaat[0].uurData.golfhoogteMeter, (0.4 + 0.6) / 2);
    // Uur 2 (dag 2, 12:00): dichtstbij 30-08 12:30, ook binnen marge.
    assert.equal(resultaat[2].uurData.windKnopen, (20 + 24) / 2);
  });

  test('Windfinder-punt te ver weg (buiten marge) telt niet mee', () => {
    const windfinder = {
      tijdstippen: ['2026-08-29T20:00'], // 8 uur van 12:00 af
      windKnopen: [30],
      windvlaagKnopen: [35],
      windrichtingGraden: [200],
      golfhoogteMeter: [1.2],
    };
    const resultaat = samenstellenUrenData({ openMeteo, windfinder });
    assert.equal(resultaat[0].uurData.windKnopen, 18); // puur open-meteo, windfinder genegeerd
  });

  test('RWS-windverwachting wordt als volwaardige forecast-bron meegemiddeld (niet alleen "nu")', () => {
    const rwsWindVerwachting = {
      tijdstippen: ['2026-08-29T12:00', '2026-08-30T12:00'],
      windKnopen: [22, 24],
      windrichtingGraden: [234, 238],
    };
    const resultaat = samenstellenUrenData({ openMeteo, rwsWindVerwachting });
    assert.equal(resultaat[0].uurData.windKnopen, (18 + 22) / 2);
    assert.equal(resultaat[2].uurData.windKnopen, (20 + 24) / 2); // dag 2, ook zonder "nu"
  });

  test('RWS-windmeting (actuele wind) telt alleen mee op het "nu"-uur', () => {
    const rwsWindMeting = { windKnopen: 26, windrichtingGraden: 240 };
    const resultaat = samenstellenUrenData({ openMeteo, rwsWindMeting, huidigTijdstipIso: '2026-08-29T12:00' });
    assert.equal(resultaat[0].uurData.windKnopen, (18 + 26) / 2); // "nu": gemiddeld met open-meteo
    assert.equal(resultaat[1].uurData.windKnopen, 19); // niet "nu": puur open-meteo
  });
});

describe('groepeerPerDag', () => {
  test('groepeert per kalenderdag op basis van het ISO-tijdstip', () => {
    const urenData = samenstellenUrenData({ openMeteo, openMeteoMarine });
    const perDag = groepeerPerDag(urenData);
    assert.equal(perDag.length, 2);
    assert.equal(perDag[0].datum, '2026-08-29');
    assert.equal(perDag[0].uren.length, 2);
    assert.equal(perDag[1].datum, '2026-08-30');
    assert.equal(perDag[1].uren.length, 1);
  });
});

describe('windBronnenVanDag', () => {
  test('geeft de unieke windbronnen terug die over de uren van een dag zijn gebruikt', () => {
    const urenData = samenstellenUrenData({ openMeteo, openMeteoMarine });
    const perDag = groepeerPerDag(urenData);
    assert.deepEqual(windBronnenVanDag(perDag[0].uren), ['open-meteo']);
  });

  test('voegt bronnen samen (union) als verschillende uren verschillende bronnen gebruikten', () => {
    const uren = [
      { bronDetails: { wind: { gebruikteBronnen: ['open-meteo'] } } },
      { bronDetails: { wind: { gebruikteBronnen: ['open-meteo', 'windfinder'] } } },
      { bronDetails: { wind: { gebruikteBronnen: ['rws-wind-verwachting'] } } },
    ];
    assert.deepEqual(windBronnenVanDag(uren), ['open-meteo', 'windfinder', 'rws-wind-verwachting']);
  });

  test('lege/ontbrekende uren of bronDetails geven een lege lijst, geen crash', () => {
    assert.deepEqual(windBronnenVanDag([]), []);
    assert.deepEqual(windBronnenVanDag([{}, { bronDetails: {} }, { bronDetails: { wind: {} } }]), []);
  });
});

describe('zonInfoVoorDatum', () => {
  const dagInfo = {
    datums: ['2026-08-29', '2026-08-30'],
    zonsopgang: ['2026-08-29T06:30', '2026-08-30T06:32'],
    zonsondergang: ['2026-08-29T20:45', '2026-08-30T20:43'],
  };

  test('zoekt zonsopgang/-ondergang op voor een bekende datum', () => {
    assert.deepEqual(zonInfoVoorDatum(dagInfo, '2026-08-30'), {
      zonsopgang: '2026-08-30T06:32',
      zonsondergang: '2026-08-30T20:43',
    });
  });

  test('onbekende datum of ontbrekende dagInfo geeft null-waarden, geen crash', () => {
    assert.deepEqual(zonInfoVoorDatum(dagInfo, '2026-09-01'), { zonsopgang: null, zonsondergang: null });
    assert.deepEqual(zonInfoVoorDatum(undefined, '2026-08-29'), { zonsopgang: null, zonsondergang: null });
  });
});
