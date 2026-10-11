/**
 * Vários funis na mesma empresa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPipelines, pipelinesOf, pipelineIdOf, inPipeline, countByPipeline, newPipelineId, MAIN_PIPELINE, MAX_EXTRA_PIPELINES } from '../../js/core/pipelines.js';

test('toda empresa tem o funil principal; os outros vêm depois dele', () => {
  assert.deepEqual(pipelinesOf({}), [{ id: 'default', name: 'Vendas', stageNames: {} }]);
  const org = { stageNames: { lead: 'Entrada' }, mainPipelineName: 'Comercial', pipelines: [{ id: 'p_posvenda1', name: 'Pós-venda', stageNames: { lead: 'Implantação', won: 'Renovado', outra: 'x' } }] };
  assert.deepEqual(pipelinesOf(org), [
    { id: 'default', name: 'Comercial', stageNames: { lead: 'Entrada' } },
    { id: 'p_posvenda1', name: 'Pós-venda', stageNames: { lead: 'Implantação', won: 'Renovado' } }
  ]);
});

test('o que a empresa salva é limpo: identificador válido, nome obrigatório, sem repetição, até o limite', () => {
  const clean = cleanPipelines([
    { id: 'p_abc12345', name: ' Pós-venda <b> ' },
    { id: 'p_abc12345', name: 'Mesmo identificador' },
    { id: 'p_outro123', name: 'pós-venda b' },
    { id: 'default', name: 'Tenta ser o principal' },
    { id: 'p_semnome1', name: '   ' },
    { id: 'identificador ruim', name: 'X' },
    null, 'texto'
  ]);
  assert.deepEqual(clean, [{ id: 'p_abc12345', name: 'Pós-venda b', stageNames: {} }]);
  assert.equal(cleanPipelines(Array.from({ length: 9 }, (_, i) => ({ id: `p_funil00${i}`, name: `Funil ${i}` }))).length, MAX_EXTRA_PIPELINES);
  assert.deepEqual(cleanPipelines('nada'), []);
  assert.match(newPipelineId(), /^p_[a-z0-9]{8}$/);
});

test('oportunidade sem funil, ou de um funil que não existe mais, fica no principal', () => {
  const pipelines = pipelinesOf({ pipelines: [{ id: 'p_posvenda1', name: 'Pós-venda' }] });
  assert.equal(pipelineIdOf({}, pipelines), MAIN_PIPELINE);
  assert.equal(pipelineIdOf({ pipelineId: 'default' }, pipelines), MAIN_PIPELINE);
  assert.equal(pipelineIdOf({ pipelineId: 'p_posvenda1' }, pipelines), 'p_posvenda1');
  assert.equal(pipelineIdOf({ pipelineId: 'p_apagado99' }, pipelines), MAIN_PIPELINE);

  const customers = [{ id: 1 }, { id: 2, pipelineId: 'p_posvenda1' }, { id: 3, pipelineId: 'p_apagado99' }];
  assert.deepEqual(inPipeline(customers, MAIN_PIPELINE, pipelines).map(c => c.id), [1, 3]);
  assert.deepEqual(inPipeline(customers, 'p_posvenda1', pipelines).map(c => c.id), [2]);
  assert.deepEqual(countByPipeline(customers, pipelines), { default: 2, p_posvenda1: 1 });
});
