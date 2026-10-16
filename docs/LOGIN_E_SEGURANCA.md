# Login, perfis e regras de acesso

## Como funciona

- **Login**: Firebase Authentication, e-mail e senha. Não existe mais login que aceita qualquer senha, nem escolha de perfil na tela de entrada.
- **Perfil**: cada conta tem um registro em `users/{uid}` com a empresa (`orgId`) e o papel (`admin` ou `employee`). A própria pessoa não consegue alterar esses campos.
- **Regras** (`firestore.rules`): sem login não se lê nem grava nada. Cada pessoa só alcança os dados da própria empresa. O vendedor só lê e altera os leads atribuídos a ele; só o administrador exclui.
- **Demonstração**: os botões "Como administrador" e "Como vendedor" abrem dados de exemplo guardados só no navegador. Nada da demonstração vai para a nuvem.

## Como alguém entra numa empresa

1. **Cadastrar a empresa** (aba Criar conta): quem cadastra vira o primeiro administrador.
2. **Código de convite** (tela Equipe): quem tem o código cria a própria conta como vendedor. O administrador pode gerar outro código; o antigo para de funcionar.
3. **Cadastro pelo administrador** (tela Segurança): o administrador informa os dados e uma senha temporária. A senha aparece uma única vez e não fica guardada; a pessoa troca no primeiro acesso.

Senha esquecida: o link "Esqueci minha senha" (ou o botão "Nova senha" na lista da equipe) envia um e-mail do Firebase para a pessoa escolher outra.

## Colocar em produção

Faça nesta ordem. As regras novas bloqueiam o aplicativo antigo, então publique as duas coisas juntas.

1. No console do Firebase, projeto `nexuscrm-d8e13`: **Authentication > Sign-in method > E-mail/senha > Ativar**.
2. Publique as regras e o site:

   ```bash
   firebase deploy --only firestore:rules,hosting
   ```

3. Abra o site, crie a sua empresa em Criar conta e confira que o funil abre vazio.

### Dados antigos

Os registros gravados antes desta mudança não têm dono (`orgId` de uma empresa real), então ficam invisíveis para todos. Eles não são apagados. Para recuperar um registro, edite-o no console do Firebase e ponha em `orgId` o identificador da sua empresa (está em `users/{seu uid}`) e em `assignedTo.id` o `uid` de quem deve ficar com ele.

As coleções antigas `employees` e `system_config` ficam fechadas. Se `employees` tiver CPFs de teste, apague a coleção no console.

## Testar sem tocar na produção

```bash
npm run emulators
```

Com o emulador ligado, abra o app em `http://localhost:3000`, e no console do navegador rode `localStorage.setItem('edx_use_emulator', '1')` e recarregue. O app passa a usar o login e o banco locais. Esse atalho só funciona em `localhost`.

Testes das regras (21 cenários: isolamento entre empresas, papéis, convite, bloqueio, auditoria):

```bash
npm run test:rules
```

## Limites conhecidos

- **Plano e cobrança**: o plano da empresa não pode ser alterado pelo aplicativo (as regras recusam). Enquanto a cobrança não gravar o plano pelo servidor, toda empresa fica em período de teste.
- **Excluir um colaborador** remove o acesso dele aos dados, mas a conta de login continua existindo no Firebase Authentication. Para apagar a conta, use o console do Firebase.
- **Limites do plano** (oportunidades em aberto e pessoas com acesso): o aplicativo confere antes de criar, e o servidor reconta a cada mudança e grava na empresa se o plano está cheio (`usage.leadsFull`, `usage.seatsFull`). As regras leem essa marca e recusam novas oportunidades ou novas pessoas enquanto ela disser cheio. Como a recontagem vem depois da gravação, uma rajada de criações pode passar do limite antes de a porta fechar; quando passa muito, o painel do dono mostra (ver "Limite conhecido" mais abaixo).
- **E-mail confirmado**: uma empresa só é criada por uma conta com o e-mail confirmado (as regras conferem `email_verified`). Entrar por convite não exige confirmação, porque o código já veio de quem administra.
- **Leads de formulários**: cada empresa tem um token, gerado pelo administrador em Ferramentas, Receber leads de formulários. O servidor guarda só a ligação do hash do token com a empresa (`webhook_tokens`) e o token em `webhook_config`, as duas coleções fechadas ao aplicativo. Cada contato que chega é gravado direto nas oportunidades da empresa dona do token, com a dona da empresa como responsável; nada passa pelo navegador. Um contato com o mesmo e-mail ou telefone de uma oportunidade existente vira uma anotação nela. Plano vencido ou cheio: o contato é recusado e o formulário recebe o motivo.

