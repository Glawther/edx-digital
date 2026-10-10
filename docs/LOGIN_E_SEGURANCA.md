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
- **Limites do plano** (oportunidades em aberto e pessoas com acesso): o aplicativo confere antes de criar, e o servidor reconta a cada mudança e grava na empresa se o plano está cheio (`usage.leadsFull`, `usage.seatsFull`). As regras leem essa marca e recusam novas oportunidades ou novas pessoas enquanto ela disser cheio. Como a recontagem vem depois da gravação, uma rajada de criações pode passar um pouco do limite antes de a porta fechar.
- **E-mail confirmado**: uma empresa só é criada por uma conta com o e-mail confirmado (as regras conferem `email_verified`). Entrar por convite não exige confirmação, porque o código já veio de quem administra.
- **Webhook de leads**: a caixa de entrada é separada por token, e o token fica guardado no navegador de quem configurou. Outro computador da mesma empresa tem outro token.

## Proteções do servidor

- **Onde roda**: em produção o servidor é uma função do Firebase atrás de `/api` no endereço do próprio site; as páginas são entregues pelo Firebase Hosting, que só publica a pasta `dist/`. O item abaixo vale para `server.js`, usado no computador de quem desenvolve.
- **Só arquivos públicos**: o servidor entrega as páginas, `js/`, `css/` e `assets/`. O código dele, a pasta de dados, configurações e arquivos ocultos respondem "não encontrado". A lista fica em `server/controllers/static-controller.js`.
- **Rotas em uso**: cobrança (`/api/billing`), caixa de entrada de formulários (`/api/webhook/leads`) e `/health`. Qualquer outro endereço em `/api` responde 404.
- **API antiga removida**: existia uma `/api/v1` que o aplicativo nunca usou, com uma rota de token que entregava sessão sem conferir quem pedia. O código e os testes dela saíram do repositório; o endereço responde 404, e `server/tests/server-surface.test.js` confere isso.
- **Caixa de entrada de formulários**: fica na coleção `webhook_leads` do banco, fechada ao aplicativo pelas regras (só o servidor lê e grava). Cada token tem a sua; aceita até 60 envios por minuto por caixa e 120 por endereço, corpo de até 32 KB e 500 contatos aguardando. O que chega é guardado como texto simples, com tamanho limitado.

## Proteções do banco

Além de separar as empresas, as regras recusam o que poderia prejudicar outra pessoa da mesma empresa:

- **Registro malformado**: uma oportunidade com tipos trocados (por exemplo, etiquetas que não são lista) ou texto gigante é recusada. Um registro assim travava o funil de quem o abrisse. O aplicativo também normaliza tudo o que lê (`js/core/normalize.js`), então um registro antigo ou estranho aparece, mas não derruba a tela.
- **Bloqueio que vale**: quem foi bloqueado não consegue apagar o próprio perfil para voltar pelo código de convite. Ao bloquear ou excluir alguém, o aplicativo troca o código de convite sozinho, porque a pessoa conhecia o antigo.
- **Histórico de atividade**: cada pessoa só grava em seu próprio nome e com o seu papel real; os registros têm tamanho limitado e campos fixos. Na tela, o nome de quem fez vem da lista da equipe, não do que foi gravado.
- **Teste gratuito por e-mail**: a data em que o teste termina fica em `trial_claims/{e-mail}`, criada uma vez e nunca alterada. Uma empresa só é aceita com essa mesma data, então excluir a empresa e registrar outra com o mesmo e-mail não dá 14 dias novos. Um e-mail diferente recebe outro teste; isso as regras não têm como impedir.
- **Senhas**: no cadastro e na troca, o aplicativo recusa senhas curtas, as mais comuns, só de números e iguais ao nome ou ao e-mail (`passwordProblem` em `js/core/attention.js`).

## Erros das telas

Quando algo falha na tela de alguém, o aplicativo avisa o servidor (`/api/errors`) e o relato vira uma linha de erro no registro das funções, no console do Firebase. Vão a mensagem, o trecho do código, a tela aberta e a versão; nada da pessoa, da empresa ou dos clientes, e o servidor ainda apaga o que tiver formato de e-mail ou de número longo. São no máximo 5 relatos por visita e 10 por minuto por endereço.

## Proteções do navegador

- **Dados do banco na tela**: todo texto e todo valor de atributo passa por `escapeHtml` (`js/core/html.js`). Identificadores com caracteres que o aplicativo não gera são recusados pelas regras do banco na criação e ignorados na leitura. Sem isso, um vendedor poderia gravar um registro que executasse código na tela de quem administra.
- **Logotipo**: só endereço `https` ou imagem embutida.
- **Versão nova**: quando uma publicação chega, a página recarrega uma vez sozinha (se não houver janela aberta nem texto sendo digitado), para ninguém continuar no código antigo.

- **Nenhum código no HTML**: não há `onclick` nem `<script>` com conteúdo. Os elementos dizem qual ação disparam (`data-click`, `data-change`) e um único ouvinte em `js/ui/actions.js` chama a função. Por isso a política abaixo proíbe scripts embutidos: mesmo que um texto malicioso chegasse à tela como marcação, o navegador não o executaria.
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
