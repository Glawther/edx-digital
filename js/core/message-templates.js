/**
 * EDX Digital - Message templates
 * The starting points for a WhatsApp message. Each company can write its own; until it does,
 * the four standard ones are used. Pure functions. Tests: tests/unit/message-templates.test.mjs
 */

export const MAX_TEMPLATES = 12;
export const MAX_TEMPLATE_NAME = 40;
export const MAX_TEMPLATE_TEXT = 1000;

/** What can be written inside a template, and what each one becomes */
export const TEMPLATE_FIELDS = [
  { key: 'nome', label: 'primeiro nome do contato' },
  { key: 'nome_completo', label: 'nome completo do contato' },
  { key: 'empresa', label: 'empresa do contato' },
  { key: 'vendedor', label: 'quem está enviando' },
  { key: 'minha_empresa', label: 'nome da sua empresa' },
  { key: 'valor', label: 'valor da oportunidade' },
  { key: 'etapa', label: 'etapa do funil' }
];

// stages: where in the funnel the template fits best (it is offered first there)
export const DEFAULT_TEMPLATES = [
  { id: 'first_contact', name: 'Primeiro contato', stages: ['lead', 'contact'],
    text: 'Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}. Recebi seu contato e queria entender melhor o que você precisa. Tem uns minutos hoje para conversarmos?' },
  { id: 'proposal_followup', name: 'Retorno da proposta', stages: ['proposal'],
    text: 'Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}. Conseguiu ver a proposta que enviei? Se ficou alguma dúvida sobre valores ou prazos, posso esclarecer agora.' },
  { id: 'negotiation', name: 'Negociação', stages: ['negotiation'],
    text: 'Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}. Queria saber como ficou a avaliação da proposta e se falta algum ajuste para fecharmos.' },
  { id: 'cold_lead', name: 'Retomar contato', stages: ['lost'],
    text: 'Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}. Faz um tempo que conversamos. Isso ainda é uma prioridade para você agora, ou prefere que eu volte a falar mais adiante?' }
];

const plain = (value, max) => String(value ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

/**
 * What a company saved, made safe to use: plain text, sizes within limits, no empty or repeated names
 */
export function cleanTemplates(list) {
  const seen = new Set();
  const clean = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const name = plain(item.name, MAX_TEMPLATE_NAME);
    const text = plain(item.text, MAX_TEMPLATE_TEXT);
    if (!name || !text || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    clean.push({ name, text });
    if (clean.length >= MAX_TEMPLATES) break;
  }
  return clean;
}

/** The company's templates, or the standard ones when it has none */
export function templatesFor(org) {
  const own = cleanTemplates(org && org.messageTemplates);
  return own.length > 0 ? own.map(item => ({ ...item, stages: [] })) : DEFAULT_TEMPLATES;
}

/**
 * Replaces {nome}, {empresa} and the others. A field with nothing to put in it takes the words
 * around it along, so the message never reads "da ." or "Olá, !".
 */
export function fillTemplate(text, { customer = {}, userName = '', companyName = '', stageName = '' } = {}) {
  const fullName = String(customer.name || '').trim();
  const amount = Number(customer.dealValue) || 0;
  const values = {
    nome: fullName.split(/\s+/)[0] || '',
    nome_completo: fullName,
    empresa: String(customer.company || '').trim(),
    vendedor: String(userName || '').trim() || 'da equipe',
    minha_empresa: String(companyName || '').trim() || 'nossa empresa',
    valor: amount > 0 ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '',
    etapa: String(stageName || '').trim()
  };
  return String(text || '')
    .replace(/\{([a-z_]+)\}/g, (whole, key) => (key in values ? values[key] : whole))
    // "Olá, !" when the contact has no name
    .replace(/,\s*([!.?])/g, '$1')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The templates as offered for one opportunity: filled in, the one that fits its stage first */
export function messagesFor(org, context) {
  const stage = (context.customer && context.customer.stage) || 'lead';
  return templatesFor(org)
    .map((template, index) => ({ template, index, fits: template.stages.includes(stage) }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.index - b.index)
    .map(({ template }) => ({ tone: template.name, text: fillTemplate(template.text, context) }));
}
