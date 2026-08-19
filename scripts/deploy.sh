#!/bin/bash
set -e
#
# Guarded wrapper around `shopify app deploy`. Never run the bare command.
#
# WHY (launch playbook, section 5 "Ops lessons"): the Shopify CLI substitutes
# env vars into extension bundles from the SHELL environment, not from
# shopify.app.toml. A previous app shipped a customer-account extension with no
# backend URL twice because SHOPIFY_APP_URL was simply unset in the deploying
# shell. The build succeeds, the deploy succeeds, and the extension is dead in
# production. So: set the env from the toml first, deploy, then grep the built
# bundles for leftover "process.env." and refuse to call it a release if any
# survived.
#
# This repo has no extensions/ yet. The guard is here so it is already in place
# the day one appears. `shopify app deploy` is also how shopify.app.toml config
# (scopes, webhook subscriptions) reaches Shopify, so this wrapper is the
# normal deploy path either way.
#
# Portable across Git Bash on Windows and Linux (no GNU-only flags).

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TOML="$ROOT_DIR/shopify.app.toml"

# ---------------------------------------------------------------------------
# 1. SHOPIFY_APP_URL, from the shell if set, otherwise from the toml
# ---------------------------------------------------------------------------

if [ ! -f "$TOML" ]; then
  echo "ERROR: shopify.app.toml not found at $TOML" >&2
  exit 1
fi

# Minimal TOML read, no parser dependency. Handles both quoting styles TOML
# allows for a basic string. tr strips CR so a CRLF checkout does not leave a
# stray carriage return glued to the URL.
read_application_url() {
  _url=$(sed -n 's/^[[:space:]]*application_url[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$TOML" | tr -d '\r' | head -n 1)
  if [ -z "$_url" ]; then
    _url=$(sed -n "s/^[[:space:]]*application_url[[:space:]]*=[[:space:]]*'\([^']*\)'.*/\1/p" "$TOML" | tr -d '\r' | head -n 1)
  fi
  printf '%s' "$_url"
}

TOML_URL=$(read_application_url)

if [ -z "${SHOPIFY_APP_URL:-}" ]; then
  SHOPIFY_APP_URL="$TOML_URL"
  export SHOPIFY_APP_URL
  if [ -n "$SHOPIFY_APP_URL" ]; then
    echo "SHOPIFY_APP_URL was unset, took application_url from shopify.app.toml."
  fi
else
  export SHOPIFY_APP_URL
  if [ -n "$TOML_URL" ] && [ "$SHOPIFY_APP_URL" != "$TOML_URL" ]; then
    # Legitimate during `shopify app dev` (tunnel URL), a bug at deploy time.
    # Playbook section 7: mixed-domain configs (app URL new, webhooks old) look
    # fine right up until webhooks silently stop arriving.
    echo "WARNING: shell SHOPIFY_APP_URL does not match shopify.app.toml." >&2
    echo "  shell: $SHOPIFY_APP_URL" >&2
    echo "  toml : $TOML_URL" >&2
    echo "  The shell value is what gets baked into extension bundles." >&2
  fi
fi

if [ -z "$SHOPIFY_APP_URL" ]; then
  echo "ERROR: SHOPIFY_APP_URL is empty." >&2
  echo "  No application_url found in $TOML and none set in the environment." >&2
  echo "  Refusing to deploy, this is exactly how an extension ships with no" >&2
  echo "  backend URL. Set application_url in shopify.app.toml (or export" >&2
  echo "  SHOPIFY_APP_URL) and try again." >&2
  exit 1
fi

echo "SHOPIFY_APP_URL=$SHOPIFY_APP_URL"

# ---------------------------------------------------------------------------
# 2. The deploy itself. Extra args pass straight through (--force, --message,
#    --version, ...).
# ---------------------------------------------------------------------------

echo "Running: npx shopify app deploy $*"
npx shopify app deploy "$@"

# ---------------------------------------------------------------------------
# 3. Post-deploy guard: no unsubstituted "process.env." in built bundles
# ---------------------------------------------------------------------------

EXT_DIR="$ROOT_DIR/extensions"

if [ ! -d "$EXT_DIR" ]; then
  echo "No extensions/ directory, bundle check skipped."
  exit 0
fi

LEAKS=""
CHECKED_ANY=0

for ext in "$EXT_DIR"/*/; do
  if [ ! -d "$ext" ]; then
    continue
  fi
  for sub in dist build; do
    if [ -d "$ext$sub" ]; then
      CHECKED_ANY=1
      # -F so the dots are literal, -l so we only get file names back.
      hits=$(grep -r -F -l 'process.env.' "$ext$sub" 2>/dev/null || true)
      if [ -n "$hits" ]; then
        LEAKS="$LEAKS$hits
"
      fi
    fi
  done
done

if [ "$CHECKED_ANY" -eq 0 ]; then
  echo "extensions/ exists but no dist/ or build/ output was found, bundle check skipped."
  exit 0
fi

if [ -n "$LEAKS" ]; then
  echo "" >&2
  echo "=====================================================================" >&2
  echo " DEPLOY GUARD FAILED" >&2
  echo "=====================================================================" >&2
  echo " Literal 'process.env.' survived into these built extension bundles:" >&2
  printf '%s' "$LEAKS" | sed 's/^/   /' >&2
  echo "" >&2
  echo " That means the CLI had nothing to substitute, so the extension is" >&2
  echo " shipping without that value (this is the bug that shipped twice)." >&2
  echo " Export the missing variable in this shell and redeploy. Treat the" >&2
  echo " version just pushed as broken." >&2
  echo "=====================================================================" >&2
  exit 1
fi

echo "Bundle check passed, no leftover 'process.env.' in built extension bundles."
