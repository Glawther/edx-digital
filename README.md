# EDX Digital

Funil de vendas, clientes e tarefas para equipes pequenas. Site: https://edx-digital.web.app

## Como é feito

| Parte | Onde fica | O que faz |
|---|---|---|
| Aplicativo | `index.html`, `js/`, `css/` | Roda inteiro no navegador, em JavaScript puro (módulos ES), sem framework. |
| Dados e login | Firebase (Authentication e Firestore) | Cada empresa só alcança os próprios dados; quem garante isso são as regras em `firestore.rules`. |
| Servidor | `cloud.js`, `server/` | Uma função do Firebase, no mesmo projeto: o site entrega a ela tudo o que chega em `/api`. Cobra por PIX (Mercado Pago) e guarda por instantes os contatos enviados por formulários. `server.js` faz o mesmo no seu computador e serve o site. |
| Páginas públicas | `landing.html`, `termos.html`, `privacidade.html` | Apresentação, termos de uso e política de privacidade. |

```
js/
  app.js                 liga as telas aos dados e aos serviços
  screens/               o que cada tela faz: funil, oportunidade, equipe, conta, plano...
  core/                  estado, armazenamento, relatório, histórico, escape de HTML
  services/              login, equipe, planos, importação, lembretes, Gemini, WhatsApp
  ui/                    desenho das telas e o despachante de eventos (actions.js)
server/
  billing/               cobrança por PIX e conferência do pagamento
  controllers/           arquivos públicos e caixa de entrada de formulários
tests/
  unit/                  lógica do aplicativo (importação, relatório, lembretes, escape)
  rules/                 regras do banco, contra o emulador
  ui/                    o aplicativo aberto num navegador de verdade
server/tests/            cobrança, caixa de entrada e o que o servidor expõe
scripts/build.mjs        gera dist/, a versão compactada que é publicada
scripts/screens.mjs      salva imagens das telas da demonstração, para conferir uma mudança
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

```bash
npm run test:ui
```

O primeiro roda a lógica do aplicativo e do servidor, sem rede. O segundo sobe o emulador do Firebase e confere as regras do banco. O terceiro abre a demonstração do aplicativo no Edge ou no Chrome instalado na máquina e usa as telas como uma pessoa usaria (se nenhum dos dois existir, os testes são pulados).

O HTML não carrega código: nada de `onclick` nem de `<script>` com conteúdo. Um elemento diz qual ação dispara (`data-click="..."`) e `js/ui/actions.js` chama. O build recusa uma página que fuja disso, porque a política de segurança a bloquearia.

## Publicar

```bash
npm run deploy
```

O comando roda o build e depois publica as regras do banco, a função do servidor e o site. Os índices do banco (`firestore.indexes.json`) só precisam ser publicados quando mudam, com `npm run deploy:indexes`. O build junta o JavaScript num arquivo só, minifica JavaScript e CSS e grava tudo em `dist/`, que é a única pasta enviada. Os arquivos de origem não mudam. Publicar com `firebase deploy` direto, sem o build antes, enviaria uma `dist/` antiga ou vazia.

Publicar a função exige o plano Blaze do Firebase e os dois segredos do Mercado Pago criados; o passo a passo está em [docs/COBRANCA_PIX.md](docs/COBRANCA_PIX.md).

## Documentação

- [Login, permissões e segurança](docs/LOGIN_E_SEGURANCA.md)
- [Cobrança por PIX](docs/COBRANCA_PIX.md)
