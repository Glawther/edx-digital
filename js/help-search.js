// Search on the help page (ajuda.html). A file of its own because the security policy forbids
// inline scripts. Without it the page works as before: the search box stays hidden.

const box = document.getElementById('help-search');
const input = document.getElementById('help-search-input');
const status = document.getElementById('help-search-status');
const index = document.querySelector('main .index');

// Accents and case ignored: "relatorio" finds "Relatórios"
const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Each section is its h2 plus the questions that follow it, up to the next h2
const sections = [...document.querySelectorAll('main h2[id]')].map(heading => {
  const questions = [];
  for (let node = heading.nextElementSibling; node && node.tagName !== 'H2'; node = node.nextElementSibling) {
    if (node.tagName === 'DETAILS') questions.push({ el: node, text: fold(node.textContent) });
  }
  return { heading, title: fold(heading.textContent), questions };
});

const total = sections.reduce((sum, section) => sum + section.questions.length, 0);
const plural = (count) => (count === 1 ? '1 pergunta encontrada' : `${count} perguntas encontradas`);

function reset() {
  for (const { heading, questions } of sections) {
    heading.hidden = false;
    // only what the search opened is closed again; what the reader opened stays open
    for (const question of questions) {
      question.el.hidden = false;
      if (question.openedBySearch) question.el.open = false;
      question.openedBySearch = false;
    }
  }
  if (index) index.hidden = false;
  status.textContent = '';
  status.classList.remove('is-empty');
}

function search(raw) {
  const words = fold(raw).split(/\s+/).filter(Boolean);
  if (!words.length) return reset();

  let found = 0;
  for (const { heading, title, questions } of sections) {
    // a section whose title matches shows all of its questions, closed
    const wholeSection = words.every(word => title.includes(word));
    let shown = 0;
    for (const question of questions) {
      const match = words.every(word => question.text.includes(word));
      question.el.hidden = !(match || wholeSection);
      if (match && !question.el.open) {
        question.el.open = true;
        question.openedBySearch = true;
      } else if (!match && question.openedBySearch) {
        question.el.open = false;
        question.openedBySearch = false;
      }
      if (!question.el.hidden) shown += 1;
    }
    heading.hidden = shown === 0;
    found += shown;
  }

  // the list of subjects points to sections that may be hidden now
  if (index) index.hidden = true;
  status.classList.toggle('is-empty', found === 0);
  status.textContent = found
    ? plural(found)
    : `Nenhuma pergunta com "${raw.trim()}". Tente outra palavra, como senha, plano, equipe ou WhatsApp.`;
}

if (box && input && status && total) {
  box.hidden = false;
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      input.value = '';
      reset();
    }
  });
  // a search typed before the script ran (or kept by the browser on back) is applied
  if (input.value) search(input.value);
}
