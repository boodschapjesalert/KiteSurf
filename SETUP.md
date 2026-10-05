# Setup — handmatige stappen

## 1. Clasp en deployment — al gedaan ✅

`clasp` is geïnstalleerd, ingelogd als `boodschapjesalert@gmail.com`, en het project is
aangemaakt, gepusht én gedeployed:

- **Project:** [Kite Weer App](https://script.google.com/d/1WdLKVPGNCa2U9lQzh4GfpJPqteHg1Huf4jelQsU_4Q1dGpiSROIxriiE/edit)
- **Live URL:** `https://script.google.com/macros/s/AKfycbxaxYVjqJxb4IK5ep3KrVmtrMJHCVFf3j68kVzz0JhxBtKWyzYag7yI5jVF6R5RC0QY8w/exec`

Bij toekomstige codewijzigingen, om dezelfde URL bij te werken (i.p.v. een nieuwe deployment
aan te maken):

```bash
npm run build
clasp push
clasp deploy --deploymentId AKfycbxaxYVjqJxb4IK5ep3KrVmtrMJHCVFf3j68kVzz0JhxBtKWyzYag7yI5jVF6R5RC0QY8w
```

### Automatisch deployen (GitHub Actions)

`.github/workflows/deploy-apps-script.yml` doet bovenstaande drie stappen zelf: bij elke push naar
`main` die de backend raakt, of met de hand (Actions → **Deploy Apps Script** → Run workflow). Hij
draait eerst de tests, deployt naar dezelfde deployment-ID (de URL blijft gelijk) en controleert
daarna of de nieuwe versie onderin de webapp staat.

Eenmalig nodig: secret **`CLASPRC_JSON`** in de environment **`GAS`** (Settings → Environments →
GAS → Environment secrets → Add secret; de workflow noemt die environment) met de volledige inhoud van `~/.clasprc.json` (Windows:
`C:\Users\<naam>\.clasprc.json`) van de pc waar `clasp login` gedaan is. Dit is geen
alleen-lezen-sleutel: hij geeft schrijfrechten op je Apps Script-projecten, dus alleen als secret
bewaren, nergens anders plakken. Faalt de stap "clasp push" met een inlogfout, doe dan op die pc
`npx @google/clasp@3 login` en zet de nieuwe inhoud van `~/.clasprc.json` in het secret.

## 2. Script Properties

De hoofd-app (locatie kiezen, weeroordeel bekijken) werkt zonder geheimen. `TELEGRAM_BOT_TOKEN`
is wel nodig zodra je meldingen wilt — dat is nu het enige meldingskanaal (zie stap 4).

In de Apps Script-editor: **Projectinstellingen → Script Properties → Add script property.**

| Property | Waarde | Verplicht | Waarvoor |
|---|---|---|---|
| `WEERLIVE_API_KEY` | gratis key van [weerlive.nl](https://weerlive.nl/delen.php) | Nee | Extra NL-databron; zonder key wordt deze bron overgeslagen |
| `TELEGRAM_BOT_TOKEN` | het token van je eerder aangemaakte bot (@ShouldIKite_bot), via [@BotFather](https://t.me/BotFather) → `/mybots` → jouw bot → API Token | **Ja, voor meldingen** | Stuurt de app-URL terug als iemand de bot start, én stuurt de dagelijkse samenvatting en/of directe alert (zie stap 4) — zonder token: geen meldingen, want er is geen e-mailkanaal meer |
| `WIDGET_APK_DRIVE_BESTANDS_ID` | het Drive-bestands-ID van de geëxporteerde Tasker-widget-app | Nee | Toont de "⬇️ Download de widget-app (APK)"-knop bij ⚙️ Instellingen → 📱 Installeer ook de Widget; zonder deze property blijft die knop verborgen (de rest van de widget-functionaliteit, `?actie=widget`, werkt daar los van) |
| `TINYURL_API_TOKEN` | API-token van je eigen (gratis) [tinyurl.com](https://tinyurl.com)-account → Account Settings → API Tokens | Nee | Verkort de "🔗 Deel deze app"-link, de Telegram-koppel-antwoorden en de "Bekijk de app"-regel in de dagelijkse samenvatting; zonder token blijven dit gewoon de lange URL's (zie README.md "Verkorte links" voor waarom dit de geauthenticeerde API is, niet de gratis sleutelloze) |
| `KNMI_API_KEY` (of `KNMI_EDR_API_KEY`) | sleutel voor de **EDR API** van het [KNMI Data Platform](https://developer.dataplatform.knmi.nl) (gratis; per API een aparte sleutel aanvragen in de API Catalog) | Nee | Officiële 10-minutenmetingen (wind, vlagen, temperatuur, zicht) van het dichtstbijzijnde KNMI-station als extra bron voor het actuele uur; zonder sleutel wordt KNMI overgeslagen. Sleutel blijft server-side (KNMI-regel), bronvermelding CC BY 4.0 staat in de app. Dezelfde sleutel voedt de dagelijkse modeltoetsing (`?actie=verificatie`, zie README "Elfde vervolg"); geen extra instelling nodig |

Voor `WIDGET_APK_DRIVE_BESTANDS_ID`: upload de APK (zie README.md "Widget (Tasker)" voor hoe je
'm via Tasker's App Factory exporteert) naar Drive, zet 'm op **"Iedereen met de link" → Viewer**
(Delen-knop), en haal het bestands-ID uit de deel-link
(`https://drive.google.com/file/d/`**`<dit-stuk>`**`/view...`).

## 3. Trigger + webhook activeren: open één URL

`clasp push` maakt geen triggers aan en registreert geen Telegram-webhook. Beide waren eerder een
handmatige editor-run — en dat ging in de praktijk mis: de webhook stond nooit aan, waardoor
koppelen **stil** faalde en er nooit meldingen kwamen. Daarom zit het nu in de app zelf.

**Open eenmalig** `https://…/exec?actie=onderhoud` (de live webapp-URL uit stap 1, met die
parameter erachter). Je krijgt JSON terug, bijvoorbeeld:

```json
{ "webhook": { "ok": true, "reden": "opnieuw-ingesteld" },
  "trigger":  { "ok": true, "reden": "opnieuw-gezet" } }
```

`"ok": true` op beide regels betekent dat het staat. `"reden": "geen-token"` bij de webhook wil
zeggen dat `TELEGRAM_BOT_TOKEN` nog ontbreekt (stap 2). De route is idempotent — nog eens openen
kan geen kwaad, en is de snelste check als er iets niet werkt.

De allereerste keer moet je wél nog éénmaal iets in de editor draaien, puur om Apps Script om
**autorisatie** te laten vragen (Drive/UrlFetch/Triggers): open het
[project in de Apps Script-editor](https://script.google.com/d/1WdLKVPGNCa2U9lQzh4GfpJPqteHg1Huf4jelQsU_4Q1dGpiSROIxriiE/edit),
selecteer `installeerMeldingenTrigger` en klik **Run**. Daarna volstaat de URL.

Dit zet een **kwartier**-trigger op `controleerEnStuurMeldingen` (zie README.md "Meldingen" voor de
twee meldingsvormen en de gedeelde meldingsregel: standaard minimaal 19 knopen, richting ZZW-NW).
Elk kwartier i.p.v. elk uur, omdat het samenvattingstijdstip per profiel tot op de minuut
instelbaar is — bij een uur-trigger zou 08:05 nooit op tijd verstuurd worden. Elk profiel kiest
zelf, bij ⚙️ Instellingen, of het de dagelijkse samenvatting (en op welk tijdstip), de directe
alert, beide, of geen van beide wil. Zonder gekoppeld Telegram-chat-ID (zie stap 4) krijgt een
profiel sowieso niets — er is geen e-mailkanaal meer.

Daarna houdt de app het zelf bij: `controleerEnStuurMeldingen` controleert elke run of de webhook
nog naar déze deployment wijst en herstelt hem anders (hooguit één API-call per 6 uur).

## 3b. Slides-toegang autoriseren (verplicht voor de grafiek in Telegram-berichten, eenmalig)

De grafiek die met elk Telegram-bericht meegestuurd wordt (`bouwDagGrafiekBlob_` in `Meldingen.gs`)
tekent balken + een windvlagen-lijn na met Google Slides-vormen — dat kan namelijk niet met Apps
Script's ingebouwde `Charts`-service (geen staaf+lijn-combinatie mogelijk, zie README.md
"Meldingen"). Dat vraagt een aparte autorisatie (`…/auth/presentations`) die de bestaande grant uit
stap 3 niet dekt, en die kan **niet** via een HTTP-verzoek aan de webapp verleend worden (geen
interactief toestemmingsscherm mogelijk over HTTP) — vandaar deze aparte, eenmalige editor-stap:

1. Open het [project in de Apps Script-editor](https://script.google.com/d/1WdLKVPGNCa2U9lQzh4GfpJPqteHg1Huf4jelQsU_4Q1dGpiSROIxriiE/edit).
2. Selecteer de functie `autoriseerSlidesToegang` in het dropdown-menu bovenaan.
3. Klik **Run** en accepteer de gevraagde toestemming (Google Slides).
4. Controleer in **Uitvoeringslog** (View → Logs) op "Slides-toegang werkt".

Zonder deze stap faalt elke grafiek-poging geruisloos met een autorisatiefout, en valt elk
Telegram-bericht terug op tekst-only (geen foto) — de rest van de app blijft gewoon werken.

## 4. Je profiel aan de Telegram-bot koppelen (verplicht voor meldingen, eenmalig)

Gebruikt je eerder aangemaakte bot (@ShouldIKite_bot / "Kiting9to5") **niet** als Mini App (dat
bleek structureel niet te werken, zie README.md "Aannames" #1) maar als het enige meldingskanaal:
via de **"🔗 Koppel aan Telegram"-knop bij ⚙️ Instellingen** (een klikbare deep link) koppel je je
bestaande profiel aan de bot, waarna `Meldingen.gs` de door jou gekozen meldingsvorm(en) via
dezelfde bot stuurt. Zonder dit stap-4 krijgt niemand ooit een melding (er is geen e-mailkanaal
meer).

1. Vul `TELEGRAM_BOT_TOKEN` in bij Script Properties (zie stap 2).
2. Open `?actie=onderhoud` (stap 3) en controleer dat `webhook.ok` `true` is.
3. Test vanuit de webapp: open ⚙️ Instellingen → klik **"🔗 Koppel aan Telegram"** → Telegram
   opent de bot met een klaarstaand `/start`-bericht → druk op **Start/Verstuur**. Je krijgt een
   bevestiging terug dat dít profiel gekoppeld is (niet een nieuw, los profiel). Wil je toch
   losstaand testen zonder deep link (bv. `t.me/ShouldIKite_bot` rechtstreeks openen), dan krijg
   je bewust een **nieuw** profiel — de bot wijst je er dan op dat de koppel-knop de voorkeur heeft.

## 5. Testen

1. Open de live URL (zie stap 1) in een browser.
2. Bewaar de getoonde link (met `?id=...`) — dat is je persoonlijke toegang, er is geen login.
3. Klik op Rockanje Sportstrand of Maasvlakte 2 - Slufter (al standaard favoriet), of zoek een
   andere locatie en voeg toe.
4. Controleer of het weeroordeel verschijnt (standaard 3 dagen) en het uitklapmenu werkt — incl.
   de "Wind-databronnen voor deze dag"-regel bovenin, de Tabel-kolom "Getij" (bv. "hoog (145cm)"
   i.p.v. alleen "geen-voorkeur"), en dat de windvlaag zichtbaar is in de wind-badge (bv. "18 kn ZW
   (vlagen 24 kn)"), niet alleen in een hover-tooltip.
5. Open ⚙️ Instellingen: kies "Dagelijkse samenvatting" (en op welk tijdstip, via de tijdpicker)
   en/of "Directe alert" (meldt zodra een dag "Goed" wordt — geen aparte regel meer, zie README.md
   "Meldingen"), controleer/pas het Dagvenster aan (standaard 09:00-20:00), pas eventueel de
   Voorspellingshorizon aan (standaard 3, max 10 dagen), sla op (de knop toont even
   "✓ Opgeslagen").
6. Open 🛰️ Databronnen: controleer dat alle bronnen aan staan (standaard), zet er eventueel een uit.

## 6. Android-app (optioneel)

1. **Backend bijwerken** (eenmalig na deze wijziging): `npm run build`, `clasp push`,
   `clasp deploy --deploymentId …` (zie stap 1). Controleer onderin de webapp dat er
   **v98** staat (v98: widget-data per dag, en `weeroordelen`/`metOordelen` voor snel laden in de app).
2. **Ondertekeningssleutel** bewaren: `kiteweer-release.keystore` + `keystore.properties` (niet in
   de repo, de repo is publiek). Lokaal: zet `keystore.properties` in `android/` en pas `storeFile`
   aan naar het pad van de keystore.
3. **GitHub Actions-secrets** (Settings → Secrets and variables → Actions → New repository
   secret), zodat Actions met dezelfde sleutel tekent:

   | Secret | Waarde |
   |---|---|
   | `KITEWEER_KEYSTORE_BASE64` | uitvoer van `base64 -w0 kiteweer-release.keystore` |
   | `KITEWEER_KEYSTORE_PASSWORD` | `storePassword` uit `keystore.properties` |
   | `KITEWEER_KEY_ALIAS` | `kiteweer` |
   | `KITEWEER_KEY_PASSWORD` | `keyPassword` uit `keystore.properties` |

4. **Installeren:** download de APK (Actions → run → Artifacts, of een release), open hem op de
   telefoon en sta installeren uit onbekende bronnen toe.
5. **Testen:** app openen → welkomstkaart → windcriteria invullen → opslaan; toestemming voor
   meldingen geven; een lege plek op het startscherm ingedrukt houden → Widgets → Kite Weer App.
   De widget vult zich binnen een minuut.

## Bekende aandachtspunten

- **Weerlive-parser is ongeverifieerd** — als je een `WEERLIVE_API_KEY` invult, controleer dan
  in de Apps Script-uitvoeringslogs of `parseWeerlive` zinnige waarden teruggeeft.
- **Getij en "actuele wind" zijn alleen nauwkeurig dicht bij één van de 10 geverifieerd-actieve
  RWS-meetpunten** (zie README.md "Aannames" #3: Hoek van Holland, Brouwersdam, Cadzand,
  Oosterschelde, Stavenisse, Marollegat, Hansweert, Vlakte van de Raan, Europlatform, K13a) —
  daarbuiten (>30 km) wordt deze bron automatisch overgeslagen.
- **kitesurfvereniging.nl (NKV) is bewust niet geïntegreerd** (zie README.md "Aannames" #4) —
  vanwege een expliciete toestemmingseis én een technische beperking (live data wordt
  JavaScript-side geladen). Vervangen door RWS' eigen windmeting.
- **Windfinder.com is wél geïntegreerd**, ondanks onduidelijke hergebruiksrechten voor hun
  voorspellingsdata (zie README.md "Aannames" #5) — op uitdrukkelijk verzoek. Zet 'm uit via
  🛰️ Databronnen als je dat risico liever niet loopt.
- **Controleer de versie onderin de app** (bv. "Kite Weer App v12 (30 aug 2026)") na een
  `clasp deploy` om te bevestigen dat je browser niet een gecachete oudere versie toont.
- **Alleen de bot rechtstreeks starten (zonder de koppel-knop) geeft een nieuw, los profiel** —
  gebruik altijd "🔗 Koppel aan Telegram" bij ⚙️ Instellingen vanuit een bestaand browser-profiel
  om dat profiel te koppelen (zie README.md "Telegram-bot als meldingskanaal"). Een chat-ID hoort
  maar bij één profiel tegelijk; opnieuw koppelen ontkoppelt het vorige profiel automatisch.
- **De Dagvenster-default is aangepast naar 09:00-20:00** (was 07:00-21:00) — dit geldt alleen
  voor *nieuwe* profielen. Een profiel dat je al eerder had opgeslagen (met het oude venster)
  wijzigt niet automatisch mee; pas het zelf aan bij ⚙️ Instellingen als je het nieuwe venster wilt.
