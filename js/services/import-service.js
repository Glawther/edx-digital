/**
 * EDX Digital - Importing contacts from a spreadsheet
 *
 * Pure functions (no screen, no storage) so they can be tested on their own:
 *   text -> table -> which column is what -> rows ready to import, each with its problems.
 * Tests: tests/unit/import-service.test.mjs
 */

/** Fields a column can be matched to. `words` are header spellings seen in exported spreadsheets. */
export const IMPORT_FIELDS = [
  { id: 'name', label: 'Nome do contato', required: true, words: ['nome', 'name', 'contato', 'cliente', 'lead', 'nome completo', 'nome do contato', 'full name'] },
  { id: 'company', label: 'Empresa', words: ['empresa', 'company', 'organizacao', 'razao social', 'conta', 'account'] },
  { id: 'phone', label: 'Telefone', words: ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel', 'mobile', 'numero'] },
  { id: 'email', label: 'E-mail', words: ['email', 'e-mail', 'mail', 'correio'] },
  { id: 'dealValue', label: 'Valor', words: ['valor', 'value', 'valor estimado', 'valor (r$)', 'preco', 'ticket', 'amount', 'deal value', 'orcamento'] },
  { id: 'role', label: 'Cargo', words: ['cargo', 'role', 'funcao', 'job title', 'title', 'posicao'] },
  { id: 'stage', label: 'Etapa do funil', words: ['etapa', 'estagio', 'stage', 'fase', 'status'] },
  { id: 'tags', label: 'Etiquetas', words: ['etiquetas', 'tags', 'etiqueta', 'tag', 'categoria'] },
  { id: 'notes', label: 'Anotações', words: ['anotacoes', 'notas', 'notes', 'observacoes', 'observacao', 'obs', 'comentarios', 'descricao'] }
];

const plain = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Reads an amount typed the Brazilian way (1.234,56) and also 1234.56 or 1234
 */
export function parseMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val < 0 || isNaN(val) ? 0 : Math.min(val, 1000000000);
  let text = String(val).replace(/[^\d.,]/g, '');
  if (text.includes(',')) {
    // comma is the decimal mark; dots are thousands separators
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // 1.234 or 12.345.678: dots are thousands separators
    text = text.replace(/\./g, '');
  }
  const num = parseFloat(text);
  return isNaN(num) || num < 0 ? 0 : Math.min(num, 1000000000);
}

/**
 * Splits pasted or file text into rows of cells. Handles ; , and tab, quoted cells,
 * quotes inside quotes ("") and line breaks inside a quoted cell.
 */
export function parseDelimited(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/).find(line => line.trim()) || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = count('\t') > 0 ? '\t' : (count(';') >= count(',') && count(';') > 0 ? ';' : ',');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

/**
 * Does the first row look like column titles rather than a contact?
 */
export function looksLikeHeader(firstRow) {
  if (!firstRow) return false;
  const known = IMPORT_FIELDS.flatMap(field => field.words);
  const hits = firstRow.filter(cell => known.includes(plain(cell))).length;
  return hits >= 1 && !firstRow.some(cell => /@|\d{4,}/.test(cell));
}

/**
 * Suggests which column holds which field: { name: 0, company: 1, ... } (-1 when not found).
 * With titles, they decide. Without, the content does (an @ is an e-mail, many digits a phone)
 * and what is left follows the usual order: name, company.
 */
export function guessMapping(rows, hasHeader) {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map(field => [field.id, -1]));
  if (!rows.length) return mapping;
  const width = Math.max(...rows.map(row => row.length));

  if (hasHeader) {
    rows[0].forEach((title, index) => {
      const key = plain(title);
      const field = IMPORT_FIELDS.find(f => mapping[f.id] === -1 && f.words.includes(key))
        || IMPORT_FIELDS.find(f => mapping[f.id] === -1 && f.words.some(word => key.includes(word) && word.length > 3));
      if (field) mapping[field.id] = index;
    });
    return mapping;
  }

  const sample = rows.slice(0, 20);
  const share = (index, test) => sample.filter(row => test(row[index] || '')).length / sample.length;
  const taken = new Set();
  const take = (fieldId, test) => {
    for (let index = 0; index < width; index++) {
      if (!taken.has(index) && share(index, test) >= 0.6) {
        mapping[fieldId] = index;
        taken.add(index);
        return;
      }
    }
  };
  take('email', value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  take('phone', value => /^\+?[\d\s().-]{8,}$/.test(value) && value.replace(/\D/g, '').length >= 8 && value.replace(/\D/g, '').length <= 13 && /[\s()+-]/.test(value) || /^\d{10,13}$/.test(value));
  take('dealValue', value => /^(r\$\s*)?[\d.,]+$/i.test(value) && value.replace(/\D/g, '').length > 0);
  const free = [...Array(width).keys()].filter(index => !taken.has(index));
  if (free.length > 0) mapping.name = free[0];
  if (free.length > 1) mapping.company = free[1];
  return mapping;
}

