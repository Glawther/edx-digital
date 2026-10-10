/**
 * Nexus CRM - Segredos da aplicação
 * Nenhum segredo tem valor padrão no código: um valor versionado é público e permite forjar
 * tokens e assinaturas. Em produção, a falta de um segredo impede o servidor de subir.
 * Fora de produção, cada processo gera um valor aleatório descartável.
 */

const crypto = require('crypto');

const EM_PRODUCAO = process.env.NODE_ENV === 'production';
const TAMANHO_MINIMO = 32;

/**
 * Lê o primeiro nome de variável de ambiente definido na lista.
 * @param {string[]} nomes Nomes aceitos, em ordem de preferência
 * @returns {string} Valor do segredo
 */
function lerSegredo(nomes) {
  for (const nome of nomes) {
    const valor = process.env[nome];
    if (valor && valor.trim().length >= TAMANHO_MINIMO) {
      return valor.trim();
    }
    if (valor && EM_PRODUCAO) {
      throw new Error(`ERRO DE CONFIGURAÇÃO: ${nome} precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
    }
  }

  if (EM_PRODUCAO) {
    throw new Error(`ERRO DE CONFIGURAÇÃO: defina a variável de ambiente ${nomes.join(' ou ')} antes de iniciar em produção.`);
  }

  // Desenvolvimento e testes: valor aleatório por processo (tokens e dados não sobrevivem a um reinício)
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = lerSegredo(['JWT_SECRET']);

// Aceita os três nomes que já apareciam no projeto (código, render.yaml e .env de exemplo)
const CHAVE_MESTRA_BRUTA = lerSegredo(['ENCRYPTION_MASTER_KEY', 'MASTER_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEY']);

// Chave AES-256: usa o valor direto se já for 32 bytes em hexadecimal; senão deriva 32 bytes dele
const MASTER_KEY = /^[0-9a-fA-F]{64}$/.test(CHAVE_MESTRA_BRUTA)
  ? Buffer.from(CHAVE_MESTRA_BRUTA, 'hex')
  : crypto.createHash('sha256').update(CHAVE_MESTRA_BRUTA, 'utf8').digest();

const BILLING_WEBHOOK_SECRET = lerSegredo(['BILLING_WEBHOOK_SECRET', 'WEBHOOK_HMAC_SECRET']);

module.exports = {
  JWT_SECRET,
  MASTER_KEY,
  BILLING_WEBHOOK_SECRET
};
