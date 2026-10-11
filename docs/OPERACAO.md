# Operação: o que o dono do sistema acompanha

## Painel do sistema

Em Ferramentas aparece o item **Painel do sistema**, só para quem é dono. Ele mostra todas as empresas, com a situação do plano, quando termina, quantas pessoas e quantas oportunidades têm, e os totais: empresas pagando, em teste, valor mensal e o que foi recebido.

Quem é dono é decidido pelo servidor: os e-mails que estão no segredo `OWNER_EMAILS`, separados por vírgula. O e-mail precisa estar confirmado na conta. Para qualquer outra pessoa o item não aparece e o endereço do painel responde como se não existisse.

```bash
firebase functions:secrets:set OWNER_EMAILS
```

Depois de mudar o valor, publique de novo (`npm run deploy`).

O painel lê só o cadastro das empresas, das pessoas e das cobranças. O conteúdo de cada empresa (clientes, tarefas, histórico) não é lido: aparece apenas a contagem.

## Cópia de segurança do banco

O Firestore faz uma cópia por dia e guarda cada uma por 7 dias. Para ver:

```bash
firebase firestore:backups:schedules:list
```

```bash
firebase firestore:backups:list
```

Restaurar cria um banco novo a partir de uma cópia; não sobrescreve o atual. É feito pelo console do Google Cloud (Firestore, Backups) ou pelo comando `gcloud firestore databases restore`. As cópias ocupam armazenamento, que é cobrado por uso; para um banco pequeno o valor é de centavos por mês.

Para mudar a frequência ou o tempo guardado, apague a agenda e crie outra:

```bash
firebase firestore:backups:schedules:create --database "(default)" --recurrence DAILY --retention 14d
```

## Erros nas telas dos clientes

Quando algo falha na tela de alguém, o relato vai para o registro das funções (console do Firebase, Functions, Registros), como erro, com o texto `[Tela]`.

Com o envio de e-mails configurado ([EMAILS.md](EMAILS.md)), os donos também recebem um e-mail com o erro, no máximo um por hora; os demais daquela hora ficam só no registro.

## O que olhar de vez em quando

- **Functions, Registros**: linhas `[Tela]` (erros), `[Billing]` (cobrança), `[E-mail] resumo da manhã` (quantos e-mails saíram e quantos falharam).
- **Uso e faturamento** no console do Firebase, e o alerta de orçamento no Google Cloud.
- **Authentication, Usuários**: contas criadas que nunca confirmaram o e-mail podem ser apagadas.
