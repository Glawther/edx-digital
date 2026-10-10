/**
 * Nexus CRM - CSV / Excel Export Service
 */

import { STAGES } from '../core/crm-store.js';

export function exportCustomersToCSV(customers, filename = 'nexus-crm-oportunidades.csv') {
  if (!customers || customers.length === 0) {
    throw new Error("Nenhum cliente disponível para exportação.");
  }

  const stageMap = {};
  STAGES.forEach(s => stageMap[s.id] = s.name);

  const headers = [
    "Nome do Contato",
    "Empresa",
    "Cargo",
    "Email",
    "Telefone",
    "Valor (R$)",
    "Estágio",
    "Prioridade",
    "Tags",
    "Anotações",
    "Data de Criação"
  ];

  const rows = customers.map(c => [
    `"${(c.name || '').replace(/"/g, '""')}"`,
    `"${(c.company || '').replace(/"/g, '""')}"`,
    `"${(c.role || '').replace(/"/g, '""')}"`,
    `"${(c.email || '').replace(/"/g, '""')}"`,
    `"${(c.phone || '').replace(/"/g, '""')}"`,
    `"${(c.dealValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"`,
    `"${stageMap[c.stage] || c.stage || 'Lead'}"`,
    `"${{ high: 'Alta', medium: 'Média', low: 'Baixa' }[c.priority] || 'Média'}"`,
    `"${(c.tags || []).join('; ').replace(/"/g, '""')}"`,
    `"${(c.notes || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    `"${c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : ''}"`
  ]);

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

export function exportAuditLogsToCSV(logs, filename = 'nexus-crm-audit-logs.csv') {
  if (!logs || logs.length === 0) {
    throw new Error("Nenhum log de auditoria para exportação.");
  }

  const headers = ["Data e Hora", "Ação", "Usuário", "Papel", "Detalhes"];
  const rows = logs.map(l => [
    `"${new Date(l.timestamp).toLocaleString('pt-BR')}"`,
    `"${(l.action || '').replace(/"/g, '""')}"`,
    `"${(l.userName || '').replace(/"/g, '""')}"`,
    `"${(l.userRole || '').replace(/"/g, '""')}"`,
    `"${(l.details || '').replace(/"/g, '""')}"`
  ]);

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

