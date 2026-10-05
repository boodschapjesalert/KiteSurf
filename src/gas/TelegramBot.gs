// GAS-specifiek: een lichte, aparte koppeling met de eerder aangemaakte Telegram-bot
// (@ShouldIKite_bot / "Kiting9to5") — NIET als Mini App (zie README.md "Aannames" #1 voor
// waarom dat structureel niet werkt met Apps Script), maar als meldingskanaal:
// - Wie de bot start (zonder deep-link-parameter), krijgt een NIEUW profiel + de webapp-link terug.
// - Wie de bot start via de "🔗 Koppel aan Telegram"-link in ⚙️ Instellingen (een Telegram
//   "deep link" t.me/<bot>?start=<gebruikerId>, zie JavaScript.html: telegramKoppelLink()), krijgt
//   dit chat-ID gekoppeld aan dát BESTAANDE profiel i.p.v. een nieuw, los profiel.
// - Elke ochtend om 08:00 stuurt Meldingen.gs de 3-daagse kitesurf-vooruitzicht naar dit chat-ID.
// - /stop ontkoppelt de chat van élk profiel (geen meldingen meer). Eén chat hoort bij precies één
//   profiel; zie src/logica/telegramKoppeling.js voor hoe dat bij koppelen, opslaan en versturen
//   bewaakt wordt.
//
// Vereist eenmalig (zie SETUP.md): TELEGRAM_BOT_TOKEN in Script Properties, en daarna
// `registreerTelegramWebhook()` één keer handmatig draaien vanuit de Apps Script-editor.

/**
 * Zoekt het profiel dat aan dit Telegram-chat-ID hangt.
 *
 * Gebruikt een omgekeerde index (chat-ID -> gebruikers-ID) in Script Properties, met de volledige
 * scan als terugval. Die scan leest élk profielbestand uit Drive; bij een webhook-aanroep telt dat
 * op tot seconden, en als Telegram niet snel genoeg een HTTP 200 terugziet levert het dezelfde
 * update opnieuw aan — precies de berichtenstorm die dit moest voorkomen. Na een terugval-scan
 * wordt de index alsnog gevuld, zodat het de volgende keer wél snel gaat.
 */
function vindGebruikerIdVoorTelegramChatId_(chatId) {
  var props = PropertiesService.getScriptProperties();
  var indexSleutel = 'tg_chat_' + chatId;
  var uitIndex = props.getProperty(indexSleutel);
  if (uitIndex) return uitIndex;

  var profielen = laadAlleProfielen_();
  for (var i = 0; i < profielen.length; i++) {
    if (profielen[i].telegramChatId === chatId) {
      props.setProperty(indexSleutel, profielen[i].gebruikerId);
      return profielen[i].gebruikerId;
    }
  }
  return null;
}

/** Alle chat-ID -> gebruikers-ID index-items in één keer (zie kiesActieveTelegramProfielen). */
function leesTelegramChatIndex_() {
  var alle = PropertiesService.getScriptProperties().getProperties();
  var index = {};
  Object.keys(alle).forEach(function (sleutel) {
    if (sleutel.indexOf('tg_chat_') === 0) index[sleutel.slice('tg_chat_'.length)] = alle[sleutel];
  });
  return index;
}

/**
 * Ontkoppelt álle profielen die aan dit chat-ID hangen, behalve `behoudGebruikerId` (null = allemaal).
 * Een chat hoort bij precies één profiel; eerder werd bij opnieuw koppelen alleen het profiel uit de
 * index ontkoppeld, waardoor een tweede profiel met dezelfde chat stil bleef doorsturen
 * (gebruikersrapport: "afgemeld maar blijf samenvattingen krijgen"). Leest alle profielen (traag-ish),
 * maar koppelen/stoppen is zeldzaam en doPost is idempotent per update_id, dus een Telegram-
 * herhaling door een trager antwoord doet geen kwaad.
 * @returns {number} aantal ontkoppelde profielen
 */
