/**
 * EDX Digital - CSV / Excel Export Service
 */

import { STAGES } from '../core/crm-store.js';
import { csvSafe } from './import-service.js';
import { getCustomFields } from '../ui/customize-dialog.js';
import { formatCustomValue } from '../core/customization.js';

export function exportCustomersToCSV(customers, filename = 'edx-digital-oportunidades.csv') {
  if (!customers || customers.length === 0) {
    throw new Error("Nenhum cliente disponível para exportação.");
  }

  const stageMap = {};
  STAGES.forEach(s => stageMap[s.id] = s.name);

  const customFields = getCustomFields();
  // Quoted, and with anything a spreadsheet would run as a formula neutralised
  const cell = (value) => `"${csvSafe(value).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

  const headers = [
    "Nome do contato", "Empresa", "Cargo", "E-mail", "Telefone", "Valor (R$)", "Etapa", "Prioridade",
    "Responsável", "Previsão de fechamento", "Etiquetas", "Anotações", "Criada em",
    ...customFields.map(field => field.label)
  ].map(cell);

  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
  const rows = customers.map(c => [
    c.name, c.company, c.role, c.email, c.phone,
    (Number(c.dealValue) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    stageMap[c.stage] || c.stage || '',
    { high: 'Alta', medium: 'Média', low: 'Baixa' }[c.priority] || 'Média',
    c.assignedTo?.name || '',
    c.expectedCloseDate ? date(c.expectedCloseDate + (c.expectedCloseDate.length === 10 ? 'T12:00:00' : '')) : '',
    (c.tags || []).join('; '),
    c.notes,
    date(c.createdAt),
    ...customFields.map(field => formatCustomValue(field, (c.custom || {})[field.id]))
  ].map(cell));

  // Prepend UTF-8 BOM so Microsoft Excel handles Portuguese special characters correctly
  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
