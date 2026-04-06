FROM node:20-slim

WORKDIR /app

# Solo copiar package files del landing (NO del root workspace)
COPY package.json package-lock.json ./

# Instalar solo dependencias de producción
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copiar código fuente
COPY tsconfig.json ./
COPY src/ src/

# Compilar TypeScript + copiar assets
RUN npx tsc --declaration false --declarationMap false --sourceMap false \
    && cp -r src/assets dist/assets 2>/dev/null || true

# Limpiar devDependencies y cache
RUN npm prune --omit=dev && rm -rf /root/.npm /tmp/*

EXPOSE 3002

CMD ["node", "dist/app.js"]
