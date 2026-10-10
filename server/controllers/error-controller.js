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
const mailer = require('../mail/brevo');
const { firestoreStore } = require('../billing/firestore-store');
const { isServiceAccountConfigured } = require('../billing/google-auth');

const MAIL_EVERY_MS = 60 * 60 * 1000;
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tells the owners of the system by e-mail, at most once an hour (the rest stay in the log).
 * Never lets a problem here reach whoever reported the error.
 */
async function mailOwners(report, { store = firestoreStore, mail = mailer, now = Date.now() } = {}) {
  const owners = String(process.env.OWNER_EMAILS || '').split(',').map(item => item.trim()).filter(item => /@/.test(item));
  if (owners.length === 0 || !mail.isConfigured()) return false;
  const state = await store.getState('error_mail');
  if (state && now - (Number(state.lastSentMs) || 0) < MAIL_EVERY_MS) return false;
  // marked first: two reports arriving together send one message
  await store.setState('error_mail', { lastSentMs: now });
  const lines = [`Mensagem: ${report.message}`, `Tela: ${report.view || 'não informada'}`, `Versão: ${report.version || 'não informada'}`, `Navegador: ${report.browser || 'não informado'}`, '', report.stack || '(sem rastro)'];
  for (const email of owners) {
    await mail.sendEmail({
      to: { email },
      subject: `EDX Digital: erro na tela de alguém (${report.message.slice(0, 60)})`,
      text: [...lines, '', 'Outros erros desta hora não geram e-mail: veja todos em Functions, Registros, no console do Firebase.'].join('\n'),
      html: `<pre style="font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(lines.join('\n'))}</pre><p style="font-family:Arial,sans-serif;font-size:13px;color:#4a5565;">Outros erros desta hora não geram e-mail: veja todos em Functions, Registros, no console do Firebase.</p>`
    });
  }
  return true;
}

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
  if (isServiceAccountConfigured()) {
    mailOwners(report).catch(err => console.error('[Tela] aviso por e-mail:', err.message));
  }
}

module.exports = { handleErrorReport, mailOwners, scrub };
