/**
 * Itens da proposta: o que é guardado e como o total é somado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanItems, itemsTotal, lineTotal, parseAmount, formatQuantity, MAX_ITEMS } from '../../js/core/proposal-items.js';

test('números digitados do jeito brasileiro ou simples; nada negativo', () => {
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.equal(parseAmount('R$ 97'), 97);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('2,5'), 2.5);
  assert.equal(parseAmount(3), 3);
  assert.equal(parseAmount('-10'), 0);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseAmount(''), 0);
});

test('só ficam as linhas com descrição; quantidade vazia vale 1; texto sem marcação', () => {
  const items = cleanItems([
    { description: ' Instalação <b>completa</b> ', quantity: '2', unitPrice: '1.500,00' },
    { description: 'Mensalidade', quantity: '', unitPrice: '199,90' },
    { description: '   ', quantity: 5, unitPrice: 10 },
    { description: 'Brinde', quantity: 1, unitPrice: '' },
    null, 'texto'
  ]);
  assert.deepEqual(items, [
    { description: 'Instalação bcompleta/b', quantity: 2, unitPrice: 1500 },
    { description: 'Mensalidade', quantity: 1, unitPrice: 199.9 },
    { description: 'Brinde', quantity: 1, unitPrice: 0 }
  ]);
  assert.equal(cleanItems(Array.from({ length: 50 }, (_, i) => ({ description: `Item ${i}` }))).length, MAX_ITEMS);
  assert.deepEqual(cleanItems('nada'), []);
});

test('o total é somado em centavos, sem erro de arredondamento', () => {
  assert.equal(lineTotal({ quantity: 3, unitPrice: 0.1 }), 0.3);
  assert.equal(itemsTotal([{ description: 'a', quantity: 1, unitPrice: 0.1 }, { description: 'b', quantity: 1, unitPrice: 0.2 }]), 0.3);
  assert.equal(itemsTotal([{ description: 'Instalação', quantity: 2, unitPrice: 1500 }, { description: 'Mensalidade', quantity: 12, unitPrice: 199.9 }]), 5398.8);
  assert.equal(itemsTotal([{ description: 'Meia hora', quantity: 0.5, unitPrice: 151 }]), 75.5);
  assert.equal(itemsTotal([]), 0);
});

test('a quantidade aparece como uma pessoa escreveria', () => {
  assert.equal(formatQuantity(2), '2');
  assert.equal(formatQuantity(1.5), '1,5');
  assert.equal(formatQuantity(1000), '1.000');
});

test('preço com ponto de milhar é lido como no valor da oportunidade', async () => {
  const { parseAmount } = await import('../../js/core/proposal-items.js');
  assert.equal(parseAmount('1.250'), 1250);
  assert.equal(parseAmount('1.250.000'), 1250000);
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('2'), 2);
});
