/**
 * EDX Digital - More than one funnel in the same company
 * Sales, after-sales, a second product line: each funnel is a board of its own, with the same
 * six stages under names of its own. Every company has the main funnel; the others are optional.
 * Pure functions. Tests: tests/unit/pipelines.test.mjs
 */

export const MAIN_PIPELINE = 'default';
export const MAX_EXTRA_PIPELINES = 5;
export const MAX_PIPELINE_NAME = 40;
const STAGE_IDS = ['lead', 'contact', 'proposal', 'negotiation', 'won', 'lost'];

const plain = (value, max) => String(value ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max);

function cleanNames(names) {
  const clean = {};
  if (names && typeof names === 'object' && !Array.isArray(names)) {
    for (const id of STAGE_IDS) {
      const name = plain(names[id], MAX_PIPELINE_NAME);
      if (name) clean[id] = name;
    }
  }
  return clean;
}

/** A new id for a funnel: short, and never the main one's */
export function newPipelineId(random = Math.random) {
  return 'p_' + Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
}

/**
 * The extra funnels a company saved, made safe: a valid id and a name each, no repeats, within the limit
 */
export function cleanPipelines(list) {
  const clean = [];
  const ids = new Set([MAIN_PIPELINE]);
  const names = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '');
    const name = plain(item.name, MAX_PIPELINE_NAME);
    if (!/^p_[a-z0-9]{4,16}$/.test(id) || !name || ids.has(id) || names.has(name.toLowerCase())) continue;
    ids.add(id);
    names.add(name.toLowerCase());
    clean.push({ id, name, stageNames: cleanNames(item.stageNames) });
    if (clean.length >= MAX_EXTRA_PIPELINES) break;
  }
  return clean;
}

/** Every funnel of a company, the main one first */
export function pipelinesOf(org) {
  const data = org || {};
  return [
    { id: MAIN_PIPELINE, name: plain(data.mainPipelineName, MAX_PIPELINE_NAME) || 'Vendas', stageNames: cleanNames(data.stageNames) },
    ...cleanPipelines(data.pipelines)
  ];
}

/**
 * The funnel an opportunity is in. One whose funnel no longer exists (or never had one) is
 * in the main funnel, so nothing ever disappears from the screen.
 */
export function pipelineIdOf(customer, pipelines) {
  const id = customer && customer.pipelineId;
  return id && pipelines.some(pipeline => pipeline.id === id) ? id : MAIN_PIPELINE;
}

export function inPipeline(customers, pipelineId, pipelines) {
  return (customers || []).filter(customer => pipelineIdOf(customer, pipelines) === pipelineId);
}

/** How many opportunities each funnel holds */
export function countByPipeline(customers, pipelines) {
  const counts = Object.fromEntries(pipelines.map(pipeline => [pipeline.id, 0]));
  for (const customer of customers || []) counts[pipelineIdOf(customer, pipelines)] += 1;
  return counts;
}
