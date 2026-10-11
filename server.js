// MIT Mysore Bus Tracker server. Run: node server.js  (no npm install needed)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const read = f => fs.readFileSync(path.join(__dirname, f));
const ROUTES = JSON.parse(read('routes.json'));
// PINs come from the DRIVER_PINS environment variable when hosted online, else from drivers.json (never served to browsers)
const PINS = JSON.parse(process.env.DRIVER_PINS || read('drivers.json'));
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/driver.html': 'driver.html', '/routes.json': 'routes.json' };
const tokens = {}, trips = {}, fails = {};              // tokens[token]=routeId, trips[routeId]={startedAt,pos}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(ok => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && FILES[url]) {
    const json = FILES[url].endsWith('.json');
    res.writeHead(200, { 'Content-Type': json ? 'application/json' : 'text/html; charset=utf-8' });
    return res.end(read(FILES[url]));
  }
  if (url === '/api/positions') {                        // public: only buses on an active trip with fresh GPS
    const now = Date.now();
    return send(res, 200, Object.entries(trips).filter(([, t]) => t.pos && now - t.pos.ts < 60000)
      .map(([id, t]) => ({ route: id, bus: ROUTES.find(r => r.id === id).bus, ...t.pos })));
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  const b = await body(req);

  if (url === '/api/login') {
    const f = fails[b.route] ||= { n: 0, until: 0 };
    if (f.n >= 5 && Date.now() < f.until) return send(res, 429, { error: 'Too many wrong PINs. Wait a minute.' });
    if (f.n >= 5) f.n = 0;
    if (PINS[b.route] && String(b.pin) === PINS[b.route]) {
      f.n = 0; const t = crypto.randomBytes(16).toString('hex'); tokens[t] = b.route; return send(res, 200, { token: t });
    }
    if (++f.n >= 5) f.until = Date.now() + 60000;
    return send(res, 401, { error: 'Wrong route or PIN' });
  }

  const route = tokens[b.token];
  if (!route) return send(res, 401, { error: 'Please log in again' });
  if (url === '/api/me') return send(res, 200, { route, active: !!trips[route] });
  if (url === '/api/trip/start') { trips[route] = { startedAt: Date.now() }; return send(res, 200, { ok: 1 }); }
  if (url === '/api/trip/stop') { delete trips[route]; return send(res, 200, { ok: 1 }); }
  if (url === '/api/location') {
    if (!trips[route]) return send(res, 409, { error: 'Trip not started' });
    const lat = +b.lat, lng = +b.lng;
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return send(res, 400, { error: 'Bad position' });
    trips[route].pos = { lat, lng, speed: Math.round(+b.speed || 0), ts: Date.now() };
    return send(res, 200, { ok: 1 });
  }
  send(res, 404, { error: 'Not found' });
}).listen(PORT, '0.0.0.0', () => console.log(`Bus tracker running:\n  Students: http://localhost:${PORT}\n  Drivers : http://localhost:${PORT}/driver.html`));
