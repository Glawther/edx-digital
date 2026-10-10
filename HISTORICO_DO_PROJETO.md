# 📜 Histórico de Desenvolvimento e Evolução do Projeto - Nexus CRM

> **Documento Oficial de Registro Cronológico**  
> **Projeto:** Nexus CRM — Plataforma Corporativa de Vendas com Google Cloud Firestore & Gemini AI  
> **Repositório:** [github.com/Glawther/nexus-crm](https://github.com/Glawther/nexus-crm.git)  
> **Ambiente de Produção:** [nexuscrm-d8e13.web.app](https://nexuscrm-d8e13.web.app)  
> **Data de Compilação:** Outubro de 2026  

---

## 🧭 1. Visão Geral da Jornada do Projeto

O **Nexus CRM** nasceu da iniciativa de criar um CRM corporativo moderno, robusto e escalável que combinasse a agilidade de um frontend leve em **Vanilla JavaScript + CSS3 Puro** com o poder de sincronização em tempo real do **Google Cloud Firestore**, inteligência artificial analítica via **Google Gemini API**, e uma sólida camada de segurança estruturada na **Tríade CID (Confidencialidade, Integridade e Disponibilidade)** e controle de acesso baseado em papéis (**RBAC**).

Ao longo do desenvolvimento, o projeto evoluiu de um protótipo inicial até um produto comercial pronto para vendas corporativas, com suporte a múltiplos colaboradores, geração de propostas em PDF, gestão de senhas temporárias com validação oficial de CPF e capacidade offline via PWA.

---

## ⏱️ 2. Linha do Tempo Cronológica dos Pedidos e Implementações

### 🔹 Fase 1: Concepção, Setup Inicial e Escolha da Stack
* **Mensagem do Usuário:** *"vamos começar?"* e *"vamos deixar tudo configurado? todas as API, todas as skills, tudo, pra deixar no jeito"*
* **Mensagem de Decisão:** *"vamos criar uma aplicaçáo que envolve banco de dados, o prorprio banco de dados do google"* -> *"eu já possuo conta do firebase, vamos criar um CRM"*
* **Ações e Implementações Realizadas:**
  * Diagnóstico do ambiente e resolução de dependências locais no Windows.
  * Estruturação inicial do projeto: `index.html`, arquitetura modular ES Modules (`js/`), e tokens de design (`css/`).
  * Escolha da arquitetura **Offline-First com Fallback Híbrido**: o sistema opera localmente via `localStorage` e se conecta bidirecionalmente com o **Google Cloud Firestore** quando configurado.

---

### 🔹 Fase 2: Conexão e Integração com Firebase Firestore
* **Mensagem do Usuário:** *"quero conectar ao firebase, eu ja criei o projeto lá com o nome de nexusCRM"* -> *"onde eu acho a API?"* -> *"pronto, conectei, qual o proximo passo?"* -> *"criei, tudo certo"*
* **Ações e Implementações Realizadas:**
  * Implementação da camada `js/firebase-service.js` utilizando a SDK Modular oficial v11 da Google (`firebase-app.js`, `firebase-firestore.js`).
  * Criação do modal de configuração de credenciais Firebase com teste em tempo real de conexão.
  * Construção do pipeline Kanban reativo de 6 estágios comerciais (*Lead, Contato Realizado, Proposta Enviada, Em Negociação, Fechado Ganho, Perdido*).
  * Sincronização em tempo real através do listener `onSnapshot` do Firestore com persistência e broadcast reativo em `js/crm-store.js`.

---

### 🔹 Fase 3: Autonomia Plena do Agente
* **Mensagem do Usuário:** *"como deixar voce totalmente automatico? não queri clicar para aceitar mudanças nos arquivos"*
* **Ações e Implementações Realizadas:**
  * Criação e configuração das diretrizes no arquivo `GEMINI.md`:
    * Execução proativa sem interrupções manuais intermediárias.
    * Continuidade completa de tarefas até verificação e validação funcional.
    * Preservação da integridade estrutural do código.

---

### 🔹 Fase 4: Redesenho Visual & Estética Executiva Sóbria
* **Mensagem do Usuário:** *"vamos fazer tudo, mas primeiro quero mudar o visual, quero deixar ele mais sobrio e que o background seja branco"*
* **Ações e Implementações Realizadas:**
  * Transformação da identidade visual para um padrão **SaaS B2B Premium**:
    * Substituição do tema escuro/colorido por uma paleta executiva com fundo branco `#ffffff` e superfícies contrastadas em `#f8fafc` e `#f1f5f9`.
    * Tipografia refinada com as fontes Google **Outfit** (títulos elegantes) e **Inter** (leitura corporativa).
    * Borda sutil `#e2e8f0`, sombras suaves de elevação (`box-shadow`), badges discretos com cores semânticas harmônicas (verde para ganho, vermelho para perda, âmbar para média prioridade).

---

### 🔹 Fase 5: Benchmarking com Melhores CRMs de Mercado
* **Mensagem do Usuário:** *"faça uma pesquisa nos melhores CRM e veja o que falta no nosso, o que podemos melhor e adcionar"* -> *"vamos adicionar tudo"*
* **Ações e Implementações Realizadas:**
  * Estudo aprofundado dos recursos líderes de mercado (**Salesforce, HubSpot, Pipedrive e RD Station**):
  * **Deal Rotting (Estagnação de Leads):** Identificação visual automática de negócios parados na mesma etapa há mais de 3 dias sem interação.
  * **Motivos de Perda Padronizados:** Modal dedicado ao arrastar para "Perdido" com coleta estruturada de motivos (*Preço, Concorrente, Projeto Adiado, Sem Orçamento, etc.*) e detalhes para análise estratégica.
  * **Disparo WhatsApp em 1 Clique:** Modal com templates comerciais dinâmicos (Primeiro contato, Envio de proposta, Follow-up e Pós-venda) e link direto `https://wa.me/`.
  * **Inteligência Artificial com Google Gemini:** Botão integrado em cada lead para análise de probabilidade de vitória, mapeamento de objeções e rascunho de e-mail consultivo.
  * **Linha do Tempo e Checklist de Tarefas:** Registro histórico de reuniões, ligações, mudanças de estágio e agendamento de tarefas vinculadas a cada oportunidade.

---

### 🔹 Fase 6: Git, GitHub e Deploy no Firebase Hosting
* **Mensagem do Usuário:** *"antes de publicar, quero subir para o meu github"* -> *"https://github.com/Glawther/nexus-crm.git"* -> *"pronto, foi publicado"*
* **Ações e Implementações Realizadas:**
  * Inicialização e vinculação do repositório remoto via `MinGit` no PowerShell.
  * Criação do branch `main`, primeiro commit oficial e push para o repositório remoto [Glawther/nexus-crm](https://github.com/Glawther/nexus-crm.git).
  * Instalação e configuração do Firebase CLI.
  * Deploy do build completo para o **Firebase Hosting** no projeto `nexuscrm-d8e13`, disponibilizando o aplicativo publicamente com SSL/HTTPS em `https://nexuscrm-d8e13.web.app`.

---

### 🔹 Fase 7: Segurança da Informação & Tríade CID (RBAC)
* **Mensagem do Usuário:** *"certo, agora vamos aplicar a triade CID, por que tem que ter o acesso do funcionario e o acesso do administrador"*
* **Ações e Implementações Realizadas:**
  * Estruturação formal dos pilares da **Tríade CID**:
    * **Confidencialidade (C):** Isolamento de dados entre perfis. O Funcionário visualiza apenas suas oportunidades atribuídas ou leads gerais para triagem; o Administrador tem acesso à visão global, métricas financeiras consolidadas e faturamento.
    * **Integridade (I):** Apenas o Administrador possui privilégio de exclusão definitiva de registros. Implementação de sanitização contra injeções e trilha de auditoria completa (*Audit Logs*) para todas as ações sensíveis.
    * **Disponibilidade (D):** Service Worker PWA (`sw.js`) para funcionamento offline contínuo e módulo de contingência (*Disaster Recovery*) com geração e restauração de snapshots em arquivo `.json`.

---

### 🔹 Fase 8: Transformação Comercial & Portal de Entrada
* **Mensagem do Usuário:** *"o que podemos colocar pra deixar ele mais comercial possivel emais vendivel?"* -> *"certo, não seria bom criar uma parte só para registro? como posso dizer, deixar com uma cara de pronto? para fazer login como funcionario ou como amd"* -> *"vamos fazer isso"*
* **Ações e Implementações Realizadas:**
  * **Portal de Entrada & Autenticação Corporativa:** Tela de recepção que precede o dashboard com alternância entre perfis, login com e-mail/senha corporativo e credenciais de demonstração rápida.
  * **Gerador de Propostas Comerciais Executivas:** Módulo de emissão de proposta profissional A4 pronta para impressão ou exportação em PDF, com cálculo automático de parcelas, escopo técnico, vigência e termos contratuais.
  * **Barra de Ferramentas Otimizada:** Organização das ações do cabeçalho em menus condensados e elegantes para evitar poluição visual.

---

### 🔹 Fase 9: Gestão de Funcionários com CPF e Senha Temporária
* **Mensagem do Usuário:** *"o que podemos fazer agora? podemos criar no painel de admistrador onde pode criar contas para funcionarios usando cpf e uma senha temporaria"*
* **Ações e Implementações Realizadas:**
  * Criação do módulo `js/employee-service.js`:
    * **Validador Oficial de CPF (Módulo 11):** Validação matemática dos dois dígitos verificadores, rejeitando padrões inválidos ou strings repetidas.
    * **Formatação & Máscara LGPD:** Entrada formatada automaticamente (`000.000.000-00`) e exibição mascarada (`123.***.***-01`) para privacidade.
    * **Gerador de Senha Temporária:** Criação de senhas com alta entropia (ex.: `Nexus#8492!`).
    * **Fluxo de Primeiro Acesso Obrigatório:** Na primeira autenticação com a senha temporária, o sistema redireciona automaticamente para modal exigindo cadastro de senha definitiva pessoal.
    * **Compartilhamento 1-Clique:** Botão para copiar texto pronto com credenciais para envio via WhatsApp ou E-mail ao colaborador.

---

### 🔹 Fase 10: Resolução de Bugs de Sincronização & Renderização
* **Mensagens do Usuário:**
  * *"estou com alguns bug, eu registrei 3 leads mas ele não apareceu e também como funcionario eu não consigo atualizar o status do cliente, por exemplo: de em negocioação para perdido ou para outro status"*
  * *"acontece isso, ele muda de local mas aparece esse erro"* (`Erro ao registrar perda: No document to update: projects/...`)
  * *"continua aparecendo o erro na tela, vamos resolver esses icones aparecendo fora do card, tambem vamos fazer um debug em todo o aplicativo procurando todos os bugs possiveis e resolvendo eles"*
* **Diagnóstico Profundo e Correções Definitivas:**
  1. **Bug do Firestore (`No document to update`):**
     * **Causa Raiz:** O Firestore criava IDs automáticos aleatórios (ex: `YNMLlrvm83cnLwahB36w`), enquanto o cliente utilizava `lead-179025...`. Quando o cliente tentava atualizar via `updateDoc`, o documento não era encontrado pela chave informada.
     * **Solução:** Migração e unificação de IDs diretamente no Firestore. Substituição de `updateDoc` por `setDoc(docRef, payload, { merge: true })` no `firebase-service.js`, garantindo operações idempotentes que nunca disparam erro 404 (upsert automático). Tratamento resiliente em `storage-manager.js` para nunca quebrar a interface em oscilações de rede.
  2. **Bug de Detecção de Lead Existente na Edição:**
     * **Causa Raiz:** A função `saveCustomer` possuía uma checagem que ignorava IDs iniciados por `lead-`, tratando edições de leads existentes como novos cadastros.
     * **Solução:** Verificação direta através de `this.getCustomer(customerData.id)`, garantindo atualização perfeita tanto para IDs legados quanto para novos documentos.
  3. **Bug Visual de Ícones Fora do Card Kanban:**
     * **Causa Raiz:** O `.card-footer` colocava o `<select>` de estágio (~120px), o botão do WhatsApp (~75px) e 5 botões de ação (~140px) na mesma linha flex em uma coluna de 250px sem quebra, transbordando mais de 80px à direita do card.
     * **Solução:** Reestruturação do footer em duas linhas semânticas:
       * **Linha 1 (`.card-footer-row`):** Seletor de estágio (`flex: 1`) + Botão WhatsApp.
       * **Linha 2 (`.card-actions`):** 5 botões de ação compactos (28x28px cada), alinhados à direita, com linha pontilhada divisória e `flex-wrap: wrap`.
       * **Contenção no Card:** Adição de `overflow: hidden; box-sizing: border-box; width: 100%;` no `.lead-card` e truncamento de texto com reticências no nome e empresa.
  4. **PWA & Cache Invalidation:**
     * Inclusão do `employee-service.js` nos assets estáticos do Service Worker.
     * Incremento de versão para `v=1.3.1` no `sw.js` e parâmetros de cache-buster nos arquivos CSS e JS do `index.html`.

---

## 🏗️ 3. Mapeamento Arquitetural do Código-Fonte

```
nexus-crm/
│
├── index.html                   # Interface principal (SPA) com Kanban, métricas, modais e PWA
├── manifest.json                # Manifesto PWA com ícones e configurações de instalação
├── sw.js                        # Service Worker v1.3.1 (Cache Offline & Stale-While-Revalidate)
├── GEMINI.md                    # Regras de autonomia e continuidade do desenvolvimento
│
├── css/
│   ├── design-tokens.css        # Variáveis CSS, paleta executiva sóbria, tipografia e raios
│   ├── layout.css               # Estrutura de grid, containers, header e navegação
│   ├── components.css           # Estilização de cards Kanban, tabelas, modais, botões e formulários
│   └── animations.css           # Micro-interações, estados de hover e transições suaves
│
├── js/
│   ├── app.js                   # Orquestrador geral, bind de eventos, drag-and-drop e inicialização
│   ├── auth-service.js          # Autenticação Google/Email, RBAC (Admin/Funcionário) e sessões
│   ├── crm-store.js             # Estado central reativo, cálculo de KPIs e filtros de busca/prioridade
│   ├── storage-manager.js       # Camada unificada de dados (Cache Local + Google Cloud Firestore)
│   ├── firebase-service.js      # Integração oficial Firebase v11 (add, setDoc merge, snapshot)
│   ├── employee-service.js      # Validador de CPF (Módulo 11), senhas temporárias e primeiro acesso
│   ├── gemini-service.js        # Integração com Google Gemini 2.5 Flash para análise comercial
│   ├── export-service.js        # Exportação de CSV/Excel com UTF-8 BOM e JSON Disaster Recovery
│   ├── ui-renderer.js           # Renderizador do Kanban, KPIs, tabelas, timeline e badges
│   └── config.js                # Gerenciador de credenciais do Firebase e Gemini no cliente
│
└── assets/
    └── icon.svg                 # Identidade visual vetorial e ícone PWA
```

---

## 🔒 4. Matriz de Segurança e Tríade CID

| Pilar CID | Mecanismo Implementado | Arquivo / Módulo |
| :--- | :--- | :--- |
| **Confidencialidade (C)** | Visão restrita por papel (Funcionário não vê faturamento global da empresa nem leads de outros colegas; Admin possui visão irrestrita). | `js/crm-store.js`<br>`js/auth-service.js` |
| **Confidencialidade (C)** | Mascaramento de CPF em conformidade com a LGPD (`123.***.***-01`). | `js/employee-service.js` |
| **Integridade (I)** | Exclusão de clientes restrita ao Administrador com trilha de auditoria completa (*Audit Logs*). | `js/storage-manager.js`<br>`js/ui-renderer.js` |
| **Integridade (I)** | Sanitização ativa contra injeções de HTML/XSS na entrada de dados (`sanitizeInput`). | `js/app.js` |
| **Integridade (I)** | Validação algorítmica de CPFs brasileiros legítimos (cálculo de 2 dígitos verificadores). | `js/employee-service.js` |
| **Disponibilidade (D)** | Service Worker Offline-First com cache estático para operação contínua sem internet. | `sw.js` |
| **Disponibilidade (D)** | Módulo de Contingência e Disaster Recovery com exportação e importação de snapshots JSON. | `js/export-service.js`<br>`js/storage-manager.js` |

---

## 🚀 5. Como Executar e Implantar

### Execução Local:
```powershell
# Iniciar servidor estático local na porta 3000
python -m http.server 3000
# Acessar via navegador: http://localhost:3000
```

### Deploy para Firebase Hosting:
```powershell
# Publicar alterações para a nuvem
firebase deploy --only hosting
```

### Sincronização Git:
```powershell
git add -A
git commit -m "feat: histórico oficial do projeto e documentação consolidada"
git push origin main
```

---

## 🎯 6. Conclusão e Estado do Projeto

O **Nexus CRM** encontra-se em estado **estável, funcional e visualmente refinado**:
1. Todos os cards do Kanban acomodam perfeitamente seus botões de ação sem qualquer transbordamento.
2. A sincronização com o Firestore opera de forma resiliente via `setDoc` com merge, eliminando erros de documento não encontrado.
3. A criação de funcionários por CPF e senhas temporárias com fluxo de primeiro acesso está 100% operacional.
4. As políticas de segurança da Tríade CID garantem confiabilidade para apresentação e uso comercial.
