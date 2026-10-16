/**
 * EDX Digital - The server in production: Firebase Functions
 *
 *   api          everything under /api (Firebase Hosting hands those requests over, firebase.json):
 *                PIX billing, the inbox for leads sent by forms, errors seen on people's screens,
 *                the owner's panel
 *   usageOn...   after each change to an opportunity or to a person, counts what the company
 *                has and records whether its plan is full (the database rules read that)
 *   dailyEmails  every morning, the summary of the day for each person and the notices about
 *                a trial or a plan about to end; and the files of opportunities that were
 *                deleted are removed from storage
 *
 * Secrets live in Secret Manager, never in the code:
 *   firebase functions:secrets:set MERCADO_PAGO_ACCESS_TOKEN      (docs/COBRANCA_PIX.md)
 *   firebase functions:secrets:set MERCADO_PAGO_WEBHOOK_SECRET
 *   firebase functions:secrets:set BREVO_API_KEY                  (docs/EMAILS.md)
 *   firebase functions:secrets:set MAIL_SENDER
 *   firebase functions:secrets:set OWNER_EMAILS                   (docs/OPERACAO.md)
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { handleApi } = require('./server/api');
const { firestoreStore } = require('./server/billing/firestore-store');
const { createUsageService, customerChangeMatters, userChangeMatters, organizationChangeMatters } = require('./server/usage/usage-service');
const mailer = require('./server/mail/brevo');
const { runDailyEmails } = require('./server/mail/daily-emails');
const { cleanOrphanAttachments } = require('./server/storage/attachment-cleanup');

const MERCADO_PAGO_ACCESS_TOKEN = defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MERCADO_PAGO_WEBHOOK_SECRET = defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
const MAIL_SENDER = defineSecret('MAIL_SENDER');
// who owns the system: sees the panel of companies and is told about errors (e-mails separated by commas)
const OWNER_EMAILS = defineSecret('OWNER_EMAILS');

exports.api = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_WEBHOOK_SECRET, BREVO_API_KEY, MAIL_SENDER, OWNER_EMAILS],
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

// Triggers on the database run where the database is (nam5 is served from us-central1)
const NEAR_DATABASE = { region: 'us-central1', maxInstances: 3, memory: '256MiB', timeoutSeconds: 60 };
const usage = createUsageService({ store: firestoreStore });
const dataOf = (snapshot) => (snapshot && snapshot.exists ? snapshot.data() : null);

async function recount(before, after) {
  const orgIds = new Set([before && before.orgId, after && after.orgId].filter(id => typeof id === 'string' && id));
  for (const orgId of orgIds) await usage.refreshUsage(orgId);
}

exports.usageOnCustomerChange = onDocumentWritten({ ...NEAR_DATABASE, document: 'customers/{customerId}' }, async (event) => {
  const before = dataOf(event.data && event.data.before);
  const after = dataOf(event.data && event.data.after);
  if (customerChangeMatters(before, after)) await recount(before, after);
});

exports.usageOnUserChange = onDocumentWritten({ ...NEAR_DATABASE, document: 'users/{uid}' }, async (event) => {
  const before = dataOf(event.data && event.data.before);
  const after = dataOf(event.data && event.data.after);
  if (userChangeMatters(before, after)) await recount(before, after);
});

// The plan deadline is copied onto each profile for the file rules: a change to it (payment,
// refund, or an edit in the console) is copied again
exports.usageOnOrganizationChange = onDocumentWritten({ ...NEAR_DATABASE, document: 'organizations/{orgId}' }, async (event) => {
  const before = dataOf(event.data && event.data.before);
  const after = dataOf(event.data && event.data.after);
  if (organizationChangeMatters(before, after)) await usage.refreshUsage(event.params.orgId);
});

exports.dailyEmails = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'America/Sao_Paulo',
    region: 'us-central1',
    secrets: [BREVO_API_KEY, MAIL_SENDER],
    maxInstances: 1,
    memory: '512MiB',
    timeoutSeconds: 540
  },
  async () => {
    const result = await runDailyEmails({
      store: firestoreStore,
      mailer,
      // the same code the "Hoje" screen runs in the browser
      loadToday: () => import('./js/core/today.js')
    });
    console.log(JSON.stringify({ message: '[E-mail] resumo da manhã', ...result }));
    try {
      console.log(JSON.stringify({ message: '[Arquivos] limpeza dos anexos sem oportunidade', ...(await cleanOrphanAttachments()) }));
    } catch (err) {
      console.error('[Arquivos] limpeza:', err.message);
    }
    // recounts every company and copies its plan deadline onto the profiles, so companies that
    // had no change since the deadline began to be copied get it too
    try {
      let companies = 0;
      for (const org of await firestoreStore.listOrganizations()) {
        await usage.refreshUsage(org.id).catch(err => console.error('[Plano] recontagem:', org.id, err.message));
        companies++;
      }
      console.log(JSON.stringify({ message: '[Plano] recontagem da manhã', companies }));
    } catch (err) {
      console.error('[Plano] recontagem da manhã:', err.message);
    }
  }
);
