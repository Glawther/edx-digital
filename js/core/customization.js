/**
 * EDX Digital - What each company adapts: the names of the funnel stages and extra fields
 * on an opportunity. Kept on the company record (stageNames, customFields).
 * Pure functions; tests in tests/unit/customization.test.mjs
 */

export const MAX_CUSTOM_FIELDS = 8;
export const MAX_LABEL_LENGTH = 40;

export const FIELD_TYPES = [
  { id: 'text', label: 'Texto' },
  { id: 'number', label: 'Número' },
  { id: 'date', label: 'Data' }
];

const tidy = (text) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Keeps only stage names that differ from the default and are worth saving
 * @returns {Object} e.g. { lead: 'Interessado' }
 */
export function cleanStageNames(names, defaults) {
  const result = {};
  Object.keys(defaults).forEach(id => {
    const name = tidy(names && names[id]).slice(0, MAX_LABEL_LENGTH);
    if (name && name !== defaults[id]) result[id] = name;
  });
  return result;
}

/**
 * Tidies the list of extra fields: no empty or repeated labels, known types, at most MAX_CUSTOM_FIELDS.
 * A field keeps its id for life, so renaming it never loses what was filled in.
 */
export function cleanCustomFields(fields) {
  const seen = new Set();
  const result = [];
  (Array.isArray(fields) ? fields : []).forEach(field => {
    const label = tidy(field && field.label).slice(0, MAX_LABEL_LENGTH);
    const key = label.toLowerCase();
    if (!label || seen.has(key) || result.length >= MAX_CUSTOM_FIELDS) return;
    seen.add(key);
    result.push({
      id: /^cf_[a-z0-9]{4,12}$/.test(field.id || '') ? field.id : 'cf_' + Math.random().toString(36).slice(2, 10),
      label,
      type: FIELD_TYPES.some(t => t.id === field.type) ? field.type : 'text'
    });
  });
  return result;
}

/**
 * What the person typed, ready to store: only the company's fields, empty ones left out
 */
export function readCustomValues(fields, raw) {
  const values = {};
  fields.forEach(field => {
    const text = tidy(raw && raw[field.id]);
    if (!text) return;
    if (field.type === 'number') {
      const number = Number(text.replace(/\./g, '').replace(',', '.'));
      if (!isNaN(number)) values[field.id] = number;
    } else if (field.type === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) values[field.id] = text;
    } else {
      values[field.id] = text.slice(0, 500);
    }
  });
  return values;
}

/**
 * A stored value the way it is shown on screen and in the exported file
 */
export function formatCustomValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'number') return Number(value).toLocaleString('pt-BR');
  if (field.type === 'date') {
    const [year, month, day] = String(value).split('-');
    return day ? `${day}/${month}/${year}` : String(value);
  }
  return String(value);
}
