/**
 * EDX Digital - What a form sends, cleaned
 * Only the fields the CRM understands, under the names it uses, as plain text with a size
 * limit. The lead itself is written into the company's opportunities by lead-intake.js.
 */

// Plain text with a size limit. Escaping for the screen is the screen's job.
function text(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, '').trim().slice(0, max);
}

/**
 * Keeps the fields the CRM understands, under the names it uses
 */
function normalizeLeadPayload(rawData) {
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};
  const value = Number(data.value ?? data.valor ?? 0);
  return {
    name: text(data.name || data.nome || data.full_name, 200),
    email: text(data.email, 200),
    phone: text(data.phone || data.whatsapp || data.telefone || data.celular, 40),
    company: text(data.company || data.empresa, 200),
    value: Number.isFinite(value) && value > 0 ? Math.min(value, 1000000000) : 0,
    source: text(data.source || data.origem, 80),
    notes: text(data.notes || data.mensagem || data.message, 2000)
  };
}

module.exports = { normalizeLeadPayload };