function ontkoppelProfielenVanChat_(chatId, behoudGebruikerId) {
  var aantal = 0;
  laadAlleProfielen_().forEach(function (p) {
    if (!p.gebruikerId || p.gebruikerId === behoudGebruikerId) return;
    if (p.telegramChatId == null || String(p.telegramChatId) !== String(chatId)) return;
    wijzigProfielMetLock_(p.gebruikerId, function (vers) {
      // Onder de lock opnieuw controleren: alleen ontkoppelen als het nog steeds déze chat is.
      if (vers.telegramChatId != null && String(vers.telegramChatId) === String(chatId)) vers.telegramChatId = null;
      return vers;
    });
    aantal++;
  });
  return aantal;
}

/** Houdt de chat-ID -> gebruikers-ID index gelijk met het profiel dat zojuist (ont)koppeld is. */
function onthoudTelegramKoppeling_(chatId, gebruikerId) {
  var props = PropertiesService.getScriptProperties();
  if (gebruikerId) props.setProperty('tg_chat_' + chatId, gebruikerId);
  else props.deleteProperty('tg_chat_' + chatId);
}

/**
 * Antwoordt hooguit één keer per minuut per chat op een puur informatief bericht. Beschermt tegen
 * een reeks berichten kort na elkaar (zie de idempotentie-check in doPost) zonder een échte
 * koppelingsbevestiging ooit te onderdrukken.
 */
function recentAlGeantwoord_(chatId) {
  var cache = CacheService.getScriptCache();
  var sleutel = 'tg_antwoord_' + chatId;
  if (cache.get(sleutel)) return true;
  cache.put(sleutel, '1', 60);
  return false;
}

/**
 * Haalt de deep-link-payload uit een /start-bericht ("/start <gebruikerId>", eventueel met een
 * @botnaam-suffix zoals Telegram die soms toevoegt). Telegram staat in een start-parameter alleen
 * [A-Za-z0-9_-] toe (max 64 tekens) — hetzelfde alfabet als een UUID, dus geen extra decodering nodig.
 * @returns {string|null}
 */
function haalStartPayloadUit_(tekst) {
  var match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec((tekst || '').trim());
  return match && match[1] ? match[1].slice(0, 100) : null;
}

/**
 * Verwerkt een inkomend Telegram-bericht (elk bericht, niet alleen /start).
 * Gevallen:
 * 0. /stop: ontkoppel álle profielen van deze chat — geen samenvattingen of alerts meer.
 * 1. /start met een deep-link-payload die niet al aan dit chat-ID hangt: koppel dit chat-ID aan
 *    dát bestaande profiel (en ontkoppel álle andere profielen die nog aan dit chat-ID hingen — een
 *    chat-ID hoort maar bij één profiel tegelijk).
 * 2. Dit chat-ID is al aan een profiel gekoppeld (eender welk bericht): dat profiel hergebruiken.
 * 3. Nieuw chat-ID met /start zonder deep-link-payload: een nieuw, los profiel aanmaken.
 * 4. Nieuw chat-ID met een ander bericht: alleen uitleg, géén nieuw profiel — anders zette een los
 *    berichtje na /stop de meldingen stilletjes weer aan (met een vers profiel).
 */
