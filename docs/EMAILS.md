# E-mails enviados pelo sistema

## O que é enviado

Todo dia às 8h (horário de Brasília) a função `dailyEmails` percorre as empresas e envia:

| Mensagem | Para quem | Quando |
|---|---|---|
| Resumo do dia | Cada pessoa com conta ativa | Só quando há tarefa atrasada ou de hoje, oportunidade perto de fechar ou parada. O vendedor recebe a própria carteira; o administrador, a empresa inteira. |
| Fim do teste | Administradores | 3 dias e 1 dia antes de o teste gratuito terminar |
| Vencimento do plano | Administradores | 5 dias e 1 dia antes de o período pago vencer |

O resumo usa o mesmo código da tela Hoje (`js/core/today.js`), então o e-mail e a tela nunca discordam. Cada pessoa desliga o próprio resumo em Ferramentas, Minha conta e privacidade. Os avisos de vencimento não têm como ser desligados.

Os e-mails de confirmação de cadastro e de troca de senha não passam por aqui: quem envia é o Firebase Authentication, e o texto deles é editado no console do Firebase, em Authentication, Templates.

## Colocar para funcionar

Enquanto não for configurado, nada é enviado e nada quebra: a função roda, vê que falta a configuração e encerra.

O envio é feito pelo [Brevo](https://www.brevo.com), que tem um plano gratuito com limite diário de mensagens.

### 1. Conta e remetente

1. Crie a conta no Brevo.
2. Em **Senders, Domains & Dedicated IPs**, cadastre o endereço que vai aparecer como remetente e confirme-o pelo e-mail que o Brevo envia. Pode ser um endereço comum, mas mensagens enviadas de um domínio próprio, com o domínio autenticado no Brevo, caem muito menos em spam.
3. Em **SMTP & API**, aba **API Keys**, gere uma chave.

### 2. Guardar os dois valores

No terminal, na pasta do projeto. O que você cola não aparece na tela.

```bash
firebase functions:secrets:set BREVO_API_KEY
```

```bash
firebase functions:secrets:set MAIL_SENDER
```

O valor de `MAIL_SENDER` é o remetente, no formato `EDX Digital <avisos@seudominio.com.br>`, com o mesmo endereço confirmado no Brevo.

### 3. Publicar

```bash
npm run deploy
```

### 4. Conferir

No console do Google Cloud, em Cloud Scheduler, a tarefa da função `dailyEmails` tem um botão para executar na hora. Depois, em Functions, Registros, procure a linha `[E-mail] resumo da manhã`: ela diz quantas empresas foram vistas, quantos resumos e avisos saíram e quantos falharam. Com `"skipped":"mail_not_configured"`, falta um dos dois valores.

## Limites conhecidos

- **Uma leitura de tudo por dia.** A função lê todas as empresas, pessoas e oportunidades. Para dezenas de empresas isso é irrelevante; com milhares, vale passar a ler só as empresas com atividade recente.
- **Limite diário do Brevo.** O plano gratuito tem um teto de mensagens por dia; ao atingi-lo, as demais falham naquele dia e aparecem em `failed` no registro.
- **Horário único.** Todos recebem às 8h de Brasília, qualquer que seja o fuso de quem lê.
- **Sem repetição.** Se o envio falhar para alguém, não há nova tentativa no mesmo dia.

## Desenvolvimento

A lógica está em `server/mail/daily-emails.js` e o envio em `server/mail/brevo.js`. Os testes (`server/tests/usage-and-mail.test.js`) usam um banco e um Brevo de mentira: conferem quem recebe o quê, que os dados dos clientes não viram marcação dentro do HTML e que uma falha de envio não interrompe as demais.
