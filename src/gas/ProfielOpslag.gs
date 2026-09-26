// GAS-specifiek: leest/schrijft het gebruikersprofiel-JSON in Drive, gekoppeld aan het unieke
// gebruikers-ID (zie Code.gs). Bestanden staan in een niet-publiek gedeelde map (zie Config.gs:
// getProfielenMapId_) en worden uitsluitend door de backend gelezen/geschreven.

function profielBestandsnaam_(gebruikerId) {
  return 'profiel-' + gebruikerId + '.json';
}

function vindProfielBestand_(map, gebruikerId) {
  var bestanden = map.getFilesByName(profielBestandsnaam_(gebruikerId));
  return bestanden.hasNext() ? bestanden.next() : null;
}

/** Laadt en valideert het profiel van een gebruiker; bestaat het nog niet, dan het standaardprofiel. */
function laadProfiel_(gebruikerId) {
  var map = DriveApp.getFolderById(getProfielenMapId_());
  var bestand = vindProfielBestand_(map, gebruikerId);
  var ruw = bestand ? JSON.parse(bestand.getBlob().getDataAsString()) : null;
  var resultaat = valideerEnVulProfielAan(ruw, gebruikerId);
  return resultaat.profiel;
}

/** Valideert en slaat het profiel op (maakt het bestand aan als het nog niet bestaat). */
function slaProfielOp_(gebruikerId, ruwProfiel) {
  var resultaat = valideerEnVulProfielAan(ruwProfiel, gebruikerId);
  var map = DriveApp.getFolderById(getProfielenMapId_());
  var bestand = vindProfielBestand_(map, gebruikerId);
  var inhoud = JSON.stringify(resultaat.profiel);
  if (bestand) {
    bestand.setContent(inhoud);
  } else {
    map.createFile(profielBestandsnaam_(gebruikerId), inhoud, MimeType.PLAIN_TEXT);
  }
  return resultaat;
}

/**
 * Past één profiel gelockt aan: her-leest het ACTUELE profiel van schijf (niet een mogelijk
 * verouderde in-memory kopie die de aanroeper toevallig bij de hand had), past `wijzigFn` erop toe,
 * en slaat het resultaat op — allemaal terwijl de script-lock vastgehouden wordt.
 *
 * Voorkomt dat twee gelijktijdige schrijvers naar hetzelfde profiel-bestand (de webapp en de
 * kwartier-trigger, of twee trigger-runs die elkaar overlappen) elkaars wijzigingen stilzwijgend
 * overschrijven: zonder deze her-lees-vlak-vóór-het-schrijven-stap zou een schrijver kunnen werken
 * op een momentopname van vóórdat de ander zijn update had opgeslagen. Gebruikt door alle
 * schrijfpaden die een BESTAAND veld aanpassen (favoriete locatie toevoegen/verwijderen,
 * meldingen-historie bijwerken) — niet door `saveProfiel` zelf, want dat ontvangt een compleet,
 * door de gebruiker ingevuld profiel-object van de client; een her-lees-en-toepas-patroon is daar
 * niet zinvol (er is geen "wijzigFn" — de client stuurt de gewenste eindstaat al compleet mee), dus
 * daar beschermt de lock alleen tegen letterlijk gelijktijdig schrijven, niet tegen een client die
 * met een verouderde momentopname werkte.
 *
 * `wijzigFn` moet SNEL zijn (geen trage externe aanroepen zoals weerdata ophalen of Telegram
 * versturen) — de lock staat open zolang deze functie loopt, en andere schrijvers (elders in de
 * app) moeten daar dan op wachten.
 * @param {string} gebruikerId
 * @param {(profiel: Object) => Object} wijzigFn - krijgt het verse profiel, geeft het (gewijzigde)
 *   profiel terug om op te slaan.
 * @param {number} [timeoutMs] standaard 10000.
 * @returns {Object|null} het opgeslagen profiel, of null als de lock niet op tijd vrijkwam (in dat
 *   geval is er niets gewijzigd/opgeslagen — de aanroeper beslist zelf wat te doen, bv. overslaan
 *   en bij de eerstvolgende gelegenheid opnieuw proberen).
 */
function wijzigProfielMetLock_(gebruikerId, wijzigFn, timeoutMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 10000)) {
    Logger.log('wijzigProfielMetLock_: kon geen lock krijgen voor ' + gebruikerId + ', niets opgeslagen.');
    return null;
  }
  try {
    var vers = laadProfiel_(gebruikerId);
    var gewijzigd = wijzigFn(vers);
    return slaProfielOp_(gebruikerId, gewijzigd).profiel;
  } finally {
    lock.releaseLock();
  }
}

/** Alle opgeslagen profielen (gebruikt door de meldingen-trigger, zie Meldingen.gs). */
function laadAlleProfielen_() {
  var map = DriveApp.getFolderById(getProfielenMapId_());
  var bestanden = map.getFiles();
  var profielen = [];
  while (bestanden.hasNext()) {
    var bestand = bestanden.next();
    try {
      var ruw = JSON.parse(bestand.getBlob().getDataAsString());
      profielen.push(valideerEnVulProfielAan(ruw, ruw && ruw.gebruikerId).profiel);
    } catch (e) {
      // Eén corrupt profiel-bestand mag de trigger voor alle andere gebruikers niet blokkeren.
    }
  }
  return profielen;
}
