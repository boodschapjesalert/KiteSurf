// Lokale ontwikkel-backend voor de Android-app: draait de gebouwde Apps Script-code (dist/*.gs)
// in Node, met minimale nabootsingen van de GAS-diensten die de app-API nodig heeft
// (UrlFetchApp via curl, CacheService in het geheugen, Utilities.formatDate, ContentService).
// Doel: de app (www/) en de app-API (doPost -> verwerkAppApiVerzoek_) lokaal end-to-end kunnen
// testen tegen de échte weerbronnen, zónder eerst naar Apps Script te hoeven deployen.
//
// Gebruik:
//   npm run build && TZ=Europe/Amsterdam node tools/gas-dev-server.js [poort]
//   -> POST http://localhost:8787/exec   (zelfde JSON-body als de app naar /exec stuurt)
//   -> GET  http://localhost:8787/       (serveert www/, met de API-URL naar deze server)
//
// Niet nagebootst (dus niet bruikbaar via deze server): Drive-profielen, Slides-grafieken,
// Telegram, triggers. API-sleutels (KNMI, Weerlive) komen uit de omgevingsvariabelen
// KNMI_API_KEY / WEERLIVE_API_KEY; zonder sleutel slaat de backend die bronnen gewoon over.

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WWW = path.join(ROOT, 'www');
const POORT = Number(process.argv[2] || process.env.PORT || 8787);

if (process.env.TZ !== 'Europe/Amsterdam') {
  console.warn('Let op: start met TZ=Europe/Amsterdam — de logica rekent met lokale tijd, net als Apps Script.');
}

// --- GAS-nabootsingen ---------------------------------------------------------------------------

function nieuwResponse(status, tekst, headers) {
  return {
    getResponseCode: () => status,
    getContentText: () => tekst,
    getHeaders: () => headers || {},
    getAllHeaders: () => headers || {},
  };
}

// Parallel ophalen via losse curl-processen (curl respecteert HTTPS_PROXY), synchroon afgewacht
// zoals UrlFetchApp.fetchAll — via een klein hulpscript omdat GAS-code synchroon is.
const FETCH_HULP = `
const { execFile } = require('child_process');
const verzoeken = JSON.parse(require('fs').readFileSync(0, 'utf8'));
Promise.all(verzoeken.map((v) => new Promise((resolve) => {
  const args = ['-sS', '-L', '--max-time', '30', '-w', '\\n%{http_code}', '-X', (v.method || 'get').toUpperCase()];
  Object.entries(v.headers || {}).forEach(([k, w]) => args.push('-H', k + ': ' + w));
  if (v.payload != null) {
    args.push('-H', 'Content-Type: ' + (v.contentType || 'application/x-www-form-urlencoded'));
    args.push('--data-binary', typeof v.payload === 'string' ? v.payload : JSON.stringify(v.payload));
  }
  args.push(v.url);
  execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (fout, stdout) => {
    if (fout && !stdout) return resolve({ status: 0, tekst: String(fout.message) });
    const i = stdout.lastIndexOf('\\n');
    resolve({ status: Number(stdout.slice(i + 1)) || 0, tekst: stdout.slice(0, i) });
  });
}))).then((r) => process.stdout.write(JSON.stringify(r)));
`;

function haalOp(verzoeken) {
  const uit = execFileSync(process.execPath, ['-e', FETCH_HULP], {
    input: JSON.stringify(verzoeken),
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(uit.toString('utf8')).map((r, i) => {
    if (r.status === 0 && !verzoeken[i].muteHttpExceptions) throw new Error('Fetch mislukt: ' + r.tekst);
    return nieuwResponse(r.status, r.tekst);
  });
}

const UrlFetchApp = {
  fetch: (url, opties) => haalOp([{ ...(opties || {}), url }])[0],
  fetchAll: (verzoeken) => haalOp(verzoeken.map((v) => (typeof v === 'string' ? { url: v } : v))),
};

const cacheOpslag = new Map();
const cache = {
  get: (k) => {
    const item = cacheOpslag.get(k);
    if (!item || item.tot < Date.now()) return null;
    return item.waarde;
  },
  put: (k, waarde, seconden) => cacheOpslag.set(k, { waarde: String(waarde), tot: Date.now() + (seconden || 600) * 1000 }),
  remove: (k) => cacheOpslag.delete(k),
};
const CacheService = { getScriptCache: () => cache, getUserCache: () => cache };

const properties = {
  WEERLIVE_API_KEY: process.env.WEERLIVE_API_KEY || '',
  KNMI_API_KEY: process.env.KNMI_API_KEY || '',
};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (properties[k] != null && properties[k] !== '' ? properties[k] : null),
    setProperty: (k, w) => { properties[k] = String(w); },
    deleteProperty: (k) => { delete properties[k]; },
    getProperties: () => ({ ...properties }),
  }),
};

