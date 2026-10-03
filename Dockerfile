# syntax=docker/dockerfile:1

# ---- Dependencies -----------------------------------------------------------
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# ---- Runtime ----------------------------------------------------------------
FROM node:24-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Node 24 strips TypeScript types natively, so no build step is required.
# Run as the non-root user that ships with the official image.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "./src/serve.ts"]
