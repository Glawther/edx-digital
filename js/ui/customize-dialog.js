/**
 * EDX Digital - "Funil e campos"
 * Where an administrator renames the funnel stages and adds extra fields to the opportunity.
 */

import { getSavedOrganization, saveOrganization } from '../core/config.js';
import { STAGES, getDefaultStageNames } from '../core/crm-store.js';
import { escapeHtml, showToast } from './ui-renderer.js';
import { isAdmin, isReadOnly } from '../services/auth-service.js';
import { parseMoney } from '../services/import-service.js';
import {
  FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_LABEL_LENGTH, cleanStageNames, cleanCustomFields, formatCustomValue, readCustomValues
} from '../core/customization.js';

/** The company's extra fields, always a clean list */
export function getCustomFields() {
  return cleanCustomFields(getSavedOrganization().customFields);
}

/**
 * Inputs for the extra fields inside the opportunity form
 */
export function renderCustomFieldInputs(values = {}) {
  const container = document.getElementById('customer-custom-fields');
  if (!container) return;
  const fields = getCustomFields();
  container.hidden = fields.length === 0;
  container.innerHTML = fields.map(field => {
    const value = values[field.id] ?? '';
    const shown = field.type === 'number' && value !== '' ? Number(value).toLocaleString('pt-BR', { useGrouping: false }) : value;
    const attrs = field.type === 'date' ? 'type="date"' : field.type === 'number' ? 'type="text" inputmode="decimal"' : 'type="text" maxlength="500"';
    return `
      <div class="form-group">
        <label for="custom-${field.id}">${escapeHtml(field.label)}</label>
        <input ${attrs} id="custom-${field.id}" data-custom-field="${field.id}" class="form-input" value="${escapeHtml(shown)}" autocomplete="off">
      </div>
    `;
  }).join('');
}

/**
 * What was typed in those inputs, ready to store on the opportunity
 */
export function collectCustomFieldValues() {
  const raw = {};
  document.querySelectorAll('#customer-custom-fields [data-custom-field]').forEach(input => {
    raw[input.dataset.customField] = input.value;
  });
  return readCustomValues(getCustomFields(), raw);
}

/**
 * Label and value pairs for the screens that show an opportunity
 */
export function customFacts(customer) {
  const values = customer.custom || {};
  return getCustomFields()
    .map(field => ({ label: field.label, value: formatCustomValue(field, values[field.id]) }))
    .filter(fact => fact.value !== '');
}

export function setupCustomizeDialog() {
  const dialog = document.getElementById('customize-dialog');
  const form = document.getElementById('customize-form');
  if (!dialog || !form) return;
  const stagesBox = document.getElementById('customize-stages');
  const fieldsBox = document.getElementById('customize-fields');
  const btnAdd = document.getElementById('btn-add-custom-field');
  const defaults = getDefaultStageNames();
  let fields = [];

  function renderFields() {
    fieldsBox.innerHTML = fields.length === 0
      ? '<p class="empty-note" style="margin: 0 0 0.75rem;">Nenhum campo extra. Exemplos: Origem do contato, Produto de interesse, Data da visita.</p>'
      : fields.map((field, index) => `
        <div class="custom-field-row">
          <input type="text" class="form-input" value="${escapeHtml(field.label)}" maxlength="${MAX_LABEL_LENGTH}" placeholder="Nome do campo" data-index="${index}" data-part="label" aria-label="Nome do campo ${index + 1}">
          <select class="form-select" data-index="${index}" data-part="type" aria-label="Tipo do campo ${index + 1}">
            ${FIELD_TYPES.map(type => `<option value="${type.id}" ${field.type === type.id ? 'selected' : ''}>${type.label}</option>`).join('')}
          </select>
          <button type="button" class="link-btn danger" data-index="${index}" data-part="remove">Remover</button>
        </div>
      `).join('');
    btnAdd.disabled = fields.length >= MAX_CUSTOM_FIELDS;
    btnAdd.textContent = fields.length >= MAX_CUSTOM_FIELDS ? `Limite de ${MAX_CUSTOM_FIELDS} campos` : 'Adicionar campo';
  }

  fieldsBox.addEventListener('input', (event) => {
    const { index, part } = event.target.dataset;
    if (part === 'label') fields[Number(index)].label = event.target.value;
  });
  fieldsBox.addEventListener('change', (event) => {
    const { index, part } = event.target.dataset;
    if (part === 'type') fields[Number(index)].type = event.target.value;
  });
  fieldsBox.addEventListener('click', (event) => {
    const { index, part } = event.target.dataset;
    if (part !== 'remove') return;
    fields.splice(Number(index), 1);
    renderFields();
  });

  btnAdd.addEventListener('click', () => {
    if (fields.length >= MAX_CUSTOM_FIELDS) return;
    fields.push({ label: '', type: 'text' });
    renderFields();
    const inputs = fieldsBox.querySelectorAll('input[data-part="label"]');
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById('btn-menu-customize')?.addEventListener('click', () => {
    const menu = document.getElementById('header-tools-menu');
    if (menu) menu.style.display = 'none';
    if (!isAdmin()) return;
    if (isReadOnly()) {
      window.handleReadOnlyAttempt();
      return;
    }
    const org = getSavedOrganization();
    stagesBox.innerHTML = STAGES.map(stage => `
      <div class="form-group">
        <label for="stage-name-${stage.id}">${escapeHtml(defaults[stage.id])}</label>
        <input type="text" id="stage-name-${stage.id}" data-stage="${stage.id}" class="form-input" maxlength="${MAX_LABEL_LENGTH}"
               value="${escapeHtml((org.stageNames && org.stageNames[stage.id]) || '')}" placeholder="${escapeHtml(defaults[stage.id])}" autocomplete="off">
      </div>
    `).join('');
    fields = getCustomFields().map(field => ({ ...field }));
    renderFields();
    const goal = Number(org.monthlyGoal) || 0;
    document.getElementById('customize-goal').value = goal > 0 ? goal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    dialog.showModal();
  });

  const close = () => dialog.close();
  document.getElementById('btn-close-customize-dialog')?.addEventListener('click', close);
  document.getElementById('btn-cancel-customize')?.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const names = {};
    stagesBox.querySelectorAll('input[data-stage]').forEach(input => { names[input.dataset.stage] = input.value; });
    const typed = fields.filter(field => field.label.trim() !== '').length;
    const customFields = cleanCustomFields(fields);
    if (customFields.length < typed) {
      showToast('Dois campos têm o mesmo nome. Dê nomes diferentes a cada um.', 'error');
      return;
    }
    const monthlyGoal = parseMoney(document.getElementById('customize-goal').value);
    saveOrganization({ ...getSavedOrganization(), stageNames: cleanStageNames(names, defaults), customFields, monthlyGoal });
    dialog.close();
    showToast('Alterações salvas.', 'success');
  });
}
