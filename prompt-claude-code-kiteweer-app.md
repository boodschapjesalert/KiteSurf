# Gebruik

Zet dit bestand samen met `featurelijst-kiteweer-telegram-miniapp.md` en `databronnen-kiteweer-app.md` in de root van je repo. Start Claude Code in die repo en plak de tekst tussen de horizontale lijnen hieronder als eerste prompt.

---

Je bouwt een Telegram Mini App genaamd "Kite Weer App" in Google Apps Script (GAS), volledig zelfstandig en iteratief getest, zonder tussentijds bij mij te hoeven checken. Werk de volledige scope hieronder af voordat je stopt.

## Context
- Featurelijst: `featurelijst-kiteweer-telegram-miniapp.md` in deze repo
- Databronnen: `databronnen-kiteweer-app.md` in deze repo
- Taal: alle variabelenamen, functienamen en comments in de code in het Nederlands
- Doelgebruiker: kitesurfer die wil weten of het de komende 3 dagen goed weer is om te kiten

## Architectuur-eisen
1. Scheid pure logica van GAS-specifieke code, zodat het meeste zonder een live GAS-omgeving getest kan worden:
   - `src/logica/` — pure JS-modules zonder afhankelijkheid van GAS-globals (UrlFetchApp, DriveApp, PropertiesService, etc.), testbaar met Node.js. Hierin minimaal:
     - Score-/kleurberekening per variabele en per dag
     - Drempelwaarde-evaluatie (elke variabele apart instelbaar)
     - Bronnen-middeling per variabele, inclusief uitschieter-detectie
     - Validatie en parsing van het gebruikersprofiel-JSON
     - HMAC-SHA256-verificatie van Telegram `initData`
   - `src/gas/` — dunne GAS entry points (`doGet`, `doPost`, triggers) die de pure logica aanroepen en de daadwerkelijke I/O doen (UrlFetchApp naar databronnen/Telegram, DriveApp voor profielopslag, PropertiesService voor secrets)
   - `src/webapp/` — HTML/CSS/JS voor de Mini App front-end (HtmlService), inclusief de Telegram WebApp JS-integratie
2. Bouw een build-stap (bv. esbuild) die `src/` bundelt naar GAS-compatibele bestanden in `dist/`, klaar voor `clasp push`
3. Gebruik `clasp` voor het GAS-project (voeg een `.clasp.json`-template en `appsscript.json` toe)

## Functionele scope
Implementeer de volledige featurelijst uit `featurelijst-kiteweer-telegram-miniapp.md`:
- Locatie-invoer (adres/geocoding + lat/lon) + favorieten opslaan
- Weeroordeel: kleurcode, score, uitklapmenu met ruwe data (grafiek/tabel schakelbaar)
- 3-daagse forecast met uurlijkse breakdown
- Alle variabelen (essentieel + nice-to-have) uit meerdere bronnen gemiddeld, zoals beschreven in `databronnen-kiteweer-app.md`
- Per-variabele instelbare drempelwaarden
- Gebruikersprofiel gekoppeld aan Telegram `user_id`, opgeslagen als JSON in Drive
- Telegram-melding bij het behalen van de eigen drempelwaarden (geen vast schema)

## Security-eisen (hard vereist, niet optioneel)
- Verifieer Telegram `initData` server-side (HMAC-SHA256 tegen het bot-token) voordat een `user_id` vertrouwd wordt
- `setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` in de webapp
- Bot-token en API-keys uitsluitend via `PropertiesService` (Script Properties) — nooit in client-side code of in de repo
- Inputvalidatie op locatie-invoer
- Cache weerdata (`CacheService`, 10-15 min) om gratis-quota's van databronnen te sparen

## Testeisen — werk hierop door zonder tussentijds te stoppen
1. Schrijf unit tests voor alle modules in `src/logica/` met representatieve fixtures (voorbeeld-JSON-responses van elke databron, inclusief edge cases: ontbrekende bron, uitschieter, lege forecast)
2. Draai de tests, los falende tests zelf op, herhaal tot alles slaagt
3. Schrijf minstens één integratietest die een volledige "dag-score"-berekening doorloopt met gemockte data van alle bronnen tegelijk
4. Documenteer testresultaten (dekking, wat wel/niet getest kon worden zonder live GAS-omgeving) in `TESTING.md`

## Wat je zelf NIET kunt/mag doen (laat dit expliciet als to-do voor mij achter in `SETUP.md`)
- `clasp login` (Google-account authenticatie) — kan niet automatisch
- Een Telegram-bot aanmaken via @BotFather en het bot-token verkrijgen
- Het bot-token en eventuele API-keys invullen in Script Properties
- De Mini App-URL registreren bij @BotFather (`/newapp`)
- De eerste `clasp push` + deployment uitvoeren (vereist een ingelogde Google-sessie)

Beschrijf deze stappen in `SETUP.md` als een genummerde checklist die ik zelf kan doorlopen, met exact welke commando's ik moet draaien en welke waardes waar moeten komen.

## Opleverformaat
- Werkende repo met bovenstaande structuur
- `README.md`: projectoverzicht, architectuurkeuzes, hoe te bouwen/testen
- `SETUP.md`: de handmatige stappen die ik zelf moet doen
- `TESTING.md`: testdekking en resultaten
- Alle code en comments in het Nederlands

Ga zelfstandig aan de slag, maak waar nodig redelijke aannames en documenteer die kort in `README.md` onder "Aannames". Vraag mij alleen iets als je vastloopt op een keuze die de featurelijst niet dekt.
