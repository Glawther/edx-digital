/**
 * EDX Digital - Telling the server when something breaks on the screen
 *
 * Without this, a problem on a customer's screen is only known if the customer reports it.
 * What is sent: the error message, where in the code it happened, which screen was open and
 * the version of the app. Nothing about the person, the company or its data. The server also
 * removes anything that looks like an e-mail or a long number (server/controllers/error-controller.js).
 */

import { getIdToken } from './auth-service.js';

const MAX_PER_VISIT = 5;
const TOKEN_WAIT_MS = 3000;
const sent = new Set();

function appVersion() {
  const script = document.querySelector('script[src*="app.js"]');
  const match = script && /[?&]v=([\w.]+)/.exec(script.getAttribute('src') || '');
  return match ? match[1] : '';
}

/**
 * The session token, when a real account is signed in (null on the sign-in screen and in the
 * demo). Only reports with it can become the owner's e-mail; the others are still logged.
 */
async function sessionToken() {
  try {
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), TOKEN_WAIT_MS));
    return (await Promise.race([getIdToken(), timeout])) || null;
  } catch {
    return null;
  }
}

async function report(kind, message, stack) {
  const text = String(message || '').slice(0, 500);
  if (!text || sent.has(text) || sent.size >= MAX_PER_VISIT) return;
  sent.add(text);
  try {
    const token = await sessionToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch('/api/errors', {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({ kind, message: text, stack: String(stack || '').slice(0, 3000), view: document.body.dataset.view || '', version: appVersion() })
    });
  } catch { /* reporting a failure must never cause another */ }
}

export function setupErrorReporting() {
  const host = window.location.hostname;
  // on the developer's own machine the console is right there
  if (host === 'localhost' || host === '127.0.0.1') return;

  window.addEventListener('error', (event) => {
    // a file that failed to load has no message; an error inside another site's script says only "Script error."
    if (!event.message || event.message === 'Script error.') return;
    report('error', event.message, event.error && event.error.stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report('promise', (reason && reason.message) || String(reason), reason && reason.stack);
  });
}
