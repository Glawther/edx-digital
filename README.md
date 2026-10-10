# ⚡ EDX Digital - Plataforma de Vendas Inteligente

O **EDX Digital** é uma plataforma de gestão de relacionamento com clientes, automação comercial e inteligência de vendas, desenvolvida sob arquitetura modular limpa (Clean Architecture), padrões éticos rigorosos de engenharia de software e segurança cibernética (Tríade CID: Confidencialidade, Integridade e Disponibilidade).

---

## 🏛️ Arquitetura do Projeto & Organização de Pastas

O projeto segue estritamente os princípios de **Separação de Responsabilidades (SoC)**, **Alta Coesão**, **Baixo Acoplamento** e **Zero-Breaking-Change** (compatibilidade total retroativa com Service Worker e navegadores).

```
app/
├── 📁 server/                      # Camada de Servidor & Backend Modular (Node.js)
│   ├── 📁 config/
│   │   └── constants.js            # Portas, rotas, tipos MIME e Headers OWASP
│   ├── 📁 controllers/
│   │   ├── static-controller.js    # Roteamento seguro de assets e clean URLs (/landing)
│   │   └── webhook-controller.js   # Ingestão de leads com teto de 1MB e sanitização
│   ├── 📁 middleware/
│   │   └── security.js             # Proteção anti Path-Traversal e CORS granular
│   └── 📁 services/
│       └── lead-storage.js         # Persistência assíncrona não-bloqueante (fs.promises)
│
├── 📁 js/                          # Camada Frontend (ES Modules Modularizado)
│   ├── 📁 core/                    # Núcleo de Estado, Persistência e Configurações
│   │   ├── config.js               # Parâmetros de ambiente, whitelabel e cotas
│   │   ├── crm-store.js            # Store reativo de estado central (Observer pattern)
│   │   ├── storage-manager.js      # Orquestrador híbrido Offline-First (LocalStorage + Cloud)
│   │   └── theme-manager.js        # Engine de temas (Dark Mode & Doctor+ High Contrast)
│   │
│   ├── 📁 services/                # Serviços de Domínio & Integrações Externas
│   │   ├── audit-service.js        # Trilha de auditoria CID imutável e exportação
│   │   ├── auth-service.js         # Autenticação Google OAuth, RBAC e gestão de sessões
│   │   ├── billing-service.js      # Gateway de pagamento (PIX Copia e Cola / Cartão)
│   │   ├── employee-service.js     # Gestão de usuários, validação de CPF e credenciais
│   │   ├── export-service.js       # Exportação para Excel/CSV e backups JSON
│   │   ├── firebase-service.js     # SDK Firebase v11+ e sincronização Firestore
│   │   ├── gemini-service.js       # Inteligência Artificial com Google Gemini API
│   │   ├── notification-service.js # Notificações Push PWA e Central de Notificações
│   │   ├── team-invite-service.js  # Sistema de convites corporativos com expiração
│   │   ├── webhook-service.js      # Polling e testes de webhooks de captura externa
│   │   └── whatsapp-service.js     # Templates dinâmicos e disparos para WhatsApp
│   │
│   ├── 📁 ui/                      # Camada de Apresentação & Renderização DOM
│   │   └── ui-renderer.js          # Renderizador de Kanban, KPIs, tabelas, modais e toasts
│   │
│   ├── 📄 app.js                   # Orquestrador mestre da aplicação
│   └── 📄 *.js                     # Barrels de re-exportação (100% retrocompatibilidade)
│
├── 📁 css/                         # Camada de Estilos (Design System Nativo HSL)
│   ├── styles.css                  # Estilos globais, temas, tipografia e componentes
│   └── landing.css                 # Estilos específicos da página comercial
│
├── 📁 data/                        # Armazenamento e Amostras de Dados
│   ├── leads.json                  # Leads capturados via Webhook
│   └── sample_leads.csv            # Planilha exemplo para testes de importação
│
├── 📁 icons/                       # Ativos PWA e Favicons
│   ├── icon-192.png                # Ícone PWA standard
│   └── icon-512.png                # Ícone PWA splash screen
│
├── 📄 index.html                   # Painel Operacional EDX Digital
├── 📄 landing.html                 # Página Comercial de Alta Conversão
├── 📄 server.js                    # Bootstrap do servidor local (apenas 60 linhas)
├── 📄 sw.js                        # Service Worker PWA Offline-First (Cache v2.0.0)
├── 📄 manifest.json                # Manifesto PWA para instalação no desktop/mobile
└── 📄 firebase.json                # Configuração de deploy no Firebase Hosting
```

---

## 🛡️ Ética de Código & Segurança Cibernética

O desenvolvimento do EDX Digital segue normas de segurança e boas práticas alinhadas às diretrizes **OWASP Top 10** e à legislação de proteção de dados (**LGPD / GDPR**):

1. **Defesa em Profundidade contra Path Traversal**:
   - Todo acesso ao sistema de arquivos no backend passa por `sanitizePath()`, que resolve caminhos canônicos e impede vetores como `../` ou acessos fora da raiz permitida.
2. **Mitigação de Ataques DoS & Bomba de Payload**:
   - Todas as requisições de webhook possuem teto máximo estrito de **1MB** (`MAX_PAYLOAD_BYTES`). Requisições abusivas são abortadas com HTTP 413.
3. **Higienização Ativa contra Cross-Site Scripting (XSS)**:
   - Sanitização de strings recebidas em payloads de webhooks e templates dinâmicos para prevenir injeções de script.
4. **Headers de Segurança OWASP**:
   - `X-Content-Type-Options: nosniff` (prevenção contra MIME confusion).
   - `X-Frame-Options: SAMEORIGIN` (mitigação contra Clickjacking).
   - `Referrer-Policy: strict-origin-when-cross-origin`.
   - `Content-Security-Policy` e `Permissions-Policy` configurados.
5. **Governança de Acesso Baseada em Papéis (RBAC & Tríade CID)**:
   - Separação rigorosa de permissões entre `Admin` (visão 360°, faturamento, exclusões) e `Employee` (carteira individual, funil operacional).
   - Registro de trilha de auditoria contínua (`audit-service.js`) para todas as ações críticas.
6. **Arquitetura Assíncrona Não-Bloqueante**:
   - Todas as operações de leitura e escrita em disco utilizam a API moderna `fs.promises`, evitando o travamento do event loop do Node.js.

---

## 🚀 Como Executar o Projeto

### Servidor Local Oficial (Recomendado):
```bash
node server.js
```
O servidor inicializará na porta `3000`:
- **Painel CRM**: `http://localhost:3000`
- **Página Comercial**: `http://localhost:3000/landing`
- **Healthcheck**: `http://localhost:3000/health`
- **Webhook Endpoint**: `POST http://localhost:3000/api/webhook/leads`

---

## ☁️ Deploy no Google Cloud / Firebase Hosting

O projeto é 100% compatível com o Firebase Hosting. Para publicar uma nova versão:

```bash
npx -y firebase-tools@latest deploy --only hosting
```
- **Ambiente de Produção**: [https://edx-digital.web.app](https://edx-digital.web.app)
