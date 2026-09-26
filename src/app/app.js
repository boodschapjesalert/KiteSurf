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
  var CACHE_PREFIX = 'kiteweer_oordeel_';
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

  function tijdNu() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // Laatste weeroordeel per locatie bewaren, zodat de app zonder verbinding (op het strand...)
  // nog de laatst opgehaalde voorspelling kan tonen i.p.v. alleen een foutmelding.
  function weerOordeelMetCache(locatie) {
    var sleutel = CACHE_PREFIX + (locatie.id || locatie.lat + ',' + locatie.lon);
    return laadProfiel()
      .then(function (profiel) { return api({ actie: 'weeroordeel', profiel: profiel, locatie: locatie }); })
      .then(function (r) {
        try { localStorage.setItem(sleutel, JSON.stringify({ tijd: tijdNu(), datum: new Date().toDateString(), r: r })); } catch (e) {}
        return r;
      })
      .catch(function (fout) {
        var bewaard = null;
        try { bewaard = JSON.parse(localStorage.getItem(sleutel) || 'null'); } catch (e) {}
        if (!bewaard || !bewaard.r) throw fout;
        var r = bewaard.r;
        r.uitCache = bewaard.datum === new Date().toDateString() ? bewaard.tijd : bewaard.tijd + ' (eerdere dag)';
        return r;
      });
  }

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
      return weerOordeelMetCache(locatie);
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

  window.KiteweerApp = {
    isNative: !!Preferences,
    heeftWidget: !!Native,
    versie: config.versie || '',
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