## Proteções do servidor

- **Onde roda**: em produção o servidor é uma função do Firebase atrás de `/api` no endereço do próprio site; as páginas são entregues pelo Firebase Hosting, que só publica a pasta `dist/`. O item abaixo vale para `server.js`, usado no computador de quem desenvolve.
- **Só arquivos públicos**: o servidor entrega as páginas, `js/`, `css/` e `assets/`. O código dele, a pasta de dados, configurações e arquivos ocultos respondem "não encontrado". A lista fica em `server/controllers/static-controller.js`.
- **Rotas em uso**: cobrança (`/api/billing`), leads de formulários (`/api/webhook/leads`, e `/api/webhook/token` para o administrador) e `/health`. Qualquer outro endereço em `/api` responde 404.
- **API antiga removida**: existia uma `/api/v1` que o aplicativo nunca usou, com uma rota de token que entregava sessão sem conferir quem pedia. O código e os testes dela saíram do repositório; o endereço responde 404, e `server/tests/server-surface.test.js` confere isso.
- **Recebimento de formulários**: aceita até 60 envios por minuto por token e 120 por endereço de origem, corpo de até 32 KB, e guarda só texto simples com tamanho limitado.

## Proteções do banco

Além de separar as empresas, as regras recusam o que poderia prejudicar outra pessoa da mesma empresa:

- **Registro malformado**: uma oportunidade com tipos trocados (por exemplo, etiquetas que não são lista) ou texto gigante é recusada. Um registro assim travava o funil de quem o abrisse. O aplicativo também normaliza tudo o que lê (`js/core/normalize.js`), então um registro antigo ou estranho aparece, mas não derruba a tela.
- **Bloqueio que vale**: quem foi bloqueado não consegue apagar o próprio perfil para voltar pelo código de convite. Ao bloquear ou excluir alguém, o aplicativo troca o código de convite sozinho, porque a pessoa conhecia o antigo.
- **Histórico de atividade**: cada pessoa só grava em seu próprio nome e com o seu papel real; os registros têm tamanho limitado e campos fixos. Na tela, o nome de quem fez vem da lista da equipe, não do que foi gravado.
- **Teste gratuito por e-mail**: a data em que o teste termina fica em `trial_claims/{e-mail}`, criada uma vez e nunca alterada. Uma empresa só é aceita com essa mesma data, então excluir a empresa e registrar outra com o mesmo e-mail não dá 14 dias novos. Um e-mail diferente recebe outro teste; isso as regras não têm como impedir.
- **Senhas**: no cadastro e na troca, o aplicativo recusa senhas curtas, as mais comuns, só de números e iguais ao nome ou ao e-mail (`passwordProblem` em `js/core/attention.js`).

## Arquivos anexados

Os anexos das oportunidades ficam no Firebase Storage, em `orgs/{empresa}/customers/{oportunidade}/`, e as regras estão em `storage.rules`:

- quem alcança um arquivo é quem alcança a oportunidade no banco (o administrador da empresa ou o vendedor responsável); a regra confere o perfil e a oportunidade no Firestore;
- só entram PDF, imagem (PNG, JPG, WEBP), Word, Excel, CSV e texto, até 10 MB, e sempre marcados para download: nenhum arquivo é aberto como página;
- o endereço usa um identificador sorteado, nunca o nome do arquivo; ninguém lista pastas nem troca um arquivo por outro;
- quando a oportunidade (ou a empresa) é excluída, a função `dailyEmails` apaga os arquivos dela na manhã seguinte.

