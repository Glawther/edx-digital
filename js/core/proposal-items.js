/**
 * EDX Digital - The items of a proposal
 * What is being sold, line by line: description, quantity and unit price.
 * Pure functions. Tests: tests/unit/proposal-items.test.mjs
 */

export const MAX_ITEMS = 30;
export const MAX_ITEM_TEXT = 200;

const plain = (value) => String(value ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, MAX_ITEM_TEXT);

/** A number typed the Brazilian way ("1.250,50") or a plain one; never negative */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const text = String(value ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!text) return 0;
  const normal = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normal);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * What was typed, made safe to keep: lines with a description, sensible numbers, within the limit
 * @returns {Array<{description: string, quantity: number, unitPrice: number}>}
 */
export function cleanItems(list) {
  const clean = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const description = plain(item.description);
    if (!description) continue;
    const quantity = parseAmount(item.quantity) || 1;
    clean.push({
      description,
      quantity: Math.min(Math.round(quantity * 1000) / 1000, 1e9),
      unitPrice: Math.min(Math.round(parseAmount(item.unitPrice) * 100) / 100, 1e12)
    });
    if (clean.length >= MAX_ITEMS) break;
  }
  return clean;
}

const cents = (amount) => Math.round(amount * 100);

/** Quantity times price, to the cent */
export function lineTotal(item) {
  return cents(item.quantity * item.unitPrice) / 100;
}

/** The sum of the lines, added in cents so that 0,10 + 0,20 is 0,30 */
export function itemsTotal(items) {
  return cleanItems(items).reduce((sum, item) => sum + cents(lineTotal(item)), 0) / 100;
}

/** "2", "1,5", "0,25": a quantity as a person writes it */
export function formatQuantity(quantity) {
  return Number(quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
