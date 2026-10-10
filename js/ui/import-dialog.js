/**
 * EDX Digital - "Importar contatos"
 * Two steps: bring the spreadsheet, then check what will go in before anything is saved.
 */

import { storage } from '../core/storage-manager.js';
import { escapeHtml, formatBRL, showToast } from './ui-renderer.js';
import { getStageName } from '../core/crm-store.js';
import { isCloudSession, isReadOnly } from '../services/auth-service.js';
import { leadsRoom, currentPlan } from '../services/billing-service.js';
import {
  IMPORT_FIELDS, parseDelimited, looksLikeHeader, guessMapping, buildImportRows, summarizeImport
} from '../services/import-service.js';

const PREVIEW_ROWS = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function setupImportDialog() {
  const dialog = document.getElementById('import-dialog');
  if (!dialog) return;
  const el = (id) => document.getElementById(id);
  const stepSource = el('import-step-source');
  const stepReview = el('import-step-review');
  const textarea = el('textarea-import-raw');
  const fileInput = el('input-csv-file');
  const dropzone = el('import-dropzone-area');
  const btnNext = el('btn-import-next');
  const btnBack = el('btn-import-back');
  const btnConfirm = el('btn-confirm-import');
  const headerCheck = el('import-has-header');
  const duplicatesCheck = el('import-skip-duplicates');

  let table = [];
  let mapping = {};
  let summary = { ready: [], invalid: [], duplicates: [], overLimit: [] };
  let busy = false;

  function showStep(step) {
    stepSource.hidden = step !== 'source';
    stepReview.hidden = step !== 'review';
    btnNext.hidden = step !== 'source';
    btnBack.hidden = step !== 'review';
    btnConfirm.hidden = step !== 'review';
  }

  function open() {
    if (isReadOnly()) {
      window.handleReadOnlyAttempt();
      return;
    }
    textarea.value = '';
    fileInput.value = '';
    table = [];
    btnNext.disabled = true;
    showStep('source');
    dialog.showModal();
  }

  function close() {
    if (busy) return;
    dialog.close();
  }

  function readSource() {
    table = parseDelimited(textarea.value);
    btnNext.disabled = table.length === 0;
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('O arquivo passa de 2 MB. Divida a planilha em partes menores.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result || '');
      readSource();
      if (table.length > 0) startReview();
      else showToast('Não encontrei linhas nesse arquivo. Ele precisa ser um .csv ou texto, não .xlsx.', 'error');
    };
    reader.readAsText(file);
  }

  function startReview() {
    headerCheck.checked = looksLikeHeader(table[0]);
    mapping = guessMapping(table, headerCheck.checked);
    showStep('review');
    renderMapping();
    renderReview();
  }

  const columnLetter = (index) => String.fromCharCode(65 + (index % 26));

  function renderMapping() {
    const width = Math.max(...table.map(row => row.length));
    const sample = table[headerCheck.checked && table.length > 1 ? 1 : 0] || [];
    const titles = headerCheck.checked ? table[0] : [];
    const options = (selected) => [`<option value="-1">Não importar</option>`]
      .concat([...Array(width).keys()].map(index => {
        const hint = titles[index] || sample[index] || 'vazia';
        return `<option value="${index}" ${selected === index ? 'selected' : ''}>Coluna ${columnLetter(index)}: ${escapeHtml(String(hint).slice(0, 28))}</option>`;
      })).join('');

    el('import-mapping').innerHTML = IMPORT_FIELDS.map(field => `
      <div class="form-group">
        <label for="import-map-${field.id}">${field.label}${field.required ? ' (obrigatório)' : ''}</label>
        <select id="import-map-${field.id}" class="form-select form-select-sm" data-field="${field.id}">${options(mapping[field.id])}</select>
      </div>
    `).join('');
    el('import-mapping').querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => {
        mapping[select.dataset.field] = Number(select.value);
        renderReview();
      });
    });
  }

  function renderReview() {
    const rows = buildImportRows(table, mapping, { hasHeader: headerCheck.checked, existing: storage.getCustomers() });
    const room = isCloudSession() ? leadsRoom(storage.getCustomers()).left : Infinity;
    summary = summarizeImport(rows, { skipDuplicates: duplicatesCheck.checked, room });

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const parts = [];
    if (mapping.name < 0) {
      parts.push('Escolha qual coluna tem o nome do contato.');
    } else {
      parts.push(`${plural(summary.ready.length, 'oportunidade pronta', 'oportunidades prontas')} para importar.`);
      const dup = summary.duplicates.length;
      const bad = summary.invalid.length;
      const over = summary.overLimit.length;
      if (dup && duplicatesCheck.checked) parts.push(dup === 1 ? '1 já existe e não será importada de novo.' : `${dup} já existem e não serão importadas de novo.`);
      if (dup && !duplicatesCheck.checked) parts.push(dup === 1 ? '1 delas já existe.' : `${dup} delas já existem.`);
      if (bad) parts.push(bad === 1 ? '1 linha tem problema e fica de fora.' : `${bad} linhas têm problema e ficam de fora.`);
      if (over) parts.push(over === 1 ? `1 passa do limite do plano ${currentPlan().name} e fica de fora.` : `${over} passam do limite do plano ${currentPlan().name} e ficam de fora.`);
    }
    el('import-summary').textContent = parts.join(' ');

    const readyLines = new Set(summary.ready.map(row => row.line));
    const status = (row) => {
      if (row.problems.length) return `<span class="status-text blocked">Fica de fora: ${escapeHtml(row.problems.join(', '))}</span>`;
      if (row.duplicate && duplicatesCheck.checked) return '<span class="status-text pending">Já existe</span>';
      if (!readyLines.has(row.line)) return '<span class="status-text blocked">Passa do limite do plano</span>';
      const notes = [row.duplicate ? 'já existe' : '', ...row.notes].filter(Boolean);
      return `<span class="status-text active">Pronta</span>${notes.length ? `<div class="cell-sub">${escapeHtml(notes.join('; '))}</div>` : ''}`;
    };

    el('import-preview-tbody').innerHTML = rows.slice(0, PREVIEW_ROWS).map(row => `
      <tr>
        <td class="muted num">${row.line}</td>
        <td>${escapeHtml(row.lead.name) || '<span class="muted">sem nome</span>'}<div class="cell-sub">${escapeHtml(row.lead.company)}</div></td>
        <td>${escapeHtml(row.lead.phone)}<div class="cell-sub">${escapeHtml(row.lead.email)}</div></td>
        <td class="num">${formatBRL(row.lead.dealValue)}<div class="cell-sub">${escapeHtml(getStageName(row.lead.stage))}</div></td>
        <td>${status(row)}</td>
      </tr>
    `).join('');
    el('import-preview-more').textContent = rows.length > PREVIEW_ROWS
      ? `Mostrando as ${PREVIEW_ROWS} primeiras de ${rows.length} linhas. A conferência vale para todas.`
      : '';

    btnConfirm.disabled = summary.ready.length === 0 || mapping.name < 0;
    btnConfirm.textContent = summary.ready.length > 0
      ? `Importar ${plural(summary.ready.length, 'oportunidade', 'oportunidades')}`
      : 'Nada para importar';
  }

  async function runImport() {
    if (busy || summary.ready.length === 0) return;
    busy = true;
    btnConfirm.disabled = true;
    btnBack.disabled = true;
    const total = summary.ready.length;
    try {
      const result = await storage.importCustomers(summary.ready.map(row => row.lead), (done) => {
        btnConfirm.textContent = `Importando ${done} de ${total}`;
      });
      busy = false;
      dialog.close();
      const failed = result.failed.length;
      showToast(
        failed === 0
          ? `${result.imported} ${result.imported === 1 ? 'oportunidade importada' : 'oportunidades importadas'}, com a etiqueta Importado.`
          : `${result.imported} importadas e ${failed} não foram salvas (sem conexão ou sem permissão). Importe o arquivo de novo: as que já entraram serão reconhecidas como repetidas.`,
        failed === 0 ? 'success' : 'warning'
      );
    } catch (err) {
      busy = false;
      if (err.code !== 'read-only') showToast(`Não foi possível importar: ${err.message}`, 'error');
      renderReview();
    } finally {
      btnBack.disabled = false;
    }
  }

  el('btn-open-import-modal')?.addEventListener('click', open);
  el('btn-close-import-dialog').addEventListener('click', close);
  el('btn-cancel-import').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });

  textarea.addEventListener('input', readSource);
  btnNext.addEventListener('click', () => { readSource(); if (table.length > 0) startReview(); });
  btnBack.addEventListener('click', () => showStep('source'));
  btnConfirm.addEventListener('click', runImport);
  headerCheck.addEventListener('change', () => {
    mapping = guessMapping(table, headerCheck.checked);
    renderMapping();
    renderReview();
  });
  duplicatesCheck.addEventListener('change', renderReview);

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', (event) => loadFile(event.target.files && event.target.files[0]));
  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-drop-target'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drop-target'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-drop-target');
    loadFile(event.dataTransfer.files && event.dataTransfer.files[0]);
  });
}
