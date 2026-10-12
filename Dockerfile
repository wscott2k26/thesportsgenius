FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY public/ ./public/
COPY src/ ./src/
# Fail the image build before release if any backend test fails. Only an
# ephemeral in-memory SQLite database is used; live /data is not touched.
COPY test/ ./test/
RUN DB_PATH=:memory: ADMIN_EMAILS=ledger-admin@example.test node --test test/*.test.js
RUN rm -rf ./test
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
