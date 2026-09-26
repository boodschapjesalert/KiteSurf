# Criteria goed kite-weer — Kite Weer App

Legenda: **essentieel** = kan een harde no-go veroorzaken (overrulet de score). **nice-to-have** = weegt mee in de score, maar blokkeert niet.
Alle drempelwaarden hieronder zijn defaults/richtwaarden — in de app is elke waarde per gebruikersprofiel apart instelbaar.

---

## Windsnelheid — essentieel
| Niveau | Waarde | Betekenis |
|---|---|---|
| Minimum | 10-12 knopen (~18-22 km/u) | Onder dit niveau: no-go, te weinig kracht |
| Ideaal | 18-24 knopen (~33-44 km/u) | Breed bruikbaar voor de meeste kite-maten en niveaus |
| Gevorderd | >25 knopen (~46 km/u) | Alleen geschikt met kleinere kite / ervaren rijder |

**Instelbaar:** minimum, ideaal-onder, ideaal-boven, maximum

## Windrichting — essentieel
| Niveau | Richting t.o.v. kustlijn | Betekenis |
|---|---|---|
| Beste | Cross-shore / licht cross-onshore | Veilig: blaast je niet van de kust af, geen obstakel-turbulentie |
| Acceptabel | Onshore (recht op de kust af) | Veilig qua terugkeer, kan wat rommelig zijn door obstakels op het strand |
| No-go | Offshore / cross-offshore | Gevaarlijk: blaast je van de kust af |

**Instelbaar:** toegestane richting-range in graden (afhankelijk van kustoriëntatie van de gekozen spot)

## Windvlagen — essentieel
Vlaagfactor = (vlaag − gemiddelde) / gemiddelde
| Niveau | Vlaagfactor | Betekenis |
|---|---|---|
| Laag risico | < 30% | Stabiele, voorspelbare wind |
| Waarschuwing | 30-50% | Onstabiel, extra oplettendheid |
| No-go | > 50% | Te grillig/gevaarlijk |

**Instelbaar:** max toegestane vlaagfactor (of max absoluut verschil in knopen)

## Onweer / buien — essentieel
| Niveau | Conditie | Betekenis |
|---|---|---|
| No-go | Onweer aanwezig of voorspeld in de sessieperiode | Altijd hard no-go, ongeacht overige variabelen |
| Waarschuwing | Neerslagkans > 70% met hoge intensiteit | Zware bui te verwachten |

**Instelbaar:** neerslagkans-drempel voor waarschuwing (onweer zelf staat standaard als altijd-no-go, evt. uit te zetten)

## Luchttemperatuur — nice-to-have
| Niveau | Waarde |
|---|---|
| Comfortabel zonder extra kleding | > 15°C |
| Kouder | Wetsuit/kleding aanpassen |

**Instelbaar:** minimum comfortabele temperatuur

## Watertemperatuur — nice-to-have
| Niveau | Waarde |
|---|---|
| Comfortabel zonder wetsuit | > 18-20°C |
| Met wetsuit doenlijk | > 8-10°C |

**Instelbaar:** minimum comfortabele watertemperatuur

## Golfhoogte — nice-to-have
| Niveau | Waarde | Betekenis |
|---|---|---|
| Vlak water | < 0,5 m | Prettig voor beginners/freestyle |
| Gemiddeld | 0,5-1 m | Voor de meeste rijders prima |
| Golven gewenst | > 1 m | Alleen relevant als je juist wave-riding wilt |

**Instelbaar:** max golfhoogte (of min, voor wie golven zoekt)

## Getij / waterstand — nice-to-have
Spot-afhankelijk: sommige spots zijn alleen bij hoog water goed bereikbaar/bruikbaar, andere juist bij laag water.

**Instelbaar:** voorkeur hoog water / laag water / geen voorkeur

## Zichtbaarheid / bewolking — nice-to-have
| Niveau | Waarde |
|---|---|
| Minimum voor veiligheid | > 1-2 km zicht |
| Bewolking | Geen harde drempel, vooral comfort-/thermiek-indicator |

**Instelbaar:** minimum zicht

---

## Voorstel scoreberekening

1. **Eerst checken op no-go's** (essentiële variabelen buiten toegestane range, of onweer): zodra één hard no-go geldt → automatisch **rood**, ongeacht de rest.
2. **Als geen no-go:** score = gewogen gemiddelde van hoe dicht elke variabele bij het ideale bereik zit.
3. **Voorgestelde gewichten:**
   - Windsnelheid: 40%
   - Windrichting: 25%
   - Windvlagen: 20%
   - Nice-to-haves samen: 15%
4. **Score → kleur:**
   - 8-10 = groen
   - 5-7 = oranje
   - < 5 = rood (naast eventuele directe no-go's)
