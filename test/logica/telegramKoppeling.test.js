const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  kiesActieveTelegramProfielen,
  behoudServerBeheerdeVelden,
  isTelegramStopCommando,
} = require('../../src/logica/telegramKoppeling');

describe('kiesActieveTelegramProfielen', () => {
  test('één profiel per chat: actief, niets dubbel', () => {
    const r = kiesActieveTelegramProfielen(
      [{ gebruikerId: 'a', telegramChatId: 1 }, { gebruikerId: 'b', telegramChatId: 2 }, { gebruikerId: 'c', telegramChatId: null }],
      { 1: 'a', 2: 'b' }
    );
    assert.deepEqual(r.actief, { a: true, b: true });
    assert.deepEqual(r.dubbel, []);
    assert.deepEqual(r.indexUpdates, {});
  });

  test('twee profielen aan dezelfde chat: alleen het profiel uit de index stuurt', () => {
    const r = kiesActieveTelegramProfielen(
      [{ gebruikerId: 'oud', telegramChatId: 42 }, { gebruikerId: 'nieuw', telegramChatId: 42 }],
      { 42: 'nieuw' }
    );
    assert.deepEqual(r.actief, { nieuw: true });
    assert.deepEqual(r.dubbel, [{ gebruikerId: 'oud', chatId: 42 }]);
    assert.deepEqual(r.indexUpdates, {});
  });

  test('chat-ID als getal in het profiel en als string in de index', () => {
    const r = kiesActieveTelegramProfielen([{ gebruikerId: 'a', telegramChatId: 123456789 }], { 123456789: 'a' });
    assert.deepEqual(r.actief, { a: true });
  });

  test('index ontbreekt of verouderd: vaste keuze (kleinste ID) en index herstellen', () => {
    const profielen = [{ gebruikerId: 'zz', telegramChatId: 7 }, { gebruikerId: 'aa', telegramChatId: 7 }];
    for (const index of [{}, { 7: 'bestaat-niet-meer' }]) {
      const r = kiesActieveTelegramProfielen(profielen, index);
      assert.deepEqual(r.actief, { aa: true });
      assert.deepEqual(r.dubbel, [{ gebruikerId: 'zz', chatId: 7 }]);
      assert.deepEqual(r.indexUpdates, { 7: 'aa' });
    }
  });
});

describe('behoudServerBeheerdeVelden', () => {
  const opgeslagen = {
    telegramChatId: null,
    meldingen: { laatstGemeld: { rockanje: { '2026-10-05': true } }, laatsteSamenvattingDatum: '2026-10-05' },
  };

  test('een verouderd tabblad zet een verbroken Telegram-koppeling niet terug', () => {
    const r = behoudServerBeheerdeVelden({ telegramChatId: 42, meldingen: { dagelijkseSamenvatting: true } }, opgeslagen);
    assert.equal(r.telegramChatId, null);
  });

  test('instellingen van de gebruiker blijven, meldingsstatus komt van de server', () => {
    const client = {
      dagenVooruit: 5,
      meldingen: { dagelijkseSamenvatting: false, samenvattingUur: 9, laatstGemeld: {}, laatsteSamenvattingDatum: '2026-10-01' },
    };
    const r = behoudServerBeheerdeVelden(client, opgeslagen);
    assert.equal(r.dagenVooruit, 5);
    assert.equal(r.meldingen.dagelijkseSamenvatting, false);
    assert.equal(r.meldingen.samenvattingUur, 9);
    assert.equal(r.meldingen.laatsteSamenvattingDatum, '2026-10-05');
    assert.deepEqual(r.meldingen.laatstGemeld, { rockanje: { '2026-10-05': true } });
    assert.equal(client.meldingen.laatsteSamenvattingDatum, '2026-10-01', 'invoer niet gewijzigd');
  });

  test('wel gekoppeld op de server: koppeling blijft, ook als de client null stuurt', () => {
    const r = behoudServerBeheerdeVelden({ telegramChatId: null }, { telegramChatId: 42, meldingen: {} });
    assert.equal(r.telegramChatId, 42);
    assert.deepEqual(r.meldingen, { laatstGemeld: {}, laatsteSamenvattingDatum: null });
  });

  test('nieuw profiel (nog niets opgeslagen) en geen object', () => {
    assert.equal(behoudServerBeheerdeVelden({ telegramChatId: 42 }, null).telegramChatId, null);
    assert.equal(behoudServerBeheerdeVelden(null, opgeslagen), null);
  });
});

describe('isTelegramStopCommando', () => {
  test('herkent /stop, ook met @botnaam en spaties', () => {
    assert.equal(isTelegramStopCommando('/stop'), true);
    assert.equal(isTelegramStopCommando('  /STOP  '), true);
    assert.equal(isTelegramStopCommando('/stop@ShouldIKite_bot'), true);
  });

  test('geen /stop', () => {
    assert.equal(isTelegramStopCommando('/start'), false);
    assert.equal(isTelegramStopCommando('/stopnu'), false);
    assert.equal(isTelegramStopCommando('stop'), false);
    assert.equal(isTelegramStopCommando(undefined), false);
  });
});
