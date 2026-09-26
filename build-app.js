// Bouwstap voor de Android-app (Capacitor): zet dezelfde front-end als de webapp (src/webapp/)
// om naar een statische map www/ die in de APK wordt meegeleverd (zie README.md "Android-app").
//
// Wat er anders is dan in de webapp:
// - De Apps Script-template-tags (<?!= ... ?>) worden hier ingevuld i.p.v. door HtmlService.
// - src/app/app.js vervangt google.script.run: het profiel staat lokaal op de telefoon, en
//   weerdata komt via de JSON-API van dezelfde Apps Script-deployment (doPost in Code.gs).
// - De pure logica uit src/logica/ gaat mee als logica.js (profiel valideren/bewerken gebeurt op
//   de telefoon zelf), ingepakt in één functie zodat de namen niet botsen met JavaScript.html.

const fs = require('fs');
const path = require('path');
const { ontdoeVanNodeModuleSyntax } = require('./build');

const ROOT = __dirname;
const WWW = path.join(ROOT, 'www');
const SRC_LOGICA = path.join(ROOT, 'src', 'logica');
const SRC_WEBAPP = path.join(ROOT, 'src', 'webapp');
const SRC_APP = path.join(ROOT, 'src', 'app');

// De live Apps Script-deployment (zie SETUP.md stap 1). De app praat met dezelfde /exec-URL.
const EXEC_URL =
  'https://script.google.com/macros/s/AKfycbxaxYVjqJxb4IK5ep3KrVmtrMJHCVFf3j68kVzz0JhxBtKWyzYag7yI5jVF6R5RC0QY8w/exec';

const APP_VERSIE = require('./package.json').version;

// Functies uit src/logica/ die de app aan de telefoonkant nodig heeft (zie src/app/app.js).
const LOGICA_EXPORTS = ['standaardProfiel', 'valideerEnVulProfielAan', 'voegFavorieteLocatieToe', 'verwijderFavorieteLocatie', 'isNieuwereAppVersie', 'oordeelOpslagSleutel', 'oordeelSleutel', 'bruikbaarBewaardOordeel', 'isOordeelVers'];

function leesZonderBom(bestand) {
  return fs.readFileSync(bestand, 'utf8').replace(/^﻿/, '');
}

function bouwLogicaBundel() {
  const delen = fs.readdirSync(SRC_LOGICA)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => '// ---- src/logica/' + f + '\n' + ontdoeVanNodeModuleSyntax(leesZonderBom(path.join(SRC_LOGICA, f))));
  return (
    '// Gegenereerd door build-app.js uit src/logica/ — niet met de hand bewerken.\n' +
    'window.KiteweerLogica = (function () {\n' +
    delen.join('\n') +
    '\nreturn { ' + LOGICA_EXPORTS.join(', ') + ' };\n})();\n'
  );
}

const APP_CONFIG = { apiUrl: EXEC_URL, webappUrl: EXEC_URL, versie: APP_VERSIE };

function bouwConfig() {
  return '// Gegenereerd door build-app.js.\nwindow.KITEWEER_APP_CONFIG = ' + JSON.stringify(APP_CONFIG, null, 2) + ';\n';
}

function bouwIndex() {
  let html = leesZonderBom(path.join(SRC_WEBAPP, 'index.html'));
  const vervangingen = [
    ["<?!= JSON.stringify(webappUrl); ?>", JSON.stringify(EXEC_URL)],
    ["<?!= JSON.stringify(gebruikerIdUitUrl); ?>", 'null'],
    ["<?!= JSON.stringify(apkDownloadUrl); ?>", 'null'],
    ["<?!= versie; ?>", 'v' + APP_VERSIE + ' (Android)'],
    ["<?!= include('Stylesheet'); ?>", leesZonderBom(path.join(SRC_WEBAPP, 'Stylesheet.html')) + '\n    <link rel="stylesheet" href="app.css" />'],
    [
      "<?!= include('JavaScript'); ?>",
      '<script src="config.js"></script>\n    <script src="logica.js"></script>\n    <script src="app.js"></script>\n' +
        leesZonderBom(path.join(SRC_WEBAPP, 'JavaScript.html')),
    ],
  ];
  vervangingen.forEach(([tag, waarde]) => {
    if (!html.includes(tag)) throw new Error('Template-tag niet gevonden in index.html: ' + tag);
    html = html.split(tag).join(waarde);
  });
  // Links naar buiten openen in de systeembrowser (Capacitor onderschept navigatie buiten de app);
  // een <base target="_top"> is alleen nodig binnen de HtmlService-iframe.
  html = html.replace('<base target="_top" />', '');
  const overgebleven = html.match(/<\?[\s\S]*?\?>/);
  if (overgebleven) throw new Error('Onvervangen template-tag in index.html: ' + overgebleven[0]);
  return html;
}

function buildApp() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });
  fs.writeFileSync(path.join(WWW, 'index.html'), bouwIndex());
  fs.writeFileSync(path.join(WWW, 'logica.js'), bouwLogicaBundel());
  fs.writeFileSync(path.join(WWW, 'config.js'), bouwConfig());
  // Zelfde configuratie voor de Android-kant (widget/achtergrondtaak lezen assets/public/config.json).
  fs.writeFileSync(path.join(WWW, 'config.json'), JSON.stringify(APP_CONFIG, null, 2) + '\n');
  fs.readdirSync(SRC_APP).forEach((f) => fs.copyFileSync(path.join(SRC_APP, f), path.join(WWW, f)));
  console.log('App-build klaar: ' + fs.readdirSync(WWW).length + ' bestanden in www/ (versie ' + APP_VERSIE + ')');
}

if (require.main === module) buildApp();

module.exports = { buildApp, bouwLogicaBundel, bouwIndex, EXEC_URL };
