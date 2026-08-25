# Step 1: Build the app
FROM node:20-alpine as build
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Install from the LOCKFILE, not a fresh resolve.
#
# `npm ci` is exactly what CI runs (.github/workflows/ci.yml, build-and-test),
# so the image is built from the tree CI validated. `npm install` re-resolves
# every range and can produce a tree nothing has ever tested — a green CI run
# then says nothing about whether this image will build. Repo convention
# besides: CLAUDE.md §3 says "`ci`, not `install`" for the same reason on
# `functions/`.
#
# `--legacy-peer-deps` is kept deliberately: it preserved the previous
# behaviour, and dropping it is a separate change with its own risk.
RUN npm ci --legacy-peer-deps

# Copy the rest of the code
COPY . .

# Firebase web config, passed as build args (baked into the client bundle by Vite).
# VITE_API_KEY (a Gemini key) removed — its only client reader was dead code and a
# Gemini key must never ship in the public bundle; server-side AI uses Secret Manager.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID

# Sentry (client error tracking).
#
# WITHOUT THESE, src/sentry.ts IS DEAD CODE IN EVERY PRODUCTION IMAGE. Vite
# inlines `import.meta.env.VITE_*` at BUILD time from the build environment, and
# a variable set in Coolify but never declared as a build ARG never reaches
# `npx vite build` below — so `loadSentry()` sees an empty DSN, returns null, and
# initSentry()/captureSentryException() no-op forever. The error-tracking audit
# scored this 2/6 for exactly that reason.
#
# BOTH are declared on purpose. src/sentry.ts documents
# VITE_SENTRY_REPLAY_SAMPLE_RATE as "a one-flag flip once masking is verified —
# no code change needed"; with the DSN wired and the rate not, replay would be
# pinned at the prod default of 0 with no way to turn it on, which is the same
# dead-config failure one layer down.
#
# Both are OPTIONAL: unset means empty, and an empty DSN ships the app with
# client error tracking off rather than failing the build. Neither is a secret —
# a Sentry DSN is a public ingest endpoint and is meant to sit in the bundle.
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_REPLAY_SAMPLE_RATE

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_REPLAY_SAMPLE_RATE=$VITE_SENTRY_REPLAY_SAMPLE_RATE

# Build in THREE steps rather than one `npm run build:static`, so a failure
# names itself.
#
# On 2026-08-05 this step died 21 seconds in with ZERO output, and the deploy
# log could only report that `npm run build:static` had failed. That script is
# three separate processes — `tsc -b`, `vite build`, then the prerender — and
# nothing in the log could say which one died. Separate RUN layers cost
# nothing (they run sequentially either way) and the failing layer is now
# identifiable from its number alone.
#
# ⚠️ This does NOT reduce peak memory, and must not be mistaken for a fix if
# that failure was an OOM. `tsc` and `vite` already ran as separate processes
# inside the one script, so per-process peak is unchanged. This makes such a
# failure DIAGNOSABLE, not survivable.
#
# ⚠️ These three MUST stay equivalent to package.json's `build:static`.
# `tests/dockerfile-build-parity.test.ts` fails if they drift.
RUN npx tsc -b
RUN npx vite build
# prerenders per-route HTML for SEO/social crawlers
RUN npm run prerender

# Step 2: Serve with Nginx
FROM nginx:alpine
# Copy the built files from the previous step
COPY --from=build /app/dist /usr/share/nginx/html
# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Fix permissions
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]