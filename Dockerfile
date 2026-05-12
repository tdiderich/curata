FROM node:22-slim AS base

RUN apt-get update && apt-get install -y curl openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

ARG KAZAM_VERSION=1
RUN curl -fL https://github.com/tdiderich/kazam/releases/latest/download/kazam-linux-amd64 \
    -o /usr/local/bin/kazam && chmod +x /usr/local/bin/kazam

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV KAZAM_BIN=/usr/local/bin/kazam
ENV SITES_ROOT=/data/sites

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY entrypoint.sh ./entrypoint.sh

RUN mkdir -p /data/sites

CMD ["sh", "entrypoint.sh"]