Os testes ficam em `tests/rules/storage-rules.test.mjs` e rodam com `npm run test:rules`.

## Auditoria de acessos (outubro de 2026)

Varredura das regras do banco, das regras de arquivos, do servidor e das telas, com tentativas de burlar cada limite no emulador. O que foi fechado:

- **Limites do plano que não acompanhavam a troca de plano**: a marca de "plano cheio" só era recontada quando uma oportunidade ou uma pessoa mudava. Quem pagava um plano maior porque a equipe estava cheia continuava travado. Agora o pagamento de outro plano manda recontar na hora.
- **Reabrir oportunidades para passar do limite**: ganhas e perdidas não contam para o limite, e reabrir não era conferido. Com o plano cheio, reabrir passa a ser recusado, como criar.
- **Desbloquear pessoas para passar do limite**: com a equipe cheia, desbloquear alguém passa a ser recusado, como cadastrar.
- **Plano vencido**: ninguém entra na equipe (por convite ou cadastrado) enquanto o plano não é renovado.
- **Teste gratuito gasto por terceiros**: o registro do teste de um e-mail só é aceito com o endereço confirmado.
- **Arquivos enviados por fora do aplicativo**: o limite de arquivos fica no registro da oportunidade; um arquivo que nenhuma oportunidade lista é apagado pela limpeza diária.
- **API aberta a outros sites**: só o endereço que recebe contatos de formulários aceita chamadas de outros sites. Cobrança, painel do dono e o resto respondem apenas ao próprio aplicativo, e nenhuma resposta da API é guardada em cache.

O que foi conferido e estava certo: isolamento entre empresas, vendedor restrito à própria carteira, plano e pagamento inalteráveis pelo aplicativo, cobranças visíveis só ao administrador, texto hostil gravado por fora do aplicativo aparecendo como texto em todas as telas (`tests/e2e/account.test.mjs`), nenhum segredo no repositório nem no site publicado, e nenhuma vulnerabilidade conhecida nas bibliotecas.

Limites conhecidos, que não têm correção só no código:

- O código de convite fica no registro da empresa, que todo membro lê: um vendedor consegue vê-lo. Quem entra por ele é sempre vendedor, e bloquear alguém troca o código.
- O link de download de um anexo vale para quem o tiver. Quem baixou o link uma vez continua conseguindo abrir aquele arquivo até ele ser excluído.
- Os limites de pedidos por minuto são contados em cada cópia do servidor, e uma rajada de gravações pode passar um pouco do limite do plano antes de a marca fechar.
## Erros das telas

Quando algo falha na tela de alguém, o aplicativo avisa o servidor (`/api/errors`) e o relato vira uma linha de erro no registro das funções, no console do Firebase. Vão a mensagem, o trecho do código, a tela aberta e a versão; nada da pessoa, da empresa ou dos clientes, e o servidor ainda apaga o que tiver formato de e-mail ou de número longo. São no máximo 5 relatos por visita e 10 por minuto por endereço.

## Proteções do navegador

- **Dados do banco na tela**: todo texto e todo valor de atributo passa por `escapeHtml` (`js/core/html.js`). Identificadores com caracteres que o aplicativo não gera são recusados pelas regras do banco na criação e ignorados na leitura. Sem isso, um vendedor poderia gravar um registro que executasse código na tela de quem administra.
- **Logotipo**: só endereço `https` ou imagem embutida.
- **Versão nova**: quando uma publicação chega, a página recarrega uma vez sozinha (se não houver janela aberta nem texto sendo digitado), para ninguém continuar no código antigo.

