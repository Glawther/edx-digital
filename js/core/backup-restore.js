/**
 * EDX Digital - Restoring a backup without losing what is newer
 * A backup is a copy from some moment. Restoring it brings back what is missing and what the
 * backup has in a newer version, and leaves alone what changed here after the copy was made.
 * Pure functions. Tests: tests/unit/backup-restore.test.mjs
 */

import { isSafeId } from './html.js';
import { normalizeCustomer } from './normalize.js';

const time = (customer) => Date.parse(customer.updatedAt || customer.createdAt || '') || 0;

/**
 * @param {Array} backupCustomers - what the backup file has
 * @param {Array} currentCustomers - what is here now
 * @returns {{toAdd: Array, toReplace: Array, keptNewer: Array, invalid: number}}
 */
export function planRestore(backupCustomers, currentCustomers) {
  const current = new Map((currentCustomers || []).map(customer => [customer.id, customer]));
  const plan = { toAdd: [], toReplace: [], keptNewer: [], invalid: 0 };
  const seen = new Set();
  for (const raw of Array.isArray(backupCustomers) ? backupCustomers : []) {
    if (!raw || typeof raw !== 'object' || !isSafeId(raw.id) || !String(raw.name || '').trim() || seen.has(raw.id)) {
      plan.invalid += 1;
      continue;
    }
    seen.add(raw.id);
    const { firestoreId, clientLeadId, orgId, ...rest } = raw;
    const customer = { ...normalizeCustomer(rest), id: raw.id };
    const here = current.get(raw.id);
    if (!here) plan.toAdd.push(customer);
    else if (time(customer) > time(here)) plan.toReplace.push(customer);
    else plan.keptNewer.push(customer);
  }
  return plan;
}

/** The question asked before restoring, in plain words */
export function describeRestore(plan) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (plan.toAdd.length) parts.push(`${n(plan.toAdd.length, 'oportunidade volta', 'oportunidades voltam')} (não existem mais aqui)`);
  if (plan.toReplace.length) parts.push(`${n(plan.toReplace.length, 'é substituída pela versão do arquivo, que é mais nova', 'são substituídas pela versão do arquivo, que é mais nova')}`);
  if (plan.keptNewer.length) parts.push(`${n(plan.keptNewer.length, 'fica como está', 'ficam como estão')}, porque mudou aqui depois da cópia`);
  if (plan.invalid) parts.push(`${n(plan.invalid, 'registro do arquivo é inválido e fica de fora', 'registros do arquivo são inválidos e ficam de fora')}`);
  return parts.length ? parts.join('; ') + '.' : 'O arquivo não tem nada para restaurar.';
}