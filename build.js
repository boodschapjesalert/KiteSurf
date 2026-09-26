// Bouwstap: zet src/ om naar GAS-compatibele bestanden in dist/, klaar voor `clasp push`.
//
// GAS-projecten delen automatisch één globale scope over alle .gs-bestanden heen — er is dus
// geen echte module-bundelaar nodig (geen esbuild), alleen: de require()/module.exports-syntax
// verwijderen die src/logica/*.js gebruikt om in Node testbaar te zijn. Na het strippen staan
// dezelfde functies gewoon als losse top-level functies in het GAS-project, aanroepbaar vanuit
// src/gas/*.gs zonder import (zie README.md "Architectuur").

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const SRC_LOGICA = path.join(__dirname, 'src', 'logica');
const SRC_GAS = path.join(__dirname, 'src', 'gas');
const SRC_WEBAPP = path.join(__dirname, 'src', 'webapp');

function leegDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
}

/** Verwijdert require(...)-imports (eventueel over meerdere regels) en het module.exports-blok. */
function ontdoeVanNodeModuleSyntax(code) {
  const zonderExports = code.split(/\nmodule\.exports/)[0];
  const zonderRequires = zonderExports.replace(/const\s*\{[\s\S]*?\}\s*=\s*require\([^)]*\);?\n?/g, '');
  return zonderRequires.trimEnd() + '\n';
}

function bundelLogica() {
  // Prefix "logica_": op een case-insensitive bestandssysteem (Windows/NTFS) zou bv.
  // src/logica/telegramAuth.js anders naar hetzelfde pad wegschrijven als src/gas/TelegramAuth.gs
  // en die stilzwijgend overschrijven. De prefix garandeert dat namen nooit kunnen botsen,
  // ongeacht hoofd-/kleine letters.
  fs.readdirSync(SRC_LOGICA)
    .filter((f) => f.endsWith('.js'))
    .forEach((bestand) => {
      const code = fs.readFileSync(path.join(SRC_LOGICA, bestand), 'utf8');
      const bestandsnaamGas = 'logica_' + bestand.replace(/\.js$/, '.gs');
      fs.writeFileSync(path.join(DIST, bestandsnaamGas), ontdoeVanNodeModuleSyntax(code));
    });
}

function kopieerGas() {
  fs.readdirSync(SRC_GAS).forEach((bestand) => {
    fs.copyFileSync(path.join(SRC_GAS, bestand), path.join(DIST, bestand));
  });
}

function kopieerWebapp() {
  fs.readdirSync(SRC_WEBAPP).forEach((bestand) => {
    fs.copyFileSync(path.join(SRC_WEBAPP, bestand), path.join(DIST, bestand));
  });
}

/**
 * Waarschuwt vooraf voor bestandsnamen die alleen in hoofd-/kleine letters verschillen: op een
 * case-insensitive bestandssysteem (Windows) overschrijven die elkaar stilzwijgend i.p.v. een
 * duidelijke fout te geven. Zie het "logica_"-prefix in bundelLogica() voor de reden hiervan.
 */
function controleerOpNaambotsingen() {
  const geplandeNamen = [
    ...fs.readdirSync(SRC_LOGICA).filter((f) => f.endsWith('.js')).map((f) => 'logica_' + f.replace(/\.js$/, '.gs')),
    ...fs.readdirSync(SRC_GAS),
    ...fs.readdirSync(SRC_WEBAPP),
  ];
  const gezienOpKleineLetters = new Map();
  geplandeNamen.forEach((naam) => {
    const key = naam.toLowerCase();
    if (gezienOpKleineLetters.has(key) && gezienOpKleineLetters.get(key) !== naam) {
      throw new Error(
        `Bestandsnaam-botsing: "${gezienOpKleineLetters.get(key)}" en "${naam}" verschillen alleen in hoofdletters.`
      );
    }
    gezienOpKleineLetters.set(key, naam);
  });
}

function build() {
  controleerOpNaambotsingen();
  leegDist();
  bundelLogica();
  kopieerGas();
  kopieerWebapp();
  const aantal = fs.readdirSync(DIST).length;
  console.log(`Build klaar: ${aantal} bestanden in dist/`);
}

// Alleen bouwen als dit script direct gedraaid wordt (npm run build) — build-app.js hergebruikt
// ontdoeVanNodeModuleSyntax zonder meteen dist/ te herbouwen.
if (require.main === module) build();

module.exports = { ontdoeVanNodeModuleSyntax };
