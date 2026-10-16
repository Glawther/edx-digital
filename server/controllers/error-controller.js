/**
 * EDX Digital - Errors that happened on someone's screen
 *
 * The app tells the server when something breaks, so the problem is known without the
 * customer having to report it. Each report becomes one line in the function's log
 * (Firebase console, Functions, Registros), marked as an error.
 *
 * Nothing that identifies a person or a company is accepted or kept: only what broke, on
 * which screen and in which version.
 *
 * Every report is logged, including those from the sign-in screen (no session there). Only a
 * report that carries a valid Firebase session token can become the hourly e-mail: otherwise
 * anyone could write the owner's e-mail and spend the hour's slot hiding the real errors.
 */

const { parseJsonBody } = require('../middleware/body-parser');
const mailer = require('../mail/brevo');
const { firestoreStore } = require('../billing/firestore-store');
const { isServiceAccountConfigured, verifyIdToken } = require('../billing/google-auth');

const MAIL_EVERY_MS = 60 * 60 * 1000;
const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Report text is untrusted: in the e-mail every field is one short line, so it cannot add
// lines of its own or pose as another part of the message
const oneLine = (value, max) => String(value ?? '').replace(/[\r\n\t\u000B\u000C\u0085\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const STACK_MAX = 2000;
const STACK_LINES = 40;
const MAIL_FOOTER = 'Outros erros desta hora não geram e-mail: veja todos em Functions, Registros, no console do Firebase.';

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
  const message = oneLine(report.message, 200) || '(sem mensagem)';
  const fields = [
    ['Mensagem', message],
    ['Tela', oneLine(report.view, 40) || 'não informada'],
    ['Versão', oneLine(report.version, 20) || 'não informada'],
    ['Navegador', oneLine(report.browser, 200) || 'não informado']
  ];
  const stackLines = String(report.stack || '').slice(0, STACK_MAX).split(/\r\n|[\r\n\u2028\u2029]/).slice(0, STACK_LINES).map(line => line.replace(/[\t\u000B\u000C\u0085]/g, ' ').trimEnd());
  const hasStack = stackLines.some(line => line.trim());
  // indented, so no line of the stack can pass for a field or for the end of the block
  const stackText = hasStack ? stackLines.map(line => `    ${line}`).join('\n') : '    (sem rastro)';
  const plain = [
    ...fields.map(([label, value]) => `${label}: ${value}`),
    '',
    'Rastro enviado pela tela (texto do relato, não verificado):',
    stackText,
    'Fim do rastro.',
    '',
    MAIL_FOOTER
  ].join('\n');
  const cell = 'font-family:Arial,sans-serif;font-size:13px;padding:2px 12px 2px 0;vertical-align:top;';
  const html = `<table style="border-collapse:collapse;">${fields.map(([label, value]) => `<tr><td style="${cell}color:#4a5565;">${escapeHtml(label)}</td><td style="${cell}">${escapeHtml(value)}</td></tr>`).join('')}</table>`
    + '<p style="font-family:Arial,sans-serif;font-size:13px;color:#4a5565;margin:16px 0 4px;">Rastro enviado pela tela (texto do relato, não verificado):</p>'
    + `<pre style="font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap;border:1px solid #d1d5dc;background:#f3f4f6;padding:8px;margin:0;">${escapeHtml(hasStack ? stackLines.join('\n') : '(sem rastro)')}</pre>`
    + `<p style="font-family:Arial,sans-serif;font-size:13px;color:#4a5565;">${escapeHtml(MAIL_FOOTER)}</p>`;
  try {
    for (const email of owners) {
      await mail.sendEmail({
        to: { email },
        subject: `EDX Digital: erro na tela de alguém (${oneLine(message, 60)})`,
        text: plain,
        html
      });
    }
  } catch (err) {
    // a message that did not go out must not silence the next hour
    await store.setState('error_mail', { lastSentMs: 0 });
    throw err;
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

/** Does the report carry a valid session? Any failure counts as no. */
async function hasValidSession(req, verifyToken) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  try {
    const user = await verifyToken(header.slice(7));
    return Boolean(user && user.uid);
  } catch {
    return false;
  }
}

/**
 * POST /api/errors
 * deps can be swapped in tests: the token checker, the e-mail step and whether e-mail is on.
 * Resolves after the e-mail step has finished (the reply has already gone out by then).
 */
async function handleErrorReport(req, res, { verifyToken = verifyIdToken, notify = mailOwners, mailEnabled = isServiceAccountConfigured } = {}) {
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
  if (!mailEnabled()) return;
  // anonymous reports stay in the log only; they never reach the owner's inbox
  if (!(await hasValidSession(req, verifyToken))) return;
  try {
    await notify(report);
  } catch (err) {
    console.error('[Tela] aviso por e-mail:', err.message);
  }
}

module.exports = { handleErrorReport, mailOwners, scrub };
