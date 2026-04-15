# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for native addons (sharp, etc.)
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package*.json ./
RUN npm ci --prefer-offline

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# ffmpeg + ffprobe (needed at runtime; ffmpeg-static also bundles a binary but
# having the system package ensures fonts/ass filter modules are available)
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    font-noto \
    font-dejavu \
    ca-certificates \
    && fc-cache -fv

# Copy built JS + production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy any static assets (fonts, etc.) if they exist
COPY assets ./assets 2>/dev/null || true

# Output directory (will be mounted as a Docker volume in production)
RUN mkdir -p /data/output
ENV OUTPUT_DIR=/data/output

# Default port
ENV PORT=3001
EXPOSE 3001

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app /data
USER app

CMD ["node", "dist/index.js"]