/**
 * Importação de planilha: leitura do texto, reconhecimento das colunas e conferência das linhas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney, parseDelimited, looksLikeHeader, guessMapping, buildImportRows, summarizeImport, csvSafe
} from '../../js/services/import-service.js';

test('valores no formato brasileiro e no formato com ponto', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('R$ 45.000'), 45000);
  assert.equal(parseMoney('12.345'), 12345);
  assert.equal(parseMoney('1234.5'), 1234.5);
  assert.equal(parseMoney('90000'), 90000);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('abc'), 0);
  assert.equal(parseMoney('-50'), 0, 'valor negativo não é valor de negócio');
  assert.equal(parseMoney('R$ -1.234,56'), 0);
  assert.equal(parseMoney('1,234.56'), 1234.56, 'formato americano: o último separador é o decimal');
  assert.equal(parseMoney('12.345.678'), 12345678);
});

test('lê ponto e vírgula, vírgula e tabulação, com aspas e quebra de linha dentro da célula', () => {
  assert.deepEqual(parseDelimited('Ana;Loja A;11 98888-7777\nBeto;Loja B;'), [['Ana', 'Loja A', '11 98888-7777'], ['Beto', 'Loja B', '']]);
  assert.deepEqual(parseDelimited('Ana,Loja A\r\nBeto,Loja B\r\n'), [['Ana', 'Loja A'], ['Beto', 'Loja B']]);
  assert.deepEqual(parseDelimited('Ana\tLoja, com vírgula\t1.500,00'), [['Ana', 'Loja, com vírgula', '1.500,00']]);
  assert.deepEqual(parseDelimited('"Silva, Ana";"disse ""oi""";"linha 1\nlinha 2"'), [['Silva, Ana', 'disse "oi"', 'linha 1\nlinha 2']]);
  assert.deepEqual(parseDelimited('﻿Nome;Empresa\n\n\nAna;Loja'), [['Nome', 'Empresa'], ['Ana', 'Loja']], 'BOM e linhas vazias são ignorados');
});

test('valor com vírgula decimal numa lista separada por ponto e vírgula não é partido', () => {
  const rows = parseDelimited('Nome;Valor\nAna;1.234,56');
  assert.deepEqual(rows[1], ['Ana', '1.234,56']);
});

test('reconhece o cabeçalho e as colunas pelo título, em qualquer ordem', () => {
  const rows = parseDelimited('E-mail;Telefone;Nome Completo;Valor Estimado;Empresa;Observações\nana@a.com;11988887777;Ana;1000;Loja;Urgente');
  assert.equal(looksLikeHeader(rows[0]), true);
  const mapping = guessMapping(rows, true);
  assert.equal(mapping.email, 0);
  assert.equal(mapping.phone, 1);
  assert.equal(mapping.name, 2);
  assert.equal(mapping.dealValue, 3);
  assert.equal(mapping.company, 4);
  assert.equal(mapping.notes, 5);
  assert.equal(mapping.role, -1);
});

test('sem cabeçalho, descobre as colunas pelo conteúdo', () => {
  const rows = parseDelimited('Marcos Vinicius, Banco A, +55 11 98888-1111, 45000, marcos@a.com\nCarla Menezes, Loja B, +55 21 97777-2222, 90000, carla@b.com');
  assert.equal(looksLikeHeader(rows[0]), false);
  const mapping = guessMapping(rows, false);
  assert.equal(mapping.name, 0);
  assert.equal(mapping.company, 1);
  assert.equal(mapping.phone, 2);
  assert.equal(mapping.dealValue, 3);
  assert.equal(mapping.email, 4);
});

test('linha sem nome ou com e-mail inválido não entra; o valor nunca é inventado', () => {
  const rows = parseDelimited('Nome;Email;Valor\nAna;ana@a.com;\n;semnome@a.com;10\nBeto;isto-nao-e-email;20');
  const built = buildImportRows(rows, guessMapping(rows, true), { hasHeader: true });
  assert.equal(built[0].lead.dealValue, 0, 'sem valor na planilha é zero');
  assert.deepEqual(built[0].problems, []);
  assert.deepEqual(built[1].problems, ['sem nome']);
  assert.deepEqual(built[2].problems, ['e-mail inválido']);
  assert.equal(built[2].line, 4, 'a linha é a da planilha, contando o cabeçalho');
});

test('repetidos: contra o que já existe e dentro do próprio arquivo', () => {
  const rows = parseDelimited('Nome;Email;Telefone\nAna;ANA@a.com;\nAna de novo;ana@a.com;\nCarla;;(11) 98888-7777\nDora;;11 97777-0000\nDora 2;;+55 11 97777-0000');
  const existing = [{ email: 'outra@a.com', phone: '+55 11 98888-7777' }];
  const built = buildImportRows(rows, guessMapping(rows, true), { hasHeader: true, existing });
  assert.deepEqual(built.map(row => row.duplicate), [false, true, true, false, true]);

  const summary = summarizeImport(built);
  assert.equal(summary.ready.length, 2);
  assert.equal(summary.duplicates.length, 3);
  assert.equal(summarizeImport(built, { skipDuplicates: false }).ready.length, 5);
});

test('etapa reconhecida por nome; a desconhecida entra como novo lead, com aviso', () => {
  const rows = parseDelimited('Nome;Etapa\nAna;Proposta Enviada\nBeto;Fechado\nCaio;Em análise\nDani;');
  const built = buildImportRows(rows, guessMapping(rows, true), { hasHeader: true });
  assert.deepEqual(built.map(row => row.lead.stage), ['proposal', 'won', 'lead', 'lead']);
  assert.equal(built[2].notes.length, 1);
  assert.equal(built[3].notes.length, 0);
});

test('o limite do plano corta só as oportunidades em aberto', () => {
  const rows = parseDelimited('Nome;Etapa\nA;\nB;\nC;ganho\nD;');
  const built = buildImportRows(rows, guessMapping(rows, true), { hasHeader: true });
  const summary = summarizeImport(built, { room: 2 });
  assert.deepEqual(summary.ready.map(row => row.lead.name), ['A', 'B', 'C']);
  assert.deepEqual(summary.overLimit.map(row => row.lead.name), ['D']);
});

test('sinais de menor e maior são retirados, e fórmulas são neutralizadas na exportação', () => {
  const rows = parseDelimited('Nome\n<img src=x onerror=alert(1)>Ana');
  const built = buildImportRows(rows, { name: 0 }, { hasHeader: true });
  assert.equal(built[0].lead.name, 'img src=x onerror=alert(1)Ana');
  assert.equal(csvSafe('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(csvSafe('+55 11 98888-7777'), '\'+55 11 98888-7777');
  assert.equal(csvSafe('Ana'), 'Ana');
});

test('importação: limites do banco conferidos antes, valores estranhos avisados, cabeçalho pela palavra mais longa', async () => {
  const { buildImportRows, guessMapping, parseDelimited } = await import('../../js/services/import-service.js');
  const table = [
    ['Nome do contato', 'Nome da empresa', 'Telefone', 'Valor', 'Etiquetas'],
    ['Telefone longo', 'Alfa', '1'.repeat(70), '100', ''],
    ['Muitas etiquetas', 'Beta', '', '200', Array.from({ length: 35 }, (_, i) => `t${i}`).join(',')],
    ['Empresa longa', 'x'.repeat(400), '', '300', ''],
    ['Negativo', 'Delta', '', '-500', ''],
    ['Com letras', 'Gama', '', '3 mil', '']
  ];
  const mapping = guessMapping(table, true);
  assert.equal(mapping.name, 0);
  assert.equal(mapping.company, 1, '"Nome da empresa" é a empresa');
  const rows = buildImportRows(table, mapping, { hasHeader: true });
  assert.deepEqual(rows[0].problems, ['telefone longo demais']);
  assert.equal(rows[1].lead.tags.length, 29);
  assert.match(rows[1].notes.join(), /ficam as 29 primeiras/);
  assert.equal(rows[2].lead.company.length, 300);
  assert.equal(rows[3].lead.dealValue, 0);
  assert.match(rows[3].notes.join(), /negativo/);
  assert.equal(rows[4].lead.dealValue, 0);
  assert.match(rows[4].notes.join(), /não reconhecido/);

  // uma aspa aberta não engole o resto do arquivo
  const parsed = parseDelimited('"Ana Paula;Alfa\nBruno;Beta\nCarla;Gama');
  assert.equal(parsed.unclosedQuote, true);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1][0], 'Bruno');
});