function delenIn(datum, tijdzone) {
  const delen = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tijdzone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(datum).forEach((p) => { delen[p.type] = p.value; });
  return delen;
}

const Utilities = {
  // Alleen de patronen die dit project gebruikt (zie grep op Utilities.formatDate in src/gas).
  formatDate: (datum, tijdzone, patroon) => {
    const d = delenIn(datum, tijdzone);
    const vervangingen = {
      yyyy: d.year, MM: d.month, dd: d.day, HH: d.hour, H: String(Number(d.hour)),
      mm: d.minute, m: String(Number(d.minute)), ss: d.second,
      SSS: String(datum.getMilliseconds()).padStart(3, '0'), XXX: tijdzone === 'UTC' ? 'Z' : '+00:00',
    };
    return patroon
      .split(/('[^']*')/)
      .map((stuk) => (stuk.startsWith("'") ? stuk.slice(1, -1) : stuk.replace(/yyyy|MM|dd|HH|H|mm|m|ss|SSS|XXX/g, (t) => vervangingen[t])))
      .join('');
  },
  getUuid: () => require('crypto').randomUUID(),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url'),
};

const ContentService = {
  MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
  createTextOutput: (tekst) => {
    const uitvoer = { tekst, mime: 'text/plain', setMimeType: (m) => { uitvoer.mime = m; return uitvoer; }, getContent: () => tekst };
    return uitvoer;
  },
};

const context = vm.createContext({
  UrlFetchApp, CacheService, PropertiesService, Utilities, ContentService,
  Logger: { log: (...a) => console.log('[Logger]', ...a) },
  ScriptApp: { getService: () => ({ getUrl: () => 'http://localhost:' + POORT + '/exec' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
  console,
});

if (!fs.existsSync(DIST)) {
  console.error('dist/ ontbreekt — draai eerst `npm run build`.');
  process.exit(1);
}
// Alle .gs-bestanden in één script, net als de gedeelde globale scope van een GAS-project.
const code = fs.readdirSync(DIST)
  .filter((f) => f.endsWith('.gs'))
  .sort()
  .map((f) => '// ---- ' + f + '\n' + fs.readFileSync(path.join(DIST, f), 'utf8'))
  .join('\n');
vm.runInContext(code, context, { filename: 'dist-bundel.gs' });

// --- HTTP ---------------------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const start = Date.now();
      let uitvoer;
      try {
        uitvoer = context.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
      } catch (fout) {
        uitvoer = ContentService.createTextOutput(JSON.stringify({ fout: String(fout && fout.stack || fout) }));
      }
      let actie = '?';
      try { actie = JSON.parse(body).actie; } catch (e) { /* geen JSON */ }
      console.log('POST /exec', actie, (Date.now() - start) + 'ms');
      res.writeHead(200, { ...cors, 'Content-Type': uitvoer.mime || 'application/json' });
      res.end(uitvoer.tekst);
    });
    return;
  }
  if (req.method === 'GET') {
    const pad = decodeURIComponent(req.url.split('?')[0]);
    const bestand = path.join(WWW, pad === '/' ? 'index.html' : pad);
    if (!bestand.startsWith(WWW) || !fs.existsSync(bestand) || fs.statSync(bestand).isDirectory()) {
      res.writeHead(404, cors);
      return res.end('Niet gevonden');
    }
    let inhoud = fs.readFileSync(bestand);
    if (bestand.endsWith('config.js')) {
      // Laat de lokaal geserveerde app met déze server praten i.p.v. de live /exec-URL.
      inhoud = inhoud.toString('utf8') + '\nwindow.KITEWEER_APP_CONFIG.apiUrl = ' + JSON.stringify('http://localhost:' + POORT + '/exec') + ';\n';
    }
    res.writeHead(200, { ...cors, 'Content-Type': MIME[path.extname(bestand)] || 'application/octet-stream' });
    return res.end(inhoud);
  }
  res.writeHead(405, cors);
  res.end();
}).listen(POORT, () => console.log('GAS dev-server op http://localhost:' + POORT + ' (POST /exec)'));
