/**
 * EDX Digital - The panel of whoever owns the system
 * Every company, its plan, where it stands and what was received. Only the server decides
 * who may see it (server/controllers/owner-controller.js); for anyone else the entry in the
 * tools menu never appears.
 */

import { getIdToken, isCloudSession } from '../services/auth-service.js';
import { escapeHtml, formatBRL, showToast } from './ui-renderer.js';
import { downloadCsv } from '../services/export-service.js';

const STATES = {
  paid: { label: 'Pago', warn: false },
  grace: { label: 'Vencido, em tolerância', warn: true },
  trial: { label: 'Em teste', warn: false },
  trial_ended: { label: 'Teste encerrado', warn: true },
  expired: { label: 'Plano vencido', warn: true },
  legacy: { label: 'Sem data de teste', warn: false }
};
const PLAN_NAMES = { starter: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };

let lastOverview = null;

async function ask(path) {
  const token = await getIdToken();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Não foi possível carregar o painel.');
  return res.json();
}

function when(company) {
  if (company.daysLeft === null) return '';
  const date = new Date(company.endsAtMs).toLocaleDateString('pt-BR');
  if (company.daysLeft > 0) return `${date} (em ${company.daysLeft} ${company.daysLeft === 1 ? 'dia' : 'dias'})`;
  return `${date} (há ${Math.max(1, -company.daysLeft + 1)} ${-company.daysLeft + 1 === 1 ? 'dia' : 'dias'})`;
}

function render(overview) {
  const { totals, companies } = overview;
  const figure = (label, value, note = '') => `<div class="figure-box"><div class="figure-label">${label}</div><div class="figure-value">${value}</div><div class="figure-note">${note}</div></div>`;
  document.getElementById('owner-content').innerHTML = `
    <div class="figure-row">
      ${figure('Empresas', totals.companies, `${totals.people} pessoas com acesso`)}
      ${figure('Pagando', totals.paying, totals.grace ? `${totals.grace} com o plano vencido, em tolerância` : 'Com o período em dia')}
      ${figure('Em teste', totals.trial, `${totals.ended} com teste ou plano encerrado`)}
      ${figure('Valor mensal', formatBRL(totals.monthlyValue), 'Soma dos planos de quem está pagando')}
      ${figure('Recebido em 30 dias', formatBRL(totals.received30d), `${formatBRL(totals.receivedAll)} desde o início`)}
    </div>
    ${companies.length === 0 ? '<p class="empty-note">Nenhuma empresa cadastrada ainda.</p>' : `
    <div class="table-scroll">
      <table class="plain-table">
        <thead><tr><th>Empresa</th><th>Situação</th><th>Plano</th><th>Termina</th><th class="num">Pessoas</th><th class="num">Oportunidades</th><th>Criada em</th></tr></thead>
        <tbody>
          ${companies.map(company => `
            <tr>
              <td><strong>${escapeHtml(company.name || 'Sem nome')}</strong><div class="cell-sub">${escapeHtml(company.ownerEmail)}</div></td>
              <td><span class="${STATES[company.state]?.warn ? 'is-warning' : ''}">${STATES[company.state]?.label || escapeHtml(company.state)}</span>${company.full ? '<div class="cell-sub">Plano cheio</div>' : ''}</td>
              <td>${PLAN_NAMES[company.plan] || escapeHtml(company.plan)}</td>
              <td>${when(company)}</td>
              <td class="num">${company.people}</td>
              <td class="num">${company.opportunities}</td>
              <td>${company.createdAt ? new Date(company.createdAt).toLocaleDateString('pt-BR') : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`}
    <p class="empty-note">Atualizado em ${new Date(overview.generatedAt).toLocaleString('pt-BR')}. Os números de oportunidades são só a contagem: o conteúdo de cada empresa não é lido por esta tela.</p>`;
}

async function open() {
  const dialog = document.getElementById('owner-dialog');
  const content = document.getElementById('owner-content');
  content.innerHTML = '<p class="empty-note">Carregando...</p>';
  if (!dialog.open) dialog.showModal();
  try {
    lastOverview = await ask('/api/owner/overview');
    render(lastOverview);
  } catch (err) {
    content.innerHTML = `<p class="empty-note">${escapeHtml(err.message)}</p>`;
  }
}

function exportCsv() {
  if (!lastOverview || lastOverview.companies.length === 0) return showToast('Não há empresas para exportar.', 'info');
  const rows = [['Empresa', 'E-mail de quem criou', 'Situação', 'Plano', 'Termina em', 'Pessoas', 'Oportunidades', 'Criada em']];
  for (const company of lastOverview.companies) {
    rows.push([
      company.name, company.ownerEmail, STATES[company.state]?.label || company.state, PLAN_NAMES[company.plan] || company.plan,
      company.endsAtMs ? new Date(company.endsAtMs).toLocaleDateString('pt-BR') : '', String(company.people), String(company.opportunities),
      company.createdAt ? new Date(company.createdAt).toLocaleDateString('pt-BR') : ''
    ]);
  }
  downloadCsv(rows, 'edx-digital-empresas.csv');
}

export function setupOwnerPanel() {
  const dialog = document.getElementById('owner-dialog');
  if (!dialog) return;
  document.getElementById('btn-menu-owner')?.addEventListener('click', () => {
    const menu = document.getElementById('header-tools-menu');
    if (menu) menu.style.display = 'none';
    open();
  });
  document.getElementById('btn-close-owner-dialog')?.addEventListener('click', () => dialog.close());
  document.getElementById('btn-owner-refresh')?.addEventListener('click', open);
  document.getElementById('btn-owner-export')?.addEventListener('click', exportCsv);
}

/**
 * Called when a session begins: asks the server whether this person owns the system and
 * shows or hides the entry in the tools menu accordingly.
 */
export async function refreshOwnerEntry() {
  const entry = document.getElementById('btn-menu-owner');
  if (!entry) return;
  entry.hidden = true;
  if (!isCloudSession()) return;
  try {
    entry.hidden = !(await ask('/api/owner/check')).owner;
  } catch { /* without an answer the entry stays hidden */ }
}
