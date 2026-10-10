/**
 * EDX Digital - What happens when something on the screen is used
 *
 * The HTML carries no code. An element says which action it triggers:
 *   data-click="handleOpenLeadDetails" data-a="<id>"      a click (or Enter, with data-enter)
 *   data-change="handleMoveStage" data-a="<id>" data-value  a change; data-value passes the field's value last
 *   data-drag="<id>"                                       a card that can be dragged
 *   data-drop="<stage>"                                    a column that receives it
 * and one listener here calls it. With that the page needs no inline script at all,
 * and the security policy can forbid them.
 */

const actions = new Map();

/** Names an action so the HTML can refer to it */
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (typeof fn === 'function') actions.set(name, fn);
  }
}

// Screens register their handlers on window (it is how the modules reach one another);
// only names of that shape are looked up there.
const HANDLER_NAME = /^(handle|open|select|navigate)[A-Z][A-Za-z]*$/;

function find(name) {
  if (actions.has(name)) return actions.get(name);
  if (HANDLER_NAME.test(name) && typeof window[name] === 'function') return window[name];
  return null;
}

function run(name, el, extra = []) {
  const action = find(name);
  if (!action) return;
  const args = [];
  if (el.dataset.a !== undefined) args.push(el.dataset.a);
  if (el.dataset.b !== undefined) args.push(el.dataset.b);
  action(...args, ...extra);
}

export function setupActions(root = document) {
  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-click]');
    if (!el) return;
    // a card opens on a click anywhere except on the controls inside it
    if (el.hasAttribute('data-enter')) {
      const control = event.target.closest('select, button, a, input, label');
      if (control && control !== el && el.contains(control)) return;
    }
    run(el.dataset.click, el);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const el = event.target;
    if (!(el instanceof Element) || !el.matches('[data-click][data-enter]')) return;
    // without this the same key press would go on to "click" whatever the action focuses next
    // (the close button of the window it opens)
    event.preventDefault();
    run(el.dataset.click, el);
  });

  root.addEventListener('change', (event) => {
    const el = event.target.closest('[data-change]');
    if (!el) return;
    run(el.dataset.change, el, el.hasAttribute('data-value') ? [el.value] : []);
  });

  root.addEventListener('dragstart', (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-drag]') : null;
    if (el && typeof window.handleDragStartCard === 'function') window.handleDragStartCard(event, el.dataset.drag);
  });

  root.addEventListener('dragover', (event) => {
    const column = event.target instanceof Element ? event.target.closest('[data-drop]') : null;
    if (!column) return;
    event.preventDefault();
    column.classList.add('is-drop-target');
  });

  root.addEventListener('dragleave', (event) => {
    const column = event.target instanceof Element ? event.target.closest('[data-drop]') : null;
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
  });

  root.addEventListener('drop', (event) => {
    const column = event.target instanceof Element ? event.target.closest('[data-drop]') : null;
    if (!column) return;
    column.classList.remove('is-drop-target');
    if (typeof window.handleDropCard === 'function') window.handleDropCard(event, column.dataset.drop);
  });
}
