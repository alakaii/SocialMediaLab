#!/bin/bash
set -e
#
# Ask the running Railway service what commit it is on and compare it to local
# HEAD.
#
# WHY (launch playbook, section 5 "Ops lessons"): verify deploys by asking the
# server what commit it runs, never by a health check. A 200 response and a
# fresh asset hash prove nothing for server-only changes (worker logic, loaders,
# webhook handlers), and Railway will happily keep serving the previous build
# after a failed one. RAILWAY_GIT_COMMIT_SHA is injected into the container by
# Railway at deploy time, so it is the deployed build's own account of itself.
#
# Usage:
#   bash scripts/verify-deploy.sh              # default service (web)
#   bash scripts/verify-deploy.sh worker       # the worker service
#   DEPLOY_SERVICE=Other bash scripts/verify-deploy.sh
#
# Portable across Git Bash on Windows and Linux (no GNU-only flags).

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

# One repo, two Railway services (see scripts/start.sh, railway.json, Procfile).
# Neither railway.json nor the Procfile names the Railway services, they only
# name the processes (web, worker). In the live project the web service is
# "SocialMediaLab" and the worker service is "worker", so the web one is the
# default here. Override with an argument or DEPLOY_SERVICE if the service is
# ever renamed.
DEFAULT_SERVICE="SocialMediaLab"
SERVICE="${1:-${DEPLOY_SERVICE:-$DEFAULT_SERVICE}}"

# ---------------------------------------------------------------------------
# 1. Find the Railway CLI (global first, then a local install via npx)
# ---------------------------------------------------------------------------

RAILWAY_BIN=""
USE_NPX=0

if command -v railway >/dev/null 2>&1; then
  RAILWAY_BIN="railway"
elif [ -x "$ROOT_DIR/node_modules/.bin/railway" ]; then
  RAILWAY_BIN="$ROOT_DIR/node_modules/.bin/railway"
elif npx --no -- @railway/cli --version >/dev/null 2>&1; then
  # --no means "do not download it", we only want an already installed copy.
  # The bare "--" matters: without it npx swallows --version and reports its
  # own, so the probe passes even when the CLI is nowhere to be found.
  USE_NPX=1
else
  echo "ERROR: the Railway CLI was not found." >&2
  echo "" >&2
  echo "  Install it:      npm i -g @railway/cli" >&2
  echo "  Then log in:     railway login" >&2
  echo "  Then link this repo to the project:" >&2
  echo "                   railway link" >&2
  echo "" >&2
  echo "  Deploys cannot be verified without it, and an unverified deploy is" >&2
  echo "  an assumption, not a fact." >&2
  exit 1
fi

run_railway() {
  if [ "$USE_NPX" -eq 1 ]; then
    npx --no -- @railway/cli "$@"
  else
    "$RAILWAY_BIN" "$@"
  fi
}

# ---------------------------------------------------------------------------
# 2. Ask the container for its commit SHA
# ---------------------------------------------------------------------------

echo "Asking Railway service \"$SERVICE\" which commit it is running..."

set +e
SSH_OUTPUT=$(run_railway ssh --service "$SERVICE" 'printenv RAILWAY_GIT_COMMIT_SHA' 2>&1 </dev/null)
SSH_STATUS=$?
set -e

if [ "$SSH_STATUS" -ne 0 ]; then
  echo "ERROR: 'railway ssh' failed for service \"$SERVICE\" (exit $SSH_STATUS)." >&2
  echo "--- railway output ---" >&2
  printf '%s\n' "$SSH_OUTPUT" >&2
  echo "----------------------" >&2
  echo "" >&2
  echo "  Most likely causes:" >&2
  echo "   - this directory is not linked to a project: run 'railway link'" >&2
  echo "   - not logged in: run 'railway login'" >&2
  echo "   - wrong service name: run 'railway status' to list them, then pass" >&2
  echo "     the right one, e.g. bash scripts/verify-deploy.sh worker" >&2
  echo "   - the service has no running instance to ssh into" >&2
  exit 1
fi

# printenv output can arrive alongside CLI chatter, so pick the line that is a
# bare 40 character SHA. tr strips CR in case of a Windows shell round trip.
REMOTE_SHA=$(printf '%s\n' "$SSH_OUTPUT" | tr -d '\r' | grep -E '^[0-9a-f]{40}$' | tail -n 1 || true)

if [ -z "$REMOTE_SHA" ]; then
  echo "ERROR: no commit SHA came back from service \"$SERVICE\"." >&2
  echo "--- railway output ---" >&2
  printf '%s\n' "$SSH_OUTPUT" >&2
  echo "----------------------" >&2
  echo "" >&2
  echo "  RAILWAY_GIT_COMMIT_SHA is only set when the service deploys from a" >&2
  echo "  connected GitHub repo. A service deployed by 'railway up' or from an" >&2
  echo "  image will not have it, and cannot be verified this way." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Compare against local HEAD
# ---------------------------------------------------------------------------

LOCAL_SHA=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null | tr -d '\r' || true)

if [ -z "$LOCAL_SHA" ]; then
  echo "ERROR: could not read local HEAD with git rev-parse." >&2
  exit 1
fi

echo ""
if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
  echo "======================================================================"
  echo "  MATCH: \"$SERVICE\" is running local HEAD"
  echo "    local  HEAD : $LOCAL_SHA"
  echo "    deployed    : $REMOTE_SHA"
  echo "======================================================================"
  # Uncommitted work is not deployed work, worth saying out loud.
  if [ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]; then
    echo "  Note: the working tree has uncommitted changes. They are not in the"
    echo "  deployed build, only everything up to HEAD is."
  fi
  exit 0
fi

echo "======================================================================"
echo "  MISMATCH: \"$SERVICE\" is NOT running local HEAD"
echo "    local  HEAD : $LOCAL_SHA"
echo "    deployed    : $REMOTE_SHA"
echo "======================================================================"
echo "  The deploy either has not finished, failed and left the previous"
echo "  build serving, or the commit was never pushed. Check the Railway"
echo "  deploy logs before believing anything you see in the app."
exit 1
