/**
 * Dados do banco entrando no HTML: nada do que vem de fora consegue virar código.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { escapeHtml, jsArg, safeImageUrl, isSafeId } from '../../js/core/html.js';

// What the browser does with an attribute value: turn the entities back into characters
const decodeAttribute = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

test('texto e atributos: os cinco caracteres que importam são trocados', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')"> & cia`), '&lt;img src=x onerror=&quot;a(&#039;b&#039;)&quot;&gt; &amp; cia');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});

test('argumento de evento: o valor chega inteiro à função e nunca executa nada', () => {
  const attacks = [
    `x');alert(1);('`,
    `x");alert(1);("`,
    `x\\');alert(1);//`,
    `</script><script>alert(1)</script>`,
    `" onmouseover="alert(1)`,
    `\n linha`,
    `lead-1791648532581-0-en3r1`
  ];
  for (const attack of attacks) {
    const attribute = `handler(${jsArg(attack)})`;
    assert.ok(!attribute.includes('"') && !attribute.includes("'") && !attribute.includes('<'), 'nada no atributo encerra a aspa ou abre uma tag');

    let received;
    let alerted = false;
    vm.runInNewContext(decodeAttribute(attribute), { handler: (value) => { received = value; }, alert: () => { alerted = true; } });
    assert.equal(received, attack);
    assert.equal(alerted, false);
  }
});

test('endereço de imagem: só https ou imagem embutida', () => {
  assert.equal(safeImageUrl('https://empresa.com/logo.png'), 'https://empresa.com/logo.png');
  assert.equal(safeImageUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'http://sem-https.com/a.png', 'https://a.com/x" onerror="alert(1)', 'x" onerror="alert(1)', '', null]) {
    assert.equal(safeImageUrl(bad), '', String(bad));
  }
});

test('identificadores: só os caracteres que o próprio app gera', () => {
  assert.equal(isSafeId('lead-1791648532581-0-en3r1'), true);
  assert.equal(isSafeId('a8Xk2_-Z'), true);
  for (const bad of [`x');alert(1);('`, 'com espaço', '', 'a'.repeat(121), 12, null, 'a/b', 'a"b']) {
    assert.equal(isSafeId(bad), false, String(bad));
  }
});
