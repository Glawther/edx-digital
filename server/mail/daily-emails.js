/**
 * EDX Digital - The e-mails of the morning
 *
 * Once a day, for every company:
 *   - each person gets what the "Hoje" screen would show them (late and today's tasks, deals
 *     about to close, stalled ones), unless there is nothing to show or they turned it off;
 *   - the administrators are told when the trial or the paid period is about to end.
 *
 * What goes into the summary is decided by the same code the screen uses (js/core/today.js).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_URL = 'https://edx-digital.web.app';
// days before the end on which the administrators are reminded
const TRIAL_NOTICE_DAYS = [3, 1];
const PLAN_NOTICE_DAYS = [5, 1];

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const money = (amount) => `R$ ${(Number(amount) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function page(title, bodyHtml, footer) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#18212f;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border:1px solid #e4e7ec;border-radius:6px;padding:24px;">
<h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="margin:20px 0 0;"><a href="${APP_URL}" style="display:inline-block;background:#18212f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Abrir o EDX Digital</a></p>
</div>
<p style="font-size:12px;color:#6f7a8a;margin:12px 4px 0;line-height:1.5;">${footer}</p>
</div></body></html>`;
}

/**
 * The summary for one person, or null when there is nothing to tell them
 * @param {Function} todayPanel - js/core/today.js
 * @param {Function} daysLabel
 */
function buildDigest({ user, orgName, customers, now, todayPanel, daysLabel }) {
  const panel = todayPanel(customers, now);
  // "no next task" alone is not worth a message every morning
  if (panel.lateTasks.length + panel.todayTasks.length + panel.closing.length + panel.stalled.length === 0) return null;

  const LIMIT = 8;
  const sections = [];
  const add = (title, items, line) => {
    if (items.length === 0) return;
    sections.push({ title: `${title} (${items.length})`, lines: items.slice(0, LIMIT).map(line), more: Math.max(0, items.length - LIMIT) });
  };
  const who = (customer) => `${customer.name}${customer.company ? `, ${customer.company}` : ''}`;

  add('Tarefas atrasadas', panel.lateTasks, ({ customer, task, daysLate }) => `${task.title} (${who(customer)}), atrasada ${daysLabel(-daysLate)}`);
  add('Tarefas de hoje', panel.todayTasks, ({ customer, task }) => `${task.dueTime ? `${task.dueTime} ` : ''}${task.title} (${who(customer)})`);
  add('Perto de fechar', panel.closing, ({ customer, inDays }) => `${who(customer)}, ${money(customer.dealValue)}: ${inDays < 0 ? `a previsão passou ${daysLabel(inDays)}` : `previsão ${daysLabel(inDays)}`}`);
  add('Paradas', panel.stalled, ({ customer, days }) => `${who(customer)}, ${money(customer.dealValue)}: sem atualização há ${days} dias`);

  const counts = [
    panel.lateTasks.length ? plural(panel.lateTasks.length, 'tarefa atrasada', 'tarefas atrasadas') : '',
    panel.todayTasks.length ? plural(panel.todayTasks.length, 'tarefa para hoje', 'tarefas para hoje') : '',
    panel.closing.length ? plural(panel.closing.length, 'oportunidade perto de fechar', 'oportunidades perto de fechar') : '',
    panel.stalled.length ? plural(panel.stalled.length, 'parada', 'paradas') : ''
  ].filter(Boolean).join(', ');

  const greeting = firstName(user.name) ? `Olá, ${firstName(user.name)}.` : 'Olá.';
  const intro = `${greeting} Hoje há ${counts}${orgName ? ` no CRM da ${orgName}` : ''}.`;
  const footerText = 'Você recebe este resumo porque tem uma conta no EDX Digital. Para deixar de receber, abra Ferramentas, Minha conta e privacidade, e desmarque o resumo diário por e-mail.';

  const text = [
    intro, '',
    ...sections.flatMap(section => [section.title, ...section.lines.map(line => `- ${line}`), ...(section.more ? [`  e mais ${section.more}`] : []), '']),
    `Abrir o EDX Digital: ${APP_URL}`, '',
    footerText
  ].join('\n');

  const html = page('O que fazer hoje',
    `<p style="font-size:14px;line-height:1.5;margin:0 0 16px;">${escapeHtml(intro)}</p>` +
    sections.map(section => `<h2 style="font-size:14px;margin:16px 0 6px;">${escapeHtml(section.title)}</h2>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#4a5565;">${section.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}${section.more ? `<li>e mais ${section.more}</li>` : ''}</ul>`).join(''),
    escapeHtml(footerText));

  return { subject: `Hoje no EDX Digital: ${counts}`, text, html };
}

