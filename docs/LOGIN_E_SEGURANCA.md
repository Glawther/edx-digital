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
- **Webhook de leads**: a caixa de entrada é separada por token, e o token fica guardado no navegador de quem configurou. Outro computador da mesma empresa tem outro token.
- **Servidor (Render)**: o login do servidor (`/api/v1`) é independente deste. O aplicativo web não depende dele para entrar.

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
