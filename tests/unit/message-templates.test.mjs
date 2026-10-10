/**
 * Modelos de mensagem: os da empresa, os padrão, e o preenchimento dos campos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTemplates, templatesFor, fillTemplate, messagesFor, DEFAULT_TEMPLATES, MAX_TEMPLATES } from '../../js/core/message-templates.js';

const context = { customer: { name: 'Mariana Albuquerque', company: 'Albuquerque Móveis', dealValue: 12500, stage: 'proposal' }, userName: 'Lucas', companyName: 'Tec', stageName: 'Proposta Enviada' };

test('os campos entre chaves viram os dados da oportunidade', () => {
  assert.equal(
    fillTemplate('Olá, {nome}! Aqui é {vendedor}, da {minha_empresa}. Sobre a {empresa}: {valor}, etapa {etapa}. ({nome_completo})', context),
    'Olá, Mariana! Aqui é Lucas, da Tec. Sobre a Albuquerque Móveis: R$ 12.500, etapa Proposta Enviada. (Mariana Albuquerque)'
  );
});

test('campo sem dado não deixa buraco na frase, e campo desconhecido fica como foi escrito', () => {
  assert.equal(fillTemplate('Olá, {nome}! Tudo bem?', { customer: {} }), 'Olá! Tudo bem?');
  assert.equal(fillTemplate('Aqui é {vendedor}, da {minha_empresa}.', {}), 'Aqui é da equipe, da nossa empresa.');
  assert.equal(fillTemplate('Valor: {valor} .', { customer: { dealValue: 0 } }), 'Valor:.');
  assert.equal(fillTemplate('Use {cupom} hoje', context), 'Use {cupom} hoje');
});

test('o que a empresa salva é limpo: sem marcação, sem vazio, sem nome repetido, até o limite', () => {
  const clean = cleanTemplates([
    { name: ' Boas-vindas ', text: 'Olá, {nome}! <b>negrito</b>' },
    { name: 'boas-vindas', text: 'repetido' },
    { name: '', text: 'sem nome' },
    { name: 'Sem texto', text: '   ' },
    'não é objeto', null,
    { name: 'N'.repeat(80), text: 'T'.repeat(3000) }
  ]);
  assert.deepEqual(clean[0], { name: 'Boas-vindas', text: 'Olá, {nome}! bnegrito/b' });
  assert.equal(clean.length, 2);
  assert.equal(clean[1].name.length, 40);
  assert.equal(clean[1].text.length, 1000);
  assert.equal(cleanTemplates(Array.from({ length: 30 }, (_, i) => ({ name: `M${i}`, text: 'x' }))).length, MAX_TEMPLATES);
  assert.deepEqual(cleanTemplates('nada'), []);
});

test('sem modelos próprios valem os quatro padrão; com próprios, só os da empresa', () => {
  assert.equal(templatesFor({}), DEFAULT_TEMPLATES);
  assert.equal(templatesFor({ messageTemplates: [] }), DEFAULT_TEMPLATES);
  assert.deepEqual(templatesFor({ messageTemplates: [{ name: 'Meu', text: 'Oi {nome}' }] }).map(t => t.name), ['Meu']);
});

test('para uma oportunidade, o modelo padrão da etapa dela vem primeiro; os da empresa ficam na ordem em que foram escritos', () => {
  assert.deepEqual(messagesFor({}, context).map(m => m.tone), ['Retorno da proposta', 'Primeiro contato', 'Negociação', 'Retomar contato']);
  assert.match(messagesFor({}, context)[0].text, /^Olá, Mariana! Aqui é Lucas, da Tec\./);
  const own = { messageTemplates: [{ name: 'B', text: 'b {nome}' }, { name: 'A', text: 'a' }] };
  assert.deepEqual(messagesFor(own, context), [{ tone: 'B', text: 'b Mariana' }, { tone: 'A', text: 'a' }]);
});