function verwerkTelegramBericht_(message) {
  var chatId = message && message.chat && message.chat.id;
  if (!chatId) return;

  if (isTelegramStopCommando(message.text)) {
    ontkoppelProfielenVanChat_(chatId, null);
    onthoudTelegramKoppeling_(chatId, null);
    verstuurTelegramBotBericht_(chatId,
      '🔕 Gestopt: je krijgt hier geen samenvattingen of alerts meer. Je instellingen en favorieten in de app blijven bewaard.\n\n' +
      'Later weer aanmelden? Open de app → ⚙️ Instellingen → "🔗 Koppel aan Telegram".');
    return;
  }

  var deepLinkGebruikerId = haalStartPayloadUit_(message.text);
  var bestaandeGebruikerId = vindGebruikerIdVoorTelegramChatId_(chatId);

  var gebruikerId;
  var status; // 'gekoppeldAanBestaand' | 'nieuw' | 'algGekoppeld'

  // wijzigProfielMetLock_ (ProfielOpslag.gs) i.p.v. rechtstreeks laadProfiel_+slaProfielOp_: dit
  // koppelen kan in theorie samenvallen met een webapp-opslag of een trigger-run op hetzelfde
  // profiel — de lock+her-lees-stap voorkomt dat één van beide de ander stilzwijgend overschrijft.
  if (deepLinkGebruikerId && deepLinkGebruikerId !== bestaandeGebruikerId) {
    gebruikerId = deepLinkGebruikerId;
    wijzigProfielMetLock_(gebruikerId, function (teKoppelenProfiel) {
      teKoppelenProfiel.telegramChatId = chatId;
      return teKoppelenProfiel;
    });
    onthoudTelegramKoppeling_(chatId, gebruikerId);
    // Álle andere profielen van deze chat, niet alleen bestaandeGebruikerId uit de index.
    ontkoppelProfielenVanChat_(chatId, gebruikerId);
    status = 'gekoppeldAanBestaand';
  } else if (bestaandeGebruikerId) {
    gebruikerId = bestaandeGebruikerId;
    status = 'algGekoppeld';
  } else if (!/^\/start(?:@\w+)?$/.test((message.text || '').trim())) {
    // Hier is er geen deep-link-payload (anders gold geval 1), dus alleen een kale /start maakt een profiel.
    if (recentAlGeantwoord_(chatId)) return;
    verstuurTelegramBotBericht_(chatId,
      'ℹ️ Deze chat is niet (meer) aan een profiel gekoppeld, dus je krijgt hier geen meldingen.\n\n' +
      'Aanmelden: open de app → ⚙️ Instellingen → "🔗 Koppel aan Telegram", of stuur /start voor een nieuw profiel.');
    return;
  } else {
    gebruikerId = Utilities.getUuid();
    wijzigProfielMetLock_(gebruikerId, function (nieuwProfiel) {
      nieuwProfiel.telegramChatId = chatId;
      return nieuwProfiel;
    });
    onthoudTelegramKoppeling_(chatId, gebruikerId);
    status = 'nieuw';
  }

  // Een "je bent al gekoppeld"-antwoord is puur informatief en verandert niets. Bij een reeks
  // binnenkomende berichten kort na elkaar (Telegram levert een opgespaarde achterstand in één
  // keer af zodra een webhook wordt geregistreerd, en herhaalt updates waarvan de aflevering
  // onzeker was) zou dat een rij identieke berichten opleveren. Antwoord daarom hooguit één keer
  // per minuut per chat. Een échte statuswijziging (nieuw profiel of een nieuwe koppeling) wordt
  // altijd bevestigd — die bevestiging mag nooit wegvallen.
  if (status === 'algGekoppeld' && recentAlGeantwoord_(chatId)) return;

  // Verkort via TinyURL (zie verkortUrl_ in Code.gs).
  var appLink = verkortUrl_(ScriptApp.getService().getUrl() + '?id=' + encodeURIComponent(gebruikerId));
  var tekst;
  if (status === 'gekoppeldAanBestaand') {
    tekst =
      '🪁 Gekoppeld! Je bestaande profiel is nu aan Telegram gekoppeld.\n\n' +
      'Elke ochtend om 08:00 stuur ik hier een 3-daagse kitesurf-vooruitzicht voor je favoriete ' +
      'locaties (goed/niet goed volgens je meldingsregel).\n\n' +
      'Open de app hier: ' + appLink + '\n\nStoppen met deze berichten kan altijd met /stop.';
  } else if (status === 'algGekoppeld') {
    tekst = '🪁 Je hebt al een profiel gekoppeld. Open de app hier:\n' + appLink;
  } else {
    tekst =
      '🪁 Welkom bij de Kite Weer App!\n\n' +
      'Open de app hier om je criteria en dagvenster in te stellen:\n' + appLink + '\n\n' +
      'Elke ochtend om 08:00 stuur ik hier een 3-daagse kitesurf-vooruitzicht voor je favoriete ' +
      'locaties (goed/niet goed volgens je meldingsregel: minimaal de ingestelde windkracht + richting).\n\n' +
      'Bewaar de link hierboven — er is geen account/login. Had je al een browser-profiel? Gebruik ' +
      'dan liever de "🔗 Koppel aan Telegram"-knop bij ⚙️ Instellingen in dát profiel, i.p.v. dit ' +
      'nieuwe profiel — dan blijven je bestaande favorieten en instellingen behouden.\n\n' +
      'Stoppen met deze berichten kan altijd met /stop.';
  }
  verstuurTelegramBotBericht_(chatId, tekst);
}

