/**
 * EDX Digital - The guided tour
 * Darkens the screen, lights up one thing at a time and explains it in a card. It changes
 * nothing: while it runs, clicks only reach the card. Steps and wording: js/core/tour-steps.js
 */

import { tourSteps, placeCard } from '../core/tour-steps.js';
import { isAdmin, isSessionActive, getCurrentUser } from '../services/auth-service.js';
import { escapeHtml } from '../core/html.js';

const PENDING_KEY = 'edx_tour_pending';
const SEEN_KEY = 'edx_tour_seen';

let active = null; // { steps, index, root, spot, card, previousFocus, onKey, onMove }

/** Marks that the account just created should be shown around on its first screen */
export function requestTourForNewAccount() {
  try { localStorage.setItem(PENDING_KEY, '1'); } catch { /* storage blocked: the tour stays in the tools menu */ }
}

export function isTourRunning() {
  return active !== null;
}

function firstVisible(selectors) {
  for (const selector of String(selectors || '').split(',').map(part => part.trim()).filter(Boolean)) {
    for (const el of document.querySelectorAll(selector)) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

function build() {
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-shield"></div>
    <div class="tour-spot" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1">
      <p class="tour-progress" id="tour-progress"></p>
      <h2 class="tour-title" id="tour-title"></h2>
      <div class="tour-text" id="tour-text" aria-live="polite"></div>
      <div class="tour-actions">
        <button type="button" class="link-btn tour-skip" data-tour="skip">Sair do passeio</button>
        <span class="tour-spacer"></span>
        <button type="button" class="btn btn-outline btn-sm" data-tour="back">Voltar</button>
        <button type="button" class="btn btn-primary btn-sm" data-tour="next">Avançar</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function position() {
  if (!active) return;
  const { spot, card, target } = active;
  const screen = { width: window.innerWidth, height: window.innerHeight };
  let box = null;
  if (target && target.isConnected) {
    const rect = target.getBoundingClientRect();
    // only the part that is on screen is lit: a whole funnel is taller than the window
    const top = Math.max(rect.top, 4);
    const left = Math.max(rect.left, 4);
    const bottom = Math.min(rect.bottom, screen.height - 4);
    const right = Math.min(rect.right, screen.width - 4);
    if (bottom - top > 8 && right - left > 8) box = { top, left, width: right - left, height: bottom - top };
  }

  if (box) {
    const pad = 6;
    spot.hidden = false;
    spot.style.top = `${box.top - pad}px`;
    spot.style.left = `${box.left - pad}px`;
    spot.style.width = `${box.width + pad * 2}px`;
    spot.style.height = `${box.height + pad * 2}px`;
  } else {
    spot.hidden = true;
  }
  active.root.classList.toggle('has-target', Boolean(box));

  const size = { width: card.offsetWidth, height: card.offsetHeight };
  const place = placeCard(box, size, screen);
  card.style.top = `${place.top}px`;
  card.style.left = `${place.left}px`;
}

async function show(index) {
  if (!active) return;
  const step = active.steps[index];
  active.index = index;

  if (step.view && typeof window.navigateToView === 'function' && document.body.dataset.view !== step.view) {
    window.navigateToView(step.view);
  }
  // one frame for the screen to be drawn before measuring it
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!active) return;

  active.target = firstVisible(step.target);
  if (active.target) {
    active.target.scrollIntoView({ block: 'nearest', inline: 'center' });
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!active) return;
  }

  const { card, steps } = active;
  const last = index === steps.length - 1;
  card.querySelector('#tour-progress').textContent = `Passo ${index + 1} de ${steps.length}`;
  card.querySelector('#tour-title').textContent = step.title;
  card.querySelector('#tour-text').innerHTML = step.text.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
  card.querySelector('[data-tour="back"]').hidden = index === 0;
  card.querySelector('[data-tour="next"]').textContent = last ? 'Concluir' : index === 0 ? 'Começar' : 'Avançar';
  card.querySelector('[data-tour="skip"]').hidden = last;

  position();
  card.querySelector('[data-tour="next"]').focus({ preventScroll: true });
}

function finish() {
  if (!active) return;
  const { root, onKey, onMove, previousFocus } = active;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onMove);
  window.removeEventListener('scroll', onMove, true);
  root.remove();
  document.body.classList.remove('tour-open');
  active = null;
  try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* nothing to keep */ }
  if (typeof window.navigateToView === 'function') window.navigateToView('today');
  if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
}

/**
 * Starts the tour for whoever is signed in. Does nothing when a window is open or it is already running.
 * @returns {boolean} whether it started
 */
export function startTour() {
  if (active || !isSessionActive() || document.querySelector('dialog[open]')) return false;

  const root = build();
  const go = (delta) => {
    const next = active.index + delta;
    if (next < 0) return;
    if (next >= active.steps.length) return finish();
    show(next);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); go(1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); go(-1); return; }
    if (event.key === 'Tab') {
      // the focus stays among the card's own buttons
      const buttons = [...active.card.querySelectorAll('button:not([hidden])')];
      const at = buttons.indexOf(document.activeElement);
      event.preventDefault();
      event.stopPropagation();
      buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      return;
    }
    // the app's own shortcuts (N, H, 1 to 5, Ctrl+K) rest while the tour is on
    if (event.key !== 'Enter' && event.key !== ' ') event.stopPropagation();
  };
  const onMove = () => position();

  active = {
    steps: tourSteps({ isAdmin: isAdmin() }),
    index: 0,
    root,
    spot: root.querySelector('.tour-spot'),
    card: root.querySelector('.tour-card'),
    target: null,
    previousFocus: document.activeElement,
    onKey,
    onMove
  };
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tour]');
    if (!button) return;
    if (button.dataset.tour === 'skip') finish();
    else go(button.dataset.tour === 'back' ? -1 : 1);
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, true);
  document.body.classList.add('tour-open');
  show(0);
  return true;
}

/**
 * Called when a session begins: an account that was just created is shown around, once.
 * Waits for any window that opened on entry (a first password, a notice) to be closed.
 */
export function startTourIfPending() {
  let pending = false;
  try { pending = localStorage.getItem(PENDING_KEY) === '1'; } catch { /* storage blocked */ }
  if (!pending || !getCurrentUser()) return;

  let tries = 0;
  const attempt = () => {
    if (!isSessionActive()) return;
    if (startTour()) {
      try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
      return;
    }
    tries += 1;
    if (tries < 120) setTimeout(attempt, 1000);
  };
  setTimeout(attempt, 600);
}
