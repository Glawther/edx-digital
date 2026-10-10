# Cobrança por PIX com liberação automática

## Como funciona

1. O administrador escolhe um plano em Ferramentas > Plano e uso.
2. O servidor (uma função do Firebase, no mesmo projeto do site) cria uma cobrança PIX no Mercado Pago (API de Orders: uma ordem com um pagamento PIX) e devolve o QR Code e o código copia e cola. A cobrança vale por 30 minutos.
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

O servidor é a função `api` do Firebase (`cloud.js`). O site entrega a ela tudo o que chega em `/api`, então não há outro serviço nem outro endereço.

### 1. Plano Blaze do Firebase

Funções só rodam no plano Blaze (pago por uso, com uma faixa gratuita mensal que cobre um CRM pequeno). No console do Firebase, embaixo à esquerda, clique em **Fazer upgrade** e cadastre uma forma de pagamento. Vale criar um **alerta de orçamento** no mesmo passo, para ser avisado se algum dia houver gasto.

### 2. Mercado Pago: token de acesso

1. Crie a conta em https://www.mercadopago.com.br (funciona com CPF) e conclua a verificação de identidade.
2. Cadastre uma chave PIX na conta: sem ela o Mercado Pago não gera cobrança por PIX.
3. Em https://www.mercadopago.com.br/developers/panel/app crie uma aplicação: solução **Checkout Transparente**. O servidor usa a **API de Orders**; a de Payments está marcada pelo Mercado Pago para ser descontinuada.
4. Em **Credenciais de produção**, copie o **Access Token**.
5. No terminal, na pasta do projeto, rode o comando abaixo e cole o valor quando ele pedir (o que você digita não aparece na tela):

```bash
firebase functions:secrets:set MERCADO_PAGO_ACCESS_TOKEN
```

### 3. Mercado Pago: aviso de pagamento (webhook)

1. Na mesma aplicação, abra **Webhooks > Configurar notificações**, modo produção.
2. URL: `https://edx-digital.web.app/api/billing/webhook/mercadopago`
3. Evento: **Order (Mercado Pago)**. É por ele que as cobranças feitas pela API de Orders são avisadas; o evento "Pagamentos" não avisa essas cobranças.
4. Salve e copie a **assinatura secreta** que aparece.
5. No terminal:

```bash
firebase functions:secrets:set MERCADO_PAGO_WEBHOOK_SECRET
```

Os dois valores ficam no Secret Manager do Google, nunca no código nem no repositório. Enquanto um deles for a palavra `pendente`, a cobrança conta como não configurada.

### 4. Publicar e conferir

A função só passa a usar um segredo novo depois de publicada de novo:

```bash
npm run deploy
```

Abra então:

```
https://edx-digital.web.app/api/billing/status
```

Deve responder `{"configured":true}`.

Faça um pagamento real de teste com a sua própria conta do CRM (o plano Starter, R$ 97) e veja o plano liberar. Para devolver o dinheiro a si mesmo, use a opção de devolução no painel do Mercado Pago.

Não existe mais arquivo de chave do Firebase: dentro do Google, a função grava no banco com a identidade do próprio projeto.

## Enquanto não estiver configurado

A tela de assinatura mostra "A cobrança automática ainda não está disponível". Nada quebra, e nenhum plano é liberado.

## O que acontece quando vence

| Situação | O que o cliente vê | O que pode fazer |
|---|---|---|
| Teste, com dias restantes | "Teste: N dias restantes" no topo | Tudo |
| Pago, faltando 5 dias ou menos | "Plano vence em N dias" no topo | Tudo |
| Pago, vencido há até 3 dias (tolerância) | Aviso pedindo a renovação | Tudo |
| Teste encerrado, ou vencido há mais de 3 dias | Aviso de modo de leitura | Ver, exportar e excluir. Não cria nem altera. |

O modo de leitura é aplicado pelas regras do banco (`planAllowsWrites` em `firestore.rules`), não só pela tela. Ao pagar, a empresa volta ao normal na hora.

Quem controla as datas:

- `trialEndsAtMs`: gravado na criação da empresa. As regras recusam mais de 14 dias e não deixam alterar depois.
- `paidUntilMs`: gravado só pelo servidor de cobrança, quando um pagamento é confirmado.

Para dar mais prazo a um cliente (cortesia, acordo), altere `trialEndsAtMs` ou `paidUntilMs` da empresa no console do Firebase. São números em milissegundos; https://www.epochconverter.com converte uma data.

Empresas criadas antes desta regra não têm `trialEndsAtMs` e por isso nunca entram em modo de leitura pelo teste. Hoje isso vale só para a sua própria conta.

## Limites conhecidos

- **Cobranças anteriores à API de Orders** (identificador só de números) continuam sendo consultadas pela API de Payments. Não há nenhuma paga nesse formato; quando a API antiga for desligada, elas simplesmente deixam de ser consultadas.
- **Contestação**: o período só é tirado quando o Mercado Pago informa que devolveu o valor ao pagador. Enquanto a contestação está em análise, nada muda.

- **Primeira chamada depois de um tempo parado**: a função é ligada sob demanda, e a primeira resposta pode levar alguns segundos. O aviso do Mercado Pago que chegar nesse momento é repetido por ele sozinho, e a tela do cliente consulta o pagamento a cada 5 segundos.
- **Limites de chamadas** (contatos por minuto, cobranças por conta) são contados em cada cópia da função, e podem existir até três ao mesmo tempo.
- **Limites do plano** (pessoas com acesso, oportunidades em aberto) são conferidos pelo aplicativo, não pelas regras do banco. Na conta de quem administra a contagem de oportunidades é exata; a de um vendedor conta só a própria carteira. Com a equipe completa, o código de convite fica pausado.
- **Reembolso**: você devolve o valor no painel do Mercado Pago e o sistema tira sozinho os 30 dias daquele pagamento, quando o Mercado Pago avisa (estorno total ou contestação). Sem outro período pago, a empresa volta para onde o teste está, em geral modo de leitura. Devolução parcial não muda nada: ajuste `paidUntilMs` e `paidUntil` no console do Firebase se precisar.
- **Nota fiscal** não é emitida pelo sistema.

## Desenvolvimento

Testes da lógica (sem rede): `npm test`. A cobrança está em `server/tests/billing-pix.test.js`; importação, lembretes, relatório e personalização estão em `tests/unit/`.

Para rodar de ponta a ponta sem tocar em nada real: `npm run build` e depois `firebase emulators:start --only auth,firestore,functions,hosting --project demo-edx-digital`. O site abre em http://127.0.0.1:5000 com a função atrás de `/api`, como em produção. O emulador lê os segredos de um arquivo `.secret.local` (fora do repositório); com `MERCADO_PAGO_API_BASE` apontando para um servidor de mentira dá para simular pagamentos. Os emuladores são ignorados em produção.