/** Whole days from now until a moment (0 = it ends today) */
function daysUntil(ms, now) {
  const day = (time) => { const d = new Date(time); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.round((day(ms) - day(now.getTime())) / DAY_MS);
}

/**
 * The notice for the administrators when the trial or the paid period is about to end, or null
 */
function buildPlanNotice({ org, now }) {
  let kind = null;
  let days = null;
  if (org.planStatus === 'active' && typeof org.paidUntilMs === 'number') {
    days = daysUntil(org.paidUntilMs, now);
    if (PLAN_NOTICE_DAYS.includes(days)) kind = 'plan';
  } else if (org.planStatus !== 'active' && typeof org.trialEndsAtMs === 'number') {
    days = daysUntil(org.trialEndsAtMs, now);
    if (TRIAL_NOTICE_DAYS.includes(days)) kind = 'trial';
  }
  if (!kind) return null;

  const when = days === 1 ? 'amanhã' : `em ${days} dias`;
  const title = kind === 'trial' ? `O teste gratuito termina ${when}` : `O plano vence ${when}`;
  const lines = kind === 'trial'
    ? [`O período de teste da ${org.name || 'sua empresa'} no EDX Digital termina ${when}.`,
       'Depois disso o sistema fica em modo de leitura: os dados continuam lá, podem ser vistos e exportados, mas não dá para criar nem alterar até a assinatura de um plano.',
       'Para assinar, abra Ferramentas, Plano e uso, escolha o plano e pague por PIX. A liberação é automática.']
    : [`O período pago da ${org.name || 'sua empresa'} no EDX Digital vence ${when}.`,
       'Para renovar, abra Ferramentas, Plano e uso, e pague o PIX do próximo período. Pagar antes do vencimento soma 30 dias ao período em curso.',
       'Sem a renovação, depois de 3 dias de tolerância o sistema fica em modo de leitura.'];
  const footerText = 'Você recebe este aviso porque administra uma empresa no EDX Digital.';
  return {
    subject: `EDX Digital: ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
    text: [...lines, '', `Abrir o EDX Digital: ${APP_URL}`, '', footerText].join('\n'),
    html: page(title, lines.map(line => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px;color:#4a5565;">${escapeHtml(line)}</p>`).join(''), escapeHtml(footerText))
  };
}

/**
 * @param {Object} deps.store   - listOrganizations(), listUsers(orgId), listCustomers(orgId), verifiedEmails(uids)
 * @param {Object} deps.mailer  - isConfigured(), sendEmail(message)
 * @param {Function} deps.loadToday - async () => ({ todayPanel, daysLabel })
 * @returns {Promise<{companies: number, digests: number, notices: number, failed: number, skipped?: string}>}
 */
async function runDailyEmails({ store, mailer, loadToday, now = new Date(), log = console }) {
  const result = { companies: 0, digests: 0, notices: 0, failed: 0 };
  if (!mailer.isConfigured()) return { ...result, skipped: 'mail_not_configured' };
  const { todayPanel, daysLabel } = await loadToday();

  const send = async (kind, to, message) => {
    try {
      await mailer.sendEmail({ to, ...message });
      result[kind] += 1;
    } catch (err) {
      result.failed += 1;
      log.error(`[E-mail] ${kind}: ${err.message}`);
    }
  };

  for (const { id: orgId, data: org } of await store.listOrganizations()) {
    try {
      const active = (await store.listUsers(orgId)).filter(({ data }) => data.status === 'active' && /@/.test(data.email || ''));
      if (active.length === 0) continue;
      // A profile is only a record any administrator can write, with any address in it. Mail goes
      // only where a sign-in account with that same address proved it is theirs: otherwise anyone
      // could have this server send, every morning, text of their own to addresses of their choice.
      const confirmed = await store.verifiedEmails(active.map(({ id }) => id));
      const users = active.filter(({ id, data }) => confirmed.get(id) === String(data.email).toLowerCase());
      if (users.length === 0) continue;
      result.companies += 1;

      const notice = buildPlanNotice({ org, now });
      if (notice) {
        for (const { data } of users.filter(user => user.data.role === 'admin')) {
          await send('notices', { email: data.email, name: data.name }, notice);
        }
      }

      const wanting = users.filter(({ data }) => data.emailDigest !== false);
      if (wanting.length === 0) continue;
      const customers = (await store.listCustomers(orgId)).map(doc => doc.data);
      for (const { id: uid, data } of wanting) {
        // an administrator follows the whole company; a salesperson, their own deals
        const mine = data.role === 'admin' ? customers : customers.filter(c => c.assignedTo && c.assignedTo.id === uid);
        const digest = buildDigest({ user: data, orgName: org.name, customers: mine, now, todayPanel, daysLabel });
        if (digest) await send('digests', { email: data.email, name: data.name }, digest);
      }
    } catch (err) {
      result.failed += 1;
      log.error(`[E-mail] empresa ${orgId}: ${err.message}`);
    }
  }
  return result;
}

module.exports = { runDailyEmails, buildDigest, buildPlanNotice, daysUntil };
