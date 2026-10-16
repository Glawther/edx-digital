/**
 * Passeio de boas-vindas: o que cada pessoa vê e onde o cartão de cada passo fica.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourSteps, placeCard } from '../../js/core/tour-steps.js';

test('todo passo tem título e texto, e nenhum identificador se repete', () => {
  for (const who of [{ isAdmin: true }, { isAdmin: false }]) {
    const steps = tourSteps(who);
    assert.equal(new Set(steps.map(step => step.id)).size, steps.length);
    for (const step of steps) {
      assert.ok(step.title.length > 3, step.id);
      assert.ok(Array.isArray(step.text) && step.text.length >= 1 && step.text.every(p => p.length > 5), step.id);
    }
    assert.equal(steps[0].id, 'welcome');
    assert.equal(steps.at(-1).id, 'done');
  }
});

test('o vendedor não é levado às telas de administrador', () => {
  const seller = tourSteps({ isAdmin: false });
  const admin = tourSteps({ isAdmin: true });
  assert.ok(admin.length > seller.length);
  for (const view of ['team', 'audit', 'security']) {
    assert.equal(seller.some(step => step.view === view || String(step.target || '').includes(`"${view}"`)), false, view);
  }
  assert.ok(admin.some(step => step.view === 'team'));
  // o essencial está nos dois
  for (const view of ['today', 'pipeline']) {
    assert.ok(seller.some(step => step.view === view), view);
  }
});

test('o passeio é curto e mantém o essencial', () => {
  const admin = tourSteps({ isAdmin: true });
  const seller = tourSteps({ isAdmin: false });
  assert.ok(admin.length <= 8, `administrador: ${admin.length} passos`);
  assert.ok(seller.length < admin.length, `vendedor: ${seller.length} passos`);
  for (const id of ['today', 'pipeline', 'new', 'card', 'tools']) {
    assert.ok(seller.some(step => step.id === id) && admin.some(step => step.id === id), id);
  }
  // abrir a oportunidade e agendar o próximo passo; onde está a ajuda
  assert.match(admin.find(step => step.id === 'card').text.join(' '), /próximo passo/);
  assert.match(admin.find(step => step.id === 'tools').text.join(' '), /Ajuda/);
});

const apart = (a, b) => a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top;

test('o cartão nunca cobre o que está destacado', () => {
  const screens = [[{ width: 1300, height: 800 }, { width: 400, height: 250 }], [{ width: 390, height: 844 }, { width: 366, height: 290 }]];
  const targets = [
    { top: 152, left: 249, width: 1035, height: 218 }, // primeiro bloco da tela Hoje
    { top: 292, left: 249, width: 1035, height: 447 }, // funil
    { top: 4, left: 4, width: 1292, height: 792 }, // a tela inteira
    { top: 0, left: 0, width: 390, height: 844 },
    { top: 276, left: 9, width: 372, height: 277 },
    { top: 777, left: 189, width: 192, height: 58 }, // botão no rodapé do celular
    { top: 36, left: 145, width: 101, height: 51 },
    { top: 681, left: 5, width: 221, height: 41 }
  ];
  for (const [screen, card] of screens) {
    for (const target of targets) {
      const place = placeCard(target, card, screen);
      const label = `${screen.width}px ${JSON.stringify(target)} ${place.placement}`;
      if (place.spot) assert.ok(apart({ ...place, ...card }, place.spot), label);
      assert.ok(place.top >= 12 && place.top + card.height <= screen.height - 12, label);
    }
  }
});

test('no celular o cartão encosta na borda mais longe do destaque', () => {
  const phone = { width: 390, height: 844 };
  const card = { width: 366, height: 290 };
  const up = placeCard({ top: 36, left: 145, width: 101, height: 51 }, card, phone);
  assert.deepEqual([up.placement, up.top + card.height], ['bottom', 844 - 12]);
  const down = placeCard({ top: 777, left: 189, width: 192, height: 58 }, card, phone);
  assert.deepEqual([down.placement, down.top], ['top', 12]);
  // o que sobra do destaque, quando ele é maior que a tela, fica acima do cartão
  const huge = placeCard({ top: 0, left: 0, width: 390, height: 800 }, card, phone);
  assert.ok(huge.spot && huge.spot.top + huge.spot.height <= huge.top);
});

const screen = { width: 1300, height: 800 };
const card = { width: 400, height: 220 };
const inside = (place) => place.top >= 12 && place.left >= 12 && place.top + card.height <= screen.height - 12 && place.left + card.width <= screen.width - 12;

test('o cartão fica abaixo do que aponta quando cabe; senão acima, ao lado ou por cima', () => {
  assert.equal(placeCard(null, card, screen).placement, 'center');
  const below = placeCard({ top: 60, left: 300, width: 120, height: 36 }, card, screen);
  assert.deepEqual([below.placement, below.top, below.left], ['below', 108, 300]);
  // botão no rodapé: vai para cima
  assert.equal(placeCard({ top: 740, left: 20, width: 200, height: 40 }, card, screen).placement, 'above');
  // coluna alta à esquerda: vai para a direita
  assert.equal(placeCard({ top: 4, left: 4, width: 230, height: 792 }, card, screen).placement, 'right');
  // coluna alta à direita: vai para a esquerda
  assert.equal(placeCard({ top: 4, left: 1000, width: 296, height: 792 }, card, screen).placement, 'left');
  // a tela inteira: o cartão vai para uma borda e só o resto fica destacado
  const whole = placeCard({ top: 4, left: 4, width: 1292, height: 792 }, card, screen);
  assert.equal(whole.placement, 'over');
  assert.ok(whole.spot.top + whole.spot.height <= whole.top || whole.spot.top >= whole.top + card.height);
});

test('o cartão nunca sai da tela, nem numa janela de celular', () => {
  const targets = [null, { top: 60, left: 1250, width: 40, height: 36 }, { top: 790, left: 0, width: 50, height: 10 }, { top: 4, left: 4, width: 1292, height: 792 }, { top: 300, left: 600, width: 10, height: 10 }];
  for (const target of targets) assert.ok(inside(placeCard(target, card, screen)), JSON.stringify(target));

  const phone = { width: 375, height: 700 };
  const small = { width: 351, height: 300 };
  for (const target of [null, { top: 6, left: 229, width: 38, height: 38 }, { top: 46, left: 12, width: 60, height: 30 }, { top: 120, left: 0, width: 375, height: 560 }]) {
    const place = placeCard(target, small, phone);
    assert.ok(place.left >= 12 && place.left + small.width <= phone.width - 12 && place.top >= 12 && place.top + small.height <= phone.height - 12, JSON.stringify(target));
  }
});
