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

Com o emulador ligado, abra o app em `http://localhost:3000`, e no console do navegador rode `localStorage.setItem('nexus_crm_use_emulator', '1')` e recarregue. O app passa a usar o login e o banco locais. Esse atalho só funciona em `localhost`.

Testes das regras (21 cenários: isolamento entre empresas, papéis, convite, bloqueio, auditoria):

```bash
npm run test:rules
```

## Limites conhecidos

- **Plano e cobrança**: o plano da empresa não pode ser alterado pelo aplicativo (as regras recusam). Enquanto a cobrança não gravar o plano pelo servidor, toda empresa fica em período de teste.
- **Excluir um colaborador** remove o acesso dele aos dados, mas a conta de login continua existindo no Firebase Authentication. Para apagar a conta, use o console do Firebase.
- **Webhook de leads**: a caixa de entrada é separada por token, e o token fica guardado no navegador de quem configurou. Outro computador da mesma empresa tem outro token.
- **Servidor (Render)**: o login do servidor (`/api/v1`) é independente deste. O aplicativo web não depende dele para entrar.
