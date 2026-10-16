/**
 * EDX Digital - The tour a person takes when they create their account
 * What each step shows and says, and where its card goes on the screen.
 * Pure functions. Tests: tests/unit/tour.test.mjs
 */

/**
 * @param {{isAdmin: boolean}} who - an administrator also sees the company's screens
 * @returns {Array<{id: string, view?: string, target?: string, title: string, text: string[]}>}
 *   view: the screen to open before the step; target: what to point at (the first one visible).
 *   A step without target is shown in the middle of the screen.
 */
export function tourSteps({ isAdmin = false } = {}) {
  // Kept short on purpose: only what someone needs on the first day. Every screen left out
  // (Clientes, Tarefas, Relatórios, Auditoria, the search) is explained in ajuda.html.
  const steps = [
    {
      id: 'welcome',
      title: 'Bem-vindo ao EDX Digital',
      text: [
        'Alguns passos rápidos pelo que você vai usar todo dia. Nada é alterado: é só uma apresentação.',
        'Você pode sair a qualquer momento e refazer depois, em Ferramentas.'
      ]
    },
    {
      id: 'today',
      view: 'today',
      // the first block of the screen (tasks, when there are any), not the whole screen
      target: '#today-content .settings-section, #today-content',
      title: 'Hoje: por onde começar o dia',
      text: [
        'É a primeira tela ao entrar. Primeiro vêm as tarefas atrasadas e as do dia; marque a caixa para concluir.',
        'Mais abaixo ficam as oportunidades perto de fechar, as paradas e as que estão sem próximo passo. Clique numa linha para abri-la.'
      ]
    },
    {
      id: 'pipeline',
      view: 'pipeline',
      target: '#pipeline-columns, #pipeline-empty, #view-pipeline',
      title: 'Funil: cada venda em andamento',
      text: [
        'Cada coluna é uma etapa e cada cartão é uma oportunidade. Para mudar de etapa, arraste o cartão ou use a lista de etapas dentro dele.',
        'O filtro de atenção, acima das colunas, mostra só as que pedem cuidado: paradas, sem próxima tarefa ou com tarefa atrasada.'
      ]
    },
    {
      id: 'new',
      view: 'pipeline',
      target: '#btn-new-lead, #btn-bottom-right-lead',
      title: 'Nova oportunidade',
      text: [
        'É por aqui que entra um cliente novo. Nome e valor bastam para começar; se o telefone ou o e-mail já existir, o sistema avisa.',
        'A tecla N abre este formulário de qualquer tela.'
      ]
    },
    {
      id: 'card',
      view: 'pipeline',
      target: '.lead-card, #pipeline-columns, #pipeline-empty',
      title: 'Abrir uma oportunidade e agendar o próximo passo',
      text: [
        'Um clique no cartão abre a oportunidade. Nela você marca o próximo passo, com data e horário, e registra cada ligação, mensagem ou reunião.',
        'Toda oportunidade em aberto deveria ter um próximo passo: é o que evita que ela seja esquecida.'
      ]
    }
  ];

  if (isAdmin) {
    steps.push({
      id: 'team',
      view: 'team',
      target: '.nav-item[data-view="team"]',
      title: 'Equipe: quem tem acesso',
      text: [
        'Aqui fica o código de convite: quem o recebe cria a própria conta como vendedor da sua empresa. Cada vendedor só enxerga a própria carteira.',
        'Também é aqui que você transfere a carteira de uma pessoa para outra e bloqueia um acesso.'
      ]
    });
  }

  steps.push(
    {
      id: 'tools',
      target: '#btn-header-tools',
      title: 'Ferramentas e ajuda',
      text: [
        isAdmin
          ? 'Em Ferramentas ficam as configurações da empresa, o plano, a importação de contatos de uma planilha e a sua conta.'
          : 'Em Ferramentas ficam a sua conta, a exportação das suas oportunidades e a chave da inteligência artificial.',
        'Ali também estão a Ajuda, com respostas para as dúvidas comuns, e "Conhecer o sistema", que refaz este passeio.'
      ]
    },
    {
      id: 'done',
      view: 'today',
      title: 'Pronto',
      text: [
        isAdmin
          ? 'O próximo passo é cadastrar a primeira oportunidade, ou importar seus contatos em Ferramentas. Depois, convide a equipe na tela Equipe.'
          : 'O próximo passo é cadastrar a sua primeira oportunidade e agendar a primeira tarefa para ela.',
        'Bom trabalho.'
      ]
    }
  );

  return steps;
}