- **Nenhum código no HTML**: não há `onclick` nem `<script>` com conteúdo. Os elementos dizem qual ação disparam (`data-click`, `data-change`) e um único ouvinte em `js/ui/actions.js` chama a função. Por isso a política abaixo proíbe scripts embutidos: mesmo que um texto malicioso chegasse à tela como marcação, o navegador não o executaria.
- **Estilos**: nenhuma página tem bloco `<style>`; os estilos ficam em arquivos de `css/`, e a política recusa qualquer bloco de estilo escrito numa página. Os atributos `style` em elementos ainda são aceitos (há cerca de 200 no aplicativo); o que um atributo consegue fazer é bem menos do que um bloco.
- **Política de segurança de conteúdo (CSP)**: o site só carrega scripts dele mesmo e do SDK do Firebase, nunca embutidos na página, e só conversa com o Firebase, o Google Gemini e o servidor de cobrança. Ela está em `firebase.json` (site publicado) e em `server/config/constants.js` (servidor). Ao usar um serviço novo, inclua o endereço dele nos dois lugares.
- **Exportação**: células que uma planilha executaria como fórmula (começando com `=`, `+`, `-` ou `@`) saem com um apóstrofo na frente.
- **Chave do Gemini**: fica só no navegador de quem a informou e vai para o Google num cabeçalho, nunca no endereço.

### O que vale ligar no console (depende de você)

- **Restringir a chave de API do Firebase** aos seus endereços: Google Cloud Console > APIs e serviços > Credenciais > a chave do navegador > Restrições de aplicativo > Sites, com `edx-digital.web.app/*`, `nexuscrm-d8e13.web.app/*`, `nexuscrm-d8e13.firebaseapp.com/*` e o seu domínio quando houver.
- **App Check** (reCAPTCHA Enterprise): faz o banco aceitar chamadas só do seu site. Exige criar a chave do reCAPTCHA no console e um ajuste no código; peça quando for ativar.

## Termos, privacidade e direitos dos titulares

- **Aceite**: quem cria conta marca que leu os Termos de Uso e a Política de Privacidade. A versão aceita e a data ficam em `users/{uid}` (`termsVersion`, `termsAcceptedAt`). Ao mudar o conteúdo de `termos.html` ou `privacidade.html`, atualize `LEGAL_VERSION` em `js/services/auth-service.js`.
- **Exportar tudo**: Ferramentas > Minha conta e privacidade > Baixar todos os dados (administradores).
- **Excluir a conta**: o vendedor apaga o próprio acesso; as oportunidades ficam com a empresa.
- **Excluir a empresa**: só o dono. Apaga clientes, histórico de atividade, perfis da equipe, convite, a empresa e a conta do dono. Pede a senha e o nome da empresa.
- **Sessão ociosa**: uma conta real sem uso por 8 horas é desconectada (`IDLE_LIMIT_MS`).
- **Ao sair**: nada da empresa fica no navegador.

### O que depende de você, fora do sistema

Os termos assumem estes compromissos, e o sistema não os cumpre sozinho:

- **CPF nos termos**: o Decreto 7.962/2013 pede nome, CPF ou CNPJ e endereço do fornecedor em local visível. Hoje os termos trazem nome, cidade e e-mail, e dizem que o CPF é informado a pedido. Para ficar completo, inclua o CPF (ou, melhor, um CNPJ) e um endereço.
- **Arrependimento**: devolver por PIX, em até 10 dias, o valor de quem desistir em até 7 dias de cada contratação.
- **Conferência do PIX**: liberar o plano em até 2 dias úteis (hoje, alterando `plan` e `planStatus` da empresa no console do Firebase).
- **Abatimento**: devolver o proporcional quando o serviço parar por falha nossa.
- **Resposta a pedidos de titulares**: em até 15 dias. Reclamações em geral: em até 5 dias úteis.
- **Contas de login de colaboradores de uma empresa excluída**: apagar em até 30 dias, no console do Firebase (Authentication > Usuários). O sistema não consegue fazer isso.
- **Contas inativas**: avisar por e-mail 30 dias antes de excluir.
- **Incidente de segurança**: avisar o cliente em até 2 dias úteis; avaliar comunicação à ANPD e aos titulares.
- **Registro das operações de tratamento** (LGPD, art. 37): mantenha um registro simples (uma planilha serve para agente de pequeno porte) com quais dados trata, para quê, onde ficam e por quanto tempo. A Política de Privacidade já traz esse conteúdo e pode servir de base.
- **Mudou termos ou política?** Atualize a data nas páginas e `LEGAL_VERSION`, e avise os clientes com 15 dias de antecedência.

