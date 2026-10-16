/**
 * Restaurar uma cópia de segurança sem perder o que é mais novo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRestore, describeRestore } from '../../js/core/backup-restore.js';

test('volta o que sumiu, substitui o que o arquivo tem mais novo, e não mexe no que mudou depois da cópia', () => {
  const current = [
    { id: 'a', name: 'Alterada aqui', stage: 'proposal', updatedAt: '2026-10-10T00:00:00.000Z' },
    { id: 'b', name: 'Antiga aqui', stage: 'lead', updatedAt: '2026-09-01T00:00:00.000Z' }
  ];
  const backup = [
    { id: 'a', name: 'Versão do backup', stage: 'lead', updatedAt: '2026-09-15T00:00:00.000Z' },
    { id: 'b', name: 'Mais nova no backup', stage: 'won', updatedAt: '2026-09-20T00:00:00.000Z', orgId: 'outra-empresa' },
    { id: 'c', name: 'Excluída daqui', stage: 'lead', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: '../x', name: 'Identificador ruim' },
    { id: 'd', name: '   ' },
    { id: 'c', name: 'Repetida no arquivo' },
    null
  ];
  const plan = planRestore(backup, current);
  assert.deepEqual(plan.toAdd.map(c => c.id), ['c']);
  assert.deepEqual(plan.toReplace.map(c => c.id), ['b']);
  assert.deepEqual(plan.keptNewer.map(c => c.id), ['a']);
  assert.equal(plan.invalid, 4);
  assert.equal('orgId' in plan.toReplace[0], false, 'a empresa é sempre a da sessão, nunca a do arquivo');
  assert.equal(plan.toReplace[0].stage, 'won');
  assert.match(describeRestore(plan), /1 oportunidade volta.*1 é substituída.*1 fica como está.*4 registros do arquivo são inválidos/);
});