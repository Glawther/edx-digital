/**
 * Cobrança PIX: a janela pergunta pelo pagamento no relógio e ao voltar para a aba.
 * As duas perguntas juntas não podem confirmar o pagamento duas vezes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentWatcher } from '../../js/core/payment-watch.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('duas consultas ao mesmo tempo: uma pergunta só ao servidor e uma confirmação só', async () => {
  const answer = deferred();
  let asked = 0;
  const approved = [];
  const watcher = createPaymentWatcher({
    fetchStatus: () => { asked += 1; return answer.promise; },
    onApproved: (result, id) => { approved.push(id); }
  });

  const fromTimer = watcher.check('pay-1');
  const fromTab = watcher.check('pay-1');
  answer.resolve({ status: 'approved', plan: 'pro' });
  await Promise.all([fromTimer, fromTab]);

  assert.equal(asked, 1);
  assert.deepEqual(approved, ['pay-1']);
});

test('depois de aprovada, novas consultas da mesma cobrança não confirmam de novo', async () => {
  let asked = 0;
  const approved = [];
  const watcher = createPaymentWatcher({
    fetchStatus: async () => { asked += 1; return { status: 'approved' }; },
    onApproved: (result, id) => { approved.push(id); }
  });

  await watcher.check('pay-1');
  await watcher.check('pay-1');
  await watcher.check('pay-1');

  assert.equal(asked, 1);
  assert.deepEqual(approved, ['pay-1']);
});

test('confirmação demorada: a consulta seguinte espera e não repete o aviso', async () => {
  const slow = deferred();
  let asked = 0;
  let approvedCount = 0;
  const watcher = createPaymentWatcher({
    fetchStatus: async () => { asked += 1; return { status: 'approved' }; },
    onApproved: async () => { approvedCount += 1; await slow.promise; }
  });

  const first = watcher.check('pay-1');
  const second = watcher.check('pay-1');
  slow.resolve();
  await Promise.all([first, second]);
  await watcher.check('pay-1');

  assert.equal(asked, 1);
  assert.equal(approvedCount, 1);
});

test('pendente continua esperando; falha na consulta não encerra a espera', async () => {
  const answers = [Promise.resolve({ status: 'pending' }), Promise.reject(new Error('sem rede')), Promise.resolve({ status: 'approved' })];
  answers[1].catch(() => {});
  const approved = [];
  const watcher = createPaymentWatcher({
    fetchStatus: () => answers.shift(),
    onApproved: (result, id) => { approved.push(id); }
  });

  await watcher.check('pay-1');
  assert.deepEqual(approved, []);
  await watcher.check('pay-1');
  assert.deepEqual(approved, []);
  await watcher.check('pay-1');
  assert.deepEqual(approved, ['pay-1']);
});

test('cobrança cancelada ou vencida avisa uma vez e para de perguntar', async () => {
  let asked = 0;
  const ended = [];
  const watcher = createPaymentWatcher({
    fetchStatus: async () => { asked += 1; return { status: 'cancelled' }; },
    onApproved: () => assert.fail('não foi aprovada'),
    onEnded: (result, id) => { ended.push(id); }
  });

  await watcher.check('pay-1');
  await watcher.check('pay-1');

  assert.equal(asked, 1);
  assert.deepEqual(ended, ['pay-1']);
});

test('sem cobrança em andamento não pergunta nada', async () => {
  let asked = 0;
  const watcher = createPaymentWatcher({
    fetchStatus: async () => { asked += 1; return { status: 'approved' }; },
    onApproved: () => {}
  });

  await watcher.check(null);
  assert.equal(asked, 0);
});

test('uma nova cobrança é consultada normalmente depois que a anterior foi aprovada', async () => {
  const approved = [];
  const watcher = createPaymentWatcher({
    fetchStatus: async () => ({ status: 'approved' }),
    onApproved: (result, id) => { approved.push(id); }
  });

  await watcher.check('pay-1');
  await watcher.check('pay-2');

  assert.deepEqual(approved, ['pay-1', 'pay-2']);
});
