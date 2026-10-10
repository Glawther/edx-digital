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
  const steps = [
    {
      id: 'welcome',
      title: 'Bem-vindo ao EDX Digital',
      text: [
        'Este passeio mostra, em poucos minutos, onde fica cada coisa e para que serve.',
        'Nada do que aparece aqui é alterado: é só uma apresentação. Você pode sair a qualquer momento e refazer depois, em Ferramentas.'
      ]
    },
    {
      id: 'today',
      view: 'today',
      target: '.nav-item[data-view="today"]',
      title: 'Hoje: por onde começar o dia',
      text: [
        'É a primeira tela ao entrar. Ela junta o que precisa de você agora: tarefas atrasadas e do dia, oportunidades perto de fechar, as que estão paradas e as que ficaram sem próximo passo.',
        'Clique numa linha para abrir a oportunidade. Uma tarefa pode ser concluída ali mesmo, marcando a caixa.'
      ]
    },
    {
      id: 'pipeline',
      view: 'pipeline',
      target: '#pipeline-columns, #pipeline-empty, #view-pipeline',
      title: 'Funil: cada venda em andamento',
      text: [
        'Cada coluna é uma etapa da venda, do primeiro contato ao fechamento. Cada cartão é uma oportunidade, com o valor, o responsável e o que está pendente.',
        'Para mudar de etapa, arraste o cartão para outra coluna ou use a lista de etapas dentro dele. Ao marcar como perdida, o sistema pergunta o motivo, que depois aparece nos relatórios.'
      ]
    },
    {
      id: 'focus',
      view: 'pipeline',
      target: '#focus-filter-pills',
      title: 'Filtro de atenção',
      text: [
        'Mostra só as oportunidades que pedem cuidado: as paradas há 3 dias ou mais, as sem próxima tarefa e as com tarefa atrasada.',
        'O número ao lado de cada opção é quantas existem agora.'
      ]
    },
    {
      id: 'new',
      view: 'pipeline',
      target: '#btn-new-lead',
      title: 'Nova oportunidade',
      text: [
        'É por aqui que entra um cliente novo. O essencial é o nome e o valor; empresa, telefone, previsão de fechamento e etiquetas ajudam depois.',
        'Se o telefone ou o e-mail já existir, o sistema avisa, para ninguém cadastrar o mesmo contato duas vezes. A tecla N abre este formulário de qualquer tela.'
      ]
    },
    {
      id: 'card',
      view: 'pipeline',
      target: '.lead-card, #pipeline-columns, #pipeline-empty',
      title: 'Dentro de uma oportunidade',
      text: [
        'Um clique no cartão abre a janela da oportunidade. Nela você agenda tarefas, registra cada contato (ligação, WhatsApp, e-mail, reunião) com a data em que aconteceu, e vê o histórico completo.',
        'Também é dali que saem a mensagem pelo WhatsApp, a proposta e a análise com inteligência artificial.'
      ]
    },
    {
      id: 'customers',
      view: 'customers',
      target: '.nav-item[data-view="customers"]',
      title: 'Clientes: a lista completa',
      text: [
        'As mesmas oportunidades do funil, em tabela. Serve para procurar alguém, filtrar por etapa e ordenar por valor, nome ou data.',
        'Cada linha tem os atalhos para o histórico, a proposta, o WhatsApp e a edição.'
      ]
    },
    {
      id: 'tasks',
      view: 'tasks',
      target: '.nav-item[data-view="tasks"]',
      title: 'Tarefas: os próximos passos',
      text: [
        'Tudo o que foi agendado, de todas as oportunidades, num lugar só. Uma oportunidade sem tarefa é a que acaba esquecida, por isso vale sempre deixar o próximo passo marcado.',
        'Se você permitir as notificações do navegador, o sistema avisa no horário da tarefa.'
      ]
    },
    {
      id: 'metrics',
      view: 'metrics',
      target: '.nav-item[data-view="metrics"]',
      title: 'Relatórios: como as vendas estão indo',
      text: [
        'Vendas fechadas, novas oportunidades, taxa de conversão, ticket médio e conversas registradas, no período que você escolher.',
        isAdmin
          ? 'Como administrador, você também vê o resultado de cada vendedor, a carteira de cada um agora, os motivos de perda e o andamento da meta do mês.'
          : 'Os números são os da sua carteira. Mais abaixo estão os motivos de perda e o valor em aberto por etapa.'
      ]
    }
  ];

  if (isAdmin) {
    steps.push(
      {
        id: 'team',
        view: 'team',
        target: '.nav-item[data-view="team"]',
        title: 'Equipe: quem tem acesso',
        text: [
          'Aqui fica o código de convite. Quem recebe o código cria a própria conta como vendedor da sua empresa; você pode enviá-lo por e-mail ou WhatsApp, e gerar outro se ele vazar.',
          'Na lista você vê quantas oportunidades cada pessoa tem, transfere a carteira de uma para outra, bloqueia ou exclui um acesso. Cada vendedor só enxerga a própria carteira.'
        ]
      },
      {
        id: 'audit',
        view: 'audit',
        target: '.nav-item[data-view="audit"]',
        title: 'Auditoria e Segurança',
        text: [
          'A Auditoria registra o que cada pessoa da equipe fez e quando: entradas, cadastros, alterações e exclusões.',
          'Em Segurança ficam as permissões de cada papel e a cópia dos dados da empresa, que você pode baixar quando quiser.'
        ]
      }
    );
  }

  steps.push(
    {
      id: 'search',
      target: '.search-box-large, .header-center',
      title: 'Busca e atalhos',
      text: [
        'Digite um nome, uma empresa ou um telefone para ir direto à oportunidade.',
        'Ctrl+K abre a lista de comandos, com tudo o que o sistema faz. A tecla ? mostra os atalhos de teclado.'
      ]
    },
    {
      id: 'tools',
      target: '#btn-header-tools',
      title: 'Ferramentas',
      text: [
        isAdmin
          ? 'Reúne as configurações: nome, logotipo e cor da empresa; nomes das etapas, campos extras e meta do mês; plano e uso; importar contatos de uma planilha; exportar os dados; e receber contatos de formulários e anúncios.'
          : 'Reúne o que é seu: a chave da inteligência artificial, a exportação das suas oportunidades e a sua conta.',
        'Em Minha conta e privacidade você troca o nome e a senha. Este passeio também fica aqui, em "Conhecer o sistema".'
      ]
    },
    {
      id: 'done',
      view: 'today',
      title: 'Pronto',
      text: [
        isAdmin
          ? 'O próximo passo é cadastrar a primeira oportunidade, ou importar seus contatos de uma planilha em Ferramentas. Depois, convide a equipe na tela Equipe.'
          : 'O próximo passo é cadastrar a sua primeira oportunidade e agendar a primeira tarefa para ela.',
        'Bom trabalho.'
      ]
    }
  );

  return steps;
}

