// Pure logica rond de koppeling Telegram-chat <-> profiel. Regel: één chat hoort bij precies één
// profiel. In de praktijk konden er toch meerdere profielen aan dezelfde chat hangen (een verouderd
// browsertabblad dat bij opslaan een oude koppeling terugzette, of opnieuw koppelen dat alleen het
// "bekende" profiel ontkoppelde) — dan bleef een profiel dat je zelf al uitgezet dacht te hebben
// gewoon samenvattingen sturen (gebruikersrapport). Zie Meldingen.gs/TelegramBot.gs/Code.gs.

/**
 * Bepaalt per Telegram-chat welk profiel de meldingen mag sturen. Voorkeur: het profiel uit de
 * chat-index (`tg_chat_<chatId>` in Script Properties, gezet bij koppelen). Klopt de index niet
 * (ontbreekt, of wijst naar een profiel dat niet meer aan deze chat hangt), dan het profiel met het
 * kleinste gebruikers-ID — willekeurig maar vast, zodat het niet per run wisselt — en wordt de
 * index daarop bijgewerkt.
 *
 * @param {Array<{gebruikerId: string, telegramChatId: *}>} profielen
 * @param {Object<string, string>} index - chatId (als string) -> gebruikerId
 * @returns {{actief: Object<string, boolean>, dubbel: Array<{gebruikerId: string, chatId: *}>, indexUpdates: Object<string, string>}}
 *   `actief`: gebruikerIds die meldingen mogen sturen; `dubbel`: overige profielen met dezelfde
 *   chat (te ontkoppelen); `indexUpdates`: te herstellen index-items.
 */
function kiesActieveTelegramProfielen(profielen, index) {
  const perChat = {};
  (profielen || []).forEach(function (p) {
    if (!p || p.telegramChatId == null || p.telegramChatId === '' || !p.gebruikerId) return;
    const sleutel = String(p.telegramChatId);
    (perChat[sleutel] = perChat[sleutel] || []).push(p);
  });

  const actief = {};
  const dubbel = [];
  const indexUpdates = {};
  Object.keys(perChat).forEach(function (chat) {
    const groep = perChat[chat];
    const uitIndex = index && index[chat];
    let gekozen = groep.filter(function (p) { return p.gebruikerId === uitIndex; })[0];
    if (!gekozen) {
      gekozen = groep.slice().sort(function (a, b) { return a.gebruikerId < b.gebruikerId ? -1 : 1; })[0];
      indexUpdates[chat] = gekozen.gebruikerId;
    }
    actief[gekozen.gebruikerId] = true;
    groep.forEach(function (p) {
      if (p !== gekozen) dubbel.push({ gebruikerId: p.gebruikerId, chatId: p.telegramChatId });
    });
  });
  return { actief: actief, dubbel: dubbel, indexUpdates: indexUpdates };
}

/**
 * Velden die alléén de server beheert, overnemen uit het opgeslagen profiel i.p.v. uit wat de
 * browser bij "Opslaan" meestuurt. De browser stuurt het hele profiel terug zoals het bij het
 * openen van de pagina was; een tabblad dat al een tijd openstond zette zo een intussen verbroken
 * Telegram-koppeling terug, of een oude `laatsteSamenvattingDatum` (= samenvatting nogmaals).
 * @param {Object} ruwVanClient - profiel zoals de browser het stuurt (wordt niet gewijzigd)
 * @param {Object|null} opgeslagen - huidig (gevalideerd) profiel op de server
 * @returns {Object} kopie van ruwVanClient met de server-velden uit `opgeslagen`
 */
function behoudServerBeheerdeVelden(ruwVanClient, opgeslagen) {
  if (!ruwVanClient || typeof ruwVanClient !== 'object') return ruwVanClient;
  const server = opgeslagen || {};
  const serverMeldingen = server.meldingen || {};
  const clientMeldingen = ruwVanClient.meldingen && typeof ruwVanClient.meldingen === 'object' ? ruwVanClient.meldingen : {};
  return {
    ...ruwVanClient,
    telegramChatId: server.telegramChatId != null ? server.telegramChatId : null,
    meldingen: {
      ...clientMeldingen,
      laatstGemeld: serverMeldingen.laatstGemeld || {},
      laatsteSamenvattingDatum: serverMeldingen.laatsteSamenvattingDatum || null,
    },
  };
}

/** "/stop" (eventueel met @botnaam, zoals Telegram dat in groepen toevoegt). */
function isTelegramStopCommando(tekst) {
  return /^\/stop(?:@\w+)?$/i.test(String(tekst || '').trim());
}

module.exports = {
  kiesActieveTelegramProfielen,
  behoudServerBeheerdeVelden,
  isTelegramStopCommando,
};
