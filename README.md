# EDX Digital

Funil de vendas, clientes e tarefas para equipes pequenas. Site: https://edx-digital.web.app

## Como é feito

| Parte | Onde fica | O que faz |
|---|---|---|
| Aplicativo | `index.html`, `js/`, `css/` | Roda inteiro no navegador, em JavaScript puro (módulos ES), sem framework. |
| Dados e login | Firebase (Authentication e Firestore) | Cada empresa só alcança os próprios dados; quem garante isso são as regras em `firestore.rules`. |
| Servidor | `server.js`, `server/` | Node sem dependências, no Render. Cobra por PIX (Mercado Pago) e guarda por instantes os contatos enviados por formulários. |
| Páginas públicas | `landing.html`, `termos.html`, `privacidade.html` | Apresentação, termos de uso e política de privacidade. |

```
js/
  app.js                 liga as telas aos dados e aos serviços
  core/                  estado, armazenamento, relatório, personalização, escape de HTML
  services/              login, equipe, planos, importação, lembretes, Gemini, WhatsApp
  ui/                    telas e janelas
server/
  billing/               cobrança por PIX e conferência do pagamento
  controllers/           arquivos públicos e caixa de entrada de formulários
tests/
  unit/                  lógica do aplicativo (importação, relatório, lembretes, escape)
  rules/                 regras do banco, contra o emulador
server/tests/            cobrança, caixa de entrada e o que o servidor expõe
scripts/build.mjs        gera dist/, a versão compactada que é publicada
```

## Rodar no seu computador

```bash
node server.js
```

Abre em http://localhost:3000. A demonstração funciona sem configurar nada. Para testar com conta de verdade sem tocar nos dados reais, use o emulador do Firebase: os passos estão em [docs/LOGIN_E_SEGURANCA.md](docs/LOGIN_E_SEGURANCA.md).

## Testes

```bash
npm test
```

```bash
npm run test:rules
```

O primeiro roda a lógica do aplicativo e do servidor, sem rede. O segundo sobe o emulador do Firebase e confere as regras do banco.

## Publicar

```bash
npm run deploy
```

O comando roda o build e depois publica as regras e os índices do banco e o site. O build junta o JavaScript num arquivo só, minifica JavaScript e CSS e grava tudo em `dist/`, que é a única pasta enviada. Os arquivos de origem não mudam. Publicar com `firebase deploy` direto, sem o build antes, enviaria uma `dist/` antiga ou vazia.

O servidor é publicado pelo Render a cada alteração na branch `main`.

## Documentação

- [Login, permissões e segurança](docs/LOGIN_E_SEGURANCA.md)
- [Cobrança por PIX](docs/COBRANCA_PIX.md)
