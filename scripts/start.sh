#!/bin/bash
set -e
# One repo, two Railway services: the worker service sets SERVICE_ROLE=worker,
# the web service leaves it unset.
if [ "$SERVICE_ROLE" = "worker" ]; then
  npm run worker
else
  npx prisma migrate deploy && npx remix-serve build/server/index.js
fi
