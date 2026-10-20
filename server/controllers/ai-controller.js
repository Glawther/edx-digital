/**
 * EDX Digital - The AI features
 *
 *   POST /api/ai    { task: 'analysis' | 'messages', customerId }    [signed in, same company]
 *
 * The prompt is written on the server from the opportunity in the database (ai-service.js).
 */

const { parseJsonBody } = require('../middleware/body-parser');
const { verifyIdToken, isServiceAccountConfigured } = require('../billing/google-auth');
const { firestoreStore, getDoc } = require('../billing/firestore-store');
const { createRateLimiter } = require('../middleware/rate-limit');
const groq = require('../ai/groq');
const { createAiService, AiError } = require('../ai/ai-service');

const PER_PERSON_PER_MINUTE = 6;
const limiter = createRateLimiter({ windowMs: 60000 });

let service = null;
function aiService() {
  if (!service) {
    service = createAiService({
      store: { ...firestoreStore, getCustomer: (id) => getDoc(`customers/${id}`) },
      completeJson: (prompt) => groq.completeJson(prompt),
      isConfigured: () => groq.isConfigured() && isServiceAccountConfigured()
    });
  }
  return service;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** POST /api/ai (deps can be swapped in tests) */
async function handleAi(req, res, { verifyToken = verifyIdToken, ai = aiService } = {}) {
  const header = String(req.headers.authorization || '');
  let user;
  try {
    user = await verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  } catch {
    return send(res, 401, { error: 'unauthenticated', message: 'Entre na sua conta para continuar.' });
  }
  if (!user || !user.uid) return send(res, 401, { error: 'unauthenticated', message: 'Entre na sua conta para continuar.' });
  if (limiter.tooMany(user.uid, PER_PERSON_PER_MINUTE)) {
    return send(res, 429, { error: 'too_many', message: 'Muitos pedidos seguidos. Espere um minuto e tente de novo.' });
  }

  let body;
  try {
    ({ body } = await parseJsonBody(req, 2048));
  } catch {
    return send(res, 400, { error: 'invalid', message: 'Pedido inválido.' });
  }

  try {
    send(res, 200, await ai().run(user, body || {}));
  } catch (err) {
    if (err instanceof AiError) return send(res, err.status, { error: err.code, message: err.message });
    console.error('[IA]', err.message);
    send(res, 503, { error: 'unavailable', message: 'A inteligência artificial está indisponível agora. Tente de novo em instantes.' });
  }
}

module.exports = { handleAi };
