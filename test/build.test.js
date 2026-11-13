const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { ontdoeVanNodeModuleSyntax, build } = require('../build');
const { bouwLogicaBundel, bouwIndex } = require('../build-app');

const ROOT = path.join(__dirname, '..');

describe('build & bundel-integriteit', () => {
  test('alle src/logica/*.js en src/gas/*.gs laden zonder naamconflicten of syntaxfouten in één VM-scope', () => {
    const logicaDir = path.join(ROOT, 'src', 'logica');
    const gasDir = path.join(ROOT, 'src', 'gas');
    const ctx = vm.createContext({ module: { exports: {} }, exports: {} });

    fs.readdirSync(logicaDir)
      .filter((f) => f.endsWith('.js'))
      .sort()
      .forEach((f) => {
        const code = ontdoeVanNodeModuleSyntax(fs.readFileSync(path.join(logicaDir, f), 'utf8'));
        vm.runInContext(code, ctx, { filename: 'logica_' + f });
      });

    fs.readdirSync(gasDir)
      .filter((f) => f.endsWith('.gs'))
      .sort()
      .forEach((f) => {
        const code = fs.readFileSync(path.join(gasDir, f), 'utf8');
        vm.runInContext(code, ctx, { filename: f });
      });

    assert.equal(typeof ctx.berekenDagScore, 'function');
    assert.equal(typeof ctx.doPost, 'function');
  });

  test('build-app logica-bundel en index.html bouwen schoon en exporteren verwachte app-helpers', () => {
    const win = {};
    vm.runInNewContext(bouwLogicaBundel(), { window: win });
    [
      'standaardProfiel',
      'isNieuwereAppVersie',
      'isToegestaneUpdateUrl',
      'oordeelSleutel',
      'bruikbaarBewaardOordeel',
      'isOordeelVers',
      'maakOnboardingConcept',
      'berekenVlaagVoorbeeldKnopen',
      'valideerOnboardingStap',
      'pasOnboardingConceptToeOpProfiel',
    ].forEach((fn) => {
      assert.equal(typeof win.KiteweerLogica[fn], 'function', `ontbrekende export: ${fn}`);
    });

    const html = bouwIndex();
    assert.equal(/<\?[\s\S]*?\?>/.test(html), false);
    assert.ok(html.includes('id="onboardingWizard"'));
    const webJs = fs.readFileSync(path.join(ROOT, 'src', 'webapp', 'JavaScript.html'), 'utf8')
      .replace(/^[\s\S]*?<script>/, '')
      .replace(/<\/script>[\s\S]*$/, '');
    new vm.Script(webJs, { filename: 'src/webapp/JavaScript.html' });
    new vm.Script(fs.readFileSync(path.join(ROOT, 'src', 'app', 'app.js'), 'utf8'), { filename: 'src/app/app.js' });
  });

  test('build.js injecteert onboarding-logica in dist/JavaScript.html zonder syntaxfouten', () => {
    build();
    const jsHtml = fs.readFileSync(path.join(ROOT, 'dist', 'JavaScript.html'), 'utf8');
    assert.equal(jsHtml.includes('// __ONBOARDING_WIZARD_LOGICA__'), false);
    assert.ok(jsHtml.includes('KiteweerOnboardingLogica'));
    assert.equal(jsHtml.includes('// __WINDRICHTING_LOGICA__'), false);
    assert.ok(jsHtml.includes('KiteweerWindrichtingLogica'));
    const scriptBody = jsHtml.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, '');
    new vm.Script(scriptBody, { filename: 'dist/JavaScript.html' });
  });
});
