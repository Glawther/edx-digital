/**
 * EDX Digital - The server in production: one Firebase Function
 *
 * Firebase Hosting hands every address under /api to this function (firebase.json), so the
 * app talks to its own address and there is no separate server to keep.
 *
 * The two Mercado Pago secrets live in Secret Manager, never in the code:
 *   firebase functions:secrets:set MERCADO_PAGO_ACCESS_TOKEN
 *   firebase functions:secrets:set MERCADO_PAGO_WEBHOOK_SECRET
 * Step by step: docs/COBRANCA_PIX.md
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { handleApi } = require('./server/api');

const MERCADO_PAGO_ACCESS_TOKEN = defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MERCADO_PAGO_WEBHOOK_SECRET = defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');

exports.api = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_WEBHOOK_SECRET],
    // a small CRM: a few instances are plenty, and the bill cannot run away
    maxInstances: 3,
    memory: '256MiB',
    timeoutSeconds: 30,
    invoker: 'public'
  },
  (req, res) => {
    if (!handleApi(req, res)) {
      res.status(404).json({ error: 'not_found' });
    }
  }
);
