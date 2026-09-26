# Databronnen — Kite Weer App

Per variabele minimaal 2 bronnen waar mogelijk, zodat er een gemiddelde/cross-check kan plaatsvinden. Alle bronnen hieronder zijn gratis.

---

## Windsnelheid, windrichting, windvlagen

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Forecast API** | `https://api.open-meteo.com/v1/forecast` | Nee | Wereldwijd, tot 16 dagen | Hoofdbron. Params: `hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m`. Combineert meerdere nationale weermodellen (o.a. KNMI, DWD, ECMWF, Météo-France) automatisch via `best_match`. |
| 2 | **Buienradar JSON-feed** | `https://data.buienradar.nl/2.0/feed/json` | Nee | Alleen NL (meetstations) | Actuele waarnemingen (windspeed, windgusts, winddirection). Geen 3-daagse forecast — dus vooral bruikbaar als "ground truth" voor vandaag. |
| 3 | **Weerlive.nl API** | `https://weerlive.nl/api/json-data-10min.php` | Ja (gratis) | Alleen NL | KNMI 10-min-netwerk, 5-daagse dagverwachting + 24u uurverwachting. Max 300 requests/dag. Backlink naar weerlive.nl vereist. |

## Onweer / buien

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Forecast API** | zelfde als boven | Nee | Wereldwijd | Params: `hourly=weather_code,precipitation_probability`. Weathercode geeft onweer/buien aan. |
| 2 | **Buienradar raintext** | `https://gpsgadget.buienradar.nl/data/raintext?lat=..&lon=..` | Nee | Alleen NL | Neerslag-nowcasting per 5 min, tot 2 uur vooruit. Geschikt voor "nu/komend uur", niet voor dag 2-3. |

## Luchttemperatuur

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Forecast API** | zelfde als boven | Nee | Wereldwijd | Param: `hourly=temperature_2m` |
| 2 | **Buienradar JSON-feed** | zelfde als boven | Nee | Alleen NL | Actuele temperatuur per meetstation |
| 3 | **Weerlive.nl API** | zelfde als boven | Ja (gratis) | Alleen NL | Actuele + verwachte temperatuur |

## Watertemperatuur

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Marine API** | `https://marine-api.open-meteo.com/v1/marine` | Nee | Wereldwijd zee/kust | Param: `hourly=sea_surface_temperature`. Werkt op elke kustcoördinaat, dus geschikt voor vrije locatie-invoer. |
| 2 | **Rijkswaterstaat WaterWebservices** | zie `https://rijkswaterstaat.github.io/wm-ws-dl/` | Nee | Alleen NL, bij RWS-meetpunten | Officiële meetdata, alleen op/nabij vaste meetpunten (niet overal). |

## Golfhoogte

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Marine API** | zelfde als boven | Nee | Wereldwijd zee/kust | Params: `hourly=wave_height,wave_direction,wave_period` |
| 2 | **Rijkswaterstaat Waterinfo** | zie `https://rijkswaterstaat.github.io/wm-ws-dl/` | Nee | Alleen NL kust/Waddenzee | Golfhoogte bij vaste meetpunten. |

## Getij / waterstand

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Rijkswaterstaat WaterWebservices** | zie `https://rijkswaterstaat.github.io/wm-ws-dl/` | Nee | Alleen NL Rijkswateren | Officiële bron voor waterstand/getij per meetpunt. |
| 2 | **Meteoserver.nl** | zie `https://www.meteoserver.nl/` | Ja (gratis, max 500/dag) | Alleen NL | Astronomisch getij, alleen lopende maand. |

## Zichtbaarheid / bewolking

| # | Bron | Endpoint | Key nodig | Bereik | Opmerking |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Forecast API** | zelfde als boven | Nee | Wereldwijd | Params: `hourly=visibility,cloud_cover` |
| 2 | **Buienradar JSON-feed** | zelfde als boven | Nee | Alleen NL | Actueel zicht per meetstation. |

---

## Hoe combineren tot een gemiddelde

- **Dag 2 en 3:** alleen bronnen met een echte forecast meenemen (Open-Meteo, Open-Meteo Marine, Weerlive). Bronnen die alleen actuele waarnemingen geven (Buienradar-feed, raintext) hier overslaan.
- **Vandaag/nu:** actuele-waarnemingsbronnen (Buienradar, RWS) mogen zwaarder wegen of los als "live check" naast de forecast getoond worden.
- **Rekenmethode:** eenvoudig rekenkundig gemiddelde per variabele per uur; ontbrekende bron (bv. geen watertemperatuur bij een inland-locatie) gewoon overslaan, niet als 0 meetellen.
- **Uitschieters:** optioneel een bron negeren als deze >X% afwijkt van het gemiddelde van de overige bronnen (voorkomt dat één rammelende bron de score verstoort).

## Praktisch voor de GAS-implementatie

- **Open-Meteo (weer + marine)** zijn de enige bronnen die overal ter wereld werken zonder key — belangrijk omdat de locatie vrij invoerbaar is. Voor locaties buiten Nederland vallen de NL-specifieke bronnen automatisch weg; bouw hiervoor een fallback in (gewoon minder bronnen middelen).
- **Caching** (`CacheService`, 10-15 min) voorkomt dat elke bezoeker van de publieke app een verse call naar alle bronnen triggert.
- **Gratis-quota's goed in de gaten houden:** Weerlive 300 requests/dag, Meteoserver 500 requests/dag — met een publieke app is caching hier extra belangrijk.
