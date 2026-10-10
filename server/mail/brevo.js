/**
 * EDX Digital - Sending e-mail through Brevo, without dependencies
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 *
 * Two secrets, set with `firebase functions:secrets:set` (docs/EMAILS.md):
 *   BREVO_API_KEY  the key of the Brevo account
 *   MAIL_SENDER    who the messages come from, as "Nome <endereco@dominio>"; the address has to
 *                  be a sender confirmed in Brevo
 * While either holds the word "pendente", nothing is sent.
 */

function apiBase() {
  // Overridable so tests can point at a local stand-in
  return process.env.BREVO_API_BASE || 'https://api.brevo.com';
}

function real(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'pendente' ? text : '';
}

/** "Nome <a@b.c>" or just "a@b.c" */
function parseSender(value) {
  const text = real(value);
  const named = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(text);
  if (named) return { name: named[1].trim().replace(/^"|"$/g, '') || 'EDX Digital', email: named[2] };
  return /^[^\s<>]+@[^\s<>]+$/.test(text) ? { name: 'EDX Digital', email: text } : null;
}

function isConfigured() {
  return Boolean(real(process.env.BREVO_API_KEY) && parseSender(process.env.MAIL_SENDER));
}

/**
 * @param {{to: {email: string, name?: string}, subject: string, text: string, html: string}} message
 */
async function sendEmail({ to, subject, text, html }) {
  if (!isConfigured()) throw new Error('O envio de e-mail não está configurado.');
  const res = await fetch(`${apiBase()}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': real(process.env.BREVO_API_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseSender(process.env.MAIL_SENDER),
      to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }],
      subject,
      textContent: text,
      htmlContent: html
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(`Brevo: ${data.message || `HTTP ${res.status}`}`);
    err.status = res.status;
    throw err;
  }
}

module.exports = { isConfigured, sendEmail, parseSender };
