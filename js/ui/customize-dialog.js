/**
 * EDX Digital - "Funil, campos e mensagens"
 * Where an administrator renames the funnel stages, adds extra fields to the opportunity,
 * writes the company's message templates and sets the month's goal.
 */

import { getSavedOrganization, saveOrganization } from '../core/config.js';
import { STAGES, getDefaultStageNames } from '../core/crm-store.js';
import { escapeHtml, showToast } from './ui-renderer.js';
import { isAdmin, isReadOnly } from '../services/auth-service.js';
import { parseMoney } from '../services/import-service.js';
import {
  FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_LABEL_LENGTH, cleanStageNames, cleanCustomFields, formatCustomValue, readCustomValues
} from '../core/customization.js';
import {
  MAX_TEMPLATES, MAX_TEMPLATE_NAME, MAX_TEMPLATE_TEXT, TEMPLATE_FIELDS, DEFAULT_TEMPLATES, cleanTemplates
} from '../core/message-templates.js';

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

  // ---- message templates
  const templatesBox = document.getElementById('customize-templates');
  const btnAddTemplate = document.getElementById('btn-add-template');
  const btnDefaults = document.getElementById('btn-start-from-defaults');
  let templates = [];
  const hint = document.getElementById('customize-template-fields');
  if (hint) hint.textContent = `Campos que o sistema preenche: ${TEMPLATE_FIELDS.map(field => `{${field.key}} (${field.label})`).join(', ')}.`;

  function renderTemplates() {
    templatesBox.innerHTML = templates.map((template, index) => `
      <div class="template-row">
        <input type="text" class="form-input" value="${escapeHtml(template.name)}" maxlength="${MAX_TEMPLATE_NAME}" placeholder="Nome do modelo" data-index="${index}" data-part="name" aria-label="Nome do modelo ${index + 1}">
        <button type="button" class="link-btn danger" data-index="${index}" data-part="remove">Remover</button>
        <textarea class="form-textarea" maxlength="${MAX_TEMPLATE_TEXT}" placeholder="Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}." data-index="${index}" data-part="text" aria-label="Texto do modelo ${index + 1}">${escapeHtml(template.text)}</textarea>
      </div>
    `).join('');
    btnAddTemplate.disabled = templates.length >= MAX_TEMPLATES;
    btnAddTemplate.textContent = templates.length >= MAX_TEMPLATES ? `Limite de ${MAX_TEMPLATES} modelos` : 'Adicionar modelo';
    btnDefaults.hidden = templates.length > 0;
  }

  templatesBox.addEventListener('input', (event) => {
    const { index, part } = event.target.dataset;
    if (part === 'name' || part === 'text') templates[Number(index)][part] = event.target.value;
  });
  templatesBox.addEventListener('click', (event) => {
    const { index, part } = event.target.dataset;
    if (part !== 'remove') return;
    templates.splice(Number(index), 1);
    renderTemplates();
  });
  btnAddTemplate.addEventListener('click', () => {
    if (templates.length >= MAX_TEMPLATES) return;
    templates.push({ name: '', text: '' });
    renderTemplates();
    const inputs = templatesBox.querySelectorAll('input[data-part="name"]');
    inputs[inputs.length - 1]?.focus();
  });
  btnDefaults.addEventListener('click', () => {
    templates = DEFAULT_TEMPLATES.map(({ name, text }) => ({ name, text }));
    renderTemplates();
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
    templates = cleanTemplates(org.messageTemplates);
    renderTemplates();
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
    const started = templates.filter(template => template.name.trim() !== '' || template.text.trim() !== '');
    const messageTemplates = cleanTemplates(templates);
    if (messageTemplates.length < started.length) {
      showToast('Cada modelo de mensagem precisa de um nome e de um texto, e os nomes não podem se repetir.', 'error');
      return;
    }
    const monthlyGoal = parseMoney(document.getElementById('customize-goal').value);
    saveOrganization({ ...getSavedOrganization(), stageNames: cleanStageNames(names, defaults), customFields, messageTemplates, monthlyGoal });
    dialog.close();
    showToast('Alterações salvas.', 'success');
  });
}
