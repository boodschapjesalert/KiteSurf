const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseAppVersie, isNieuwereAppVersie } = require('../../src/logica/appVersie');

describe('appVersie', () => {
  test('parseert x.y.z, met of zonder v', () => {
    assert.deepEqual(parseAppVersie('1.10.2'), [1, 10, 2]);
    assert.deepEqual(parseAppVersie('v2.0.0'), [2, 0, 0]);
    assert.equal(parseAppVersie('1.0'), null);
    assert.equal(parseAppVersie(null), null);
  });

  test('vergelijkt numeriek per deel', () => {
    assert.equal(isNieuwereAppVersie('1.1.0', '1.0.0'), true);
    assert.equal(isNieuwereAppVersie('1.10.0', '1.9.3'), true);
    assert.equal(isNieuwereAppVersie('2.0.0', '1.99.99'), true);
    assert.equal(isNieuwereAppVersie('1.1.0', '1.1.0'), false);
    assert.equal(isNieuwereAppVersie('1.0.9', '1.1.0'), false);
  });

  test('onzin is nooit nieuwer', () => {
    assert.equal(isNieuwereAppVersie('onbekend', '1.0.0'), false);
    assert.equal(isNieuwereAppVersie('1.2.0', ''), false);
  });
});

describe('isToegestaneUpdateUrl', () => {
  const { isToegestaneUpdateUrl } = require('../../src/logica/appVersie');

  test('staat alleen vertrouwde GitHub-repo/releases en Google Drive HTTPS-links toe', () => {
    assert.equal(
      isToegestaneUpdateUrl('https://github.com/boodschapjesalert/KiteSurf/releases/download/v1.0.0/kiteweer.apk'),
      true
    );
    assert.equal(isToegestaneUpdateUrl('https://objects.githubusercontent.com/some/asset.apk'), true);
    assert.equal(isToegestaneUpdateUrl('https://release-assets.githubusercontent.com/some/asset.apk'), true);
    assert.equal(isToegestaneUpdateUrl('https://drive.google.com/uc?export=download&id=ABC'), true);
    assert.equal(isToegestaneUpdateUrl('https://drive.usercontent.google.com/download?id=ABC'), true);
  });

  test('weigert HTTP, andere domeinen en ongeldige waarden', () => {
    assert.equal(isToegestaneUpdateUrl('http://github.com/boodschapjesalert/KiteSurf/app.apk'), false);
    assert.equal(isToegestaneUpdateUrl('https://github.com/evil/KiteSurf/app.apk'), false);
    assert.equal(isToegestaneUpdateUrl('https://evil.example.com/kiteweer.apk'), false);
    assert.equal(isToegestaneUpdateUrl(null), false);
  });
});