/**
 * Voert één Telegram Bot API-aanroep uit, met één herkansing bij een 429 (Too Many Requests) —
 * gebruikt Telegram's eigen `retry_after` (seconden) als die aangeleverd wordt, anders een korte
 * vaste wachttijd (max 10s). Gedeeld door verstuurTelegramBotBericht_/verstuurTelegramFotoMet-
 * Onderschrift_ hieronder.
 *
 * Vóór deze functie controleerde verstuurTelegramBotBericht_ de statuscode helemaal niet — het
 * vuurde de aanroep af en las het antwoord nooit. Met `muteHttpExceptions` crasht een mislukte
 * aanroep dan niet, maar verdwijnt ook geruisloos: geen foutmelding, geen retry, niets. Bij een
 * kortstondige rate-limit (bv. een burst van meerdere foto+bijschrift-berichten kort na elkaar
 * tijdens de dagelijkse samenvatting — sendPhoto en de tekst-fallback van sendMessage lopen allebei
 * via dezelfde chat) zou dát precies het patroon opleveren uit een terugkerend gebruikersrapport
 * ("geen grafieken/data", geen enkele foutmelding, wél het open- en slotbericht) dat niet
 * reproduceerbaar bleek via losse data-tests — en waarbij de webapp (die geen Telegram-berichten
 * verstuurt, dus deze rate-limit nooit raakt) intussen gewoon de juiste gegevens liet zien.
 * @returns {boolean} true bij een geslaagde verzending (HTTP 200)
 */
function telegramApiAanroep_(methode, opties) {
  var token = getBotToken_();
  if (!token) return false; // Geen token ingesteld: bot-koppeling staat uit, geen foutmelding nodig.
  var url = 'https://api.telegram.org/bot' + token + '/' + methode;
  for (var poging = 0; poging < 2; poging++) {
    var response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opties));
    var status = response.getResponseCode();
    if (status === 200) return true;
    if (status === 429 && poging === 0) {
      var wachtSeconden = 2;
      try {
        var retryAfter = JSON.parse(response.getContentText()).parameters.retry_after;
        if (retryAfter) wachtSeconden = Math.min(retryAfter, 10);
      } catch (parseFout) {
        // Geen (geldig) retry_after-veld: val terug op de standaard wachttijd hierboven.
      }
      Utilities.sleep(wachtSeconden * 1000);
      continue;
    }
    return false;
  }
  return false;
}

function verstuurTelegramBotBericht_(chatId, tekst) {
  return telegramApiAanroep_('sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: tekst }),
  });
}

/**
 * Stuurt een foto met bijschrift via Telegram's `sendPhoto` — gebruikt voor zowel de dagelijkse
 * samenvatting als de directe alert (zie Meldingen.gs: verstuurDagBericht_). Telegram-restricties
 * waarmee rekening is gehouden: caption max 1024 tekens (hier afgekapt, de bijschrift-tekst blijft
 * daar ruim onder), en de foto als multipart-upload i.p.v. een publieke URL — GAS's UrlFetchApp
 * stuurt een payload-object automatisch als multipart/form-data zodra er een Blob-waarde in zit,
 * dus geen Drive-bestand hoeft aangemaakt/gedeeld te worden om Telegram er via een URL bij te laten.
 * @param {string|number} chatId
 * @param {GoogleAppsScript.Base.Blob} afbeeldingBlob
 * @param {string} onderschrift
 * @returns {boolean} true bij een geslaagde verzending (HTTP 200)
 */
function verstuurTelegramFotoMetOnderschrift_(chatId, afbeeldingBlob, onderschrift) {
  return telegramApiAanroep_('sendPhoto', {
    method: 'post',
    payload: {
      chat_id: String(chatId),
      caption: onderschrift.slice(0, 1024),
      photo: afbeeldingBlob,
    },
  });
}

/**
 * Eenmalig handmatig te draaien (Apps Script-editor -> functie selecteren -> Run), ná het
 * invullen van TELEGRAM_BOT_TOKEN. Vertelt Telegram om berichten aan de bot naar deze webapp
 * door te sturen (doPost in Code.gs), zodat verwerkTelegramBericht_ ze kan afhandelen.
 * In de praktijk hoeft dit niet meer: zorgVoorTelegramWebhook_ doet hetzelfde automatisch.
 */
function registreerTelegramWebhook() {
  Logger.log(JSON.stringify(zorgVoorTelegramWebhook_(true)));
}

