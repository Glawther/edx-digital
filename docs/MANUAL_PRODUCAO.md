# 📘 Manual de Produção & Comercialização — EDX Digital

Este guia reúne o passo a passo operacional para colocar o **EDX Digital** no ar com domínio próprio, recebimento de pagamentos via PIX/Cartão e inteligência artificial ativada.

---

## 1. 🌐 Conectar seu Domínio Próprio (.com.br) no Firebase Hosting

O frontend PWA já está publicado no Firebase Hosting. Para usar o seu próprio domínio (ex: `crm.suaempresa.com.br` ou `app.suaempresa.com.br`):

1. Acesse o **[Console do Firebase](https://console.firebase.google.com/project/nexuscrm-d8e13/hosting)**.
2. Na aba **Hosting**, clique no botão **"Adicionar domínio personalizado"**.
3. Digite seu domínio (ex: `app.suaempresa.com.br`).
4. O Firebase exibirá os registros DNS que você deve cadastrar no seu provedor de domínio (Registro.br, Cloudflare, GoDaddy, Hostinger):
   - **Tipo A**: Apontando para o IP do Firebase.
   - **Tipo TXT**: Para verificação de propriedade do domínio.
5. Em poucos minutos o Firebase emite o **Certificado SSL (HTTPS)** de forma 100% gratuita e automática.

---

## 2. 💳 Configuração do Gateway de Pagamentos (PIX & Cartão)

O sistema possui integração pronta para **Asaas, Stripe e Kiwify** via [`server/services/billing-gateway-adapter.js`](file:///c:/Users/SAMSUNG/OneDrive/Área de Trabalho/app/server/services/billing-gateway-adapter.js).

### Opção A: Asaas (Recomendado para SaaS B2B no Brasil)
1. Crie sua conta em [asaas.com](https://asaas.com).
2. Vá em **Configurações de Conta -> Integrações -> Chaves de API** e gere sua chave.
3. Vá na aba **Webhooks -> Criar Webhook**:
   - **URL do Webhook**: `https://sua-api.com.br/api/v1/commercial/billing-webhook`
   - **Fila de sincronização**: Ativa.
   - **Eventos**: Marque `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`.
   - **Token de Autenticação**: Defina uma senha forte e coloque a mesma na variável `WEBHOOK_HMAC_SECRET`.

### Opção B: Kiwify ou Hotmart
1. Cadastre os produtos: **Plano Starter**, **Plano Pro** e **Plano Enterprise**.
2. Cole os links de checkout dos produtos nas variáveis `CHECKOUT_STARTER_URL`, `CHECKOUT_PRO_URL` e `CHECKOUT_ENTERPRISE_URL`.
3. Configure o webhook da Kiwify apontando para: `https://sua-api.com.br/api/v1/commercial/billing-webhook`.

---

## 3. 🤖 Ativação da IA Google Gemini 1.5 Flash

Para que seus consultores e clientes usem a copy comercial de WhatsApp e diagnóstico de leads:

1. Acesse o **[Google AI Studio](https://aistudio.google.com/)**.
2. Clique em **"Get API key"** e gere uma chave gratuita ou corporativa.
3. No painel do CRM:
   - Abra o menu lateral **⚡ Ferramentas & Ajustes**.
   - Clique em **✨ Gemini AI Config**.
   - Cole sua chave API e clique em **Salvar**.
   - O CRM testará a chave em tempo real e ativará a geração inteligente de mensagens.

---

## 4. 🐳 Hospedagem da API Backend Node.js em Produção

### Método 1: Google Cloud Run (Serverless 1-Clique)
Execute no terminal o script já configurado:
```powershell
./deploy-cloudrun.ps1
```
Ou no Linux/Mac:
```bash
chmod +x deploy-cloudrun.sh && ./deploy-cloudrun.sh
```

### Método 2: VPS Própria (Ubuntu / Debian / Docker Compose)
Se você possui uma VPS (Hostinger, DigitalOcean, Contabo, AWS EC2):
1. Clone o repositório na sua VPS:
   ```bash
   git clone <URL_DO_REPOSITORIO> app
   cd app
   ```
2. Inicie o cluster de produção com banco de dados PostgreSQL 16 (RLS) e Redis:
   ```bash
   docker compose up -d --build
   ```
3. O container iniciará na porta 3000 com reinicialização automática e healthcheck.

---

## 5. 🧪 Como Testar o Fluxo Comercial de Ponta a Ponta

1. Abra a Landing Page: [https://nexuscrm-d8e13.web.app/landing](https://nexuscrm-d8e13.web.app/landing).
2. Escolha o **Plano Professional** e clique em **"Assinar Professional"**.
3. O portal abrirá em `index.html#register?plan=pro` já com o badge `⚡ Plano Selecionado: Professional`.
4. Preencha seu nome, e-mail corporativo, empresa e senha.
5. Clique em **"Criar Conta e Acessar CRM"**.
6. Você será logado instantaneamente no painel com o badge `⏳ Teste: 7 dias` no topo.
7. Clique no botão de teste para abrir o **Modal de Assinatura & PIX 1-Clique**.
8. O código PIX Copia e Cola e o QR Code serão renderizados prontos para pagamento!
