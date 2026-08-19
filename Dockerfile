# ---------------------------------------------------------------------------
# XAUUSD Command Center
#
# Multi-stage build: the workspace packages are compiled, Next.js is built in
# standalone mode, then only the runtime artefacts are copied into a slim
# image that runs as a non-root user.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma needs OpenSSL at both build and run time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ------------------------------------------------------------- dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/providers/package.json packages/providers/
COPY apps/web/package.json apps/web/
RUN npm ci

# -------------------------------------------------------------------- build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:libs \
    && npm run db:generate -w @xau/web \
    && npm run build -w @xau/web

# ------------------------------------------------------------------ runtime
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UPLOAD_DIR=/app/uploads

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output bundles only what the server actually needs.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Migrations and the Prisma CLI, so the container can bring its own schema up.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/prisma ./apps/web/prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh

RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads && chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/app/uploads"]

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
