#!/bin/sh
# Per-environment configuration of the `www` nginx container, applied at
# container start (PLAN-AUTO-DEPLOY §4.10, Phase 1a; sweep S8).
#
# The stock nginx image runs every executable `*.sh` in /docker-entrypoint.d/
# before starting nginx, and its entrypoint runs under `set -e`, so a non-zero
# exit here stops the container instead of serving a misconfigured site.
#
# PRODUCTION SETS NOTHING AND THIS SCRIPT CHANGES NOTHING. With both variables
# unset (or MMP_SITE_ENV=production and the production project id), no file is
# touched: nginx.conf, robots.txt and sitemap.xml are served exactly as built.
# `tests/site-environment-invariants.test.ts` pins that.
#
# Variables (set on the container, e.g. in Coolify):
#   MMP_SITE_ENV             production (default) | staging
#   MMP_FIREBASE_PROJECT_ID  the Firebase project the image's functions live in.
#                            Default: production's. Required, and must differ
#                            from production's, when MMP_SITE_ENV=staging.
#
# On a staging container it:
#   1. rewrites production's project id in nginx.conf (the CSP report endpoint,
#      Reporting-Endpoints, and the /join crawler proxy host), so the site's
#      CSP reports and link previews go to its own project's functions;
#   2. writes an `X-Robots-Tag: noindex, nofollow` header include, a deny-all
#      robots.txt, and removes sitemap.xml, so the public staging site is never
#      indexed (codex X5.2).
#
# The fail-closed checks run in both directions: a staging container must name
# a non-production project, and a non-production project can never be served
# as production (which would leave staging indexable).
#
# Paths are overridable for the test only.
set -eu

PROD_PROJECT_ID="gridiron-gamble-uzuqo"
CONF="${MMP_NGINX_CONF:-/etc/nginx/conf.d/default.conf}"
HTML_ROOT="${MMP_HTML_ROOT:-/usr/share/nginx/html}"
ENV_DIR="${MMP_ENV_DIR:-/etc/nginx/mmp-env}"
# The Firebase project the browser bundle was BUILT for (VITE_FIREBASE_PROJECT_ID,
# written by the Dockerfile). The bundle talks to that project directly, so the
# runtime variables below can only be trusted if they agree with it (qodo #1
# on #796: a production-built image started as staging would otherwise pass
# every check here while its users wrote to production).
BUILD_PROJECT_FILE="${MMP_BUILD_PROJECT_FILE:-/etc/nginx/mmp-build-project}"

site_env="${MMP_SITE_ENV:-production}"
project="${MMP_FIREBASE_PROJECT_ID:-$PROD_PROJECT_ID}"

fail() {
    echo "40-mmp-environment: $*" >&2
    exit 1
}

case "$site_env" in
    production|staging) ;;
    *) fail "MMP_SITE_ENV must be 'production' or 'staging', got '$site_env'" ;;
esac

if ! printf '%s' "$project" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'; then
    fail "MMP_FIREBASE_PROJECT_ID is not a valid project id: '$project'"
fi

built=""
if [ -f "$BUILD_PROJECT_FILE" ]; then
    built="$(tr -d ' \t\r\n' < "$BUILD_PROJECT_FILE")"
fi

if [ "$site_env" = "production" ]; then
    if [ "$project" != "$PROD_PROJECT_ID" ]; then
        fail "MMP_FIREBASE_PROJECT_ID=$project is not production's project; set MMP_SITE_ENV=staging"
    fi
    # A bundle built for another project must never be served as production.
    # An EMPTY record is allowed, with a warning, so that production behaves
    # exactly as it did before this script existed.
    if [ -n "$built" ] && [ "$built" != "$PROD_PROJECT_ID" ]; then
        fail "this image's bundle was built for project '$built', not production's"
    fi
    if [ -z "$built" ]; then
        echo "40-mmp-environment: warning: no build-time project recorded in $BUILD_PROJECT_FILE" >&2
    fi
    echo "40-mmp-environment: production, nothing to change"
    exit 0
fi

# ---- staging ----
if [ "$project" = "$PROD_PROJECT_ID" ]; then
    fail "MMP_SITE_ENV=staging needs MMP_FIREBASE_PROJECT_ID set to the staging project, not production's"
fi
# Staging is strict: the bundle must have been built for this very project.
if [ "$built" != "$project" ]; then
    fail "this image's bundle was built for project '${built:-<none recorded>}', not $project"
fi

# The project id was validated above against a pattern with no sed or regex
# metacharacters, so it is safe in the replacement.
sed -i "s/$PROD_PROJECT_ID/$project/g" "$CONF"
if grep -q "$PROD_PROJECT_ID" "$CONF"; then
    fail "production's project id is still in $CONF after the rewrite"
fi

mkdir -p "$ENV_DIR"
printf 'add_header X-Robots-Tag "noindex, nofollow" always;\n' > "$ENV_DIR/noindex.conf"
printf 'User-agent: *\nDisallow: /\n' > "$HTML_ROOT/robots.txt"
rm -f "$HTML_ROOT/sitemap.xml"

echo "40-mmp-environment: staging, project $project, not indexable"
