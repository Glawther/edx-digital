# EDX Digital - Production Hardened Dockerfile
# Base LTS Alpine com usuário não-root e isolamento de privilégios

FROM node:20-alpine AS base

# Atualização de pacotes de segurança do sistema e dumb-init para gerenciamento de processos
RUN apk --no-cache upgrade && \
    apk add --no-cache dumb-init

WORKDIR /usr/src/app

# Definir ambiente seguro de produção
ENV NODE_ENV=production
ENV PORT=3000

# Copiar manifestos de dependências
COPY package*.json ./

# Instalação apenas de dependências de produção
RUN npm install --omit=dev --no-audit --no-fund

# Copiar código-fonte da aplicação
COPY . .

# Ajustar permissões para o usuário node
RUN chown -R node:node /usr/src/app

# Princípio do Menor Privilégio: executar como usuário node
USER node

# Exposição da porta de serviço
EXPOSE 3000

# Healthcheck do container (verificação contínua da saúde da API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Supervisor de processos para evitar processos zumbis
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Inicialização da aplicação
CMD ["node", "server.js"]
