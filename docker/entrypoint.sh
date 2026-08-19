#!/bin/sh
set -e

# Apply any pending migrations before serving. Safe to run repeatedly: Prisma
# skips migrations that are already applied.
if [ -n "$DATABASE_URL" ]; then
  echo "Applying database migrations…"
  ./node_modules/prisma/build/index.js migrate deploy --schema ./apps/web/prisma/schema.prisma || {
    echo "Migration failed. The application will not start with an out-of-date schema." >&2
    exit 1
  }
else
  echo "DATABASE_URL is not set; cannot start." >&2
  exit 1
fi

exec "$@"
