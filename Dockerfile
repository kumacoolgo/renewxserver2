FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Install build tools for sqlite3 and tini for zombie-process reaping
RUN apt-get update && apt-get install -y --no-install-recommends \
    make \
    g++ \
    python3 \
    tini \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

ENV NODE_ENV=production

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bot.js"]