/**
 * Zorgt dat Telegram de bot-berichten naar déze deployment stuurt, en herstelt dat vanzelf als
 * het niet (meer) klopt — bijvoorbeeld na een nieuwe deployment-URL, of nadat de webhook is
 * losgekoppeld. Dit was eerder een handmatige eenmalige editor-actie (registreerTelegramWebhook);
 * die werd in de praktijk overgeslagen, waardoor koppelen stil faalde en er nooit alerts kwamen.
 *
 * Wordt elke trigger-run aangeroepen maar praat hooguit één keer per 6 uur met de Telegram-API
 * (cache-vlag), zodat de kwartier-trigger niet onnodig traag wordt. `forceer` slaat die cache over.
 *
 * @param {boolean} [forceer] Negeer de cache-vlag en controleer nu bij Telegram.
 * @returns {{ok: boolean, reden: string, url?: string, wachtrij?: number, laatsteFout?: string}}
 */
function zorgVoorTelegramWebhook_(forceer) {
  var token = getBotToken_();
  if (!token) return { ok: false, reden: 'geen-token' };

  var cache = CacheService.getScriptCache();
  if (!forceer && cache.get('tg_webhook_ok')) return { ok: true, reden: 'recent-gecontroleerd' };

  var webappUrl = ScriptApp.getService().getUrl();
  var info = {};
  try {
    var infoResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', {
      muteHttpExceptions: true,
    });
    info = JSON.parse(infoResp.getContentText()).result || {};
  } catch (fout) {
    return { ok: false, reden: 'getWebhookInfo-mislukt: ' + fout };
  }

  // Bewust NIET alleen op een verkeerde URL controleren: ook als de URL al klopt, kan Telegram een
  // vastzittende wachtrij hebben (bv. één update die telkens een 302 terugkreeg van Apps Script's
  // webapp-hosting — een bekende eigenaardigheid van hoe /exec verzoeken soms afhandelt, zie ook de
  // toelichting bij doGet in Code.gs voor hetzelfde soort gedrag bij GET). Zonder deze check bleef
  // zo'n vastzittende update GEEN ENKELE keer opgeruimd zolang de URL zelf klopte — Telegram bleef
  // 'm dan op EIGEN schema blijven herproberen (in de praktijk zo'n eens per ~6 uur), wat voor de
  // ontvanger aanvoelde als een terugkerend "je hebt al een profiel gekoppeld"-bericht zonder
  // duidelijke aanleiding (gebruikersrapport). De `drop_pending_updates`-fix hieronder bestond al
  // vóór deze wijziging, maar dan alléén in de tak hieronder (URL-mismatch) — dit dekte dat geval
  // domweg niet.
  if (info.url === webappUrl && !(info.pending_update_count > 0)) {
    cache.put('tg_webhook_ok', '1', 21600);
    return {
      ok: true,
      reden: 'stond-al-goed',
      url: info.url,
      wachtrij: info.pending_update_count || 0,
      laatsteFout: info.last_error_message || null,
    };
  }

  // drop_pending_updates: een wachtrij met oude updates zou na het (her)koppelen alsnog als een
  // stortvloed binnenkomen — precies de berichtenstorm die we eerder handmatig moesten stoppen. Ook
  // gebruikt om een vastzittende wachtrij te legen terwijl de URL zelf al klopte (zie hierboven) —
  // in dat geval verandert de URL niet, maar wordt de wachtrij wél geleegd.
  var zetResp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' +
      token +
      '/setWebhook?drop_pending_updates=true&url=' +
      encodeURIComponent(webappUrl),
    { muteHttpExceptions: true }
  );
  var gelukt = false;
  try {
    gelukt = JSON.parse(zetResp.getContentText()).ok === true;
  } catch (fout) {
    gelukt = false;
  }
  if (gelukt) cache.put('tg_webhook_ok', '1', 21600);
  var wasAlAlleenWachtrij = info.url === webappUrl;
  return {
    ok: gelukt,
    reden: !gelukt ? 'setWebhook-mislukt' : wasAlAlleenWachtrij ? 'wachtrij-geleegd' : 'opnieuw-ingesteld',
    url: webappUrl,
    vorigeUrl: info.url || '',
    wachtrijVoorLediging: info.pending_update_count || 0,
    laatsteFout: info.last_error_message || null,
  };
}
