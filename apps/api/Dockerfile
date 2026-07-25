# ДебатоТренер API — multi-stage production build
# Usage: docker build -f apps/api/Dockerfile -t talqyla/api .

# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Copy package manager manifests for layer caching
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/

RUN corepack enable && pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Copy cached node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules

# Copy source files
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/config ./packages/config
COPY packages/db ./packages/db

# Generate Prisma client
RUN cd packages/db && npx prisma generate

# Build workspace packages in dependency order
RUN corepack enable && pnpm -r --filter @talqyla/config run build
RUN corepack enable && pnpm -r --filter @talqyla/db run build
RUN corepack enable && pnpm -r --filter @talqyla/api run build

# ── Stage 3: Runner ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist

# Copy Prisma client (generated binary)
COPY --from=builder /app/packages/db/node_modules/.prisma ./packages/db/node_modules/.prisma
COPY --from=builder /app/packages/db/node_modules/@prisma ./packages/db/node_modules/@prisma

# Copy production node_modules (only needed packages)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

LABEL org.opencontainers.image.title="ДебатоТренер API"
LABEL org.opencontainers.image.description="AI debate coach for grades 7–11"
LABEL org.opencontainers.image.version="0.1.0"

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1

CMD ["node", "apps/api/dist/server.js"]
