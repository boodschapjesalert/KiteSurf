// Pure logica voor de updatemelding in de Android-app (src/app/app.js): de app is geen
// Play Store-app, dus hij kijkt zelf in downloads/versie.json (GitHub) of er een nieuwere APK is.

/** "1.10.2" -> [1, 10, 2]; null bij iets dat geen versie is. */
function parseAppVersie(versie) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(versie == null ? '' : versie).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true als `beschikbaar` echt nieuwer is dan `huidig` (numeriek per deel, dus 1.10 > 1.9). */
function isNieuwereAppVersie(beschikbaar, huidig) {
  const b = parseAppVersie(beschikbaar);
  const h = parseAppVersie(huidig);
  if (!b || !h) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] !== h[i]) return b[i] > h[i];
  }
  return false;
}

/**
 * Controleert of een update-download-URL van een vertrouwde host komt (bescherming tegen
 * kwaadwillige doorverwijzingen mocht het manifest ooit manipuleerbaar zijn).
 */
function isToegestaneUpdateUrl(url) {
  if (typeof url !== 'string') return false;
  const s = url.trim();
  return (
    s.startsWith('https://github.com/boodschapjesalert/KiteSurf/') ||
    s.startsWith('https://objects.githubusercontent.com/') ||
    s.startsWith('https://release-assets.githubusercontent.com/') ||
    s.startsWith('https://drive.google.com/') ||
    s.startsWith('https://drive.usercontent.google.com/')
  );
}

module.exports = { parseAppVersie, isNieuwereAppVersie, isToegestaneUpdateUrl };
