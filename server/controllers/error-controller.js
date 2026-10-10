/**
 * EDX Digital - Errors that happened on someone's screen
 *
 * The app tells the server when something breaks, so the problem is known without the
 * customer having to report it. Each report becomes one line in the function's log
 * (Firebase console, Functions, Registros), marked as an error.
 *
 * Nothing that identifies a person or a company is accepted or kept: only what broke, on
 * which screen and in which version.
 */

const { parseJsonBody } = require('../middleware/body-parser');

const WINDOW_MS = 60000;
const PER_ADDRESS = 10;
const hits = new Map();

function tooMany(address) {
  const now = Date.now();
  const recent = (hits.get(address) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= PER_ADDRESS) return true;
  recent.push(now);
  hits.set(address, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const text = (value, max) => (typeof value === 'string' ? value : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);

// E-mail addresses and long numbers (phones, documents) do not belong in a log
const scrub = (value) => value.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]').replace(/\d{8,}/g, '[número]');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** POST /api/errors */
async function handleErrorReport(req, res) {
  const address = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (tooMany(address)) return send(res, 429, { error: 'too_many' });

  let body;
  try {
    ({ body } = await parseJsonBody(req, 8192));
  } catch {
    return send(res, 400, { error: 'invalid_body' });
  }

  const report = {
    message: scrub(text(body.message, 500)),
    stack: scrub(text(body.stack, 3000)),
    view: text(body.view, 40),
    version: text(body.version, 20),
    kind: text(body.kind, 30),
    browser: text(req.headers['user-agent'], 200)
  };
  if (!report.message) return send(res, 400, { error: 'empty' });

  // one JSON line with "severity" is what Google's log viewer files as an error
  console.error(JSON.stringify({ severity: 'ERROR', message: `[Tela] ${report.message}`, report }));
  send(res, 204, {});
}

module.exports = { handleErrorReport, scrub };
