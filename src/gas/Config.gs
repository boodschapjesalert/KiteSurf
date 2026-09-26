// GAS-specifiek: geheimen en instellingen uit Script Properties (nooit in code/repo).
// Zie SETUP.md voor hoe deze waardes in te vullen.

function getWeerliveApiKey_() {
  // Optioneel: Weerlive is een aanvullende (niet-essentiële) NL-bron. Zonder key wordt deze
  // bron simpelweg overgeslagen (zie WeerData.gs), de app blijft werken op Open-Meteo/Buienradar.
  return PropertiesService.getScriptProperties().getProperty('WEERLIVE_API_KEY') || '';
}

function getBotToken_() {
  // Optioneel: alleen nodig voor de Telegram-bot-link (zie TelegramBot.gs). Zonder token doet
  // de bot-integratie simpelweg niets — de hoofd-webapp werkt daar niet van af.
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '';
}

function getKnmiApiKey_() {
  // Optioneel: sleutel voor de KNMI Data Platform EDR-API (officiële 10-minutenmetingen, zie
  // WeerData.gs). Aan te vragen (gratis) in de KNMI API Catalog — per API een aparte sleutel. Eerst
  // KNMI_EDR_API_KEY, anders KNMI_API_KEY. Zonder sleutel wordt KNMI gewoon overgeslagen. De sleutel
  // blijft server-side (KNMI verbiedt gebruik in een browser of app) en wordt nergens getoond of gelogd.
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('KNMI_EDR_API_KEY') || props.getProperty('KNMI_API_KEY') || '';
}

function getTinyUrlToken_() {
  // Optioneel: TinyURL's geauthenticeerde API (i.p.v. de anonieme, sleutelloze api-create.php —
  // zie README.md "Verkorte links" voor waarom: die toont bij het openen een tussenpagina, en het
  // geprobeerde alternatief is.gd bleek structureel kapot). Zonder token valt verkortUrl_ (Code.gs)
  // gewoon terug op de lange URL — geen enkele link is hier ooit van afhankelijk.
  return PropertiesService.getScriptProperties().getProperty('TINYURL_API_TOKEN') || '';
}

function getWidgetApkBestandsId_() {
  // Optioneel: het Drive-bestands-ID van de geëxporteerde Tasker-widget-app (App Factory-APK,
  // zie README.md "Widget (Tasker)"), zie SETUP.md voor hoe je 'm invult. Zonder deze property
  // toont de webapp (Code.gs: doGet) simpelweg geen downloadknop — het `?actie=widget`-endpoint
  // zelf werkt daar los van.
  return PropertiesService.getScriptProperties().getProperty('WIDGET_APK_DRIVE_BESTANDS_ID') || '';
}

function getProfielenMapId_() {
  var props = PropertiesService.getScriptProperties();
  var mapId = props.getProperty('PROFIELEN_MAP_ID');
  if (mapId) return mapId;

  // Eerste keer: maak de map aan en onthoud het ID, zodat we niet steeds op naam hoeven te zoeken.
  var mapNaam = 'KiteWeerApp-Profielen';
  var mappen = DriveApp.getFoldersByName(mapNaam);
  var map = mappen.hasNext() ? mappen.next() : DriveApp.createFolder(mapNaam);
  props.setProperty('PROFIELEN_MAP_ID', map.getId());
  return map.getId();
}

/**
 * Map voor de widget-grafiek-afbeeldingen (zie widgetJson_ in Code.gs) — zelfde patroon als
 * getProfielenMapId_ hierboven. Apps Script kan geen ruwe binaire data rechtstreeks als
 * doGet-respons serveren (live tegen de deployment geverifieerd: dat gaf een HTML-wrapper terug
 * i.p.v. de afbeelding, zie TESTING.md), dus de afbeelding wordt hier — net als foto's elders in
 * dit soort GAS-projecten — als Drive-bestand opgeslagen en met een publiek-met-link deelbare
 * `drive.google.com/uc?id=`-URL teruggegeven.
 */
function getWidgetGrafiekenMapId_() {
  var props = PropertiesService.getScriptProperties();
  var mapId = props.getProperty('WIDGET_GRAFIEKEN_MAP_ID');
  if (mapId) return mapId;

  var mapNaam = 'KiteWeerApp-WidgetGrafieken';
  var mappen = DriveApp.getFoldersByName(mapNaam);
  var map = mappen.hasNext() ? mappen.next() : DriveApp.createFolder(mapNaam);
  props.setProperty('WIDGET_GRAFIEKEN_MAP_ID', map.getId());
  return map.getId();
}
