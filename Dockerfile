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

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

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