Os textos descrevem o que o sistema faz de verdade e foram revisados com atenção ao CDC, à LGPD e ao Decreto 7.962/2013, mas não substituem a orientação de um advogado inscrito na OAB.

## Revisão com quatro perfis (outubro de 2026)

Uma cliente comum, um cliente avançado, um dev pleno e um dev sênior revisaram o sistema. O que foi fechado no servidor e nas regras:

- **Cobrança**: troca de plano convertida pelo preço, estorno que devolve o plano anterior, e confirmação gravada em transação (duas cópias do servidor não somam dois períodos). Ver `docs/COBRANCA_PIX.md`.
- **E-mails da manhã**: só para endereço confirmado de uma conta de login (ver `docs/EMAILS.md`).
- **Leads de formulários**: gravados pelo servidor direto na empresa (acima). Antes o token ficava no navegador de quem configurou, e quem abrisse o CRM naquele navegador recolhia e apagava os contatos.
- **Vendedor**: não apaga entradas do histórico, não muda a data de criação e só muda a data da venda junto com a etapa. O administrador continua podendo corrigir.
- **Valor de oportunidade**: até 10 bilhões, para todos.
- **Teste gratuito do Enterprise**: com os limites do Professional.
- **Perfil novo**: só os campos que o aplicativo grava.

No aplicativo, também da mesma revisão:

- **Duas pessoas na mesma oportunidade**: histórico e tarefas são acrescentados sem reescrever a lista (o que outra pessoa gravou no mesmo instante fica); concluir e excluir tarefa leem a lista do banco na hora. Editar uma oportunidade grava só os campos alterados no formulário, e uma mudança de etapa feita ali entra no histórico como no funil. "Desfazer" uma mudança de etapa devolve só a etapa e registra que foi desfeita.
- **Sem conexão**: o cabeçalho mostra "Sem conexão" e quantas alterações aguardam; fechar a aba com alterações não confirmadas pede confirmação.
- **Bloqueio em plena sessão**: quem é bloqueado ou removido sai do sistema na hora.
- **Proposta**: tem texto próprio; as anotações da oportunidade são internas e não aparecem nela.
- **Importação de planilha**: confere os mesmos limites do banco antes de importar, lê o CSV do Excel em português (Windows-1252), avisa valores negativos ou com letras, não deixa uma aspa aberta engolir o arquivo, reconhece "Nome da empresa" como a empresa, e grava em blocos.
- **Restaurar cópia de segurança**: mostra o que vai acontecer e pergunta antes; não substitui o que mudou depois da cópia; um registro recusado não interrompe os outros.

Limite conhecido que continua: uma rajada de gravações feita por fora do aplicativo (lotes chamados direto no banco, em paralelo) pode passar do limite do plano antes de o servidor marcar o plano como cheio, e não só um pouco. As regras do banco não conseguem contar quantos registros um lote cria, então não há como fechar isso nelas sem um contador gravado junto em todo ponto que cria, exclui, fecha ou reabre oportunidade (e pelo servidor no webhook). O que existe é a vigilância: quando a contagem passa o limite em mais de 10% (no mínimo uma pessoa a mais), o servidor marca a empresa (`usage.overLimit`, com os números e desde quando) e registra uma linha `[Limites]` no log das funções. O painel do dono mostra "Acima do limite do plano" na empresa e a coluna correspondente na exportação. Nada é apagado: a decisão é do dono (falar com a empresa, cobrar o plano certo, bloquear). Uma empresa que mudou para um plano menor aparece da mesma forma. Enquanto o plano estiver cheio, nenhuma oportunidade nova entra pelo aplicativo nem pela rajada seguinte.