/**
 * Where the card of a step goes: below the thing it points at when it fits, otherwise above,
 * to the right or to the left; in the middle of the screen when there is nothing to point at.
 * @param {{top:number,left:number,width:number,height:number}|null} target
 * @param {{width:number,height:number}} card
 * @param {{width:number,height:number}} screen
 * @returns {{top:number,left:number,placement:string}}
 */
export function placeCard(target, card, screen, gap = 12, margin = 12) {
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const maxLeft = screen.width - card.width - margin;
  const maxTop = screen.height - card.height - margin;
  const center = { top: clamp((screen.height - card.height) / 2, margin, maxTop), left: clamp((screen.width - card.width) / 2, margin, maxLeft), placement: 'center' };
  if (!target) return center;

  const alignedLeft = clamp(target.left, margin, maxLeft);
  const alignedTop = clamp(target.top, margin, maxTop);
  const below = target.top + target.height + gap;
  const above = target.top - gap - card.height;
  const right = target.left + target.width + gap;
  const left = target.left - gap - card.width;

  if (below + card.height + margin <= screen.height) return { top: below, left: alignedLeft, placement: 'below' };
  if (above >= margin) return { top: above, left: alignedLeft, placement: 'above' };
  if (right + card.width + margin <= screen.width) return { top: alignedTop, left: right, placement: 'right' };
  if (left >= margin) return { top: alignedTop, left, placement: 'left' };
  // a target that takes the whole screen: the card sits at the bottom, over it
  return { top: maxTop < margin ? margin : maxTop, left: center.left, placement: 'over' };
}
