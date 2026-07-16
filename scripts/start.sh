#!/bin/bash
set -e
npx prisma migrate deploy && npx remix-serve build/server/index.js
