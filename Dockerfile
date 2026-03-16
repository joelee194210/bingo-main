FROM node:20-slim AS base

# Dependencias nativas para canvas, pdfkit, bwip-js + PostgreSQL 18 client
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    python3 \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files para cache de dependencias
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci --include=dev --legacy-peer-deps

# Copiar source code
COPY . .

# Build server (TypeScript) y client (Vite)
RUN npm run build

EXPOSE ${PORT:-3000}

ENV NODE_ENV=production

WORKDIR /app/server
CMD ["node", "dist/app.js"]
