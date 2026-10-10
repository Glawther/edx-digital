# Cobrança por PIX com liberação automática

## Como funciona

1. O administrador escolhe um plano em Ferramentas > Plano e uso.
2. O servidor (Render) cria uma cobrança PIX no Mercado Pago e devolve o QR Code e o código copia e cola. A cobrança vale por 30 minutos.
3. O cliente paga no aplicativo do banco.
4. O Mercado Pago avisa o servidor. O servidor **consulta o pagamento no próprio Mercado Pago** e, se estiver aprovado e com o valor do plano, grava na empresa: plano, situação ativa e validade de 30 dias.
5. A tela do cliente confirma sozinha em alguns segundos.

Pagar antes do vencimento soma 30 dias ao período em curso. Não há cobrança automática: cada período é um PIX novo.

### Por que é seguro

- O plano só muda pelo servidor. As regras do Firestore recusam qualquer tentativa do aplicativo de alterar plano, validade ou cobranças.
- O aviso do Mercado Pago só diz qual pagamento olhar. Nada do que vem nele é aceito como verdade.
- Só valem cobranças que este servidor criou, para a empresa e o plano registrados, com o valor da tabela.
- Um pagamento nunca soma dois períodos, mesmo que o aviso chegue repetido.

## Colocar para funcionar

São três segredos, preenchidos **no painel do Render** (Environment), nunca no código.

### 1. Mercado Pago: token de acesso

1. Crie a conta em https://www.mercadopago.com.br (funciona com CPF) e conclua a verificação de identidade.
2. Cadastre uma chave PIX na conta: sem ela o Mercado Pago não gera cobrança por PIX.
3. Em https://www.mercadopago.com.br/developers/panel/app crie uma aplicação (tipo: pagamentos online).
4. Em **Credenciais de produção**, copie o **Access Token**.
5. No Render, crie a variável `MERCADO_PAGO_ACCESS_TOKEN` com esse valor.

### 2. Mercado Pago: aviso de pagamento (webhook)

1. Na mesma aplicação, abra **Webhooks > Configurar notificações**, modo produção.
2. URL: `https://nexus-crm-yfof.onrender.com/api/billing/webhook/mercadopago`
3. Evento: **Pagamentos**.
4. Salve e copie a **assinatura secreta** que aparece.
5. No Render, crie a variável `MERCADO_PAGO_WEBHOOK_SECRET` com esse valor.

### 3. Firebase: conta de serviço

É o que permite ao servidor gravar o plano no banco.

1. Console do Firebase > Configurações do projeto > **Contas de serviço** > **Gerar nova chave privada**. Um arquivo `.json` é baixado.
2. No Render, crie a variável `FIREBASE_SERVICE_ACCOUNT` e cole o **conteúdo inteiro** do arquivo.
3. Apague o arquivo do computador. Ele dá acesso total ao banco: nunca o coloque no repositório nem o envie por mensagem.

### 4. Conferir

Depois de salvar as variáveis, o Render reinicia o servidor. Abra:

```
https://nexus-crm-yfof.onrender.com/api/billing/status
```

Deve responder `{"configured":true}`. Se responder `false`, falta o token do Mercado Pago ou a conta de serviço.

Faça então um pagamento real de teste com a sua própria conta do CRM (o plano Starter, R$ 97) e veja o plano liberar. Para devolver o dinheiro a si mesmo, use a opção de devolução no painel do Mercado Pago.

## Enquanto não estiver configurado

A tela de assinatura mostra "A cobrança automática ainda não está disponível". Nada quebra, e nenhum plano é liberado.

## Limites conhecidos

- **Servidor gratuito do Render dorme** depois de um tempo sem uso. O primeiro PIX depois disso pode levar até um minuto para ser gerado, e o aviso do Mercado Pago pode chegar com atraso (ele tenta de novo sozinho). A tela do cliente também consulta o pagamento a cada 5 segundos, o que acorda o servidor. Um plano pago do Render elimina a espera.
- **Vencimento não bloqueia o uso.** Quando o teste ou o período pago termina, o sistema avisa no topo da tela, mas continua funcionando. Bloquear ou limitar é uma decisão de produto ainda em aberto.
- **Limites do plano** (pessoas, oportunidades) são mostrados, mas não impedidos.
- **Reembolso** é feito por você no painel do Mercado Pago. O sistema não desfaz o período automaticamente; ajuste `paidUntil` da empresa no console do Firebase se precisar.
- **Nota fiscal** não é emitida pelo sistema.

## Desenvolvimento

Testes da lógica (sem rede): `npm test`, arquivo `server/tests/billing-pix.test.js`.

Para rodar de ponta a ponta sem tocar em nada real: emuladores do Firebase (`npm run emulators`) e o servidor com `FIREBASE_PROJECT_ID=demo-nexus-crm`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` e `MERCADO_PAGO_API_BASE` apontando para um servidor de mentira. Os emuladores são ignorados quando `NODE_ENV=production`.
