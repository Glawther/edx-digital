/**
 * EDX Digital - Files attached to an opportunity
 * The file itself lives in Firebase Storage; the opportunity keeps a short list saying what is
 * there. Only document and image types are accepted, and never anything a browser would run.
 * Pure functions. Tests: tests/unit/attachments.test.mjs
 */

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 120;

// extension -> the content type the file is stored with (the same list is in storage.rules)
export const ATTACHMENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain'
};

export const ACCEPT_ATTRIBUTE = Object.keys(ATTACHMENT_TYPES).map(ext => '.' + ext).join(',');

export function extensionOf(name) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(name ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** The name as shown and offered on download: no folders, no markup, no control characters */
export function safeFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[<>"]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (base.length <= MAX_NAME) return base;
  const ext = extensionOf(base);
  return ext ? base.slice(0, MAX_NAME - ext.length - 1) + '.' + ext : base.slice(0, MAX_NAME);
}

export function newAttachmentId(random = Math.random) {
  return 'a_' + Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
}

/** Where the file is kept. The name people see is not part of the address. */
export function attachmentPath(orgId, customerId, attachment) {
  return `orgs/${orgId}/customers/${customerId}/${attachment.id}.${attachment.ext}`;
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** The list as stored, made safe: valid id and type each, no repeats, within the limit */
export function cleanAttachments(list) {
  const clean = [];
  const ids = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '');
    const ext = String(item.ext || '').toLowerCase();
    const name = safeFileName(item.name);
    const size = Number(item.size);
    if (!/^a_[a-z0-9]{6,16}$/.test(id) || ids.has(id) || !ATTACHMENT_TYPES[ext] || !name || !Number.isFinite(size) || size < 0) continue;
    ids.add(id);
    clean.push({
      id, ext, name, size,
      by: typeof item.by === 'string' ? item.by.slice(0, 200) : '',
      at: typeof item.at === 'string' && !isNaN(Date.parse(item.at)) ? item.at : new Date(0).toISOString()
    });
    if (clean.length >= MAX_ATTACHMENTS) break;
  }
  return clean;
}

/**
 * Can this file be attached? Says why not, in words for the person.
 * @param {{name: string, size: number}} file
 * @param {Array} existing - what the opportunity already has
 */
export function checkFile(file, existing = []) {
  if (!file || !safeFileName(file.name)) return { ok: false, message: 'Escolha um arquivo.' };
  if (existing.length >= MAX_ATTACHMENTS) return { ok: false, message: `Cada oportunidade guarda até ${MAX_ATTACHMENTS} arquivos. Exclua um para anexar outro.` };
  const ext = extensionOf(file.name);
  if (!ATTACHMENT_TYPES[ext]) return { ok: false, message: 'Este tipo de arquivo não é aceito. Use PDF, imagem (PNG, JPG, WEBP), Word, Excel, CSV ou texto.' };
  if (!(file.size > 0)) return { ok: false, message: 'O arquivo está vazio.' };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: `O arquivo tem ${formatBytes(file.size)}; o limite é ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
  return { ok: true, ext, contentType: ATTACHMENT_TYPES[ext] };
}
