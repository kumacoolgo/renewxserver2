FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    DB_PATH=/data/accounts.db \
    PROFILE_DIR=/data/profiles \
    CLOAKBROWSER_CACHE_DIR=/data/.cloakbrowser \
    BROWSER_HEADLESS=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    make \
    python3 \
    tini \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev
RUN npx playwright install-deps chromium

COPY . .
RUN npm run check

VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bot.js"]
