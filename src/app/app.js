// Android-app (Capacitor): vervangt google.script.run van de webapp. Wordt door build-app.js
// vóór JavaScript.html geladen; JavaScript.html herkent de app aan window.KiteweerApp en stuurt
// al zijn server-aanroepen (run('getProfiel', ...), run('getWeerOordeel', ...), ...) hierheen.
//
// - Het profiel (instellingen + favorieten) staat alléén op de telefoon: Capacitor Preferences
//   (Android SharedPreferences "CapacitorStorage", ook leesbaar voor de widget/achtergrondtaak),
//   met localStorage als terugval in een gewone browser (lokaal testen).
// - Weerdata, locatie zoeken en de deel-link komen van de Apps Script-backend: een POST met het
//   profiel erin naar dezelfde /exec-URL als de webapp (zie doPost/verwerkAppApiVerzoek_ in Code.gs).
(function () {
  var config = window.KITEWEER_APP_CONFIG || {};
  var logica = window.KiteweerLogica;
  var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  var Preferences = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    ? plugins.Preferences
    : null;
  var Native = plugins.KiteweerNative || null;

  // Zelfde sleutel leest de Android-kant (KiteweerAchtergrond.java) uit "CapacitorStorage".
  var PROFIEL_SLEUTEL = 'kiteweer_profiel';
  var API_TIMEOUT_MS = 90000;

  function leesOpslag(sleutel) {
    if (Preferences) return Preferences.get({ key: sleutel }).then(function (r) { return r.value; });
    try { return Promise.resolve(localStorage.getItem(sleutel)); } catch (e) { return Promise.resolve(null); }
  }

  function schrijfOpslag(sleutel, waarde) {
    if (Preferences) return Preferences.set({ key: sleutel, value: waarde });
    try { localStorage.setItem(sleutel, waarde); } catch (e) {}
    return Promise.resolve();
  }

  function laadProfiel() {
    return leesOpslag(PROFIEL_SLEUTEL).then(function (tekst) {
      var ruw = null;
      try { ruw = tekst ? JSON.parse(tekst) : null; } catch (e) { ruw = null; }
      // null -> standaardprofiel (incl. de twee standaard-favorieten), net als een nieuw
      // Drive-profiel in de webapp.
      return logica.valideerEnVulProfielAan(ruw, null).profiel;
    });
  }

  // Widget verversen, de achtergrondtaak (meldingen) bijwerken en zo nodig om toestemming voor
  // meldingen vragen (KiteweerNativePlugin.java). Een fout hier mag de app zelf nooit hinderen.
  function synchroniseerNative() {
    if (!Native) return;
    try { Native.profielGewijzigd().catch(function () {}); } catch (e) {}
  }

  function bewaarProfiel(profiel) {
    return schrijfOpslag(PROFIEL_SLEUTEL, JSON.stringify(profiel)).then(function () {
      synchroniseerNative();
      return profiel;
    });
  }

  function api(verzoek) {
    if (!config.apiUrl) return Promise.reject(new Error('Geen API-URL geconfigureerd'));
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS) : null;
    // text/plain: een "simple request" zonder CORS-preflight — Apps Script beantwoordt geen
    // OPTIONS-verzoeken. De 302 naar script.googleusercontent.com volgt fetch vanzelf.
    return fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(verzoek),
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Server gaf HTTP ' + response.status);
        return response.text();
      })
      .then(function (tekst) {
        var json;
        try {
          json = JSON.parse(tekst);
        } catch (e) {
          throw new Error('Onverwacht antwoord van de server (is de backend bijgewerkt? zie README "Android-app")');
        }
        if (json && json.fout) throw new Error(json.fout);
        // Een Apps Script-deployment van vóór de app-API behandelt elke POST als Telegram-update
        // en antwoordt alleen {"ok":true}.
        if (json && json.ok === true && Object.keys(json).length === 1) {
          throw new Error('De backend kent de app-API nog niet — deploy eerst de nieuwe versie (zie README "Android-app").');
        }
        return json;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function tijdVan(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function vandaagIso() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // --- Weeroordelen: eerst uit de opslag, dan stil verversen --------------------------------
  // Opslag in Capacitor Preferences (SharedPreferences "CapacitorStorage"), zodat ook de
  // achtergrondtaak (KiteweerAchtergrond.java) er elk half uur verse oordelen in kan zetten: de
  // app heeft dan bij het openen meestal al een actuele voorspelling. Een bewaard oordeel telt
  // alleen als het met de huidige instellingen berekend is (logica.oordeelSleutel).

  var lopend = {}; // opslagsleutel -> Promise van een lopende ophaalactie (niet dubbel ophalen)

  function leesBewaard(profiel, locatie) {
    return leesOpslag(logica.oordeelOpslagSleutel(locatie)).then(function (tekst) {
      var bewaard = null;
      try { bewaard = tekst ? JSON.parse(tekst) : null; } catch (e) { bewaard = null; }
      return logica.bruikbaarBewaardOordeel(bewaard, logica.oordeelSleutel(profiel, locatie), vandaagIso());
    });
  }

  function bewaar(profiel, locatie, dagen) {
    var waarde = { opgehaald: Date.now(), sleutel: logica.oordeelSleutel(profiel, locatie), r: { dagen: dagen } };
    return schrijfOpslag(logica.oordeelOpslagSleutel(locatie), JSON.stringify(waarde))
      .catch(function () {})
      .then(function () { return { dagen: dagen }; });
  }

  /** Verse versie ophalen en bewaren; sluit aan bij een lopende ophaalactie (bv. het voorladen). */
  function haalOp(profiel, locatie) {
    var sleutel = logica.oordeelOpslagSleutel(locatie);
    function zelfOphalen() {
      return api({ actie: 'weeroordeel', profiel: profiel, locatie: locatie })
        .then(function (r) { return bewaar(profiel, locatie, r.dagen); });
    }
    if (lopend[sleutel]) return lopend[sleutel].catch(zelfOphalen);
    var p = zelfOphalen();
    lopend[sleutel] = p;
    p.then(opruimen, opruimen);
    function opruimen() { if (lopend[sleutel] === p) delete lopend[sleutel]; }
    return p;
  }

  /**
   * Alle favorieten waarvan geen vers oordeel bewaard is in één aanroep ophalen (actie
   * 'weeroordelen'), zodat wisselen van locatie daarna direct is. Een backend zonder die actie
   * (vóór v98): stil niets doen, de gekozen locatie haalt zichzelf dan gewoon op.
   */
  var voorladenBezig = false;
  function voorlaadFavorieten() {
    if (voorladenBezig) return;
    voorladenBezig = true;
    laadProfiel()
      .then(function (profiel) {
        var favorieten = (profiel.favorieteLocaties || []).filter(function (l) { return l.id; });
        return Promise.all(favorieten.map(function (l) {
          return leesBewaard(profiel, l).then(function (b) { return { locatie: l, bewaard: b }; });
        })).then(function (lijst) {
          var nodig = lijst.filter(function (x) {
            return !logica.isOordeelVers(x.bewaard, Date.now()) && !lopend[logica.oordeelOpslagSleutel(x.locatie)];
          }).map(function (x) { return x.locatie; });
          if (nodig.length === 0) return null;

          var batch = api({ actie: 'weeroordelen', profiel: profiel, locaties: nodig }).then(function (antwoord) {
            var perId = {};
            (antwoord.resultaten || []).forEach(function (r) { perId[r.locatieId] = r; });
            return perId;
          });
          nodig.forEach(function (l) {
            var sleutel = logica.oordeelOpslagSleutel(l);
            var p = batch.then(function (perId) {
              var r = perId[l.id];
              if (!r || r.fout || !r.dagen) throw new Error((r && r.fout) || 'Geen weeroordeel ontvangen');
              return bewaar(profiel, l, r.dagen);
            });
            lopend[sleutel] = p;
            var opruimen = function () { if (lopend[sleutel] === p) delete lopend[sleutel]; };
            p.then(opruimen, opruimen);
          });
          return batch.catch(function () {});
        });
      })
      .catch(function () {})
      .then(function () { voorladenBezig = false; });
  }

  var voorladenGepland = false;
  function planVoorladen() {
    if (voorladenGepland) return;
    voorladenGepland = true;
    setTimeout(function () { voorladenGepland = false; voorlaadFavorieten(); }, 300);
  }

  /**
   * Weeroordeel voor het scherm (JavaScript.html kiesLocatie), in stappen:
   *   cb.direct(r | null)  meteen: het bewaarde oordeel, of null als er niets bruikbaars is;
   *   cb.bezig(true/false) er wordt op de achtergrond ververst;
   *   cb.vers(r)           de verse versie (alleen als het bewaarde ouder was dan ~15 min);
   *   cb.fout(e, tijd)     ophalen mislukt; `tijd` = van wanneer het getoonde bewaarde oordeel is.
   */
  function laadWeerOordeel(locatie, cb) {
    laadProfiel()
      .then(function (profiel) {
        return leesBewaard(profiel, locatie).then(function (bewaard) {
          cb.direct(bewaard ? bewaard.r : null);
          if (logica.isOordeelVers(bewaard, Date.now())) {
            planVoorladen();
            return null;
          }
          cb.bezig(true);
          return haalOp(profiel, locatie)
            .then(function (r) { cb.vers(r); planVoorladen(); })
            .catch(function (fout) { cb.fout(fout, bewaard ? tijdVan(bewaard.opgehaald) : null); })
            .then(function () { cb.bezig(false); });
        });
      })
      .catch(function (fout) { cb.fout(fout, null); });
  }

  // Terug in de app (na een tijdje op de achtergrond): favorieten alvast bijwerken.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) planVoorladen();
  });

  var functies = {
    getProfiel: function () {
      return leesOpslag(PROFIEL_SLEUTEL).then(function (bestaand) {
        return laadProfiel().then(function (profiel) {
          // Eerste start: het standaardprofiel meteen bewaren, zodat de widget en de meldingen
          // ook zonder eerst iets op te slaan al werken. Anders alleen de widget verversen.
          if (!bestaand) return bewaarProfiel(profiel).then(function () { return { profiel: profiel }; });
          synchroniseerNative();
          return { profiel: profiel };
        });
      });
    },
    saveProfiel: function (gebruikerId, ruwProfiel) {
      var resultaat = logica.valideerEnVulProfielAan(ruwProfiel, null);
      return bewaarProfiel(resultaat.profiel).then(function () {
        return { profiel: resultaat.profiel, fouten: resultaat.fouten };
      });
    },
    voegFavorieteLocatieToeServer: function (gebruikerId, ruweLocatie) {
      return laadProfiel().then(function (profiel) {
        var resultaat = logica.voegFavorieteLocatieToe(profiel, ruweLocatie);
        return bewaarProfiel(resultaat.profiel).then(function () { return resultaat; });
      });
    },
    verwijderFavorieteLocatieServer: function (gebruikerId, locatieId) {
      return laadProfiel().then(function (profiel) {
        return bewaarProfiel(logica.verwijderFavorieteLocatie(profiel, locatieId)).then(function (nieuw) {
          return { profiel: nieuw };
        });
      });
    },
    getWeerOordeel: function (gebruikerId, locatie) {
      return laadProfiel().then(function (profiel) { return haalOp(profiel, locatie); });
    },
    vergelijkFavorieteLocaties: function () {
      return laadProfiel().then(function (profiel) { return api({ actie: 'vergelijk', profiel: profiel }); });
    },
    zoekLocatie: function (zoekterm) {
      return api({ actie: 'zoekLocatie', zoekterm: zoekterm }).then(function (r) { return r.resultaten || []; });
    },
    bouwDeelLink: function () {
      return api({ actie: 'deelLink' });
    },
  };

  // Updatemelding: de APK komt niet uit de Play Store, dus de app kijkt zelf of er in de repo een
  // nieuwere versie klaarstaat (downloads/versie.json, bijgewerkt bij elke nieuwe APK). Zo ja: een
  // balk bovenaan met een downloadlink. Geen verbinding of geen bestand: stil niets tonen.
  var UPDATE_URL = 'https://raw.githubusercontent.com/boodschapjesalert/KiteSurf/main/downloads/versie.json';

  function toonUpdateBalk(info) {
    if (document.getElementById('updateBalk')) return;
    var balk = document.createElement('div');
    balk.id = 'updateBalk';
    balk.className = 'update-balk';
    var tekst = document.createElement('span');
    tekst.textContent = '⬆️ Nieuwe versie ' + info.versie + (info.notitie ? ': ' + info.notitie : '') + ' ';
    var link = document.createElement('a');
    link.href = info.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Download';
    var sluit = document.createElement('button');
    sluit.className = 'update-balk-sluit';
    sluit.setAttribute('aria-label', 'Sluiten');
    sluit.textContent = '×';
    sluit.onclick = function () { balk.remove(); };
    tekst.appendChild(link);
    balk.appendChild(tekst);
    balk.appendChild(sluit);
    document.body.insertBefore(balk, document.body.firstChild);
  }

  function controleerOpUpdate() {
    if (!config.versie || !window.fetch) return;
    fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !/^https:\/\//.test(info.url || '')) return;
        if (logica.isNieuwereAppVersie(info.versie, config.versie)) toonUpdateBalk(info);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controleerOpUpdate);
  else controleerOpUpdate();

  window.KiteweerApp = {
    isNative: !!Preferences,
    heeftWidget: !!Native,
    versie: config.versie || '',
    laadWeerOordeel: laadWeerOordeel,
    /** Zelfde contract als google.script.run: een Promise met het resultaat, of een fout. */
    run: function (functienaam, args) {
      var fn = functies[functienaam];
      if (!fn) return Promise.reject(new Error('Onbekende functie: ' + functienaam));
      try {
        return Promise.resolve(fn.apply(null, args || []));
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
})();