const STAGE_WORDS = {
  lead: ['lead', 'novo', 'novo lead', 'new'],
  contact: ['contato', 'primeiro contato', 'contact', 'contacted', 'qualificado'],
  proposal: ['proposta', 'proposta enviada', 'proposal'],
  negotiation: ['negociacao', 'em negociacao', 'negotiation'],
  won: ['ganho', 'fechado', 'fechado ganho', 'won', 'vendido', 'cliente'],
  lost: ['perdido', 'lost', 'perda']
};

function readStage(value) {
  const key = plain(value);
  if (!key) return 'lead';
  const match = Object.entries(STAGE_WORDS).find(([, words]) => words.includes(key));
  return match ? match[0] : null;
}

const digitsOf = (value) => String(value || '').replace(/\D/g, '');
// The same person typed two ways: with or without the country code
const phoneKey = (value) => digitsOf(value).replace(/^55(?=\d{10,11}$)/, '');

/**
 * Turns the table into opportunities, saying what is wrong with each row.
 *   problems: the row cannot be imported (no name, invalid e-mail)
 *   notes:    it can, but something was adjusted or looks odd
 *   duplicate: the same e-mail or phone already exists, here or earlier in the file
 *
 * @param {string[][]} rows
 * @param {Object} mapping  - from guessMapping, possibly corrected by the person
 * @param {Object} options  - hasHeader, existing (current opportunities)
 */
export function buildImportRows(rows, mapping, { hasHeader = false, existing = [] } = {}) {
  const seenEmails = new Set(existing.map(c => plain(c.email)).filter(Boolean));
  const seenPhones = new Set(existing.map(c => phoneKey(c.phone)).filter(key => key.length >= 8));
  const cell = (row, fieldId) => (mapping[fieldId] >= 0 ? String(row[mapping[fieldId]] || '').replace(/[<>]/g, '').trim() : '');

  return rows.slice(hasHeader ? 1 : 0).map((row, index) => {
    const problems = [];
    const notes = [];
    const name = cell(row, 'name');
    const email = cell(row, 'email');
    const phone = cell(row, 'phone');
    const rawValue = cell(row, 'dealValue');
    const rawStage = cell(row, 'stage');

    if (!name) problems.push('sem nome');
    if (name.length > 300) problems.push('nome longo demais');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('e-mail inválido');
    if (phone && digitsOf(phone).length < 8) notes.push('telefone parece incompleto');
    if (rawValue && !/\d/.test(rawValue)) notes.push('valor não reconhecido, ficou R$ 0');

    let stage = readStage(rawStage);
    if (stage === null) {
      notes.push(`etapa "${rawStage}" não reconhecida, entra como novo lead`);
      stage = 'lead';
    }

    const emailKey = plain(email);
    const phoneId = phoneKey(phone);
    const duplicate = Boolean((emailKey && seenEmails.has(emailKey)) || (phoneId.length >= 8 && seenPhones.has(phoneId)));
    if (!duplicate && problems.length === 0) {
      if (emailKey) seenEmails.add(emailKey);
      if (phoneId.length >= 8) seenPhones.add(phoneId);
    }

    return {
      line: index + 1 + (hasHeader ? 1 : 0),
      problems,
      notes,
      duplicate,
      lead: {
        name,
        company: cell(row, 'company'),
        phone,
        email,
        role: cell(row, 'role'),
        dealValue: parseMoney(rawValue),
        stage,
        priority: 'medium',
        notes: cell(row, 'notes'),
        tags: cell(row, 'tags').split(/[;,|]/).map(tag => tag.trim()).filter(Boolean)
      }
    };
  });
}

/**
 * Counts for the summary line and the list that will actually be imported
 */
export function summarizeImport(importRows, { skipDuplicates = true, room = Infinity } = {}) {
  const invalid = importRows.filter(row => row.problems.length > 0);
  const duplicates = importRows.filter(row => row.problems.length === 0 && row.duplicate);
  let ready = importRows.filter(row => row.problems.length === 0 && !(skipDuplicates && row.duplicate));
  // Won and lost ones do not count toward the plan, so they always fit
  let left = room;
  const fitting = [];
  const overLimit = [];
  ready.forEach(row => {
    const open = row.lead.stage !== 'won' && row.lead.stage !== 'lost';
    if (!open) fitting.push(row);
    else if (left > 0) { fitting.push(row); left--; }
    else overLimit.push(row);
  });
  ready = fitting;
  return { ready, invalid, duplicates, overLimit };
}

/**
 * A cell that a spreadsheet would run as a formula gets an apostrophe in front (export side)
 */
export function csvSafe(value) {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
