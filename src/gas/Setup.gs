// GAS-specifiek: eenmalige installatiefuncties. Handmatig één keer uitvoeren vanuit de Apps
// Script-editor (Run -> functienaam) na het invullen van de Script Properties, zie SETUP.md.
// Triggers kunnen niet via `clasp push` worden aangemaakt, en een nieuwe scope (zoals Slides
// hieronder) kan niet via een HTTP-verzoek aan de webapp om interactieve toestemming vragen —
// dat kan alleen via een Run-klik in de editor, vandaar dat dit soort stappen hier staan.

/**
 * Vraagt eenmalig de `https://www.googleapis.com/auth/presentations`-autorisatie aan die
 * `bouwDagGrafiekBlob_` (Meldingen.gs) nodig heeft om de Telegram-grafiek via Google Slides-vormen
 * te tekenen (nodig voor de windvlagen-lijn, die de ingebouwde `Charts`-service niet kan combineren
 * met balken — zie README.md "Meldingen"). Zonder deze eenmalige Run-klik faalt elke grafiek-poging
 * geruisloos met een autorisatiefout, en valt elk Telegram-bericht terug op tekst-only.
 */
function autoriseerSlidesToegang() {
  var presentatie = SlidesApp.create('kiteweer-autorisatietest-' + new Date().getTime());
  DriveApp.getFileById(presentatie.getId()).setTrashed(true);
  Logger.log('Slides-toegang werkt — de Telegram-grafiek kan nu de windvlagen-lijn tekenen.');
}

function installeerMeldingenTrigger() {
  // Verwijdert alle eerder geïnstalleerde varianten van deze trigger — de huidige naam
  // ('controleerEnStuurMeldingen', voorkomt dubbele triggers bij een herrun) én de namen van
  // eerdere versies van dit mechanisme ('controleerDrempelwaardenEnMeld': het originele
  // uur-checkje; 'stuurDagelijkseKiteSamenvatting': de tussenliggende vaste-08:00-versie) —
  // zodat een herrun van deze functie na een update ook meteen de verweesde oude trigger opruimt.
  ['controleerDrempelwaardenEnMeld', 'stuurDagelijkseKiteSamenvatting', 'controleerEnStuurMeldingen'].forEach(function (naam) {
    ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getHandlerFunction() === naam; })
      .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  });

  // Elk kwartier i.p.v. elk uur: het samenvattingstijdstip is per profiel instelbaar tot op de
  // minuut (bv. 08:05), en met een uur-trigger zou zo'n tijdstip nooit binnen een kwartier na de
  // gekozen tijd verstuurd worden. Meldingen.gs bepaalt zelf of het tijdstip gepasseerd is en of
  // er vandaag al een samenvatting uitging, dus vaker draaien levert geen dubbele berichten op.
  ScriptApp.newTrigger('controleerEnStuurMeldingen').timeBased().everyMinutes(15).create();
}

/**
 * Wat `?actie=onderhoud` (doGet in Code.gs) uitvoert: de webhook en de trigger terugzetten als ze
 * ontbreken. Beide waren handmatige eenmalige editor-acties en stonden daardoor in de praktijk
 * niet aan — met als gevolg dat Telegram-koppelen stil faalde en er nooit meldingen uitgingen.
 *
 * @returns {{webhook: Object, trigger: {ok: boolean, reden: string}}}
 */
function voerOnderhoudUit_() {
  var aantalVooraf = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'controleerEnStuurMeldingen';
  }).length;
  // Altijd opnieuw opbouwen, ook als er al precies één trigger staat: de ScriptApp-API kan van een
  // bestaande trigger niet uitlezen hóe vaak hij draait, dus een achtergebleven uur-trigger uit een
  // oudere versie is niet te herkennen — en die zou het per-minuut instelbare samenvattingstijdstip
  // stilletjes onbruikbaar maken. Opnieuw aanmaken is idempotent en verschuift hooguit de volgende run.
  installeerMeldingenTrigger();
  return {
    webhook: zorgVoorTelegramWebhook_(true),
    trigger: { ok: true, reden: 'opnieuw-gezet', triggersVooraf: aantalVooraf },
  };
}