const overlaps = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * The part of the target that stays lit once the card is in place: all of it when the card is
 * beside it, otherwise the largest piece left uncovered (a funnel can be taller than the screen).
 * Null when nothing useful is left.
 */
function uncovered(target, card, gap) {
  const box = { top: card.top - gap, left: card.left - gap, width: card.width + gap * 2, height: card.height + gap * 2 };
  if (!overlaps(target, box)) return target;
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const pieces = [
    { top: target.top, left: target.left, width: target.width, height: box.top - target.top },
    { top: box.top + box.height, left: target.left, width: target.width, height: bottom - (box.top + box.height) },
    { top: target.top, left: target.left, width: box.left - target.left, height: target.height },
    { top: target.top, left: box.left + box.width, width: right - (box.left + box.width), height: target.height }
  ].filter(piece => piece.width >= 24 && piece.height >= 24);
  if (!pieces.length) return null;
  return pieces.reduce((best, piece) => piece.width * piece.height > best.width * best.height ? piece : best);
}

/**
 * Where the card of a step goes, never on top of what it explains. On a wide screen: below the
 * thing it points at when it fits, otherwise above, to the right or to the left. On a phone the
 * card sits against the bottom or the top edge, whichever is farther from the thing. In the middle
 * of the screen when there is nothing to point at.
 * @param {{top:number,left:number,width:number,height:number}|null} target
 * @param {{width:number,height:number}} card
 * @param {{width:number,height:number}} screen
 * @returns {{top:number,left:number,placement:string,spot:object|null}} spot: the part of the target to light
 */
export function placeCard(target, card, screen, gap = 12, margin = 12) {
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const maxLeft = screen.width - card.width - margin;
  const maxTop = screen.height - card.height - margin;
  const center = { top: clamp((screen.height - card.height) / 2, margin, maxTop), left: clamp((screen.width - card.width) / 2, margin, maxLeft), placement: 'center' };
  if (!target) return { ...center, spot: null };

  const atBottom = { top: Math.max(margin, maxTop), left: center.left, placement: 'bottom' };
  const atTop = { top: margin, left: center.left, placement: 'top' };
  // whichever edge is farther from the target's middle
  const awayEdge = target.top + target.height / 2 < screen.height / 2 ? atBottom : atTop;
  const finish = (place) => ({ ...place, spot: uncovered(target, { ...place, ...card }, gap) });

  // a card nearly as wide as the screen cannot go beside anything
  if (card.width + margin * 2 >= screen.width * 0.8) return finish(awayEdge);

  const alignedLeft = clamp(target.left, margin, maxLeft);
  const alignedTop = clamp(target.top, margin, maxTop);
  const below = target.top + target.height + gap;
  const above = target.top - gap - card.height;
  const right = target.left + target.width + gap;
  const left = target.left - gap - card.width;

  if (below + card.height + margin <= screen.height) return finish({ top: below, left: alignedLeft, placement: 'below' });
  if (above >= margin) return finish({ top: above, left: alignedLeft, placement: 'above' });
  if (right + card.width + margin <= screen.width) return finish({ top: alignedTop, left: right, placement: 'right' });
  if (left >= margin) return finish({ top: alignedTop, left, placement: 'left' });
  // a target bigger than the screen: the card goes to an edge and only the rest of it is lit
  return finish({ ...awayEdge, placement: 'over' });
}
