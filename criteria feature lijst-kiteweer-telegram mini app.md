# Featurelijst — Kite Weer App (Telegram Mini App)

## Platform & toegang
- Uitsluitend toegankelijk via Telegram als **Mini App** — geen losse publieke URL
- GAS-webapp draait ingebed in een Telegram-iframe
- Mobile-first vormgeving (primaire doelplatform)

## 1. Locatie
- Vrije invoer: adres/plaatsnaam (geocoding) **of** handmatig lat/lon
- Favoriete locaties opslaan per gebruiker

## 2. Weeroordeel (gelaagde weergave)
- **Niveau 1:** kleurcode (rood/oranje/groen) per dag — snel overzicht
- **Niveau 2:** score (bv. 1-10) per dag — gradatie
- **Niveau 3:** uitklapmenu met ruwe data, schakelbaar tussen grafiek en tabel

## 3. Tijdsdetail
- 3-daagse forecast
- Uurlijkse breakdown per dag

## 4. Variabelen
- **Essentieel:** windsnelheid, windrichting, windvlagen, onweer/buien
- **Nice-to-have:** luchttemperatuur, watertemperatuur, golfhoogte, getij/waterstand, zichtbaarheid/bewolking
- Per variabele meerdere bronnen gemiddeld voor betrouwbaarheid (zie apart bestand `databronnen-kiteweer-app.md`)

## 5. Personalisatie / drempelwaarden
- Elke variabele apart instelbaar door de gebruiker
- Bepaalt zowel de kleur/score-berekening als de meldingslogica

## 6. Gebruikersprofielen
- Geïdentificeerd via het Telegram `user_id` (uit `Telegram.WebApp.initDataUnsafe`) — geen aparte gegenereerde ID of URL nodig
- Instellingen (drempelwaarden, favoriete locaties) opgeslagen als JSON-bestand in Drive, gekoppeld aan dat `user_id`
- Bij openen van de Mini App worden instellingen automatisch geladen op basis van het Telegram-account

## 7. Meldingen
- Via Telegram, alleen wanneer de eigen ingestelde drempelwaarden gehaald worden (geen vast dagelijks schema)
- Verstuurd naar dezelfde `user_id`/chat als het profiel

## 8. Vormgeving
- Mobile-first
- Uurdata schakelbaar tussen grafiek en tabel

## 9. Security
- **initData-verificatie:** elke request valideert de door Telegram meegestuurde `initData` server-side (HMAC-SHA256 tegen het bot-token) voordat een `user_id` vertrouwd wordt — voorkomt dat iemand het profiel van een ander kan claimen
- **X-Frame-Options:** `setXFrameOptionsMode(ALLOWALL)` in de GAS-webapp, nodig zodat Telegram de pagina in zijn iframe mag tonen
- **Geheimen:** bot-token en eventuele API-keys uitsluitend in Script Properties, nooit in client-side code
- **Inputvalidatie:** op locatie-invoer, om misbruik van de externe weer-API-calls te voorkomen
- **Caching:** weerdata cachen (bv. `CacheService`, 10-15 min) om gratis-quota's van databronnen te sparen (Weerlive 300/dag, Meteoserver 500/dag)
- **Drive-bestanden:** per-gebruiker profiel-JSON's zijn niet publiek gedeeld; alleen de GAS-backend leest/schrijft ze, nooit rechtstreeks door de client

---
Zie ook: `databronnen-kiteweer-app.md` voor de volledige bronnenlijst per variabele en hoe deze gecombineerd worden tot een gemiddelde.
